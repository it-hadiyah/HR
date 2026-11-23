// الملف الشخصي للموظف: يرى بياناته كما عبّأتها الموارد البشرية (قراءة فقط) ويحفظ توقيعه الخاص ليوقّع به داخل المنصة.
// التوقيع بيانات حساسة: لا يُعاد إلا لصاحبه، وتُؤخذ منه لقطة ثابتة داخل المستند أو الطلب عند التوقيع (لا رابط حيّ).
import { Router } from 'express';
import { q } from '../db/pool.js';
import { audit, wrap } from '../lib/auth.js';
import { httpError } from '../lib/util.js';
import { myStaff } from '../lib/hrIdentity.js';
import { unitPaths } from './tracking.js';

const r = Router();
const MAX_BYTES = 200 * 1024;
const dateOnly = d => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** نوع الصورة من بصمة الملف (PNG/JPEG/WebP فقط؛ لا SVG) */
export function sniffImage(buf) {
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** توقيع المستخدم كـ data URL (لقطة تُدمج في المستند) أو null */
export async function signatureDataUrl(userId) {
  const s = (await q('SELECT signature, signature_mime FROM user_profiles WHERE user_id = $1 AND signature IS NOT NULL', [userId])).rows[0];
  return s ? `data:${s.signature_mime};base64,${Buffer.from(s.signature).toString('base64')}` : null;
}
export async function hasSignature(userId) {
  return (await q('SELECT 1 FROM user_profiles WHERE user_id = $1 AND signature IS NOT NULL', [userId])).rows.length > 0;
}

/** حالة الملف: هل يحتاج الموظف لتأكيد بياناته أو إضافة توقيعه */
export async function profileStatus(user) {
  const staff = await myStaff(user);
  const p = (await q('SELECT (signature IS NOT NULL) AS has_sig, signature_updated_at, confirmed_at, viewed_at FROM user_profiles WHERE user_id = $1', [user.id])).rows[0] || {};
  // يلزم الانتباه: لم يضف توقيعه، أو لم يطّلع على بياناته المعبّأة بعد (مرة واحدة). تأكيد البيانات اختياري ولا يُبقي التنبيه.
  const needsSignature = !p.has_sig, needsView = !!staff && !p.viewed_at;
  return { staff, has_signature: !!p.has_sig, signature_updated_at: p.signature_updated_at || null, confirmed_at: p.confirmed_at || null, needs_attention: needsSignature || needsView, needs_view: needsView, needs_confirm: !!staff && !p.confirmed_at, needs_signature: needsSignature };
}

r.get('/', wrap(async (req, res) => {
  const st = await profileStatus(req.user);
  if (st.staff && st.needs_view) await q('INSERT INTO user_profiles(user_id, viewed_at) VALUES ($1, now()) ON CONFLICT (user_id) DO UPDATE SET viewed_at = COALESCE(user_profiles.viewed_at, now())', [req.user.id]);   // اطّلع على بياناته
  let employee = null;
  if (st.staff) {
    const s = st.staff, u = (await unitPaths())(s.org_unit_id);
    const lacking = [!s.emp_no && 'الرقم الوظيفي', !s.org_unit_id && 'الوحدة التنظيمية', !s.hire_date && 'تاريخ التعيين', !s.nationality && 'الجنسية', !s.national_id && 'رقم الهوية', !s.iban && 'الآيبان', !s.phone && 'الجوال'].filter(Boolean);
    employee = { full_name: s.full_name, emp_no: s.emp_no, job_title: s.job_title, sector: u.sector, department: u.department, section: u.section, hire_date: dateOnly(s.hire_date), nationality: s.nationality, national_id: s.national_id, iban: s.iban, phone: s.phone, lacking };
  }
  res.json({ account: { username: req.user.username, full_name: req.user.full_name }, linked: !!st.staff, employee,
    signature: { has: st.has_signature, updated_at: st.signature_updated_at }, confirmed_at: st.confirmed_at, needs_attention: st.needs_attention && (st.needs_signature || false), needs_confirm: st.needs_confirm, needs_signature: st.needs_signature });
}));

r.get('/status', wrap(async (req, res) => {
  const st = await profileStatus(req.user);
  res.json({ linked: !!st.staff, needs_attention: st.needs_attention, needs_view: st.needs_view, needs_confirm: st.needs_confirm, needs_signature: st.needs_signature });
}));

r.post('/confirm', wrap(async (req, res) => {
  const staff = await myStaff(req.user);
  if (!staff) throw httpError(400, 'حسابك غير مرتبط بسجل موظف');
  await q(`INSERT INTO user_profiles(user_id, confirmed_at, confirmed_staff_version) VALUES ($1, now(), $2)
    ON CONFLICT (user_id) DO UPDATE SET confirmed_at = now(), confirmed_staff_version = EXCLUDED.confirmed_staff_version`, [req.user.id, staff.version]);
  await audit(req, 'update', 'user_profile', req.user.id, null, { confirmed: true });
  res.json({ ok: true });
}));

// ---- التوقيع الخاص ----
r.get('/signature', wrap(async (req, res) => {
  const s = (await q('SELECT signature, signature_mime FROM user_profiles WHERE user_id = $1 AND signature IS NOT NULL', [req.user.id])).rows[0];
  if (!s) return res.status(404).json({ error: 'لا يوجد توقيع محفوظ' });
  res.set({ 'Content-Type': s.signature_mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" }).send(s.signature);
}));
r.post('/signature', wrap(async (req, res) => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
  if (!m) throw httpError(400, 'صورة التوقيع غير صالحة (PNG أو JPG أو WebP)');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 200) throw httpError(400, 'التوقيع فارغ؛ ارسم توقيعك أولاً');
  if (buf.length > MAX_BYTES) throw httpError(400, 'حجم التوقيع كبير؛ الحد 200 كيلوبايت');
  const mime = sniffImage(buf);
  if (!mime) throw httpError(400, 'الملف ليس صورة صالحة');
  await q(`INSERT INTO user_profiles(user_id, signature, signature_mime, signature_updated_at) VALUES ($1, $2, $3, now())
    ON CONFLICT (user_id) DO UPDATE SET signature = EXCLUDED.signature, signature_mime = EXCLUDED.signature_mime, signature_updated_at = now()`, [req.user.id, buf, mime]);
  await audit(req, 'update', 'user_signature', req.user.id, null, { bytes: buf.length, mime });
  res.json({ ok: true, signature: { has: true } });
}));
r.delete('/signature', wrap(async (req, res) => {
  await q('UPDATE user_profiles SET signature = NULL, signature_mime = NULL, signature_updated_at = NULL WHERE user_id = $1', [req.user.id]);
  await audit(req, 'delete', 'user_signature', req.user.id, null, null);
  res.json({ ok: true, signature: { has: false } });
}));

export default r;
