import { h, mount, clear, icon, btn, api, state, fmtMoney, fmtInt, fmtDate, badge, fld, skeleton, empty, toast, errMsg, download, confirmDialog } from '../lib.js';

export default async function render(root) {
  const body = h('div');
  const steps = h('ol', { class: 'steps' });
  let step = 1, batch = null, result = null;
  mount(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'استيراد الأعضاء'), h('p', {}, 'Excel أو CSV. لا يُكتب أي شيء قبل المعاينة والتحقق والاعتماد الصريح، ولا يستبدل الاستيراد بيانات موجودة.'))), steps, body);
  const drawSteps = () => mount(steps, ['رفع الملف', 'مطابقة الأعمدة والمعاينة', 'الاعتماد', 'النتيجة'].map((t, i) => h('li', { class: i + 1 < step ? 'done' : '', 'aria-current': i + 1 === step ? 'step' : null }, h('b', {}, i + 1 < step ? '✓' : String(i + 1)), t)));

  function stepUpload() {
    step = 1; drawSteps();
    const input = h('input', { type: 'file', accept: '.xlsx,.csv', hidden: true });
    const dz = h('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': 'اختر ملف Excel أو CSV' }, icon('upload'), h('p', { style: { marginBlock: '8px' } }, h('b', {}, 'اسحب الملف هنا أو اضغط للاختيار')), h('p', { class: 'muted small' }, 'xlsx أو csv (UTF-8) · حتى 5 ميغابايت و5000 صف'), input);
    const go = async (file) => {
      if (!file) return; mount(body, skeleton(6));
      const fd = new FormData(); fd.append('file', file);
      try { batch = await api('/import/preview', { method: 'POST', form: fd }); stepPreview(); } catch (e) { toast(errMsg(e), 'bad'); stepUpload(); }
    };
    dz.addEventListener('click', () => input.click()); dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => go(input.files[0]));
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); }); dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); go(e.dataTransfer.files[0]); });
    mount(body, h('div', { class: 'cols-2', style: { marginBlockStart: 0 } },
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, '1) نزّل القالب')), h('div', { class: 'panel-b' }, h('p', { class: 'muted' }, 'قالب Excel جاهز بالعناوين العربية وصفحة تعليمات. يمكنك أيضًا رفع ملفك الخاص ومطابقة أعمدته لاحقًا.'), h('div', { style: { marginBlockStart: '16px' } }, btn('تنزيل قالب Excel', { ic: 'download', cls: 'primary', onClick: async () => { try { await download('/import/template', {}, 'members-import-template.xlsx'); } catch (e) { toast(errMsg(e), 'bad'); } } })))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, '2) ارفع الملف')), h('div', { class: 'panel-b' }, dz))));
  }

  const STATUS = { valid: badge('صالح', 'ok'), error: badge('خطأ', 'bad'), duplicate: badge('مكرر', 'warn') };
  function stepPreview() {
    step = 2; drawSteps();
    const b = batch, sm = b.summary;
    const selects = b.fields.map((f) => { const s = fld({ label: f.label, name: f.key, type: 'select', required: f.required, options: [{ value: '', label: '— غير مطابق —' }, ...b.header.map((x, i) => ({ value: i, label: x || `عمود ${i + 1}` }))], value: b.mapping[f.key] ?? '' }); return s; });
    const reMap = async () => {
      const mapping = Object.fromEntries(selects.filter((s) => s.input.value !== '').map((s) => [s.input.name, Number(s.input.value)]));
      mount(body, skeleton(6));
      try { batch = await api(`/import/${b.batch_id}/preview`, { method: 'POST', body: { mapping } }); stepPreview(); } catch (e) { toast(errMsg(e), 'bad'); stepPreview(); }
    };
    const rowsTable = (rows) => h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['الصف', 'الحالة', 'الاسم', 'الجوال', 'البريد', 'النوع', 'البداية', 'الانتهاء', 'المستحق', 'المسدد', 'الملاحظات'].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: r.status === 'error' ? 'row-error' : r.status === 'duplicate' ? 'row-dup' : '' }, h('td', {}, h('span', { class: 'num' }, r.row)), h('td', {}, STATUS[r.status]),
        h('td', {}, r.data.full_name || '—'), h('td', {}, r.data.phone ? h('span', { class: 'ltr' }, r.data.phone) : '—'), h('td', {}, r.data.email ? h('span', { class: 'ltr' }, r.data.email) : '—'), h('td', {}, r.data.type || '—'),
        h('td', {}, fmtDate(r.data.start_date)), h('td', {}, fmtDate(r.data.end_date)), h('td', {}, r.data.exempt ? 'معفى' : fmtMoney(r.data.amount_due)), h('td', {}, r.data.paid_amount ? fmtMoney(r.data.paid_amount) : '—'),
        h('td', {}, [...r.errors.map((e) => h('div', { style: { color: 'var(--bad-fg)' } }, e.message)), ...r.duplicates.map((d) => h('div', { style: { color: 'var(--warn-fg)' } }, `مكرر (${d.rule === 'phone' ? 'الجوال' : d.rule === 'email' ? 'البريد' : 'الاسم'}) مع ${d.with}`))]))))));
    mount(body,
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, `مطابقة الأعمدة — ${b.filename}`), btn('اختيار ملف آخر', { cls: 'sm', onClick: async () => { try { await api(`/import/${b.batch_id}`, { method: 'DELETE' }); } catch { /* */ } stepUpload(); } })),
        h('div', { class: 'panel-b' }, b.missing_required.length ? h('div', { class: 'alert bad', style: { marginBlockEnd: '16px' } }, icon('alert'), `أعمدة إلزامية غير مطابقة: ${b.missing_required.join('، ')}`) : null,
          h('div', { class: 'grid g3' }, selects.map((s) => s.root)), h('div', { style: { marginBlockStart: '16px' } }, btn('تطبيق المطابقة وإعادة التحقق', { onClick: reMap })))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'نتيجة التحقق'), h('div', { class: 'actions' }, STATUS.valid, ` ${fmtInt(sm.valid)}`, STATUS.error, ` ${fmtInt(sm.errors)}`, STATUS.duplicate, ` ${fmtInt(sm.duplicates)}`, h('span', { class: 'muted' }, `من ${fmtInt(sm.total)} صفًا`))),
        h('div', { class: 'panel-b' }, h('p', { class: 'muted small' }, `قواعد اكتشاف التكرار الحالية: ${b.duplicate_rules.map((r) => ({ phone: 'الجوال', email: 'البريد', name: 'الاسم' }[r])).join('، ')} (قابلة للتعديل من الإعدادات). الصفوف المكررة تُتخطّى ولا تُستبدل.`)),
        sm.errors + sm.duplicates ? [h('div', { class: 'panel-h', style: { borderBlockStart: '1px solid var(--line)' } }, h('h3', {}, 'الصفوف التي تحتاج مراجعة')), rowsTable(b.problem_rows)] : null,
        h('div', { class: 'panel-h', style: { borderBlockStart: '1px solid var(--line)' } }, h('h3', {}, `معاينة الصفوف (أول ${fmtInt(b.rows.length)})`)), rowsTable(b.rows)),
      h('div', { class: 'actions', style: { marginBlockStart: '16px' } }, btn('متابعة إلى الاعتماد', { cls: 'primary', disabled: !sm.valid || b.missing_required.length > 0, onClick: stepConfirm })));
  }

  function stepConfirm() {
    step = 3; drawSteps();
    const sm = batch.summary;
    const chk = h('input', { type: 'checkbox', id: 'cf' });
    const go = h('button', { class: 'btn primary', type: 'button', disabled: true }, `استيراد ${fmtInt(sm.valid)} عضو`);
    chk.addEventListener('change', () => { go.disabled = !chk.checked; });
    go.addEventListener('click', async () => {
      go.setAttribute('aria-busy', 'true');
      try { result = await api(`/import/${batch.batch_id}/commit`, { method: 'POST', body: { confirm: true } }); stepResult(); }
      catch (e) { toast(errMsg(e), 'bad'); go.removeAttribute('aria-busy'); }
    });
    mount(body, h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'اعتماد الاستيراد')), h('div', { class: 'panel-b' },
      h('dl', { class: 'dl' }, h('dt', {}, 'الملف'), h('dd', {}, batch.filename), h('dt', {}, 'سيُستورد'), h('dd', {}, `${fmtInt(sm.valid)} عضو`), h('dt', {}, 'سيُتخطّى'), h('dd', {}, `${fmtInt(sm.errors)} بأخطاء و${fmtInt(sm.duplicates)} مكرر`)),
      h('div', { class: 'alert warn', style: { marginBlock: '16px' } }, icon('alert'), 'سيُنشأ لكل عضو سجل ودورة اشتراك. المبلغ المسدد (إن وُجد) يُسجَّل كرصيد افتتاحي. تتم العملية في معاملة واحدة وتُسجَّل في سجل التدقيق.'),
      h('label', { class: 'check', for: 'cf' }, chk, h('span', {}, 'أؤكد مراجعة المعاينة وأوافق على استيراد الصفوف الصالحة.')),
      h('div', { class: 'actions', style: { marginBlockStart: '16px' } }, go, btn('رجوع', { onClick: stepPreview })))));
  }

  function stepResult() {
    step = 4; drawSteps();
    const s = result.summary;
    mount(body, h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'ملخص الاستيراد')), h('div', { class: 'panel-b' },
      h('div', { class: 'alert ok' }, icon('check'), `تم استيراد ${fmtInt(s.imported)} عضو بنجاح.`),
      h('div', { class: 'facts', style: { marginBlock: '16px 0' } }, [['إجمالي الصفوف', s.total], ['تم استيرادها', s.imported], ['أرصدة افتتاحية', s.opening_payments], ['تم تخطيها', s.skipped]].map(([l, v]) => h('div', { class: 'fact' }, h('span', { class: 'k-l' }, l), h('div', { class: 'k-v' }, fmtInt(v))))),
      result.skipped_rows.length ? [h('h3', { style: { marginBlock: '24px 8px' } }, 'الصفوف المتخطّاة'), h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['الصف', 'الحالة', 'الاسم', 'السبب'].map((x) => h('th', {}, x)))), h('tbody', {}, result.skipped_rows.map((r) => h('tr', {}, h('td', {}, h('span', { class: 'num' }, r.row)), h('td', {}, STATUS[r.status]), h('td', {}, r.data.full_name || '—'), h('td', {}, [...r.errors.map((e) => e.message), ...r.duplicates.map((d) => `مكرر مع ${d.with}`)].join('؛ ')))))))] : null,
      h('div', { class: 'actions', style: { marginBlockStart: '16px' } }, btn('عرض الأعضاء', { cls: 'primary', onClick: () => { location.hash = '#/members'; } }), btn('استيراد ملف آخر', { onClick: stepUpload })))));
  }
  stepUpload();
}
