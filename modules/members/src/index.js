'use strict';
// نقطة دخول وحدة الأعضاء للمنصة الموحّدة
const { createRouter, PUBLIC } = require('./router');
const { migrate } = require('./db/migrate');
const { pool } = require('./db/pool');
const notifications = require('./services/notifications');
const exporter = require('./services/exporter');

let timer = null;
/** يطبّق ترحيلات الوحدة ويبدأ توليد التنبيهات الدورية (كل 6 ساعات). يُستدعى بعد تهيئة مخطط المنصة. */
async function init({ schedule = true } = {}) {
  await migrate();
  if (schedule && !timer) {
    const run = () => notifications.generate().then((r) => r.created && console.log(`members: تنبيهات جديدة ${r.created}`)).catch((e) => console.error('members notifications:', e.message));
    run();
    timer = setInterval(run, 6 * 60 * 60 * 1000);
    timer.unref();
  }
}
async function close() { clearInterval(timer); timer = null; await exporter.closeBrowser(); await pool.end(); }

module.exports = { router: createRouter(), PUBLIC, init, close };
