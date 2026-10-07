# راه‌اندازی زیرساخت گره اپ (PaaS)

سایت گره (پنل، API، صورتحساب) روی سرور خودش می‌ماند و فقط **دستور** می‌دهد. اپ‌ها و پایگاه‌های داده مشتری‌ها روی یک **کلاستر Kubernetes** جدا اجرا می‌شوند. تا وقتی کلاستر را وصل نکنید، همه چیز با **شبیه‌ساز** کار می‌کند: پنل کامل است، بیلد و لاگ و نمودارها ساختگی‌اند و چیزی واقعاً اجرا نمی‌شود.

```
           مشتری ─ https://shop.gereh.app ─┐
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
| دامنه اپ‌ها | مثلاً `gereh.app` | **نباید** زیردامنه `gereh.net` باشد (کوکی‌های پنل از کد مشتری جدا بمانند) |
| DNS | رکورد `A` برای `gereh.app` و `*.gereh.app` → IP کلاستر | |
| پورت‌ها | 80 و 443 برای همه؛ 6443 فقط برای IP سرور سایت | 30000-32767 فقط اگر دسترسی عمومی پایگاه داده می‌دهید |

## ۲. نصب کلاستر (یک دستور)

روی سرور کلاستر:

```bash
git clone https://github.com/amirhosseintowfighi/gereh.git && cd gereh/deploy/paas
sudo APPS_DOMAIN=gereh.app ACME_EMAIL=ops@gereh.net SITE_URL=https://gereh.net bash setup-cluster.sh
```

اسکریپت این کارها را انجام می‌دهد (اجرای دوباره بی‌خطر است):

1. **k3s** (Kubernetes سبک، با metrics-server و local-path storage) بدون Traefik
2. **ingress-nginx** با گواهی پیش‌فرض `*.gereh.app`
3. **cert-manager** و ClusterIssuer لتس‌انکریپت برای دامنه‌های اختصاصی مشتری‌ها
4. فضای نام **gereh-system** و حساب سرویس `gereh-controller` با کمترین دسترسی لازم (`system.yaml`)
5. **رجیستری خصوصی** روی `registry.gereh.app` با رمز تصادفی
6. **Prometheus** برای نمودار تعداد درخواست هر اپ (فقط داخل کلاستر)
7. **MinIO** برای پشتیبان پایگاه‌های داده (باکت `gereh-backups` با حذف خودکار بعد از ۳۵ روز)
8. **ایمیج builder** (git + Nixpacks) را داخل خود کلاستر با Kaniko می‌سازد
9. در پایان مقادیر `.env` سایت را چاپ می‌کند

### گواهی wildcard

برای اینکه هر اپ از لحظه ساخت HTTPS معتبر داشته باشد، گواهی `*.gereh.app` لازم است. صدور wildcard فقط با **DNS-01** ممکن است؛ فایل `wildcard-cert.yaml` را برای سرویس DNS خودتان (مثال Cloudflare؛ برای PowerDNS از webhook solver) ویرایش و اعمال کنید:

```bash
kubectl -n ingress-nginx create secret generic cloudflare-token --from-literal=token=XXXX
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
   PAAS_APPS_DOMAIN=gereh.app
   PAAS_K8S_API=https://CLUSTER_IP:6443
   PAAS_K8S_TOKEN=eyJhbGciOi...
   PAAS_K8S_CA=/etc/gereh/k8s-ca.crt
   PAAS_REGISTRY=registry.gereh.app
   PAAS_REGISTRY_PULL_SECRET=eyJhdXRocyI6...
   PAAS_BUILDER_IMAGE=registry.gereh.app/gereh/builder:1
   PAAS_INGRESS_IP=CLUSTER_IP
   PAAS_PROMETHEUS=monitoring/prometheus-server:80
   PAAS_SOURCE_BASE_URL=https://gereh.net
   ```
3. در **پنل ادمین › گره اپ (PaaS) › زیرساخت** دکمه «تست اتصال» را بزنید؛ باید `Kubernetes v1.3x` ببینید. دامنه اپ‌ها را همان‌جا روی `gereh.app` بگذارید.
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
