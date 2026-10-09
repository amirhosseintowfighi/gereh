#!/usr/bin/env bash
# Gereh installer for Ubuntu 22.04/24.04 and Debian 12/13.
#
# Sets up, on one server: Node.js, PostgreSQL, the app as a systemd service (with its background
# worker), Nginx as a reverse proxy, a Let's Encrypt certificate, the firewall and daily backups.
# Safe to run again: existing secrets, database and settings are kept.
#
#   sudo bash deploy/install.sh                       # interactive
#   sudo bash deploy/install.sh --domain gereh.net --email ops@gereh.net --yes
#
# Run `bash deploy/install.sh --help` for every option. Full guide: deploy/README.md
set -Eeuo pipefail

# ---------------- defaults (flags or environment variables) ----------------
DOMAIN=${DOMAIN:-}
SSL_EMAIL=${SSL_EMAIL:-}
ADMIN_EMAIL=${ADMIN_EMAIL:-}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
REPO=${REPO:-https://github.com/amirhosseintowfighi/gereh.git}
BRANCH=${BRANCH:-main}
SOURCE_DIR=${SOURCE_DIR:-}
APP_DIR=${APP_DIR:-/opt/gereh}
APP_USER=${APP_USER:-gereh}
PORT=${PORT:-3000}
WWW=${WWW:-auto}
NODE_MAJOR=${NODE_MAJOR:-22}
NODE_MIRROR=${NODE_MIRROR:-https://nodejs.org/dist}
NPM_REGISTRY=${NPM_REGISTRY:-}
SEED_DEMO=${SEED_DEMO:-0}
WITH_SSL=${WITH_SSL:-1}
WITH_FIREWALL=${WITH_FIREWALL:-1}
WITH_BACKUP=${WITH_BACKUP:-1}
ASSUME_YES=${ASSUME_YES:-0}

usage() {
  cat <<'EOF'
Usage: sudo bash deploy/install.sh [options]

  --domain NAME          site domain, e.g. gereh.net (without it the site is served on the server IP over HTTP)
  --email ADDRESS        email for Let's Encrypt expiry notices (needed for SSL)
  --admin-email ADDRESS  first admin account (default: admin@DOMAIN)
  --admin-password PASS  its password (default: generated and printed at the end)
  --www | --no-www       also serve www.DOMAIN, redirected to DOMAIN (default: if its DNS points here)
  --repo URL             git repository (default: the GitHub repo; use a token URL or deploy key if private)
  --branch NAME          branch or tag to deploy (default: main)
  --source DIR           deploy from a local checkout instead of cloning (default when run from inside the repo)
  --app-dir DIR          install location (default: /opt/gereh)
  --port N               internal app port (default: 3000)
  --node-mirror URL      Node.js download mirror (default: https://nodejs.org/dist)
  --npm-registry URL     npm registry mirror, if registry.npmjs.org is slow or blocked
  --demo                 fill an empty database with demo data (staging only)
  --no-ssl               skip Let's Encrypt
  --no-firewall          do not touch the firewall
  --no-backup            no daily database backups
  -y, --yes              do not ask questions (use defaults)
EOF
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --domain) DOMAIN=$2; shift 2 ;;
    --email) SSL_EMAIL=$2; shift 2 ;;
    --admin-email) ADMIN_EMAIL=$2; shift 2 ;;
    --admin-password) ADMIN_PASSWORD=$2; shift 2 ;;
    --www) WWW=1; shift ;;
    --no-www) WWW=0; shift ;;
    --repo) REPO=$2; shift 2 ;;
    --branch) BRANCH=$2; shift 2 ;;
    --source) SOURCE_DIR=$2; shift 2 ;;
    --app-dir) APP_DIR=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --node-mirror) NODE_MIRROR=${2%/}; shift 2 ;;
    --npm-registry) NPM_REGISTRY=$2; shift 2 ;;
    --demo) SEED_DEMO=1; shift ;;
    --no-ssl) WITH_SSL=0; shift ;;
    --no-firewall) WITH_FIREWALL=0; shift ;;
    --no-backup) WITH_BACKUP=0; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_b=$'\e[1m'; c_off=$'\e[0m'
[[ -t 1 ]] || { c_ok=; c_warn=; c_err=; c_b=; c_off=; }
STEP=0
step() { STEP=$((STEP + 1)); printf '\n%s[%d] %s%s\n' "$c_b" "$STEP" "$*" "$c_off"; }
say()  { printf '%s  ✓%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '%s  ! %s%s\n' "$c_warn" "$*" "$c_off" >&2; }
die()  { printf '\n%s[خطا] %s%s\n' "$c_err" "$*" "$c_off" >&2; exit 1; }
trap 'die "نصب در خط $LINENO متوقف شد. خروجی بالا را بررسی کنید؛ اجرای دوباره اسکریپت امن است."' ERR
ask() { # ask VAR "question" default
  local var=$1 q=$2 def=${3:-} ans
  if [[ $ASSUME_YES == 1 || ! -t 0 ]]; then printf -v "$var" '%s' "$def"; return; fi
  read -r -p "  $q${def:+ [$def]}: " ans
  printf -v "$var" '%s' "${ans:-$def}"
}
rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; }

# ---------------- 1. preflight ----------------
step "بررسی سرور"
[[ $EUID -eq 0 ]] || die "اسکریپت را با sudo یا کاربر root اجرا کنید."
# shellcheck source=/dev/null
source /etc/os-release
case "$ID:${VERSION_ID%%.*}" in
  ubuntu:22|ubuntu:24|debian:12|debian:13) say "سیستم‌عامل: $PRETTY_NAME" ;;
  *) warn "سیستم‌عامل $PRETTY_NAME آزموده نشده است؛ Ubuntu 24.04 پیشنهاد می‌شود."
     [[ $ASSUME_YES == 1 ]] || { read -r -p "  ادامه می‌دهید؟ (y/N) " a; [[ $a == [yY]* ]] || exit 1; } ;;
esac
case $(uname -m) in x86_64) NODE_ARCH=x64 ;; aarch64|arm64) NODE_ARCH=arm64 ;; *) die "معماری $(uname -m) پشتیبانی نمی‌شود." ;; esac
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
swap_mb=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
disk_gb=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
say "حافظه: ${mem_mb}MB، swap: ${swap_mb}MB، فضای خالی: ${disk_gb}GB"
((disk_gb >= 5)) || die "دست‌کم ۵ گیگابایت فضای خالی لازم است."
if ((mem_mb + swap_mb < 3500)) && [[ ! -f /swapfile.gereh ]]; then
  warn "حافظه برای ساخت برنامه کم است؛ ۲ گیگابایت swap ساخته می‌شود."
  fallocate -l 2G /swapfile.gereh 2>/dev/null || dd if=/dev/zero of=/swapfile.gereh bs=1M count=2048 status=none
  chmod 600 /swapfile.gereh && mkswap -q /swapfile.gereh && swapon /swapfile.gereh
  grep -q swapfile.gereh /etc/fstab || echo '/swapfile.gereh none swap sw 0 0' >> /etc/fstab
  say "swap فعال شد"
fi

# source: a local checkout (this script's repo) or a git clone
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ -z $SOURCE_DIR && -f $SCRIPT_DIR/../package.json ]] && grep -q '"name": "gereh"' "$SCRIPT_DIR/../package.json"; then
  SOURCE_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
fi
[[ -n $SOURCE_DIR ]] && say "منبع کد: $SOURCE_DIR" || say "منبع کد: $REPO ($BRANCH)"

# previous install: keep its settings
if [[ -r /etc/gereh.conf ]]; then
  # shellcheck source=/dev/null
  PREV_DOMAIN=$(. /etc/gereh.conf; echo "${DOMAIN:-}")
  [[ -z $DOMAIN ]] && DOMAIN=$PREV_DOMAIN
  say "نصب قبلی پیدا شد؛ تنظیمات و داده‌ها حفظ می‌شوند."
fi

ask DOMAIN "دامنه سایت (خالی = فقط با IP سرور و بدون SSL)" "$DOMAIN"
DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN%%/*}; DOMAIN=${DOMAIN,,}
if [[ -n $DOMAIN ]]; then
  [[ $DOMAIN =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "دامنه «$DOMAIN» معتبر نیست."
  [[ $WITH_SSL == 1 ]] && ask SSL_EMAIL "ایمیل برای گواهی SSL (خالی = بدون SSL)" "$SSL_EMAIL"
  [[ -z $SSL_EMAIL ]] && WITH_SSL=0
else
  WITH_SSL=0
fi
[[ -z $ADMIN_EMAIL ]] && ADMIN_EMAIL=admin@${DOMAIN:-example.com}
ask ADMIN_EMAIL "ایمیل مدیر اصلی سایت" "$ADMIN_EMAIL"

# ---------------- 2. packages ----------------
step "نصب بسته‌های سیستم"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
pkgs=(ca-certificates curl git rsync openssl xz-utils cron nginx postgresql postgresql-contrib)
[[ $WITH_FIREWALL == 1 ]] && pkgs+=(ufw)
[[ $WITH_SSL == 1 ]] && pkgs+=(certbot python3-certbot-nginx)
apt-get install -y -qq --no-install-recommends "${pkgs[@]}" >/dev/null
say "${pkgs[*]}"

# ---------------- 3. Node.js ----------------
step "نصب Node.js"
node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)'; }
if node_ok; then
  say "Node.js $(node -v) از قبل نصب است"
else
  base="$NODE_MIRROR/latest-v$NODE_MAJOR.x"
  tarball=$(curl -fsSL "$base/SHASUMS256.txt" | awk -v a="linux-$NODE_ARCH.tar.xz" '$2 ~ a"$" {print $2; exit}') || true
  [[ -n $tarball ]] || die "دریافت فهرست Node.js از $NODE_MIRROR ناموفق بود؛ با --node-mirror یک آینه دیگر بدهید."
  tmp=$(mktemp -d)
  curl -fsSL "$base/$tarball" -o "$tmp/$tarball"
  (cd "$tmp" && curl -fsSL "$base/SHASUMS256.txt" | grep " $tarball\$" | sha256sum -c --quiet -) || die "چک‌سام فایل Node.js درست نیست."
  mkdir -p /usr/local/lib/nodejs
  tar -xJf "$tmp/$tarball" -C /usr/local/lib/nodejs
  dir=/usr/local/lib/nodejs/${tarball%.tar.xz}
  for b in node npm npx corepack; do ln -sfn "$dir/bin/$b" /usr/local/bin/$b; done
  rm -rf "$tmp"
  hash -r
  node_ok || die "نصب Node.js ناموفق بود."
  say "Node.js $(node -v)"
fi
NODE_BIN=$(command -v node)

# ---------------- 4. user, folders ----------------
step "کاربر سرویس و پوشه‌ها"
id "$APP_USER" &>/dev/null || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"/{releases,shared/kyc,shared/paas-uploads,.npm}
chown "$APP_USER:$APP_USER" "$APP_DIR" "$APP_DIR"/{releases,shared,shared/kyc,shared/paas-uploads,.npm}
chmod 750 "$APP_DIR/shared"
say "$APP_DIR (کاربر $APP_USER)"

# ---------------- 5. PostgreSQL ----------------
step "پایگاه داده PostgreSQL"
systemctl enable --now postgresql >/dev/null 2>&1
for _ in {1..30}; do runuser -u postgres -- psql -qtAc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
ENV_FILE=$APP_DIR/shared/.env
if [[ -f $ENV_FILE ]] && grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  DB_PASS=$(sed -nE 's#^DATABASE_URL=postgres(ql)?://[^:]+:([^@]+)@.*#\2#p' "$ENV_FILE")
else
  DB_PASS=$(rand 32)
fi
if runuser -u postgres -- psql -qtAc "select 1 from pg_roles where rolname='$APP_USER'" | grep -q 1; then
  runuser -u postgres -- psql -q -c "alter role \"$APP_USER\" with login password '$DB_PASS'"
else
  runuser -u postgres -- psql -q -c "create role \"$APP_USER\" with login password '$DB_PASS'"
fi
runuser -u postgres -- psql -qtAc "select 1 from pg_database where datname='$APP_USER'" | grep -q 1 ||
  runuser -u postgres -- createdb -O "$APP_USER" -E UTF8 -T template0 "$APP_USER"
say "پایگاه داده $APP_USER آماده است"

# ---------------- 6. settings ----------------
step "تنظیمات برنامه"
if [[ -n $DOMAIN ]]; then
  SCHEME=$([[ $WITH_SSL == 1 ]] && echo https || echo http)
  SITE_URL="$SCHEME://$DOMAIN"
else
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  SITE_URL="http://${IP:-127.0.0.1}"
fi
COOKIE_SECURE=$([[ $SITE_URL == https://* ]] && echo 1 || echo 0)
if [[ ! -f $ENV_FILE ]]; then
  [[ -z $ADMIN_PASSWORD ]] && ADMIN_PASSWORD="$(rand 14)A1!"
  umask 077
  cat > "$ENV_FILE" <<EOF
# Gereh settings — edit with: sudo gereh env   (NEXT_PUBLIC_* changes need: sudo gereh update)
NODE_ENV=production
PORT=$PORT
DATABASE_URL=postgres://$APP_USER:$DB_PASS@127.0.0.1:5432/$APP_USER
# encrypts secrets saved in the admin panel; never change or lose it
APP_SECRET=$(openssl rand -hex 32)
# first owner account (used only while the database is empty; change the password in the panel)
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
SEED_DEMO=$SEED_DEMO
# Nginx in front of the app sets X-Forwarded-For
TRUST_PROXY=1
NEXT_PUBLIC_SITE_URL=$SITE_URL
COOKIE_SECURE=$COOKIE_SECURE
NEXT_PUBLIC_DEMO=0
KYC_DIR=$APP_DIR/shared/kyc
CONTACT_INBOX=$ADMIN_EMAIL
DEVOPS_INBOX=$ADMIN_EMAIL

# ---- integrations: without credentials each one runs as a simulator (see .env.example) ----
# VIRTUALIZOR_HOST=
# VIRTUALIZOR_KEY=
# VIRTUALIZOR_PASS=
# ZARINPAL_MERCHANT=
# IDPAY_API_KEY=
# KAVENEGAR_API_KEY=
# KAVENEGAR_SENDER=
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# SMTP_FROM="گره <no-reply@$DOMAIN>"
# WHM_HOST=
# WHM_TOKEN=
# PDNS_URL=
# PDNS_API_KEY=
# RC_USER_ID=
# RC_API_KEY=

# ---- Gereh Apps (PaaS): without PAAS_K8S_API/TOKEN apps run on the simulator (see deploy/paas/README.md) ----
PAAS_UPLOAD_DIR=$APP_DIR/shared/paas-uploads
# PAAS_APPS_DOMAIN=gereh.dev
# PAAS_K8S_API=https://K8S_IP:6443
# PAAS_K8S_TOKEN=
# PAAS_K8S_CA=/etc/gereh/k8s-ca.crt
# PAAS_REGISTRY=registry.gereh.dev
# PAAS_REGISTRY_PULL_SECRET=
# PAAS_BUILDER_IMAGE=registry.gereh.dev/gereh/builder:1
# PAAS_INGRESS_IP=
# PAAS_PROMETHEUS=monitoring/prometheus-server:80
# PAAS_SOURCE_BASE_URL=https://$DOMAIN

# ---- inquiry API provider (without it inquiries are simulated) ----
# INQUIRY_PROVIDER_URL=
# INQUIRY_PROVIDER_TOKEN=

# ---- Geo DNS: PowerDNS with LUA records + GeoIP (see deploy/geo/README.md) ----
# GEO_PDNS=http://NS1_IP:8081|API_KEY
# GEO_NAMESERVERS=ns1.gereh.net,ns2.gereh.net

# ---- AI API (OpenAI-compatible upstream; without a key answers are simulated) ----
# set the key with «sudo gereh ai-key» and the host with «sudo gereh ai-domain api.gereh.dev»
# AI_UPSTREAM_URL=https://codecraftapi.com/v1
# AI_UPSTREAM_KEY=
# AI_API_BASE=https://api.gereh.dev

# ---- package mirror (deploy/mirror/README.md) ----
# MIRROR_URL=https://mirror.gereh.net
# PAAS_MIRROR=https://mirror.gereh.net

# ---- notification bots (Admin › Settings › Notifications) ----
# BALE_BOT_TOKEN=
# BALE_BOT_USERNAME=
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_BOT_USERNAME=
# TELEGRAM_API_BASE=https://api.telegram.org
EOF
  umask 022
  say "فایل تنظیمات ساخته شد: $ENV_FILE"
else
  # keep everything; only follow a changed domain / SSL choice
  sed -i -E "s#^NEXT_PUBLIC_SITE_URL=.*#NEXT_PUBLIC_SITE_URL=$SITE_URL#; s#^COOKIE_SECURE=.*#COOKIE_SECURE=$COOKIE_SECURE#" "$ENV_FILE"
  grep -q '^COOKIE_SECURE=' "$ENV_FILE" || echo "COOKIE_SECURE=$COOKIE_SECURE" >> "$ENV_FILE"
  grep -q '^KYC_DIR=' "$ENV_FILE" || echo "KYC_DIR=$APP_DIR/shared/kyc" >> "$ENV_FILE"
  grep -q '^PAAS_UPLOAD_DIR=' "$ENV_FILE" || echo "PAAS_UPLOAD_DIR=$APP_DIR/shared/paas-uploads" >> "$ENV_FILE"
  say "تنظیمات قبلی حفظ شد ($ENV_FILE)"
fi
chown "$APP_USER:$APP_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"

[[ $WWW == auto ]] && WWW=0 && [[ -n $DOMAIN ]] && getent ahostsv4 "www.$DOMAIN" >/dev/null 2>&1 && WWW=1
umask 077
cat > /etc/gereh.conf <<EOF
# written by deploy/install.sh — read by /usr/local/bin/gereh
APP_DIR=$APP_DIR
APP_USER=$APP_USER
PORT=$PORT
DOMAIN=$DOMAIN
WWW=$WWW
SSL_EMAIL=$SSL_EMAIL
REPO=$REPO
BRANCH=$BRANCH
SOURCE_DIR=$SOURCE_DIR
NPM_REGISTRY=$NPM_REGISTRY
KEEP_RELEASES=3
BACKUP_DIR=/var/backups/gereh
BACKUP_KEEP_DAYS=14
EOF
umask 022
install -m 755 "$SCRIPT_DIR/gereh" /usr/local/bin/gereh
say "ابزار مدیریت: gereh (راهنما: gereh help)"

# ---------------- 7. service ----------------
step "سرویس systemd"
cat > /etc/systemd/system/gereh.service <<EOF
[Unit]
Description=Gereh (Next.js app + background worker)
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/current
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=127.0.0.1
ExecStart=$NODE_BIN node_modules/next/dist/bin/next start -H 127.0.0.1 -p $PORT
Restart=always
RestartSec=3
TimeoutStopSec=30
LimitNOFILE=65535
# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable gereh >/dev/null 2>&1
say "/etc/systemd/system/gereh.service"

# ---------------- 8. Nginx ----------------
step "Nginx"
SERVER_NAME=${DOMAIN:-_}
DEFAULT_SERVER=$([[ -z $DOMAIN ]] && echo " default_server" || true)
# listen on IPv6 only where the kernel has it (some VPS images disable it)
V6=$([[ -s /proc/net/if_inet6 ]] && echo 1 || echo 0)
listen6() { [[ $V6 == 1 ]] && echo "    listen [::]:80$1;" || true; }
cat > /etc/nginx/sites-available/gereh <<EOF
# Gereh — generated by deploy/install.sh (certbot adds the TLS lines)
upstream gereh_app { server 127.0.0.1:$PORT; keepalive 32; }

# Prerendered pages come with "s-maxage=31536000": a CDN or shared proxy in front (ArvanCloud,
# Cloudflare…) would keep serving that HTML for a year, pointing at CSS/JS of an old release.
# Pages may be cached by browsers and CDNs only with revalidation; everything else passes through.
map \$upstream_http_cache_control \$gereh_cache_control {
    ~s-maxage  "public, max-age=0, must-revalidate";
    default    \$upstream_http_cache_control;
}

server {
    listen 80$DEFAULT_SERVER;
$(listen6 "$DEFAULT_SERVER")
    server_name $SERVER_NAME;

    client_max_body_size 12m;          # KYC uploads are limited to 5 MB by the app
    server_tokens off;

    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json application/xml application/rss+xml image/svg+xml;

    # hashed build files: the app already sends "immutable"; a missing (old) file is a 404 that is never cached
    location /_next/static/ {
        proxy_pass http://gereh_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Connection "";
        access_log off;
    }

    # project ZIP uploads for Gereh Apps (the app itself caps them at 200 MB)
    location = /api/paas/upload {
        client_max_body_size 210m;
        proxy_request_buffering off;
        proxy_pass http://gereh_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Connection "";
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    # WordPress site backups for import (cPanel full backups; the app caps them at 4 GB)
    location = /api/wp/upload {
        client_max_body_size 4200m;
        proxy_request_buffering off;
        proxy_pass http://gereh_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Connection "";
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://gereh_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Connection "";
        # the app trusts only the first X-Forwarded-For hop, so replace whatever the client sent
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 120s;
        proxy_hide_header Cache-Control;
        add_header Cache-Control \$gereh_cache_control always;
    }
}
EOF
if [[ $WWW == 1 ]]; then
  cat >> /etc/nginx/sites-available/gereh <<EOF

server {
    listen 80;
$(listen6 "")
    server_name www.$DOMAIN;
    return 301 \$scheme://$DOMAIN\$request_uri;
}
EOF
fi
ln -sfn /etc/nginx/sites-available/gereh /etc/nginx/sites-enabled/gereh
[[ -z $DOMAIN ]] && rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || { nginx -t; die "پیکربندی Nginx خطا دارد."; }
systemctl enable nginx >/dev/null 2>&1
systemctl reload nginx 2>/dev/null || systemctl restart nginx
say "/etc/nginx/sites-available/gereh"

# ---------------- 9. firewall ----------------
if [[ $WITH_FIREWALL == 1 ]]; then
  step "دیواره آتش (ufw)"
  # never lock ourselves out: the port of this SSH session, sshd's effective config, its config files,
  # the systemd socket (socket-activated ssh on Ubuntu 24.04) and whatever sshd listens on now
  # each source may legitimately find nothing, so this probe runs without errexit/pipefail/ERR trap
  ssh_ports=$( set +eo pipefail; trap - ERR; {
    [[ -n ${SSH_CONNECTION:-} ]] && awk '{print $4}' <<<"$SSH_CONNECTION"
    sshd -T 2>/dev/null | awk '$1=="port" {print $2}'
    grep -hiE '^[[:space:]]*Port[[:space:]]+[0-9]+' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | awk '{print $2}'
    systemctl show ssh.socket -p Listen 2>/dev/null | grep -oE ':[0-9]+ ' | tr -d ': '
    ss -Hltnp 2>/dev/null | awk '/sshd/ {n=split($4,a,":"); print a[n]}'
  } 2>/dev/null | awk '/^[0-9]+$/' | sort -un | tr '\n' ' ')
  ssh_ports=${ssh_ports% }
  for p in ${ssh_ports:-22}; do ufw allow "$p/tcp" comment ssh >/dev/null; done
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  say "باز: SSH (${ssh_ports:-22})، 80، 443 — پورت برنامه و پایگاه داده از بیرون بسته است"
fi

# ---------------- 10. SSL (before the build: the site URL is compiled into the app) ----------------
if [[ $WITH_SSL == 1 ]]; then
  step "گواهی SSL (Let's Encrypt)"
  if /usr/local/bin/gereh ssl >/dev/null; then
    say "گواهی برای $DOMAIN صادر شد"
  else
    warn "صدور گواهی ناموفق بود (معمولاً DNS دامنه هنوز به این سرور اشاره نمی‌کند یا پورت 80 از بیرون بسته است)."
    warn "سایت فعلاً با http بالا می‌آید. پس از تنظیم رکورد A دامنه: sudo gereh ssl && sudo gereh update"
    sed -i -E "s#^NEXT_PUBLIC_SITE_URL=.*#NEXT_PUBLIC_SITE_URL=http://$DOMAIN#; s#^COOKIE_SECURE=.*#COOKIE_SECURE=0#" "$ENV_FILE"
  fi
fi

# ---------------- 11. build & start ----------------
step "دریافت، ساخت و اجرای برنامه (چند دقیقه)"
/usr/local/bin/gereh deploy
say "برنامه روی 127.0.0.1:$PORT اجرا شد"

# ---------------- 12. backups ----------------
if [[ $WITH_BACKUP == 1 ]]; then
  step "پشتیبان‌گیری روزانه"
  cat > /etc/cron.d/gereh-backup <<'EOF'
# daily PostgreSQL + uploads backup, kept 14 days in /var/backups/gereh
30 3 * * * root /usr/local/bin/gereh backup >/dev/null 2>&1
EOF
  chmod 644 /etc/cron.d/gereh-backup
  say "هر شب ساعت ۳:۳۰ در /var/backups/gereh (نسخه‌ای را خارج از سرور هم نگه دارید)"
fi

# ---------------- done ----------------
envval() { sed -nE "s/^$1=(.*)/\1/p" "$ENV_FILE" | head -1; }  # empty (not an error) when the key is missing
URL=$(envval NEXT_PUBLIC_SITE_URL)
SUMMARY=/root/gereh-install.txt
{
  echo "Gereh — $(date '+%Y-%m-%d %H:%M')"
  echo "Site:        $URL"
  echo "Admin panel: $URL/admin"
  echo "Admin email: $(envval ADMIN_EMAIL)"
  [[ -n $(envval ADMIN_PASSWORD) ]] && echo "Admin pass:  $(envval ADMIN_PASSWORD)   (initial password; change it after the first login)"
  echo "Settings:    $ENV_FILE   (sudo gereh env)"
  echo "Logs:        sudo gereh logs -f"
  echo "Update:      sudo gereh update"
  echo "Backups:     /var/backups/gereh   (sudo gereh backup)"
} > "$SUMMARY"
chmod 600 "$SUMMARY"
printf '\n%s✅ نصب گره کامل شد.%s\n\n' "$c_ok$c_b" "$c_off"
cat "$SUMMARY"
printf '\nاین خلاصه در %s ذخیره شد (فقط root می‌خواند).\n' "$SUMMARY"
[[ -n $DOMAIN && $URL == http://* ]] && printf '%sبرای SSL: sudo gereh ssl%s\n' "$c_warn" "$c_off"
exit 0
