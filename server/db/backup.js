// نسخة احتياطية قبل أي ترحيل: pg_dump إن وُجد (قابلة للاستعادة بـ pg_restore)، وإلا لقطة JSON للجداول المعرّضة للتغيير.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backups');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function findPgDump() {
  const cands = [process.env.PG_DUMP_PATH, 'pg_dump'];
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\PostgreSQL';
    if (fs.existsSync(base)) for (const v of fs.readdirSync(base).sort().reverse()) cands.push(path.join(base, v, 'bin', 'pg_dump.exe'));
  } else cands.push('/usr/bin/pg_dump', '/usr/local/bin/pg_dump');
  for (const c of cands.filter(Boolean)) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}

/** يعيد وصف النسخة: { kind, file } أو يرمي خطأ إن تعذّرت */
export async function backupDatabase(pool, reason = 'migration') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dump = findPgDump();
  if (dump) {
    const file = path.join(BACKUP_DIR, `${stamp()}-${reason}.dump`);
    // كلمة المرور تُمرَّر عبر PGPASSWORD لا عبر سطر الأوامر (حتى لا تظهر في قائمة العمليات)
    const u = new URL(process.env.DATABASE_URL || 'postgres://hadiyah:hadiyah@localhost:5432/hadiyah');
    const r = spawnSync(dump, ['--format=custom', '--no-owner', `--file=${file}`, '-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), decodeURIComponent(u.pathname.slice(1))],
      { encoding: 'utf8', env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) } });
    if (r.status === 0) return { kind: 'pg_dump', file };
    console.warn('تعذّر pg_dump:', (r.stderr || '').trim().split('\n')[0]);
  }
  // بديل: لقطة منطقية بصيغة JSON لكل الجداول المهمة
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map(r => r.tablename);
  const snap = {};
  for (const t of tables) snap[t] = (await pool.query(`SELECT * FROM "${t}"`)).rows;
  const file = path.join(BACKUP_DIR, `${stamp()}-${reason}.json`);
  fs.writeFileSync(file, JSON.stringify(snap));
  return { kind: 'json', file };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { pool } = await import('./pool.js');
  const b = await backupDatabase(pool, 'manual');
  console.log(`تم حفظ نسخة احتياطية (${b.kind}): ${b.file}`);
  if (b.kind === 'pg_dump') console.log('للاستعادة: pg_restore --clean --if-exists --no-owner -d <قاعدة> <الملف>');
  await pool.end();
}
