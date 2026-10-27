// يولّد public/shared/icons.js من أيقونات Lucide (ترخيص ISC): مجموعة أيقونات SVG موحّدة بلا اعتماد وقت التشغيل.
// التشغيل: npm run build:icons   (يحتاج lucide-static كاعتماد تطوير)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'node_modules/lucide-static/icons');
const NAMES = ['building-2', 'calendar-days', 'id-card', 'chart-column', 'layout-template', 'shield-check', 'settings', 'log-out', 'house', 'layout-grid', 'users', 'network',
  'user-cog', 'key-round', 'scroll-text', 'menu', 'chevron-down', 'search', 'plus', 'pencil', 'trash-2', 'check', 'x', 'download', 'eye', 'lock', 'monitor', 'history',
  'layout-dashboard', 'sliders-horizontal', 'user-round', 'refresh-cw', 'triangle-alert', 'ban', 'save', 'database', 'git-merge', 'shield-alert', 'activity', 'user-plus',
  'folder-tree', 'badge-check', 'circle-check', 'clock', 'globe', 'power', 'file-down', 'arrow-left-right', 'moon', 'sun', 'log-in', 'file-pen-line'];
const out = {};
for (const n of NAMES) {
  const f = path.join(dir, `${n}.svg`);
  if (!fs.existsSync(f)) throw new Error(`أيقونة غير موجودة: ${n}`);
  out[n] = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<svg[\s\S]*?>/, '').replace('</svg>', '').replace(/\s+/g, ' ').trim();
}
const js = `// مولَّد آلياً بواسطة scripts/build-icons.mjs من Lucide (ISC License، https://lucide.dev). لا تعدّله يدوياً.
const PATHS = ${JSON.stringify(out, null, 1)};

/** يعيد وسم SVG لأيقونة Lucide بالاسم (يرث اللون من currentColor) */
export function icon(name, size = 18, extra = '') {
  const body = PATHS[name] ?? PATHS['layout-grid'];
  return \`<svg xmlns="http://www.w3.org/2000/svg" width="\${size}" height="\${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" \${extra}>\${body}</svg>\`;
}
export const iconNames = Object.keys(PATHS);
`;
fs.writeFileSync(path.join(root, 'public/shared/icons.js'), js);
console.log(`تم توليد ${NAMES.length} أيقونة`);
