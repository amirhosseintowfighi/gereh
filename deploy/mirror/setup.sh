#!/usr/bin/env bash
# Gereh package mirror — Nexus Repository (proxy repos) behind Nginx with Let's Encrypt.
#
#   sudo bash setup.sh mirror.gereh.net admin@gereh.net
#
# Ubuntu 22.04/24.04 or Debian 12, 4+ GB RAM, a large disk (the cache grows with use: start with
# 200 GB and watch `df -h /srv/nexus`). Safe to re-run: existing repositories are left alone.
# Repositories: npm, pypi, composer, go, maven, rubygems, nuget, crates; Docker Hub, GHCR, Quay,
# registry.k8s.io and MCR; ubuntu, debian, fedora, centos (Stream), rocky, almalinux, opensuse, alpine,
# archlinux and manjaro. Registries other than Docker Hub are pulled as $HOST/<ghcr|quay|k8s|mcr>/<image>.
set -Eeuo pipefail
HOST=${1:?usage: setup.sh HOST EMAIL}
EMAIL=${2:?usage: setup.sh HOST EMAIL}
DATA=/srv/nexus
IMAGE=${NEXUS_IMAGE:-sonatype/nexus3:3.76.0}
NX=http://127.0.0.1:8081
say() { printf '\033[32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run with sudo"

say "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl jq nginx certbot python3-certbot-nginx >/dev/null
command -v docker >/dev/null || { curl -fsSL https://get.docker.com | sh >/dev/null; }

say "Nexus ($IMAGE)"
mkdir -p "$DATA" && chown -R 200:200 "$DATA"
if ! docker ps -a --format '{{.Names}}' | grep -qx nexus; then
  docker run -d --name nexus --restart unless-stopped \
    -p 127.0.0.1:8081:8081 -p 127.0.0.1:8082-8086:8082-8086 \
    -e INSTALL4J_ADD_VM_PARAMS="-Xms1200m -Xmx1200m -XX:MaxDirectMemorySize=2g" \
    -v "$DATA":/nexus-data "$IMAGE" >/dev/null
elif ! docker port nexus 8083 >/dev/null 2>&1; then
  echo "!! the nexus container predates the GHCR/Quay/k8s/MCR connectors: docker rm -f nexus and re-run (data in $DATA is kept)"
fi
for _ in $(seq 1 120); do curl -fs "$NX/service/rest/v1/status/writable" >/dev/null && break; sleep 5; done
curl -fs "$NX/service/rest/v1/status/writable" >/dev/null || die "Nexus did not start; docker logs nexus"

# admin password: generated once, kept in /root/nexus-admin.txt
if [[ -f $DATA/admin.password ]]; then
  NEW=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)
  curl -fs -u "admin:$(cat "$DATA/admin.password")" -X PUT -H 'Content-Type: text/plain' --data "$NEW" "$NX/service/rest/v1/security/users/admin/change-password"
  echo "$NEW" > /root/nexus-admin.txt && chmod 600 /root/nexus-admin.txt
  rm -f "$DATA/admin.password"
fi
PASS=$(cat /root/nexus-admin.txt)
api() { curl -fsS -u "admin:$PASS" -H 'Content-Type: application/json' "$@"; }

say "anonymous read access + Docker token realm"
api -X PUT "$NX/service/rest/v1/security/anonymous" -d '{"enabled":true,"userId":"anonymous","realmName":"NexusAuthorizingRealm"}' >/dev/null
api -X PUT "$NX/service/rest/v1/security/realms/active" -d '["NexusAuthenticatingRealm","DockerToken"]' >/dev/null

common='"online":true,"storage":{"blobStoreName":"default","strictContentTypeValidation":false},"negativeCache":{"enabled":true,"timeToLive":60},"httpClient":{"blocked":false,"autoBlock":true}'
proxy() { # proxy <format> <name> <remote url> [extra json]
  if api "$NX/service/rest/v1/repositories/$2" >/dev/null 2>&1; then echo "   $2 (exists)"; return; fi
  api -X POST "$NX/service/rest/v1/repositories/$1/proxy" -d "{\"name\":\"$2\",$common,\"proxy\":{\"remoteUrl\":\"$3\",\"contentMaxAge\":1440,\"metadataMaxAge\":60}${4:+,$4}}" >/dev/null
  echo "   $2 → $3"
}
say "proxy repositories"
proxy npm npm https://registry.npmjs.org
proxy pypi pypi https://pypi.org
proxy go go https://proxy.golang.org
proxy maven maven https://repo1.maven.org/maven2/ '"maven":{"versionPolicy":"RELEASE","layoutPolicy":"PERMISSIVE"}'
proxy rubygems rubygems https://rubygems.org
proxy nuget nuget https://api.nuget.org/v3/index.json '"nugetProxy":{"queryCacheItemMaxAge":3600,"nugetVersion":"V3"}'
proxy apt ubuntu http://archive.ubuntu.com/ubuntu/ '"apt":{"distribution":"noble","flat":false}'
proxy apt debian http://deb.debian.org/debian/ '"apt":{"distribution":"bookworm","flat":false}'
proxy raw alpine https://dl-cdn.alpinelinux.org/alpine/
proxy yum fedora https://dl.fedoraproject.org/pub/fedora/linux/
proxy yum centos https://mirror.stream.centos.org/
proxy yum rocky https://dl.rockylinux.org/pub/rocky/
proxy yum almalinux https://repo.almalinux.org/almalinux/
proxy raw opensuse https://download.opensuse.org/
proxy raw archlinux https://geo.mirror.pkgbuild.com/
proxy raw manjaro https://repo.manjaro.org/repo/
proxy raw composer https://repo.packagist.org/
proxy raw crates https://index.crates.io/
proxy raw crates-dl https://static.crates.io/
proxy docker docker https://registry-1.docker.io '"docker":{"v1Enabled":false,"forceBasicAuth":false,"httpPort":8082},"dockerProxy":{"indexType":"HUB"}'
proxy docker ghcr https://ghcr.io '"docker":{"v1Enabled":false,"forceBasicAuth":false,"httpPort":8083},"dockerProxy":{"indexType":"REGISTRY"}'
proxy docker quay https://quay.io '"docker":{"v1Enabled":false,"forceBasicAuth":false,"httpPort":8084},"dockerProxy":{"indexType":"REGISTRY"}'
proxy docker k8s https://registry.k8s.io '"docker":{"v1Enabled":false,"forceBasicAuth":false,"httpPort":8085},"dockerProxy":{"indexType":"REGISTRY"}'
proxy docker mcr https://mcr.microsoft.com '"docker":{"v1Enabled":false,"forceBasicAuth":false,"httpPort":8086},"dockerProxy":{"indexType":"REGISTRY"}'

say "Nginx ($HOST)"
cat > /etc/nginx/sites-available/gereh-mirror <<NGINX
# Gereh package mirror — generated by deploy/mirror/setup.sh (certbot adds TLS)
limit_req_zone \$binary_remote_addr zone=mirror:10m rate=50r/s;
server {
    listen 80;
    server_name $HOST;
    client_max_body_size 0;          # big layers and packages
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;
    limit_req zone=mirror burst=400 nodelay;
    server_tokens off;

    location = / { default_type text/plain; return 200 "Gereh package mirror — https://gereh.net/mirror\n"; }

    # other registries: $HOST/<prefix>/<image> → that registry's connector (containerd: override_path)
    location /v2/ghcr/ { rewrite ^/v2/ghcr/(.*)\$ /v2/\$1 break; proxy_pass http://127.0.0.1:8083; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; proxy_buffering off; }
    location /v2/quay/ { rewrite ^/v2/quay/(.*)\$ /v2/\$1 break; proxy_pass http://127.0.0.1:8084; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; proxy_buffering off; }
    location /v2/k8s/ { rewrite ^/v2/k8s/(.*)\$ /v2/\$1 break; proxy_pass http://127.0.0.1:8085; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; proxy_buffering off; }
    location /v2/mcr/ { rewrite ^/v2/mcr/(.*)\$ /v2/\$1 break; proxy_pass http://127.0.0.1:8086; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; proxy_buffering off; }
    # Cargo sparse index: crate downloads also go through the mirror
    location = /repository/crates/config.json { default_type application/json; return 200 '{"dl":"https://$HOST/repository/crates-dl/crates/{crate}/{crate}-{version}.crate","api":"https://crates.io"}'; }
    # Docker registry API (registry-mirrors) → the Docker connector
    location /v2/ {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_request_buffering off;
    }
    # package repositories only; the Nexus UI and admin API stay private
    location /repository/ {
        limit_except GET HEAD { deny all; }
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_buffering off;
    }
    location / { return 404; }
}
NGINX
ln -sfn /etc/nginx/sites-available/gereh-mirror /etc/nginx/sites-enabled/gereh-mirror
nginx -t && systemctl reload nginx
certbot --nginx -d "$HOST" --non-interactive --agree-tos -m "$EMAIL" --redirect --keep-until-expiring || echo "!! certificate failed: point $HOST's A record here, then re-run"

say "done"
cat <<EOF
Mirror:        https://$HOST
Nexus admin:   ssh -L 8081:127.0.0.1:8081 root@this-server, then http://localhost:8081 (admin / $(cat /root/nexus-admin.txt))
Test:          curl -s https://$HOST/repository/npm/react | head -c 200
               docker pull $HOST/library/nginx:alpine
On the Gereh site server add to the env (sudo gereh env):  MIRROR_URL=https://$HOST
and for Gereh Apps builds:                                   PAAS_MIRROR=https://$HOST
EOF
