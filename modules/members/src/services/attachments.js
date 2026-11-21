'use strict';
// رفع المرفقات: أنواع محددة (PDF/PNG/JPG) مع فحص البصمة الثنائية، أسماء عشوائية خارج الجذر العام.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { pool, tx } = require('../db/pool');
const audit = require('./audit');
const { bad, notFound } = require('../lib/errors');
const N = require('../lib/normalize');

const SIGS = [
  { mime: 'application/pdf', ext: '.pdf', test: (b) => b.slice(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: '.png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];
const dir = () => { const d = path.join(config.uploadDir, 'attachments'); fs.mkdirSync(d, { recursive: true, mode: 0o750 }); return d; };

function detect(buf) {
  const s = SIGS.find((x) => x.test(buf));
  if (!s) throw bad('نوع الملف غير مسموح. المسموح: PDF أو PNG أو JPG');
  return s;
}

async function save(ctx, { memberId, paymentId = null, kind, file }) {
  if (!file?.buffer?.length) throw bad('لم يتم اختيار ملف');
  if (file.buffer.length > config.maxUploadBytes) throw bad('حجم الملف يتجاوز 5 ميغابايت');
  const sig = detect(file.buffer);
  const stored = crypto.randomBytes(24).toString('hex') + sig.ext;
  const original = (N.clean(path.basename(String(file.originalname || 'file').normalize('NFC'))) || 'file').slice(0, 120);
  const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const full = path.join(dir(), stored);
  fs.writeFileSync(full, file.buffer, { mode: 0o640 });
  try {
    return await tx(async (c) => {
      const m = await c.query('SELECT id FROM members WHERE id=$1', [memberId]);
      if (!m.rows[0]) throw notFound('العضو غير موجود');
      if (paymentId) {
        const p = await c.query('SELECT member_id FROM payments WHERE id=$1', [paymentId]);
        if (!p.rows[0] || p.rows[0].member_id !== Number(memberId)) throw notFound('عملية السداد غير موجودة لهذا العضو');
      }
      const r = await c.query(
        `INSERT INTO payment_attachments (payment_id, member_id, kind, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, payment_id, member_id, kind, original_name, mime_type, size_bytes, uploaded_at`,
        [paymentId, memberId, kind, original, stored, sig.mime, file.buffer.length, sha, ctx.user.id]);
      await audit.log(c, ctx, { action: 'attachment.upload', entity: 'attachment', entityId: r.rows[0].id,
        after: { member_id: Number(memberId), payment_id: paymentId, kind, name: original, size: file.buffer.length } });
      return r.rows[0];
    });
  } catch (e) { fs.rmSync(full, { force: true }); throw e; }
}

async function open(id) {
  const r = await pool.query('SELECT * FROM payment_attachments WHERE id=$1 AND deleted_at IS NULL', [id]);
  const a = r.rows[0];
  if (!a) throw notFound('المرفق غير موجود');
  const full = path.join(dir(), a.stored_name);
  if (path.dirname(full) !== dir() || !fs.existsSync(full)) throw notFound('ملف المرفق مفقود');
  return { att: a, full };
}

/** حذف منطقي فقط (يحفظ الملف للتدقيق المالي) */
async function remove(ctx, id) {
  return tx(async (c) => {
    const a = (await c.query('SELECT * FROM payment_attachments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
    if (!a) throw notFound('المرفق غير موجود');
    if (a.kind === 'receipt') throw bad('إيصالات السداد لا تُحذف للحفاظ على السجل المالي');
    await c.query('UPDATE payment_attachments SET deleted_at=now() WHERE id=$1', [id]);
    await audit.log(c, ctx, { action: 'attachment.delete', entity: 'attachment', entityId: id, before: { member_id: a.member_id, name: a.original_name } });
    return a;
  });
}

module.exports = { save, open, remove, detect, dir };
