/* Gereh Apps outbound proxy: an app's own HTTP(S)/SOCKS5 proxy or the platform's shared one, and the staff
   setting for the latter. The URL can hold a password: it is never returned (only masked) nor logged. */
import "server-only";
import { z } from "zod";
import { INTERNAL_NO_PROXY, maskProxy, noProxyError, proxyError } from "@/lib/paas-egress";
import { actor, method, needStaff, needUser } from "../ctx";
import { loadEgress, platformEgress, saveEgress, savePlatformEgress } from "../paas/egress";
import { redeployConfig } from "../paas/service";
import { open } from "../secrets";
import { fail, logActivity, logAudit } from "../util";
import { ownApp } from "./paas";

const id = z.string().max(40);
const noProxy = z.array(z.string().trim().max(253)).max(60);

export const paasEgressRpc = {
  /** the app's proxy setting (URL masked) and whether the platform proxy is available */
  "paas.egress": method(z.tuple([id]), async (ctx, [appId]) => {
    const { app } = await ownApp(ctx, appId);
    const [row, platform] = await Promise.all([loadEgress(ctx.db, app.id), platformEgress(ctx.db)]);
    const url = row?.proxyEnc ? open(row.proxyEnc) ?? "" : "";
    return { mode: row?.mode ?? "off", url: url ? maskProxy(url) : "", noProxy: row?.noProxy ?? [], extraKeys: row?.extraKeys ?? [], platform: !!platform.url, defaults: INTERNAL_NO_PROXY };
  }),

  /** url: a new proxy URL, or null to keep the stored one; applies with a config redeploy */
  "paas.setEgress": method(z.tuple([id, z.object({ mode: z.enum(["off", "custom", "platform"]), url: z.string().trim().max(500).nullable().default(null), noProxy: noProxy.default([]) })]), async (ctx, [appId, o]) => {
    const { a, app } = await ownApp(ctx, appId);
    const cur = await loadEgress(ctx.db, app.id);
    if (o.url) { const e = proxyError(o.url); if (e) fail(e); }
    const list = [...new Set(o.noProxy.map((s) => s.toLowerCase()).filter(Boolean))];
    const e = noProxyError(list);
    if (e) fail(e);
    if (o.mode === "custom" && !o.url && !cur?.proxyEnc) fail("نشانی پروکسی را وارد کنید.");
    if (o.mode === "platform" && !(await platformEgress(ctx.db)).url) fail("پروکسی گره هنوز راه‌اندازی نشده است؛ پروکسی خودتان را وارد کنید.");
    await saveEgress(ctx.db, app.id, { mode: o.mode, url: o.url, noProxy: list });
    await logActivity(ctx.db, a.uid, "network", (o.mode === "off" ? "خاموش کردن پروکسی خروجی " : o.mode === "platform" ? "پروکسی گره برای " : "پروکسی خروجی اختصاصی برای ") + app.name, ctx.ip);
    return redeployConfig(ctx.db, app, "تغییر پروکسی خروجی");
  }),

  /** whether one-click apps can offer the platform proxy */
  "paas.platformProxy": method(z.tuple([]), async (ctx) => {
    needUser(ctx);
    return { available: !!(await platformEgress(ctx.db)).url };
  }),

  /* ---------------- staff ---------------- */
  "paas.adminEgress": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "infra");
    const p = await platformEgress(ctx.db);
    return { url: p.url ? maskProxy(p.url) : "", source: p.source, noProxy: p.noProxy };
  }),
  /** url: a new URL, "" to remove it, null to keep it (only the NO_PROXY list changes) */
  "paas.adminSetEgress": method(z.tuple([z.object({ url: z.string().trim().max(500).nullable(), noProxy })]), async (ctx, [o]) => {
    needStaff(ctx, "infra");
    if (o.url) { const e = proxyError(o.url); if (e) fail(e); }
    const list = [...new Set(o.noProxy.map((s) => s.toLowerCase()).filter(Boolean))];
    const e = noProxyError(list);
    if (e) fail(e);
    await savePlatformEgress(ctx.db, o.url, list);
    await logAudit(ctx.db, actor(ctx), o.url === "" ? "حذف پروکسی خروجی گره اپ" : "تنظیم پروکسی خروجی گره اپ", "paas_egress", ctx.ip);
  }),
};
