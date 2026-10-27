import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName } from '../server/lib/text.js';
import { createTestDb } from './helpers.js';

test('مطابقة الأسماء تتجاهل الألقاب والهمزات والتشكيل', () => {
  assert.equal(normalizeName('م. تركي الحتيرشي'), normalizeName('تركي الحتيرشي'));
  assert.equal(normalizeName('معالي الدكتور حاتم المرزوقي'), normalizeName('حاتم  المرزوقي'));
  assert.equal(normalizeName('محمد إبراهيم كشك'), normalizeName('محمد ابراهيم كشك'));
});

// بيانات بوابة الموظفين القديمة تُستورد إلى الجداول ثم تُصدَّر بالصيغة نفسها، فتعمل صفحات البوابة دون تغيير
const legacy = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/db/legacy');
const db = await createTestDb('portal');
const skip = !db && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => { await db?.drop(); });

test('استيراد بيانات البوابة القديمة ثم تصديرها يطابق الأصل (الهيكل، الموظفون، الروابط، السياسات، المواقع، الرئيسية)', { skip }, async () => {
  process.env.DATABASE_URL = db.url; process.env.SKIP_BACKUP = '1';
  const { pool, q, withTx } = await import('../server/db/pool.js');
  const { initSchema } = await import('../server/db/init.js');
  const { FILES, saveFile, saveDoc, exportFile } = await import('../server/lib/portalData.js');
  await initSchema();
  await q("INSERT INTO org_units(unit_type, name) VALUES ('org','المنشأة')");
  const read = f => JSON.parse(fs.readFileSync(path.join(legacy, f), 'utf8').replace(/^﻿/, ''));
  await withTx(async c => {
    for (const f of FILES) await saveFile(c, f, read(f), 'test');
    await saveDoc(c, 'brand', read('brand.json'), 'test');
  });
  for (const f of [...FILES, 'brand.json']) {
    const orig = read(f);
    const got = JSON.parse(JSON.stringify(await exportFile(pool, f)));
    if (f === 'employeeInfo.json') for (const e of orig) e.Name = e.Name.trim();    // الأسماء تُقصّ من المسافات الزائدة
    assert.deepEqual(got, orig, f);
  }
  // إعادة الحفظ لا تغيّر شيئاً ولا ترفع إصدارات السجلات دون داعٍ
  const v = (await q('SELECT sum(version)::int AS s FROM employees')).rows[0].s;
  await withTx(async c => saveFile(c, 'employeeInfo.json', read('employeeInfo.json'), 'test'));
  assert.equal((await q('SELECT sum(version)::int AS s FROM employees')).rows[0].s, v);
  await pool.end();
});
