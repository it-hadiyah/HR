// الترحيل 024: تقييم الخدمة بالنجوم (1-5) قبل أن يحمّل الموظف المستند المعتمد: رضاه عن الخدمة، ورضاه عن سرعة التعامل، وتعليق اختياري.
export async function up(c) {
  await c.query(`ALTER TABLE hr_requests
    ADD COLUMN IF NOT EXISTS rating_service SMALLINT CHECK (rating_service BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS rating_speed   SMALLINT CHECK (rating_speed BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS rating_comment TEXT,
    ADD COLUMN IF NOT EXISTS rated_at       TIMESTAMPTZ`);
  return { columns: ['rating_service', 'rating_speed', 'rating_comment', 'rated_at'] };
}
