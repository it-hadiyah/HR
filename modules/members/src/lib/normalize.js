'use strict';
// تطبيع وتحقق: أرقام عربية، جوال سعودي/دولي، بريد، تواريخ، مبالغ (كنص عشري دقيق).
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function latinDigits(s) {
  return String(s ?? '').replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d))
    .replace(/٫/g, '.').replace(/٬/g, '');
}

function clean(s) {
  const v = String(s ?? '').replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
  return v === '' ? null : v;
}

/** يعيد رقمًا بصيغة E.164 أو null؛ يرمي خطأً نصيًا عند عدم الصحة */
function normalizePhone(input) {
  const raw = clean(input);
  if (!raw) return null;
  let d = latinDigits(raw).replace(/[\s\-().]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (/^05\d{8}$/.test(d)) return '+966' + d.slice(1);
  if (/^5\d{8}$/.test(d)) return '+966' + d;
  if (/^9665\d{8}$/.test(d)) return '+' + d;
  if (/^\+9665\d{8}$/.test(d)) return d;
  if (/^\+(?!966)[1-9]\d{7,14}$/.test(d)) return d;
  throw new Error('رقم الجوال غير صحيح (مثال: 05XXXXXXXX)');
}

function normalizeEmail(input) {
  const v = clean(input);
  if (!v) return null;
  const e = v.toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new Error('البريد الإلكتروني غير صحيح');
  return e;
}

const pad = (n) => String(n).padStart(2, '0');
function validYMD(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && y <= 2200;
}

/** يقبل yyyy-mm-dd و dd/mm/yyyy وكائن Date ورقم تسلسلي Excel. يعيد yyyy-mm-dd أو null */
function normalizeDate(input) {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) {
    if (isNaN(input)) throw new Error('تاريخ غير صحيح');
    return `${input.getUTCFullYear()}-${pad(input.getUTCMonth() + 1)}-${pad(input.getUTCDate())}`;
  }
  if (typeof input === 'number') {
    const dt = new Date(Math.round((input - 25569) * 86400000));
    return normalizeDate(dt);
  }
  const s = latinDigits(clean(input) || '');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else throw new Error('صيغة التاريخ غير مدعومة (استخدم yyyy-mm-dd)');
  if (!validYMD(y, mo, d)) throw new Error('تاريخ غير صحيح');
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** مبلغ كنص بمنزلتين عشريتين بلا استخدام Float في الحساب */
function normalizeMoney(input, { allowZero = true } = {}) {
  if (input === null || input === undefined || input === '') return null;
  const s = latinDigits(String(input)).replace(/[,\s]/g, '').replace(/(ريال|SAR|ر\.س)/gi, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('المبلغ غير صحيح (حتى منزلتين عشريتين)');
  const [i, f = ''] = s.split('.');
  const out = `${BigInt(i)}.${(f + '00').slice(0, 2)}`;
  if (out.length > 15) throw new Error('المبلغ كبير جدًا');
  if (!allowZero && Number(out) === 0) throw new Error('يجب أن يكون المبلغ أكبر من صفر');
  return out;
}

const cents = (m) => { const [i, f] = String(m).split('.'); return BigInt(i) * 100n + BigInt((f || '0').padEnd(2, '0').slice(0, 2)); };
const fromCents = (c) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;

function addMonthsISO(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}
function addDaysISO(iso, days) {
  const dt = new Date(iso + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
/** نهاية الدورة (شاملة) = بداية + مدة بالأشهر − يوم */
const periodEnd = (startISO, months) => addDaysISO(addMonthsISO(startISO, months), -1);
const todayRiyadh = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

module.exports = { latinDigits, clean, normalizePhone, normalizeEmail, normalizeDate, normalizeMoney, cents, fromCents,
  addMonthsISO, addDaysISO, periodEnd, todayRiyadh };
