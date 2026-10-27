'use strict';
// صلاحيات التقارير ومسار الاعتماد: مسودة → مُرسَل للمدير → معتمد / مُعاد للتعديل
const STATUS = { draft: 'مسودة', submitted: 'بانتظار الاعتماد', approved: 'معتمد', returned: 'معاد للتعديل' };

const wf = (r) => Object.assign({ status: 'draft', sharedWith: '', sharedWithName: '' }, r.workflow || {});

// ما الذي يستطيع هذا المستخدم فعله في هذا التقرير؟
function access(user, r) {
  const w = wf(r), isAdmin = user.role === 'admin', isOwner = !!r.owner && r.owner === user.username;
  const isReviewer = !!w.sharedWith && w.sharedWith === user.username && w.status !== 'draft';
  const read = isAdmin || isOwner || isReviewer;
  const editable = w.status === 'draft' || w.status === 'returned';
  return {
    read,
    edit: (isOwner && editable) || (isAdmin && w.status !== 'approved'),
    share: isOwner && editable,
    withdraw: (isOwner || isAdmin) && w.status === 'submitted',
    decide: w.status === 'submitted' && (isReviewer || isAdmin) && w.sharedWith !== '' && (isReviewer || isAdmin),
    reopen: isAdmin && (w.status === 'approved' || w.status === 'submitted'),
    reassign: isAdmin,
    owner: isOwner, admin: isAdmin, reviewer: isReviewer,
  };
}

function push(r, user, action, note) {
  r.history = (r.history || []).concat([{ at: new Date().toISOString(), by: user.username, byName: user.name, action, note: note ? String(note).slice(0, 500) : '' }]).slice(-100);
}

const actions = {
  share(r, user, { manager, note }) {
    if (!manager) throw new Error('اختر المدير الذي سيعتمد التقرير');
    r.workflow = { status: 'submitted', sharedWith: manager.username, sharedWithName: manager.name, submittedAt: new Date().toISOString(), note: String(note || '').slice(0, 500) };
    push(r, user, 'share', 'إلى ' + manager.name + (note ? ' — ' + note : ''));
  },
  withdraw(r, user) { r.workflow = Object.assign({}, wf(r), { status: 'draft' }); push(r, user, 'withdraw'); },
  approve(r, user, { note }) { r.workflow = Object.assign({}, wf(r), { status: 'approved', decidedAt: new Date().toISOString(), decidedBy: user.username, decidedByName: user.name, decisionNote: String(note || '').slice(0, 500) }); push(r, user, 'approve', note); },
  return(r, user, { note }) {
    if (!String(note || '').trim()) throw new Error('اكتب سبب إعادة التقرير للتعديل');
    r.workflow = Object.assign({}, wf(r), { status: 'returned', decidedAt: new Date().toISOString(), decidedBy: user.username, decidedByName: user.name, decisionNote: String(note).slice(0, 500) }); push(r, user, 'return', note);
  },
  reopen(r, user) { r.workflow = Object.assign({}, wf(r), { status: 'draft', decidedAt: '', decisionNote: '' }); push(r, user, 'reopen'); },
};

module.exports = { STATUS, wf, access, actions, push };
