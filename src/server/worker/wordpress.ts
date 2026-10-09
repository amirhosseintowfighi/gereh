/* Managed WordPress background work: importing a cPanel/zip backup into a site. */
import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { paasApps, paasDbs, paasJobs, paasLinks } from "../db/schema";
import { enqueue } from "../jobs";
import { paas } from "../paas/driver";
import { appSpec, dbSpec, redeployConfig, setEnvValue, signSource } from "../paas/service";
import { notify } from "../util";

const pollMs = () => Number(process.env.PAAS_POLL_MS ?? 3000);
const later = (ms: number) => new Date(Date.now() + ms);
const MAX = 200_000;

export async function wpImport(db: DB, p: { jobId: string; keepUrl?: boolean; since: number; started?: boolean }) {
  const [job] = await db.select().from(paasJobs).where(eq(paasJobs.id, p.jobId));
  if (!job || job.status !== "running") return;
  const [app] = await db.select().from(paasApps).where(eq(paasApps.id, job.appId));
  const [link] = app ? await db.select().from(paasLinks).where(eq(paasLinks.appId, app.id)) : [];
  const [row] = link ? await db.select().from(paasDbs).where(eq(paasDbs.id, link.dbId)) : [];
  const finish = async (ok: boolean, output: string) => {
    await db.update(paasJobs).set({ status: ok ? "succeeded" : "failed", output: output.slice(-MAX), finishedAt: new Date() }).where(eq(paasJobs.id, job.id));
    if (app) await notify(db, app.userId, ok ? "circle-check" : "circle-alert", ok ? "انتقال سایت " + app.name + " انجام شد" : "انتقال سایت " + app.name + " ناموفق بود؛ جزئیات در پنل");
  };
  if (!app || !row) return finish(false, "ERROR: the site or its database no longer exists");
  const d = await paas();
  if (!p.started) {
    // the site and its database must be up first (a new site is still deploying)
    if (!app.liveDeployment || row.status !== "running" || !row.host) {
      if (Date.now() - p.since > 30 * 60_000) return finish(false, "ERROR: the site was not ready within 30 minutes");
      await enqueue(db, "wp.import", p, { runAt: later(pollMs() * 3) });
      return;
    }
    const spec = await appSpec(db, app);
    const { exp, sig } = signSource(job.id, 4 * 3600);
    const url = (process.env.PAAS_SOURCE_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000") + "/api/wp/source/" + job.id + "?exp=" + exp + "&sig=" + sig;
    const newUrl = p.keepUrl ? "" : "https://" + (spec.hosts[1] ?? spec.hosts[0]);
    await d.setState(spec, "stop"); // the disk is single-attach: the site pauses during the import
    try { await d.importSite(spec, await dbSpec(db, row), url, job.id, newUrl); }
    catch (e) { await redeployConfig(db, app, "پایان انتقال سایت"); return finish(false, "ERROR: " + (e as Error).message); }
    await enqueue(db, "wp.import", { ...p, started: true, since: Date.now() }, { runAt: later(pollMs()) });
    return;
  }
  const spec = await appSpec(db, app);
  const j = await d.jobStatus(spec, job.id);
  if (j.state === "running" && Date.now() - p.since < 2 * 3600_000) {
    await db.update(paasJobs).set({ output: j.output.slice(-MAX) }).where(eq(paasJobs.id, job.id));
    await enqueue(db, "wp.import", p, { runAt: later(pollMs()) });
    return;
  }
  const prefix = /^PREFIX=(\w+)$/m.exec(j.output)?.[1];
  if (j.state === "succeeded" && prefix) await setEnvValue(db, app.id, "WORDPRESS_TABLE_PREFIX", prefix, false);
  await redeployConfig(db, app, j.state === "succeeded" ? "سایت منتقل‌شده" : "بازگشت پس از انتقال ناموفق");
  await finish(j.state === "succeeded" && !!prefix, j.output.replace(/^PREFIX=\w+\n?/m, "") + (j.state === "running" ? "\nERROR: timed out after 2 hours" : ""));
}
