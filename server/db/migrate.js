// مشغّل الترحيل: يطبّق ملفات server/db/migrations (بالترتيب، مرة واحدة لكل ملف) بعد أخذ نسخة احتياطية.
// كل ترحيل يُنفَّذ داخل معاملة واحدة؛ وكلها إضافية وقابلة للتكرار ولا تحذف جداول أو بيانات أصلية.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { pool } from './pool.js';
import { backupDatabase } from './backup.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations({ backup = process.env.SKIP_BACKUP !== '1' } = {}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), notes TEXT)`);
  const done = new Set((await pool.query('SELECT id FROM schema_migrations')).rows.map(r => r.id));
  const files = fs.readdirSync(dir).filter(f => /^\d+_.+\.(sql|js)$/.test(f)).sort();
  const pending = files.filter(f => !done.has(f));
  if (!pending.length) return [];

  // قاعدة جديدة بلا بيانات لا تحتاج نسخة احتياطية
  const hasData = (await pool.query("SELECT to_regclass('public.employees') IS NOT NULL AS e")).rows[0].e
    && (await pool.query('SELECT (SELECT count(*) FROM employees) + (SELECT count(*) FROM people) AS n')).rows[0].n > 0;
  let bk = null;
  if (backup && hasData) {
    bk = await backupDatabase(pool, 'before-migration');
    console.log(`نسخة احتياطية قبل الترحيل (${bk.kind}): ${bk.file}`);
  }
  const applied = [];
  for (const f of pending) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      let notes = null;
      if (f.endsWith('.sql')) await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      else notes = (await (await import(pathToFileURL(path.join(dir, f)).href)).up(c)) ?? null;
      await c.query('INSERT INTO schema_migrations(id, notes) VALUES ($1,$2)', [f, notes ? JSON.stringify(notes) : null]);
      await c.query('COMMIT');
      console.log(`طُبّق الترحيل ${f}`, notes ? JSON.stringify(notes) : '');
      applied.push(f);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      console.error(`فشل الترحيل ${f}: ${e.message}`);
      if (bk) console.error(`النسخة الاحتياطية السابقة: ${bk.file}`);
      throw e;
    } finally { c.release(); }
  }
  return applied;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { initBaseSchema } = await import('./init.js');
  await initBaseSchema();
  const r = await runMigrations();
  console.log(r.length ? `تم تطبيق ${r.length} ترحيل` : 'لا توجد ترحيلات جديدة');
  await pool.end();
}
