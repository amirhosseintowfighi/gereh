/* Virtualizor Admin API (:4085) and Enduser API (:4083, called with admin credentials + svs=vpsid).
   Act names and fields follow docs/VIRTUALIZOR.md. Items marked (verify) there must be checked
   against the installed version's SDK (/usr/local/virtualizor/sdk/*.php) before going live; the
   auth parameter style is configurable for that reason (VIRTUALIZOR_AUTH=adminapikey|apikey). */
import "server-only";
import { Agent, fetch } from "undici";
import type { CreateVps, PowerAction, VirtDriver, VpsLive } from "./driver";

type Dict = Record<string, string | number | boolean | (string | number)[] | undefined>;
export type VirtConfig = { host: string; key: string; pass: string; adminPort?: number; enduserPort?: number; tlsStrict?: boolean; auth?: "adminapikey" | "apikey" };

export class VirtualizorError extends Error {
  constructor(public act: string, public details: unknown) {
    super("Virtualizor " + act + ": " + (typeof details === "object" ? Object.values(details as Record<string, unknown>).join("، ") : String(details)));
  }
}

export class VirtualizorDriver implements VirtDriver {
  readonly name = "virtualizor" as const;
  private cfg: Required<VirtConfig>;
  private dispatcher: Agent;

  constructor(cfg?: Partial<VirtConfig>) {
    this.cfg = {
      host: cfg?.host ?? process.env.VIRTUALIZOR_HOST ?? "",
      key: cfg?.key ?? process.env.VIRTUALIZOR_KEY ?? "",
      pass: cfg?.pass ?? process.env.VIRTUALIZOR_PASS ?? "",
      adminPort: cfg?.adminPort ?? Number(process.env.VIRTUALIZOR_PORT || 4085),
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
    const res = await fetch(this.url(port, act, query), {
      method: body ? "POST" : "GET", body: form, signal: AbortSignal.timeout(60_000), dispatcher: this.dispatcher,
    });
    if (!res.ok) throw new VirtualizorError(act, "HTTP " + res.status);
    const json = (await res.json().catch(() => { throw new VirtualizorError(act, "invalid JSON (check API credentials and allowed IP list)"); })) as Record<string, unknown>;
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

  async create(p: CreateVps) {
    const j = await this.admin<{ newvs?: { vpsid?: number | string; ips?: string[]; ipv6?: string[]; vnc?: string; vncport?: number | string; vncpass?: string }; vs_info?: { vpsid?: number | string } }>("addvs", {}, {
      addvps: 1, uid: p.uid, plid: p.plid, osid: p.osid, hostname: p.hostname, rootpass: p.rootpass, server_group: p.serverGroup, num_ips: 1, num_ips6: 1,
      ...(p.sshKey ? { sshkey: p.sshKey } : {}), ...(p.cloudInit ? { cloud_init: p.cloudInit } : {}),
    });
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
      serid: Number(s.serid), name: s.server_name, group: s.sg_name || s.sgid || "",
      cpu: Math.round(Number(s.cpu_used ?? s.used_cpu ?? 0)), ram: Math.round(100 - (Number(s.ram) / Number(s.total_ram || 1)) * 100) || 0,
      disk: Math.round(100 - (Number(s.space) / Number(s.total_space || 1)) * 100) || 0, vms: Number(s.numvps ?? 0),
    }));
  }
  async osTemplates() {
    const j = await this.admin<{ ostemplates?: Record<string, { osid: string; name: string; distro: string }>; oslist?: Record<string, Record<string, { name: string; distro?: string }>> }>("ostemplates");
    if (j.ostemplates) return Object.values(j.ostemplates).map((o) => ({ osid: Number(o.osid), name: o.name, distro: o.distro }));
    return Object.values(j.oslist ?? {}).flatMap((group) => Object.entries(group).map(([osid, o]) => ({ osid: Number(osid), name: o.name, distro: o.distro ?? "" })));
  }
}
