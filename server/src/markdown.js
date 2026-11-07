const num = (id) => String(id).replace(/^S/, '');
const cite = (t) => String(t || '').replace(/\[(S\d+)\]/g, (_, id) => `[${num(id)}]`);

export function lessonMd(rec) {
  const l = rec.lesson;
  const out = [`# ${l.title}`, '', `**Learning objective:** ${l.objective}`, '', `**Duration:** ${l.sections.reduce((a, s) => a + s.minutes, 0)} minutes`, '', l.summary, ''];
  if (l.learningOutcomes.length) out.push('## By the end of this lesson you will be able to', '', ...l.learningOutcomes.map((o) => `- ${o}`), '');
  for (const s of l.sections) {
    out.push(`## ${s.heading} _(${s.minutes} min)_`, '', cite(s.content), '');
    if (s.kind === 'check') {
      l.quiz.forEach((q, i) => {
        out.push(`**Q${i + 1}. ${q.question}**`, '', ...q.options.map((o, j) => `- ${'ABCD'[j]}. ${o}`), '');
      });
      out.push('<details><summary>Answers</summary>', '');
      l.quiz.forEach((q, i) => out.push(`${i + 1}. **${'ABCD'[q.answerIndex]}** - ${cite(q.explanation)}`));
      out.push('', '</details>', '');
    }
  }
  if (!l.sections.some((s) => s.kind === 'check') && l.quiz.length) {
    out.push('## Knowledge check', '');
    l.quiz.forEach((q, i) => out.push(`**Q${i + 1}. ${q.question}**`, '', ...q.options.map((o, j) => `- ${'ABCD'[j]}. ${o}`), '', `_Answer: ${'ABCD'[q.answerIndex]} - ${cite(q.explanation)}_`, ''));
  }
  if (l.videos.length) {
    out.push('## Supplementary videos (optional)', '');
    l.videos.forEach((v) => out.push(`- [${v.title}](${v.url}) - ${v.channel}${v.minutes ? `, ${Math.round(v.minutes)} min` : ''}. ${v.why}`));
    out.push('');
  }
  out.push('## References', '', ...referencesList(l), '');
  return out.join('\n');
}

function referencesList(l) {
  if (!l.references.length) return ['_No references._'];
  return l.references.map((r) => `${num(r.id)}. [${r.title}](${r.url}) - _${r.type}_${r.note ? `, ${r.note}` : ''}`);
}

export function referencesMd(rec) {
  const l = rec.lesson;
  const out = [`# References - ${l.title}`, '', ...referencesList(l), ''];
  if (rec.research?.sources?.length) {
    const used = new Set(l.references.map((r) => r.id));
    const unused = rec.research.sources.filter((s) => !used.has(s.id));
    if (unused.length) out.push('## Researched but not cited', '', ...unused.map((s) => `- [${s.title}](${s.url}) (${s.type})`), '');
  }
  out.push('## Acknowledgement', '', 'Content was synthesised (paraphrased, not copied) with an AI model from the sources above. Sources are credited to their original authors.', '');
  return out.join('\n');
}

const ICON = { critical: '🔴', major: '🟠', minor: '🟡' };

export function qcMd(rep, layerName) {
  if (!rep) return `# ${layerName}\n\n_Not run yet._\n`;
  const out = [`# ${rep.title}`, '', `**Verdict:** ${rep.verdict}  |  **Score:** ${rep.score}/100  |  **Run:** ${rep.at}`, '', rep.summary, ''];
  if (rep.layer === 'qc1') {
    out.push('## Claim verification', '', '| Section | Claim | Status | Evidence |', '|---|---|---|---|');
    rep.claims.forEach((c) => out.push(`| ${c.sectionId || ''} | ${esc(c.claim)} | **${c.status}** | ${esc(c.evidence)} ${(c.sourceIds || []).join(' ')} |`));
    out.push('', '## Source assessment', '', '| Source | Reliability | Relevance | Note |', '|---|---|---|---|');
    rep.sourceAssessment.forEach((s) => out.push(`| ${s.sourceId} | ${s.reliability} | ${s.relevance} | ${esc(s.note)} |`));
    out.push('', '## Link checks', '', ...rep.linkChecks.map((l) => `- ${l.status.toUpperCase()} (${l.code ?? l.error}) ${l.url}`));
    if (rep.independentEvidence?.length) out.push('', '## Independent verification searches', '', ...rep.independentEvidence.map((e) => `- "${e.query}" -> ${e.urls.join(', ') || e.error || 'no results'}`));
    if (rep.inconsistencies.length) out.push('', '## Inconsistencies', '', ...rep.inconsistencies.map((x) => `- ${x}`));
  } else {
    out.push(`## Alignment with learning objective (${rep.alignment.score}/5)`, '', '| Objective part | Coverage | Taught in | Assessed by | Note |', '|---|---|---|---|---|');
    (rep.alignment.objectiveParts || []).forEach((p) => out.push(`| ${esc(p.part)} | **${p.coverage}** | ${p.taughtIn || ''} | ${p.assessedBy || ''} | ${esc(p.note)} |`));
    out.push('', '## Dimension scores', '', '| Dimension | Score | Note |', '|---|---|---|');
    rep.dimensions.forEach((d) => out.push(`| ${d.name} | ${d.score}/5 | ${esc(d.note)} |`));
  }
  if (rep.gaps.length) out.push('', '## Gaps', '', ...rep.gaps.map((x) => `- ${x}`));
  out.push('', '## Issues and suggested improvements', '');
  if (!rep.issues.length) out.push('_No issues found._');
  rep.issues.forEach((i) => {
    out.push(`### ${ICON[i.severity] || ''} ${i.id} - ${i.severity.toUpperCase()} (${i.type})${i.sectionId ? ` in \`${i.sectionId}\`` : ''}  _[${i.status}]_`, '', `**Problem:** ${i.problem}`, '', `**Evidence:** ${i.evidence}`, '', `**Suggestion:** ${i.suggestion}`, '');
    if (i.patch) out.push(`**Proposed change (${i.patch.op}):**`, '', ...(i.patch.find ? ['> Before: ' + i.patch.find.replace(/\n/g, ' ')] : []), '> After: ' + i.patch.replace.replace(/\n/g, ' '), '');
  });
  return out.join('\n');
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
