import '../lib/env.js';
// ينشئ قاعدة البيانات (والمستخدم) إن لم تكن موجودة، باستخدام حساب مدير PostgreSQL.
// الاستخدام: PG_ADMIN_URL=postgres://postgres:كلمة_المرور@localhost:5432/postgres DATABASE_URL=postgres://hadiyah:...@localhost:5432/hadiyah npm run db:create
import pg from 'pg';

const target = new URL(process.env.DATABASE_URL || 'postgres://hadiyah:hadiyah@localhost:5432/hadiyah');
const dbName = decodeURIComponent(target.pathname.slice(1));
const user = decodeURIComponent(target.username);
const pass = decodeURIComponent(target.password);
const admin = new pg.Client({ connectionString: process.env.PG_ADMIN_URL || `postgres://postgres@${target.host}/postgres` });
const ident = s => `"${s.replace(/"/g, '""')}"`;
const lit = s => `'${s.replace(/'/g, "''")}'`;

await admin.connect();
if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user])).rows.length) {
  await admin.query(`CREATE ROLE ${ident(user)} LOGIN PASSWORD ${lit(pass)}`);
  console.log(`أُنشئ المستخدم ${user}`);
}
if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])).rows.length) {
  await admin.query(`CREATE DATABASE ${ident(dbName)} OWNER ${ident(user)} ENCODING 'UTF8'`);
  console.log(`أُنشئت قاعدة البيانات ${dbName}`);
} else console.log(`قاعدة البيانات ${dbName} موجودة مسبقاً`);
await admin.end();
