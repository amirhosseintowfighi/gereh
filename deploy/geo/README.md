# راه‌اندازی نام‌سرورها برای DNS مشتری‌ها و Geo DNS

گره رکوردهای DNS مشتری‌ها (`PDNS_URL`) و زون‌های Geo DNS (`GEO_PDNS`) را با API در PowerDNS می‌نویسد. Geo DNS رکوردهای LUA می‌سازد که بازدیدکننده داخل ایران را به سرور ایران و بقیه دنیا (از جمله ربات گوگل) را به سرور خارج می‌فرستند.

```
                 gereh.net (سایت) ── API :8081 ──▶ ns1 (ایران)  PowerDNS + PostgreSQL (اصلی)
                                                     │ replication (WireGuard)
                                                     ▼
                                                   ns2 (خارج)   PowerDNS + PostgreSQL (replica)
```

در قطعی اینترنت بین‌الملل، کاربر ایرانی فقط به ns1 و گوگل فقط به ns2 می‌رسد. چون هر دو رکوردهای یکسان دارند، هر طرف جواب درست می‌گیرد.

## ۱. نصب روی هر دو سرور (Ubuntu 24.04)

```bash
apt-get install -y pdns-server pdns-backend-pgsql pdns-backend-geoip postgresql
mkdir -p /usr/share/GeoIP
# پایگاه کشورها (رایگان، بدون ثبت‌نام؛ ماهانه با cron به‌روز کنید)
curl -L https://download.db-ip.com/free/dbip-country-lite-$(date +%Y-%m).mmdb.gz | gunzip > /usr/share/GeoIP/country.mmdb
echo "domains: []" > /etc/powerdns/geo-zones.yaml
```

`/etc/powerdns/pdns.conf`:

```ini
launch=gpgsql,geoip
gpgsql-host=127.0.0.1
gpgsql-dbname=pdns
gpgsql-user=pdns
gpgsql-password=CHANGE_ME
geoip-database-files=mmdb:/usr/share/GeoIP/country.mmdb
geoip-zones-file=/etc/powerdns/geo-zones.yaml
enable-lua-records=yes
edns-subnet-processing=yes
api=yes
api-key=LONG_RANDOM_KEY
webserver=yes
webserver-address=0.0.0.0
webserver-port=8081
webserver-allow-from=127.0.0.1,SITE_SERVER_IP
```

## ۲. پایگاه داده

- **ns1:** کاربر و پایگاه داده `pdns` را بسازید و جدول‌ها را از فایل schema بسته بسازید (مسیرش: `dpkg -L pdns-backend-pgsql | grep schema.pgsql.sql`؛ در Ubuntu 24.04 معمولاً `/usr/share/pdns-backend-pgsql/schema/schema.pgsql.sql`).
- **ns2:** جدول نسازید. PostgreSQL را با `pg_basebackup -R` به replica از ns1 تبدیل کنید. اتصال دو سرور را با WireGuard یا تونل SSH امن کنید.

نکته Ubuntu: `systemd-resolved` روی `127.0.0.53:53` گوش می‌دهد. در `pdns.conf` بنویسید `local-address=<IP عمومی سرور>` (یا در `/etc/systemd/resolved.conf` بگذارید `DNSStubListener=no` و `systemctl restart systemd-resolved`).

## ۳. دیواره آتش

- پورت 53 (TCP و UDP) برای همه باز باشد.
- پورت 8081 فقط برای IP سرور سایت باز باشد.
- PowerDNS برای بررسی سلامت سرورهای مشتری (`ifurlup`) باید بتواند به پورت 443 آن‌ها وصل شود.

## ۴. تنظیم سایت

```env
PDNS_URL=http://NS1_IP:8081
PDNS_API_KEY=LONG_RANDOM_KEY
GEO_PDNS=http://NS1_IP:8081|LONG_RANDOM_KEY
GEO_NAMESERVERS=ns1.gereh.net,ns2.gereh.net
```

اگر ns2 پایگاه داده مستقل دارد (replica نیست)، هر دو را بدهید: `GEO_PDNS=http://NS1:8081|KEY1,http://NS2:8081|KEY2`. در این حالت رکوردهای `PDNS_URL` فقط روی ns1 نوشته می‌شوند، پس راه پیشنهادی همان replica است.

در پنل ثبت‌کننده gereh.net، `ns1.gereh.net` و `ns2.gereh.net` را به‌عنوان Child Nameserver (Glue) با IPهایشان ثبت کنید.

## Reverse DNS (PTR) برای IPهای گره

وقتی صاحب بازه IP در RIPE برای `32.12.81.in-addr.arpa` شیء `domain` با `nserver: ns1.gereh.net` و `nserver: ns2.gereh.net` ثبت کرد:

```bash
pdnsutil create-zone 32.12.81.in-addr.arpa ns1.gereh.net
pdnsutil add-record 32.12.81.in-addr.arpa @ NS ns2.gereh.net.
pdnsutil add-record 32.12.81.in-addr.arpa 171 PTR mx.gereh.net.
dig -x 81.12.32.171 +short @ns1.gereh.net
```

## ۵. تست

```bash
dig +short example.ir @ns1.gereh.net                     # کاربر ایران → IP سرور ایران
dig +short example.ir @ns1.gereh.net +subnet=8.8.8.0/24  # کاربر خارج → IP سرور خارج
```
