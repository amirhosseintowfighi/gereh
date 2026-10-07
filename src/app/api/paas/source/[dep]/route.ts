import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/server/ctx";
import { paasDeployments } from "@/server/db/schema";
import { checkSource } from "@/server/paas/service";

/** GET /api/paas/source/<deployment>?exp=&sig= — the uploaded ZIP for the in-cluster builder.
    Authorised only by a short-lived HMAC signature issued when the build starts. */
export async function GET(req: Request, { params }: RouteContext<"/api/paas/source/[dep]">) {
  const { dep } = await params;
  const q = new URL(req.url).searchParams;
  if (!checkSource(dep, Number(q.get("exp")), q.get("sig") || "")) return new Response("forbidden", { status: 403 });
  const [row] = await (await db()).select({ uploadPath: paasDeployments.uploadPath }).from(paasDeployments).where(eq(paasDeployments.id, dep));
  if (!row?.uploadPath) return new Response("not found", { status: 404 });
  const buf = await readFile(row.uploadPath).catch(() => null);
  if (!buf) return new Response("gone", { status: 410 });
  return new Response(new Uint8Array(buf), { headers: { "content-type": "application/zip", "cache-control": "no-store" } });
}
