'use strict';
// مركز المؤشرات: سلاسل بيانات مركزية قابلة لإعادة الاستخدام في الرسوم داخل التقارير والعروض
const crypto = require('crypto');
const store = require('./store');

const FILE = 'indicators.json';
let list = store.readJson(FILE, []);
const save = () => store.writeJson(FILE, list);
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const num = (v) => { const t = String(v == null ? '' : v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,٬\s%]/g, ''); return t !== '' && Number.isFinite(Number(t)) ? t : ''; };

function clean(b) {
  const name = s(b.name, 120); if (!name) throw new Error('اسم المؤشر مطلوب');
  const series = (Array.isArray(b.series) ? b.series : []).slice(0, 60).map((p) => ({ label: s(p && p.label, 100), value: num(p && p.value) })).filter((p) => p.label || p.value !== '');
  if (!series.length) throw new Error('أدخل قيمة واحدة على الأقل');
  if (series.some((p) => p.value === '')) throw new Error('كل قيمة يجب أن تكون رقماً صحيحاً');
  return { name, unit: s(b.unit, 20), category: s(b.category, 60), source: s(b.source, 200), asOf: /^\d{4}-\d{2}-\d{2}$/.test(String(b.asOf || '')) ? b.asOf : '', series };
}
const all = () => list.slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'));
const get = (id) => list.find((x) => x.id === id) || null;
function create(user, b) { const x = Object.assign({ id: 'ind-' + crypto.randomBytes(5).toString('hex'), createdAt: new Date().toISOString() }, clean(b), { updatedAt: new Date().toISOString(), updatedBy: user.username, updatedByName: user.name }); list.push(x); save(); return x; }
function update(user, id, b) { const x = get(id); if (!x) throw new Error('المؤشر غير موجود'); Object.assign(x, clean(b), { updatedAt: new Date().toISOString(), updatedBy: user.username, updatedByName: user.name }); save(); return x; }
function remove(id) { list = list.filter((x) => x.id !== id); save(); }
// خريطة للتصيير: id → { series, unit, source, asOf }
const map = () => Object.fromEntries(list.map((x) => [x.id, { name: x.name, series: x.series, unit: x.unit, source: x.source, asOf: x.asOf }]));

module.exports = { all, get, create, update, remove, map };
