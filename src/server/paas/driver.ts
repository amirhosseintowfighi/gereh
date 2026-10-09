/* What Gereh Apps needs from the container platform. Two implementations:
   - KubernetesDriver (./kubernetes.ts): builds with in-cluster Jobs (Nixpacks + Kaniko) and runs
     apps and databases as Kubernetes objects; used when PAAS_K8S_API and PAAS_K8S_TOKEN are set.
   - SimulatorDriver (below): in-process stand-in with realistic timings and logs for dev, CI and demos.
   Long operations are split into start + poll so the worker never blocks on a build. */
import "server-only";
import { stackOf } from "@/lib/paas";
import type { ComposeService } from "./compose";

export type AppSpec = {
  id: string; userId: string; name: string; stack: string; source: "git" | "zip" | "image" | "compose";
  gitUrl: string; gitBranch: string; image: string; rootDir: string; buildCommand: string; startCommand: string;
  port: number; healthPath: string; cpu: number; ramMb: number; instances: number; autoscale: boolean; maxInstances: number;
  diskGb: number; diskMount: string; env: Record<string, string>; hosts: string[];
  /** edge cache; cacheVersion is part of the cache key, so bumping it empties the cache */
  cdn: boolean; cacheVersion: number;
  /** run once per new build before traffic switches (migrations) */
  releaseCommand: string;
  /** background processes from the same image (no HTTP) and scheduled commands (Tehran time) */
  processes: { name: string; command: string; instances: number }[];
  crons: { name: string; schedule: string; command: string; enabled: boolean }[];
};
export type DbSpec = { id: string; userId: string; name: string; engine: string; version: string; cpu: number; ramMb: number; diskGb: number; username: string; password: string; dbName: string; publicAccess: boolean };
export type BuildState = { state: "running" | "succeeded" | "failed"; log: string; image?: string; ref?: string };

export interface PaasDriver {
  readonly name: "kubernetes" | "simulator";
  test(): Promise<{ version: string }>;
  /** starts a build for a deployment; `sourceUrl` serves an uploaded ZIP to the builder; compose apps
      pass their parsed services and get back an image of the form "compose:<json services>" */
  startBuild(app: AppSpec, deploymentId: string, sourceUrl?: string, compose?: ComposeService[]): Promise<string>;
  buildStatus(app: AppSpec, handle: string): Promise<BuildState>;
  /** applies the app's workload with this image (create or update) */
  release(app: AppSpec, image: string, deploymentId: string): Promise<void>;
  rolloutReady(app: AppSpec): Promise<boolean>;
  /** re-applies routing only (domains, CDN); no restart */
  updateRouting(app: AppSpec): Promise<void>;
  setState(app: AppSpec, action: "start" | "stop" | "restart"): Promise<void>;
  remove(app: AppSpec): Promise<void>;
  logs(app: AppSpec, tail: number): Promise<string[]>;
  /** one-off container from `image` with the app's env (release commands, panel/CLI commands) */
  runJob(app: AppSpec, image: string, jobId: string, command: string): Promise<void>;
  jobStatus(app: AppSpec, jobId: string): Promise<{ state: "running" | "succeeded" | "failed"; output: string }>;
  /** applies the app's cron jobs (create, update, remove) with the live image; no restart */
  syncCrons(app: AppSpec, image: string): Promise<void>;
  metrics(targets: { id: string; kind: "app" | "db"; ramMb: number; owner: string; name: string }[]): Promise<{ id: string; cpu: number; ramMb: number; rpm: number }[]>;
  verifyDomain(host: string, appName: string): Promise<boolean>;
  createDb(db: DbSpec): Promise<{ host: string; port: number; publicPort?: number }>;
  dbReady(db: DbSpec): Promise<boolean>;
  updateDb(db: DbSpec): Promise<{ publicPort?: number }>;
  setDbState(db: DbSpec, action: "start" | "stop"): Promise<void>;
  removeDb(db: DbSpec): Promise<void>;
  backupDb(db: DbSpec, backupId: string): Promise<{ sizeMb: number; location: string }>;
  restoreDb(db: DbSpec, location: string): Promise<void>;
}

/* ---------- simulator ---------- */
const buildSeconds = () => Number(process.env.PAAS_SIM_BUILD_SECONDS ?? 8);
const started = new Map<string, number>(); // handle → start time
const composed = new Map<string, ComposeService[]>(); // handle → compose services
const jobs = new Map<string, { t0: number; command: string }>(); // one-off job id → start

function buildScript(app: AppSpec): string[] {
  const s = stackOf(app.stack);
  const src = app.source === "git" ? ["==> Cloning " + app.gitUrl + " (" + app.gitBranch + ")", "    HEAD is now at " + fakeSha(app.id) + " " + "Update"]
    : app.source === "zip" ? ["==> Extracting uploaded archive"] : app.source === "image" ? ["==> Pulling " + app.image] : ["==> Reading docker-compose.yml"];
  const lang: Record<string, string[]> = {
    nextjs: ["==> Detected Next.js (node 22)", "$ npm ci", "added 412 packages in 18s", "$ " + (app.buildCommand || "npm run build"), "   ▲ Next.js 16", "   ✓ Compiled successfully", "   ✓ Generating static pages (24/24)"],
    node: ["==> Detected Node.js 22", "$ npm ci --omit=dev", "added 186 packages in 9s"],
    nuxt: ["==> Detected Nuxt 3", "$ npm ci", "$ npm run build", "   ✔ Server built in 6210ms"],
    react: ["==> Detected Vite app", "$ npm ci", "$ npm run build", "   dist/index.html  0.46 kB", "   ✓ built in 3.1s", "==> Serving dist/ with nginx"],
    django: ["==> Detected Python 3.12 (Django)", "$ pip install -r requirements.txt", "Successfully installed Django-5.1 gunicorn-23.0", "$ python manage.py collectstatic --noinput", "134 static files copied."],
    fastapi: ["==> Detected Python 3.12 (FastAPI)", "$ pip install -r requirements.txt", "Successfully installed fastapi-0.115 uvicorn-0.32"],
    flask: ["==> Detected Python 3.12 (Flask)", "$ pip install -r requirements.txt", "Successfully installed Flask-3.1 gunicorn-23.0"],
    python: ["==> Detected Python 3.12", "$ pip install -r requirements.txt"],
    laravel: ["==> Detected PHP 8.3 (Laravel)", "$ composer install --no-dev --optimize-autoloader", "Generating optimized autoload files", "$ php artisan config:cache"],
    php: ["==> Detected PHP 8.3", "$ composer install --no-dev"],
    wordpress: ["==> Detected WordPress", "==> PHP 8.3 + Nginx, uploads on persistent disk"],
    go: ["==> Detected Go 1.23", "$ go build -o app .", "==> Binary size 14.2 MB"],
    java: ["==> Detected Java 21 (Maven)", "$ mvn -DskipTests package", "[INFO] BUILD SUCCESS"],
    dotnet: ["==> Detected .NET 8", "$ dotnet publish -c Release", "  app -> /app/publish/"],
    ruby: ["==> Detected Ruby 3.3 (Rails)", "$ bundle install", "$ bundle exec rails assets:precompile"],
    static: ["==> Static site: serving with nginx"],
    nestjs: ["==> Detected NestJS (node 22)", "$ npm ci", "$ npm run build", "   nest build: done"],
    sveltekit: ["==> Detected SvelteKit (adapter-node)", "$ npm ci", "$ npm run build", "   ✓ built in 4.2s"],
    astro: ["==> Detected Astro", "$ npm ci", "$ npm run build", "   ✓ 38 page(s) built"],
    remix: ["==> Detected React Router / Remix", "$ npm ci", "$ npm run build", "   ✓ built server and client"],
    angular: ["==> Detected Angular", "$ npm ci", "$ npm run build", "   Application bundle generation complete.", "==> Serving dist/ with nginx"],
    bun: ["==> Detected Bun 1.2", "$ bun install", "   124 packages installed"],
    deno: ["==> Detected Deno 2", "$ deno install", "$ deno task build"],
    rust: ["==> Detected Rust (cargo)", "$ cargo build --release", "   Compiling app v0.1.0", "    Finished `release` profile [optimized]"],
    docker: ["==> Building Dockerfile", "#1 [internal] load build definition from Dockerfile", "#7 exporting layers done"],
    compose: ["==> Building services from docker-compose.yml", "   web: build done", "   worker: build done"],
  };
  return [
    ...src,
    ...(lang[app.stack] ?? ["==> Building"]),
    "==> Pushing image registry.gereh.net/" + app.userId + "/" + app.name,
    "==> Build finished (" + (s?.label ?? app.stack) + ")",
  ];
}
const fakeSha = (seed: string) => [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(7, "0").slice(0, 7);
const stamp = (d: Date) => d.toISOString().slice(11, 19);

export class SimulatorDriver implements PaasDriver {
  readonly name = "simulator" as const;
  async test() { return { version: "Simulator" }; }
  async startBuild(app: AppSpec, deploymentId: string, _sourceUrl?: string, compose?: ComposeService[]) {
    started.set(deploymentId, Date.now());
    if (compose) composed.set(deploymentId, compose);
    return deploymentId;
  }
  async buildStatus(app: AppSpec, handle: string): Promise<BuildState> {
    const secs = buildSeconds();
    const t0 = started.get(handle) ?? Date.now() - secs * 1000;
    const lines = buildScript(app);
    const frac = secs <= 0 ? 1 : Math.min(1, (Date.now() - t0) / (secs * 1000));
    const shown = lines.slice(0, Math.max(1, Math.ceil(lines.length * frac)));
    const failing = /fail|broken/.test(app.gitUrl + app.image);
    if (frac >= 1 && failing) return { state: "failed", log: [...shown.slice(0, 3), "ERROR: build step exited with code 1"].join("\n") };
    if (frac < 1) return { state: "running", log: shown.join("\n") };
    started.delete(handle);
    const services = composed.get(handle);
    composed.delete(handle);
    const tag = "registry.gereh.net/" + app.userId + "/" + app.name;
    const image = services ? "compose:" + JSON.stringify(services.map((s) => ({ ...s, image: s.image ?? tag + "-" + s.name + ":" + handle }))) : tag + ":" + handle;
    const log = services ? [...lines.slice(0, -2), ...services.map((s) => "   " + s.name + ": " + (s.build ? "built" : "pulled " + s.image)), ...lines.slice(-2)] : lines;
    return { state: "succeeded", log: log.join("\n"), image, ref: app.source === "git" ? fakeSha(handle) : undefined };
  }
  async release() {}
  async rolloutReady() { return true; }
  async updateRouting() {}
  async setState() {}
  async remove() {}
  async logs(app: AppSpec, tail: number) {
    const now = Date.now();
    const paths = ["/", "/api/health", "/login", "/api/items", "/static/app.js", "/favicon.ico"];
    const out: string[] = [];
    for (let i = tail - 1; i >= 0; i--) {
      const t = new Date(now - i * 17_000);
      const k = (i * 7 + app.name.length) % 23;
      out.push(k === 0
        ? stamp(t) + " [" + app.name + "-" + fakeSha(app.id).slice(0, 5) + "] listening on 0.0.0.0:" + app.port
        : stamp(t) + " " + ["GET", "GET", "POST", "GET"][k % 4] + " " + paths[k % paths.length] + " " + (k % 13 === 0 ? 404 : 200) + " " + (8 + (k * 13) % 120) + "ms");
    }
    return out;
  }
  async metrics(targets: { id: string; kind: "app" | "db"; ramMb: number }[]) {
    const t = Date.now() / 600_000;
    const seed = (id: string) => [...id].reduce((h, c) => h + c.charCodeAt(0), 0);
    return targets.map((x) => {
      const s = seed(x.id);
      const w = (base: number, amp: number, k: number) => Math.max(0, base + amp * Math.sin(t + s * k));
      return { id: x.id, cpu: Math.round(w(18 + (s % 30), 10, 0.7) * 10) / 10, ramMb: Math.round(x.ramMb * Math.min(0.92, w(0.35 + (s % 40) / 100, 0.08, 1.3))), rpm: x.kind === "app" ? Math.round(w(40 + (s % 200), 30, 0.4)) : 0 };
    });
  }
  async runJob(_app: AppSpec, _image: string, jobId: string, command: string) { jobs.set(jobId, { t0: Date.now(), command }); }
  async jobStatus(_app: AppSpec, jobId: string) {
    const j = jobs.get(jobId);
    if (!j) return { state: "failed" as const, output: "job not found (the simulator forgets jobs on restart)" };
    const secs = buildSeconds() / 4;
    if (Date.now() - j.t0 < secs * 1000) return { state: "running" as const, output: "$ " + j.command };
    const failed = /\bfail|exit [1-9]/.test(j.command);
    const out = ["$ " + j.command, ...(/migrat/.test(j.command) ? ["Operations to perform: Apply all migrations", "Running migrations:", "  Applying app.0012_orders... OK"] : ["done"]), ...(failed ? ["ERROR: command exited with code 1"] : [])];
    return { state: failed ? "failed" as const : "succeeded" as const, output: out.join("\n") };
  }
  async syncCrons() {}
  async verifyDomain(host: string) { return !/invalid|example\.(com|org|net)$/.test(host); }
  async createDb(db: DbSpec) { return { host: db.name + "." + db.userId + ".db.gereh.internal", port: ({ postgres: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017, redis: 6379 } as Record<string, number>)[db.engine], publicPort: db.publicAccess ? 30000 + (db.id.length * 97) % 2000 : undefined }; }
  async dbReady() { return true; }
  async updateDb(db: DbSpec) { return { publicPort: db.publicAccess ? 30000 + (db.id.length * 97) % 2000 : undefined }; }
  async setDbState() {}
  async removeDb() {}
  async backupDb(db: DbSpec, backupId: string) { return { sizeMb: Math.round((12 + (db.id.length * 37) % 400) * 10) / 10, location: "s3://gereh-backups/" + db.userId + "/" + db.id + "/" + backupId + ".dump" }; }
  async restoreDb() {}
}

let cached: PaasDriver | null = null;
/** the configured driver (Kubernetes when PAAS_K8S_API + PAAS_K8S_TOKEN are set) */
export async function paas(): Promise<PaasDriver> {
  if (cached) return cached;
  if (process.env.PAAS_K8S_API && process.env.PAAS_K8S_TOKEN) {
    const { KubernetesDriver } = await import("./kubernetes");
    cached = new KubernetesDriver();
  } else cached = new SimulatorDriver();
  return cached;
}
export const resetPaasDriver = () => { cached = null; };
