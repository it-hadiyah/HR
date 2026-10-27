// سياق الطلب الحالي (المستخدم، العنوان، الجلسة، معرّف الطلب) يصل لأي طبقة دون تمريره يدوياً، فيستفيد منه سجل التدقيق
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const als = new AsyncLocalStorage();
export const getCtx = () => als.getStore() || {};

/** يحدد المنصة من مسار الطلب */
export function platformOf(url = '') {
  const u = url.split('?')[0];
  if (u.startsWith('/api/portal-admin') || u.startsWith('/portal/admin')) return 'portal-admin';
  if (u.startsWith('/api/core') || u.startsWith('/admin')) return 'admin';
  if (u.startsWith('/portal') ) return 'portal';
  if (u.startsWith('/card') || u.startsWith('/api/directory') || u.startsWith('/api/card')) return 'card';
  if (u.startsWith('/report-builder')) return 'report-builder';
  if (u.startsWith('/hr') || /^\/api\/(org|employees|leaves|targets|dashboard|reports|import|admin)(\/|$)/.test(u)) return 'hr';
  return 'platform';
}

export function requestContext(req, res, next) {
  als.run({ requestId: crypto.randomUUID(), ip: req.ip, ua: (req.get('user-agent') || '').slice(0, 300), platform: platformOf(req.originalUrl) }, next);
}

/** يضيف بيانات المستخدم والجلسة إلى سياق الطلب بعد المصادقة */
export function bindUser(user, sessionId) {
  const c = als.getStore();
  if (c) { c.user = { id: user.id, username: user.username }; c.sessionId = sessionId; }
}
