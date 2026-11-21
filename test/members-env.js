// يُستورد أولًا في اختبارات الأعضاء ليضبط البيئة قبل تحميل أي وحدة تقرأها
// قاعدة الاختبار صريحة (يجب أن ينتهي اسمها بـ _test) ولا يوجد افتراضي كي لا يُلمس أي قاعدة أخرى
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-for-production';
process.env.MEMBERS_UPLOAD_DIR = (await import('node:path')).join((await import('node:os')).tmpdir(), 'hadiyah-members-test-uploads');
