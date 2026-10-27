import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from './lib/auth.js';
import { initSchema } from './db/init.js';
import authRoutes from './routes/auth.js';
import orgRoutes from './routes/org.js';
import employeeRoutes from './routes/employees.js';
import leaveRoutes from './routes/leaves.js';
import targetRoutes from './routes/targets.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import importRoutes from './routes/importer.js';
import adminRoutes from './routes/admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], fontSrc: ["'self'", 'data:'] } },
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }), authRoutes);
app.use('/api', authenticate);
app.use('/api/org', orgRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/targets', targetRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/import', importRoutes);
app.use('/api/admin', adminRoutes);

app.use('/vendor/chart.js', express.static(path.join(here, '../node_modules/chart.js/dist/chart.umd.js')));
app.use(express.static(path.join(here, '../public')));

app.use((err, req, res, _next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'السجل موجود مسبقاً (قيمة مكررة)' });
  if (err.code === '23503') return res.status(409).json({ error: 'لا يمكن تنفيذ العملية لوجود سجلات مرتبطة' });
  if (err.code === '23514' || err.code === '22P02' || err.code === '22007' || err.code === '22008') return res.status(400).json({ error: 'قيمة غير صالحة' });
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع' });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await initSchema();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`النظام يعمل على http://localhost:${port}`));
}
