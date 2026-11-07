import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLesson, fixTiming, applyPatch, splitCitations, citedIds } from '../src/lesson.js';

const sources = [
  { id: 'S1', type: 'web', title: 'MDN', url: 'https://developer.mozilla.org/x', domain: 'developer.mozilla.org' },
  { id: 'S2', type: 'video', title: 'Vid', url: 'https://www.youtube.com/watch?v=abc', videoId: 'abc', channel: 'Ch', minutes: 5 },
  { id: 'S3', type: 'book', title: 'Book', url: 'https://openlibrary.org/works/1', domain: 'openlibrary.org' },
];
const base = (over = {}) => ({
  title: 'T', objective: 'O', summary: 's', learningOutcomes: ['a'],
  sections: [{ id: 'sec-1', heading: 'H', kind: 'concept', minutes: 45, content: 'Fact [S1].' }],
  quiz: [], videos: [], ...over,
});

test('splitCitations expands multi-citations', () => {
  assert.equal(splitCitations('x [S1, S2] y [S3]'), 'x [S1][S2] y [S3]');
  assert.deepEqual(citedIds(splitCitations('[S1, S2]')), ['S1', 'S2']);
});

test('normalizeLesson strips unknown citations and builds references from what is cited', () => {
  const { lesson, warnings } = normalizeLesson(base({ sections: [{ id: 'a', heading: 'H', kind: 'concept', minutes: 45, content: 'A [S1][S99] B [S1, S3]' }] }), sources);
  assert.equal(lesson.sections[0].content, 'A [S1] B [S1][S3]');
  assert.deepEqual(lesson.references.map((r) => r.id), ['S1', 'S3']);
  assert.ok(warnings.some((w) => w.includes('S99')));
});

test('normalizeLesson only accepts real video sources (no invented URLs)', () => {
  const { lesson } = normalizeLesson(base({ videos: [{ sourceId: 'S2', why: 'w' }, { sourceId: 'S1', why: 'not a video' }, { sourceId: 'S42', why: 'fake' }] }), sources);
  assert.deepEqual(lesson.videos.map((v) => v.sourceId), ['S2']);
  assert.equal(lesson.videos[0].url, 'https://www.youtube.com/watch?v=abc');
});

test('fixTiming rescales to exactly 45 minutes', () => {
  const l = { sections: [3, 12, 12, 8, 8, 5, 3].map((m, i) => ({ id: `s${i}`, minutes: m, content: '' })) };
  assert.ok(fixTiming(l));
  assert.equal(l.sections.reduce((a, s) => a + s.minutes, 0), 45);
  assert.equal(fixTiming(l), null);
});

test('applyPatch replace/append and refuses stale patches', () => {
  const l = { sections: [{ id: 'sec-1', content: 'GET is safe. POST is idempotent.' }] };
  applyPatch(l, { op: 'replace', sectionId: 'sec-1', find: 'POST is idempotent.', replace: 'POST is not idempotent.' });
  assert.equal(l.sections[0].content, 'GET is safe. POST is not idempotent.');
  applyPatch(l, { op: 'append', sectionId: 'sec-1', replace: 'Extra.' });
  assert.ok(l.sections[0].content.endsWith('\n\nExtra.'));
  assert.throws(() => applyPatch(l, { op: 'replace', sectionId: 'sec-1', find: 'gone text', replace: 'x' }), /not found/);
  assert.throws(() => applyPatch(l, { op: null }), /no automatic fix/);
  assert.throws(() => applyPatch(l, { op: 'append', sectionId: 'nope', replace: 'x' }), /no longer exists/);
});

test('replace patch uses a function replacer ($ in replacement text is literal)', () => {
  const l = { sections: [{ id: 's', content: 'price is X' }] };
  applyPatch(l, { op: 'replace', sectionId: 's', find: 'X', replace: '$& $1' });
  assert.equal(l.sections[0].content, 'price is $& $1');
});
