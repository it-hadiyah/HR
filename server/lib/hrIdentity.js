// ربط حساب المستخدم بسجل الموظف المشترك (leave_staff) وبالعكس: بالرابط المباشر source_employee_id أو بالرقم الوظيفي.
import { q } from '../db/pool.js';

/** سجل الموظف النشط المرتبط بحساب المستخدم */
export async function myStaff(user) {
  if (!user?.employee_id) return null;
  return (await q(`SELECT s.* FROM leave_staff s WHERE s.status = 'active' AND (s.source_employee_id = $1
      OR (s.emp_no IS NOT NULL AND s.emp_no = (SELECT emp_no FROM employees WHERE id = $1))) ORDER BY s.id LIMIT 1`, [user.employee_id])).rows[0] || null;
}

/** حساب مستخدم نشط مرتبط بسجل موظف (أو null) */
export async function userForStaff(staffId) {
  return (await q(`SELECT u.id, u.full_name, u.username FROM users u JOIN leave_staff s ON s.id = $1
    WHERE u.active AND u.employee_id IS NOT NULL AND (s.source_employee_id = u.employee_id
      OR (s.emp_no IS NOT NULL AND s.emp_no = (SELECT emp_no FROM employees WHERE id = u.employee_id))) ORDER BY u.id LIMIT 1`, [staffId])).rows[0] || null;
}

/** شرط SQL: الموظف (s) له حساب مستخدم نشط */
export const HAS_ACCOUNT_SQL = `EXISTS (SELECT 1 FROM users u WHERE u.active AND u.employee_id IS NOT NULL AND (s.source_employee_id = u.employee_id
  OR (s.emp_no IS NOT NULL AND s.emp_no = (SELECT emp_no FROM employees WHERE id = u.employee_id))))`;
