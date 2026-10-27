import { h, api, state, setFilters, select, field, UNIT_TYPE, EMP_STATUS } from './core.js';

let unitsCache = null;
export const resetUnits = () => { unitsCache = null; };
export async function getUnits(force) { if (!unitsCache || force) unitsCache = await api('/org/units'); return unitsCache; }

/** مسار الوحدة المختارة: { sector, department, section } */
function pathOf(units, id) {
  const by = new Map(units.map(u => [u.id, u]));
  const p = {};
  for (let u = by.get(+id); u; u = by.get(u.parent_id)) p[u.unit_type] = u.id;
  return p;
}

export function unitLabel(units, id) { return units.find(u => u.id === +id)?.name; }

/**
 * شريط المرشحات المشترك: السنة، الفترة، القطاع ← الإدارة ← القسم، الحالة الوظيفية.
 * opts: { period, status, unit, employee } تتحكم في العناصر الظاهرة.
 */
export async function filterBar(onChange, opts = {}) {
  const units = await getUnits();
  const f = state.filters;
  const p = f.unit ? pathOf(units, f.unit) : {};
  const year = new Date().getFullYear();
  const yearSel = select([year - 3, year - 2, year - 1, year, year + 1].map(y => [y, y]), f.year, { 'aria-label': 'السنة' });
  const asOf = h('input', { type: 'date', value: f.asOf || '', 'aria-label': 'حتى تاريخ' });
  const from = h('input', { type: 'date', value: f.from || '', 'aria-label': 'من تاريخ' });
  const kids = (type, parent) => units.filter(u => u.unit_type === type && (parent === undefined || u.parent_id === parent));
  const opt = (type, parent) => [['', 'الكل'], ...kids(type, parent).map(u => [u.id, u.name])];
  const sector = select(opt('sector'), p.sector ?? '');
  const dept = select(opt('department', p.sector), p.department ?? '');
  const section = select(opt('section', p.department), p.section ?? '');
  const status = select([['live', 'نشط وموقوف'], ['active', 'نشط'], ['suspended', 'موقوف'], ['terminated', 'منتهي الخدمة'], ['all', 'الكل']], f.status || 'live');

  const apply = () => {
    const unit = section.value || dept.value || sector.value || '';
    setFilters({ year: +yearSel.value, asOf: asOf.value, from: from.value, unit, status: status.value === 'live' ? '' : status.value });
    onChange();
  };
  sector.addEventListener('change', () => {
    dept.replaceChildren(...select(opt('department', sector.value ? +sector.value : undefined), '').children);
    section.replaceChildren(...select(opt('section', undefined), '').children); dept.value = ''; section.value = ''; apply();
  });
  dept.addEventListener('change', () => {
    section.replaceChildren(...select(opt('section', dept.value ? +dept.value : undefined), '').children); section.value = ''; apply();
  });
  for (const el of [yearSel, asOf, from, section, status]) el.addEventListener('change', apply);
  const reset = h('button', { class: 'btn sm', onclick: () => { setFilters({ year, asOf: '', from: '', unit: '', status: '' }); onChange(true); } }, 'إعادة ضبط');
  return h('div', { class: 'card filters no-print' }, h('div', { class: 'row' },
    field('السنة', yearSel), opts.period !== false && field('حتى تاريخ', asOf), opts.period !== false && field('بداية الفترة (للمستخدَم)', from),
    field('القطاع', sector), field('الإدارة', dept), field('القسم', section), opts.status !== false && field('الحالة الوظيفية', status), h('div', { class: 'spacer' }), reset));
}

export const filterQuery = (extra = {}) => ({ ...state.filters, ...extra });
export { UNIT_TYPE, EMP_STATUS };
