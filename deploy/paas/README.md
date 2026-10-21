# راه‌اندازی زیرساخت گره اپ (PaaS)

سایت گره (پنل، API، صورتحساب) روی سرور خودش می‌ماند و فقط **دستور** می‌دهد. اپ‌ها و پایگاه‌های داده مشتری‌ها روی یک **کلاستر Kubernetes** جدا اجرا می‌شوند. تا وقتی کلاستر را وصل نکنید، همه چیز با **شبیه‌ساز** کار می‌کند: پنل کامل است، بیلد و لاگ و نمودارها ساختگی‌اند و چیزی واقعاً اجرا نمی‌شود.

```
           مشتری ─ https://shop.gereh.dev ─┐
                                          ▼
 ┌─ سرور سایت (gereh.net) ─┐      ┌──────── کلاستر k3s ────────────────────────────┐
 │ Next.js + worker         │ API  │ ingress-nginx ── cert-manager                    │
 │ PostgreSQL               │ ───▶ │ gereh-system: registry، MinIO، Jobهای بیلد/بکاپ  │
 │ /api/paas/source (ZIP)   │ ◀─── │ gereh-u-<کاربر>: Deployment، StatefulSet، …      │
 └──────────────────────────┘      └──────────────────────────────────────────────────┘
```

## ۱. چه چیزهایی لازم است

| مورد | حداقل برای شروع | توضیح |
|---|---|---|
| سرور کلاستر | ۸ هسته، ۳۲ گیگ رم، ۵۰۰ گیگ NVMe، اوبونتو ۲۴.۰۴ | جدا از سرور سایت. بعداً نود اضافه می‌کنید |
| دامنه اپ‌ها | مثلاً `gereh.dev` | **نباید** زیردامنه `gereh.net` باشد (کوکی‌های پنل از کد مشتری جدا بمانند) |
| DNS | رکورد `A` برای `gereh.dev` و `*.gereh.dev` → IP کلاستر | |
| پورت‌ها | 80 و 443 برای همه؛ 6443 فقط برای IP سرور سایت | 30000-32767 فقط اگر دسترسی عمومی پایگاه داده می‌دهید |

## ۲. نصب کلاستر (یک دستور)

روی سرور کلاستر:

```bash
git clone https://github.com/amirhosseintowfighi/gereh.git && cd gereh/deploy/paas
sudo APPS_DOMAIN=gereh.dev ACME_EMAIL=ops@gereh.net SITE_URL=https://gereh.net bash setup-cluster.sh
```

اسکریپت این کارها را انجام می‌دهد (اجرای دوباره بی‌خطر است):

1. **k3s** (Kubernetes سبک، با metrics-server و local-path storage) بدون Traefik
2. **ingress-nginx** با گواهی پیش‌فرض `*.gereh.dev`
3. **cert-manager** و ClusterIssuer لتس‌انکریپت برای دامنه‌های اختصاصی مشتری‌ها
4. فضای نام **gereh-system** و حساب سرویس `gereh-controller` با کمترین دسترسی لازم (`system.yaml`)
5. **رجیستری خصوصی** روی `registry.gereh.dev` با رمز تصادفی
6. **Prometheus** برای نمودار تعداد درخواست هر اپ (فقط داخل کلاستر)
7. **MinIO** برای پشتیبان پایگاه‌های داده (باکت `gereh-backups` با حذف خودکار بعد از ۳۵ روز)
8. **ایمیج builder** (git + Nixpacks) را داخل خود کلاستر با Kaniko می‌سازد
9. در پایان مقادیر `.env` سایت را چاپ می‌کند

### گواهی wildcard

برای اینکه هر اپ از لحظه ساخت HTTPS معتبر داشته باشد، گواهی `*.gereh.dev` لازم است. صدور wildcard فقط با **DNS-01** ممکن است؛ فایل `wildcard-cert.yaml` را برای سرویس DNS خودتان (مثال Cloudflare؛ برای PowerDNS از webhook solver) ویرایش و اعمال کنید:

```bash
kubectl -n cert-manager create secret generic cloudflare-token --from-literal=token=XXXX
kubectl apply -f wildcard-cert.yaml
kubectl -n ingress-nginx get certificate apps-wildcard   # READY=True
```

دامنه‌های اختصاصی مشتری‌ها (مثلاً `www.shop.ir`) جدا و خودکار با HTTP-01 گواهی می‌گیرند.

## ۳. وصل کردن سایت به کلاستر

1. فایل CA را از کلاستر به سرور سایت ببرید:
   ```bash
   scp root@CLUSTER:/etc/gereh-paas/k8s-ca.crt /etc/gereh/k8s-ca.crt
   ```
2. خط‌هایی که اسکریپت چاپ کرد را به `.env` سایت اضافه کنید (`gereh env edit`) و `gereh restart` بزنید:
   ```env
   PAAS_APPS_DOMAIN=gereh.dev
   PAAS_K8S_API=https://CLUSTER_IP:6443
   PAAS_K8S_TOKEN=eyJhbGciOi...
   PAAS_K8S_CA=/etc/gereh/k8s-ca.crt
   PAAS_REGISTRY=registry.gereh.dev
   PAAS_REGISTRY_PULL_SECRET=eyJhdXRocyI6...
   PAAS_BUILDER_IMAGE=registry.gereh.dev/gereh/builder:1
   PAAS_INGRESS_IP=CLUSTER_IP
   PAAS_PROMETHEUS=monitoring/prometheus-server:80
   PAAS_MIRROR=https://mirror.gereh.net   # اختیاری: بیلدها از میرور مخازن (deploy/mirror)
   PAAS_SOURCE_BASE_URL=https://gereh.net
   ```
3. در **پنل ادمین › گره اپ (PaaS) › زیرساخت** دکمه «تست اتصال» را بزنید؛ باید `Kubernetes v1.3x` ببینید. دامنه اپ‌ها را همان‌جا روی `gereh.dev` بگذارید.
4. یک اپ آزمایشی کوچک (مثلاً یک سرور Express ساده) بسازید و لاگ بیلد را دنبال کنید.

> `PAAS_SOURCE_BASE_URL` آدرسی است که Jobهای بیلد فایل ZIP مشتری را از آن دانلود می‌کنند (لینک امضاشده و یک‌ساعته). کلاستر باید بتواند به آن دسترسی داشته باشد.

## ۴. هر اپ در کلاستر چه شکلی است

| شیء | نام | توضیح |
|---|---|---|
| Namespace | `gereh-u-<شناسه کاربر>` | یکی برای هر مشتری، با NetworkPolicy ایزوله و LimitRange |
| Secret | `<اپ>-env` | متغیرهای محیطی (رمزگشایی‌شده فقط همین‌جا) |
| Deployment | `<اپ>` | rolling update با `maxUnavailable: 0` و readiness روی مسیر سلامت |
| Service + Ingress | `<اپ>` | میزبان پیش‌فرض با گواهی wildcard؛ دامنه‌های اختصاصی با cert-manager |
| PVC | `<اپ>-data` | فقط اگر دیسک دائمی خریده باشد |
| HPA | `<اپ>` | فقط با مقیاس خودکار (CPU ۷۰٪) |
| StatefulSet + Service | `db-<نام>` | پایگاه داده با ایمیج رسمی و دیسک PVC |
| Job | `build-<استقرار>` در gereh-system | prepare (git/ZIP + Nixpacks) ← Kaniko ← push به رجیستری |

مشتری‌ها هیچ دسترسی مستقیمی به کلاستر ندارند؛ همه چیز از پنل/API سایت می‌گذرد و سایت با حساب `gereh-controller` اعمال می‌کند.

## ۵. نگهداری روزمره

```bash
kubectl get pods -A | grep -v Running            # چیزهای خراب
kubectl -n gereh-u-u1042 get deploy,sts,ing      # منابع یک مشتری
kubectl -n gereh-system get jobs                 # بیلدها و بکاپ‌ها
kubectl top nodes && kubectl top pods -A         # مصرف
kubectl -n gereh-system logs job/build-dep-xxxx -c kaniko
```

- **اضافه کردن نود**: روی سرور جدید `curl -sfL https://get.k3s.io | K3S_URL=https://CLUSTER_IP:6443 K3S_TOKEN=$(cat /var/lib/rancher/k3s/server/node-token) sh -`
- **پاک‌سازی رجیستری**: ایمیج‌های قدیمی با `registry garbage-collect` یا (بهتر) Harbor با retention policy.
- **پشتیبان کلاستر**: `/var/lib/rancher/k3s/server/db` (etcd/sqlite) را روزانه کپی کنید. داده‌های پایگاه‌های داده مشتری‌ها با بکاپ روزانه خود گره اپ در MinIO است؛ MinIO را هم به یک سرور دیگر mirror کنید (`mc mirror`).
- **به‌روزرسانی**: `helm upgrade` برای ingress-nginx و cert-manager؛ k3s با `system-upgrade-controller`.

## ۶. مسیر رشد (وقتی مشتری‌ها زیاد شدند)

| مرحله | تغییر |
|---|---|
| ۳+ نود | k3s با etcd داخلی و ۳ سرور کنترل، یا RKE2 |
| ذخیره‌سازی | Longhorn یا Ceph به‌جای local-path تا PVCها روی نود دیگر هم بالا بیایند |
| رجیستری | Harbor با ذخیره روی MinIO و اسکن امنیتی ایمیج‌ها |
| مانیتورینگ | kube-prometheus-stack + Loki؛ تعداد درخواست هر اپ از متریک‌های ingress-nginx |
| بیلد | نودهای جدا برای بیلد (taint) تا بیلد سنگین روی اپ‌ها اثر نگذارد |
| ایزوله‌سازی بیشتر | gVisor یا Kata برای اجرای کد مشتری |

## ۷. نکته‌های درایور Kubernetes

- **Docker Compose**: هر سرویس یک Deployment جدا (`<اپ>-<سرویس>`) با Service خودش است و سرویس‌ها از طریق hostAliases با نام Compose همدیگر را پیدا می‌کنند. `volumes` و `env_file` پشتیبانی نمی‌شوند (در لاگ بیلد هشدار داده می‌شود).
- **بازگردانی Redis**: StatefulSet برای چند ثانیه تا چند دقیقه خاموش می‌شود؛ یک Job روی همان دیسک فایل RDB را بار می‌کند و AOF را از نو می‌سازد. فایل از MinIO با لینک امضاشده ۳۰ دقیقه‌ای دانلود می‌شود، پس کلیدهای S3 هیچ‌وقت وارد فضای نام مشتری نمی‌شوند.
- **تعداد درخواست در دقیقه** از متریک‌های ingress-nginx در Prometheus خوانده می‌شود (`PAAS_PROMETHEUS`، از طریق proxy خود API کلاستر؛ Prometheus عمومی نمی‌شود). بدون آن نمودار درخواست صفر است.
- Kaniko بایگانی شده و نسخه Chainguard ادامه‌اش می‌دهد؛ با `PAAS_KANIKO_IMAGE` می‌توانید ایمیج دیگری بدهید.

## ۸. CLI مشتری‌ها

بسته `integrations/gereh-cli` را در npm با نام `@gereh/cli` منتشر کنید:

```bash
cd integrations/gereh-cli && npm publish --access public
```

بعد مشتری‌ها از هر جا می‌توانند `npx @gereh/cli deploy` بزنند (راهنما: `/docs/paas`).

## اسکن امنیتی، آزمون پشتیبان و بازیابی لحظه‌ای

- **اسکن ایمیج:** پس از هر بیلد، Job ‏Trivy در فضای نام سیستم ایمیج را با همان اعتبار رجیستری اسکن می‌کند (`PAAS_TRIVY_IMAGE`، اختیاری `PAAS_TRIVY_DB_REPOSITORY` برای میرور پایگاه آسیب‌پذیری؛ `PAAS_SCAN=off` خاموش می‌کند). نتیجه روی هر استقرار در پنل دیده می‌شود.
- **آزمون بازگردانی پشتیبان:** هفته‌ای یک بار آخرین پشتیبان هر پایگاه داده در یک سرور موقت داخل Job بازگردانی و تعداد جدول‌ها بررسی می‌شود؛ نتیجه کنار پشتیبان‌ها نمایش داده می‌شود.
- **بازیابی لحظه‌ای PostgreSQL (PITR):** با WAL-G. ایمیج را از `deploy/paas/postgres-walg` برای هر نسخه بسازید و تنظیم کنید:

  ```
  PAAS_PG_WALG_IMAGE=registry.gereh.net/gereh/postgres-walg
  PAAS_PITR_BUCKET=gereh-pitr
  PAAS_PITR_S3_ENDPOINT=https://s3.example.ir
  PAAS_PITR_S3_ACCESS_KEY=…
  PAAS_PITR_S3_SECRET_KEY=…
  ```

  برای امنیت بیشتر یک کاربر S3 جدا فقط با دسترسی همین bucket بسازید. با روشن شدن PITR، سرور WALها را پیوسته (حداکثر هر ۵ دقیقه) و یک sidecar روزانه یک پشتیبان پایه (۷ نسخه) در S3 می‌گذارد. بازیابی همیشه در یک پایگاه داده جدید انجام می‌شود.


## ابزارهای اپ: کنسول، دیسک‌ها، SFTP، پشتیبان دیسک و لاگ‌ها

- **کنسول وب و اجرای دستور:** با زیرمنبع `pods/exec` (WebSocket، `v4.channel.k8s.io`) در کانتینر `app` نمونه در حال اجرا؛ کلاستر چیز اضافه‌ای نمی‌خواهد. خروجی با SSE (`/api/paas/console/<id>`) و ورودی با RPC به همان پروسه سایت می‌رسد (Next.js در Route Handlerها WebSocket ندارد). جلسه‌ها در حافظه همان پروسه‌اند: اگر سایت چند نمونه دارد، `/api/paas/console/` و `/api/rpc/paas.console*` را sticky کنید. هر جلسه و هر دستور در `paas_console_sessions` و گزارش فعالیت ثبت می‌شود؛ جلسه پس از ۱۵ دقیقه بی‌کاری یا ۲ ساعت بسته می‌شود.
- **دیسک‌های نام‌دار:** هر دیسک یک PVC است (`<app>-data` برای دیسک «data»، `<app>-disk-<name>` برای بقیه) که در Deployment اپ mount می‌شود. افزایش حجم با server-side apply انجام می‌شود؛ StorageClass باید `allowVolumeExpansion: true` داشته باشد. `paas_apps.disk_gb` جمع دیسک‌هاست و صورت‌حساب مثل قبل با `DISK_PRICE_GB` حساب می‌شود.
- **مدیر فایل:** با exec در کانتینر اپ و ابزارهای `sh`، `stat`، `head`، `cat`، `mv`، `rm`، `find` و `tar` (busybox هم کافی است). ایمیج‌های بدون shell (distroless) مدیر فایل و کنسول ندارند؛ برای آن‌ها SFTP را پیشنهاد کنید. ZIPها روی سرور سایت با `src/server/unzip.ts` بررسی (مسیر ناامن، سقف حجم) و به‌صورت tar به `tar -x` فرستاده می‌شوند.
- **SFTP:** وقتی حساب SFTP ساخته شود، یک sidecar ‏`atmoz/sftp` (`PAAS_SFTP_IMAGE`) کنار کانتینر اپ اجرا می‌شود (دیسک‌ها ReadWriteOnce هستند و باید در همان پاد mount شوند). هر حساب در `/home/<user>` محبوس است و دیسکش در `/home/<user>/<disk>` (برای حساب فقط‌خواندنی به‌صورت read-only) mount می‌شود. حساب‌ها در Secret ‏`<app>-sftp` (فایل `users.conf`) و کلید میزبان RSA ثابت هر اپ کنار آن است؛ Service ‏`<app>-sftp` از نوع NodePort است و یک NetworkPolicy پورت ۲۲ را از بیرون باز می‌کند. نام میزبانی که به مشتری نشان داده می‌شود `sftp.<دامنه اپ‌ها>` است (یا `PAAS_SFTP_HOST`)؛ این نام را به IP نودها اشاره دهید و بازه NodePort را در فایروال باز کنید. UID فایل‌ها با `PAAS_SFTP_UID` (پیش‌فرض ۰، مثل اپ‌هایی که با root اجرا می‌شوند). فقط SFTP پشتیبانی می‌شود، نه FTP.
- **پشتیبان دیسک:** روزانه برای دیسک‌هایی که پشتیبان روزانه دارند (۳ نسخه آخر نگه داشته می‌شود) و دستی (تا ۱۰ نسخه). سرور سایت `tar -czf` دیسک را از پاد اپ می‌گیرد و با URL امضاشده در همان bucket پشتیبان‌ها (`PAAS_BACKUP_BUCKET`، کلید `<user>/<app>/disk-<name>/<id>.tar.gz`) می‌گذارد؛ بازگردانی ابتدا آرشیو را کنار فایل‌ها باز می‌کند و بعد جایگزین می‌کند. اعتبار S3 (همان MinIO که در Secret ‏`backup-s3` است) را برای سایت تنظیم کنید:

  ```
  PAAS_BACKUP_S3_ENDPOINT=http://minio.gereh-system.svc:9000
  PAAS_BACKUP_S3_ACCESS_KEY=gereh
  PAAS_BACKUP_S3_SECRET_KEY=…
  ```

- **لاگ‌ها:** worker هر ۵ دقیقه خطوط جدید هر اپ را (`sinceTime`) از API کلاستر می‌خواند و در جدول `paas_logs` پستگرس می‌گذارد (حداکثر ۵۰۰۰ خط در هر دور برای هر اپ). جستجوی متن کامل روی بازه زمانی با ایندکس `(app_id, at)` و `ILIKE` انجام می‌شود و سطح (خطا، هشدار، اطلاعات، اشکال‌زدایی) هنگام ذخیره از متن خط تشخیص داده می‌شود. نگهداری بر اساس پلن (۷، ۳۰ یا ۶۰ روز؛ در «مدیریت › گره اپ» قابل تغییر) و پاک‌سازی روزانه است. این ساده‌ترین گزینه پایدار است: سرویس جدیدی لازم ندارد، با پایگاه داده پشتیبان گرفته می‌شود و برای جستجوی پنل کافی است؛ اگر حجم لاگ‌ها زیاد شد، می‌توان همین رابط را به Loki برد. دنبال‌کردن زنده مستقیم از پادها خوانده می‌شود.
- **نمودارها:** نمونه‌های ۵ دقیقه‌ای CPU، حافظه و درخواست (۸ روز) به‌علاوه ترافیک شبکه در `paas_net_samples` و میانگین ساعتی در `paas_metrics_hourly` (۳۱ روز) برای بازه‌های ۱ ساعت، ۲۴ ساعت، ۷ روز و ۳۰ روز.

## پروکسی خروجی (تلگرام و APIهای خارجی مسدود) و Task Runner های n8n

**پروکسی خروجی.** API تلگرام (`api.telegram.org`) و بسیاری از APIهای خارجی از کلاستر در دسترس نیستند. هر اپ در تب «تنظیمات › پروکسی خروجی» می‌تواند یک پروکسی HTTP(S) یا SOCKS5 بگذارد، یا اگر مدیر پروکسی مشترک را تنظیم کرده باشد «پروکسی گره» را انتخاب کند (در اپ‌های آماده Hermes، n8n و Agent Zero یک تیک هنگام ساخت). نشانی در متغیرهای `HTTP_PROXY`، `HTTPS_PROXY`، `ALL_PROXY` (هر دو حالت حروف) و `NODE_USE_ENV_PROXY=1` (برای fetch در Node 24+) در Secret اپ قرار می‌گیرد؛ `NO_PROXY` همیشه شبکه داخلی (`.svc`، `.cluster.local`، `10.0.0.0/8`…)، پایگاه‌های داده اپ، دامنه اپ‌ها، API هوش مصنوعی و آینه بسته‌ها را دارد. Hermes نشانی را در `TELEGRAM_PROXY` هم می‌گیرد.

پروکسی مشترک را در «مدیریت › گره اپ › پلتفرم» (یا `PAAS_EGRESS_PROXY`) بگذارید. باید از داخل کلاستر در دسترس باشد و به اینترنت بین‌الملل برسد، مثلاً:

- یک سرور کوچک خارج از ایران با squid (HTTP، پورت 3128) یا dante/3proxy (SOCKS5)، با نام کاربری و رمز و فایروالی که فقط IP خروجی کلاستر (`PAAS_EGRESS_IPS`) را می‌پذیرد؛ نشانی: `http://user:pass@IP:3128`.
- یا یک کلاینت V2Ray/Xray داخل کلاستر (Deployment در `gereh-system`) با inbound از نوع HTTP یا SOCKS روی پورت داخلی و یک Service؛ نشانی: `http://xray.gereh-system.svc:10809` (این Service را فقط از namespaceهای مشتری باز کنید و روی اینترنت منتشر نکنید).

**Task Runner های n8n.** n8n از 1.111 و همه نسخه‌های 2.x نود Code را در Task Runner اجرا می‌کند؛ پایتون فقط با ایمیج جداگانه `n8nio/runners` (هم‌نسخه n8n) در حالت external کار می‌کند. درایور برای هر اپی که ایمیج آن دقیقاً `n8nio/n8n:<x.y.z>` است یک کانتینر کناری `n8nio/runners:<x.y.z>` در همان Pod اجرا می‌کند: broker روی `127.0.0.1:5679` می‌ماند (بیرون Pod دیده نمی‌شود)، توکن مشترک برای هر اپ از `APP_SECRET` مشتق و در Secret اپ گذاشته می‌شود و حافظه کانتینر کناری (یک‌چهارم پلن، ۱۲۸ تا ۵۱۲ مگ) از سقف پلن کم می‌شود. اپ‌های n8n موجود در استقرار بعدی آن را می‌گیرند؛ پلن‌های زیر ۵۱۲ مگ و اپ‌هایی که `N8N_RUNNERS_MODE` را خودشان گذاشته‌اند بدون آن می‌مانند.
