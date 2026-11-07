// Lesson data model helpers: normalisation, reference building, patching, stats.
export const TOTAL_MINUTES = 45;
export const KINDS = ['hook', 'concept', 'example', 'activity', 'check', 'wrap'];
const CITE = /\[(S\d+)\]/g;

// Models often write "[S7, S8]"; split into "[S7][S8]" so every downstream consumer sees single ids.
const MULTI = /\[(S\d+(?:\s*[,;]\s*S\d+)+)\]/g;
export const splitCitations = (t) => String(t ?? '').replace(MULTI, (_, g) => g.split(/\s*[,;]\s*/).map((x) => `[${x}]`).join(''));

export function citedIds(text) {
  return [...String(text || '').matchAll(CITE)].map((m) => m[1]);
}

export function wordCount(text) {
  return (String(text || '').match(/\S+/g) || []).length;
}

/** Rebuild references from what the lesson actually cites; strip citations to unknown sources. */
export function normalizeLesson(input, sources = []) {
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  const warnings = [];
  const l = {
    title: String(input.title || '').trim(),
    objective: String(input.objective || '').trim(),
    summary: String(input.summary || '').trim(),
    learningOutcomes: (input.learningOutcomes || []).map(String).filter(Boolean),
    sections: [],
    quiz: [],
    videos: [],
    references: [],
  };
  (input.sections || []).forEach((s, i) => {
    let content = splitCitations(s.content);
    content = content.replace(CITE, (m, id) => {
      if (byId[id]) return m;
      warnings.push(`Removed citation to unknown source ${id}.`);
      return '';
    });
    const minutes = Math.max(0, Math.round(Number(s.minutes) || 0));
    l.sections.push({
      id: s.id || `sec-${i + 1}`,
      heading: String(s.heading || `Section ${i + 1}`),
      kind: KINDS.includes(s.kind) ? s.kind : 'concept',
      minutes,
      content,
    });
  });
  (input.quiz || []).forEach((q, i) => {
    const options = (q.options || []).map(String);
    l.quiz.push({
      id: q.id || `q${i + 1}`,
      question: String(q.question || ''),
      options,
      answerIndex: Math.min(Math.max(0, Number(q.answerIndex) || 0), Math.max(0, options.length - 1)),
      explanation: splitCitations(q.explanation),
    });
  });
  const seenVid = new Set();
  (input.videos || []).forEach((v) => {
    const src = byId[v.sourceId];
    if (!src || src.type !== 'video' || seenVid.has(v.sourceId)) {
      if (!src || src.type !== 'video') warnings.push(`Dropped video with unknown source ${v.sourceId}.`);
      return;
    }
    seenVid.add(v.sourceId);
    l.videos.push({ sourceId: src.id, title: src.title, url: src.url, videoId: src.videoId, channel: src.channel, minutes: src.minutes, why: String(v.why || '') });
  });
  const used = new Set([
    ...l.sections.flatMap((s) => citedIds(s.content)),
    ...l.quiz.flatMap((q) => citedIds(q.explanation)),
    ...l.videos.map((v) => v.sourceId),
    ...((input.furtherReading || []).filter((id) => byId[id])),
  ]);
  l.furtherReading = (input.furtherReading || []).filter((id) => byId[id]);
  const order = (a, b) => Number(a.slice(1)) - Number(b.slice(1));
  l.references = [...used].sort(order).map((id) => {
    const s = byId[id];
    return { id, type: s.type, title: s.title, url: s.url, note: s.type === 'book' ? 'Further reading (metadata only)' : s.domain };
  });
  return { lesson: l, warnings };
}

/** Scale section minutes so they total exactly 45 (largest-remainder). */
export function fixTiming(lesson) {
  const sum = lesson.sections.reduce((a, s) => a + s.minutes, 0);
  if (sum === TOTAL_MINUTES || !lesson.sections.length) return null;
  const raw = lesson.sections.map((s) => (sum > 0 ? (s.minutes / sum) * TOTAL_MINUTES : TOTAL_MINUTES / lesson.sections.length));
  const floors = raw.map(Math.floor);
  let rem = TOTAL_MINUTES - floors.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - floors[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rem-- > 0) floors[i]++; });
  lesson.sections.forEach((s, i) => { s.minutes = floors[i]; });
  return `Section minutes summed to ${sum}; rescaled to ${TOTAL_MINUTES}.`;
}

export function stats(lesson) {
  const minutes = lesson.sections.reduce((a, s) => a + s.minutes, 0);
  const perSection = lesson.sections.map((s) => ({ id: s.id, heading: s.heading, kind: s.kind, minutes: s.minutes, words: wordCount(s.content) }));
  const readingWords = perSection.filter((s) => !['activity', 'check'].includes(s.kind)).reduce((a, s) => a + s.words, 0);
  const readingMinutes = Math.round((readingWords / 200) * 10) / 10; // ~200 wpm for technical text
  return { minutes, perSection, readingWords, readingMinutes, quizQuestions: lesson.quiz.length, videoMinutes: lesson.videos.reduce((a, v) => a + (v.minutes || 0), 0) };
}

export function lessonAsText(lesson) {
  const secs = lesson.sections.map((s) => `### [${s.id}] ${s.heading} (${s.kind}, ${s.minutes} min)\n${s.content}`).join('\n\n');
  const quiz = lesson.quiz.map((q, i) => `Q${i + 1}. ${q.question}\n${q.options.map((o, j) => `   ${'ABCD'[j]}. ${o}`).join('\n')}\n   Answer: ${'ABCD'[q.answerIndex]}. ${q.explanation}`).join('\n');
  return `# ${lesson.title}\nObjective: ${lesson.objective}\nSummary: ${lesson.summary}\nLearning outcomes:\n${lesson.learningOutcomes.map((o) => `- ${o}`).join('\n')}\n\n${secs}\n\n## Knowledge check\n${quiz}\n\n## Videos\n${lesson.videos.map((v) => `- [${v.sourceId}] ${v.title} (${v.channel}) - ${v.why}`).join('\n')}`;
}

/** Apply a QC patch to a lesson. Throws a user-readable error if it no longer applies. */
export function applyPatch(lesson, patch) {
  if (!patch || !patch.op) throw new Error('This recommendation has no automatic fix; edit the lesson manually.');
  const sec = lesson.sections.find((s) => s.id === patch.sectionId);
  if (!sec) throw new Error(`Section "${patch.sectionId}" no longer exists.`);
  if (patch.op === 'replace') {
    if (!patch.find || !sec.content.includes(patch.find)) {
      throw new Error('The text this fix targets was not found (it may already have been edited). Edit manually or dismiss.');
    }
    sec.content = sec.content.replace(patch.find, () => patch.replace ?? '');
  } else if (patch.op === 'append') {
    sec.content = `${sec.content.trimEnd()}\n\n${patch.replace ?? ''}`.trim();
  } else {
    throw new Error(`Unknown patch operation "${patch.op}".`);
  }
  return lesson;
}
