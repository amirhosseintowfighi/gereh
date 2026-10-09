import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/server/ctx";
import { paasJobs } from "@/server/db/schema";
import { checkSource } from "@/server/paas/service";

/** GET /api/wp/source/<job>?exp=&sig= — the uploaded backup for the in-cluster import job, authorised
    only by a short-lived HMAC signature issued when the import starts. */
export async function GET(req: Request, { params }: RouteContext<"/api/wp/source/[job]">) {
  const { job } = await params;
  const q = new URL(req.url).searchParams;
  if (!checkSource(job, Number(q.get("exp")), q.get("sig") || "")) return new Response("forbidden", { status: 403 });
  const [row] = await (await db()).select({ path: paasJobs.sourcePath }).from(paasJobs).where(eq(paasJobs.id, job));
  if (!row?.path) return new Response("not found", { status: 404 });
  const st = await stat(row.path).catch(() => null);
  if (!st) return new Response("gone", { status: 410 });
  return new Response(Readable.toWeb(createReadStream(row.path)) as ReadableStream, { headers: { "content-type": "application/octet-stream", "content-length": String(st.size), "cache-control": "no-store" } });
}
