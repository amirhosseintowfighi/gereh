# Source preparation image for build Jobs: git, wget, unzip and Nixpacks (writes a Dockerfile for
# projects that don't have one). Build and push it to your registry, then set PAAS_BUILDER_IMAGE:
#   docker build -t registry.gereh.dev/gereh/builder:1 deploy/paas/builder
#   docker push registry.gereh.dev/gereh/builder:1
FROM debian:bookworm-slim
ARG NIXPACKS_VERSION=1.39.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git wget unzip \
 && curl -fsSL "https://github.com/railwayapp/nixpacks/releases/download/v${NIXPACKS_VERSION}/nixpacks-v${NIXPACKS_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin nixpacks \
 && nixpacks --version \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
