/* =====================================================================
   CLIENT DATA LAYER — the seam between UI and backend.
   ---------------------------------------------------------------------
   GET  /api/state           → { session, db } scoped to the signed-in user
   POST /api/rpc/<group.fn>  → one call per api.* method (validated and
                               authorised on the server, src/server/rpc)
   After every mutation the state is re-fetched, so components keep
   reading plain snapshots through useDB()/useSession().
   ===================================================================== */
import { useSyncExternalStore } from "react";
import type { Sku } from "./catalog";
import { HOSTING, TLDS, VPS } from "./catalog";
import { invGross, invTotal } from "./money";
import type { ClientDB, Coupon, DnsRecord, FwRule, Invoice, Session, Ticket } from "./types";

export type { CartItem, ClientDB, Coupon, DnsRecord, FwRule, Hosting, Invoice, Server, Session, Ticket, User } from "./types";
export { invGross, invTotal };
export type DB = ClientDB;

export const EMPTY_DB: ClientDB = {
  users: [], servers: [], hosting: [], domains: [], invoices: [], transactions: [], tickets: [], sshKeys: [], apiTokens: [], sessions: [],
  notifPrefs: {}, channels: [], bots: { telegram: false, bale: false }, twofa: false, inbox: [], notifications: [], activity: [], nodes: [], coupons: [], announcements: [], audit: [], staff: [],
  settings: { siteName: "گره", supportEmail: "", supportPhone: "", registration: true, maintenance: false, tax: 10, gateways: {}, smsProvider: "", smsKeySet: false, smtpHost: "", smtpPort: 587, affiliateRate: 10, payGateway: "",
    legalName: "", sellerNationalId: "", sellerEconomicCode: "", sellerAddress: "", sellerPostalCode: "", paasDomain: "gereh.dev" },
  plans: { cloud: VPS.cloud, metal: VPS.metal, hosting: HOSTING.linux.concat(HOSTING.wordpress) },
  tlds: TLDS, virt: {}, virtLog: [], planMap: [], osTemplates: [], isos: [], affiliate: { code: "", referred: 0, earned: 0 }, incidents: [], chats: [], posts: [], devopsLeads: [], devopsProjects: [], paasApps: [], paasDbs: [], paasPlans: [], paasDriver: "", inquiry: { services: [], account: null, calls: [], stats: { todayCount: 0, todaySpend: 0, monthCount: 0, monthSpend: 0, daily: [] }, grants: [], accounts: [], provider: "" }, ai: { models: [], keys: [], usage: [], stats: { todayCount: 0, todaySpend: 0, monthCount: 0, monthSpend: 0, daily: [], byModel: [] }, endpoint: "https://api.gereh.dev", upstream: "" }, geo: { plans: [], zones: [], nameservers: [], driver: "" },
  team: { members: [], invites: [], memberships: [] },
};

type Scope = "customer" | "admin";
type State = { loaded: boolean; scope: Scope; session: Session | null; db: ClientDB };
let state: State = { loaded: false, scope: "customer", session: null, db: EMPTY_DB };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
let inflight: Promise<void> | null = null;
let queued = false;

const defaultScope = (): Scope => (typeof location !== "undefined" && location.pathname.startsWith("/admin") ? "admin" : "customer");

/** re-reads /api/state; concurrent callers share one request and a trailing refresh */
export function refresh(scope: Scope = state.loaded ? state.scope : defaultScope()): Promise<void> {
  if (inflight) { queued = true; state = { ...state, scope }; return inflight; }
  inflight = (async () => {
    try {
      const res = await fetch("/api/state?scope=" + scope, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error("state " + res.status);
      const j = (await res.json()) as { session: Session | null; db: ClientDB };
      state = { loaded: true, scope, session: j.session, db: j.db };
    } catch {
      // offline or server error: keep what we have; anonymous on first load
      if (!state.loaded) state = { ...state, loaded: true, scope };
    } finally {
      inflight = null;
      emit();
      if (queued) { queued = false; void refresh(state.scope); }
    }
  })();
  return inflight;
}

/** the staff panel needs every record; everything else only the customer's */
export function setScope(scope: Scope) { if (!state.loaded || state.scope !== scope) void refresh(scope); }

const subscribe = (f: () => void) => {
  listeners.add(f);
  if (!state.loaded && !inflight && typeof window !== "undefined") void refresh();
  return () => { listeners.delete(f); };
};
export const useDB = () => useSyncExternalStore(subscribe, () => state.db, () => EMPTY_DB);
/** undefined until the first /api/state answer, then the session or null */
export const useSession = () => useSyncExternalStore<Session | null | undefined>(subscribe, () => (state.loaded ? state.session : undefined), () => undefined);
/** the customer whose data the panel shows (the impersonated one while staff impersonate) */
export const useMyId = () => useSession()?.userId ?? "";

export const byId = <T extends { id: string | number }>(list: T[], id: string) => list.find((x) => String(x.id) === id);
export const gatewayName = (db: ClientDB) => db.settings.payGateway || "";

/** client-side random password (only fills a form field; the server validates strength) */
export const genPassword = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%";
  return Array.from(crypto.getRandomValues(new Uint32Array(16)), (x) => abc[x % abc.length]).join("");
};

export type AiKeyInput = { name: string; models: string[]; dailyCap: number; monthlyCap: number; rpm: number; expiresDays: number };
export type GeoRecordInput = { name: string; type: "A" | "AAAA" | "CNAME" | "TXT" | "MX"; iran: string; world: string; ttl: number; priority: number | null };
const READ_ONLY = new Set(["billing.quote", "domains.check", "hosting.sso", "paas.deployment", "paas.logs", "paas.dbCredentials", "paas.adminTest", "paas.job", "paas.scanReport", "inquiry.reveal", "inquiry.adminProvider", "geo.adminTest", "ai.adminTest", "ai.adminDefaults"]);
async function rpc<T = void>(name: string, ...args: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/rpc/" + name, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ args }) });
  } catch {
    throw new Error("ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی کنید.");
  }
  const j = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok) {
    if (res.status === 401 && !name.startsWith("auth.")) void refresh();
    throw new Error(j.error || "خطای سرور؛ چند لحظه دیگر دوباره تلاش کنید.");
  }
  if (!READ_ONLY.has(name)) await refresh();
  return j.result as T;
}
const go = (url: string) => { window.location.assign(url); return new Promise<never>(() => {}); };
const origin = () => window.location.origin;

type Rec = Omit<DnsRecord, "id"> & { id?: string };
export type Quote = { code: string; type: "percent" | "fixed"; value: number; discount: number };

export const api = {
  auth: {
    login: (id: string, password: string, code?: string) => rpc<Session>("auth.login", id, password, ...(code ? [code] : [])),
    sendOtp: (phone: string) => rpc<boolean>("auth.sendOtp", phone),
    verifyOtp: (phone: string, code: string) => rpc<Session>("auth.verifyOtp", phone, code),
    register: (d: { name: string; email: string; phone: string; password: string; ref?: string }) => rpc<Session>("auth.register", d),
    forgot: (email: string) => rpc<boolean>("auth.forgot", email),
    logout: () => rpc("auth.logout"),
  },
  servers: {
    power: (id: string, action: "start" | "stop" | "reboot") => rpc("servers.power", id, action),
    rename: (id: string, name: string) => rpc("servers.rename", id, name),
    setRdns: (id: string, rdns: string) => rpc("servers.setRdns", id, rdns),
    resize: (id: string, planId: string) => rpc("servers.resize", id, planId),
    reinstall: (id: string, os: string) => rpc("servers.reinstall", id, os),
    remove: (id: string) => rpc("servers.remove", id),
    toggleBackups: (id: string) => rpc("servers.toggleBackups", id),
    snapshot: (id: string, name?: string) => rpc("servers.snapshot", id, ...(name ? [name] : [])),
    deleteSnapshot: (id: string, snapId: string) => rpc("servers.deleteSnapshot", id, snapId),
    restore: (id: string, label: string) => rpc("servers.restore", id, label),
    addRule: (id: string, rule: Omit<FwRule, "id">) => rpc("servers.addRule", id, rule),
    removeRule: (id: string, ruleId: string) => rpc("servers.removeRule", id, ruleId),
    setStatus: (id: string, status: string) => rpc("servers.setStatus", id, status),
    setHostname: (id: string, hostname: string) => rpc("servers.setHostname", id, hostname),
    resetRootPassword: (id: string, pass: string) => rpc("servers.resetRootPassword", id, pass),
    setVncPass: (id: string, pass: string) => rpc("servers.setVncPass", id, pass),
    setBoot: (id: string, boot: string) => rpc("servers.setBoot", id, boot),
    mountIso: (id: string, iso: string) => rpc("servers.mountIso", id, iso),
    setRescue: (id: string, on: boolean, pass?: string) => rpc("servers.setRescue", id, on, ...(pass ? [pass] : [])),
    installPanel: (id: string, panel: string) => rpc("servers.installPanel", id, panel),
    setAlerts: (id: string, alerts: { cpu: number; bw: number }) => rpc("servers.setAlerts", id, alerts),
  },
  hosting: {
    resetPassword: (id: string) => rpc<string>("hosting.resetPassword", id),
    sso: (id: string) => rpc<string>("hosting.sso", id),
    setStatus: (id: string, status: string) => rpc("hosting.setStatus", id, status),
    renew: (id: string, months: 1 | 12) => rpc<{ id: string }>("hosting.renew", id, months),
    setAutoRenew: (id: string, on: boolean) => rpc("hosting.setAutoRenew", id, on),
  },
  domains: {
    addRecord: (id: string, r: Rec) => rpc("domains.addRecord", id, r),
    updateRecord: (id: string, r: DnsRecord) => rpc("domains.updateRecord", id, r),
    removeRecord: (id: string, rid: string) => rpc("domains.removeRecord", id, rid),
    setNs: (id: string, ns: string[]) => rpc("domains.setNs", id, ns),
    toggle: (id: string, key: "autoRenew" | "privacy" | "locked") => rpc("domains.toggle", id, key),
    renew: (id: string, years: number) => rpc<Invoice>("domains.renew", id, years),
    check: (name: string) => rpc<{ tld: string; available: boolean }[]>("domains.check", name),
  },
  billing: {
    quote: (code: string, subtotal: number) => rpc<Quote>("billing.quote", code, subtotal),
    checkout: (skus: Sku[], coupon?: string) => rpc<Invoice>("billing.checkout", skus, ...(coupon ? [coupon] : [])),
    /** wallet → settled now; gateway → the browser leaves for the bank page */
    async pay(invId: string, method: "wallet" | "gateway") {
      const r = await rpc<{ paid?: boolean; redirect?: string }>("billing.pay", invId, method, origin());
      if (r.redirect) await go(r.redirect);
    },
    async topup(amount: number) {
      const r = await rpc<{ redirect: string }>("billing.topup", amount, origin());
      await go(r.redirect);
    },
    markPaid: (id: string) => rpc("billing.markPaid", id),
    refund: (id: string) => rpc("billing.refund", id),
    createInvoice: (inv: { userId: string; due?: string; items: { desc: string; amount: number }[] }) => rpc("billing.createInvoice", inv),
    setOfficial: (id: string, info: { name: string; nationalId: string; economicCode: string; address: string; postalCode: string }) => rpc("billing.setOfficial", id, info),
  },
  tickets: {
    create: (t: { subject: string; dept: string; priority: string; service: string; message: string }) => rpc<string>("tickets.create", t),
    reply: (id: string, text: string, from: "user" | "staff" = "user") => rpc("tickets.reply", id, text, from),
    update: (id: string, patch: Partial<Ticket>) => rpc("tickets.update", id, patch),
  },
  contact: {
    send: (m: { name: string; email: string; dept: string; subject: string; message: string }) => rpc("contact.send", m),
  },
  account: {
    updateProfile: (p: { name?: string; email?: string; phone?: string; company?: string }) => rpc("account.updateProfile", p),
    changePassword: (cur: string, next: string) => rpc("account.changePassword", cur, next),
    setTwofa: (on: boolean, secret?: string, code?: string) => rpc("account.setTwofa", on, secret, code),
    /** POST /api/kyc (multipart) */
    async submitKyc(file: File) {
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) throw new Error("فقط تصویر JPG، PNG، WebP یا PDF.");
      if (file.size > 5 * 1024 * 1024) throw new Error("حجم فایل باید کمتر از ۵ مگابایت باشد.");
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/kyc", { method: "POST", body: fd, credentials: "same-origin" });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error || "بارگذاری ناموفق بود.");
      await refresh();
    },
    revokeSession: (id: string) => rpc("account.revokeSession", id),
    setNotif: (key: string, val: boolean) => rpc("account.setNotif", key, val),
    setAutoPay: (on: boolean) => rpc("account.setAutoPay", on),
    addKey: (k: { name: string; pub: string }) => rpc("account.addKey", k),
    removeKey: (id: string) => rpc("account.removeKey", id),
    createToken: (t: { name: string; scope: string; expires: string }) => rpc<string>("account.createToken", t),
    revokeToken: (id: string) => rpc("account.revokeToken", id),
    readAll: () => rpc("account.readAll"),
    readOne: (id: string) => rpc("account.readOne", id),
  },
  team: {
    invite: (email: string, role: "admin" | "tech" | "billing") => rpc("team.invite", email, role, origin()),
    cancelInvite: (id: string) => rpc("team.cancelInvite", id),
    accept: (token: string) => rpc<{ ownerId: string }>("team.accept", token),
    setRole: (memberId: string, role: "admin" | "tech" | "billing") => rpc("team.setRole", memberId, role),
    remove: (memberId: string) => rpc("team.remove", memberId),
    switchTo: (ownerId: string | null) => rpc("team.switch", ownerId),
    leave: (ownerId: string) => rpc("team.leave", ownerId),
  },
  paas: {
    createApp: (a: { name: string; stack: string; source: string; gitUrl?: string; gitBranch?: string; image?: string; uploadId?: string; rootDir?: string; buildCommand?: string; startCommand?: string; port: number; planId: string; instances?: number; diskGb?: number; env?: { key: string; value: string; secret: boolean }[] }) => rpc<string>("paas.createApp", a),
    deploy: (appId: string, o: { uploadId?: string; message?: string } = {}) => rpc<string>("paas.deploy", appId, o),
    rollback: (appId: string, depId: string) => rpc<string>("paas.rollback", appId, depId),
    createFromTemplate: (templateId: string, name: string, planId?: string) => rpc<{ appId: string; credentials: { label: string; value: string }[] }>("paas.createFromTemplate", templateId, name, planId),
    deployPreview: (appId: string, o: { branch?: string; uploadId?: string; message?: string }) => rpc<string>("paas.deployPreview", appId, o),
    promote: (appId: string, depId: string) => rpc<string>("paas.promote", appId, depId),
    removePreview: (appId: string) => rpc("paas.removePreview", appId),
    deployment: (depId: string) => rpc<{ status: string; log: string }>("paas.deployment", depId),
    logs: (appId: string, tail = 200) => rpc<string[]>("paas.logs", appId, tail),
    updateApp: (appId: string, patch: Record<string, string | number | boolean>) => rpc("paas.updateApp", appId, patch),
    setEnv: (appId: string, set: { key: string; value: string; secret: boolean }[], remove: string[]) => rpc("paas.setEnv", appId, set, remove),
    scale: (appId: string, s: { planId: string; instances: number; autoscale: boolean; maxInstances: number; diskGb: number; autoscaleCpu?: number }) => rpc("paas.scale", appId, s),
    power: (appId: string, action: "start" | "stop" | "restart") => rpc("paas.power", appId, action),
    deleteApp: (appId: string, confirm: string) => rpc("paas.deleteApp", appId, confirm),
    purgeCache: (appId: string) => rpc("paas.purgeCache", appId),
    regenHook: (appId: string) => rpc("paas.regenHook", appId),
    addDomain: (appId: string, host: string) => rpc<string>("paas.addDomain", appId, host),
    checkDomain: (id: string) => rpc("paas.checkDomain", id),
    removeDomain: (id: string) => rpc("paas.removeDomain", id),
    createDb: (d: { name: string; engine: string; version: string; planId: string; publicAccess: boolean; backups: boolean }) => rpc<string>("paas.createDb", d),
    dbCredentials: (dbId: string) => rpc<{ password: string; url: string; publicUrl: string }>("paas.dbCredentials", dbId),
    resetDbPassword: (dbId: string) => rpc("paas.resetDbPassword", dbId),
    updateDb: (dbId: string, patch: { planId?: string; publicAccess?: boolean; backups?: boolean; pitr?: boolean }) => rpc("paas.updateDb", dbId, patch),
    dbPower: (dbId: string, action: "start" | "stop") => rpc("paas.dbPower", dbId, action),
    deleteDb: (dbId: string, confirm: string) => rpc("paas.deleteDb", dbId, confirm),
    backupDb: (dbId: string) => rpc<string>("paas.backupDb", dbId),
    deleteBackup: (id: string) => rpc("paas.deleteBackup", id),
    restoreDb: (id: string) => rpc("paas.restoreDb", id),
    pitrRestore: (dbId: string, at: string, name: string) => rpc<string>("paas.pitrRestore", dbId, at, name),
    scanReport: (depId: string) => rpc<{ status: string; critical: number; high: number; report: string }>("paas.scanReport", depId),
    link: (appId: string, dbId: string, envKey?: string) => rpc("paas.link", appId, dbId, envKey),
    unlink: (appId: string, dbId: string) => rpc("paas.unlink", appId, dbId),
    setProcesses: (appId: string, list: { name: string; command: string; instances: number }[]) => rpc("paas.setProcesses", appId, list),
    saveCron: (appId: string, c: { id?: string; name: string; schedule: string; command: string; enabled: boolean }) => rpc("paas.saveCron", appId, c),
    deleteCron: (id: string) => rpc("paas.deleteCron", id),
    runJob: (appId: string, command: string) => rpc<string>("paas.runJob", appId, command),
    job: (id: string) => rpc<{ id: string; status: "running" | "succeeded" | "failed"; command: string; output: string }>("paas.job", id),
    adminPlan: (id: string, patch: { name?: string; price?: number; active?: boolean }) => rpc("paas.adminPlan", id, patch),
    adminSuspend: (kind: "app" | "db", id: string, on: boolean) => rpc("paas.adminSuspend", kind, id, on),
    adminTest: () => rpc<{ driver: string; version: string }>("paas.adminTest"),
    /** uploads a project ZIP; resolves with the detected stack */
    upload: async (file: File, rootDir = "", onProgress?: (pct: number) => void) => new Promise<{ uploadId: string; stack: string | null; files: number; bytes: number }>((resolve, reject) => {
      const x = new XMLHttpRequest();
      const form = new FormData();
      form.set("file", file);
      if (rootDir) form.set("rootDir", rootDir);
      x.open("POST", "/api/paas/upload");
      x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
      x.onload = () => {
        let j: { result?: { uploadId: string; stack: string | null; files: number; bytes: number }; error?: string } = {};
        try { j = JSON.parse(x.responseText); } catch { /* not JSON */ }
        if (x.status >= 200 && x.status < 300 && j.result) resolve(j.result);
        else reject(new Error(j.error || (x.status === 413 ? "حجم فایل زیاد است." : "بارگذاری ناموفق بود.")));
      };
      x.onerror = () => reject(new Error("ارتباط با سرور برقرار نشد."));
      x.send(form);
    }),
  },
  ai: {
    createKey: (k: AiKeyInput) => rpc<string>("ai.createKey", k),
    updateKey: (id: string, patch: Partial<Omit<AiKeyInput, "expiresDays">>) => rpc("ai.updateKey", id, patch),
    revokeKey: (id: string) => rpc("ai.revokeKey", id),
    playground: (model: string, messages: { role: "system" | "user" | "assistant"; content: string }[], maxTokens: number) => rpc<{ text: string; charged: number; inTokens: number; outTokens: number }>("ai.playground", model, messages, maxTokens),
    adminModel: (id: string, patch: Partial<{ name: string; vendor: string; upstream: string; inPrice: number; outPrice: number; refIn: number; refOut: number; context: number; active: boolean }>) => rpc("ai.adminModel", id, patch),
    adminAddModel: (m: { id: string; name: string; vendor: string; upstream: string; inPrice: number; outPrice: number; context: number }) => rpc("ai.adminAddModel", m),
    adminSync: () => rpc<{ total: number; added: number }>("ai.adminSync"),
    adminApplyRule: (discount: number) => rpc<number>("ai.adminApplyRule", discount),
    adminTest: (id: string) => rpc<{ ok: boolean; ms: number; detail: string }>("ai.adminTest", id),
  },
  notify: {
    botLink: (kind: "telegram" | "bale") => rpc<string>("notify.botLink", kind),
    addWebhook: (w: { url: string; label: string; events: string[] }) => rpc<string>("notify.addWebhook", w),
    updateChannel: (id: string, patch: { events?: string[]; active?: boolean; label?: string }) => rpc("notify.updateChannel", id, patch),
    removeChannel: (id: string) => rpc("notify.removeChannel", id),
    testChannel: (id: string) => rpc("notify.testChannel", id),
    adminBots: () => rpc<{ kind: string; ok: boolean; detail: string }[]>("notify.adminBots"),
  },
  wp: {
    create: (i: { name: string; plan: "eco" | "turbo"; uploadId?: string; keepUrl?: boolean }) => rpc<string>("wp.create", i),
    import: (appId: string, uploadId: string, keepUrl: boolean) => rpc<string>("wp.import", appId, uploadId, keepUrl),
    changePlan: (appId: string, plan: "eco" | "turbo") => rpc("wp.changePlan", appId, plan),
    /** streams a site backup (.tar.gz or .zip) to the server */
    upload: (file: File, onProgress?: (pct: number) => void) => new Promise<{ uploadId: string; bytes: number }>((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", "/api/wp/upload");
      x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
      x.onload = () => {
        let j: { result?: { uploadId: string; bytes: number }; error?: string } = {};
        try { j = JSON.parse(x.responseText); } catch { /* not JSON */ }
        if (x.status >= 200 && x.status < 300 && j.result) resolve(j.result); else reject(new Error(j.error || "بارگذاری ناموفق بود."));
      };
      x.onerror = () => reject(new Error("ارتباط با سرور قطع شد."));
      x.send(file);
    }),
  },
  inquiry: {
    activate: () => rpc("inquiry.activate"),
    reveal: () => rpc<string>("inquiry.reveal"),
    rotate: () => rpc("inquiry.rotate"),
    setIps: (ips: string[]) => rpc("inquiry.setIps", ips),
    requestAccess: (serviceId: string, useCase: string) => rpc("inquiry.requestAccess", serviceId, useCase),
    test: (serviceId: string, body: Record<string, string>, sandbox: boolean) => rpc<{ http: number; body: Record<string, unknown> }>("inquiry.test", serviceId, body, sandbox),
    adminService: (id: string, patch: { name?: string; price?: number; active?: boolean; approval?: boolean; upstream?: string }) => rpc("inquiry.adminService", id, patch),
    decide: (grantId: number, approve: boolean, note: string) => rpc("inquiry.decide", grantId, approve, note),
    adminAccount: (userId: string, status: "active" | "suspended") => rpc("inquiry.adminAccount", userId, status),
    adminProvider: () => rpc<{ provider: string }>("inquiry.adminProvider"),
  },
  geo: {
    create: (z: { domain: string; planId: string; iran: string; world: string }) => rpc<string>("geo.create", z),
    addRecord: (zoneId: string, r: GeoRecordInput) => rpc("geo.addRecord", zoneId, r),
    updateRecord: (zoneId: string, id: number, r: GeoRecordInput) => rpc("geo.updateRecord", zoneId, id, r),
    removeRecord: (zoneId: string, id: number) => rpc("geo.removeRecord", zoneId, id),
    checkNs: (zoneId: string) => rpc<{ ok: boolean; seen: string[] }>("geo.checkNs", zoneId),
    settings: (zoneId: string, patch: { autoRenew?: boolean; healthPath?: string }) => rpc("geo.settings", zoneId, patch),
    changePlan: (zoneId: string, planId: string) => rpc("geo.changePlan", zoneId, planId),
    remove: (zoneId: string, confirm: string) => rpc("geo.delete", zoneId, confirm),
    adminPlan: (id: string, patch: { name?: string; price?: number; records?: number; active?: boolean }) => rpc("geo.adminPlan", id, patch),
    adminZone: (id: string, patch: { status?: "pending" | "active" | "suspended"; syncStatus?: "none" | "setup" | "ok" | "lagging" | "failed"; extendDays?: number }) => rpc("geo.adminZone", id, patch),
    adminTest: () => rpc<{ driver: string; detail: string }>("geo.adminTest"),
  },
  devops: {
    request: (f: Record<string, unknown>) => rpc<{ ref: string }>("devops.request", f),
    updateLead: (id: string, patch: { status?: string; assignee?: string; value?: number }) => rpc("devops.updateLead", id, patch),
    noteLead: (id: string, text: string) => rpc("devops.noteLead", id, text),
    createProject: (p: { userId: string; leadId?: string; title: string; plan: string; services: string[]; monthlyFee: number; hoursIncluded: number; engineer: string; start: boolean }) => rpc<string>("devops.createProject", p),
    updateProject: (id: string, patch: { title?: string; status?: string; monthlyFee?: number; hoursIncluded?: number; hoursUsed?: number; engineer?: string }) => rpc("devops.updateProject", id, patch),
    setMilestones: (id: string, ms: { id?: string; title: string; due: string; done: boolean }[]) => rpc("devops.setMilestones", id, ms),
    postUpdate: (id: string, text: string) => rpc("devops.postUpdate", id, text),
    invoice: (id: string, item: { desc: string; amount: number }) => rpc<string>("devops.invoice", id, item),
  },
  blog: {
    save: (p: { id?: string; slug: string; title: string; excerpt: string; body: string; tags: string[]; status: "draft" | "published" }) => rpc<string>("blog.save", p),
    remove: (id: string) => rpc("blog.delete", id),
  },
  chat: {
    reply: (id: string, text: string) => rpc("chat.reply", id, text),
    read: (id: string) => rpc("chat.read", id),
    close: (id: string) => rpc("chat.close", id),
  },
  admin: {
    updateUser: (id: string, patch: { status?: string; kyc?: string }) => rpc("admin.updateUser", id, patch),
    impersonate: (id: string) => rpc("admin.impersonate", id),
    stopImpersonate: () => rpc("admin.stopImpersonate"),
    adjustBalance: (id: string, amount: number, reason: string) => rpc("admin.adjustBalance", id, amount, reason),
    createUser: (u: { name: string; email: string; phone: string }) => rpc("admin.createUser", u),
    updatePlan: (kind: "cloud" | "metal" | "hosting", id: string, patch: { name?: string; price?: number; popular?: boolean; active?: boolean }) => rpc("admin.updatePlan", kind, id, patch),
    updateTld: (tld: string, patch: { reg?: number; renew?: number; transfer?: number; promo?: boolean }) => rpc("admin.updateTld", tld, patch),
    toggleNode: (id: string) => rpc("admin.toggleNode", id),
    addNode: (n: { id: string; loc: string; model: string }) => rpc("admin.addNode", n),
    saveCoupon: (c: Partial<Coupon> & { code: string }) => rpc("admin.saveCoupon", c),
    deleteCoupon: (id: string) => rpc("admin.deleteCoupon", id),
    saveAnnouncement: (a: { title: string; body: string; level: "info" | "warning" | "critical" }) => rpc("admin.saveAnnouncement", a),
    deleteAnnouncement: (id: string) => rpc("admin.deleteAnnouncement", id),
    virtTest: (cfg: { host: string; port: number; key: string; pass?: string }) => rpc("admin.virtTest", cfg),
    virtSync: (kind: string) => rpc("admin.virtSync", kind),
    savePlanMap: (id: string, patch: { plid?: number; group?: string }) => rpc("admin.savePlanMap", id, patch),
    toggleTemplate: (osid: number) => rpc("admin.toggleTemplate", osid),
    saveVirt: (patch: Record<string, string | number | boolean>) => rpc("admin.saveVirt", patch),
    saveSettings: (patch: Partial<ClientDB["settings"]> & { smsKey?: string }) => rpc("admin.saveSettings", patch),
    addStaff: (s: { name: string; email: string; role: string }) => rpc("admin.addStaff", s),
    removeStaff: (id: string) => rpc("admin.removeStaff", id),
    saveIncident: (i: { id?: string; title: string; severity: string; status: string; components: string[]; text: string }) => rpc("admin.saveIncident", i),
    deleteIncident: (id: string) => rpc("admin.deleteIncident", id),
  },
};
