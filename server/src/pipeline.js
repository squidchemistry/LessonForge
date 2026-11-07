import { update, getLesson, addVersion } from './store.js';
import { runResearch } from './research.js';
import { runGenerate } from './generate.js';
import { runQC1, runQC2 } from './qc.js';

const running = new Set();

const handlers = {
  async research(rec) {
    const research = await runResearch(rec);
    return {
      note: research.warnings.join(' '),
      apply: (r) => {
        // If a lesson already cites sources, keep those sources (and their ids) so citations never point at the wrong page.
        if (r.lesson && r.research) {
          const citedIds = new Set(r.lesson.references.map((x) => x.id));
          const kept = r.research.sources.filter((s) => citedIds.has(s.id));
          const keptUrls = new Set(kept.map((s) => s.url));
          let next = Math.max(0, ...r.research.sources.map((s) => Number(s.id.slice(1)))) + 1;
          const fresh = research.sources.filter((s) => !keptUrls.has(s.url)).map((s) => ({ ...s, id: `S${next++}` }));
          research.sources = [...kept, ...fresh].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
        }
        r.research = research;
      },
    };
  },
  async generate(rec) {
    if (!rec.research) throw new Error('Run research first.');
    const { lesson, warnings } = await runGenerate({ title: rec.title, objective: rec.objective, research: rec.research });
    return {
      note: warnings.join(' '),
      apply: (r) => {
        addVersion(r, lesson, 'AI generated');
        // Old audits describe a lesson that no longer exists.
        r.qc1 = null; r.qc2 = null;
        r.steps.qc1.status = 'idle'; r.steps.qc2.status = 'idle';
      },
    };
  },
  async qc1(rec) {
    if (!rec.lesson) throw new Error('Generate a lesson first.');
    if (!rec.research) throw new Error('Research data is missing.');
    const report = await runQC1({ lesson: rec.lesson, research: rec.research });
    return { apply: (r) => { r.qc1 = { ...report, forVersion: rec.version }; } };
  },
  async qc2(rec) {
    if (!rec.lesson) throw new Error('Generate a lesson first.');
    const report = await runQC2({ lesson: rec.lesson });
    return { apply: (r) => { r.qc2 = { ...report, forVersion: rec.version }; } };
  },
};

export const STEP_NAMES = Object.keys(handlers);

/**
 * Start a step. Returns as soon as the step is marked "running"; the work continues in the
 * background (so no HTTP request has to stay open for minutes - free hosts/proxies time out).
 * `done` resolves to { ok, error } when the step finishes. A step failure never throws out of it.
 */
export async function startStep(id, step) {
  const key = `${id}:${step}`;
  if (running.has(key)) throw Object.assign(new Error(`Step "${step}" is already running.`), { status: 409 });
  running.add(key);
  try {
    if (!(await getLesson(id))) throw Object.assign(new Error('Lesson not found'), { status: 404 });
    await update(id, (r) => { r.steps[step] = { status: 'running', error: null, note: null, startedAt: new Date().toISOString(), finishedAt: null }; });
  } catch (e) {
    running.delete(key);
    throw e;
  }
  const done = (async () => {
    try {
      const fresh = await getLesson(id);
      if (!fresh) throw new Error('Lesson was deleted while the step was running.');
      const { apply, note } = await handlers[step](fresh);
      // Apply onto the *latest* record so edits saved meanwhile are preserved.
      await update(id, (r) => {
        apply(r);
        r.steps[step] = { status: 'done', error: null, note: note || null, startedAt: r.steps[step].startedAt, finishedAt: new Date().toISOString() };
      });
      return { ok: true };
    } catch (e) {
      console.error(`[${id}] step ${step} failed:`, e.message);
      await update(id, (r) => { r.steps[step] = { ...r.steps[step], status: 'failed', error: e.message, finishedAt: new Date().toISOString() }; }).catch(() => {});
      return { ok: false, error: e.message };
    } finally {
      running.delete(key);
    }
  })();
  return { done };
}
