// شريط إجراءات صفحة التقرير المحفوظ: الحالة، التعديل، المشاركة مع المدير، الاعتماد، السجل
import { el, btn } from './ui.js';
import { STATUS, shareDialog, decideDialog, simple, historyDialog, commentsDialog, versionsDialog, call, baseOf } from './workflow-ui.js';

const kind = document.body.dataset.kind === 'deck' ? 'deck' : 'report', noun = kind === 'deck' ? 'العرض' : 'التقرير';
const rid = document.body.dataset.rid;
const box = document.getElementById('vb-actions');
if (rid && box) {
  fetch(baseOf(kind) + encodeURIComponent(rid)).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d) return;
    const a = d.access, w = d.workflow || { status: 'draft' };
    const chip = document.getElementById('vb-status');
    chip.textContent = STATUS[w.status] || ''; chip.className = 'chip-status ' + w.status;
    const who = document.createElement('span'); who.className = 'muted'; who.style.fontSize = '13px';
    who.textContent = (d.ownerName ? 'صاحب ' + noun + ': ' + d.ownerName : '') + (w.sharedWithName && w.status !== 'draft' ? ' · عند: ' + w.sharedWithName : '');
    chip.after(who);
    const reload = () => location.reload();
    const items = [];
    if (a.edit) items.push(el('a', { class: 'btn', href: (kind === 'deck' ? '/report-builder/deck.html?id=' : '/report-builder/?edit=') + encodeURIComponent(rid) }, 'تعديل'));
    if (a.share) items.push(btn('إرسال للاعتماد', { cls: 'primary', onclick: async () => { if (await shareDialog(rid, kind)) reload(); } }));
    if (a.withdraw) items.push(btn('سحب من الاعتماد', { cls: 'ghost', onclick: async () => { if (await simple(rid, 'withdraw', 'سحب ' + noun, 'سيعود ' + noun + ' مسودة ويمكنك تعديله ثم إرساله مجدداً.', 'سحب', kind)) reload(); } }));
    if (a.decide) { items.push(btn('اعتماد', { cls: 'primary', onclick: async () => { if (await decideDialog(rid, 'approve', kind)) reload(); } })); items.push(btn('إعادة للتعديل', { cls: 'ghost', onclick: async () => { if (await decideDialog(rid, 'return', kind)) reload(); } })); }
    if (a.reopen) items.push(btn('إعادة فتح', { cls: 'ghost', onclick: async () => { if (await simple(rid, 'reopen', 'إعادة فتح ' + noun, 'سيعود ' + noun + ' مسودة لصاحبه.', 'إعادة فتح', kind)) reload(); } }));
    let comments = d.comments || [];
    const cbtn = btn('التعليقات (' + comments.length + ')', { cls: 'ghost', onclick: () => commentsDialog(rid, comments, (c) => { comments = c; cbtn.querySelector('span').textContent = 'التعليقات (' + c.length + ')'; }, kind) });
    items.push(cbtn);
    items.push(btn('النسخ (' + (d.versionCount || 0) + ')', { cls: 'ghost', onclick: () => versionsDialog(rid, a.edit, reload, kind) }));
    if (a.owner || a.admin) items.push(btn('حفظ نسخة', { cls: 'ghost', onclick: async () => { try { await call(rid, 'snapshot', { label: 'نسخة يدوية' }, kind); reload(); } catch (e) { alert(e.message); } } }));
    if ((a.owner || a.admin) && w.status !== 'submitted') items.push(btn(d.archived ? 'إلغاء الأرشفة' : 'أرشفة', { cls: 'ghost', onclick: async () => { try { await call(rid, d.archived ? 'unarchive' : 'archive', {}, kind); reload(); } catch (e) { alert(e.message); } } }));
    items.push(btn('السجل', { cls: 'ghost', onclick: () => historyDialog(d.history) }));
    box.prepend(...items);
  });
}
