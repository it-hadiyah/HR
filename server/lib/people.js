// ربط الأشخاص (دليل البوابة) بموظفي الموارد البشرية والمستخدمين
import { q } from '../db/pool.js';

const HONORIFICS = /(^|\s)(معالي|سعادة|الدكتور|الدكتورة|دكتور|الأستاذ|الاستاذ|الأستاذة|المهندس|المهندسة|م\.|د\.|أ\.|المحاسب|الشيخ)(?=\s|$)/g;

export function normalizeName(s) {
  return String(s || '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(HONORIFICS, ' ')
    .replace(/[.\-_,،]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** يربط موظفي الموارد البشرية غير المربوطين بالأشخاص: بالرقم الوظيفي = الرقم الداخلي، ثم بتطابق الاسم */
export async function autoLink() {
  const emps = (await q('SELECT id, emp_no, full_name FROM employees WHERE person_id IS NULL')).rows;
  const ppl = (await q('SELECT p.id, p.extension, p.full_name FROM people p WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.person_id = p.id)')).rows;
  const byExt = new Map(ppl.filter(p => p.extension !== null).map(p => [String(p.extension), p]));
  const byName = new Map();
  for (const p of ppl) { const k = normalizeName(p.full_name); byName.set(k, byName.has(k) ? null : p); }   // null = اسم مكرر فلا نخمّن
  const used = new Set();
  let linked = 0;
  for (const e of emps) {
    const p = byExt.get(String(e.emp_no)) || byName.get(normalizeName(e.full_name));
    if (!p || used.has(p.id)) continue;
    used.add(p.id);
    await q('UPDATE employees SET person_id = $1 WHERE id = $2', [p.id, e.id]);
    linked++;
  }
  // حسابات الدخول: تُربط بالشخص إذا طابق اسم المستخدم بريده قبل @
  await q(`UPDATE users u SET person_id = p.id FROM people p
           WHERE u.person_id IS NULL AND p.email IS NOT NULL AND lower(split_part(p.email, '@', 1)) = u.username
             AND (SELECT count(*) FROM people p2 WHERE lower(split_part(p2.email, '@', 1)) = u.username) = 1`);
  return { linked, unmatched_employees: emps.length - linked };
}
