// One-off: copy lessons from local JSON files into the Postgres database (e.g. Neon).
//   DATABASE_URL="postgresql://..." node scripts/import-lessons.mjs [dir]
// Default dir: server/data/lessons. Safe to re-run (existing rows with the same id are overwritten).
import '../src/env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL first (your Neon connection string).'); process.exit(1); }
const dir = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/lessons'));

const pool = new pg.Pool({ connectionString: url, ...(/sslmode=|localhost|127\.0\.0\.1/.test(url) ? {} : { ssl: { rejectUnauthorized: false } }) });
await pool.query(`CREATE TABLE IF NOT EXISTS lessons (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);

let n = 0;
for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith('.json'))) {
  const rec = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
  if (!/^[a-f0-9]{12}$/.test(rec.id || '')) { console.log('skip (bad id):', f); continue; }
  await pool.query(
    'INSERT INTO lessons (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
    [rec.id, JSON.stringify(rec)],
  );
  console.log('imported', rec.id, '-', rec.title);
  n++;
}
console.log(`Done: ${n} lesson(s) imported from ${dir}`);
await pool.end();
