'use strict';
const pg = require('pg');
const config = require('../config');

// محلّلات أنواع خاصة بهذا الـ Pool فقط: HR يضبط NUMERIC كـ float عالميًا، أما المبالغ هنا فنصوص عشرية دقيقة.
const types = {
  getTypeParser(oid, format) {
    if (oid === 1700 || oid === 1082) return (v) => v;      // NUMERIC و DATE كنص
    if (oid === 20) return (v) => Number(v);                 // BIGINT
    return pg.types.getTypeParser(oid, format);
  },
};

// جداول الوحدة في المخطط members، ومعه public للوصول إلى users و apps المشتركين
const pool = new pg.Pool({ connectionString: config.databaseUrl(), max: 8, options: '-c search_path=members,public', types });
pool.on('error', (e) => console.error('members pg pool error:', e.message));

/** تنفيذ دالة داخل معاملة. عند أي خطأ يتم التراجع. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'Asia/Riyadh'");
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, tx, query: (t, p) => pool.query(t, p) };
