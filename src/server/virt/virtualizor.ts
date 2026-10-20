/* Virtualizor Admin API (:4085) and Enduser API (:4083, called with admin credentials + svs=vpsid).
   Act names and fields follow docs/VIRTUALIZOR.md. Items marked (verify) there must be checked
   against the installed version's SDK (/usr/local/virtualizor/sdk/*.php) before going live; the
   auth parameter style is configurable for that reason (VIRTUALIZOR_AUTH=adminapikey|apikey). */
import "server-only";
import { Agent, fetch } from "undici";
import type { CreateVps, PowerAction, VirtDriver, VncInfo, VpsDetail, VpsInfo, VpsLive } from "./driver";

type Dict = Record<string, string | number | boolean | (string | number)[] | undefined>;
export type VirtConfig = { host: string; key: string; pass: string; adminPort?: number; enduserPort?: number; tlsStrict?: boolean; auth?: "adminapikey" | "apikey" };

/** accepts what admins paste ("https://panel.example.com:4085/index.php") and keeps the host name; a port in it is returned too */
export function normalizeHost(raw: string): { host: string; port?: number } {
  let h = raw.trim().replace(/^[a-z]+:\/\//i, "").replace(/[/?#].*$/, "").replace(/^.*@/, "");
  let port: number | undefined;
  const m = h.match(/^(\[[^\]]+\]|[^:]+):(\d{1,5})$/);
  if (m) { h = m[1]; port = Number(m[2]); }
  return { host: h.toLowerCase(), port };
}

const CERT_CODES = new Set(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_UNTRUSTED"]);
/** turns undici's bare "fetch failed" into the actual cause, with what to check (exported for tests) */
export function explainFetchError(e: unknown, host: string, port: number): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string; name?: string } };
  const code = err.cause?.code || (err.name === "TimeoutError" ? "TIMEOUT" : err.cause?.name) || "";
  const where = host + ":" + port;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `نام «${host}» پیدا نشد (DNS). در فیلد آدرس فقط نام یا IP سرور Master را بنویسید، بدون https:// و پورت.`;
  if (code === "ECONNREFUSED") return `پورت ${port} روی ${host} بسته است (${code}). سرویس Virtualizor یا فایروال Master را بررسی کنید.`;
  if (["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code))
    return `به ${where} نرسید (${code}). فایروال Master (و دیتاسنتر) باید پورت‌های ۴۰۸۵ و ۴۰۸۳ را برای IP سرور گره باز کند.`;
  if (CERT_CODES.has(code))
    return `گواهی SSL سرور Virtualizor معتبر نیست (${code}). Virtualizor به‌طور پیش‌فرض گواهی خودامضا دارد: گزینه «پذیرش گواهی خودامضا» را روشن کنید (یا VIRTUALIZOR_TLS_STRICT=0) یا روی Master گواهی معتبر نصب کنید.`;
  if (code === "ECONNRESET" || code === "EPROTO" || /wrong version number|packet length/i.test(err.cause?.message || ""))
    return `اتصال TLS به ${where} برقرار نشد (${code || "TLS"}). پورت Admin API معمولاً ۴۰۸۵ (https) است؛ ۴۰۸۲/۴۰۸۴ برای http هستند.`;
  return `${where}: ${[code, err.cause?.message || err.message].filter(Boolean).join(" — ")}`;
}

/** Virtualizor's `error` is a string, an array or a {code: message} map (sometimes nested); keeps every message */
const flatErrors = (d: unknown): string[] =>
  d && typeof d === "object" ? Object.values(d as Record<string, unknown>).flatMap(flatErrors) : d === undefined || d === null || d === "" ? [] : [String(d)];

const values = (x: unknown): unknown[] => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : x === undefined || x === null || x === "" ? [] : [x]);
const toGb = (size: unknown, unit: unknown) => {
  const n = Number(size) || 0, u = String(unit ?? "G").toUpperCase();
  return Math.round(u.startsWith("M") ? n / 1024 : u.startsWith("T") ? n * 1024 : n);
};
/** disks as a list or a map of {num|disk_num, size, size_unit, primary} (verify); primary first */
export function parseDisks(raw: unknown): VpsDetail["disks"] {
  const list = values(raw).filter((d): d is Record<string, unknown> => !!d && typeof d === "object").map((d, i) => {
    const slot = Number(d.num ?? d.disk_num ?? d.slot ?? i) || 0;
    return { slot, sizeGb: toGb(d.size ?? d.disk_size, d.size_unit), primary: Number(d.primary ?? (slot === 0 ? 1 : 0)) === 1 };
  }).filter((d) => d.sizeGb > 0);
  return list.sort((a, b) => Number(b.primary) - Number(a.primary) || a.slot - b.slot);
}
/** one act=vs entry (+ its vs_status) → VpsDetail; field names (verify) */
export function parseDetail(v: Record<string, unknown>, vpsid: number, disks: VpsDetail["disks"], live?: VpsLive): VpsDetail {
  const str = (k: string) => (v[k] === undefined || v[k] === null ? "" : String(v[k]));
  const num = (k: string) => Number(v[k] ?? 0) || 0;
  const ips = [...values(v.ips), ...values(v.ips6), ...values(v.ipv6)].map(String).map((x) => x.trim()).filter(Boolean);
  const suspended = num("suspended") === 1 || live?.status === "suspended";
  const st = Number(v.status ?? 1);
  return {
    vpsid, uid: num("uid"), hostname: str("hostname"),
    cores: num("cores") || num("cpu_cores"), ramMb: num("ram"),
    disks: disks.length ? disks : num("space") ? [{ slot: 0, sizeGb: Math.round(num("space")), primary: true }] : [],
    ipv4: [...new Set(ips.filter((x) => !x.includes(":")))], ipv6: [...new Set(ips.filter((x) => x.includes(":")))],
    bwLimit: Math.round(v.bandwidth !== undefined ? num("bandwidth") : live?.bwLimit ?? 0), bwUsed: live ? live.bwUsed : v.used_bandwidth !== undefined ? num("used_bandwidth") : -1,
    osid: num("osid"), osName: str("os_name"), plid: num("plid"), serverId: num("serid"), serverName: str("server_name"),
    status: suspended ? "suspended" : live ? live.status : st === 0 ? "stopped" : "running", suspendReason: suspended ? str("suspend_reason") : "",
    netSpeed: num("network_speed"),
    vnc: num("vncport") ? { port: num("vncport"), password: str("vnc_passwd") } : null,
  };
}

export class VirtualizorError extends Error {
  constructor(public act: string, public details: unknown) {
    super("Virtualizor " + act + ": " + flatErrors(details).join("، "));
  }
}

export class VirtualizorDriver implements VirtDriver {
  readonly name = "virtualizor" as const;
  private cfg: Required<VirtConfig>;
  private dispatcher: Agent;

  constructor(cfg?: Partial<VirtConfig>) {
    const n = normalizeHost(cfg?.host ?? process.env.VIRTUALIZOR_HOST ?? "");
    this.cfg = {
      host: n.host,
      key: cfg?.key ?? process.env.VIRTUALIZOR_KEY ?? "",
      pass: cfg?.pass ?? process.env.VIRTUALIZOR_PASS ?? "",
      adminPort: n.port ?? cfg?.adminPort ?? Number(process.env.VIRTUALIZOR_PORT || 4085),
      enduserPort: cfg?.enduserPort ?? Number(process.env.VIRTUALIZOR_ENDUSER_PORT || 4083),
      tlsStrict: cfg?.tlsStrict ?? process.env.VIRTUALIZOR_TLS_STRICT !== "0",
      auth: cfg?.auth ?? ((process.env.VIRTUALIZOR_AUTH as "adminapikey" | "apikey") || "adminapikey"),
    };
    if (!this.cfg.host || !this.cfg.key || !this.cfg.pass) throw new Error("Virtualizor host/key/pass are required");
    this.dispatcher = new Agent({ connect: { rejectUnauthorized: this.cfg.tlsStrict }, headersTimeout: 30_000, bodyTimeout: 60_000 });
  }

  /** builds the request URL (exported for tests) */
  url(port: number, act: string, query: Dict = {}) {
    const qs = new URLSearchParams({ act, api: "json" });
    if (this.cfg.auth === "adminapikey") { qs.set("adminapikey", this.cfg.key); qs.set("adminapipass", this.cfg.pass); }
    else { qs.set("apikey", this.cfg.key); qs.set("apipass", this.cfg.pass); }
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => qs.append(k + "[]", String(x)));
      else qs.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
    }
    return "https://" + this.cfg.host + ":" + port + "/index.php?" + qs;
  }

  private async call<T = Record<string, unknown>>(port: number, act: string, query: Dict = {}, body?: Dict): Promise<T> {
    const form = body ? new URLSearchParams(Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) : undefined;
    let res;
    try {
      res = await fetch(this.url(port, act, query), {
        method: body ? "POST" : "GET", body: form, signal: AbortSignal.timeout(45_000), dispatcher: this.dispatcher,
      });
    } catch (e) { throw new VirtualizorError(act, explainFetchError(e, this.cfg.host, port)); }
    if (!res.ok) throw new VirtualizorError(act, "HTTP " + res.status + (res.status === 403 || res.status === 401 ? " — IP سرور گره را در Allowed IP list کلید API اضافه کنید" : ""));
    const json = (await res.json().catch(() => { throw new VirtualizorError(act, "پاسخ JSON نبود: کلید و رمز Admin API، نوع احراز (VIRTUALIZOR_AUTH) و Allowed IP list را بررسی کنید"); })) as Record<string, unknown>;
    const err = json.error;
    if (err && (typeof err !== "object" || Object.keys(err as object).length)) throw new VirtualizorError(act, err);
    return json as T;
  }
  admin<T = Record<string, unknown>>(act: string, q?: Dict, b?: Dict) { return this.call<T>(this.cfg.adminPort, act, q, b); }
  enduser<T = Record<string, unknown>>(vpsid: number, act: string, q: Dict = {}, b?: Dict) { return this.call<T>(this.cfg.enduserPort, act, { ...q, svs: vpsid }, b); }

  async test() {
    const j = await this.admin<{ version?: string; servs?: object }>("servers");
    return { version: j.version ? "Virtualizor " + j.version : "Virtualizor" };
  }

  async ensureUser(email: string, password: string) {
    const found = await this.admin<{ users?: Record<string, { uid: string; email: string }> }>("users", { email });
    const hit = Object.values(found.users || {}).find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return Number(hit.uid);
    const j = await this.admin<{ done?: { uid?: number | string } | number; uid?: number | string }>("adduser", {}, { adduser: 1, priority: 0, newemail: email, newpass: password }); // (verify) field names
    const uid = typeof j.done === "object" ? j.done?.uid : j.uid;
    if (!uid) throw new VirtualizorError("adduser", "no uid in response");
    return Number(uid);
  }

  /** numeric sgid of a server group given by name (as synced and shown in the panel) or by id */
  async groupId(group: string): Promise<number> {
    const g = group.trim();
    if (/^\d+$/.test(g)) return Number(g);
    const list = await this.groups();
    const hit = list.find((x) => x.name.toLowerCase() === g.toLowerCase());
    // a single group (a fresh Virtualizor has only «Default», id 0) is the only place a VPS can go
    if (!hit && list.length === 1) return list[0].sgid;
    if (!hit) throw new VirtualizorError("addvs", `گروه سرور «${g}» در Virtualizor پیدا نشد؛ گروه‌های موجود: ${list.map((x) => x.name + " (" + x.sgid + ")").join("، ") || "هیچ"}. در «زیرساخت › موقعیت‌ها» نام یا شناسه درست Server Group را وارد کنید.`);
    return hit.sgid;
  }

  /* addvs: virt, a node (node_select=1 + server_group=<sgid>, i.e. the least-loaded server of the group), and
     either a plan (plid) or explicit space/ram/cores/bandwidth. Posted resources override the plan's. */
  async create(p: CreateVps) {
    if (!p.plid && !(p.space && p.ram && p.cores)) throw new VirtualizorError("addvs", "بدون Plan ID باید فضای دیسک، رم و تعداد هسته مشخص باشد");
    const sgid = await this.groupId(p.serverGroup);
    const virt = p.virt || process.env.VIRTUALIZOR_VIRT || "kvm";
    type AddVs = { newvs?: { vpsid?: number | string; ips?: string[]; ipv6?: string[]; vnc?: string; vncport?: number | string; vncpass?: string }; vs_info?: { vpsid?: number | string } };
    // IPv6 only where the server has an IPv6 pool: VIRTUALIZOR_IPV6=0 turns it off; without it, a node that
    // rejects the order for lack of IPv6 is retried once with none
    const ipv6 = process.env.VIRTUALIZOR_IPV6 === "0" ? 0 : 1;
    const order = (num_ips6: number) => this.admin<AddVs>("addvs", {}, {
      addvps: 1, virt, uid: p.uid, osid: p.osid, hostname: p.hostname, rootpass: p.rootpass,
      node_select: 1, server_group: sgid, num_ips: 1, num_ips6, vnc: 1,
      ...(p.plid ? { plid: p.plid } : {}),
      // space GB, ram MB, bandwidth GB/month (0 = unlimited) (verify: 3.x also accepts space[0][size])
      ...(p.space ? { space: p.space } : {}), ...(p.ram ? { ram: p.ram } : {}), ...(p.cores ? { cores: p.cores } : {}), ...(p.bandwidth !== undefined ? { bandwidth: p.bandwidth } : {}),
      ...(p.sshKey ? { sshkey: p.sshKey } : {}), ...(p.cloudInit ? { cloud_init: p.cloudInit } : {}),
    });
    let j: AddVs;
    try { j = await order(ipv6); }
    catch (e) {
      if (!ipv6 || !(e instanceof VirtualizorError) || !/ipv6/i.test(e.message)) throw e;
      j = await order(0);
    }
    const vs = j.newvs ?? j.vs_info ?? {};
    const vpsid = Number(vs.vpsid);
    if (!vpsid) throw new VirtualizorError("addvs", "no vpsid in response");
    const n = j.newvs ?? {};
    return { vpsid, ip: n.ips?.[0] ?? "", ipv6: n.ipv6?.[0] ?? "", vncHost: this.cfg.host, vncPort: Number(n.vncport ?? 0), vncPassword: n.vncpass ?? "" };
  }

  async buildDone(vpsid: number) {
    const [s] = await this.status([vpsid]);
    return !!s && s.status === "running";
  }

  async status(vpsids: number[]): Promise<VpsLive[]> {
    if (!vpsids.length) return [];
    const j = await this.admin<{ status?: Record<string, Record<string, unknown>> }>("vs", { vs_status: vpsids });
    return vpsids.map((vpsid) => {
      const s = j.status?.[vpsid] ?? {};
      const st = Number(s.status);
      const n = (k: string) => Number(s[k] ?? 0) || 0;
      return { vpsid, status: st === 1 ? "running" : st === 2 ? "suspended" : "stopped", cpu: n("used_cpu"), ram: n("used_ram"), disk: n("used_disk"), netIn: n("net_in"), netOut: n("net_out"), bwUsed: n("used_bandwidth"), bwLimit: n("bandwidth") };
    });
  }

  async power(vpsid: number, action: PowerAction) { await this.enduser(vpsid, action, { do: 1 }); }
  async hostname(vpsid: number, newhost: string) { await this.enduser(vpsid, "hostname", {}, { newhost, changehost: 1 }); }
  async rootPassword(vpsid: number, pass: string) { await this.enduser(vpsid, "changepassword", {}, { newpass: pass, conf: pass, changepass: 1 }); }
  async vncPassword(vpsid: number, pass: string) { await this.enduser(vpsid, "vncpass", {}, { newpass: pass, conf: pass, vncpass: 1 }); }
  async rescue(vpsid: number, on: boolean, pass?: string) {
    await this.enduser(vpsid, "rescue", { do: 1 }, on ? { enablerescue: 1, password: pass, conf_password: pass } : { disablerescue: 1 });
  }
  async reinstall(vpsid: number, osid: number, pass: string) { await this.enduser(vpsid, "ostemplate", {}, { newos: osid, newpass: pass, conf: pass, reinsos: 1 }); }
  async controlPanel(vpsid: number, panel: string) { await this.enduser(vpsid, "controlpanel", {}, { ins: panel }); }
  async manage(vpsid: number, c: { cores?: number; ram?: number; space?: number; boot?: string; iso?: string; bandwidth?: number }) {
    await this.admin("managevps", {}, { vpsid, editvps: 1, ...c });
  }
  async suspend(vpsid: number) { await this.admin("vs", { suspend: vpsid }); }
  async unsuspend(vpsid: number) { await this.admin("vs", { unsuspend: vpsid }); }
  async remove(vpsid: number) { await this.admin("vs", { delete: vpsid }); }

  async bandwidth(vpsid: number, month: string) {
    const j = await this.enduser<{ bandwidth?: { in?: Record<string, number>; out?: Record<string, number>; usage?: Record<string, number> } }>(vpsid, "bandwidth", { show: month });
    const bw = j.bandwidth ?? {};
    const days = Object.keys(bw.usage ?? bw.in ?? {}).map(Number).filter((d) => d >= 1 && d <= 31).sort((a, b) => a - b);
    return days.map((day) => ({ day, inMb: Number(bw.in?.[day] ?? 0), outMb: Number(bw.out?.[day] ?? 0) }));
  }
  async plans() {
    const j = await this.admin<{ plans?: Record<string, { plid: string; plan_name: string }> }>("plans");
    return Object.values(j.plans ?? {}).map((p) => ({ plid: Number(p.plid), name: p.plan_name }));
  }
  async servers() {
    const j = await this.admin<{ servs?: Record<string, Record<string, string>> }>("servers");
    return Object.values(j.servs ?? {}).map((s) => ({
      serid: Number(s.serid), name: s.server_name, group: s.sg_name || s.sgid || "", sgid: s.sgid === undefined || s.sgid === "" ? -1 : Number(s.sgid),
      cpu: Math.round(Number(s.cpu_used ?? s.used_cpu ?? 0)), ram: Math.round(100 - (Number(s.ram) / Number(s.total_ram || 1)) * 100) || 0,
      disk: Math.round(100 - (Number(s.space) / Number(s.total_space || 1)) * 100) || 0, vms: Number(s.numvps ?? 0),
    }));
  }
  /** act=servergroups (verify); falls back to the sgid/sg_name pairs of the server list */
  async groups() {
    const j = await this.admin<{ servergroups?: Record<string, { sgid?: string | number; sg_name?: string }> }>("servergroups").catch(() => ({ servergroups: undefined }));
    const out = new Map<number, string>();
    for (const [k, g] of Object.entries(j.servergroups ?? {})) out.set(Number(g.sgid ?? k), g.sg_name ?? String(g.sgid ?? k));
    if (!out.size) for (const s of await this.servers()) if (s.sgid >= 0) out.set(s.sgid, s.group);
    return [...out].map(([sgid, name]) => ({ sgid, name }));
  }
  private info(v: Record<string, unknown>, vpsid: number): VpsInfo {
    const ips = Object.values((v.ips as Record<string, string> | string[] | undefined) ?? {}).map(String);
    const st = Number(v.status ?? 1);
    return { vpsid, hostname: String(v.hostname ?? ""), ip: ips.find((x) => !x.includes(":")) ?? "", ipv6: ips.find((x) => x.includes(":")) ?? "", uid: Number(v.uid ?? 0),
      status: Number(v.suspended ?? 0) === 1 ? "suspended" : st === 0 ? "stopped" : "running" };
  }
  /** act=vs filtered by vpsid (verify) */
  async getVps(vpsid: number) {
    const j = await this.admin<{ vs?: Record<string, Record<string, unknown>> }>("vs", { vpsid });
    const v = j.vs?.[vpsid] ?? Object.values(j.vs ?? {}).find((x) => Number(x.vpsid) === vpsid);
    return v ? this.info(v, vpsid) : null;
  }
  /* The authoritative per-VPS read for the sync (./sync.ts): act=vs filtered by vpsid (verify) for the
     configuration, IPs and plan/node; one vs_status call per batch for the power state and this month's used
     bandwidth; disks from the listing or, when it has none, act=managevps read without editvps (verify).
     3.x responses vary, so every field is read defensively. */
  async details(vpsids: number[]) {
    const out = new Map<number, VpsDetail | null>();
    if (!vpsids.length) return out;
    const live = new Map((await this.status(vpsids).catch(() => [] as VpsLive[])).map((l) => [l.vpsid, l]));
    const one = async (vpsid: number) => {
      const j = await this.admin<{ vs?: Record<string, Record<string, unknown>> }>("vs", { vpsid });
      const list = Object.values(j.vs ?? {});
      const v = j.vs?.[vpsid] ?? list.find((x) => Number(x.vpsid) === vpsid);
      if (!v) {
        // an empty answer to the vpsid filter means it is gone; a list without it may be a filter this version
        // ignores (one page of all VPSs), which proves nothing
        if (!list.length) out.set(vpsid, null);
        return;
      }
      let disks = parseDisks(v.disks ?? v.disk);
      if (!disks.length) {
        const m = await this.admin<{ vps?: Record<string, unknown>; disks?: unknown }>("managevps", { vpsid }).catch(() => ({} as { vps?: Record<string, unknown>; disks?: unknown }));
        disks = parseDisks(m.vps?.disks ?? m.disks);
      }
      out.set(vpsid, parseDetail(v, vpsid, disks, live.get(vpsid)));
    };
    // a few at a time; a VPS whose call fails is simply not answered this round
    for (let i = 0; i < vpsids.length; i += 4) await Promise.all(vpsids.slice(i, i + 4).map((id) => one(id).catch(() => undefined)));
    return out;
  }
  /** act=vs filtered by vpshostname (verify); exact match only */
  async findVps(hostname: string, uid?: number) {
    const j = await this.admin<{ vs?: Record<string, Record<string, unknown>> }>("vs", { vpshostname: hostname });
    const v = Object.values(j.vs ?? {}).find((x) => String(x.hostname ?? "").toLowerCase() === hostname.toLowerCase() && (uid === undefined || Number(x.uid) === uid));
    return v ? this.info(v, Number(v.vpsid)) : null;
  }
  async osTemplates() {
    const j = await this.admin<{ ostemplates?: Record<string, { osid: string; name: string; distro: string }>; oslist?: Record<string, Record<string, { name: string; distro?: string }>> }>("ostemplates");
    if (j.ostemplates) return Object.values(j.ostemplates).map((o) => ({ osid: Number(o.osid), name: o.name, distro: o.distro }));
    return Object.values(j.oslist ?? {}).flatMap((group) => Object.entries(group).map(([osid, o]) => ({ osid: Number(osid), name: o.name, distro: o.distro ?? "" })));
  }

  /* ---- network, extra disks and the web console; fields marked (verify) as above ---- */
  async setIps(vpsid: number, keep: string[], count: number) {
    // managevps keeps the listed addresses and allocates the rest from the server's IP pool (verify)
    const j = await this.admin<{ vs_info?: { ips?: Record<string, string> | string[] } }>("managevps", {}, { vpsid, editvps: 1, num_ips: count, ...Object.fromEntries(keep.map((ip, i) => ["ips[" + i + "]", ip])) });
    const ips = j.vs_info?.ips;
    const list = Array.isArray(ips) ? ips : Object.values(ips ?? {});
    return list.length ? list.map(String) : keep;
  }
  async setPtr(vpsid: number, ip: string, host: string) { await this.enduser(vpsid, "rdns", {}, { ip, rdns: host, editrdns: 1 }); } // (verify)
  async networkReset(vpsid: number) { await this.admin("managevps", {}, { vpsid, editvps: 1, reset_network: 1 }); } // (verify)
  async addDisk(vpsid: number, sizeGb: number) {
    const j = await this.admin<{ disk?: { disk_num?: number | string } }>("managevps", {}, { vpsid, editvps: 1, add_disk: 1, disk_size: sizeGb }); // (verify)
    return Number(j.disk?.disk_num ?? 1) || 1;
  }
  async resizeDisk(vpsid: number, slot: number, sizeGb: number) { await this.admin("managevps", {}, { vpsid, editvps: 1, ["disk_size[" + slot + "]"]: sizeGb }); } // (verify)
  async detachDisk(vpsid: number, slot: number) { await this.admin("managevps", {}, { vpsid, editvps: 1, ["del_disk[" + slot + "]"]: 1 }); } // (verify)
  /** enduser act=vnc&novnc=1: host, port and password of the websockify proxy; VIRTUALIZOR_NOVNC_URL shapes the socket URL */
  async vnc(vpsid: number): Promise<VncInfo> {
    const j = await this.enduser<{ info?: { ip?: string; port?: number | string; password?: string } }>(vpsid, "vnc", { novnc: 1 });
    const i = j.info ?? {};
    const host = i.ip || this.cfg.host, port = Number(i.port ?? 0);
    const tpl = process.env.VIRTUALIZOR_NOVNC_URL || "wss://{host}:{port}/";
    return { host, port, password: i.password ?? "", ws: port ? tpl.replace("{host}", host).replace("{port}", String(port)) : "" };
  }
}
