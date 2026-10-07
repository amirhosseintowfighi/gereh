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
  notifPrefs: {}, twofa: false, inbox: [], notifications: [], activity: [], nodes: [], coupons: [], announcements: [], audit: [], staff: [],
  settings: { siteName: "گره", supportEmail: "", supportPhone: "", registration: true, maintenance: false, tax: 10, gateways: {}, smsProvider: "", smsKeySet: false, smtpHost: "", smtpPort: 587, affiliateRate: 10, payGateway: "",
    legalName: "", sellerNationalId: "", sellerEconomicCode: "", sellerAddress: "", sellerPostalCode: "" },
  plans: { cloud: VPS.cloud, metal: VPS.metal, hosting: HOSTING.linux.concat(HOSTING.wordpress) },
  tlds: TLDS, virt: {}, virtLog: [], planMap: [], osTemplates: [], isos: [], affiliate: { code: "", referred: 0, earned: 0 }, incidents: [], chats: [], posts: [],
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

const READ_ONLY = new Set(["billing.quote", "domains.check", "hosting.sso"]);
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
