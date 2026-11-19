// الترحيل 017: وحدة «تقارير مبيعات» (تحليل نقطة البيع): يُرفق ملف الإكسل فيتحول إلى تقرير تفاعلي في المتصفح دون حفظ بالقاعدة.
export async function up(c) {
  await c.query(`INSERT INTO apps(slug, title, description, icon, path, roles, sort_order)
    VALUES ('sales-reports', 'تقارير مبيعات', 'ارفع ملف إكسل تحليل نقطة البيع ليتحول إلى تقرير تفاعلي بفلاتر ورسوم (يُقرأ في المتصفح ولا يُحفظ)', 'chart-column', '/sales-reports/', '{}', 7)
    ON CONFLICT (slug) DO NOTHING`);
  await c.query("INSERT INTO app_actions(app_slug, action, label, sort_order) VALUES ('sales-reports', 'access', 'الوصول للمنصة', 0) ON CONFLICT DO NOTHING");
  const granted = [];
  for (const role of ['executive', 'finance']) {
    const r = (await c.query('SELECT id FROM roles WHERE key = $1', [role])).rows[0];
    if (r) { await c.query("INSERT INTO role_grants(role_id, app_slug, action, scope) VALUES ($1,'sales-reports','access','all') ON CONFLICT DO NOTHING", [r.id]); granted.push(role); }
  }
  return { granted };
}
