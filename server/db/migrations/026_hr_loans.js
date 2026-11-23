// الترحيل 026: «طلبات السلف» — يرفع الموظف طلب سلفة ويحدد كفيلاً، فيصل الطلب للكفيل ليعتمده ويضع بياناته، ثم يذهب للموارد البشرية.
// خصوصية: بيانات الكفيل وملاحظات القرارات والنموذج نفسه لا يراها إلا مراجعو الموارد البشرية؛ يرى الموظف والكفيل حالة الطلب فقط.
// جدول مستقل عن hr_requests كي لا تمر بياناته عبر مسارات الخطابات التي يراها الموظف.
export async function up(c) {
  await c.query(`
    CREATE SEQUENCE IF NOT EXISTS hr_loans_ref_seq;
    CREATE TABLE IF NOT EXISTS hr_loans (
      id                  SERIAL PRIMARY KEY,
      ref_no              TEXT NOT NULL UNIQUE,
      employee_id         INTEGER NOT NULL REFERENCES leave_staff(id) ON DELETE CASCADE,
      requester_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      months              INTEGER NOT NULL CHECK (months BETWEEN 1 AND 60),
      reason              TEXT,
      guarantor_staff_id  INTEGER NOT NULL REFERENCES leave_staff(id) ON DELETE CASCADE,
      guarantor_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status              TEXT NOT NULL DEFAULT 'pending_guarantor' CHECK (status IN ('pending_guarantor','pending_hr','approved','rejected','cancelled')),
      rejected_by         TEXT CHECK (rejected_by IN ('guarantor','hr')),
      guarantor_decided_at TIMESTAMPTZ,
      guarantor_note      TEXT,
      guarantor_data      JSONB,
      hr_decided_by       TEXT,
      hr_decided_at       TIMESTAMPTZ,
      hr_note             TEXT,
      approved_amount     NUMERIC(12,2),
      approved_months     INTEGER,
      document_text       TEXT,
      document_data       JSONB,
      document_hash       TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS hr_loans_status_idx ON hr_loans(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS hr_loans_requester_idx ON hr_loans(requester_user_id);
    CREATE INDEX IF NOT EXISTS hr_loans_guarantor_idx ON hr_loans(guarantor_user_id, status);`);
  return { table: 'hr_loans' };
}
