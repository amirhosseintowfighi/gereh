import { timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { db } from "@/server/ctx";
import { paasApps, paasDeployments } from "@/server/db/schema";
import { queueDeployment } from "@/server/paas/service";

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** POST /api/paas/hook/<app>?token=… — push webhook from GitHub, GitLab or Gitea (token also accepted
    in X-Gitlab-Token / X-Gereh-Token). Pushes to other branches are acknowledged and ignored. */
export async function POST(req: Request, { params }: RouteContext<"/api/paas/hook/[app]">) {
  const { app: appId } = await params;
  const d = await db();
  const token = new URL(req.url).searchParams.get("token") || req.headers.get("x-gitlab-token") || req.headers.get("x-gereh-token") || "";
  const [app] = await d.select().from(paasApps).where(eq(paasApps.id, appId));
  if (!app || !token || !same(token, app.hookToken)) return NextResponse.json({ error: "invalid token" }, { status: 403 });
  try { await rateLimit(d, "paas-hook:" + app.id, 30, 3600); } catch { return NextResponse.json({ error: "too many deploys" }, { status: 429 }); }
  const event = req.headers.get("x-github-event") || req.headers.get("x-gitlab-event") || req.headers.get("x-gitea-event") || "push";
  if (event === "ping") return NextResponse.json({ ok: true, pong: true });
  const body = (await req.json().catch(() => ({}))) as { ref?: string; after?: string; checkout_sha?: string; head_commit?: { id?: string; message?: string }; commits?: { id?: string; message?: string }[] };
  const branch = (body.ref || "").replace(/^refs\/heads\//, "");
  if (branch && branch !== app.gitBranch) return NextResponse.json({ ok: true, skipped: "branch " + branch });
  if (!app.autoDeploy || app.source !== "git" || ["suspended", "stopped"].includes(app.status)) return NextResponse.json({ ok: true, skipped: "auto deploy is off" });
  const [busy] = await d.select({ id: paasDeployments.id }).from(paasDeployments).where(and(eq(paasDeployments.appId, app.id), inArray(paasDeployments.status, ["queued", "building"])));
  if (busy) return NextResponse.json({ ok: true, skipped: "a deployment is already running" });
  const commit = body.head_commit ?? body.commits?.at(-1);
  const sha = (commit?.id || body.checkout_sha || body.after || "").slice(0, 7);
  const id = await queueDeployment(d, app, { trigger: "git", ref: sha, message: (commit?.message || "push").split("\n")[0].slice(0, 200) });
  return NextResponse.json({ ok: true, deployment: id });
}
