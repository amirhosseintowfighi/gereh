/* docker-compose.yml → the subset Gereh Apps runs: services built from a context or pulled from an
   image, their command, ports and environment. One service is public (gets the app's URL); the
   others are private and reachable from the rest by their compose service name.
   Unsupported keys are reported as warnings in the build log instead of failing the deploy. */
import "server-only";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { projectFiles } from "../unzip";

export type ComposeService = {
  name: string;
  /** set for services built from source; the build fills in `image` */
  build?: { context: string; dockerfile?: string };
  image?: string;
  command?: string;
  port?: number;
  env: Record<string, string>;
  public: boolean;
};
export class ComposeError extends Error {}

export const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
const NAME_RE = /^[a-z][a-z0-9-]{0,19}$/;
const IGNORED = new Set(["depends_on", "networks", "restart", "container_name", "healthcheck", "logging", "labels", "expose", "stdin_open", "tty", "init"]);
const MAX_SERVICES = 8;

const shellJoin = (a: unknown[]) => a.map((x) => { const s = String(x); return /^[\w@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'"; }).join(" ");
const safePath = (p: string) => {
  const clean = p.trim().replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (clean.startsWith("/") || clean.split("/").includes("..")) throw new ComposeError("مسیر بیلد «" + p + "» باید داخل پروژه باشد.");
  return clean === "" || clean === "." ? "." : clean;
};
/** "8080:80", "127.0.0.1:8080:80/tcp", 80, { target: 80 } → 80 */
function containerPort(p: unknown): number | undefined {
  if (typeof p === "number") return p;
  if (p && typeof p === "object" && "target" in p) return Number((p as { target: unknown }).target) || undefined;
  if (typeof p === "string") { const n = Number(p.split("/")[0].split(":").pop()); return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined; }
  return undefined;
}
function envOf(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(e)) for (const line of e) { const s = String(line); const i = s.indexOf("="); if (i > 0) out[s.slice(0, i)] = s.slice(i + 1); }
  else if (e && typeof e === "object") for (const [k, v] of Object.entries(e)) if (v !== null && v !== undefined) out[k] = String(v);
  return out;
}
const isPublicLabel = (labels: unknown) => {
  if (Array.isArray(labels)) return labels.some((l) => /^gereh\.public\s*=\s*(true|1|yes)$/i.test(String(l)));
  if (labels && typeof labels === "object") return /^(true|1|yes)$/i.test(String((labels as Record<string, unknown>)["gereh.public"] ?? ""));
  return false;
};

export function parseCompose(text: string): { services: ComposeService[]; warnings: string[] } {
  let doc: unknown;
  try { doc = parse(text, { maxAliasCount: 50 }); } catch (e) { throw new ComposeError("فایل compose خوانا نیست: " + (e as Error).message.split("\n")[0]); }
  const raw = (doc as { services?: Record<string, Record<string, unknown>> })?.services;
  if (!raw || typeof raw !== "object" || !Object.keys(raw).length) throw new ComposeError("بخش services در فایل compose پیدا نشد.");
  if (Object.keys(raw).length > MAX_SERVICES) throw new ComposeError("حداکثر " + MAX_SERVICES + " سرویس پشتیبانی می‌شود.");
  const warnings: string[] = [];
  const services: ComposeService[] = [];
  let labelled = false;
  for (const [key, def] of Object.entries(raw)) {
    const name = key.toLowerCase().replace(/_/g, "-");
    if (!NAME_RE.test(name)) throw new ComposeError("نام سرویس «" + key + "» باید با حرف انگلیسی شروع شود و حداکثر ۲۰ نویسه باشد.");
    if (!def || typeof def !== "object") throw new ComposeError("سرویس «" + key + "» تعریف ندارد.");
    const s: ComposeService = { name, env: envOf(def.environment), public: false };
    if (def.build) {
      const b = typeof def.build === "string" ? { context: def.build } : (def.build as { context?: string; dockerfile?: string });
      s.build = { context: safePath(b.context ?? "."), ...(b.dockerfile ? { dockerfile: safePath(String(b.dockerfile)) } : {}) };
    } else if (typeof def.image === "string" && def.image) s.image = def.image;
    else throw new ComposeError("سرویس «" + key + "» نه build دارد نه image.");
    if (def.command) s.command = Array.isArray(def.command) ? shellJoin(def.command) : String(def.command);
    const ports = Array.isArray(def.ports) ? def.ports.map(containerPort).filter((p): p is number => !!p) : [];
    if (ports.length) s.port = ports[0];
    if (ports.length > 1) warnings.push(`${name}: فقط پورت ${ports[0]} در دسترس قرار می‌گیرد.`);
    if (isPublicLabel(def.labels)) { s.public = true; labelled = true; }
    if (def.volumes) warnings.push(`${name}: volumes نادیده گرفته شد؛ برای داده ماندگار از پایگاه داده مدیریت‌شده یا دیسک دائمی اپ استفاده کنید.`);
    if (def.env_file) warnings.push(`${name}: env_file نادیده گرفته شد؛ متغیرها را در تب «متغیرها» تعریف کنید.`);
    for (const k of Object.keys(def)) if (!["build", "image", "command", "ports", "environment", "volumes", "env_file"].includes(k) && !IGNORED.has(k)) warnings.push(`${name}: کلید ${k} پشتیبانی نمی‌شود و نادیده گرفته شد.`);
    services.push(s);
  }
  if (services.filter((s) => s.public).length > 1) throw new ComposeError("فقط یک سرویس می‌تواند برچسب gereh.public داشته باشد.");
  if (!labelled) {
    const first = services.find((s) => s.port);
    if (!first) throw new ComposeError("هیچ سرویسی ports ندارد؛ سرویس عمومی را با ports یا برچسب gereh.public=true مشخص کنید.");
    first.public = true;
  }
  const pub = services.find((s) => s.public)!;
  if (!pub.port) throw new ComposeError("سرویس عمومی «" + pub.name + "» باید ports داشته باشد.");
  return { services, warnings };
}

/** reads and parses the compose file from an uploaded project ZIP */
export async function composeFromZip(zipPath: string, rootDir = "") {
  const files = projectFiles(await readFile(zipPath), new Set(COMPOSE_FILES), rootDir).files;
  const name = COMPOSE_FILES.find((f) => typeof files.get(f) === "string");
  if (!name) throw new ComposeError("فایل docker-compose.yml در ریشه پروژه پیدا نشد.");
  return parseCompose(files.get(name)!);
}
