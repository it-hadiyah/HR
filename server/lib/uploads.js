// رفع الملفات (صور الموظفين، السياسات، صور الروابط…): فحص النوع والمحتوى والحجم، ولا يُستبدل ملف موجود.
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { httpError } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PORTAL_DIR = path.resolve(here, '../../modules/portal');
const IMG = ['.png', '.jpg', '.jpeg', '.webp'];
export const RULES = {
  policies: { dir: 'policies', exts: ['.pdf'], maxMb: 25 },
  'employee-photos': { dir: 'images/content/employee-info', exts: IMG, maxMb: 5 },
  'link-images': { dir: 'images/content/library-links', exts: IMG, maxMb: 5 },
  ads: { dir: 'images/ads', exts: IMG, maxMb: 8 },
  'location-photos': { dir: 'images/content/locations', exts: IMG, maxMb: 5 },
};
export const uploadMiddleware = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }).single('file');

const magicOk = (ext, b) => {
  if (b.length < 12) return false;
  switch (ext) {
    case '.pdf': return b.subarray(0, 4).toString('latin1') === '%PDF';
    case '.png': return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case '.jpg': case '.jpeg': return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case '.webp': return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
    default: return false;
  }
};

export const safeName = raw => {
  const base = path.basename(raw || '');
  const ext = path.extname(base).toLowerCase();
  let stem = path.basename(base, path.extname(base)).replace(/[^\p{L}\p{N}\-_ ()]/gu, '_').replace(/^[ _.]+|[ _.]+$/g, '');
  if (!stem) stem = 'file';
  return stem.slice(0, 80) + ext;
};

/** يحفظ ملف multer حسب قاعدة الرفع ويعيد { name, url } (url نسبي لجذر البوابة). stem يحدد اسماً مخصصاً بلا امتداد */
export function saveUploadedFile(ruleKey, f, { stem: forcedStem } = {}) {
  const rule = RULES[ruleKey];
  if (!rule) throw httpError(400, 'مجلد غير مسموح.');
  if (!f) throw httpError(400, 'لم يتم اختيار ملف.');
  if (f.size > rule.maxMb * 1024 * 1024) throw httpError(400, `حجم الملف غير مسموح (الحد الأقصى ${rule.maxMb} ميجابايت).`);
  const name = safeName(Buffer.from(f.originalname, 'latin1').toString('utf8'));
  const ext = path.extname(name).toLowerCase();
  if (!rule.exts.includes(ext)) throw httpError(400, `نوع الملف غير مسموح. المسموح: ${rule.exts.join(' ')}`);
  if (!magicOk(ext, f.buffer)) throw httpError(400, 'محتوى الملف لا يطابق نوعه.');
  const dir = path.join(PORTAL_DIR, rule.dir);
  fs.mkdirSync(dir, { recursive: true });
  const stem = forcedStem || path.basename(name, ext);
  let final = `${stem}${ext}`;
  for (let n = 2; fs.existsSync(path.join(dir, final)); n++) final = `${stem}-${n}${ext}`;   // لا يُستبدل ملف موجود
  fs.writeFileSync(path.join(dir, final), f.buffer, { flag: 'wx' });
  return { name: final, url: `${rule.dir}/${final}` };
}
