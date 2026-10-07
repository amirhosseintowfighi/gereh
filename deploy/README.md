# نصب گره روی سرور

یک اسکریپت همه چیز را روی یک سرور خالی راه می‌اندازد:
- Node.js و PostgreSQL؛
- برنامه به‌صورت سرویس systemd، همراه با worker پس‌زمینه؛
- Nginx، گواهی SSL رایگان، دیواره آتش و پشتیبان‌گیری روزانه.

اجرای دوباره اسکریپت امن است: رمزها، پایگاه داده و تنظیمات قبلی حفظ می‌شوند.

## پیش‌نیازها

| مورد | حداقل |
|---|---|
| سیستم‌عامل | Ubuntu 22.04 یا 24.04 (پیشنهادی)، Debian 12 یا 13 |
| پردازنده و حافظه | ۲ هسته، ۲ گیگابایت رم (اگر کمتر باشد، اسکریپت swap می‌سازد) |
| فضای دیسک | ۵ گیگابایت خالی |
| دسترسی | کاربر root یا sudo |
| دامنه (اختیاری) | رکورد A دامنه (و در صورت نیاز www) به IP سرور |

بدون دامنه هم نصب انجام می‌شود و سایت روی IP سرور با http بالا می‌آید.

## نصب در سه قدم

```bash
# ۱. دریافت کد
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/amirhosseintowfighi/gereh.git
cd gereh

# ۲. نصب (سؤال‌ها را جواب دهید)
sudo bash deploy/install.sh

# یا بدون سؤال:
sudo bash deploy/install.sh --domain gereh.cloud --email ops@gereh.cloud --yes
```

۳. در پایان، نشانی سایت، ایمیل و رمز مدیر اصلی نمایش داده می‌شود؛ یک نسخه از آن هم در `/root/gereh-install.txt` ذخیره می‌شود. با همین مشخصات وارد `/admin` شوید و **رمز را عوض کنید**.

ساخت برنامه بسته به سرور ۳ تا ۱۰ دقیقه طول می‌کشد.

## گزینه‌ها

| گزینه | توضیح |
|---|---|
| `--domain` | دامنه سایت؛ بدون آن، سایت روی IP سرور بالا می‌آید |
| `--email` | ایمیل برای گواهی Let's Encrypt (لازم برای SSL) |
| `--admin-email` و `--admin-password` | حساب مدیر اصلی؛ اگر رمز ندهید، یک رمز قوی ساخته می‌شود |
| `--www` / `--no-www` | سرو کردن www.دامنه و هدایت آن به دامنه اصلی (پیش‌فرض: اگر DNS آن تنظیم باشد) |
| `--branch` | شاخه یا تگ برای نصب |
| `--npm-registry` | آینه npm، اگر registry.npmjs.org کند یا در دسترس نیست |
| `--node-mirror` | آینه دانلود Node.js |
| `--port` | پورت داخلی برنامه (پیش‌فرض 3000؛ از بیرون بسته است) |
| `--no-ssl` / `--no-firewall` / `--no-backup` | رد کردن هر کدام از این مراحل |
| `--demo` | پر کردن پایگاه داده خالی با داده نمایشی؛ **فقط برای سرور آزمایشی** |
| `--yes` | بدون پرسیدن سؤال |

همه گزینه‌ها: `bash deploy/install.sh --help`

## مدیریت روزمره با دستور `gereh`

| دستور | کار |
|---|---|
| `sudo gereh status` | وضعیت سرویس، نسخه فعال، نسخه‌های قبلی و آخرین پشتیبان |
| `sudo gereh logs -f` | لاگ زنده برنامه |
| `sudo gereh update` | دریافت آخرین کد، ساخت نسخه جدید و جابه‌جایی؛ اگر نسخه جدید بالا نیاید، **خودکار به نسخه قبل برمی‌گردد** |
| `sudo gereh update --ref v1.2.0` | نصب یک شاخه، تگ یا کامیت مشخص |
| `sudo gereh rollback` | بازگشت دستی به نسخه قبلی |
| `sudo gereh env` | ویرایش تنظیمات (درگاه پرداخت، پیامک، ایمیل، Virtualizor…) و راه‌اندازی مجدد |
| `sudo gereh ssl` | صدور یا تمدید دوباره گواهی SSL |
| `sudo gereh backup` | پشتیبان‌گیری فوری |
| `sudo gereh restore /var/backups/gereh/gereh-….dump` | بازگرداندن پایگاه داده از پشتیبان |
| `sudo gereh restart` | راه‌اندازی مجدد |

قبل از هر به‌روزرسانی، از پایگاه داده پشتیبان گرفته می‌شود و سه نسخه آخر برنامه برای بازگشت نگه داشته می‌شوند. توقف سرویس فقط چند ثانیهٔ راه‌اندازی مجدد است؛ ساخت نسخه جدید در کنار نسخه فعال انجام می‌شود.

## اتصال سرویس‌های واقعی

هر سرویسی که مشخصاتش وارد نشده باشد، در حالت شبیه‌ساز کار می‌کند. مشخصات را با `sudo gereh env` وارد کنید:

| سرویس | متغیرها |
|---|---|
| درگاه زرین‌پال یا آیدی‌پی | `ZARINPAL_MERCHANT` یا `IDPAY_API_KEY` |
| پیامک کاوه‌نگار | `KAVENEGAR_API_KEY`، `KAVENEGAR_SENDER` |
| ایمیل | `SMTP_HOST`، `SMTP_PORT`، `SMTP_USER`، `SMTP_PASS`، `SMTP_FROM` |
| Virtualizor | `VIRTUALIZOR_HOST`، `VIRTUALIZOR_KEY`، `VIRTUALIZOR_PASS` (یا از پنل مدیریت › اتصال Virtualizor) |
| هاست cPanel/WHM | `WHM_HOST`، `WHM_TOKEN` |
| DNS (PowerDNS) | `PDNS_URL`، `PDNS_API_KEY` |
| دامنه بین‌المللی (ResellerClub) | `RC_USER_ID`، `RC_API_KEY`، `RC_CUSTOMER_ID`، `RC_CONTACT_ID` |
| صندوق دریافت پیام‌ها | `CONTACT_INBOX`، `DEVOPS_INBOX` |

فهرست کامل با توضیح در `.env.example` است. تغییر متغیرهای `NEXT_PUBLIC_*` (مثل نشانی سایت) فقط با `sudo gereh update` اعمال می‌شود، چون داخل برنامه ساخته‌شده قرار می‌گیرند.

> `APP_SECRET` رمزهایی را که در پنل مدیریت ذخیره می‌کنید، رمزگذاری می‌کند. **هرگز آن را تغییر ندهید** و همراه پشتیبان‌ها نگه دارید.

## ساختار روی سرور

```
/opt/gereh/current          → نسخه فعال (پیوند به یکی از releases)
/opt/gereh/releases/        سه نسخه آخر
/opt/gereh/shared/.env      تنظیمات و رمزها (فقط کاربر gereh می‌خواند)
/opt/gereh/shared/kyc/      مدارک احراز هویت (از وب در دسترس نیست)
/var/backups/gereh/         پشتیبان روزانه پایگاه داده و فایل‌ها، ۱۴ روز
/etc/gereh.conf             تنظیمات نصب (دامنه، مخزن، شاخه…)
/etc/nginx/sites-available/gereh
/etc/systemd/system/gereh.service
```

برنامه با کاربر محدود `gereh` و فقط روی `127.0.0.1` اجرا می‌شود. Nginx درخواست‌ها را به آن می‌رساند. PostgreSQL و پورت برنامه از بیرون بسته‌اند و دیواره آتش فقط SSH، 80 و 443 را باز می‌گذارد.

## نکته‌های مهم

- **پشتیبان خارج از سرور:** پشتیبان‌های `/var/backups/gereh` روی همان سرورند. یک نسخه را مرتب به جای دیگری منتقل کنید (مثلاً با `rsync` یا فضای ذخیره‌سازی ابری).
- **دسترسی کند به npm یا GitHub:** با `--npm-registry` آینه npm بدهید. برای مخزن خصوصی، نشانی مخزن را با توکن در `/etc/gereh.conf` بگذارید (`REPO=https://<token>@github.com/…`) یا کد را کلون کنید و اسکریپت را از داخل آن اجرا کنید.
- **SSL بعد از تنظیم DNS:** اگر هنگام نصب دامنه هنوز به سرور اشاره نمی‌کرد، سایت با http بالا می‌آید. بعد از تنظیم DNS اجرا کنید: `sudo gereh ssl && sudo gereh update`. تمدید گواهی را certbot خودکار انجام می‌دهد.
- **چند سرور:** این اسکریپت برای یک سرور است. برای چند سرور پشت load balancer، `DATABASE_URL` همه را به یک PostgreSQL مشترک وصل کنید؛ صف کارها با `SKIP LOCKED` برای چند worker هم‌زمان طراحی شده است.

## عیب‌یابی

| مشکل | راه‌حل |
|---|---|
| سایت 502 می‌دهد | `sudo gereh logs -n 100` را ببینید؛ معمولاً تنظیم نادرست در `.env` است |
| ساخت برنامه ناموفق شد | خروجی آخر خطا نمایش داده می‌شود و نسخه فعلی دست نمی‌خورد؛ لاگ کامل: `/opt/gereh/releases/*/.build.log` |
| ورود به پنل کار نمی‌کند | روی http بدون SSL باید `COOKIE_SECURE=0` باشد (اسکریپت خودکار تنظیم می‌کند) |
| بعد از به‌روزرسانی مشکل داریم | `sudo gereh rollback`؛ اگر تغییر پایگاه داده هم مشکل‌ساز بود، `sudo gereh restore` با پشتیبان پیش از به‌روزرسانی |
| حذف کامل | `sudo systemctl disable --now gereh && sudo rm -rf /opt/gereh /etc/gereh.conf /etc/systemd/system/gereh.service /etc/nginx/sites-*/gereh /usr/local/bin/gereh /etc/cron.d/gereh-backup` و در صورت نیاز حذف پایگاه داده با `sudo -u postgres dropdb gereh` |
