// الترحيل 018: تسجيل منصة «أعضاء الجمعية العمومية» في الصلاحيات المركزية (الوحدة نفسها تُنشئ جداولها في مخطط members عند الإقلاع).
// access = الدخول للمنصة؛ ما يفعله المستخدم داخلها يحدده دوره في إعدادات النظام نفسه (ربط أدوار المنصة بأدوار الأعضاء).
export async function up(c) {
  await c.query(`INSERT INTO apps(slug, title, description, icon, path, roles, sort_order)
    VALUES ('members', 'أعضاء الجمعية العمومية', 'قاعدة بيانات الأعضاء والاشتراكات والسداد والتجديد والتنبيهات والتقارير', 'users', '/members/', '{}', 8)
    ON CONFLICT (slug) DO NOTHING`);
  await c.query("INSERT INTO app_actions(app_slug, action, label, sort_order) VALUES ('members', 'access', 'الوصول للمنصة', 0) ON CONFLICT DO NOTHING");
  const granted = [];
  for (const role of ['hr', 'finance', 'executive']) {
    const r = (await c.query('SELECT id FROM roles WHERE key = $1', [role])).rows[0];
    if (r) { await c.query("INSERT INTO role_grants(role_id, app_slug, action, scope) VALUES ($1,'members','access','all') ON CONFLICT DO NOTHING", [r.id]); granted.push(role); }
  }
  return { granted };
}
