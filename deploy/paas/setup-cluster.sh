#!/usr/bin/env bash
# Sets up a single-node Gereh Apps cluster on a fresh Ubuntu 22.04/24.04 server:
# k3s, ingress-nginx, cert-manager, private registry, MinIO (backups), the platform namespace and the
# builder image; prints the values to paste into the site's .env. Re-running is safe.
#
#   sudo APPS_DOMAIN=gereh.app ACME_EMAIL=ops@gereh.net SITE_URL=https://gereh.net bash setup-cluster.sh
#
# Before running: point  *.APPS_DOMAIN  and  APPS_DOMAIN  (A records) to this server's public IP.
set -Eeuo pipefail
APPS_DOMAIN=${APPS_DOMAIN:?set APPS_DOMAIN, e.g. gereh.app}
ACME_EMAIL=${ACME_EMAIL:?set ACME_EMAIL}
SITE_URL=${SITE_URL:-}
HERE=$(cd "$(dirname "$0")" && pwd)
STATE=/etc/gereh-paas; mkdir -p "$STATE"; chmod 700 "$STATE"
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
gen() { [ -s "$STATE/$1" ] || head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32 > "$STATE/$1"; cat "$STATE/$1"; }
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }

say "packages"
apt-get update -qq && apt-get install -y -qq curl apache2-utils jq >/dev/null

say "k3s (without Traefik; ingress-nginx is installed below)"
if ! command -v k3s >/dev/null; then
  curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --disable traefik --write-kubeconfig-mode 600" sh -
fi
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
until kubectl get nodes 2>/dev/null | grep -q ' Ready'; do sleep 3; done

say "helm"
command -v helm >/dev/null || curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

say "ingress-nginx (default certificate = *.$APPS_DOMAIN)"
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx >/dev/null 2>&1 || true
helm repo add jetstack https://charts.jetstack.io >/dev/null 2>&1 || true
helm repo update >/dev/null
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace --wait \
  --set controller.extraArgs.default-ssl-certificate=ingress-nginx/apps-wildcard-tls \
  --set controller.allowSnippetAnnotations=false \
  --set controller.config.use-forwarded-headers=true \
  --set controller.metrics.enabled=true

say "cert-manager"
helm upgrade --install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --wait --set crds.enabled=true
sed "s/ops@gereh.net/$ACME_EMAIL/" "$HERE/cluster-issuer.yaml" | kubectl apply -f -

say "platform namespace and controller account"
kubectl apply -f "$HERE/system.yaml"

say "registry (registry.$APPS_DOMAIN)"
REG_PASS=$(gen registry-password)
htpasswd -Bbn gereh "$REG_PASS" > "$STATE/htpasswd"
kubectl -n gereh-system create secret generic registry-auth --from-file=htpasswd="$STATE/htpasswd" --dry-run=client -o yaml | kubectl apply -f -
sed "s/registry.gereh.app/registry.$APPS_DOMAIN/g" "$HERE/registry.yaml" | kubectl apply -f -
kubectl -n gereh-system create secret docker-registry registry-push --docker-server="registry.$APPS_DOMAIN" --docker-username=gereh --docker-password="$REG_PASS" --dry-run=client -o yaml | kubectl apply -f -
PULL_SECRET=$(kubectl -n gereh-system get secret registry-push -o jsonpath='{.data.\.dockerconfigjson}')
echo "  waiting for the registry certificate (DNS for registry.$APPS_DOMAIN must point here)…"
for _ in $(seq 60); do kubectl -n gereh-system get certificate registry-tls >/dev/null 2>&1 && break; sleep 2; done
kubectl -n gereh-system wait certificate/registry-tls --for=condition=Ready --timeout=600s || echo "  ! certificate not ready yet; builds will fail until it is (kubectl -n gereh-system describe certificate registry-tls)"

say "MinIO for database backups"
MINIO_PASS=$(gen minio-password)
kubectl -n gereh-system create secret generic minio-root --from-literal=MINIO_ROOT_USER=gereh --from-literal=MINIO_ROOT_PASSWORD="$MINIO_PASS" --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$HERE/minio.yaml"
kubectl -n gereh-system create secret generic backup-s3 --from-literal=S3_ENDPOINT=http://minio.gereh-system.svc:9000 --from-literal=S3_ACCESS_KEY=gereh --from-literal=S3_SECRET_KEY="$MINIO_PASS" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n gereh-system rollout status deploy/minio --timeout=300s
kubectl -n gereh-system run mc-init --rm -i --restart=Never --image=minio/mc:RELEASE.2025-04-16T18-13-26Z --env="P=$MINIO_PASS" --command -- \
  sh -c 'mc alias set s3 http://minio.gereh-system.svc:9000 gereh "$P" >/dev/null && mc mb -p s3/gereh-backups && mc ilm rule add --expire-days 35 s3/gereh-backups || true' || true

say "wildcard certificate"
echo "  Wildcards need a DNS-01 solver for your DNS provider: edit $HERE/wildcard-cert.yaml and apply it."
echo "  Until then the default host of each app is served with the controller's self-signed certificate."

say "builder image (built inside the cluster with Kaniko)"
kubectl -n gereh-system create configmap builder-context --from-file=Dockerfile="$HERE/builder/Dockerfile" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n gereh-system delete job build-builder --ignore-not-found
cat <<YAML | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata: { name: build-builder, namespace: gereh-system }
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: kaniko
          image: gcr.io/kaniko-project/executor:v1.23.2
          args: ["--context=dir:///ctx", "--dockerfile=/ctx/Dockerfile", "--destination=registry.$APPS_DOMAIN/gereh/builder:1"]
          volumeMounts: [{ name: ctx, mountPath: /ctx }, { name: push, mountPath: /kaniko/.docker }]
      volumes:
        - { name: ctx, configMap: { name: builder-context } }
        - { name: push, secret: { secretName: registry-push, items: [{ key: .dockerconfigjson, path: config.json }] } }
YAML
echo "  (follow with: kubectl -n gereh-system logs -f job/build-builder)"

say "controller token"
until kubectl -n gereh-system get secret gereh-controller-token -o jsonpath='{.data.token}' 2>/dev/null | grep -q .; do sleep 2; done
TOKEN=$(kubectl -n gereh-system get secret gereh-controller-token -o jsonpath='{.data.token}' | base64 -d)
kubectl -n gereh-system get secret gereh-controller-token -o jsonpath='{.data.ca\.crt}' | base64 -d > "$STATE/k8s-ca.crt"
IP=$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')

cat <<OUT

────────────────────────────────────────────────────────────────────────────
Done. On the SITE server:
  1) copy $STATE/k8s-ca.crt to /etc/gereh/k8s-ca.crt
  2) add these lines to /opt/gereh/shared/.env  (gereh env edit), then: gereh restart

PAAS_APPS_DOMAIN=$APPS_DOMAIN
PAAS_K8S_API=https://$IP:6443
PAAS_K8S_TOKEN=$TOKEN
PAAS_K8S_CA=/etc/gereh/k8s-ca.crt
PAAS_REGISTRY=registry.$APPS_DOMAIN
PAAS_REGISTRY_PULL_SECRET=$PULL_SECRET
PAAS_BUILDER_IMAGE=registry.$APPS_DOMAIN/gereh/builder:1
PAAS_INGRESS_IP=$IP
${SITE_URL:+PAAS_SOURCE_BASE_URL=$SITE_URL}

  3) In the admin panel: گره اپ › زیرساخت › تست اتصال, and set the apps domain to $APPS_DOMAIN.
  4) Firewall: open 80, 443 to everyone; 6443 only to the site server's IP;
     30000-32767 only if you offer public database access.
Secrets generated by this script are kept in $STATE (root only).
────────────────────────────────────────────────────────────────────────────
OUT
