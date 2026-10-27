import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './pool.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

/** الهيكل الأساسي (idempotent): يُنشأ إن لم يكن موجوداً ولا يغيّر البيانات */
export async function initBaseSchema() {
  await pool.query(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
}

/** الهيكل الأساسي ثم الترحيلات المعلّقة (مع نسخة احتياطية). يمكن تعطيل الترحيل التلقائي بـ AUTO_MIGRATE=0 */
export async function initSchema() {
  await initBaseSchema();
  if (process.env.AUTO_MIGRATE !== '0') {
    const { runMigrations } = await import('./migrate.js');
    await runMigrations();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await initSchema();
  console.log('تم تهيئة قاعدة البيانات');
  await pool.end();
}
