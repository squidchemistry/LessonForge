// End-to-end smoke test against a running server: node scripts/e2e.mjs "<title>" "<objective>"
const base = process.env.API || 'http://localhost:4000/api';
const [title, objective] = process.argv.slice(2);
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status}: ${j.error}`);
  return j;
};
let rec = process.env.ID ? { id: process.env.ID } : await call('POST', '/lessons', { title, objective });
console.log('lesson', rec.id);
for (const step of (process.env.STEPS || 'research,generate,qc1,qc2').split(',')) {
  const t = Date.now();
  try {
    rec = await call('POST', `/lessons/${rec.id}/steps/${step}`);
    console.log(`${step}: done in ${((Date.now() - t) / 1000).toFixed(1)}s`, rec.steps[step].note || '');
  } catch (e) {
    console.log(`${step}: FAILED -> ${e.message}`);
    break;
  }
}
rec = await call('GET', `/lessons/${rec.id}`);
if (rec.research) console.log('sources:', rec.research.sources.map((s) => `${s.id}:${s.type}:${s.domain}`).join(' '));
if (rec.lesson) {
  const l = rec.lesson;
  console.log('sections:', l.sections.map((s) => `${s.kind}/${s.minutes}m/${s.content.length}c`).join(' '));
  console.log('quiz:', l.quiz.length, '| videos:', l.videos.map((v) => v.title).join(' ; '), '| refs:', l.references.length);
}
for (const k of ['qc1', 'qc2']) {
  const r = rec[k];
  if (r) console.log(k, r.verdict, r.score, 'issues', r.issues.length, 'with-patch', r.issues.filter((i) => i.patch).length, r.issues.map((i) => `${i.id}:${i.severity}:${i.type}`).join(' '));
}
