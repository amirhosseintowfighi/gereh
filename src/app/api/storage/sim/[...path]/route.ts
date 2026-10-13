import { SimulatorDriver, storage } from "@/server/storage/driver";

/* The simulator's stand-in for S3 presigned URLs and public objects: GET/HEAD /api/storage/sim/<bucket>/<key>
   (signed, or unsigned on a public bucket) and PUT with a signed URL. 404 unless the simulator is in use. */
const MAX_PUT = 50 * 1024 * 1024;
const H = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

async function sim() {
  const d = await storage();
  return d instanceof SimulatorDriver ? d : null;
}
async function target(req: Request, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const [bucket, ...rest] = path;
  const u = new URL(req.url);
  return { bucket, key: rest.join("/"), m: u.searchParams.get("m") ?? "", exp: Number(u.searchParams.get("exp") ?? 0), sig: u.searchParams.get("sig") ?? "", dl: u.searchParams.get("dl") ?? "" };
}
const deny = (status: number, code: string) => new Response(code, { status, headers: H });

async function get(req: Request, ctx: RouteContext<"/api/storage/sim/[...path]">, head: boolean) {
  const d = await sim();
  if (!d) return deny(404, "NotFound");
  const t = await target(req, ctx.params);
  const signed = t.sig ? t.m === "GET" && d.checkSig("GET", t.bucket, t.key, t.exp, t.sig, t.dl) : false;
  if (!signed && (t.sig || !d.isPublic(t.bucket))) return deny(403, "AccessDenied");
  const o = d.read(t.bucket, t.key);
  if (!o) return deny(404, "NoSuchKey");
  const headers: Record<string, string> = { ...H, "content-type": /^(text\/html|image\/svg|application\/xhtml|text\/xml|application\/xml)/.test(o.type) ? "application/octet-stream" : o.type, "content-length": String(o.body.length), etag: "\"" + o.etag + "\"", "last-modified": o.modified.toUTCString() };
  if (t.dl) headers["content-disposition"] = "attachment; filename*=UTF-8''" + encodeURIComponent(t.dl);
  return new Response(head ? null : new Uint8Array(o.body), { headers });
}

export const GET = (req: Request, ctx: RouteContext<"/api/storage/sim/[...path]">) => get(req, ctx, false);
export const HEAD = (req: Request, ctx: RouteContext<"/api/storage/sim/[...path]">) => get(req, ctx, true);

export async function PUT(req: Request, ctx: RouteContext<"/api/storage/sim/[...path]">) {
  const d = await sim();
  if (!d) return deny(404, "NotFound");
  const t = await target(req, ctx.params);
  if (t.m !== "PUT" || !d.checkSig("PUT", t.bucket, t.key, t.exp, t.sig, "")) return deny(403, "AccessDenied");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PUT) return deny(413, "EntityTooLarge");
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > MAX_PUT) return deny(413, "EntityTooLarge");
  try { d.write(t.bucket, t.key, body, req.headers.get("content-type") || "application/octet-stream"); }
  catch (e) { const m = (e as Error).message; return deny(/Quota/.test(m) ? 403 : /NoSuchBucket/.test(m) ? 404 : 403, m.split(":")[0]); }
  return new Response(null, { status: 200, headers: H });
}
