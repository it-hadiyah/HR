import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './pool.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

export async function initSchema() {
  await pool.query(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await initSchema();
  console.log('تم تهيئة قاعدة البيانات');
  await pool.end();
}
