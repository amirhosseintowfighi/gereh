# Optional container image of the whole Gereh app (the supported install is deploy/install.sh + «gereh update»;
# this is for container platforms and local trials). The token optimizer is in-process: nothing extra runs.
#   docker build -t gereh .
#   docker run -p 3000:3000 --env-file .env gereh
# Without DATABASE_URL the app uses an embedded PGlite database at PGLITE_DIR (mount a volume to keep it).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=3072 npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 PGLITE_DIR=/data/pglite
RUN useradd --system --uid 10001 gereh && mkdir -p /data && chown gereh /data
# migrations (drizzle/) run on first start; tests/fixtures/ai-opt is the token-optimizer benchmark dataset
COPY --from=build --chown=gereh /app /app
USER gereh
VOLUME ["/data"]
EXPOSE 3000
CMD ["npm", "start"]
