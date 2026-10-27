import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName } from '../server/lib/people.js';

test('مطابقة الأسماء تتجاهل الألقاب والهمزات والتشكيل', () => {
  assert.equal(normalizeName('م. تركي الحتيرشي'), normalizeName('تركي الحتيرشي'));
  assert.equal(normalizeName('معالي الدكتور حاتم المرزوقي'), normalizeName('حاتم  المرزوقي'));
  assert.equal(normalizeName('محمد إبراهيم كشك'), normalizeName('محمد ابراهيم كشك'));
});

// اختبار الذهاب والإياب لبيانات البوابة؛ يحتاج قاعدة بيانات بعد `npm run setup` (يُتخطى إن لم تتوفر)
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/db/legacy');
let pool, exportFile, FILES;
try {
  ({ pool } = await import('../server/db/pool.js'));
  ({ exportFile, FILES } = await import('../server/lib/portalData.js'));
  await pool.query('SELECT 1 FROM people LIMIT 1');
} catch { pool = null; }

for (const f of ['orgStructure.json', 'linksLibrary.json', 'PoliciesLibrary.json', 'locations.json', 'home.json']) {
  test(`بيانات البوابة في PostgreSQL تطابق ${f} الأصلي`, { skip: !pool && 'لا توجد قاعدة بيانات مهيأة' }, async () => {
    const orig = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, ''));
    const got = JSON.parse(JSON.stringify(await exportFile(pool, f)));
    assert.deepEqual(got, orig);
  });
}
test.after(() => pool?.end());
