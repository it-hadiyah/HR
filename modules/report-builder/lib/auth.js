'use strict';
// المستخدمون هنا مرآة لمستخدمي المنصة الموحّدة، يحدّثها الغلاف (server/routes/reportBuilder.js) من قاعدة PostgreSQL.
// الدخول والأدوار والصلاحيات تُدار مركزياً؛ ويُحفظ هنا ما يخص منشئ التقارير فقط:
// أنواع التقارير المسموحة لكل مستخدم، والمعتمِدون، والإعدادات العامة (الأنواع الافتراضية والمساعد الذكي).
const store = require('./store');
const T = require('../public/shared/templates.js');
const TEMPLATE_IDS = T.TEMPLATES.map((t) => t.id);

const RANK = { employee: 0, manager: 1, admin: 2 };
const norm = (u) => String(u == null ? '' : u).trim().toLowerCase().replace(/^.*\\/, '').replace(/@.*$/, '');

let dir = new Map();          // username → سجل المستخدم (من المنصة + تفضيلاته)
let prefsSink = null;         // يحفظ التفضيلات في القاعدة
const setDirectory = (list) => { dir = new Map(list.map((u) => [u.username, u])); };
const setPrefsSink = (fn) => { prefsSink = fn; };
const savePrefs = (u) => (prefsSink ? Promise.resolve(prefsSink(u.username, { allowedTemplates: u.allowedTemplates, approvers: u.approvers })) : Promise.resolve());

const find = (u) => dir.get(norm(u));
const publicUser = (u) => u && ({ username: u.username, name: u.name || u.username, role: u.role, source: 'platform', email: u.email || '', department: u.department || '', managerUsername: u.managerUsername || '',
  disabled: !!u.disabled, allowedTemplates: Array.isArray(u.allowedTemplates) ? u.allowedTemplates : null, approvers: Array.isArray(u.approvers) ? u.approvers : [], lastLogin: u.lastLogin || null });

/* ---------- الإعدادات العامة ---------- */
const getSettings = () => Object.assign({ defaultTemplates: null, aiEnabled: false }, store.readJson('settings.json', {}));
function cleanTemplates(list) {
  if (list === null || list === undefined) return null;
  if (!Array.isArray(list)) throw new Error('قائمة غير صالحة');
  const out = [...new Set(list.map(String))]; if (out.some((id) => !TEMPLATE_IDS.includes(id))) throw new Error('نوع تقرير غير معروف');
  return out;
}
function setSettings(patch) {
  const s = getSettings();
  if ('defaultTemplates' in patch) s.defaultTemplates = cleanTemplates(patch.defaultTemplates);
  if ('aiEnabled' in patch) s.aiEnabled = !!patch.aiEnabled;
  store.writeJson('settings.json', s); return s;
}
const defaultTemplatesFor = () => { const d = getSettings().defaultTemplates; return Array.isArray(d) ? d.slice() : null; };

/* ---------- المستخدمون ---------- */
const listUsers = () => [...dir.values()].map(publicUser).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
const listManagers = () => [...dir.values()].filter((u) => !u.disabled && RANK[u.role] >= 1).map(publicUser);

/* الأنواع المسموحة: القيمة الصريحة للمستخدم، وإلا الافتراضية العامة، وإلا الكل. المسؤول يملك الكل */
const allowedFor = (u) => (u.role === 'admin' ? null : (Array.isArray(u.allowedTemplates) ? u.allowedTemplates : defaultTemplatesFor()));
const canUseTemplate = (user, id) => { if (!user || user.role === 'admin') return true; const rec = find(user.username); const a = rec ? allowedFor(rec) : null; return !Array.isArray(a) || a.includes(id); };

async function updateUser(username, patch) {
  const u = find(username); if (!u) throw new Error('المستخدم غير موجود');
  for (const k of Object.keys(patch)) if (!['allowedTemplates', 'approvers'].includes(k)) throw new Error('الاسم والدور وحالة الحساب تُدار من الإدارة المركزية للمنصة');
  if ('allowedTemplates' in patch) u.allowedTemplates = cleanTemplates(patch.allowedTemplates);
  if ('approvers' in patch) u.approvers = cleanApprovers(u.username, patch.approvers);
  await savePrefs(u); return publicUser(u);
}

/* ---------- المدير المعتمِد لكل مستخدم ---------- */
function cleanApprovers(self, list) {
  if (list === null || list === undefined) return [];
  if (!Array.isArray(list)) throw new Error('قائمة المعتمِدين غير صالحة');
  const out = [];
  for (const raw of list.slice(0, 5)) {
    const n = norm(raw); const m = find(n);
    if (!m) throw new Error('المعتمِد غير موجود: ' + n);
    if (RANK[m.role] < 1) throw new Error('«' + (m.name || n) + '» لا يملك صلاحية الاعتماد. امنحه دوراً فيه صلاحية الاعتماد من الإدارة المركزية.');
    if (n === self) throw new Error('لا يمكن أن يكون المستخدم معتمِداً لنفسه');
    if (!out.includes(n)) out.push(n);
  }
  return out;
}
// المعتمِدون الفعليون: النشطون فقط. restricted=true يعني أن المسؤول حدد معتمِداً فلا يُسمح بغيره
function approversOf(user) {
  const rec = find(user.username) || {};
  const assigned = Array.isArray(rec.approvers) ? rec.approvers : [];
  if (!assigned.length || user.role === 'admin') return { restricted: false, list: [] };
  return { restricted: true, list: assigned.map(find).filter((m) => m && !m.disabled && RANK[m.role] >= 1).map(publicUser) };
}
// تعبئة المعتمِدين من المدير المباشر في الهيكل التنظيمي المركزي لمن ليس له معتمِد
async function autoApprovers() {
  let n = 0;
  for (const u of dir.values()) {
    if ((u.approvers || []).length || !u.managerUsername) continue;
    const m = find(u.managerUsername);
    if (m && !m.disabled && RANK[m.role] >= 1 && m.username !== u.username) { u.approvers = [m.username]; await savePrefs(u); n++; }
  }
  return n;
}

module.exports = { RANK, TEMPLATE_IDS, norm, find, listUsers, listManagers, getSettings, setSettings, canUseTemplate, updateUser, approversOf, autoApprovers, setDirectory, setPrefsSink };
