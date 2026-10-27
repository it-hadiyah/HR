// إعدادات المنصة (جدول platform_settings) مع ذاكرة مؤقتة قصيرة
import { q } from '../db/pool.js';

let cache = { at: 0, map: new Map() };
async function load() {
  if (Date.now() - cache.at > 10000) {
    const { rows } = await q('SELECT key, value FROM platform_settings');
    cache = { at: Date.now(), map: new Map(rows.map(r => [r.key, r.value])) };
  }
  return cache.map;
}
export async function getSetting(key, dflt = null) { const m = await load(); return m.has(key) ? m.get(key) : dflt; }
export async function allSettings() { return Object.fromEntries(await load()); }
export async function setSetting(key, value, by) {
  await q(`INSERT INTO platform_settings(key, value, updated_by, updated_at) VALUES ($1,$2,$3,now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [key, JSON.stringify(value), by ?? null]);
  cache.at = 0;
}
export const resetSettingsCache = () => { cache.at = 0; };
