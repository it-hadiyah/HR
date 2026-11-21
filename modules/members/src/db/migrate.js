'use strict';
// ترحيلات وحدة الأعضاء: داخل معاملة لكل ملف، قفل استشاري، فحص checksum، دون أي ترحيل هدّام.
// يتطلب أن تكون المنصة قد هيّأت مخططها (users و apps في public) قبل التشغيل.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('./pool');

async function migrate(log = console.log) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query('CREATE SCHEMA IF NOT EXISTS members');
    await client.query(`CREATE TABLE IF NOT EXISTS members.schema_migrations (
      filename TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const applied = new Map((await client.query('SELECT filename, checksum FROM members.schema_migrations')).rows.map((r) => [r.filename, r.checksum]));
    let count = 0;
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      const sum = crypto.createHash('sha256').update(sql).digest('hex');
      if (applied.has(f)) {
        if (applied.get(f) !== sum) throw new Error(`تم تعديل ترحيل مطبّق مسبقًا: ${f}`);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO members.schema_migrations (filename, checksum) VALUES ($1,$2)', [f, sum]);
        await client.query('COMMIT');
        log(`members: applied ${f}`);
        count++;
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`فشل ترحيل الأعضاء ${f}: ${e.message}`);
      }
    }
    return count;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}
module.exports = { migrate };
