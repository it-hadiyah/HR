// يولّد صورة PNG صالحة صغيرة للاختبارات (توقيع تجريبي) دون مكتبات خارجية
import zlib from 'node:zlib';
export function makePng(w = 90, h = 36) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const i = y * (w * 4 + 1) + 1 + x * 4; const on = (x * 7 + y * 13) % 11 < 3; raw[i] = 10; raw[i + 1] = 30; raw[i + 2] = 110; raw[i + 3] = on ? 255 : 0; } }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const pngDataUrl = (w, h) => `data:image/png;base64,${makePng(w, h).toString('base64')}`;
