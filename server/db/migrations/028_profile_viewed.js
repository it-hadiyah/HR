// الترحيل 028: تسجيل أول مشاهدة للملف الشخصي (يُحوَّل الموظف إليه عند الدخول حتى يطّلع على بياناته مرة، ثم لا يتكرر)
export async function up(c) {
  await c.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ');
  return { column: 'viewed_at' };
}
