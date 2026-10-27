import { canSeeFinancials } from './auth.js';

export const httpError = (status, message) => Object.assign(new Error(message), { status });
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const num = (v, dflt = null) => (v === '' || v === null || v === undefined ? dflt : Number(v));

const FIN_EMP = ['basic_salary', 'leave_salary_override'];
const FIN_M = ['leave_salary', 'day_rate', 'value_now', 'value_year_end'];

/** يخفي الحقول المالية الفردية عن أدوار المديرين (يرون الإجماليات فقط) */
export function redactEmployee(e, user) {
  if (canSeeFinancials(user)) return e;
  const out = { ...e, m: { ...e.m } };
  for (const k of FIN_EMP) delete out[k];
  for (const k of FIN_M) delete out.m[k];
  return out;
}

export function publicEmployee(e, user) {
  const { path_ids, ...rest } = redactEmployee(e, user);
  return { ...rest, path_ids };
}
