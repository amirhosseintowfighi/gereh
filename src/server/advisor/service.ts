/* «مشاور هزینه» for the panel, the assistant, the weekly job and the admin card: findings are recomputed by the engine
   (./engine.ts), kept in advisor_findings with their status, and applied only through the server-side calls the engine
   derived from the account's own rows. «اعمال» re-derives the finding first: if what it would do or cost changed since
   the card was shown, nothing runs. Every call goes through the RPC layer with the caller's own context, so ownership,
   team roles and custom roles apply exactly as if the person had clicked the RPC's own button. */
import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { ADVISOR, RULE_LABEL, type AdvisorAdminStats, type AdvisorBrief, type AdvisorReport, type AdvisorRule, type ApplyResult, type FindingView } from "@/lib/advisor";
import { fa } from "@/lib/format";
import { faDateTime } from "@/lib/jalali";
import { customAllows } from "../account-extras";
import { platformSpend, tehranStarts } from "../ai/service";
import { actor, needStaff, needUser, teamAllows, type Ctx } from "../ctx";
import type { DB } from "../db/client";
import { advisorFindings, advisorState, aiUsage, paasApps, servers, storageBuckets, transactions, users } from "../db/schema";
import { enqueue } from "../jobs";
import { AppError, fail, logActivity, logAudit, notify, rid, sha256 } from "../util";
import { computeFindings, type Action, type Call, type Computed, type Finding } from "./engine";
import { advisorSettings, PURPOSE, summaryFacts, writeSummary } from "./summary";

const DAY = 86400_000;
export const IGNORE_DAYS = 30;
/** a report younger than this is served from the table */
const FRESH_MS = 10 * 60_000;
type Row = typeof advisorFindings.$inferSelect;

/* ---------------- persistence ---------------- */
const stored = (f: Finding) => ({
  rule: f.rule, resourceKind: f.kind, resourceId: f.resourceId, resourceName: f.resourceName, title: f.title, detail: f.detail,
  evidence: { ...f.evidence, href: f.href }, saving: f.saving, extraCost: f.extraCost, oneTime: f.oneTime, confidence: f.confidence, risk: f.risk,
  action: f.action as unknown as Record<string, unknown> | null,
});

/** recomputes one account and stores it: new findings open, ones no longer produced expire, an ignore lasts until its
    date, an applied finding that is produced again a week later opens again */
export async function refresh(db: DB, uid: string, o: { summary?: boolean; now?: Date } = {}): Promise<Computed> {
  const now = o.now ?? new Date();
  const c = await computeFindings(db, uid, now);
  const have = new Map((await db.select().from(advisorFindings).where(eq(advisorFindings.userId, uid))).map((r) => [r.key, r]));
  const seen = new Set<string>();
  for (const f of c.findings) {
    seen.add(f.key);
    const old = have.get(f.key);
    if (!old) { await db.insert(advisorFindings).values({ id: rid("adv"), userId: uid, key: f.key, ...stored(f), status: "open", createdAt: now, updatedAt: now }); continue; }
    let status = old.status;
    let reopen = false;
    if (old.status === "expired" || (old.status === "ignored" && (!old.ignoredUntil || old.ignoredUntil <= now)) || (old.status === "applied" && (old.appliedAt?.getTime() ?? 0) <= now.getTime() - 7 * DAY)) { status = "open"; reopen = true; }
    await db.update(advisorFindings).set({ ...stored(f), status, updatedAt: now, ...(reopen ? { createdAt: now, notifiedAt: null, ignoredUntil: null } : {}) }).where(eq(advisorFindings.id, old.id));
  }
  const gone = [...have.values()].filter((r) => !seen.has(r.key) && r.status === "open").map((r) => r.id);
  if (gone.length) await db.update(advisorFindings).set({ status: "expired", updatedAt: now }).where(inArray(advisorFindings.id, gone));

  const open = c.findings.filter((f) => { const r = have.get(f.key); return !r || r.status === "open" || r.status === "expired" || (r.status === "ignored" && (!r.ignoredUntil || r.ignoredUntil <= now)) || (r.status === "applied" && (r.appliedAt?.getTime() ?? 0) <= now.getTime() - 7 * DAY); });
  const base = { runRate: c.runRate, parts: c.parts, balance: c.balance, burn: c.burn, runwayDays: c.runwayDays, insufficient: c.insufficient, computedAt: now };
  const [st] = await db.select().from(advisorState).where(eq(advisorState.userId, uid));
  let summary = {};
  if (o.summary) {
    // the model is asked again only when what it would be told changed
    const hash = sha256(JSON.stringify(summaryFacts(open)));
    if (!st || st.summaryHash !== hash || !st.summary) {
      const s = await writeSummary(db, uid, open);
      summary = { summary: s.text, summarySimulated: s.simulated, summaryHash: hash, summaryAt: now };
    }
  }
  await db.insert(advisorState).values({ userId: uid, ...base, ...summary }).onConflictDoUpdate({ target: advisorState.userId, set: { ...base, ...summary } });
  return c;
}

/* ---------------- views ---------------- */
const view = (r: Row): FindingView => {
  const { href, ...ev } = r.evidence as { href?: string; lines?: string[] };
  const a = r.action as unknown as Action | null;
  return {
    id: r.id, rule: r.rule as AdvisorRule, title: r.title, detail: r.detail,
    resource: { kind: r.resourceKind, id: r.resourceId, name: r.resourceName, href: href ?? "/panel" },
    saving: r.saving, extraCost: r.extraCost, oneTime: r.oneTime, confidence: r.confidence, risk: r.risk,
    evidence: { lines: ev.lines ?? [], ...((ev as { series?: FindingView["evidence"]["series"] }).series ? { series: (ev as { series: FindingView["evidence"]["series"] }).series } : {}) },
    action: a ? { label: a.label, rpc: a.rpc, preview: a.preview, typed: a.typed, destructive: a.destructive, ...(a.link ? { link: a.link } : {}) } : null,
    status: r.status, at: faDateTime(r.createdAt),
  };
};
const sortRows = (rows: Row[]) => rows.sort((a, b) => (Number(b.risk === "high" && b.saving === 0) - Number(a.risk === "high" && a.saving === 0)) || (b.saving - a.saving) || (b.extraCost - a.extraCost));

async function ensureFresh(db: DB, uid: string, force: boolean) {
  const [st] = await db.select().from(advisorState).where(eq(advisorState.userId, uid));
  if (force || !st?.computedAt || Date.now() - st.computedAt.getTime() > FRESH_MS || !st.summary) await refresh(db, uid, { summary: true });
}

export async function report(ctx: Ctx, force = false): Promise<AdvisorReport> {
  const a = needUser(ctx);
  await ensureFresh(ctx.db, a.uid, force);
  const [st] = await ctx.db.select().from(advisorState).where(eq(advisorState.userId, a.uid));
  const rows = await ctx.db.select().from(advisorFindings).where(eq(advisorFindings.userId, a.uid));
  const open = sortRows(rows.filter((r) => r.status === "open"));
  return {
    runRate: st?.runRate ?? 0, parts: st?.parts ?? [],
    potentialSaving: open.reduce((s, r) => s + r.saving, 0), extraCost: open.reduce((s, r) => s + r.extraCost, 0),
    balance: st?.balance ?? 0, burn: st?.burn ?? 0, runwayDays: st?.runwayDays ?? null,
    summary: { text: st?.summary ?? "", simulated: st?.summarySimulated ?? true, at: st?.summaryAt ? faDateTime(st.summaryAt) : "" },
    findings: open.map(view), insufficient: st?.insufficient ?? [],
    applied: rows.filter((r) => r.status === "applied").length, ignored: rows.filter((r) => r.status === "ignored").length,
    muted: st?.muted ?? false, computedAt: st?.computedAt ? faDateTime(st.computedAt) : "",
  };
}

/** the dashboard widget: from the stored state (computed once when there is none) */
export async function brief(ctx: Ctx): Promise<AdvisorBrief> {
  const a = needUser(ctx);
  const [st] = await ctx.db.select().from(advisorState).where(eq(advisorState.userId, a.uid));
  if (!st) await refresh(ctx.db, a.uid);
  const rows = await ctx.db.select().from(advisorFindings).where(and(eq(advisorFindings.userId, a.uid), eq(advisorFindings.status, "open")));
  const [s2] = st ? [st] : await ctx.db.select().from(advisorState).where(eq(advisorState.userId, a.uid));
  return { potentialSaving: rows.reduce((s, r) => s + r.saving, 0), findings: rows.length, risks: rows.filter((r) => r.risk === "high" && r.saving === 0).length, runwayDays: s2?.runwayDays ?? null };
}

/** the assistant's read tool: the open findings in plain fields */
export async function adviceForAssistant(ctx: Ctx) {
  const r = await report(ctx);
  return {
    monthly_run_rate_toman: r.runRate, potential_monthly_saving_toman: r.potentialSaving, wallet_balance_toman: r.balance, wallet_runway_days: r.runwayDays === null ? null : Math.floor(r.runwayDays),
    summary: r.summary.text,
    findings: r.findings.map((f) => ({
      finding_id: f.id, kind: RULE_LABEL[f.rule], title: f.title, detail: f.detail, resource: f.resource.name, monthly_saving_toman: f.saving, monthly_extra_cost_toman: f.extraCost, one_time_toman: f.oneTime,
      risk: f.risk, confidence: f.confidence, evidence: f.evidence.lines,
      apply: f.action ? (f.action.link ? "link only: " + f.action.link : f.action.typed ? "only on the page /panel/advisor (the resource name must be typed)" : "apply_cost_advice with this finding_id") : "none",
      price_preview: f.action?.preview ?? "",
    })),
    not_enough_data: r.insufficient.map((x) => x.name + ": " + x.reason),
    page: "/panel/advisor",
  };
}

/* ---------------- ignore, mute ---------------- */
async function own(ctx: Ctx, id: string) {
  const a = needUser(ctx);
  const [r] = await ctx.db.select().from(advisorFindings).where(and(eq(advisorFindings.id, id), eq(advisorFindings.userId, a.uid)));
  if (!r) fail("این پیشنهاد پیدا نشد.", 404);
  return { a, r: r! };
}
export async function ignore(ctx: Ctx, id: string) {
  const { a, r } = await own(ctx, id);
  if (r.status !== "open") fail("این پیشنهاد دیگر باز نیست.", 409);
  await ctx.db.update(advisorFindings).set({ status: "ignored", ignoredUntil: new Date(Date.now() + IGNORE_DAYS * DAY), updatedAt: new Date() }).where(eq(advisorFindings.id, r.id));
  await logActivity(ctx.db, a.uid, "eye-off", ADVISOR.name + ": نادیده گرفتن «" + r.title + "» برای " + fa(IGNORE_DAYS) + " روز", ctx.ip);
}
export async function setMute(ctx: Ctx, muted: boolean) {
  const a = needUser(ctx);
  await ctx.db.insert(advisorState).values({ userId: a.uid, muted }).onConflictDoUpdate({ target: advisorState.userId, set: { muted } });
}

/* ---------------- apply ---------------- */
/** stop → change plan → start: servers.changePlan needs a stopped server */
async function downsize(ctx: Ctx, run: (name: string, args: unknown[]) => Promise<unknown>, sid: string, planId: string) {
  const [s] = await ctx.db.select().from(servers).where(and(eq(servers.id, sid), eq(servers.userId, ctx.auth!.uid)));
  if (!s) fail("سرور پیدا نشد.", 404);
  const wasRunning = s!.status === "running";
  if (wasRunning) {
    await run("servers.power", [sid, "stop"]);
    const [now] = await ctx.db.select({ status: servers.status }).from(servers).where(eq(servers.id, sid));
    if (now?.status !== "stopped") fail("سرور در حال خاموش شدن است؛ چند لحظه دیگر دوباره «اعمال» را بزنید.", 409);
  }
  await run("servers.changePlan", [sid, planId]);
  if (wasRunning) await run("servers.power", [sid, "start"]);
}

const sameAction = (a: Action | null, b: Action | null) => JSON.stringify(a ? [a.calls, a.preview] : null) === JSON.stringify(b ? [b.calls, b.preview] : null);

/** runs a finding's action: confirm is always required, and the resource name typed for costly or destructive ones */
export async function apply(ctx: Ctx, id: string, confirm: boolean, typed = ""): Promise<ApplyResult> {
  const { a, r } = await own(ctx, id);
  if (r.status !== "open") fail("این پیشنهاد دیگر باز نیست.", 409);
  const before = r.action as unknown as Action | null;
  if (!before || !before.calls.length) fail("این پیشنهاد اقدام خودکار ندارد" + (before?.link ? "؛ از پیوند آن استفاده کنید." : "."));
  if (!confirm) fail("برای اجرا، اقدام را تأیید کنید (" + before!.preview + ").", 409);
  if (before!.typed && typed.trim() !== r.resourceName) fail("برای تأیید، نام «" + r.resourceName + "» را دقیق بنویسید.");
  // derived again from the current rows: a changed price or a vanished resource never runs on an old card
  const fresh = (await computeFindings(ctx.db, a.uid)).findings.find((f) => f.key === r.key) ?? null;
  if (!fresh || !sameAction(before, fresh.action)) {
    if (fresh) await ctx.db.update(advisorFindings).set({ ...stored(fresh), updatedAt: new Date() }).where(eq(advisorFindings.id, r.id));
    else await ctx.db.update(advisorFindings).set({ status: "expired", updatedAt: new Date() }).where(eq(advisorFindings.id, r.id));
    fail(fresh ? "قیمت یا جزئیات این پیشنهاد تغییر کرده است؛ صفحه را تازه کنید و دوباره بررسی کنید." : "این پیشنهاد دیگر معتبر نیست.", 409);
  }
  const { registry } = await import("../rpc"); // lazy: the RPC registry imports this module
  const run = async (name: string, args: unknown[]) => {
    const m = registry[name];
    if (!m) fail("این اقدام در دسترس نیست.");
    if (!teamAllows(ctx.auth?.teamRole, name) || !(await customAllows(ctx.db, ctx.auth, name))) throw new AppError("نقش شما در این حساب اجازه این کار را ندارد.", 403);
    return m.run(ctx, m.args.parse(args));
  };
  const calls = fresh!.action!.calls;
  // the whole plan is checked before anything runs, so a role that may do only part of it changes nothing
  for (const [name] of calls) for (const n of name === "@vps.downsize" ? ["servers.power", "servers.changePlan"] : [name])
    if (!teamAllows(ctx.auth?.teamRole, n) || !(await customAllows(ctx.db, ctx.auth, n))) fail("نقش شما در این حساب اجازه این کار را ندارد.", 403);
  for (const [name, args] of calls as Call[]) {
    if (name === "@vps.downsize") await downsize(ctx, run, String(args[0]), String(args[1]));
    else await run(name, args);
  }
  await ctx.db.update(advisorFindings).set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() }).where(eq(advisorFindings.id, r.id));
  await logActivity(ctx.db, a.uid, "trending-down", ADVISOR.name + ": " + before!.label + " (" + r.resourceName + ") — " + before!.preview, ctx.ip);
  if (a.uid !== a.user.id && a.user.role === "admin") await logAudit(ctx.db, actor(ctx), ADVISOR.name + ": " + before!.label, r.id, ctx.ip);
  return { ok: true, message: "انجام شد: " + before!.label };
}

/* ---------------- the weekly job ---------------- */
const RISKY: AdvisorRule[] = ["vps_undersized", "traffic_overrun", "paas_oom"];
/** what deserves a notification: a new saving above the threshold, or a risk (undersized, traffic, runway under 7 days) */
const notable = (r: Row, min: number) => r.saving >= min || RISKY.includes(r.rule as AdvisorRule) || (r.rule === "wallet_runway" && r.risk === "high");

/** every active customer with something billable: recompute, then one notification and one email digest per account
    when something new and notable appeared since the last digest (never when the account muted the advisor) */
export async function advisorWeekly(db: DB) {
  const since = new Date(Date.now() - 35 * DAY);
  const ids = new Set<string>();
  for (const q of [
    db.selectDistinct({ id: servers.userId }).from(servers).where(inArray(servers.status, ["running", "stopped"])),
    db.selectDistinct({ id: paasApps.userId }).from(paasApps),
    db.selectDistinct({ id: storageBuckets.userId }).from(storageBuckets),
    db.selectDistinct({ id: aiUsage.userId }).from(aiUsage).where(gte(aiUsage.createdAt, since)),
    db.selectDistinct({ id: transactions.userId }).from(transactions).where(and(eq(transactions.type, "usage"), gte(transactions.createdAt, since))),
  ]) for (const r of await q) ids.add(r.id);
  const active = ids.size ? await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(and(inArray(users.id, [...ids]), eq(users.status, "active"), eq(users.role, "user"))) : [];
  const { notifyMin } = await advisorSettings(db);
  let sent = 0;
  for (const u of active) {
    try {
      await refresh(db, u.id);
      const [st] = await db.select().from(advisorState).where(eq(advisorState.userId, u.id));
      const fresh = (await db.select().from(advisorFindings).where(and(eq(advisorFindings.userId, u.id), eq(advisorFindings.status, "open"), sql`${advisorFindings.notifiedAt} is null`))).filter((r) => notable(r, notifyMin));
      if (!fresh.length || st?.muted) continue;
      const open = await db.select().from(advisorFindings).where(and(eq(advisorFindings.userId, u.id), eq(advisorFindings.status, "open")));
      const total = open.reduce((s, r) => s + r.saving, 0);
      const risks = fresh.filter((r) => r.saving === 0).length;
      const text = ADVISOR.name + ": " + (total ? "ماهانه تا " + fa(total) + " تومان صرفه‌جویی ممکن است" : "") + (total && risks ? "؛ " : "") + (risks ? fa(risks) + " هشدار تازه" : "") + ".";
      await notify(db, u.id, "trending-down", text);
      const lines = sortRows(fresh).slice(0, 8).map((r) => "• " + r.title + (r.saving ? " — صرفه‌جویی ماهانه " + fa(r.saving) + " تومان" : r.extraCost ? " — هزینه اضافه ماهانه " + fa(r.extraCost) + " تومان" : ""));
      const week = Math.floor(Date.now() / (7 * DAY));
      await enqueue(db, "notify.send", { userId: u.id, kind: "billing", subject: "گزارش هفتگی " + ADVISOR.name, text: (st?.summary ? st.summary + "\n\n" : "") + lines.join("\n") + "\n\nجزئیات و «اعمال» با یک کلیک: https://gereh.net/panel/advisor\nبرای قطع این گزارش، در همان صفحه «اعلان هفتگی» را خاموش کنید." }, { dedupe: "advisor:" + u.id + ":" + week });
      await db.update(advisorFindings).set({ notifiedAt: new Date() }).where(inArray(advisorFindings.id, fresh.map((r) => r.id)));
      await db.update(advisorState).set({ digestAt: new Date() }).where(eq(advisorState.userId, u.id));
      sent++;
    } catch (e) {
      console.error("[advisor.weekly] " + u.id, e);
    }
  }
  return { accounts: active.length, sent };
}

/* ---------------- admin ---------------- */
export async function adminStats(ctx: Ctx): Promise<AdvisorAdminStats> {
  needStaff(ctx, "reports");
  const rows = await ctx.db.select({ rule: advisorFindings.rule, status: advisorFindings.status, userId: advisorFindings.userId, saving: advisorFindings.saving }).from(advisorFindings);
  const open = rows.filter((r) => r.status === "open"), applied = rows.filter((r) => r.status === "applied");
  const rules = [...new Set(open.map((r) => r.rule))] as AdvisorRule[];
  const { day, month } = tehranStarts();
  const [spendToday, spendMonth, s] = await Promise.all([platformSpend(ctx.db, PURPOSE, day), platformSpend(ctx.db, PURPOSE, month), advisorSettings(ctx.db)]);
  return {
    potentialSaving: open.reduce((a, r) => a + r.saving, 0), openFindings: open.length, accounts: new Set(open.map((r) => r.userId)).size,
    applied: applied.length, appliedSaving: applied.reduce((a, r) => a + r.saving, 0), ignored: rows.filter((r) => r.status === "ignored").length,
    byRule: rules.map((rule) => ({ rule, label: RULE_LABEL[rule] ?? rule, open: open.filter((r) => r.rule === rule).length, saving: open.filter((r) => r.rule === rule).reduce((a, r) => a + r.saving, 0) })).sort((a, b) => b.saving - a.saving),
    spendToday, spendMonth, dailyCap: s.dailyCap,
  };
}

