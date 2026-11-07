// File-based store: one JSON file per lesson. All writes go through update(),
// which re-reads the latest record and serialises per-lesson, so a long-running
// AI step can never overwrite instructor edits saved in the meantime.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/lessons');
await fs.mkdir(DIR, { recursive: true });

const file = (id) => path.join(DIR, `${id}.json`);
export const isValidId = (id) => typeof id === 'string' && /^[a-f0-9]{12}$/.test(id);

const queues = new Map();

export const STEPS = ['research', 'generate', 'qc1', 'qc2'];

export async function getLesson(id) {
  if (!isValidId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(file(id), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function write(rec) {
  rec.updatedAt = new Date().toISOString();
  const tmp = `${file(rec.id)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rec, null, 2));
  await fs.rename(tmp, file(rec.id));
}

export function update(id, fn) {
  const prev = queues.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const rec = await getLesson(id);
    if (!rec) throw Object.assign(new Error('Lesson not found'), { status: 404 });
    const out = (await fn(rec)) ?? rec;
    await write(rec);
    return out === rec ? rec : out;
  });
  queues.set(id, next);
  return next;
}

export async function createLesson({ title, objective }) {
  const id = crypto.randomBytes(6).toString('hex');
  const idle = () => ({ status: 'idle', error: null, startedAt: null, finishedAt: null });
  const rec = {
    id, title, objective,
    createdAt: new Date().toISOString(), updatedAt: null,
    steps: Object.fromEntries(STEPS.map((s) => [s, idle()])),
    research: null, lesson: null, version: 0, versions: [], qc1: null, qc2: null,
  };
  await write(rec);
  return rec;
}

export async function deleteLesson(id) {
  if (!isValidId(id)) return false;
  try { await fs.unlink(file(id)); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

export async function listLessons() {
  const names = (await fs.readdir(DIR)).filter((n) => n.endsWith('.json'));
  const out = [];
  for (const n of names) {
    try {
      const r = JSON.parse(await fs.readFile(path.join(DIR, n), 'utf8'));
      out.push({ id: r.id, title: r.title, objective: r.objective, updatedAt: r.updatedAt, createdAt: r.createdAt, hasLesson: !!r.lesson });
    } catch { /* skip corrupt file */ }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function addVersion(rec, lesson, label) {
  const v = (rec.versions.at(-1)?.v ?? 0) + 1;
  rec.versions.push({ v, at: new Date().toISOString(), label, lesson });
  rec.lesson = lesson;
  rec.version = v;
  return v;
}

// A server crash/restart mid-step must not leave steps "running" forever.
export async function recoverInterruptedSteps() {
  const names = (await fs.readdir(DIR)).filter((n) => n.endsWith('.json'));
  for (const n of names) {
    const id = n.replace('.json', '');
    try {
      await update(id, (r) => {
        for (const s of STEPS) {
          if (r.steps[s]?.status === 'running') {
            r.steps[s] = { ...r.steps[s], status: 'failed', error: 'Interrupted (server restarted). Click retry.', finishedAt: new Date().toISOString() };
          }
        }
      });
    } catch { /* ignore */ }
  }
}
