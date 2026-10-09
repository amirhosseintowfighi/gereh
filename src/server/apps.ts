/* One-click apps: cloud-init user-data handed to Virtualizor at creation time. Each script is
   idempotent and logs to /var/log/gereh-app.log; credentials it generates land in /root/app-credentials.txt. */
import "server-only";

const header = (title: string) => `#cloud-config
package_update: true
write_files:
  - path: /etc/motd
    append: true
    content: |
      ${title} — installed by Gereh one-click apps. Credentials: /root/app-credentials.txt
runcmd:
  - [ bash, -c, "set -euo pipefail; exec >>/var/log/gereh-app.log 2>&1; curl -fsSL https://get.docker.com | sh" ]
`;

// files go in as base64: a multi-line string inside cloud-init's flow sequence would be folded
const b64 = (t: string) => Buffer.from(t).toString("base64");
const WP_COMPOSE = `services:
  db: { image: mariadb:11, restart: unless-stopped, environment: { MARIADB_DATABASE: wp, MARIADB_USER: wp, MARIADB_PASSWORD: \${DB_PASS}, MARIADB_ROOT_PASSWORD: \${ROOT_PASS} }, volumes: [db:/var/lib/mysql] }
  wp: { image: wordpress:6, restart: unless-stopped, ports: ['80:80'], environment: { WORDPRESS_DB_HOST: db, WORDPRESS_DB_USER: wp, WORDPRESS_DB_PASSWORD: \${DB_PASS}, WORDPRESS_DB_NAME: wp }, volumes: [wp:/var/www/html], depends_on: [db] }
volumes: { db: {}, wp: {} }
`;

const SCRIPTS: Record<string, string> = {
  docker: header("Docker") + `  - [ bash, -c, "systemctl enable --now docker" ]
`,
  wordpress: header("WordPress") + `  - [ bash, -c, "set -euo pipefail; mkdir -p /opt/wordpress && cd /opt/wordpress && P=$(openssl rand -hex 16) && R=$(openssl rand -hex 16) && printf 'DB_PASS=%s\\nROOT_PASS=%s\\n' $P $R > .env && chmod 600 .env && echo ${b64(WP_COMPOSE)} | base64 -d > compose.yml && docker compose up -d && echo \\"WordPress: http://$(hostname -I | cut -d' ' -f1)/ (complete setup in the browser)\\" > /root/app-credentials.txt" ]
`,
  n8n: header("n8n") + `  - [ bash, -c, "set -euo pipefail; docker volume create n8n_data && docker run -d --restart unless-stopped --name n8n -p 5678:5678 -e N8N_SECURE_COOKIE=false -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n && echo \\"n8n: http://$(hostname -I | cut -d' ' -f1):5678/\\" > /root/app-credentials.txt" ]
`,
  nextcloud: header("Nextcloud") + `  - [ bash, -c, "set -euo pipefail; P=$(openssl rand -hex 12); docker run -d --restart unless-stopped --name nextcloud -p 80:80 -e NEXTCLOUD_ADMIN_USER=admin -e NEXTCLOUD_ADMIN_PASSWORD=$P -e SQLITE_DATABASE=nextcloud -v nextcloud:/var/www/html nextcloud:29 && printf 'Nextcloud: http://%s/\\nuser: admin\\npassword: %s\\n' $(hostname -I | cut -d' ' -f1) $P > /root/app-credentials.txt && chmod 600 /root/app-credentials.txt" ]
`,
  gitlab: header("GitLab CE") + `  - [ bash, -c, "set -euo pipefail; docker run -d --restart unless-stopped --name gitlab --shm-size 256m -p 80:80 -p 443:443 -p 2222:22 -v gitlab_config:/etc/gitlab -v gitlab_logs:/var/log/gitlab -v gitlab_data:/var/opt/gitlab gitlab/gitlab-ce:latest && echo 'GitLab: http://SERVER_IP/ — initial root password: docker exec gitlab cat /etc/gitlab/initial_root_password' > /root/app-credentials.txt" ]
`,
  portainer: header("Portainer") + `  - [ bash, -c, "set -euo pipefail; docker volume create portainer_data && docker run -d --restart unless-stopped --name portainer -p 9443:9443 -v /var/run/docker.sock:/var/run/docker.sock -v portainer_data:/data portainer/portainer-ce:2.24.1 && echo \\"Portainer: https://$(hostname -I | cut -d' ' -f1):9443/ (create the admin user within 5 minutes)\\" > /root/app-credentials.txt" ]
`,
  "uptime-kuma": header("Uptime Kuma") + `  - [ bash, -c, "set -euo pipefail; docker volume create uptime-kuma && docker run -d --restart unless-stopped --name uptime-kuma -p 80:3001 -v uptime-kuma:/app/data louislam/uptime-kuma:1.23.16 && echo \\"Uptime Kuma: http://$(hostname -I | cut -d' ' -f1)/\\" > /root/app-credentials.txt" ]
`,
  "wg-easy": header("WireGuard (wg-easy)") + `  - [ bash, -c, "set -euo pipefail; IP=$(hostname -I | cut -d' ' -f1); P=$(openssl rand -hex 12); H=$(docker run --rm ghcr.io/wg-easy/wg-easy:14 wgpw \\"$P\\" | sed -E \\"s/^PASSWORD_HASH='(.*)'$/\\\\1/\\"); docker run -d --restart unless-stopped --name wg-easy -e WG_HOST=$IP -e PASSWORD_HASH=\\"$H\\" -v /etc/wireguard:/etc/wireguard -p 51820:51820/udp -p 51821:51821/tcp --cap-add=NET_ADMIN --cap-add=SYS_MODULE --sysctl net.ipv4.ip_forward=1 --sysctl net.ipv4.conf.all.src_valid_mark=1 ghcr.io/wg-easy/wg-easy:14 && printf 'wg-easy: http://%s:51821/\\\\npassword: %s\\\\n' $IP $P > /root/app-credentials.txt" ]
`,
  minio: header("MinIO (S3)") + `  - [ bash, -c, "set -euo pipefail; P=$(openssl rand -hex 16); docker volume create minio && docker run -d --restart unless-stopped --name minio -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD=$P -v minio:/data minio/minio:RELEASE.2024-12-18T13-15-44Z server /data --console-address :9001 && printf 'MinIO console: http://%s:9001/\\\\nS3 endpoint: http://%s:9000\\\\nuser: admin\\\\npassword: %s\\\\n' $(hostname -I | cut -d' ' -f1) $(hostname -I | cut -d' ' -f1) $P > /root/app-credentials.txt" ]
`,
  coolify: header("Coolify") + `  - [ bash, -c, "set -euo pipefail; curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash && echo \\"Coolify: http://$(hostname -I | cut -d' ' -f1):8000/ (create the admin user)\\" > /root/app-credentials.txt" ]
`,
  "outline-vpn": header("Outline VPN") + `  - [ bash, -c, "set -euo pipefail; bash -c \\"$(wget -qO- https://raw.githubusercontent.com/Jigsaw-Code/outline-server/master/src/server_manager/install_scripts/install_server.sh)\\" -- --keys-port 443 > /root/app-credentials.txt 2>&1" ]
`,
};

/** cloud-init user-data for an app id, or undefined for a bare OS */
export const cloudInitFor = (app?: string) => (app ? SCRIPTS[app] : undefined);
export const APP_IDS = Object.keys(SCRIPTS);
