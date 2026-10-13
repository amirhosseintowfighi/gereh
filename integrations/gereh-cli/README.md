# @gereh/cli

Deploy and manage [Gereh Apps](https://gereh.net/paas) from your terminal or CI. Zero dependencies, Node 20+.

```bash
npx @gereh/cli login                 # paste a read-write token from Panel › SSH و API
npx @gereh/cli init                  # writes gereh.json in this folder
npx @gereh/cli deploy -m "v1.4"      # ZIP apps: packs and uploads this folder; Git/image apps: rebuild
npx @gereh/cli logs --follow
npx @gereh/cli env import .env --secret
npx @gereh/cli setup agent            # connect Claude Code, Cursor, VS Code, Codex (MCP)
```

In CI set `GEREH_TOKEN` instead of logging in. Files listed in `.gerehignore` (or, if absent, `.gitignore`) are not uploaded; `node_modules`, `.git`, `.env` and build caches never are.

---

<div dir="rtl">

## راهنمای فارسی

CLI گره برای استقرار و مدیریت گره اپ از ترمینال یا CI است؛ بدون وابستگی و با Node.js نسخه ۲۰ به بالا.

### ورود و پروفایل‌ها

یک توکن **خواندن-نوشتن** در پنل › SSH و API بسازید:

</div>

```bash
gereh login                          # توکن را می‌پرسد و در پروفایل فعلی ذخیره می‌کند
gereh profile add staging --api https://gereh.net
gereh login --profile staging
gereh profile use staging            # پروفایل پیش‌فرض
gereh profile list
gereh --profile prod deploy          # یک بار با پروفایل دیگر (یا GEREH_PROFILE=prod)
```

<div dir="rtl">

پیکربندی در ‎`~/.config/gereh/config.json`‎ با دسترسی 600 ذخیره می‌شود. در CI به جای ورود، متغیر `GEREH_TOKEN` را بگذارید.

### پروژه

</div>

```bash
gereh init                           # gereh.json: نام اپ، دستور اجرا، پورت، مسیر سلامت، دستور انتشار
gereh init --app shop --yes          # بدون پرسش، با پیشنهادهای خودکار
gereh link shop                      # فقط اتصال پوشه به اپ موجود
```

<div dir="rtl">

### استقرار

</div>

```bash
gereh deploy -m "نسخه ۱.۴"           # اپ ZIP: پوشه فعلی فشرده و بارگذاری می‌شود؛ اپ Git: بیلد از آخرین کامیت
gereh deploy --no-cache              # بیلد بدون کش لایه‌ها
gereh deploy --image ghcr.io/acme/api:1.4.3        # اپ ایمیج: ایمیج جدید و استقرار
gereh deploy --git https://github.com/acme/api.git --branch release
gereh deploy --preview --branch feature/x          # پیش‌نمایش روی <نام>-preview
gereh promote                        # انتقال پیش‌نمایش به نسخه اصلی بدون بیلد دوباره
gereh status
```

<div dir="rtl">

### لاگ، کنسول و دستورها

</div>

```bash
gereh logs                           # ۱۰۰ خط آخر (--tail 500)
gereh logs --follow                  # لاگ زنده همه نمونه‌ها
gereh shell                          # اجرای دستور در نمونه در حال اجرا (هر خط یک دستور جدا)
gereh shell -- php artisan about     # یک دستور و خروج با کد همان دستور
gereh run python manage.py migrate   # کار یک‌باره از ایمیج فعال
gereh restart
```

<div dir="rtl">

### متغیرهای محیطی

</div>

```bash
gereh env set API_KEY=xyz --secret
gereh env unset OLD_KEY
gereh env import .env.production --secret   # همه متغیرهای فایل، با یک ری‌استارت
gereh env export > .env                      # یا --file .env (دسترسی 600)
```

<div dir="rtl">

### پایگاه داده

</div>

```bash
gereh db list
gereh db backup shop-db --wait
gereh db backup shop-db --download --file shop.dump
gereh db backups shop-db
```

<div dir="rtl">

### فضای ابری (S3)

</div>

```bash
gereh bucket list
gereh bucket create my-files --public
gereh bucket ls my-files reports/
gereh bucket put my-files ./report.pdf reports/2025.pdf
gereh bucket get my-files reports/2025.pdf
gereh bucket rm my-files reports/2025.pdf old/
```

<div dir="rtl">

### ایمیل

</div>

```bash
gereh mail domains
gereh mail send --from no-reply@shop.ir --to a@example.ir,b@example.ir --subject "سفارش شما" --text "ارسال شد"
cat body.txt | gereh mail send --from billing@shop.ir --to a@example.ir --subject "فاکتور"
gereh mail send --from billing@shop.ir --to a@example.ir --html-file invoice.html
```

<div dir="rtl">

همه دستورها از [API عمومی](https://gereh.net/docs/api) استفاده می‌کنند. راهنمای کامل: https://gereh.net/docs/paas — CI/CD: https://gereh.net/docs/paas/ci-cd

</div>
