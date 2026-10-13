/* How a pinned runtime version is built (shared by the builder, the simulator and the tests).
   Versions Nixpacks installs itself go to it as its own variable; everything else, and the static
   site generators Nixpacks has no provider for (Hugo, Jekyll), builds from the official language
   image with the Dockerfile generated here. A Dockerfile in the repository always wins. */
import { RUNTIMES, stackDefaultVersion, stackOf, stackVersions } from "./paas";

export type VersionBuild = { runtime: string; version: string; nixEnv?: Record<string, string>; dockerfile?: string };

/** package-manager mirror variables the builder passes as build args (see mirrorEnv) */
const MIRROR_ARGS = ["NPM_CONFIG_REGISTRY", "YARN_NPM_REGISTRY_SERVER", "PIP_INDEX_URL", "UV_INDEX_URL", "GOPROXY"];
const args = MIRROR_ARGS.map((a) => "ARG " + a).join("\n");
/** apt on releases Debian has moved to archive.debian.org (old PHP, Python and Ruby images) */
const APT = "(apt-get update || { sed -i -e 's#deb.debian.org#archive.debian.org#g' -e 's#security.debian.org#archive.debian.org#g' -e '/-updates/d' /etc/apt/sources.list /etc/apt/sources.list.d/* 2>/dev/null; apt-get -o Acquire::Check-Valid-Until=false update; })";
const NGINX = "nginx:1.29-alpine";
const SERVE_STATIC = [
  `FROM ${NGINX}`,
  `RUN printf 'server {\\n  listen 80;\\n  root /usr/share/nginx/html;\\n  location / { try_files $uri $uri/ /index.html; }\\n}\\n' > /etc/nginx/conf.d/default.conf`,
  "COPY --from=build /out /usr/share/nginx/html",
  "EXPOSE 80",
].join("\n");
const NODE_INSTALL = "RUN if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; elif [ -f package-lock.json ]; then npm ci; else npm install; fi";
const cmd = (c: string) => "CMD " + c;

function dockerfile(stackId: string, runtime: string, v: string, o: { build?: string; start?: string }): string {
  const s = stackOf(stackId)!;
  const start = o.start || s.start;
  switch (runtime) {
    case "node": {
      const build = o.build || "npm run build --if-present";
      if (s.spa) return [
        `FROM node:${v}-slim AS build`, args, "WORKDIR /app", "COPY . .", NODE_INSTALL, "RUN " + build,
        `RUN mkdir -p /out && for d in dist/*/browser dist build _site public out; do if [ -f "$d/index.html" ]; then cp -a "$d"/. /out/ && break; fi; done && test -f /out/index.html`,
        SERVE_STATIC,
      ].join("\n");
      return [`FROM node:${v}-slim`, args, "WORKDIR /app", "COPY . .", NODE_INSTALL, "RUN " + build, "ENV NODE_ENV=production", cmd(start || "npm start")].join("\n");
    }
    case "bun":
      return [`FROM oven/bun:${v}-slim`, args, "WORKDIR /app", "COPY . .", "RUN bun install --frozen-lockfile || bun install",
        "RUN " + (o.build || "if grep -q '\"build\"' package.json; then bun run build; fi"), "ENV NODE_ENV=production", cmd(start || "bun run start")].join("\n");
    case "deno":
      return [`FROM denoland/deno:${v}`, "WORKDIR /app", "COPY . .", "RUN " + (o.build || "if grep -qs '\"build\"' deno.json deno.jsonc; then deno task build; fi"), cmd(start || "deno task start")].join("\n");
    case "python": {
      const def = stackId === "fastapi" ? "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}" : start || "python main.py";
      return [`FROM python:${v}-slim`, args, "WORKDIR /app", "ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1", "COPY . .",
        "RUN if [ -f requirements.txt ]; then pip install -r requirements.txt; elif [ -f pyproject.toml ]; then pip install .; fi",
        ...(o.build ? ["RUN " + o.build] : stackId === "django" ? ["RUN python manage.py collectstatic --noinput || true"] : []),
        cmd(o.start || def)].join("\n");
    }
    case "php": {
      const root = stackId === "laravel" ? "/var/www/html/public" : "/var/www/html";
      return [`FROM php:${v}-apache`, args,
        `RUN ${APT} && apt-get install -y --no-install-recommends libpq-dev libzip-dev unzip git && docker-php-ext-install pdo_mysql mysqli pdo_pgsql zip && a2enmod rewrite && rm -rf /var/lib/apt/lists/*`,
        "COPY --from=composer:2 /usr/bin/composer /usr/bin/composer",
        `ENV APACHE_DOCUMENT_ROOT=${root}`,
        `RUN sed -ri -e 's!/var/www/html!\${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf && sed -ri -e 's!AllowOverride None!AllowOverride All!g' /etc/apache2/apache2.conf`,
        "WORKDIR /var/www/html", "COPY . .",
        "RUN if [ -f composer.json ]; then composer install --no-dev --optimize-autoloader --no-interaction; fi",
        ...(o.build ? ["RUN " + o.build] : []),
        "RUN chown -R www-data:www-data /var/www/html", "EXPOSE 80",
        ...(o.start ? [cmd(o.start)] : [])].join("\n");
    }
    case "go":
      return [`FROM golang:${v} AS build`, args, "WORKDIR /src", "COPY . .", "RUN " + (o.build || "CGO_ENABLED=0 go build -o /out/app ."),
        "FROM alpine:3.20", "RUN apk add --no-cache ca-certificates tzdata", "COPY --from=build /out/ /usr/local/bin/", cmd(o.start || "/usr/local/bin/app")].join("\n");
    case "dotnet":
      return [`FROM mcr.microsoft.com/dotnet/sdk:${v} AS build`, "WORKDIR /src", "COPY . .",
        "RUN " + (o.build || `P=$(find . -maxdepth 3 -name '*.csproj' | head -1) && dotnet publish "$P" -c Release -o /out && basename "$P" .csproj > /out/.gereh-entry`),
        `FROM mcr.microsoft.com/dotnet/aspnet:${v}`, "WORKDIR /app", "COPY --from=build /out .",
        cmd(o.start || `export ASPNETCORE_URLS=http://+:\${PORT:-8080}; exec dotnet "$(cat .gereh-entry).dll"`)].join("\n");
    case "ruby": {
      if (stackId === "jekyll") return [`FROM ruby:${v}-slim AS build`,
        `RUN ${APT} && apt-get install -y --no-install-recommends build-essential git && rm -rf /var/lib/apt/lists/*`,
        "WORKDIR /src", "COPY . .", "ENV JEKYLL_ENV=production",
        "RUN " + (o.build || "if [ -f Gemfile ]; then bundle install && bundle exec jekyll build -d /out; else gem install jekyll && jekyll build -d /out; fi"),
        SERVE_STATIC].join("\n");
      return [`FROM ruby:${v}-slim`,
        `RUN ${APT} && apt-get install -y --no-install-recommends build-essential libpq-dev libyaml-dev git && rm -rf /var/lib/apt/lists/*`,
        "WORKDIR /app", "ENV RAILS_ENV=production RACK_ENV=production BUNDLE_WITHOUT=development:test", "COPY . .", "RUN bundle install",
        "RUN " + (o.build || "if [ -f bin/rails ]; then SECRET_KEY_BASE_DUMMY=1 bundle exec rails assets:precompile || true; fi"),
        cmd(start || "if [ -f bin/rails ]; then bundle exec rails server -b 0.0.0.0 -p ${PORT:-3000}; else bundle exec rackup -o 0.0.0.0 -p ${PORT:-3000}; fi")].join("\n");
    }
    case "hugo":
      return ["FROM debian:bookworm-slim AS build",
        "RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git && rm -rf /var/lib/apt/lists/*",
        `RUN curl -fsSL https://github.com/gohugoio/hugo/releases/download/v${v}/hugo_extended_${v}_linux-amd64.tar.gz | tar -xz -C /usr/local/bin hugo`,
        "WORKDIR /src", "COPY . .", "RUN " + (o.build || "hugo --minify --destination /out"), SERVE_STATIC].join("\n");
  }
  throw new Error("no Dockerfile for runtime " + runtime);
}

/** the build plan for a stack and its pinned version; null when the stack has no runtime to pin.
    Hugo and Jekyll always build from the generated Dockerfile (with the default version when none is set). */
export function versionBuild(stackId: string, version: string | undefined, o: { build?: string; start?: string } = {}): VersionBuild | null {
  const s = stackOf(stackId);
  if (!s?.runtime) return null;
  const always = stackId === "hugo" || stackId === "jekyll";
  if (!version && !always) return null;
  const v = version && stackVersions(stackId).includes(version) ? version : always ? stackDefaultVersion(stackId) : undefined;
  if (!v) return null;
  const r = RUNTIMES[s.runtime];
  if (!always && r.nixpacks?.versions.includes(v)) return { runtime: r.label, version: v, nixEnv: { [r.nixpacks.env]: v } };
  return { runtime: r.label, version: v, dockerfile: dockerfile(stackId, s.runtime, v, o) + "\n" };
}
