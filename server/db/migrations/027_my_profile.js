// الترحيل 027: «ملفي الشخصي» — يرى الموظف بياناته المعبّأة من الموارد البشرية ويحفظ توقيعه الخاص ليوقّع به داخل المنصة.
//  - user_profiles: توقيع المستخدم (صورة PNG/JPG/WebP ≤ 200KB) وتأكيده لبياناته
//  - hr_loans.requester_signature: لقطة توقيع صاحب طلب السلفة وقت الرفع (للنموذج فقط)
export async function up(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id                 INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      signature               BYTEA,
      signature_mime          TEXT,
      signature_updated_at    TIMESTAMPTZ,
      confirmed_at            TIMESTAMPTZ,
      confirmed_staff_version INTEGER
    );
    ALTER TABLE hr_loans ADD COLUMN IF NOT EXISTS requester_signature TEXT;`);
  await c.query(`INSERT INTO apps(slug, title, description, icon, path, roles, sort_order)
    VALUES ('my-profile', 'ملفي الشخصي', 'بياناتي كما عبّأتها الموارد البشرية وتوقيعي الخاص للتوقيع على الطلبات والخطابات', 'user-round', '/my-profile/', '{}', 0)
    ON CONFLICT (slug) DO NOTHING`);
  return { tables: ['user_profiles'] };
}
