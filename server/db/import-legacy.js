// يستورد بيانات المشاريع القديمة إلى قاعدة البيانات الموحّدة:
//   - بوابة الموظفين (ملفات data/*.json في المستودع cluade-ai) → employees (السجل المركزي), org_units, links, policies, locations, portal_docs
//   - موظفو الإجازات الموجودون مسبقاً يُربطون بالاسم بدل إنشاء سجلات مكررة
// آمن للتكرار: لا يستورد إن كان الدليل غير فارغ إلا مع --force (الذي يستبدل بيانات البوابة).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, q } from './pool.js';
import { initSchema } from './init.js';
import { FILES, saveFile, saveDoc } from '../lib/portalData.js';

const dir = process.env.LEGACY_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), 'legacy');
const force = process.argv.includes('--force');

await initSchema();
if (!(await q("SELECT 1 FROM org_units WHERE unit_type = 'org' LIMIT 1")).rows.length) {
  console.error('لا توجد وحدة جذر؛ شغّل npm run db:seed أولاً.'); process.exit(1);
}
const existing = (await q('SELECT count(*)::int AS n FROM employees WHERE extension IS NOT NULL')).rows[0].n;
if (existing && !force) { console.log(`دليل الأشخاص يحوي ${existing} سجلاً؛ لا استيراد (استخدم --force للاستبدال).`); await pool.end(); process.exit(0); }

const c = await pool.connect();
try {
  await c.query('BEGIN');
  for (const f of FILES) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) { console.log(`تخطّي ${f} (غير موجود)`); continue; }
    await saveFile(c, f, JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')), 'import');
    console.log(`استُورد ${f}`);
  }
  const brand = path.join(dir, 'brand.json');
  if (fs.existsSync(brand)) { await saveDoc(c, 'brand', JSON.parse(fs.readFileSync(brand, 'utf8').replace(/^﻿/, '')), 'import'); console.log('استُورد brand.json'); }
  await c.query('COMMIT');
} catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }

await pool.end();
