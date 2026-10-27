# نشر المنصة على الخادم

المنصة عملية Node.js واحدة تتصل بـ PostgreSQL. اختر الأنسب لخادمك.

## 1) خادم ويندوز (مثل خادم IIS الحالي)

1. ثبّت **Node.js 20+ (LTS)** من nodejs.org، وتأكد أن **PostgreSQL** يعمل (`psql --version`).
2. انسخ المشروع إلى مجلد مثل `C:\apps\hadiyah-platform` (أو `git clone`)، ثم في PowerShell:
   ```powershell
   cd C:\apps\hadiyah-platform
   npm install --omit=dev
   copy .env.example .env      # ثم عدّل .env (القاعدة، JWT_SECRET، ADMIN_PASSWORD، PORT)
   npm run setup
   ```
   ضع في `.env` عنوانين: `DATABASE_URL` (مستخدم القاعدة الجديد) و`PG_ADMIN_URL` (حساب `postgres`) — الثاني لازم لأمر `db:create` فقط، ويمكن حذفه بعده.
3. شغّل كخدمة ويندوز تعمل تلقائياً (باستخدام NSSM، أو `pm2` كبديل):
   ```powershell
   nssm install HadiyahPlatform "C:\Program Files\nodejs\node.exe" "server\index.js"
   nssm set HadiyahPlatform AppDirectory C:\apps\hadiyah-platform
   nssm start HadiyahPlatform
   ```
   افتح المنفذ في جدار الحماية: `New-NetFirewallRule -DisplayName Hadiyah -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow`
4. **رابط واحد على IIS (اختياري):** ثبّت *URL Rewrite* و*Application Request Routing*، فعّل Proxy من ARR، وضع في `web.config` للموقع:
   ```xml
   <rule name="Hadiyah" stopProcessing="true"><match url="(.*)" /><action type="Rewrite" url="http://localhost:3000/{R:1}" /></rule>
   ```
   (داخل `<system.webServer><rewrite><rules>`) واضبط `TRUST_PROXY=1`. مع HTTPS اضبط `COOKIE_SECURE=1`.
   **وأوقف تطبيق البوابة القديم على IIS** (أو غيّر منفذه) كي لا يتعارض الرابط.

## 2) خادم لينكس

```bash
sudo apt install -y nodejs npm postgresql      # Node 20+ مطلوب
git clone <المستودع> /opt/hadiyah && cd /opt/hadiyah
npm ci --omit=dev && cp .env.example .env && nano .env
sudo -u postgres true && npm run setup
```
خدمة systemd (`/etc/systemd/system/hadiyah.service`):
```ini
[Unit]
Description=Hadiyah Platform
After=network.target postgresql.service
[Service]
WorkingDirectory=/opt/hadiyah
ExecStart=/usr/bin/node server/index.js
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
```
ثم `systemctl enable --now hadiyah`. ضع nginx أمامها (`proxy_pass http://127.0.0.1:3000;` مع `client_max_body_size 30m;`) و`TRUST_PROXY=1`.

## 3) Docker

```bash
export JWT_SECRET=$(openssl rand -hex 32) DB_PASSWORD=كلمة_مرور_قوية ADMIN_PASSWORD=كلمة_مرور_المدير
docker compose up -d
docker compose exec app npm run db:seed
docker compose exec app npm run db:import-legacy
```

## ترقية نسخة قائمة (فيها بيانات)

```powershell
cd C:\apps\hadiyah-platform
npm run db:backup          # نسخة يدوية احتياطية (اختيارية؛ الترحيل يأخذ نسخته بنفسه)
npm run db:report          # تقرير التكرارات والتعارضات قبل الترحيل
git pull; npm install --omit=dev
nssm restart HadiyahPlatform     # عند الإقلاع: نسخة احتياطية في backups\ ثم تطبيق الترحيلات
```
- إن تعذّر `pg_dump` تُحفظ لقطة JSON لكل الجداول بدلاً منه (تُذكر في السجل).
- الاستعادة: `pg_restore --clean --if-exists --no-owner -d hadiyah backups\<الملف>.dump`.
- لإيقاف الترحيل التلقائي اضبط `AUTO_MIGRATE=0` ونفّذ `npm run db:migrate` عند الجاهزية.

## بعد التشغيل

- افتح `http://عنوان-الخادم:3000/` وادخل بـ `admin` وكلمة `ADMIN_PASSWORD`، ثم غيّرها.
- أنشئ حسابات المستخدمين من الإدارة المركزية ← المستخدمون (اربط الحساب بالموظف واختر دوره: `employee` للموظف العادي، `content_admin` لمسؤول البوابة، `hr`، `finance`…).
- البوابة تفتح للجميع بلا دخول، وفي أعلاها زرا «الدخول على الأرصدة» و«الدخول على التقارير» يفتحان صفحة تسجيل الدخول. لإلزام الدخول للبوابة نفسها: الإدارة المركزية ← الإعدادات ← إلغاء «بوابة الموظفين مفتوحة» (المتغير `PORTAL_PUBLIC` قيمة أولية فقط).
- **الإدارة المركزية** على `/admin/` (لمدير النظام): الموظفون، الهيكل، المستخدمون والأدوار والصلاحيات، الجلسات، سجل العمليات.
- **النسخ الاحتياطي:** `pg_dump -Fc hadiyah > hadiyah.dump` يومياً، مع نسخ `modules/portal/policies` و`modules/portal/images`.
- **التحديث:** `git pull && npm ci --omit=dev` ثم أعد تشغيل الخدمة (الجداول تُحدَّث تلقائياً عند الإقلاع، ولا تُحذف بيانات).
- **استيراد موظفي الإجازات:** من نظام الإجازات ← «الاستيراد» (Excel) كما كان، ثم زر «ربط تلقائي» في الصفحة الرئيسية للمنصة.
