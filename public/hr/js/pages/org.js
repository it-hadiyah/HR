import { h, api, qs, state, fmt, num, field, select, modal, confirmBox, toast, guard, statusBadge, progressBar, setFilters, UNIT_TYPE } from '../core.js';
import { filterBar, filterQuery, getUnits } from '../filters.js';

const CHILD = { org: 'قطاع', sector: 'إدارة', department: 'قسم' };

export default async function org() {
  const root = h('div');
  const holder = h('div');
  const body = h('div', { class: 'card tree' });
  const canEdit = state.user.perms.includes('org');
  const expanded = new Set(JSON.parse(sessionStorage.getItem('orgExpanded') || '[]'));
  const persist = () => sessionStorage.setItem('orgExpanded', JSON.stringify([...expanded]));
  const mkBar = async () => holder.replaceChildren(await filterBar(r => load(r), { status: false }));
  await mkBar();
  root.append(holder, h('p', { style: { color: 'var(--muted)', marginTop: 0 } }, 'عند اختيار أي وحدة تُعرض بياناتها وبيانات كل ما تحتها. تُحتسب المؤشرات تلقائياً على جميع المستويات.'), body);

  async function load(reset) {
    if (reset === true) await mkBar();
    body.replaceChildren(h('div', { class: 'loading' }, 'جارٍ التحميل…'));
    const d = await api('/org/tree' + qs(filterQuery({ unit: undefined })));
    if (!expanded.size) { expanded.add(d.tree.id); d.tree.children.forEach(c => expanded.add(c.id)); }
    const head = h('div', { class: 'tree-node tree-head' }, h('span'), h('span', null, 'الوحدة'), ['الموظفون', 'الرصيد (يوم)', 'المتوقع نهاية السنة', state.user.role.endsWith('manager') ? 'المستخدم' : 'الالتزام (ر.س)', 'المستهدف'].map(t => h('span', null, t)), h('span', null, 'الإنجاز'), h('span'));
    body.replaceChildren(head, h('ul', null, node(d.tree)));
    body.querySelector('ul').style.paddingInlineStart = '0';
  }

  function node(n) {
    const open = expanded.has(n.id);
    const li = h('li');
    const isMgr = state.user.role.endsWith('manager');
    const row = h('div', { class: 'tree-node' },
      n.children.length ? h('button', { class: 'twisty', 'aria-label': open ? 'طيّ' : 'توسيع', 'aria-expanded': String(open), onclick: () => { open ? expanded.delete(n.id) : expanded.add(n.id); persist(); load(); } }, open ? '▾' : '◂') : h('span'),
      h('div', { class: 'name' }, n.name, h('span', { class: 'badge' }, UNIT_TYPE[n.unit_type])),
      h('div', { class: 'm' }, num(fmt.int(n.headcount))),
      h('div', { class: 'm' }, num(fmt.days(n.balance_now))),
      h('div', { class: 'm' }, num(fmt.days(n.projected))),
      h('div', { class: 'm' }, num(isMgr ? fmt.days(n.used) : fmt.sar(n.value_now))),
      h('div', { class: 'm' }, num(n.has_target ? fmt.days(n.target_days) : '—'), n.stated?.conflict_days ? h('small', { class: 'err' }, `تعارض ${fmt.days(n.stated.conflict_days)} يوم`) : null),
      h('div', { class: 'm prog' }, n.has_target ? h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, progressBar(n.achievement, n.target_status), statusBadge(n.target_status)) : '—'),
      h('div', { class: 'row center', style: { gap: '4px', flexWrap: 'nowrap' } },
        h('button', { class: 'btn sm', onclick: () => { setFilters({ unit: n.unit_type === 'org' ? '' : n.id }); location.hash = '#/'; } }, 'لوحة'),
        h('button', { class: 'btn sm', onclick: () => { setFilters({ unit: n.unit_type === 'org' ? '' : n.id }); location.hash = '#/employees'; } }, 'موظفون'),
        canEdit && CHILD[n.unit_type] ? h('button', { class: 'btn sm', title: `إضافة ${CHILD[n.unit_type]}`, onclick: () => edit(null, n) }, `+ ${CHILD[n.unit_type]}`) : null,
        canEdit && n.unit_type !== 'org' ? h('button', { class: 'btn sm', onclick: () => edit(n) }, 'تعديل') : null));
    li.append(row);
    if (open && n.children.length) li.append(h('ul', null, n.children.map(node)));
    return li;
  }

  function edit(unit, parent) {
    const name = h('input', { value: unit?.name || '', required: true });
    const code = h('input', { value: unit?.code || '' });
    const form = h('div', { class: 'form-grid' }, field('الاسم', name), field('الرمز (اختياري)', code));
    const close = modal(unit ? `تعديل ${unit.name}` : `إضافة ${CHILD[parent.unit_type]} تحت «${parent.name}»`, form, {
      onSave: guard(async () => {
        if (unit) await api('/org/units/' + unit.id, { method: 'PUT', body: { name: name.value, code: code.value } });
        else { await api('/org/units', { method: 'POST', body: { parent_id: parent.id, name: name.value, code: code.value } }); expanded.add(parent.id); persist(); }
        await getUnits(true); await load(true); toast('تم الحفظ');
      }),
    });
    if (unit) {
      const del = h('button', { class: 'btn danger', style: { marginInlineStart: 'auto' }, onclick: () => { close(); confirmBox(`حذف «${unit.name}»؟ لا يُسمح بالحذف إن كانت تحتها وحدات أو موظفون.`, async () => {
        await api('/org/units/' + unit.id, { method: 'DELETE' }); await getUnits(true); await load(true); toast('تم الحذف');
      }); } }, 'حذف الوحدة');
      form.append(h('div', { class: 'wide' }, del));
    }
  }

  await load();
  return root;
}
