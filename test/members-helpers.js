import './members-env.js';
import bcrypt from 'bcryptjs';
import { pool as hrPool } from '../server/db/pool.js';
import { initSchema } from '../server/db/init.js';
import { signToken } from '../server/lib/auth.js';
import { app } from '../server/index.js';
import members from '../modules/members/src/index.js';
import dbm from '../modules/members/src/db/pool.js';
import normalize from '../modules/members/src/lib/normalize.js';
import exporter from '../modules/members/src/services/exporter.js';

export const pool = dbm.pool;
export const N = normalize;
let server, base;

/** إعادة بناء كاملة لقاعدة اختبار *_test: مخطط المنصة ثم مخطط الأعضاء */
export async function resetDb() {
  const name = new URL(process.env.DATABASE_URL).pathname.slice(1);
  if (!/_test$/.test(name)) throw new Error('resetDb مسموح فقط لقواعد *_test');
  await hrPool.query('DROP OWNED BY CURRENT_USER CASCADE');
  await initSchema();
  await members.init({ schedule: false });
}
export async function start() {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}
export async function stop() {
  server?.close();
  await exporter.closeBrowser();
  await dbm.pool.end();
  await hrPool.end();
}

// أدوار الاختبار (أسماء أدوار نظام الأعضاء) ← أدوار المنصة المربوطة بها افتراضيًا
const HR_ROLE = { admin: 'admin', membership: 'hr', finance: 'finance', viewer: 'executive' };
let seq = 0;
export async function mkUser(role, username = `${role}${++seq}`, hrRole = HR_ROLE[role] ?? role) {
  const password = 'Passw0rd-' + username;
  const r = await hrPool.query(`INSERT INTO users (username, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`, [username, 'مستخدم ' + username, await bcrypt.hash(password, 4), hrRole]);
  return { id: r.rows[0].id, username, password, role: hrRole };
}

/** عميل HTTP: الكوكي JWT الخاص بالمنصة + رمز CSRF للنظام. المسارات '/api/..' تُوجَّه إلى '/members/api/..' */
export class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, url, body, extraHeaders = {}) {
    const headers = { cookie: this.cookie, ...extraHeaders };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    if (this.csrf) headers['x-csrf-token'] = this.csrf;
    const res = await fetch(base + (url.startsWith('/api') ? '/members' + url : url), { method, headers, body: payload, redirect: 'manual' });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b ?? {}); }
  put(u, b) { return this.req('PUT', u, b ?? {}); }
  del(u) { return this.req('DELETE', u); }
  async login(u) {
    this.cookie = `token=${signToken({ id: u.id })}`;
    const me = await this.get('/api/auth/me');
    if (me.status !== 200) throw new Error('login failed ' + JSON.stringify(me.data));
    this.csrf = me.data.csrf;
    return this;
  }
}
export const today = () => N.todayRiyadh();
export const days = (n) => N.addDaysISO(today(), n);
