# PostgreSQL + WAL-G for point-in-time recovery (Gereh managed databases with PITR on).
#   docker build --build-arg PG=17 -t registry.gereh.net/gereh/postgres-walg:17 . && docker push …
# Build one tag per supported major version (17, 16, 15); set PAAS_PG_WALG_IMAGE to the repository.
ARG PG=17
FROM postgres:${PG}-alpine
ARG WALG=v3.0.5
RUN apk add --no-cache curl ca-certificates \
 && arch=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/aarch64/') \
 && curl -fsSL "https://github.com/wal-g/wal-g/releases/download/${WALG}/wal-g-pg-ubuntu-20.04-${arch}.tar.gz" | tar -xz -C /usr/local/bin \
 && mv /usr/local/bin/wal-g-pg-ubuntu-20.04-${arch} /usr/local/bin/wal-g \
 && chmod +x /usr/local/bin/wal-g && apk del curl
