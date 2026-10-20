/* What the Gereh backend needs from the hypervisor layer. Two implementations:
   - VirtualizorDriver (./virtualizor.ts): the real Admin/Enduser API, used when VIRTUALIZOR_HOST,
     VIRTUALIZOR_KEY and VIRTUALIZOR_PASS are set.
   - SimulatorDriver: deterministic in-process stand-in for dev, CI and demos. */
import "server-only";

export type PowerAction = "start" | "stop" | "restart" | "poweroff";
/** plid 0 = no Virtualizor plan: the explicit resources are then required. serverGroup is a group name or its numeric id. */
export type CreateVps = {
  uid: number; plid: number; osid: number; hostname: string; rootpass: string; serverGroup: string; sshKey?: string; cloudInit?: string;
  /** "kvm", "xen", "openvz"…; "" = VIRTUALIZOR_VIRT or kvm */
  virt?: string;
  /** disk GB, RAM MB, vCPU cores, monthly traffic GB (0 = unlimited) */
  space?: number; ram?: number; cores?: number; bandwidth?: number;
};
/** what the hypervisor knows about one VPS (manual delivery, double-create guard) */
export type VpsInfo = { vpsid: number; hostname: string; ip: string; ipv6: string; uid: number; status: "running" | "stopped" | "suspended" };
/** ws: websocket URL for noVNC ("" = no web console, e.g. the simulator) */
export type VncInfo = { host: string; port: number; password: string; ws: string };
export type VpsLive = { vpsid: number; status: "running" | "stopped" | "suspended"; cpu: number; ram: number; disk: number; netIn: number; netOut: number; bwUsed: number; bwLimit: number };
/** everything the hypervisor says about one VPS: what the site syncs into its own rows (./sync.ts) */
export type VpsDetail = {
  vpsid: number; uid: number; hostname: string;
  cores: number; ramMb: number;
  /** the primary disk first; sizes in GB */
  disks: { slot: number; sizeGb: number; primary: boolean }[];
  ipv4: string[]; ipv6: string[];
  /** GB per month, 0 = unlimited; used: GB this month, -1 = unknown */
  bwLimit: number; bwUsed: number;
  osid: number; osName: string; plid: number;
  /** the Virtualizor server (node) it runs on */
  serverId: number; serverName: string;
  status: "running" | "stopped" | "suspended"; suspendReason: string;
  /** KB/s, 0 = unlimited */
  netSpeed: number;
  vnc: { port: number; password: string } | null;
};

export interface VirtDriver {
  readonly name: "virtualizor" | "simulator";
  test(): Promise<{ version: string }>;
  ensureUser(email: string, password: string): Promise<number>;
  create(p: CreateVps): Promise<{ vpsid: number; ip: string; ipv6: string; vncHost: string; vncPort: number; vncPassword: string }>;
  buildDone(vpsid: number): Promise<boolean>;
  status(vpsids: number[]): Promise<VpsLive[]>;
  power(vpsid: number, action: PowerAction): Promise<void>;
  hostname(vpsid: number, hostname: string): Promise<void>;
  rootPassword(vpsid: number, pass: string): Promise<void>;
  vncPassword(vpsid: number, pass: string): Promise<void>;
  rescue(vpsid: number, on: boolean, pass?: string): Promise<void>;
  reinstall(vpsid: number, osid: number, pass: string): Promise<void>;
  controlPanel(vpsid: number, panel: string): Promise<void>;
  manage(vpsid: number, changes: { cores?: number; ram?: number; space?: number; boot?: string; iso?: string; bandwidth?: number }): Promise<void>;
  suspend(vpsid: number): Promise<void>;
  unsuspend(vpsid: number): Promise<void>;
  remove(vpsid: number): Promise<void>;
  bandwidth(vpsid: number, month: string): Promise<{ day: number; inMb: number; outMb: number }[]>;
  plans(): Promise<{ plid: number; name: string }[]>;
  /** group: the server group's name (for display); sgid: its numeric id (-1 = unknown) */
  servers(): Promise<{ serid: number; name: string; group: string; sgid: number; cpu: number; ram: number; disk: number; vms: number }[]>;
  /** server groups by id and name */
  groups(): Promise<{ sgid: number; name: string }[]>;
  getVps(vpsid: number): Promise<VpsInfo | null>;
  /** full details per VPS; a missing key = no answer (skip it), null = confirmed absent from the hypervisor */
  details(vpsids: number[]): Promise<Map<number, VpsDetail | null>>;
  /** a VPS with this hostname (optionally owned by uid), if one exists */
  findVps(hostname: string, uid?: number): Promise<VpsInfo | null>;
  osTemplates(): Promise<{ osid: number; name: string; distro: string }[]>;
  /** gives the VPS `count` IPv4 addresses in total, keeping `keep`; returns them all */
  setIps(vpsid: number, keep: string[], count: number): Promise<string[]>;
  setPtr(vpsid: number, ip: string, host: string): Promise<void>;
  networkReset(vpsid: number): Promise<void>;
  /** extra disks; returns the hypervisor slot */
  addDisk(vpsid: number, sizeGb: number): Promise<number>;
  resizeDisk(vpsid: number, slot: number, sizeGb: number): Promise<void>;
  detachDisk(vpsid: number, slot: number): Promise<void>;
  vnc(vpsid: number): Promise<VncInfo>;
}

const SIM_OS: [number, string, string][] = [[347, "Ubuntu 24.04", "ubuntu"], [342, "Ubuntu 22.04", "ubuntu"], [351, "Debian 12", "debian"], [338, "Debian 11", "debian"], [360, "AlmaLinux 9", "almalinux"], [362, "Rocky Linux 9", "rocky"],
  [370, "CentOS Stream 9", "centos"], [381, "Windows Server 2022", "windows"], [377, "Windows Server 2019", "windows"], [390, "FreeBSD 14", "freebsd"]];

export class SimulatorDriver implements VirtDriver {
  readonly name = "simulator" as const;
  private seq = 4000;
  /** VPSs created in this process (getVps/findVps) */
  readonly made = new Map<number, VpsInfo & { req: CreateVps }>();
  /** hypervisor-side state of the VPSs this simulator knows (created here or adopted by a test). details()
      answers only for these, so the demo seed's VPSs are left alone; tests edit them to mimic a manual change. */
  readonly vms = new Map<number, VpsDetail>();
  /** deleted in the hypervisor: details() answers null */
  readonly gone = new Set<number>();
  async test() { return { version: "Simulator" }; }
  async ensureUser() { return 1000 + Math.floor(Math.random() * 1000); }
  async create(p: CreateVps) {
    if (!p.plid && !(p.space && p.ram && p.cores)) throw new Error("Virtualizor addvs: space, ram and cores are required without a plan");
    const vpsid = ++this.seq + Math.floor(Math.random() * 100000);
    const o = (vpsid % 200) + 20;
    const ip = "185.143.233." + o, ipv6 = "2a01:4f8:c0c:" + vpsid.toString(16) + "::1";
    this.made.set(vpsid, { vpsid, hostname: p.hostname, ip, ipv6, uid: p.uid, status: "running", req: p });
    this.vms.set(vpsid, {
      vpsid, uid: p.uid, hostname: p.hostname, cores: p.cores || 1, ramMb: p.ram || 1024, disks: [{ slot: 0, sizeGb: p.space || 20, primary: true }],
      ipv4: [ip], ipv6: [ipv6], bwLimit: p.bandwidth ?? 0, bwUsed: 0, osid: p.osid, osName: SIM_OS.find((x) => x[0] === p.osid)?.[1] ?? "", plid: p.plid,
      serverId: 1, serverName: "thr-hv-01", status: "running", suspendReason: "", netSpeed: 0, vnc: { port: 5900 + (vpsid % 1000), password: "" },
    });
    return { vpsid, ip, ipv6, vncHost: "vnc-" + p.serverGroup.split("-")[0] + ".gereh.net", vncPort: 5900 + (vpsid % 1000), vncPassword: Math.random().toString(36).slice(2, 10) };
  }
  /** tests: a VPS that already exists in the hypervisor */
  adopt(d: Partial<VpsDetail> & { vpsid: number }) {
    const vm: VpsDetail = {
      uid: 0, hostname: "vps" + d.vpsid + ".gereh.net", cores: 1, ramMb: 1024, disks: [{ slot: 0, sizeGb: 20, primary: true }], ipv4: ["185.143.235." + ((d.vpsid % 200) + 20)], ipv6: [],
      bwLimit: 1000, bwUsed: 0, osid: 347, osName: "Ubuntu 24.04", plid: 0, serverId: 1, serverName: "thr-hv-01", status: "running", suspendReason: "", netSpeed: 0, vnc: null, ...d,
    };
    this.vms.set(d.vpsid, vm);
    this.gone.delete(d.vpsid);
    return vm;
  }
  /** tests: an edit made by hand in the Virtualizor panel */
  edit(vpsid: number, patch: Partial<VpsDetail>) { const vm = this.vms.get(vpsid); if (vm) Object.assign(vm, patch); }
  async getVps(vpsid: number): Promise<VpsInfo | null> {
    if (this.gone.has(vpsid)) return null;
    const vm = this.vms.get(vpsid);
    if (vm) return { vpsid, hostname: vm.hostname, ip: vm.ipv4[0] ?? "", ipv6: vm.ipv6[0] ?? "", uid: vm.uid, status: vm.status };
    return vpsid > 0 ? { vpsid, hostname: "vps" + vpsid + ".gereh.net", ip: "185.143.235." + ((vpsid % 200) + 20), ipv6: "", uid: 0, status: "running" } : null;
  }
  async details(vpsids: number[]) {
    const out = new Map<number, VpsDetail | null>();
    for (const id of vpsids) {
      if (this.gone.has(id)) out.set(id, null);
      else { const vm = this.vms.get(id); if (vm) out.set(id, structuredClone(vm)); }
    }
    return out;
  }
  async findVps(hostname: string, uid?: number) {
    const m = [...this.made.values()].find((x) => x.hostname === hostname && (uid === undefined || x.uid === uid) && !this.gone.has(x.vpsid));
    if (!m) return null;
    const { req: _r, ...info } = m;
    return info;
  }
  async buildDone() { return true; }
  async status(vpsids: number[]) {
    // smooth, deterministic-per-VPS waves so charts look like real load in demos
    const t = Date.now() / 600_000;
    const w = (vpsid: number, base: number, amp: number, k: number) => Math.max(0, Math.round((base + amp * Math.sin(t + vpsid * k)) * 10) / 10);
    return vpsids.map((vpsid) => {
      const vm = this.vms.get(vpsid);
      return { vpsid, status: vm?.status ?? ("running" as const), cpu: w(vpsid, 10 + (vpsid % 40), 8, 0.7), ram: w(vpsid, 30 + (vpsid % 50), 5, 1.3), disk: 20 + (vpsid % 30), netIn: w(vpsid, 5 + (vpsid % 50), 4, 2.1), netOut: w(vpsid, 20 + (vpsid % 90), 15, 0.4),
        bwUsed: vm ? vm.bwUsed : 400 + (vpsid % 900), bwLimit: vm ? vm.bwLimit : 2000 };
    });
  }
  async power(vpsid: number, action: PowerAction) { const vm = this.vms.get(vpsid); if (vm && vm.status !== "suspended") vm.status = action === "stop" || action === "poweroff" ? "stopped" : "running"; }
  async hostname(vpsid: number, hostname: string) { const vm = this.vms.get(vpsid); if (vm) vm.hostname = hostname; }
  async rootPassword() {}
  async vncPassword(vpsid: number, pass: string) { const vm = this.vms.get(vpsid); if (vm?.vnc) vm.vnc.password = pass; }
  async rescue() {}
  async reinstall(vpsid: number, osid: number) {
    const vm = this.vms.get(vpsid);
    if (vm) { vm.osid = osid; vm.osName = SIM_OS.find((x) => x[0] === osid)?.[1] ?? vm.osName; if (vm.status !== "suspended") vm.status = "running"; }
  }
  async controlPanel() {}
  async manage(vpsid: number, c: { cores?: number; ram?: number; space?: number; boot?: string; iso?: string; bandwidth?: number }) {
    const vm = this.vms.get(vpsid);
    if (!vm) return;
    if (c.cores) vm.cores = c.cores;
    if (c.ram) vm.ramMb = c.ram;
    if (c.space && vm.disks[0]) vm.disks[0].sizeGb = c.space;
    if (c.bandwidth !== undefined) vm.bwLimit = c.bandwidth;
  }
  async suspend(vpsid: number) { const vm = this.vms.get(vpsid); if (vm) vm.status = "suspended"; }
  async unsuspend(vpsid: number) { const vm = this.vms.get(vpsid); if (vm) { vm.status = "running"; vm.suspendReason = ""; } }
  async remove(vpsid: number) { if (this.vms.delete(vpsid) || this.made.has(vpsid)) this.gone.add(vpsid); }
  async bandwidth(vpsid: number) {
    return Array.from({ length: 30 }, (_, i) => ({ day: i + 1, inMb: 10_000 + ((vpsid * (i + 3)) % 30_000), outMb: 30_000 + ((vpsid * (i + 7)) % 80_000) }));
  }
  async plans() { return [10, 11, 12, 13, 14, 15, 16].map((plid, i) => ({ plid, name: "plan-" + (i + 1) })); }
  async servers() { return [{ serid: 1, name: "thr-hv-01", group: "thr-cloud", sgid: 1, cpu: 62, ram: 71, disk: 48, vms: 38 }]; }
  async groups() { return ["thr-cloud", "thr-metal", "isf-cloud", "fra-cloud", "fra-metal", "ams-cloud"].map((name, i) => ({ sgid: i + 1, name })); }
  // the same set the demo seed shows, so a demo sync keeps them
  async osTemplates() { return SIM_OS.map(([osid, name, distro]) => ({ osid, name, distro })); }
  private ipSeq = 0;
  async setIps(vpsid: number, keep: string[], count: number) {
    const out = keep.slice(0, count);
    while (out.length < count) out.push("185.143.234." + (((vpsid + ++this.ipSeq * 7) % 230) + 20));
    const vm = this.vms.get(vpsid);
    if (vm) vm.ipv4 = [...out];
    return out;
  }
  async setPtr() {}
  async networkReset() {}
  private slots = new Map<number, number>();
  async addDisk(vpsid: number, sizeGb = 10) {
    const vm = this.vms.get(vpsid);
    const n = Math.max(this.slots.get(vpsid) ?? 0, ...(vm?.disks.map((d) => d.slot) ?? [0])) + 1;
    this.slots.set(vpsid, n);
    vm?.disks.push({ slot: n, sizeGb, primary: false });
    return n;
  }
  async resizeDisk(vpsid: number, slot: number, sizeGb: number) { const d = this.vms.get(vpsid)?.disks.find((x) => x.slot === slot); if (d) d.sizeGb = sizeGb; }
  async detachDisk(vpsid: number, slot: number) { const vm = this.vms.get(vpsid); if (vm) vm.disks = vm.disks.filter((x) => x.slot !== slot); }
  async vnc(vpsid: number) { return { host: "vnc-sim.gereh.net", port: 5900 + (vpsid % 1000), password: "sim" + (vpsid % 10000), ws: "" }; }
}

const g = globalThis as typeof globalThis & { __gerehVirt?: VirtDriver; __gerehVirtPinned?: boolean };
/** the configured driver: env credentials, else the encrypted ones saved in the admin panel, else the simulator */
/** VIRTUALIZOR_HOST/KEY/PASS in .env take precedence over the panel's connection form */
export const virtFromEnv = () => !!(process.env.VIRTUALIZOR_HOST && process.env.VIRTUALIZOR_KEY && process.env.VIRTUALIZOR_PASS);
export async function virt(): Promise<VirtDriver> {
  if (g.__gerehVirt) return g.__gerehVirt;
  const { VirtualizorDriver } = await import("./virtualizor");
  if (virtFromEnv()) return (g.__gerehVirt = new VirtualizorDriver());
  if (process.env.NODE_ENV === "production" || process.env.VIRTUALIZOR_LIVE === "1") {
    const [{ getDb }, { getVirt }, { open }] = await Promise.all([import("../db/client"), import("../state"), import("../secrets")]);
    const v = await getVirt(await getDb());
    const pass = open(String(v.passEnc || ""));
    if (v.host && v.key && pass) return (g.__gerehVirt = new VirtualizorDriver({ host: String(v.host), adminPort: Number(v.port) || 4085, key: String(v.key), pass, ...(v.insecure ? { tlsStrict: false } : {}) }));
  }
  return (g.__gerehVirt = new SimulatorDriver());
}
/** drop the cached driver after the admin saves new credentials (an injected test driver stays) */
export const resetVirt = () => { if (!g.__gerehVirtPinned) g.__gerehVirt = undefined; };
/** tests: inject a driver */
export const setVirt = (d: VirtDriver | undefined) => { g.__gerehVirt = d; g.__gerehVirtPinned = !!d; };
export { VirtualizorDriver } from "./virtualizor";
