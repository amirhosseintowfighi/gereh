import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/server/ctx";
import { paasDbImports } from "@/server/db/schema";
import { checkSource } from "@/server/paas/service";

/** GET /api/dbaas/import/<import>?exp=&sig= — an uploaded dump for the in-cluster import Job.
    Authorised only by a short-lived HMAC signature issued when the import starts. */
export async function GET(req: Request, { params }: RouteContext<"/api/dbaas/import/[id]">) {
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  if (!checkSource(id, Number(q.get("exp")), q.get("sig") || "")) return new Response("forbidden", { status: 403 });
  const [row] = await (await db()).select({ filePath: paasDbImports.filePath, status: paasDbImports.status }).from(paasDbImports).where(eq(paasDbImports.id, id));
  if (!row || row.status !== "running") return new Response("not found", { status: 404 });
  const size = await stat(row.filePath).then((s) => s.size).catch(() => -1);
  if (size < 0) return new Response("gone", { status: 410 });
  return new Response(Readable.toWeb(createReadStream(row.filePath)) as ReadableStream, { headers: { "content-type": "application/octet-stream", "content-length": String(size), "cache-control": "no-store" } });
}
