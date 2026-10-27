// أدوات اختبارات التكامل: قاعدة PostgreSQL مؤقتة لكل ملف اختبار، وخادم حقيقي على منفذ عشوائي، وعميل يحمل الكوكي.
// تُتخطى الاختبارات تلقائياً إن لم تتوفر قاعدة (اضبط PG_ADMIN_URL أو DATABASE_URL لمستخدم يستطيع إنشاء قواعد).
import pg from 'pg';

function adminUrl() {
  if (process.env.PG_ADMIN_URL) return process.env.PG_ADMIN_URL;
  if (process.env.DATABASE_URL) { const u = new URL(process.env.DATABASE_URL); u.pathname = '/postgres'; return u.toString(); }
  return null;
}

/** ينشئ قاعدة جديدة ويعيد { url, drop } أو null إن تعذّر الاتصال */
export async function createTestDb(prefix = 'hd_test') {
  const base = adminUrl();
  if (!base) return null;
  const name = `${prefix}_${process.pid}_${Date.now() % 100000}`;
  const admin = new pg.Client({ connectionString: base });
  try { await admin.connect(); } catch { return null; }
  await admin.query(`CREATE DATABASE "${name}"`);
  const u = new URL(base); u.pathname = '/' + name;
  return { url: u.toString(), name, drop: async () => {
    // ننتظر انتهاء اتصالات القاعدة طبيعياً قبل حذفها (تفادياً لسباق الإغلاق)
    for (let i = 0; i < 40; i++) {
      if (!(await admin.query('SELECT 1 FROM pg_stat_activity WHERE datname = $1', [name])).rows.length) break;
      await new Promise(r => setTimeout(r, 50));
    }
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end();
  } };
}

/** يهيّئ البيئة والتطبيق: يعيد { base, db, pool, svc, login, stop } */
export async function bootApp(prefix) {
  const db = await createTestDb(prefix);
  if (!db) return null;
  process.env.DATABASE_URL = db.url;
  process.env.JWT_SECRET = 'test-secret';
  process.env.SKIP_BACKUP = '1';
  const { pool, q } = await import('../server/db/pool.js');
  const { initSchema } = await import('../server/db/init.js');
  await initSchema();
  const { app } = await import('../server/index.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = await import('../server/services/users.js');
  const employees = await import('../server/services/employees.js');
  const org = await import('../server/services/org.js');
  const sys = { user: { id: null, username: 'test-setup' }, ip: '127.0.0.1' };

  const root = (await q("INSERT INTO org_units(unit_type, name) VALUES ('org','المنشأة') RETURNING id")).rows[0].id;
  const PASS = 'Passw0rd!test';
  const mkUser = (username, roles, extra = {}) => users.createUser({ username, password: PASS, roles, ...extra }, sys);

  function client() {
    let cookie = '';
    const call = async (method, path, body, headers = {}) => {
      const res = await fetch(base + path, { method, redirect: 'manual', headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* غير JSON */ }
      return { status: res.status, json, text, headers: res.headers };
    };
    return { get: p => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b), del: p => call('DELETE', p),
      login: async (username, password = PASS) => { const r = await call('POST', '/api/auth/login', { username, password }); return r; }, clear: () => { cookie = ''; } };
  }
  const as = async (username, password = PASS) => { const c = client(); const r = await c.login(username, password); if (r.status !== 200) throw new Error(`فشل دخول ${username}: ${r.status} ${r.text}`); return c; };

  return { base, db, pool, q, svc: { users, employees, org }, root, mkUser, client, as, PASS, sys,
    stop: async () => { await new Promise(r => server.close(r)); await pool.end(); await db.drop(); } };
}
