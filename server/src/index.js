import './env.js'; // must stay first: loads server/.env before other modules read process.env
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import archiver from 'archiver';
import { createLesson, getLesson, listLessons, deleteLesson, update, addVersion, recoverInterruptedSteps } from './store.js';
import { startStep, STEP_NAMES } from './pipeline.js';
import { normalizeLesson, applyPatch } from './lesson.js';
import { lessonMd, referencesMd, qcMd } from './markdown.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Optional login (HTTP Basic: APP_USERNAME, default "admin", plus APP_PASSWORD) so a public deployment
// can't be used by strangers to burn the free-tier API quotas. Disabled when APP_PASSWORD is unset (local dev).
const APP_PASSWORD = process.env.APP_PASSWORD;
const APP_USERNAME = process.env.APP_USERNAME || 'admin';
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next(); // host health checks
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && token) {
      const decoded = Buffer.from(token, 'base64').toString();
      const i = decoded.indexOf(':');
      const userOk = safeEqual(decoded.slice(0, i), APP_USERNAME); // evaluate both: no early exit on a wrong username
      const passOk = safeEqual(decoded.slice(i + 1), APP_PASSWORD);
      if (i >= 0 && userOk && passOk) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="LessonForge"').status(401).send('Authentication required');
  });
}

const httpError = (status, message) => Object.assign(new Error(message), { status });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const need = async (id) => (await getLesson(id)) || (() => { throw httpError(404, 'Lesson not found'); })();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, keys: { gemini: !!process.env.GEMINI_API_KEY, tavily: !!process.env.TAVILY_API_KEY, youtube: !!process.env.YOUTUBE_API_KEY } });
});

app.get('/api/lessons', wrap(async (_req, res) => res.json(await listLessons())));

app.post('/api/lessons', wrap(async (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  const objective = String(req.body?.objective ?? '').trim();
  if (!title) throw httpError(400, 'Lesson title is required.');
  if (!objective) throw httpError(400, 'Learning objective is required.');
  if (title.length < 3 || title.length > 150) throw httpError(400, 'Lesson title must be 3-150 characters.');
  if (objective.length < 10 || objective.length > 600) throw httpError(400, 'Learning objective must be 10-600 characters.');
  res.status(201).json(await createLesson({ title, objective }));
}));

app.get('/api/lessons/:id', wrap(async (req, res) => {
  const rec = await need(req.params.id);
  res.json({ ...rec, versions: rec.versions.map(({ v, at, label }) => ({ v, at, label })) });
}));

app.delete('/api/lessons/:id', wrap(async (req, res) => {
  if (!(await deleteLesson(req.params.id))) throw httpError(404, 'Lesson not found');
  res.json({ ok: true });
}));

// Steps run in the background: this returns 202 immediately with the step marked "running";
// clients poll GET /api/lessons/:id. Add ?wait=1 to block until the step finishes (CLI scripts/tests).
app.post('/api/lessons/:id/steps/:step', wrap(async (req, res) => {
  if (!STEP_NAMES.includes(req.params.step)) throw httpError(400, 'Unknown step');
  const { done } = await startStep(req.params.id, req.params.step);
  if (req.query.wait) {
    const result = await done;
    if (!result.ok) throw Object.assign(httpError(502, result.error), { stepFailed: true });
  }
  const rec = await need(req.params.id);
  res.status(req.query.wait ? 200 : 202).json({ ...rec, versions: rec.versions.map(({ v, at, label }) => ({ v, at, label })) });
}));

// Instructor edit -> saved as a new version (history is never overwritten).
app.put('/api/lessons/:id/lesson', wrap(async (req, res) => {
  const incoming = req.body?.lesson;
  if (!incoming || !Array.isArray(incoming.sections) || !incoming.sections.length) throw httpError(400, 'Lesson must contain at least one section.');
  if (!String(incoming.title || '').trim()) throw httpError(400, 'Lesson title cannot be empty.');
  const label = String(req.body?.label || 'Instructor edit').slice(0, 80);
  const rec = await update(req.params.id, (r) => {
    const { lesson } = normalizeLesson(incoming, r.research?.sources || []);
    addVersion(r, lesson, label);
  });
  res.json({ ...rec, versions: rec.versions.map(({ v, at, label }) => ({ v, at, label })) });
}));

app.post('/api/lessons/:id/versions/:v/restore', wrap(async (req, res) => {
  const rec = await update(req.params.id, (r) => {
    const ver = r.versions.find((x) => x.v === Number(req.params.v));
    if (!ver) throw httpError(404, 'Version not found');
    addVersion(r, structuredClone(ver.lesson), `Restored v${ver.v}`);
  });
  res.json({ ...rec, versions: rec.versions.map(({ v, at, label }) => ({ v, at, label })) });
}));

app.get('/api/lessons/:id/versions/:v', wrap(async (req, res) => {
  const rec = await need(req.params.id);
  const ver = rec.versions.find((x) => x.v === Number(req.params.v));
  if (!ver) throw httpError(404, 'Version not found');
  res.json(ver);
}));

// Review a QC recommendation: apply its patch, dismiss it, or reopen it.
app.post('/api/lessons/:id/qc/:layer/issues/:issueId', wrap(async (req, res) => {
  const { layer, issueId } = req.params;
  const action = req.body?.action;
  if (!['qc1', 'qc2'].includes(layer)) throw httpError(400, 'Unknown QC layer');
  if (!['apply', 'dismiss', 'reopen'].includes(action)) throw httpError(400, 'Unknown action');
  const rec = await update(req.params.id, (r) => {
    const issue = r[layer]?.issues.find((i) => i.id === issueId);
    if (!issue) throw httpError(404, 'Issue not found');
    if (action === 'apply') {
      if (issue.status === 'applied') throw httpError(409, 'Already applied.');
      const copy = structuredClone(r.lesson);
      try { applyPatch(copy, issue.patch); } catch (e) { throw httpError(422, e.message); }
      const { lesson } = normalizeLesson(copy, r.research?.sources || []);
      addVersion(r, lesson, `Applied ${issueId} (${layer.toUpperCase()})`);
      issue.status = 'applied';
    } else {
      issue.status = action === 'dismiss' ? 'dismissed' : 'open';
    }
  });
  res.json({ ...rec, versions: rec.versions.map(({ v, at, label }) => ({ v, at, label })) });
}));

const FILES = {
  'lesson.md': (r) => lessonMd(r),
  'references.md': (r) => referencesMd(r),
  'qc1-factual-report.md': (r) => qcMd(r.qc1, 'QC Layer 1'),
  'qc2-instructional-report.md': (r) => qcMd(r.qc2, 'QC Layer 2'),
};

app.get('/api/lessons/:id/export/:name', wrap(async (req, res) => {
  const rec = await need(req.params.id);
  if (!rec.lesson) throw httpError(409, 'Nothing to export yet: generate a lesson first.');
  const gen = FILES[req.params.name];
  if (!gen) throw httpError(404, 'Unknown export file');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}"`);
  res.send(gen(rec));
}));

app.get('/api/lessons/:id/export.zip', wrap(async (req, res) => {
  const rec = await need(req.params.id);
  if (!rec.lesson) throw httpError(409, 'Nothing to export yet: generate a lesson first.');
  const slug = rec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'lesson';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.zip"`);
  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.on('error', (e) => res.destroy(e));
  zip.pipe(res);
  for (const [name, gen] of Object.entries(FILES)) zip.append(gen(rec), { name });
  zip.append(JSON.stringify({ lesson: rec.lesson, research: rec.research?.sources ?? [], qc1: rec.qc1, qc2: rec.qc2 }, null, 2), { name: 'lesson-data.json' });
  await zip.finalize();
}));

app.use('/api', (_req, _res, next) => next(httpError(404, 'Not found')));

// In production the built React app is served by this same process (one free-tier service, no CORS).
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal error', step: !!err.stepFailed });
});

const port = Number(process.env.PORT) || 4000;
await recoverInterruptedSteps();
app.listen(port, () => console.log(`LessonForge API on http://localhost:${port}`));
