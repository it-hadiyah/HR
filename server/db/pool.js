import '../lib/env.js';
import pg from 'pg';

// أرقام NUMERIC و DATE تُرجَع كأرقام/نصوص بسيطة بدل كائنات Date لتفادي مشاكل المنطقة الزمنية
pg.types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(1082, v => v);
pg.types.setTypeParser(20, v => parseInt(v, 10));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://hadiyah:hadiyah@localhost:5432/hadiyah',
  application_name: 'hadiyah-platform',   // يميّز عمليات التطبيق عن الاتصالات المباشرة بالقاعدة في db_change_log
});

export const q = (text, params) => pool.query(text, params);

/** ينفّذ fn داخل معاملة واحدة (BEGIN/COMMIT/ROLLBACK) ويمرّر لها العميل */
export async function withTx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
