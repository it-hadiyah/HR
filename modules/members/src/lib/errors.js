'use strict';
class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status; this.code = code || 'error'; this.details = details;
  }
}
const bad = (m, details, code = 'validation') => new AppError(400, m, code, details);
const forbidden = (m = 'ليست لديك صلاحية لتنفيذ هذا الإجراء') => new AppError(403, m, 'forbidden');
const notFound = (m = 'العنصر غير موجود') => new AppError(404, m, 'not_found');
const conflict = (m, code = 'conflict', details) => new AppError(409, m, code, details);
module.exports = { AppError, bad, forbidden, notFound, conflict };
