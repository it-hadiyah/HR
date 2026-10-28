// الترحيل 006: السماح بقيم سالبة في المستهدف والمستخدم (الرصيد السالب = مستحق على الموظف) بإزالة قيود CHECK عليهما.
export async function up(c) {
  const { rows } = await c.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'leave_tracking'::regclass AND contype = 'c'
    AND (pg_get_constraintdef(oid) LIKE '%target_days%' OR pg_get_constraintdef(oid) LIKE '%used_days%')`);
  for (const r of rows) await c.query(`ALTER TABLE leave_tracking DROP CONSTRAINT IF EXISTS "${r.conname}"`);
  return { dropped: rows.map(r => r.conname) };
}
