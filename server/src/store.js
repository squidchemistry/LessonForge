// Lesson storage with two interchangeable backends behind one interface:
//   - PostgreSQL (e.g. free Neon) when DATABASE_URL is set  -> data survives restarts/redeploys
//   - JSON files in server/data/lessons otherwise            -> zero-setup local development
// Each lesson is one JSON document. All writes go through update(), which re-reads the *latest*
// record and serialises per lesson (row lock in Postgres, in-process queue for files), so a
// long-running AI step can never overwrite instructor edits saved in the meantime.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const STEPS = ['research', 'generate', 'qc1', 'qc2'];
export const isValidId = (id) => typeof id === 'string' && /^[a-f0-9]{12}$/.test(id);
export const storageKind = process.env.DATABASE_URL ? 'postgres' : 'files';

const notFound = () => Object.assign(new Error('Lesson not found'), { status: 404 });
const summary = (r) => ({ id: r.id, title: r.title, objective: r.objective, updatedAt: r.updatedAt, createdAt: r.createdAt, hasLesson: !!r.lesson });

// ---------------------------------------------------------------- file backend
function fileBackend() {
  const DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR, 'lessons')
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/lessons');
  const file = (id) => path.join(DIR, `${id}.json`);
  const queues = new Map();

  const read = async (id) => {
    try { return JSON.parse(await fs.readFile(file(id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  };
  const write = async (rec) => {
    const tmp = `${file(rec.id)}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(rec, null, 2));
    await fs.rename(tmp, file(rec.id));
  };
  return {
    init: () => fs.mkdir(DIR, { recursive: true }),
    get: read,
    insert: write,
    update(id, fn) {
      const prev = queues.get(id) || Promise.resolve();
      const next = prev.catch(() => {}).then(async () => {
        const rec = await read(id);
        if (!rec) throw notFound();
        const out = (await fn(rec)) ?? rec;
        rec.updatedAt = new Date().toISOString();
        await write(rec);
        return out;
      });
      queues.set(id, next);
      return next;
    },
    async remove(id) { try { await fs.unlink(file(id)); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } },
    async list() {
      const out = [];
      for (const n of (await fs.readdir(DIR)).filter((x) => x.endsWith('.json'))) {
        try { out.push(summary(JSON.parse(await fs.readFile(path.join(DIR, n), 'utf8')))); } catch { /* skip corrupt file */ }
      }
      return out;
    },
    ids: async () => (await fs.readdir(DIR)).filter((n) => n.endsWith('.json')).map((n) => n.replace('.json', '')),
  };
}

// ---------------------------------------------------------------- postgres backend
async function pgBackend() {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000, // Neon pauses idle compute; don't hold dead sockets
    connectionTimeoutMillis: 20_000, // allow for a cold start
    ...(process.env.PGSSL === 'disable' ? {} : /sslmode=|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? {} : { ssl: { rejectUnauthorized: false } }),
  });
  pool.on('error', (e) => console.error('Postgres pool error:', e.message)); // idle clients can be dropped by the server
  return {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS lessons (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    },
    async get(id) {
      const { rows } = await pool.query('SELECT data FROM lessons WHERE id = $1', [id]);
      return rows[0]?.data ?? null;
    },
    async insert(rec) {
      await pool.query('INSERT INTO lessons (id, data) VALUES ($1, $2)', [rec.id, JSON.stringify(rec)]);
    },
    async update(id, fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Row lock: concurrent updates to the same lesson wait for each other.
        const { rows } = await client.query('SELECT data FROM lessons WHERE id = $1 FOR UPDATE', [id]);
        if (!rows[0]) throw notFound();
        const rec = rows[0].data;
        const out = (await fn(rec)) ?? rec;
        rec.updatedAt = new Date().toISOString();
        await client.query('UPDATE lessons SET data = $2, updated_at = now() WHERE id = $1', [id, JSON.stringify(rec)]);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async remove(id) {
      const { rowCount } = await pool.query('DELETE FROM lessons WHERE id = $1', [id]);
      return rowCount > 0;
    },
    async list() {
      const { rows } = await pool.query(`SELECT id,
        data->>'title' AS title, data->>'objective' AS objective,
        data->>'updatedAt' AS "updatedAt", data->>'createdAt' AS "createdAt",
        jsonb_typeof(data->'lesson') = 'object' AS "hasLesson"
        FROM lessons`);
      return rows;
    },
    ids: async () => (await pool.query('SELECT id FROM lessons')).rows.map((r) => r.id),
    close: () => pool.end(),
  };
}

const backend = storageKind === 'postgres' ? await pgBackend() : fileBackend();
await backend.init();
console.log(`Storage: ${storageKind}`);

// ---------------------------------------------------------------- public API
export async function getLesson(id) {
  if (!isValidId(id)) return null;
  return backend.get(id);
}

export const update = (id, fn) => (isValidId(id) ? backend.update(id, fn) : Promise.reject(notFound()));

export async function createLesson({ title, objective }) {
  const id = crypto.randomBytes(6).toString('hex');
  const idle = () => ({ status: 'idle', error: null, startedAt: null, finishedAt: null });
  const rec = {
    id, title, objective,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    steps: Object.fromEntries(STEPS.map((s) => [s, idle()])),
    research: null, lesson: null, version: 0, versions: [], qc1: null, qc2: null,
  };
  await backend.insert(rec);
  return rec;
}

export async function deleteLesson(id) {
  return isValidId(id) ? backend.remove(id) : false;
}

export async function listLessons() {
  return (await backend.list()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function addVersion(rec, lesson, label) {
  const v = (rec.versions.at(-1)?.v ?? 0) + 1;
  rec.versions.push({ v, at: new Date().toISOString(), label, lesson });
  rec.lesson = lesson;
  rec.version = v;
  return v;
}

// A crash/restart mid-step must not leave steps "running" forever (free hosts sleep and restart often).
export async function recoverInterruptedSteps() {
  for (const id of await backend.ids()) {
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
