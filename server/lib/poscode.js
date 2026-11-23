// رموز الوظائف في الهيكل الوظيفي بصيغة H-Sec-0001: H (هدية) - اختصار المسمى بالإنجليزية - تسلسل من 4 أرقام لكل اختصار
import { q } from '../db/pool.js';

const norm = s => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْـ]/g, '').trim();
// كلمة المسمى (بدايتها) → الاختصار. الأولوية لأول كلمة في المسمى تطابق القائمة.
const WORDS = [['مدير', 'Mgr'], ['رئيس', 'Head'], ['نائب', 'Dep'], ['سكرتير', 'Sec'], ['محاسب', 'Acc'], ['مساعد', 'Asst'], ['مشرف', 'Sup'], ['منسق', 'Coord'],
  ['مسؤول', 'Off'], ['مسوول', 'Off'], ['اخصايي', 'Spec'], ['اخصائي', 'Spec'], ['خبير', 'Exp'], ['مستشار', 'Adv'], ['مهندس', 'Eng'], ['محلل', 'Anl'], ['مطور', 'Dev'],
  ['قانوني', 'Leg'], ['اداري', 'Adm'], ['موظف', 'Emp'], ['فني', 'Tech'], ['سايق', 'Drv'], ['سائق', 'Drv'], ['مراجع', 'Aud'], ['باحث', 'Rsr'], ['كاتب', 'Clk'],
  ['امين', 'Cust'], ['متطوع', 'Vol'], ['مصمم', 'Dsg'], ['مبرمج', 'Prg'], ['مدخل', 'Ent'], ['مندوب', 'Rep'], ['مراسل', 'Msg'], ['عامل', 'Wkr'], ['طباخ', 'Chef'], ['حارس', 'Grd']];
const LAT = { ا: 'A', ب: 'B', ت: 'T', ث: 'Th', ج: 'J', ح: 'H', خ: 'Kh', د: 'D', ذ: 'Dh', ر: 'R', ز: 'Z', س: 'S', ش: 'Sh', ص: 'S', ض: 'D', ط: 'T', ظ: 'Z', ع: 'A', غ: 'G', ف: 'F', ق: 'Q', ك: 'K', ل: 'L', م: 'M', ن: 'N', ه: 'H', و: 'W', ي: 'Y', ء: 'A', ؤ: 'W', ئ: 'Y', ة: 'H' };

export function abbrOf(title) {
  const words = norm(title).split(/\s+/).filter(Boolean);
  for (const w of words) { const hit = WORDS.find(([k]) => w.startsWith(k)); if (hit) return hit[1]; }
  const first = (words[0] || '').replace(/^ال/, '');
  const lat = [...first].map(c => LAT[c] ?? '').join('').slice(0, 3);
  const out = lat ? lat[0].toUpperCase() + lat.slice(1).toLowerCase() : 'Pos';
  return out.length >= 2 ? out : out + 'x';
}

// يعطي رمزاً لكل وظيفة بلا رمز (ما لم تُحدَّد ids) ويستمر التسلسل بعد أكبر رقم موجود لنفس الاختصار
export async function assignCodes(ids = null) {
  const all = (await q('SELECT id, title, code FROM hr_positions ORDER BY id')).rows;
  const next = new Map();
  for (const p of all) { const m = /^H-([A-Za-z]+)-(\d+)$/.exec(p.code || ''); if (m) next.set(m[1], Math.max(next.get(m[1]) || 0, +m[2])); }
  let n = 0;
  for (const p of all) {
    if (p.code || (ids && !ids.includes(p.id))) continue;
    const ab = abbrOf(p.title); const seq = (next.get(ab) || 0) + 1; next.set(ab, seq);
    await q('UPDATE hr_positions SET code = $2, version = version + 1, updated_at = now() WHERE id = $1 AND code IS NULL', [p.id, `H-${ab}-${String(seq).padStart(4, '0')}`]);
    n++;
  }
  return n;
}
