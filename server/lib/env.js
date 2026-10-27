// يقرأ ملف .env (إن وُجد) دون مكتبات خارجية؛ لا يستبدل متغيرات البيئة المضبوطة مسبقاً
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
