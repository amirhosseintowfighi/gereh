/* Public REST API (/api/v1) for customers' scripts and Terraform. Bearer tokens from Panel › SSH و API;
   "read" tokens may only GET. Every write goes through the same RPC methods (validation, ownership,
   audit) as the panel. */
import "server-only";
import { and, desc, eq, gt, gte, isNull, or } from "drizzle-orm";
import type { Auth } from "./auth";
import { rateLimit } from "./auth";
import type { Ctx } from "./ctx";
import { hitOut, kbQuery } from "./ai/kb";
import { panelCaller } from "./ai/service";
import { aiKbs, apiTokens, dnsRecords, domains, invoiceItems, invoices, mailDomains, paasApps, paasDbBackups, paasDbs, paasDeployments, paasDomains, paasJobs, servers, storageBuckets, storagePlans, users } from "./db/schema";
import { appHourly, appSpec, appsDomain, defaultHost, loadPlans, previewHost } from "./paas/service";
import { paasTools } from "./paas/tools";
import { registry } from "./rpc";
import { storageEndpoint, storageRegion } from "./storage/driver";
import { AppError, sha256 } from "./util";
import { invGross } from "@/lib/money";

export async function tokenAuth(ctx: Omit<Ctx, "auth">, header: string | null): Promise<{ auth: Auth; scope: string }> {
  const token = /^Bearer\s+(grh_[A-Za-z0-9]{40})$/.exec(header || "")?.[1];
  if (!token) throw new AppError("Missing or malformed bearer token", 401);
  const [row] = await ctx.db.select({ t: apiTokens, u: users }).from(apiTokens).innerJoin(users, eq(users.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, sha256(token)), or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date()))));
  if (!row || row.u.status === "suspended") throw new AppError("Invalid or expired token", 401);
  await rateLimit(ctx.db, "api:" + row.t.id, 120, 60);
  if (!row.t.lastUsedAt || Date.now() - row.t.lastUsedAt.getTime() > 60_000) await ctx.db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.t.id));
  return { auth: { sessionId: "token:" + row.t.id, user: row.u, uid: row.u.id }, scope: row.t.scope };
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const serverOut = (s: typeof servers.$inferSelect) => ({
  id: s.id, name: s.name, status: s.status, plan: s.plan, cpu: s.cpu, ram_gb: s.ram, disk_gb: s.disk, location: s.loc, os: s.os,
  ipv4: s.ip || null, ipv6: s.ipv6 || null, hostname: s.hostname, billing: s.billing, monthly_price_toman: s.price, paid_until: iso(s.paidUntil), created_at: iso(s.createdAt),
});
const recordOut = (r: typeof dnsRecords.$inferSelect) => ({ id: r.id, type: r.type, name: r.name, value: r.value, ttl: r.ttl, priority: r.priority });

async function rpc(ctx: Ctx, name: string, ...args: unknown[]) {
  const m = registry[name];
  return m.run(ctx, m.args.parse(args));
}
const notFound = () => { throw new AppError("Not found", 404); };

/* apps are addressed by id (app-…) or by name, so the CLI can use the name from gereh.json */
async function ownAppBy(ctx: Ctx, key: string) {
  const [app] = await ctx.db.select().from(paasApps).where(and(eq(paasApps.userId, ctx.auth!.uid), key.startsWith("app-") ? eq(paasApps.id, key) : eq(paasApps.name, key)));
  return app ?? notFound();
}
async function appOut(ctx: Ctx, app: typeof paasApps.$inferSelect) {
  const [plans, deps, hosts, domain] = await Promise.all([
    loadPlans(ctx.db), ctx.db.select().from(paasDeployments).where(eq(paasDeployments.appId, app.id)), ctx.db.select().from(paasDomains).where(eq(paasDomains.appId, app.id)), appsDomain(ctx.db),
  ]);
  const plan = plans.find((p) => p.id === app.planId);
  const last = deps.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
  return {
    id: app.id, name: app.name, status: app.status, stack: app.stack, source: app.source, url: "https://" + defaultHost(app.name, domain),
    domains: hosts.map((d) => ({ host: d.host, status: d.status })), plan: app.planId, instances: app.instances, autoscale: app.autoscale, max_instances: app.maxInstances,
    disk_gb: app.diskGb, hourly_price_toman: plan ? appHourly(app, plan) : null, live_deployment: app.liveDeployment,
    preview_url: app.previewDeployment ? "https://" + previewHost(app.name, domain) : null, preview_deployment: app.previewDeployment,
    latest_deployment: last ? { id: last.id, status: last.status, trigger: last.trigger, created_at: iso(last.createdAt) } : null, created_at: iso(app.createdAt),
  };
}

const bucketOut = (b: typeof storageBuckets.$inferSelect, plan?: typeof storagePlans.$inferSelect) => ({
  id: b.id, name: b.name, status: b.status, access: b.access, plan: b.planId, size_gb: plan?.sizeGb ?? null, used_bytes: b.usedBytes, objects: b.objects,
  versioning: b.versioning, endpoint: storageEndpoint(), region: storageRegion(), created_at: iso(b.createdAt),
});
async function bucketsOut(ctx: Ctx, id?: string) {
  const own = eq(storageBuckets.userId, ctx.auth!.uid);
  const [rows, plans] = await Promise.all([ctx.db.select().from(storageBuckets).where(id ? and(own, eq(storageBuckets.id, id)) : own), ctx.db.select().from(storagePlans)]);
  return rows.map((b) => bucketOut(b, plans.find((p) => p.id === b.planId)));
}

/* databases, buckets and mail domains are addressed by id or by name too */
async function ownDbBy(ctx: Ctx, key: string) {
  const [d] = await ctx.db.select().from(paasDbs).where(and(eq(paasDbs.userId, ctx.auth!.uid), or(eq(paasDbs.id, key), eq(paasDbs.name, key))));
  return d ?? notFound();
}
async function ownBucketBy(ctx: Ctx, key: string) {
  const [b] = await ctx.db.select().from(storageBuckets).where(and(eq(storageBuckets.userId, ctx.auth!.uid), or(eq(storageBuckets.id, key), eq(storageBuckets.name, key))));
  return b ?? notFound();
}
async function ownMailDomainBy(ctx: Ctx, key: string) {
  const [d] = await ctx.db.select().from(mailDomains).where(and(eq(mailDomains.userId, ctx.auth!.uid), or(eq(mailDomains.id, key), eq(mailDomains.domain, key.toLowerCase()))));
  return d ?? notFound();
}
const backupOut = (b: typeof paasDbBackups.$inferSelect) => ({ id: b.id, kind: b.kind, status: b.status, size_mb: b.sizeMb, verified: b.verified, created_at: iso(b.createdAt) });

/** body: the JSON body of writes; for GET and DELETE, the query string */
type Route = { method: string; pattern: RegExp; write?: boolean; run: (ctx: Ctx, m: RegExpExecArray, body: Record<string, unknown>) => Promise<unknown> };
export const ROUTES: Route[] = [
  { method: "GET", pattern: /^account$/, run: async (ctx) => {
    const u = ctx.auth!.user;
    return { id: u.id, name: u.name, email: u.email, balance_toman: u.balance };
  } },
  { method: "GET", pattern: /^servers$/, run: async (ctx) => ({ data: (await ctx.db.select().from(servers).where(eq(servers.userId, ctx.auth!.uid))).map(serverOut) }) },
  { method: "GET", pattern: /^servers\/([\w-]+)$/, run: async (ctx, m) => {
    const [s] = await ctx.db.select().from(servers).where(and(eq(servers.id, m[1]), eq(servers.userId, ctx.auth!.uid)));
    return s ? serverOut(s) : notFound();
  } },
  { method: "POST", pattern: /^servers\/([\w-]+)\/actions$/, write: true, run: async (ctx, m, b) => {
    const action = String(b.action || "");
    if (!["start", "stop", "reboot"].includes(action)) throw new AppError("action must be start, stop or reboot", 422);
    await rpc(ctx, "servers.power", m[1], action);
    return { ok: true };
  } },
  { method: "GET", pattern: /^domains$/, run: async (ctx) => ({ data: (await ctx.db.select().from(domains).where(eq(domains.userId, ctx.auth!.uid))).map((d) => ({ id: d.id, name: d.name, status: d.status, nameservers: d.ns, auto_renew: d.autoRenew, expires_at: iso(d.expiresAt) })) }) },
  { method: "GET", pattern: /^domains\/([\w-]+)\/records$/, run: async (ctx, m) => {
    const [d] = await ctx.db.select().from(domains).where(and(eq(domains.id, m[1]), eq(domains.userId, ctx.auth!.uid)));
    if (!d) notFound();
    return { data: (await ctx.db.select().from(dnsRecords).where(eq(dnsRecords.domainId, d!.id))).map(recordOut) };
  } },
  { method: "POST", pattern: /^domains\/([\w-]+)\/records$/, write: true, run: async (ctx, m, b) => {
    await rpc(ctx, "domains.addRecord", m[1], { type: b.type, name: b.name, value: b.value, ttl: b.ttl ?? 3600, ...(b.priority !== undefined && b.priority !== null ? { priority: b.priority } : {}) });
    const all = await ctx.db.select().from(dnsRecords).where(eq(dnsRecords.domainId, m[1]));
    return recordOut(all.sort((x, y) => y.position - x.position)[0]);
  } },
  { method: "PUT", pattern: /^domains\/([\w-]+)\/records\/([\w-]+)$/, write: true, run: async (ctx, m, b) => {
    await rpc(ctx, "domains.updateRecord", m[1], { id: m[2], type: b.type, name: b.name, value: b.value, ttl: b.ttl ?? 3600, ...(b.priority !== undefined && b.priority !== null ? { priority: b.priority } : {}) });
    const [r] = await ctx.db.select().from(dnsRecords).where(eq(dnsRecords.id, m[2]));
    return recordOut(r);
  } },
  { method: "DELETE", pattern: /^domains\/([\w-]+)\/records\/([\w-]+)$/, write: true, run: async (ctx, m) => {
    await rpc(ctx, "domains.removeRecord", m[1], m[2]);
    return { ok: true };
  } },
  { method: "GET", pattern: /^apps$/, run: async (ctx) => ({ data: await Promise.all((await ctx.db.select().from(paasApps).where(eq(paasApps.userId, ctx.auth!.uid))).map((a) => appOut(ctx, a))) }) },
  { method: "GET", pattern: /^apps\/([\w-]+)$/, run: async (ctx, m) => appOut(ctx, await ownAppBy(ctx, m[1])) },
  { method: "POST", pattern: /^apps\/([\w-]+)\/deployments$/, write: true, run: async (ctx, m, b) => {
    const app = await ownAppBy(ctx, m[1]);
    const via = b.via === "cli" ? "cli" : "api";
    const id = b.preview
      ? await rpc(ctx, "paas.deployPreview", app.id, { uploadId: b.upload_id ?? undefined, branch: b.branch ?? undefined, message: b.message ?? undefined, via })
      : await rpc(ctx, "paas.deploy", app.id, { uploadId: b.upload_id ?? undefined, message: b.message ?? undefined, via, ...(b.no_cache ? { noCache: true } : {}) });
    return { id, status: "queued", target: b.preview ? "preview" : "production" };
  } },
  { method: "POST", pattern: /^apps\/([\w-]+)\/deployments\/([\w-]+)\/promote$/, write: true, run: async (ctx, m) => {
    const app = await ownAppBy(ctx, m[1]);
    return { id: await rpc(ctx, "paas.promote", app.id, m[2]), status: "queued" };
  } },
  { method: "GET", pattern: /^apps\/([\w-]+)\/deployments\/([\w-]+)$/, run: async (ctx, m) => {
    const app = await ownAppBy(ctx, m[1]);
    const [d] = await ctx.db.select().from(paasDeployments).where(and(eq(paasDeployments.id, m[2]), eq(paasDeployments.appId, app.id)));
    if (!d) notFound();
    return { id: d!.id, status: d!.status, target: d!.target, branch: d!.branch || null, trigger: d!.trigger, ref: d!.ref || null, message: d!.message, log: d!.log, created_at: iso(d!.createdAt), finished_at: iso(d!.finishedAt) };
  } },
  { method: "GET", pattern: /^apps\/([\w-]+)\/logs$/, run: async (ctx, m) => {
    const app = await ownAppBy(ctx, m[1]);
    return { lines: await rpc(ctx, "paas.logs", app.id, 300) };
  } },
  { method: "PUT", pattern: /^apps\/([\w-]+)\/env$/, write: true, run: async (ctx, m, b) => {
    const app = await ownAppBy(ctx, m[1]);
    const vars = (b.vars && typeof b.vars === "object" ? b.vars : {}) as Record<string, unknown>;
    const secret = new Set(Array.isArray(b.secret) ? b.secret.map(String) : []);
    const set = Object.entries(vars).filter(([, v]) => v !== null).map(([key, value]) => ({ key, value: String(value), secret: secret.has(key) }));
    const remove = Object.entries(vars).filter(([, v]) => v === null).map(([k]) => k);
    await rpc(ctx, "paas.setEnv", app.id, set, remove);
    return { ok: true, set: set.map((v) => v.key), removed: remove };
  } },
  { method: "POST", pattern: /^apps\/([\w-]+)\/actions$/, write: true, run: async (ctx, m, b) => {
    const action = String(b.action || "");
    if (!["start", "stop", "restart"].includes(action)) throw new AppError("action must be start, stop or restart", 422);
    await rpc(ctx, "paas.power", (await ownAppBy(ctx, m[1])).id, action);
    return { ok: true };
  } },
  { method: "POST", pattern: /^apps\/([\w-]+)\/jobs$/, write: true, run: async (ctx, m, b) => {
    const app = await ownAppBy(ctx, m[1]);
    const id = await rpc(ctx, "paas.runJob", app.id, String(b.command ?? ""));
    return { id, status: "running" };
  } },
  { method: "GET", pattern: /^apps\/([\w-]+)\/jobs\/([\w-]+)$/, run: async (ctx, m) => {
    const app = await ownAppBy(ctx, m[1]);
    const [j] = await ctx.db.select().from(paasJobs).where(and(eq(paasJobs.id, m[2]), eq(paasJobs.appId, app.id)));
    if (!j) notFound();
    return { id: j!.id, kind: j!.kind, command: j!.command, status: j!.status, output: j!.output, created_at: iso(j!.createdAt), finished_at: iso(j!.finishedAt) };
  } },
  { method: "GET", pattern: /^databases$/, run: async (ctx) => ({ data: (await ctx.db.select().from(paasDbs).where(eq(paasDbs.userId, ctx.auth!.uid))).map((d) => ({
    id: d.id, name: d.name, engine: d.engine, version: d.version, status: d.status, plan: d.planId, host: d.host || null, port: d.port, database: d.dbName, username: d.username,
    public_access: d.publicAccess, backups: d.backups, created_at: iso(d.createdAt),
  })) }) },
  { method: "GET", pattern: /^storage\/buckets$/, run: async (ctx) => ({ data: await bucketsOut(ctx) }) },
  { method: "POST", pattern: /^storage\/buckets$/, write: true, run: async (ctx, _m, b) => {
    const id = await rpc(ctx, "storage.create", { name: String(b.name ?? ""), planId: String(b.plan ?? "st-20"), access: b.access === "public" ? "public" : "private" });
    return (await bucketsOut(ctx, String(id)))[0];
  } },
  /* ---------- CLI: env files, shell commands, image/Git source, database backups, bucket objects, mail ---------- */
  // secrets leave the platform here, so a read-write token is required
  { method: "GET", pattern: /^apps\/([\w-]+)\/env$/, write: true, run: async (ctx, m) => ({ dotenv: await rpc(ctx, "paas.envFile", (await ownAppBy(ctx, m[1])).id) }) },
  { method: "POST", pattern: /^apps\/([\w-]+)\/exec$/, write: true, run: async (ctx, m, b) => {
    const r = await rpc(ctx, "paas.consoleRun", (await ownAppBy(ctx, m[1])).id, String(b.command ?? ""), ...(b.instance ? [String(b.instance)] : [])) as { instance: string; code: number; output: string };
    return { instance: r.instance, exit_code: r.code, output: r.output };
  } },
  { method: "PUT", pattern: /^apps\/([\w-]+)\/source$/, write: true, run: async (ctx, m, b) => {
    const app = await ownAppBy(ctx, m[1]);
    const patch: Record<string, string> = {};
    if (b.image !== undefined) { if (app.source !== "image") throw new AppError("This app is not built from an image", 422); patch.image = String(b.image); }
    if (b.git_url !== undefined || b.git_branch !== undefined) {
      if (app.source !== "git") throw new AppError("This app is not built from Git", 422);
      if (b.git_url !== undefined) patch.gitUrl = String(b.git_url);
      if (b.git_branch !== undefined) patch.gitBranch = String(b.git_branch);
    }
    if (!Object.keys(patch).length) throw new AppError("Pass image, git_url or git_branch", 422);
    const since = new Date();
    await rpc(ctx, "paas.updateApp", app.id, patch);
    // a new image starts its own deployment
    const [dep] = await ctx.db.select({ id: paasDeployments.id }).from(paasDeployments).where(and(eq(paasDeployments.appId, app.id), gte(paasDeployments.createdAt, since))).orderBy(desc(paasDeployments.createdAt)).limit(1);
    return { ok: true, deployment: dep?.id ?? null };
  } },
  { method: "GET", pattern: /^apps\/([\w-]+)\/logs\/since$/, run: async (ctx, m, q) => {
    const app = await ownAppBy(ctx, m[1]);
    const since = q.since ? new Date(String(q.since)) : new Date(Date.now() - 60_000);
    if (Number.isNaN(since.getTime())) throw new AppError("since must be an ISO date", 422);
    if (!app.liveDeployment || app.status !== "running") return { lines: [], next: since.toISOString() };
    const lines = await paasTools().logsSince(await appSpec(ctx.db, app), since, 1000);
    return { lines: lines.map((l) => ({ at: l.at.toISOString(), instance: l.instance, line: l.line })), next: (lines.at(-1)?.at ?? since).toISOString() };
  } },
  { method: "POST", pattern: /^databases\/([\w-]+)\/backups$/, write: true, run: async (ctx, m) => ({ id: await rpc(ctx, "paas.backupDb", (await ownDbBy(ctx, m[1])).id), status: "running" }) },
  { method: "GET", pattern: /^databases\/([\w-]+)\/backups$/, run: async (ctx, m) => {
    const d = await ownDbBy(ctx, m[1]);
    const rows = await ctx.db.select().from(paasDbBackups).where(eq(paasDbBackups.dbId, d.id)).orderBy(desc(paasDbBackups.createdAt));
    return { data: rows.map(backupOut) };
  } },
  { method: "GET", pattern: /^databases\/([\w-]+)\/backups\/([\w-]+)$/, run: async (ctx, m) => {
    const d = await ownDbBy(ctx, m[1]);
    const [r] = await ctx.db.select().from(paasDbBackups).where(and(eq(paasDbBackups.id, m[2]), eq(paasDbBackups.dbId, d.id)));
    return r ? backupOut(r) : notFound();
  } },
  { method: "POST", pattern: /^databases\/([\w-]+)\/backups\/([\w-]+)\/download$/, write: true, run: async (ctx, m) => {
    const d = await ownDbBy(ctx, m[1]);
    const [r] = await ctx.db.select({ id: paasDbBackups.id }).from(paasDbBackups).where(and(eq(paasDbBackups.id, m[2]), eq(paasDbBackups.dbId, d.id)));
    if (!r) notFound();
    return { url: await rpc(ctx, "dbaas.backupLink", m[2]) };
  } },
  { method: "GET", pattern: /^storage\/buckets\/([\w.-]+)\/objects$/, run: async (ctx, m, q) => {
    const r = await rpc(ctx, "storage.objects", (await ownBucketBy(ctx, m[1])).id, String(q.prefix ?? ""), q.cursor ? String(q.cursor) : null) as { folders: { prefix: string }[]; objects: { key: string; size: number; modified: string }[]; next: string | null };
    return { folders: r.folders.map((f) => f.prefix), objects: r.objects.map((o) => ({ key: o.key, size: o.size, modified: o.modified })), next: r.next };
  } },
  { method: "POST", pattern: /^storage\/buckets\/([\w.-]+)\/upload-url$/, write: true, run: async (ctx, m, b) => {
    const r = await rpc(ctx, "storage.uploadUrl", (await ownBucketBy(ctx, m[1])).id, String(b.key ?? ""), Number(b.size ?? 0), String(b.content_type ?? "application/octet-stream")) as { url: string };
    return { url: r.url, method: "PUT" };
  } },
  { method: "POST", pattern: /^storage\/buckets\/([\w.-]+)\/download-url$/, write: true, run: async (ctx, m, b) => ({ url: await rpc(ctx, "storage.downloadUrl", (await ownBucketBy(ctx, m[1])).id, String(b.key ?? "")) }) },
  { method: "DELETE", pattern: /^storage\/buckets\/([\w.-]+)\/objects$/, write: true, run: async (ctx, m, q) => {
    const keys = String(q.key ?? "").split(",").filter(Boolean);
    if (!keys.length) throw new AppError("Pass ?key=a,b", 422);
    await rpc(ctx, "storage.deleteObjects", (await ownBucketBy(ctx, m[1])).id, keys);
    return { ok: true, deleted: keys };
  } },
  { method: "GET", pattern: /^mail\/domains$/, run: async (ctx) => ({ data: (await ctx.db.select().from(mailDomains).where(eq(mailDomains.userId, ctx.auth!.uid))).map((d) => ({ id: d.id, domain: d.domain, status: d.status, mode: d.mode, plan: d.planId, created_at: iso(d.createdAt) })) }) },
  { method: "POST", pattern: /^mail\/domains\/([\w.-]+)\/send$/, write: true, run: async (ctx, m, b) => {
    const d = await ownMailDomainBy(ctx, m[1]);
    const input = { from: b.from, to: b.to, cc: b.cc, bcc: b.bcc, replyTo: b.reply_to, subject: b.subject ?? "", text: b.text, html: b.html, tag: b.tag };
    return rpc(ctx, "mail.send", d.id, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== null)));
  } },
  { method: "GET", pattern: /^invoices$/, run: async (ctx) => {
    const list = await ctx.db.select().from(invoices).where(eq(invoices.userId, ctx.auth!.uid));
    const items = list.length ? await ctx.db.select().from(invoiceItems) : [];
    return { data: list.map((i) => { const it = items.filter((x) => x.invoiceId === i.id); return { id: i.id, status: i.status, total_toman: invGross({ items: it, tax: i.taxRate }), created_at: iso(i.createdAt), due_at: iso(i.dueAt), paid_at: iso(i.paidAt) }; }) };
  } },
  { method: "GET", pattern: /^ai\/kb$/, run: async (ctx) => ({ data: (await ctx.db.select().from(aiKbs).where(eq(aiKbs.userId, ctx.auth!.uid))).map((k) => ({ id: k.id, name: k.name, embedding_model: k.model, created_at: iso(k.createdAt) })) }) },
  // spends wallet credit (the question is embedded), so it needs a read-write token
  { method: "POST", pattern: /^ai\/kb\/([\w-]+)\/query$/, write: true, run: async (ctx, m, b) => {
    const r = await kbQuery(ctx.db, await panelCaller(ctx.db, ctx.auth!.uid), m[1], String(b.query ?? ""), Number(b.top_k) || 5);
    if ("http" in r) throw new AppError(r.message, r.http);
    return { data: r.hits.map(hitOut), charged_toman: r.charged };
  } },
];
