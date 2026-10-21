/* «توضیح بده و درستش کن»: explains an error the customer sees and offers one-click fixes.
   The error is always loaded by the server from the customer's own resource (or, for an error toast, from a
   sealed reference the RPC route issued), so nobody can explain someone else's resource. The prompt is compact,
   truncated and redacted (env values, passwords, tokens, connection strings, anything key-like). The model may only
   pick fixes from what the server offered; each fix's RPC arguments are derived here, never taken from the model.
   One explanation costs a small, metered amount from the wallet; the same error within an hour is free (cached). */
import "server-only";
import { and, asc, desc, eq, gt, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { costOf, estimateTokens } from "@/lib/ai";
import { EXPLAIN_CACHE_MS, EXPLAIN_MIN_FEE, type ExplainKind, type Explanation, type FixAction, type FixId } from "@/lib/explain";
import { faDateTime } from "@/lib/jalali";
import { appMonthly, ENV_KEY_RE, ENV_RESERVED } from "@/lib/paas";
import { FAILURES, type FailureKind } from "@/lib/paas-runtime";
import { customAllows } from "../account-extras";
import { rateLimit } from "../auth";
import { needUser, teamAllows, type Ctx } from "../ctx";
import type { DB } from "../db/client";
import {
  aiExplanations, aiModels, builderMessages, builderProjects, paasApps, paasDbEvents, paasDbImports, paasDbs, paasDeployments, paasEnv, paasEvents, paasPlans,
  serverTasks, servers, vpsRelayout,
} from "../db/schema";
import { enqueue } from "../jobs";
import { loadEgress, platformEgress } from "../paas/egress";
import { open, seal } from "../secrets";
import { addTask, fail, logActivity, rid, sha256 } from "../util";
import { POWER_LABEL } from "../virt/power";
import { SYNCABLE } from "../virt/sync";
import { virt } from "../virt/driver";
import { isAiError } from "./endpoints";
import { simulateExplain, type SimFacts } from "./explain-sim";
import { openMeter, panelCaller, resolveModel, type ResolvedModel } from "./service";
import { readChat, type ChatMessage } from "./translate";
import { aiUpstream } from "./upstream";

const MAX_ERR = 4000, MAX_OUT = 900;
const RPC_REF_TTL_MS = 2 * 3600_000, FIX_TTL_MS = 24 * 3600_000;
/** placeholders a stored call carries until the fix runs */
const INPUT = "$INPUT", SUMMARY = "$SUMMARY";

type Call = [string, unknown[]];
export type StoredAction = Omit<FixAction, "applied"> & { calls: Call[] };
type Subject = {
  title: string; errorText: string;
  /** facts for the prompt: names, numbers and keys only, never values */
  context: Record<string, unknown>;
  secrets: string[]; offered: StoredAction[]; facts: SimFacts;
};

/* ---------------- redaction ---------------- */
const KEYLIKE: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED KEY]"],
  [/\b([a-z][a-z0-9+.-]{1,20}:\/\/)[^\s:@/'"]+:[^\s@/'"]+@/gi, "$1[REDACTED]@"],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED]"],
  [/\b((?:[A-Za-z_]*_)?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth|credentials?)[A-Za-z_]*)(\s*["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;&'"]+)/gi, "$1$2[REDACTED]"],
  [/\b(?:gk|sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]"],
  [/\b(?:ghp|gho|ghs|ghu|github_pat|glpat|xox[abprs])[-_][A-Za-z0-9_-]{10,}\b/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED JWT]"],
  [/\b(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}={0,2}/g, "[REDACTED]"],
];
/** removes known secret values first, then anything that looks like a credential */
export function redact(text: string, secrets: string[] = []) {
  let out = text;
  for (const s of [...new Set(secrets)].filter((v) => v && v.length >= 4).sort((a, b) => b.length - a.length)) out = out.split(s).join("[REDACTED]");
  for (const [re, to] of KEYLIKE) out = out.replace(re, to);
  return out;
}
const tail = (s: string, n: number) => (s.length > n ? "…" + s.slice(-n) : s);
const normalize = (s: string) => s.replace(/\b\d{4}-\d\d-\d\dT[\d:.]+Z?\b/g, "").replace(/pod [\w-]+/g, "pod").replace(/\s+/g, " ").trim();

/* ---------------- an error toast's sealed reference ---------------- */
/** issued by /api/rpc with the error: the explainer trusts only what it sealed itself */
export const rpcErrorRef = (uid: string, method: string, message: string) => seal(JSON.stringify({ u: uid, m: method, e: message.slice(0, 500), t: Date.now() }));
/** adds the sealed ref to a signed-in customer's error answer (not sign-in, not the explainer itself, not bare 500s) */
export async function withErrorRef(res: Response, uid: string, method: string): Promise<Response> {
  if (!uid || res.status === 401 || (res.status >= 500 && res.status !== 502) || method.startsWith("auth.") || method === "ai.explain" || method === "ai.applyFix") return res;
  const j = (await res.clone().json().catch(() => null)) as { error?: string } | null;
  if (!j?.error) return res;
  return Response.json({ error: j.error, ref: rpcErrorRef(uid, method, j.error) }, { status: res.status, headers: res.headers });
}

/* ---------------- hints read out of an error ---------------- */
const fa = (n: number) => n.toLocaleString("fa-IR");
export function listeningPort(text: string): number | undefined {
  const m = /listening (?:on|at)\s+(?:(?:https?:\/\/)?(?:\[[\da-f:]*\]|[\w.-]+)?:)?(\d{2,5})\b/i.exec(text)
    ?? /(?:started|running|serving|bound) (?:server |app )?(?:on|at) (?:(?:https?:\/\/)?[\w.\[\]:-]*:)?(?:port )?(\d{2,5})\b/i.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 65535 ? n : undefined;
}
const ENV_PATTERNS = [
  /(?:missing|required|undefined|not set|not defined)[^\n]{0,40}?(?:env(?:ironment)?(?: variable)?|config(?:uration)? (?:key|value))[\s:'"`]*([A-Z][A-Z0-9_]{2,127})\b/,
  /env(?:ironment)? (?:variable|var)[\s:'"`]*([A-Z][A-Z0-9_]{2,127})[\s'"`]*(?:is )?(?:missing|required|not set|undefined|not defined)/i,
  /KeyError: '([A-Z][A-Z0-9_]{2,127})'/,
  /process\.env\.([A-Z][A-Z0-9_]{2,127}) is (?:undefined|not set|required|missing)/,
  /\b([A-Z][A-Z0-9_]{2,127}) (?:environment variable )?(?:is )?(?:not set|missing|required|undefined)\b/,
];
export function missingEnvKey(text: string, have: string[]): string | undefined {
  for (const re of ENV_PATTERNS) {
    const k = re.exec(text)?.[1];
    if (k && ENV_KEY_RE.test(k) && !ENV_RESERVED.has(k) && !have.includes(k)) return k;
  }
  return undefined;
}
const OOM = /OOMKilled|heap out of memory|Cannot allocate memory|Out of memory|exit code 137|signal: killed/i;
const EGRESS = /ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|i\/o timeout|connect timeout|Network is unreachable|Could not resolve host|getaddrinfo|ImagePull|ErrImagePull/i;

const ticket = (subject: string, service: string): StoredAction => ({
  id: "ticket", label: "ثبت تیکت با همین خلاصه", rpc: "tickets.create", costly: false,
  calls: [["tickets.create", [{ subject: subject.slice(0, 110), dept: "فنی", priority: "normal", service, message: SUMMARY }]]],
});

/* ---------------- loading the error from the customer's own resource ---------------- */
async function paasSubject(db: DB, uid: string, appId: string, ref: string): Promise<Subject> {
  const [app] = await db.select().from(paasApps).where(and(eq(paasApps.id, appId), eq(paasApps.userId, uid)));
  if (!app) fail("اپ پیدا نشد.", 404);
  const [plan] = await db.select().from(paasPlans).where(eq(paasPlans.id, app!.planId));
  const env = await db.select({ key: paasEnv.key, valueEnc: paasEnv.valueEnc, managedBy: paasEnv.managedBy }).from(paasEnv).where(eq(paasEnv.appId, app!.id));
  const secrets = env.map((e) => open(e.valueEnc) ?? "");
  const events = await db.select().from(paasEvents).where(eq(paasEvents.appId, app!.id)).orderBy(desc(paasEvents.createdAt), desc(paasEvents.id)).limit(8);
  let errorText = "", failure = "", depId = "";
  if (ref.startsWith("ev-")) {
    const ev = events.find((e) => e.id === Number(ref.slice(3)))
      ?? (await db.select().from(paasEvents).where(and(eq(paasEvents.appId, app!.id), eq(paasEvents.id, Number(ref.slice(3)) || 0))))[0];
    if (!ev || !["deploy_failed", "crash", "oom", "health_failed"].includes(ev.kind)) fail("این رویداد خطایی ندارد.", 404);
    errorText = ev!.kind + ": " + ev!.message;
    const m = /\((dep-[\w]+)\)/.exec(ev!.message);
    if (m) depId = m[1];
  } else {
    const [dep] = ref === "app"
      ? await db.select().from(paasDeployments).where(and(eq(paasDeployments.appId, app!.id), eq(paasDeployments.status, "failed"))).orderBy(desc(paasDeployments.createdAt)).limit(1)
      : await db.select().from(paasDeployments).where(and(eq(paasDeployments.id, ref), eq(paasDeployments.appId, app!.id)));
    if (!dep) fail("استقرار پیدا نشد.", 404);
    if (dep!.status !== "failed" && !dep!.log.includes("==> Waiting:")) fail("این استقرار خطایی ندارد.");
    depId = dep!.id;
  }
  if (depId) {
    const [dep] = await db.select().from(paasDeployments).where(and(eq(paasDeployments.id, depId), eq(paasDeployments.appId, app!.id)));
    if (dep) {
      failure = dep.failure;
      errorText = (errorText ? errorText + "\n" : "") + (dep.failure && FAILURES[dep.failure as FailureKind] ? "failure class: " + dep.failure + "\n" : "") + tail(dep.log, MAX_ERR);
    }
  }
  const [lastGood] = await db.select({ id: paasDeployments.id }).from(paasDeployments)
    .where(and(eq(paasDeployments.appId, app!.id), eq(paasDeployments.target, "production"), inArray(paasDeployments.status, ["live", "superseded"]), ne(paasDeployments.image, ""), ...(app!.liveDeployment ? [ne(paasDeployments.id, app!.liveDeployment)] : [])))
    .orderBy(desc(paasDeployments.createdAt)).limit(1);
  const [builder] = await db.select().from(builderProjects).where(and(eq(builderProjects.appId, app!.id), eq(builderProjects.userId, uid)));
  const [egress, platform] = await Promise.all([loadEgress(db, app!.id), platformEgress(db)]);
  const plans = await db.select().from(paasPlans).where(and(eq(paasPlans.kind, "app"), eq(paasPlans.active, true))).orderBy(asc(paasPlans.price));
  const next = plan ? plans.find((p) => p.ramMb > plan.ramMb && p.price > plan.price) : undefined;

  const keys = env.map((e) => e.key);
  const port = listeningPort(errorText);
  const missing = missingEnvKey(errorText, keys);
  const offered: StoredAction[] = [];
  const canDeploy = (app!.source === "git" || app!.source === "image") && app!.status !== "stopped" && app!.status !== "suspended";
  const deploy: Call = ["paas.deploy", [app!.id, { message: "استقرار دوباره (پیشنهاد AI)" }]];
  if (builder && depId && builder.status !== "deploying" && builder.status !== "fixing") {
    offered.push({ id: "builder_fix", label: "رفع خودکار با بافت", rpc: "builder.fix", costly: false, priceNote: "هزینه AI طبق مصرف از کیف پول", calls: [["@builder.fix", [builder.id, depId]]] });
  }
  if (!builder && port && port !== app!.port) {
    offered.push({ id: "set_port", label: "تغییر پورت به " + port.toLocaleString("fa-IR", { useGrouping: false }) + " و استقرار دوباره", rpc: "paas.updateApp", costly: false, calls: [["paas.updateApp", [app!.id, { port }]], ...(!app!.liveDeployment && canDeploy ? [deploy] : [])] });
  }
  if (!builder && app!.healthPath !== "/" && (failure === "health" || /statuscode: 404|probe failed/i.test(errorText))) {
    offered.push({ id: "set_health_path", label: "مسیر سلامت «/» و استقرار دوباره", rpc: "paas.updateApp", costly: false, calls: [["paas.updateApp", [app!.id, { healthPath: "/" }]], ...(!app!.liveDeployment && canDeploy ? [deploy] : [])] });
  }
  if (plan && next && (failure === "oom" || OOM.test(errorText))) {
    const extra = appMonthly(next, app!.instances, app!.diskGb) - appMonthly(plan, app!.instances, app!.diskGb);
    offered.push({
      id: "raise_plan", label: "ارتقا به پلن «" + next.name + "»", rpc: "paas.scale", costly: true, price: extra,
      priceNote: "+" + fa(extra) + " تومان در ماه (" + fa(next.ramMb) + " مگابایت حافظه، " + fa(next.cpu) + " هسته)",
      calls: [["paas.scale", [app!.id, { planId: next.id, instances: app!.instances, autoscale: app!.autoscale, maxInstances: app!.maxInstances, diskGb: app!.diskGb, autoscaleCpu: app!.autoscaleCpu }]]],
    });
  }
  if (missing) {
    offered.push({ id: "set_env", label: "تعریف متغیر " + missing, rpc: "paas.setEnv", costly: false, input: { label: "مقدار " + missing, placeholder: "مقدار را وارد کنید", secret: true }, calls: [["paas.setEnv", [app!.id, [{ key: missing, value: INPUT, secret: true }], []]], ...(!app!.liveDeployment && canDeploy ? [deploy] : [])] });
  }
  if (canDeploy) offered.push({ id: "redeploy", label: "استقرار دوباره", rpc: "paas.deploy", costly: false, calls: [deploy] });
  if (lastGood) offered.push({ id: "rollback", label: "بازگشت به آخرین نسخه سالم (" + lastGood.id + ")", rpc: "paas.rollback", costly: false, calls: [["paas.rollback", [app!.id, lastGood.id]]] });
  if ((egress?.mode ?? "off") === "off" && platform.url && EGRESS.test(errorText)) {
    offered.push({ id: "enable_proxy", label: "روشن کردن پروکسی خروجی گره", rpc: "paas.setEgress", costly: false, calls: [["paas.setEgress", [app!.id, { mode: "platform", url: null, noProxy: egress?.noProxy ?? [] }]]] });
  }
  offered.push(ticket("خطای اپ " + app!.name, ""));
  return {
    title: "اپ " + app!.name, errorText, secrets, offered,
    facts: { port: app!.port, healthPath: app!.healthPath, listeningPort: port, missingEnv: missing, planName: plan?.name, ramMb: plan?.ramMb, nextPlan: next?.name, stack: app!.stack, builder: !!builder },
    context: {
      app: app!.name, stack: app!.stack, source: app!.source, status: app!.status, port: app!.port, healthPath: app!.healthPath, startCommand: app!.startCommand ? "(set)" : "(none)",
      plan: plan ? { name: plan.name, ramMb: plan.ramMb, cpu: plan.cpu } : app!.planId, instances: app!.instances,
      envKeys: keys, outboundProxy: egress?.mode ?? "off", builtWithBuilder: !!builder, hasLiveVersion: !!app!.liveDeployment,
      recentEvents: events.map((e) => e.kind + ": " + e.message.slice(0, 160)),
    },
  };
}

async function vpsSubject(db: DB, uid: string, sid: string, ref: string): Promise<Subject> {
  const [s] = await db.select().from(servers).where(and(eq(servers.id, sid), eq(servers.userId, uid)));
  if (!s) fail("سرور پیدا نشد.", 404);
  const tasks = await db.select().from(serverTasks).where(eq(serverTasks.serverId, s!.id)).orderBy(desc(serverTasks.createdAt)).limit(8);
  let errorText = "";
  if (ref === "provision") {
    const failed = tasks.find((t) => t.status === "failed");
    errorText = s!.provisionError || failed?.action || "";
    if (!errorText) fail("خطایی برای این سرور ثبت نشده است.");
  } else if (ref === "relayout") {
    const [r] = await db.select().from(vpsRelayout).where(eq(vpsRelayout.serverId, s!.id));
    errorText = r?.lastError ? "relayout step " + r.step + ": " + r.lastError : "";
    if (!errorText) fail("خطایی برای بازسازی دیسک ثبت نشده است.");
  } else if (ref.startsWith("vz-")) {
    const list = s!.vpsid ? await (await virt()).logs(s!.vpsid).catch(() => []) : [];
    const e = list.find((x) => x.id === ref.slice(3) && x.status === "failed");
    if (!e) fail("این مورد لاگ خطایی ندارد.", 404);
    errorText = "Virtualizor " + e!.action + (e!.text ? ": " + e!.text : "");
  } else {
    const tid = ref.startsWith("t-") ? ref.slice(2) : ref;
    const [t] = await db.select().from(serverTasks).where(and(eq(serverTasks.id, tid), eq(serverTasks.serverId, s!.id)));
    if (!t || t.status !== "failed") fail("این مورد لاگ خطایی ندارد.", 404);
    errorText = t!.action;
  }
  const offered: StoredAction[] = [];
  const operable = !!s!.vpsid && !["suspended", "provisioning", "relayout", "missing"].includes(s!.status);
  const power = (Object.entries(POWER_LABEL) as [keyof typeof POWER_LABEL, string][]).find(([, label]) => errorText.startsWith(label) && /تأیید نشد/.test(errorText))?.[0];
  if (operable && power) offered.push({ id: "retry_power", label: "تلاش دوباره: " + POWER_LABEL[power], rpc: "servers.power", costly: false, calls: [["servers.power", [s!.id, power]]] });
  if (operable && s!.status === "stopped" && power !== "start") offered.push({ id: "start_server", label: "روشن کردن سرور", rpc: "servers.power", costly: false, calls: [["servers.power", [s!.id, "start"]]] });
  if (s!.vpsid && SYNCABLE.includes(s!.status)) offered.push({ id: "sync_server", label: "به‌روزرسانی وضعیت از Virtualizor", rpc: "servers.sync", costly: false, calls: [["servers.sync", [s!.id]]] });
  offered.push(ticket("خطای سرور " + s!.name, s!.id));
  return {
    title: "سرور " + s!.name, errorText, secrets: [s!.vncPassword], offered, facts: {},
    context: { server: s!.name, status: s!.status, plan: s!.plan, os: s!.os, cpu: s!.cpu, ramGb: s!.ram, diskGb: s!.disk, location: s!.loc, delivered: !!s!.vpsid, recentTasks: tasks.map((t) => t.status + ": " + t.action.slice(0, 160)) },
  };
}

async function dbaasSubject(db: DB, uid: string, dbId: string, ref: string): Promise<Subject> {
  const [row] = await db.select().from(paasDbs).where(and(eq(paasDbs.id, dbId), eq(paasDbs.userId, uid)));
  if (!row) fail("پایگاه داده پیدا نشد.", 404);
  const [plan] = await db.select().from(paasPlans).where(eq(paasPlans.id, row!.planId));
  const events = await db.select().from(paasDbEvents).where(eq(paasDbEvents.dbId, row!.id)).orderBy(desc(paasDbEvents.createdAt), desc(paasDbEvents.id)).limit(8);
  let errorText = "";
  if (ref.startsWith("ev-")) {
    const [e] = await db.select().from(paasDbEvents).where(and(eq(paasDbEvents.dbId, row!.id), eq(paasDbEvents.id, Number(ref.slice(3)) || 0)));
    if (!e || e.level === "info") fail("این رویداد خطایی ندارد.", 404);
    errorText = e!.message;
  } else if (ref === "status") {
    const bad = events.filter((e) => e.level !== "info");
    if (row!.status !== "failed" && !bad.length) fail("خطایی برای این پایگاه داده ثبت نشده است.");
    errorText = "database status: " + row!.status + (bad.length ? "\n" + bad.map((e) => e.message).join("\n") : "");
  } else {
    const id = ref.startsWith("imp-") ? ref.slice(4) : ref;
    const [imp] = await db.select().from(paasDbImports).where(and(eq(paasDbImports.id, id), eq(paasDbImports.dbId, row!.id)));
    if (!imp || imp.status !== "failed") fail("این ورود داده خطایی ندارد.", 404);
    errorText = "import (" + imp!.format + ") failed:\n" + tail(imp!.output, MAX_ERR);
  }
  const offered: StoredAction[] = [];
  if (row!.status !== "creating" && row!.status !== "suspended") {
    offered.push({ id: "db_restart", label: row!.status === "running" ? "راه‌اندازی دوباره پایگاه داده" : "روشن کردن پایگاه داده", rpc: "paas.dbPower", costly: false,
      calls: row!.status === "running" ? [["paas.dbPower", [row!.id, "stop"]], ["paas.dbPower", [row!.id, "start"]]] : [["paas.dbPower", [row!.id, "start"]]] });
  }
  offered.push(ticket("خطای پایگاه داده " + row!.name, ""));
  return {
    title: "پایگاه داده " + row!.name, errorText, secrets: [open(row!.passwordEnc) ?? ""], offered, facts: { ramMb: plan?.ramMb, planName: plan?.name },
    context: { database: row!.name, engine: row!.engine, version: row!.version, status: row!.status, plan: plan ? { name: plan.name, ramMb: plan.ramMb, cpu: plan.cpu } : row!.planId, publicAccess: row!.publicAccess, recentEvents: events.map((e) => e.level + ": " + e.message.slice(0, 160)) },
  };
}

function rpcSubject(uid: string, method: string, ref: string): Subject {
  let p: { u?: string; m?: string; e?: string; t?: number } = {};
  try { p = JSON.parse(open(ref) ?? "{}"); } catch { /* invalid */ }
  if (p.u !== uid || p.m !== method || typeof p.e !== "string") fail("این خطا قابل توضیح نیست.", 404);
  if (Date.now() - (p.t ?? 0) > RPC_REF_TTL_MS) fail("این خطا قدیمی شده است؛ کار را دوباره انجام دهید.", 410);
  return { title: "خطای پنل", errorText: p.e!, secrets: [], offered: [], facts: {}, context: { action: method } };
}

export async function loadSubject(ctx: Ctx, uid: string, kind: ExplainKind, resourceId: string, ref: string): Promise<Subject> {
  if (kind === "paas") return paasSubject(ctx.db, uid, resourceId, ref);
  if (kind === "vps") return vpsSubject(ctx.db, uid, resourceId, ref);
  if (kind === "dbaas") return dbaasSubject(ctx.db, uid, resourceId, ref);
  return rpcSubject(uid, resourceId, ref);
}

/* ---------------- the prompt and the model ---------------- */
export function buildMessages(kind: ExplainKind, subj: Subject, errorText: string): ChatMessage[] {
  const context = redact(JSON.stringify(subj.context), subj.secrets).slice(0, 2500);
  const offered = subj.offered.map((a) => ({ id: a.id, label: a.label, costly: a.costly }));
  const system = [
    "You explain errors to customers of Gereh, an Iranian cloud platform (cloud servers, Gereh Apps PaaS on Kubernetes, managed databases).",
    "Answer in Persian (fa), in plain words a non-expert understands. Be concrete and short.",
    "Return ONLY one JSON object, no markdown: {\"summary\": string, \"cause\": string, \"steps\": string[], \"actions\": [{\"id\": string}]}.",
    "summary: what happened (1-2 sentences). cause: the most likely root cause. steps: 2-5 concrete fix steps.",
    "actions: choose zero or more ids ONLY from OFFERED_ACTIONS that would fix this error, best first. Never invent ids or arguments.",
    "Secrets were removed and shown as [REDACTED]; never ask for them.",
  ].join("\n");
  const user = "KIND: " + kind + "\nRESOURCE: " + subj.title + "\nCONTEXT: " + context + "\nOFFERED_ACTIONS: " + JSON.stringify(offered) + "\nERROR:\n" + errorText;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/** a cheap, fast chat model: AI_EXPLAIN_MODEL, else the active priced chat model with the lowest price */
export async function explainModel(db: DB): Promise<ResolvedModel | null> {
  const wanted = process.env.AI_EXPLAIN_MODEL;
  if (wanted) { const m = await resolveModel(db, wanted, [], "chat"); if (!isAiError(m) && m.outPrice > 0) return m; }
  const [m] = await db.select().from(aiModels).where(and(eq(aiModels.active, true), eq(aiModels.kind, "chat"), gt(aiModels.outPrice, 0), gte(aiModels.context, 32_000)))
    .orderBy(asc(sql`${aiModels.inPrice} + ${aiModels.outPrice} * 4`), asc(aiModels.position)).limit(1);
  return m ?? null;
}

const answerSchema = z.object({
  summary: z.string().min(1).max(1200), cause: z.string().max(1200).default(""),
  steps: z.array(z.string().max(600)).max(10).default([]),
  actions: z.array(z.union([z.string(), z.object({ id: z.string() }).passthrough()])).max(20).default([]),
});
/** the model's JSON (tolerates code fences and prose around it); null when unusable */
export function parseAnswer(text: string): { summary: string; cause: string; steps: string[]; ids: string[] } | null {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const r = answerSchema.safeParse(JSON.parse(text.slice(a, b + 1)));
    if (!r.success) return null;
    return { summary: r.data.summary, cause: r.data.cause, steps: r.data.steps.filter(Boolean).slice(0, 6), ids: r.data.actions.map((x) => (typeof x === "string" ? x : x.id)) };
  } catch { return null; }
}

/** only what the server offered, in the model's order; the ticket stays available whenever it was offered */
export function chooseActions(offered: StoredAction[], ids: string[]): StoredAction[] {
  const byId = new Map(offered.map((a) => [a.id as string, a]));
  const out: StoredAction[] = [];
  for (const id of ids) { const a = byId.get(id); if (a && !out.includes(a)) out.push(a); }
  const t = byId.get("ticket");
  if (t && !out.includes(t)) out.push(t);
  return out.slice(0, 5);
}

type Row = typeof aiExplanations.$inferSelect;
const view = (r: Row, cached: boolean): Explanation => ({
  id: r.id, kind: r.kind as ExplainKind, resourceId: r.resourceId, summary: r.summary, cause: r.cause, steps: r.steps,
  actions: r.actions.map(({ calls: _calls, ...a }) => ({ ...a, id: a.id as FixId, applied: r.applied.includes(a.id) })),
  charged: cached ? 0 : r.charged, cached, simulated: r.simulated, at: faDateTime(r.createdAt),
});

/** the whole explain path: load (with ownership), cache, meter, model or simulator, allowlist, store */
export async function explainError(ctx: Ctx, kind: ExplainKind, resourceId: string, errorRef: string): Promise<Explanation> {
  const a = needUser(ctx);
  const subj = await loadSubject(ctx, a.uid, kind, resourceId, errorRef);
  const errorText = tail(redact(subj.errorText, subj.secrets), MAX_ERR);
  const errorHash = sha256([kind, resourceId, normalize(errorText)].join("\n"));
  const [hit] = await ctx.db.select().from(aiExplanations)
    .where(and(eq(aiExplanations.userId, a.uid), eq(aiExplanations.errorHash, errorHash), gte(aiExplanations.createdAt, new Date(Date.now() - EXPLAIN_CACHE_MS))))
    .orderBy(desc(aiExplanations.createdAt)).limit(1);
  if (hit) return view(hit, true);
  await rateLimit(ctx.db, "ai-explain:" + a.uid, 20, 3600);

  const model = await explainModel(ctx.db);
  if (!model) fail("در حال حاضر سرویس هوش مصنوعی در دسترس نیست.", 503);
  const messages = buildMessages(kind, subj, errorText);
  const inEst = estimateTokens(JSON.stringify(messages).length);
  const fee = (inT: number, outT: number) => Math.max(EXPLAIN_MIN_FEE, costOf(inT, outT, model!));
  const meter = await openMeter(ctx.db, { caller: await panelCaller(ctx.db, a.uid), model: model!, format: "panel", reserve: fee(inEst, MAX_OUT) });
  if (isAiError(meter)) return fail(meter.message, meter.http);

  const sim = simulateExplain(kind, errorText, subj.facts);
  let answer: { summary: string; cause: string; steps: string[]; ids: string[] } = { summary: sim.summary, cause: sim.cause, steps: sim.steps, ids: sim.prefer };
  let simulated = true, charged = 0;
  const up = aiUpstream();
  if (up.name === "sim") {
    const outT = estimateTokens(JSON.stringify(sim).length);
    charged = await meter.close("success", { inTokens: inEst, outTokens: outT, charged: fee(inEst, outT), estimated: true, finish: "stop" });
  } else {
    try {
      const res = await up.chat({ model: model!.upstream || model!.id, messages, max_tokens: MAX_OUT, temperature: 0.2 }, AbortSignal.timeout(45_000));
      if (!res.ok) throw new Error("upstream " + res.status + " " + (await res.text().catch(() => "")).slice(0, 200));
      const r = readChat((await res.json()) as Record<string, unknown>);
      const parsed = parseAnswer(r.text);
      const inT = r.usage?.prompt_tokens ?? inEst, outT = r.usage?.completion_tokens ?? estimateTokens(r.text.length);
      if (!parsed) throw new Error("unusable answer: " + r.text.slice(0, 120));
      answer = parsed; simulated = false;
      charged = await meter.close("success", { inTokens: inT, outTokens: outT, charged: fee(inT, outT), estimated: !r.usage, finish: r.finish, request: messages, response: r.text });
    } catch (e) {
      // the rule-based answer still helps; a failed or unusable model call costs nothing
      await meter.close("error", { error: (e as Error).message });
      charged = 0;
    }
  }
  const actions = chooseActions(subj.offered, answer.ids);
  const [row] = await ctx.db.insert(aiExplanations).values({
    id: rid("aix"), userId: a.uid, kind, resourceId, errorRef: errorRef.slice(0, 4000), errorHash,
    summary: answer.summary.slice(0, 1200), cause: answer.cause.slice(0, 1200), steps: answer.steps.map((s) => s.slice(0, 600)).slice(0, 6),
    actions, charged, requestId: meter.requestId, simulated,
  }).returning();
  return view(row, false);
}

/* ---------------- running a fix ---------------- */
function fill(v: unknown, input: string, summary: string): unknown {
  if (v === INPUT) return input;
  if (v === SUMMARY) return summary;
  if (Array.isArray(v)) return v.map((x) => fill(x, input, summary));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, input, summary)]));
  return v;
}

/** بافت's own fix loop for the failed deployment of the project's app (src/server/builder/deploy.ts builderFix) */
async function startBuilderFix(ctx: Ctx, uid: string, projectId: string, depId: string) {
  const [p] = await ctx.db.select().from(builderProjects).where(and(eq(builderProjects.id, projectId), eq(builderProjects.userId, uid)));
  if (!p || !p.appId) fail("پروژه پیدا نشد.", 404);
  if (p!.status === "deploying" || p!.status === "fixing") fail("انتشار قبلی هنوز در جریان است.", 409);
  const [dep] = await ctx.db.select().from(paasDeployments).where(and(eq(paasDeployments.id, depId), eq(paasDeployments.appId, p!.appId!)));
  if (!dep) fail("استقرار پیدا نشد.", 404);
  await ctx.db.update(builderProjects).set({ status: "fixing", deployError: dep!.log.slice(-20_000) }).where(eq(builderProjects.id, p!.id));
  await ctx.db.insert(builderMessages).values({ projectId: p!.id, role: "assistant", content: "به درخواست شما، AI در حال بررسی لاگ و رفع خودکار خطای استقرار است." });
  await enqueue(ctx.db, "builder.fix", { projectId: p!.id, attempt: 1, log: dep!.log.slice(-8000), failure: dep!.failure });
}

export async function applyFix(ctx: Ctx, explanationId: string, actionId: string, confirm = false, input = "") {
  const a = needUser(ctx);
  const [row] = await ctx.db.select().from(aiExplanations).where(and(eq(aiExplanations.id, explanationId), eq(aiExplanations.userId, a.uid)));
  if (!row) fail("توضیح پیدا نشد.", 404);
  const action = row!.actions.find((x) => x.id === actionId);
  if (!action) fail("این اقدام برای این خطا پیشنهاد نشده است.");
  if (Date.now() - row!.createdAt.getTime() > FIX_TTL_MS) fail("این پیشنهاد قدیمی شده است؛ دوباره «توضیح» را بزنید.", 410);
  if (action!.costly && !confirm) fail("این اقدام هزینه دارد (" + (action!.priceNote ?? "") + ")؛ برای اجرا آن را تأیید کنید.", 409);
  const value = input.trim();
  if (action!.input && !value) fail("مقدار را وارد کنید.");
  await rateLimit(ctx.db, "ai-explain-fix:" + a.uid, 20, 600);
  const { registry } = await import("../rpc"); // lazy: the RPC registry imports this module
  const summary = [row!.summary, row!.cause && "علت احتمالی: " + row!.cause, row!.steps.length ? "پیشنهادها:\n" + row!.steps.map((s, i) => fa(i + 1) + ". " + s).join("\n") : "", "(خلاصه توسط دستیار خطای گره؛ شناسه " + row!.id + ")"].filter(Boolean).join("\n\n").slice(0, 4900);
  for (const [name, args] of action!.calls) {
    if (name === "@builder.fix") { await startBuilderFix(ctx, a.uid, String(args[0]), String(args[1])); continue; }
    const m = registry[name];
    if (!m) fail("این اقدام در دسترس نیست.");
    if (!teamAllows(ctx.auth?.teamRole, name) || !(await customAllows(ctx.db, ctx.auth, name))) fail("نقش شما در این حساب اجازه این کار را ندارد.", 403);
    await m.run(ctx, m.args.parse(fill(args, value, summary)));
  }
  await ctx.db.update(aiExplanations).set({ applied: [...new Set([...row!.applied, action!.id])] }).where(eq(aiExplanations.id, row!.id));
  await logActivity(ctx.db, a.uid, "sparkles", "رفع خطا با AI: " + action!.label, ctx.ip);
  if (row!.kind === "vps") await addTask(ctx.db, row!.resourceId, "رفع خطا با AI: " + action!.label);
  return { ok: true as const, actionId: action!.id as FixId, message: action!.id === "ticket" ? "تیکت ثبت شد." : action!.id === "builder_fix" ? "رفع خودکار شروع شد؛ نتیجه در صفحه پروژه نمایش داده می‌شود." : "انجام شد: " + action!.label };
}

