import { generateJSON } from './gemini.js';
import { sourcePackText } from './research.js';
import { normalizeLesson, fixTiming, KINDS } from './lesson.js';

const SYSTEM = `You are a senior instructional designer and technical educator writing a rigorous, engaging 45-minute lesson.

NON-NEGOTIABLE RULES
1. Ground every factual claim in the SOURCE PACK. Cite with the source id in square brackets right after the claim, e.g. "GET requests should be safe and idempotent [S2]". Never cite a source that is not in the pack. Never invent URLs, quotes, statistics or RFC numbers.
2. Paraphrase in your own words. Never copy more than 10 consecutive words from a source.
3. If the pack does not support something you need, either leave it out or state it as general illustrative context without a citation - do not present unsupported specifics as fact.
4. Books in the pack are metadata only: you may list them under furtherReading but must not cite them for factual claims.
5. Videos: choose 2-3 from the VIDEO candidates only, by their id, and say specifically why each helps. Prefer ones with a transcript you could verify.
6. Examples you write yourself (code, HTTP messages, scenarios) are fine and encouraged, but they must be technically correct.
7. Be accurate over impressive. Use precise terms. Address the learning objective explicitly and completely.
8. Output ONLY valid JSON matching the requested shape.`;

const STRUCTURE = [
  ['hook', 3, 'Hook / why this matters (real-world scenario, 100-150 words)'],
  ['concept', 10, 'Core concept 1 (AT LEAST 450 words of explanation, plus a small example and, where useful, a comparison table)'],
  ['concept', 10, 'Core concept 2 (AT LEAST 450 words of explanation, plus a small example and, where useful, a comparison table)'],
  ['example', 7, 'Worked end-to-end example with realistic code or messages (250-400 words)'],
  ['activity', 8, 'Hands-on activity learners can do (steps, expected result, 150-250 words)'],
  ['check', 5, 'Knowledge check intro (1-2 sentences; the quiz array holds the questions)'],
  ['wrap', 2, 'Wrap-up: key takeaways and common misconceptions (80-130 words)'],
];

export async function runGenerate({ title, objective, research }) {
  const sources = research.sources;
  const videoIds = sources.filter((s) => s.type === 'video').map((s) => s.id);
  const prompt = `LESSON TITLE: ${title}
LEARNING OBJECTIVE: ${objective}

Design a lesson that can be completed in exactly 45 minutes (reading, activity and knowledge check included) using this structure, in this order:
${STRUCTURE.map(([k, m, d], i) => `${i + 1}. kind="${k}", minutes=${m} - ${d}`).join('\n')}
(minutes must total 45). Cover every part of the learning objective. Use markdown inside "content" (headings with ###, lists, tables, fenced code blocks with a language).
The knowledge check must contain exactly 5 multiple-choice questions (4 options each, one correct, with an explanation) that test the objective, including at least one scenario-based question.

SOURCE PACK (the only citable material):
${sourcePackText(sources)}

VIDEO ids available: ${videoIds.length ? videoIds.join(', ') : '(none - return an empty videos array)'}

Return JSON:
{
  "summary": "2-3 sentence overview",
  "learningOutcomes": ["3-4 measurable outcomes, starting with action verbs"],
  "sections": [{"id":"sec-1","heading":"...","kind":"${KINDS.join('|')}","minutes":3,"content":"markdown with [S#] citations"}],
  "quiz": [{"question":"...","options":["...","...","...","..."],"answerIndex":0,"explanation":"why, with [S#] where factual"}],
  "videos": [{"sourceId":"S9","why":"specific reason this video supports the lesson"}],
  "furtherReading": ["S12"]
}`;
  const raw = await generateJSON({ system: SYSTEM, prompt, temperature: 0.5, maxTokens: 32000 });
  const { lesson, warnings } = normalizeLesson({ ...raw, title, objective }, sources);
  if (lesson.sections.length < 5) throw new Error('The model returned an incomplete lesson (too few sections). Retry.');
  if (lesson.quiz.length < 3) throw new Error('The model returned too few quiz questions. Retry.');
  const t = fixTiming(lesson);
  if (t) warnings.push(t);
  return { lesson, warnings };
}
