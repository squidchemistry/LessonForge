// Two independent QC layers. Each is a separate model call with its own persona and rubric,
// never sees the generator's prompt/reasoning, and produces its own audit report.
import { generateJSON } from './gemini.js';
import { tavily, sourcePackText, hostOf } from './research.js';
import { lessonAsText, stats, TOTAL_MINUTES } from './lesson.js';

const PATCH_SPEC = `"patch": {"op":"replace"|"append"|null, "sectionId":"sec-2", "find":"EXACT substring copied verbatim from that section's content (for replace)", "replace":"corrected text (for replace) or new text to append (for append)"}
Use patch only when a concrete text change fixes the issue AND "find" is copied character-for-character from the lesson. Otherwise set "op": null.`;

const clip = (s, n) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function finalizeIssues(issues, prefix) {
  return (Array.isArray(issues) ? issues : []).map((it, i) => ({
    id: `${prefix}${i + 1}`,
    severity: ['critical', 'major', 'minor'].includes(it.severity) ? it.severity : 'minor',
    type: String(it.type || 'other'),
    sectionId: it.sectionId || null,
    problem: String(it.problem || ''),
    evidence: String(it.evidence || ''),
    suggestion: String(it.suggestion || ''),
    patch: it.patch && it.patch.op ? { op: it.patch.op, sectionId: it.patch.sectionId || it.sectionId, find: it.patch.find || '', replace: it.patch.replace || '' } : null,
    status: 'open',
  }));
}

/** Drop patches whose `find` text isn't really in the lesson, so "Apply" never silently fails later. */
function validatePatches(issues, lesson) {
  for (const it of issues) {
    if (!it.patch) continue;
    const sec = lesson.sections.find((s) => s.id === it.patch.sectionId);
    const ok = sec && (it.patch.op === 'append' || (it.patch.op === 'replace' && it.patch.find && sec.content.includes(it.patch.find)));
    if (!ok) it.patch = null;
  }
}

// ---------- Link checks (deterministic, no LLM) ----------
async function checkUrl(url, isYouTube) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; LessonForge-QC/1.0)' };
  try {
    if (isYouTube) {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { headers, signal: AbortSignal.timeout(10_000) });
      return r.ok ? { status: 'ok', code: r.status } : { status: 'broken', code: r.status };
    }
    let r = await fetch(url, { method: 'HEAD', headers, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (r.status === 405 || r.status === 403 || r.status === 501) r = await fetch(url, { method: 'GET', headers, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (r.ok) return { status: 'ok', code: r.status };
    if ([401, 403, 429, 999].includes(r.status)) return { status: 'blocked', code: r.status };
    return { status: 'broken', code: r.status };
  } catch (e) {
    // A timeout means "could not verify" (slow/bot-hostile host), not "dead link".
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return { status: 'blocked', code: null, error: 'timeout' };
    return { status: 'unreachable', code: null, error: e.cause?.code || e.name };
  }
}

export async function checkLinks(lesson) {
  const urls = [...new Map([...lesson.references, ...lesson.videos].map((r) => [r.url, r])).values()];
  return Promise.all(urls.map(async (r) => ({ url: r.url, title: r.title, ...(await checkUrl(r.url, hostOf(r.url) === 'youtube.com')) })));
}

// ---------- QC Layer 1: Research & factual accuracy ----------
const QC1_SYSTEM = `You are an independent, skeptical fact-checker and research auditor. You did NOT write this lesson and you do not trust it. Your job is to find errors, not to praise.
- Verify each checkable factual claim against (a) the SOURCE PACK the author used and (b) the INDEPENDENT EVIDENCE gathered separately by fresh web searches. Also use your own expert knowledge, but flag when a verdict rests only on that.
- Statuses: "supported" (clearly backed), "unsupported" (no backing found / cited source does not say this), "misleading" (technically true but likely to mislead, or oversimplified into inaccuracy), "incorrect" (contradicted by evidence), "unverifiable".
- Check that citation markers [S#] point to sources that actually say what is claimed.
- Assess every source for reliability (official docs/specs/standards > reputable educational sites > blogs/forums > unknown) and relevance to the lesson. Judge ONLY from the source's actual URL/domain, title and excerpt in the pack - never from what you assume the site is. Be strict: a URL that is a file download or document on an unrelated organization's site, an excerpt that does not actually address the lesson topic, or user-generated content must be rated "low". A source the lesson never cites and that is off-topic should say so in the note. Never invent a description for a source.
- Note gaps (important facts missing/omitted) and internal inconsistencies (e.g. contradictory statements, quiz answers that disagree with the text).
- Check code/HTTP examples for technical correctness.
- Be specific and quote the problematic text. Do not invent problems; if the lesson is accurate say so, but look hard first.
Output ONLY valid JSON.`;

export async function runQC1({ lesson, research }) {
  // Step A: let the auditor decide what is riskiest to verify, then search independently.
  const planned = await generateJSON({
    system: 'You plan independent fact-verification web searches for a lesson. Output ONLY JSON.',
    prompt: `Lesson text:\n${lessonAsText(lesson)}\n\nList the 4 most important/risky factual claims (numbers, definitions, standard behaviour, "always/never" statements) and for each a precise web search query that would verify it against authoritative sources (e.g. include "RFC", "MDN", "official docs" where apt). Return {"queries":["...","...","...","..."]}`,
    temperature: 0.1,
    maxTokens: 2000,
  });
  const queries = (planned.queries || []).map(String).slice(0, 4);
  const settled = await Promise.allSettled(queries.map((q) => tavily(q, { search_depth: 'basic', max_results: 3 })));
  const evidence = queries.map((q, i) => ({
    query: q,
    results: settled[i].status === 'fulfilled' ? settled[i].value.map((r) => ({ title: r.title, url: r.url, content: clip(r.content, 900) })) : [],
    error: settled[i].status === 'rejected' ? settled[i].reason?.message : null,
  }));
  const evidenceText = evidence.map((e) => `Query: ${e.query}\n${e.error ? `(search failed: ${e.error})` : e.results.map((r) => `- ${r.title} <${r.url}>: ${r.content}`).join('\n')}`).join('\n\n');

  // Step B: the audit itself, run in parallel with deterministic link checks.
  const [raw, linkChecks] = await Promise.all([
    generateJSON({
      system: QC1_SYSTEM,
      prompt: `LESSON UNDER AUDIT:\n${lessonAsText(lesson)}\n\n=== SOURCE PACK USED BY THE AUTHOR ===\n${sourcePackText(research.sources, { maxExcerpt: 1800 })}\n\n=== INDEPENDENT EVIDENCE (fresh searches) ===\n${evidenceText}\n\nReturn JSON:
{
 "verdict": "pass" | "needs_revision" | "fail",
 "score": 0-100,
 "summary": "3-5 sentence overall assessment",
 "claims": [{"sectionId":"sec-2","claim":"short quote/paraphrase","status":"supported|unsupported|misleading|incorrect|unverifiable","evidence":"what confirms/contradicts it and where","sourceIds":["S1"]}],
 "sourceAssessment": [{"sourceId":"S1","reliability":"high|medium|low","relevance":"high|medium|low","note":"why"}],
 "inconsistencies": ["..."],
 "gaps": ["important missing facts or caveats"],
 "issues": [{"severity":"critical|major|minor","type":"factual|unsupported|misleading|source|gap|inconsistency","sectionId":"sec-2","problem":"...","evidence":"...","suggestion":"...", ${PATCH_SPEC}}]
}
Include 10-18 claims covering the most important checkable statements across sections and the quiz (use sectionId "quiz" for quiz items). Assess ALL sources.`,
      temperature: 0.1,
      maxTokens: 32000,
    }),
    checkLinks(lesson),
  ]);

  const issues = finalizeIssues(raw.issues, 'F');
  validatePatches(issues, lesson);
  for (const l of linkChecks.filter((x) => x.status === 'broken' || x.status === 'unreachable')) {
    issues.push({ id: `F${issues.length + 1}`, severity: 'major', type: 'source', sectionId: null, problem: `Reference link is ${l.status} (${l.code ?? l.error}): ${l.url}`, evidence: 'Automated link check', suggestion: 'Replace or remove this reference.', patch: null, status: 'open' });
  }
  return {
    layer: 'qc1', title: 'QC Layer 1 - Research & Factual Accuracy',
    verdict: raw.verdict || 'needs_revision', score: Number(raw.score) || 0, summary: String(raw.summary || ''),
    claims: Array.isArray(raw.claims) ? raw.claims : [], sourceAssessment: Array.isArray(raw.sourceAssessment) ? raw.sourceAssessment : [],
    inconsistencies: raw.inconsistencies || [], gaps: raw.gaps || [], issues, linkChecks,
    independentEvidence: evidence.map((e) => ({ query: e.query, urls: e.results.map((r) => r.url), error: e.error })),
    at: new Date().toISOString(),
  };
}

// ---------- QC Layer 2: Instructional quality ----------
const QC2_SYSTEM = `You are an independent instructional design reviewer (learning-science minded: Bloom's taxonomy, cognitive load, constructive alignment, worked-example effect, retrieval practice). You did NOT write this lesson. You judge ONLY instructional quality - not whether facts are true (a separate auditor does that).
Evaluate against the learning objective strictly:
- ALIGNMENT: decompose the objective into its distinct parts (each verb + content). For each part decide if the lesson fully/partially/never teaches AND assesses it at the right cognitive level (e.g. "distinguish" needs comparison + discrimination practice, not just definitions).
- Dimensions (score 1-5 with a note): clarity, structure & flow, relevance (no padding / off-topic), examples, practical application, assessment quality (do quiz items measure the objective, plausible distractors, scenario-based?), engagement, timing realism (45 min is a hard budget; use the provided word counts: ~200 wpm reading, activities need time to do).
- Find gaps: missing explanations, jargon used before defined, missing example for a key idea, absent misconception handling, weak activity, quiz not covering all objective parts.
Be concrete, quote the text, and give actionable fixes. Output ONLY valid JSON.`;

export async function runQC2({ lesson }) {
  const st = stats(lesson);
  const raw = await generateJSON({
    system: QC2_SYSTEM,
    prompt: `LEARNING OBJECTIVE: ${lesson.objective}\n\nLESSON UNDER REVIEW:\n${lessonAsText(lesson)}\n\nMEASURED STATS (computed by code, trust these): section minutes total ${st.minutes}/${TOTAL_MINUTES}; reading words in explanatory sections ${st.readingWords} (~${st.readingMinutes} min at 200 wpm); per-section: ${st.perSection.map((s) => `${s.id}=${s.minutes}min/${s.words}w`).join(', ')}; quiz questions ${st.quizQuestions}; supplementary video minutes ${Math.round(st.videoMinutes)} (optional, outside the 45).\n\nReturn JSON:
{
 "verdict": "pass" | "needs_revision" | "fail",
 "score": 0-100,
 "summary": "3-5 sentence overall assessment",
 "alignment": {"score": 1-5, "objectiveParts": [{"part":"...","coverage":"full|partial|missing","taughtIn":"sec-2","assessedBy":"Q3, Q5 or none","note":"..."}]},
 "dimensions": [{"name":"Clarity","score":1-5,"note":"..."}, ...for Structure & flow, Relevance, Examples, Practical application, Assessment quality, Engagement, Timing realism],
 "gaps": ["..."],
 "issues": [{"severity":"critical|major|minor","type":"alignment|clarity|structure|relevance|example|application|assessment|timing","sectionId":"sec-3","problem":"...","evidence":"quote or measurement","suggestion":"...", ${PATCH_SPEC}}]
}`,
    temperature: 0.2,
    maxTokens: 24000,
  });
  const issues = finalizeIssues(raw.issues, 'I');
  validatePatches(issues, lesson);
  if (Math.abs(st.minutes - TOTAL_MINUTES) > 2) {
    issues.push({ id: `I${issues.length + 1}`, severity: 'major', type: 'timing', sectionId: null, problem: `Section minutes total ${st.minutes}, not ${TOTAL_MINUTES}.`, evidence: 'Computed from section minutes', suggestion: 'Adjust section minutes so they total 45.', patch: null, status: 'open' });
  }
  return {
    layer: 'qc2', title: 'QC Layer 2 - Instructional Quality',
    verdict: raw.verdict || 'needs_revision', score: Number(raw.score) || 0, summary: String(raw.summary || ''),
    alignment: raw.alignment || { score: 0, objectiveParts: [] }, dimensions: raw.dimensions || [], gaps: raw.gaps || [], issues, stats: st,
    at: new Date().toISOString(),
  };
}
