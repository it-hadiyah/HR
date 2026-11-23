// تنبيهات المستخدم: كل ما ينتظر مراجعته أو قراره في المنصة. تُحسب من حالة البيانات نفسها (لا جدول تنبيهات مستقل)،
// فيزول التنبيه تلقائياً بمجرد معالجة الطلب. كل نظام يضيف «مزوّداً» يعيد عناصره للمستخدم المعني فقط.
// شكل العنصر: { key, sig, title, text, url, at, icon } — sig بصمة تتغير بتغير المحتوى لتمييز الجديد عن المعروض سابقاً.
import { q } from '../db/pool.js';
import { hasGrant } from './rbac.js';
import { canUseApp } from './apps.js';

const money = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });

async function hrRequestsProvider(user) {
  if (!(await canUseApp(user, 'hr-requests'))) return [];
  const out = [];
  // 1) طلبات كفالة بانتظار اعتماد هذا الموظف كفيلاً
  const g = (await q(`SELECT l.id, l.amount, l.months, l.created_at, e.full_name FROM hr_loans l JOIN leave_staff e ON e.id = l.employee_id
    WHERE l.guarantor_user_id = $1 AND l.status = 'pending_guarantor' ORDER BY l.created_at DESC LIMIT 20`, [user.id])).rows;
  for (const x of g) out.push({ key: `loan-g-${x.id}`, sig: `loan-g-${x.id}`, icon: 'shield', title: 'طلب كفالة بانتظار اعتمادك', text: `${x.full_name} يطلب سلفة ${money(x.amount)} ر.س على ${x.months} أشهر واختارك كفيلاً`, url: '/hr-requests/#guarantee', at: x.created_at });
  // 2) مراجعو الموارد البشرية: الخطابات والسلف المنتظرة
  if (hasGrant(user, 'hr-requests', 'review')) {
    const l = (await q("SELECT count(*)::int AS n, max(id) AS last, max(created_at) AS at FROM hr_requests WHERE status = 'pending'")).rows[0];
    if (l.n) out.push({ key: 'hr-letters', sig: `hr-letters:${l.n}:${l.last}`, icon: 'file', title: `${l.n} ${l.n === 1 ? 'طلب خطاب' : 'طلبات خطابات'} بانتظار مراجعتك`, text: 'تعريف بالراتب أو تثبيت بالراتب', url: '/hr-requests/#inbox', at: l.at });
    const s = (await q("SELECT count(*)::int AS n, max(id) AS last, max(updated_at) AS at FROM hr_loans WHERE status = 'pending_hr'")).rows[0];
    if (s.n) out.push({ key: 'hr-loans', sig: `hr-loans:${s.n}:${s.last}`, icon: 'wallet', title: `${s.n} ${s.n === 1 ? 'طلب سلفة' : 'طلبات سلف'} بانتظار قرارك`, text: 'اعتمدها الكفيل وتنتظر الموارد البشرية', url: '/hr-requests/#loans', at: s.at });
  }
  return out;
}

// أكمل ملفك: تأكيد البيانات المعبّأة وإضافة التوقيع (يظهر لمن لم يفعل بعد)
async function profileProvider(user) {
  const { profileStatus } = await import('../routes/myProfile.js');
  const s = await profileStatus(user);
  if (!s.needs_attention) return [];
  const todo = [s.needs_confirm && 'تأكيد بياناتك', s.needs_signature && 'إضافة توقيعك'].filter(Boolean).join(' و');
  return [{ key: 'profile', sig: `profile:${s.needs_confirm}:${s.needs_signature}`, icon: 'user', title: 'أكمل ملفك الشخصي', text: `يلزم ${todo} للتوقيع على الطلبات داخل المنصة`, url: '/my-profile/', at: new Date().toISOString() }];
}

const PROVIDERS = [hrRequestsProvider, profileProvider];

export async function notificationsFor(user) {
  const items = [];
  for (const p of PROVIDERS) { try { items.push(...(await p(user))); } catch (e) { console.error('notifications:', e.message); } }
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  return { count: items.length, items };
}
