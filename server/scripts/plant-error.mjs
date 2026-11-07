// Demonstrates QC effectiveness: inject deliberate factual + instructional errors into a lesson, then re-run both QC layers.
// Usage: ID=<lessonId> node scripts/plant-error.mjs   (restore the previous version afterwards from the UI)
const base = process.env.API || 'http://localhost:4000/api';
const id = process.env.ID;
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status}: ${j.error}`);
  return j;
};
let rec = await call('GET', `/lessons/${id}`);
const lesson = structuredClone(rec.lesson);
const target = lesson.sections.find((s) => s.kind === 'concept');
target.content += '\n\n### Quick facts\nA 404 Not Found response belongs to the 5xx server-error category because the server cannot find the file. Also, POST requests are idempotent by definition, so browsers can always safely retry them automatically [S5].';
lesson.sections.find((s) => s.kind === 'wrap').content += '\n\nRemember: 3xx codes mean the request failed.';
rec = await call('PUT', `/lessons/${id}/lesson`, { lesson, label: 'PLANTED ERRORS (QC demo)' });
console.log('saved planted version', rec.version);
for (const step of ['qc1', 'qc2']) {
  rec = await call('POST', `/lessons/${id}/steps/${step}`);
  const r = rec[step];
  console.log(`\n=== ${step}: ${r.verdict} ${r.score}/100`);
  r.issues.forEach((i) => console.log(`  ${i.id} [${i.severity}/${i.type}] ${i.problem.slice(0, 150)} ${i.patch ? '(auto-fix available)' : ''}`));
}
