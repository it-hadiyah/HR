import { h, api, qs, state, fmt, num, field, select, table, download, toast, guard } from '../core.js';
import { filterBar, filterQuery } from '../filters.js';

export default async function reports(args) {
  const list = await api('/reports/list');
  const root = h('div');
  const holder = h('div');
  const out = h('div');
  let current = args[0] || list[0].key;
  const mkBar = async () => holder.replaceChildren(await filterBar(r => show(r), { status: false }));
  await mkBar();
  const sel = select(list.map(r => [r.key, r.title]), current, { 'aria-label': 'التقرير', style: { minWidth: '320px' } });
  const a = h('input', { type: 'date', value: state.filters.from || `${state.filters.year}-01-31` });
  const b = h('input', { type: 'date', value: state.filters.asOf || new Date().toISOString().slice(0, 10) });
  const empSel = h('input', { list: 'rep-emps', placeholder: 'الموظف' });
  const dl = h('datalist', { id: 'rep-emps' });
  const empMap = new Map();
  (await api('/employees' + qs({ status: 'all' }))).rows.forEach(e => { const k = `${e.emp_no} — ${e.full_name}`; empMap.set(k, e.id); dl.append(h('option', { value: k })); });
  const extra = h('div', { class: 'row' });
  const params = () => {
    const p = filterQuery();
    if (sel.value === 'change') { p.a = a.value; p.b = b.value; }
    if (sel.value === 'employee') p.employee = empMap.get(empSel.value);
    return p;
  };
  const syncExtra = () => extra.replaceChildren(...(sel.value === 'change' ? [field('من تاريخ', a), field('إلى تاريخ', b)] : sel.value === 'employee' ? [field('الموظف', empSel), dl] : []));
  syncExtra();
  const show = async reset => {
    if (reset === true) await mkBar();
    current = sel.value; syncExtra();
    if (sel.value === 'employee' && !params().employee) { out.replaceChildren(h('div', { class: 'card empty' }, 'اختر الموظف لعرض تقريره التفصيلي')); return; }
    out.replaceChildren(h('div', { class: 'loading' }, 'جارٍ إعداد التقرير…'));
    try {
      const rep = await api(`/reports/${sel.value}` + qs(params()));
      const cols = rep.columns.map(c => ({ key: c.key, label: c.label, num: ['num', 'sar', 'pct', 'int'].includes(c.fmt),
        render: r => (r[c.key] === null || r[c.key] === undefined || r[c.key] === '' ? '—' : c.fmt === 'text' ? (/^\d{4}-\d{2}-\d{2}$/.test(r[c.key]) ? fmt.date(r[c.key]) : r[c.key]) : num(c.fmt === 'sar' ? fmt.sar(r[c.key]) : c.fmt === 'pct' ? fmt.pct(r[c.key]) : c.fmt === 'int' ? fmt.int(r[c.key]) : fmt.days(r[c.key]))) }));
      out.replaceChildren(
        h('div', { class: 'print-head' }, h('h2', null, rep.title), h('div', null, `السنة ${rep.meta.year} — حتى ${rep.meta.asOf} — تاريخ الإصدار ${rep.meta.generated}`)),
        h('div', { class: 'row center no-print', style: { marginBottom: '10px' } }, h('h2', { style: { fontSize: '16px' } }, rep.title), h('div', { class: 'spacer' }),
          h('button', { class: 'btn', onclick: () => download(`/reports/${sel.value}` + qs({ ...params(), format: 'xlsx' })) }, 'تصدير Excel'),
          h('button', { class: 'btn', onclick: () => window.print() }, 'طباعة / PDF')),
        rep.summary ? h('div', { class: 'card kv', style: { marginBottom: '12px' } }, rep.summary.map(([k, v]) => h('div', null, h('span', null, k), h('b', null, num(typeof v === 'number' ? fmt.days(v) : v))))) : null,
        table(cols, rep.rows, { totals: rep.totals && Object.keys(rep.totals).length ? rep.totals : null, empty: 'لا توجد بيانات لهذا التقرير' }),
        rep.notes?.length ? h('ul', { style: { color: 'var(--muted)', fontSize: '12.5px' } }, rep.notes.map(n => h('li', null, n))) : null);
    } catch (e) { out.replaceChildren(h('div', { class: 'card err' }, e.message)); }
  };
  sel.addEventListener('change', () => show()); for (const el of [a, b, empSel]) el.addEventListener('change', () => show());
  root.append(holder, h('div', { class: 'card filters no-print' }, h('div', { class: 'row' }, field('التقرير', sel), extra)), out);
  await show();
  return root;
}
