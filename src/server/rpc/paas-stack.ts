/* «قالب ترکیبی»: creates the apps and databases of a multi-service template (src/lib/paas-stack.ts)
   through the same RPC methods as the panel, after checking every name, plan and the total cost. */
import "server-only";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { appMonthly, PAAS_NAME_RE } from "@/lib/paas";
import { fillStackValue, parseStack, stackAppName, StackError } from "@/lib/paas-stack";
import { dbMap, type DbField } from "@/lib/paas-templates";
import { method, needUser, type Ctx } from "../ctx";
import { paasApps, paasDbs, paasLinks } from "../db/schema";
import { appsDomain } from "../paas/service";
import { fail, logActivity } from "../util";
import { checkName, needCredit, paasRpc, plan } from "./paas";

const run = (ctx: Ctx, m: string, args: unknown[]) => (paasRpc as unknown as Record<string, { run: (c: Ctx, a: unknown) => Promise<unknown> }>)[m].run(ctx, args) as Promise<string>;

export const paasStackRpc = {
  "paas.createStack": method(z.tuple([z.string().max(64_000), z.string().trim().toLowerCase().max(30)]), async (ctx, [yaml, base]) => {
    const a = needUser(ctx);
    let t;
    try { t = parseStack(yaml); } catch (e) { if (e instanceof StackError) fail(e.message); throw e; }
    const names = t!.apps.map((x) => stackAppName(base, x));
    for (const n of names) {
      if (!PAAS_NAME_RE.test(n)) fail("نام «" + n + "» معتبر نیست؛ نام پایه را کوتاه‌تر کنید (حداکثر ۳۰ نویسه با پسوندها).");
      checkName(n);
    }
    const dbNames = t!.databases.map((d) => (base + "-" + d.id).slice(0, 30));
    const takenApps = await ctx.db.select({ name: paasApps.name }).from(paasApps).where(inArray(paasApps.name, names));
    if (takenApps.length) fail("نام «" + takenApps[0].name + "» قبلاً گرفته شده است؛ نام پایه دیگری انتخاب کنید.");
    const takenDbs = await ctx.db.select({ name: paasDbs.name }).from(paasDbs).where(inArray(paasDbs.name, dbNames));
    if (takenDbs.length) fail("پایگاه داده «" + takenDbs[0].name + "» از قبل وجود دارد؛ نام پایه دیگری انتخاب کنید.");
    let monthly = 0;
    for (const x of t!.apps) monthly += appMonthly(await plan(ctx, x.planId, "app"), x.instances, x.disk?.sizeGb ?? 0);
    for (const d of t!.databases) monthly += (await plan(ctx, d.planId, "db")).price;
    await needCredit(ctx, a.uid, monthly);

    const host = base + "." + (await appsDomain(ctx.db)), shared = new Map<string, string>();
    const dbIds = new Map<string, string>();
    for (const [i, d] of t!.databases.entries()) dbIds.set(d.id, await run(ctx, "paas.createDb", [{ name: dbNames[i], engine: d.engine, version: d.version, planId: d.planId, publicAccess: false, backups: true }]));
    const appIds: string[] = [];
    for (const [i, x] of t!.apps.entries()) {
      const env: { key: string; value: string; secret: boolean }[] = [];
      const links = new Map<string, { key: string; field: DbField }[]>();
      for (const e of x.env) {
        if ("db" in e) links.set(e.db, [...(links.get(e.db) ?? []), { key: e.key, field: e.field }]);
        else env.push({ key: e.key, value: fillStackValue(e.value, { name: base, url: "https://" + host, host, shared }), secret: /\$RANDOM_/.test(e.value) });
      }
      const appId = await run(ctx, "paas.createApp", [{
        name: names[i], stack: x.stack, source: x.git ? "git" : "image", gitUrl: x.git?.url ?? "", gitBranch: x.git?.branch ?? "main", image: x.image ?? "", rootDir: "",
        buildCommand: x.build, startCommand: x.start, port: x.port, planId: x.planId, instances: x.instances, diskGb: x.disk?.sizeGb ?? 0, env, ...(x.version ? { version: x.version } : {}),
      }]);
      if (x.disk || x.health) await ctx.db.update(paasApps).set({ ...(x.disk ? { diskMount: x.disk.mount } : {}), ...(x.health ? { healthPath: x.health } : {}) }).where(eq(paasApps.id, appId));
      for (const [db, fields] of links) {
        const envKey = fields.length === 1 && fields[0].field === "url" ? fields[0].key : dbMap(Object.fromEntries(fields.map((f) => [f.key, f.field])));
        await ctx.db.insert(paasLinks).values({ appId, dbId: dbIds.get(db)!, envKey }).onConflictDoNothing();
      }
      appIds.push(appId);
    }
    await logActivity(ctx.db, a.uid, "layers", "ساخت قالب ترکیبی " + (t!.name || base) + " (" + appIds.length + " اپ، " + dbIds.size + " پایگاه داده)", ctx.ip);
    return { appIds, dbIds: [...dbIds.values()], warnings: [] as string[] };
  }),
};
