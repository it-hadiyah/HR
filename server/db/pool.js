import '../lib/env.js';
import pg from 'pg';

// أرقام NUMERIC و DATE تُرجَع كأرقام/نصوص بسيطة بدل كائنات Date لتفادي مشاكل المنطقة الزمنية
pg.types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(1082, v => v);
pg.types.setTypeParser(20, v => parseInt(v, 10));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://hr:hr@localhost:5432/hr',
});

export const q = (text, params) => pool.query(text, params);
