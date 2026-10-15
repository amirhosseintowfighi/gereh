import { eq } from "drizzle-orm";
import { db } from "@/server/ctx";
import { builderProjects } from "@/server/db/schema";
import { localizeAssets } from "@/server/builder/assets";
import { filesAt } from "@/server/builder/engine";

/* GET /api/build/preview/<token>[.v<version>]/<path> — a builder project's files for the panel preview.
   The token is the capability (only the owner ever sees it). The page is untrusted, AI-written code: a
   CSP sandbox gives it an opaque origin even when opened outside the panel's sandboxed iframe, so it can
   never act with the panel's cookies, and it may not open connections or submit forms anywhere. */
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", svg: "image/svg+xml", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8", xml: "application/xml; charset=utf-8",
  webmanifest: "application/manifest+json", ico: "image/x-icon",
};
// the page's own files are allowed by origin as well as 'self': a sandboxed document has an opaque origin
const csp = (self: string) => [
  "sandbox allow-scripts allow-forms",
  "default-src 'none'",
  `script-src 'self' ${self} 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://unpkg.com`,
  `style-src 'self' ${self} 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com`,
  `font-src 'self' ${self} data: https://cdn.jsdelivr.net https://fonts.gstatic.com`,
  `img-src 'self' ${self} data: blob:`,
  "media-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");
function originOf(req: Request) {
  const u = new URL(req.url), h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host") || u.host;
  const proto = (h.get("x-forwarded-proto") || u.protocol.replace(":", "")).split(",")[0].trim();
  return /^[\w.:-]+$/.test(host) && /^https?$/.test(proto) ? proto + "://" + host : "";
}
const notFound = () => new Response("پیدا نشد", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(req: Request, { params }: RouteContext<"/api/build/preview/[token]/[[...path]]">) {
  const { token: raw, path = [] } = await params;
  const m = /^([A-Za-z0-9_-]{24,64})(?:\.v(\d{1,6}))?$/.exec(raw);
  if (!m) return notFound();
  const d = await db();
  const [p] = await d.select({ id: builderProjects.id, version: builderProjects.version, stack: builderProjects.stack }).from(builderProjects).where(eq(builderProjects.previewToken, m[1]));
  if (!p) return notFound();
  const version = m[2] ? Number(m[2]) : p.version;
  if (version > p.version) return notFound();
  const files = await filesAt(d, p.id, version);
  let rel = path.join("/");
  if (rel.split("/").some((s) => s === ".." || s === ".")) return notFound();
  if (!rel || rel.endsWith("/")) rel += "index.html";
  const base = p.stack === "node" ? "public/" + rel : rel;
  const key = files[base] !== undefined ? base : files[base + ".html"] !== undefined ? base + ".html" : files[base + "/index.html"] !== undefined ? base + "/index.html" : null;
  if (!key) return notFound();
  const ext = key.split(".").pop()!.toLowerCase();
  const body = ext === "html" || ext === "htm" ? localizeAssets(files[key]) : files[key];
  return new Response(body, {
    headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "content-security-policy": csp(originOf(req)),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
