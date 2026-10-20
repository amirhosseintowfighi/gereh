/* What the Gereh backend needs from the hypervisor layer. Two implementations:
   - VirtualizorDriver (./virtualizor.ts): the real Admin/Enduser API, used when VIRTUALIZOR_HOST,
     VIRTUALIZOR_KEY and VIRTUALIZOR_PASS are set.
   - SimulatorDriver: deterministic in-process stand-in for dev, CI and demos. */
import "server-only";
import { VirtualizorError } from "./virtualizor";

export type PowerAction = "start" | "stop" | "restart" | "poweroff";
/** plid 0 = no Virtualizor plan: the explicit resources are then required. serverGroup is a group name or its numeric id. */
export type CreateVps = {
  uid: number; plid: number; osid: number; hostname: string; rootpass: string; serverGroup: string; sshKey?: string; cloudInit?: string;
  /** "kvm", "xen", "openvz"…; "" = VIRTUALIZOR_VIRT or kvm */
  virt?: string;
  /** disk GB, RAM MB, vCPU cores, monthly traffic GB (0 = unlimited) */
  space?: number; ram?: number; cores?: number; bandwidth?: number;
  /** GB per disk, primary first (multi-disk create, sent instead of `space`); stUuid: the storage they go on */
  disks?: number[]; stUuid?: string;
  /** a specific Virtualizor server (serid) instead of the least-loaded one of serverGroup */
  node?: number;
  /** these IPv4 addresses instead of one from the pool */
  ips?: string[];
};
/** what the hypervisor knows about one VPS (manual delivery, double-create guard) */
export type VpsInfo = { vpsid: number; hostname: string; ip: string; ipv6: string; uid: number; status: "running" | "stopped" | "suspended" };
/** ws: websocket URL for noVNC ("" = no web console, e.g. the simulator) */
export type VncInfo = { host: string; port: number; password: string; ws: string };
export type PowerState = "running" | "stopped" | "suspended";
/** one VPS in a status answer. Only VPSs the hypervisor actually reported are returned: a VPS missing from the
    answer is unknown, never "stopped". cpu/ram/disk are %, net and I/O as Virtualizor reports them (verify units);
    usage false = the power state came from a fallback read that has no usage figures. */
export type VpsLive = { vpsid: number; status: PowerState; cpu: number; ram: number; disk: number; netIn: number; netOut: number; ioRead?: number; ioWrite?: number; bwUsed: number; bwLimit: number; usage?: boolean;
  /** usage only: `status` is a placeholder and must not be written anywhere */
  noPower?: boolean };
/** one point of a usage time series (ms since epoch) */
export type UsagePoint = { t: number; cpu: number; ram: number; disk: number; netIn: number; netOut: number; ioRead: number; ioWrite: number };
/** one entry of Virtualizor's own log or task list for a VPS */
export type VirtLogEntry = { id: string; at: Date; action: string; text: string; status: "done" | "running" | "failed"; progress: number };
export type VirtBackup = { id: string; date: string; file: string; sizeMb: number };
export type VirtProcess = { pid: number; user: string; cpu: number; mem: number; command: string };
export type VirtService = { name: string; running: boolean };
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
  /** the primary disk's storage (st_uuid), "" or absent = unknown */
  storage?: string;
  /** "unknown": no live power reading this round; the sync then leaves the site's state alone */
  status: PowerState | "unknown"; suspendReason: string;
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
  /** a VPS with this hostname (optionally owned by uid, never `exclude`), if one exists */
  findVps(hostname: string, uid?: number, exclude?: number): Promise<VpsInfo | null>;
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
  /** the live power state of one VPS (vs_status, else the enduser VPS info); null = no answer */
  powerState(vpsid: number): Promise<PowerState | null>;
  /** replaces the whole disk layout (GB per disk, primary first) through Edit VPS; returns each disk's slot. Disks
      may only grow or be added: Virtualizor refuses to shrink one ("You cannot shrink the disk space of a vps"), so
      such a layout is applied by recreating the VPS (./relayout.ts) */
  setDiskLayout(vpsid: number, sizes: number[]): Promise<number[]>;
  /** usage history since `since` (ms), oldest first */
  history(vpsid: number, since: number): Promise<UsagePoint[]>;
  /** Virtualizor's log and task entries for this VPS, newest first */
  logs(vpsid: number): Promise<VirtLogEntry[]>;
  backups(vpsid: number): Promise<VirtBackup[]>;
  createBackup(vpsid: number): Promise<void>;
  restoreBackup(vpsid: number, b: { date: string; file: string }): Promise<void>;
  processes(vpsid: number): Promise<VirtProcess[]>;
  killProcesses(vpsid: number, pids: number[]): Promise<void>;
  services(vpsid: number): Promise<VirtService[]>;
  serviceAction(vpsid: number, names: string[], action: "start" | "stop" | "restart"): Promise<void>;
  /** adds these public keys to the owner's Virtualizor key list and installs them on the VPS */
  applySshKeys(vpsid: number, keys: { name: string; publicKey: string }[]): Promise<void>;
}

/** the simulator's power state for a VPS it knows (a test may leave a VM "unknown"; it then runs) */
const live = (s: VpsDetail["status"] | undefined): PowerState => (!s || s === "unknown" ? "running" : s);
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
  /** tests: the node's IP pool is empty, so a create without explicit ips is refused */
  poolFull = false;
  /** an address that a VPS the simulator models still holds */
  private inUse(ip: string, except = 0) { return [...this.vms.values()].some((vm) => vm.vpsid !== except && !this.gone.has(vm.vpsid) && vm.ipv4.includes(ip)); }
  async create(p: CreateVps) {
    if (!p.plid && !((p.space || p.disks?.length) && p.ram && p.cores)) throw new Error("Virtualizor addvs: space, ram and cores are required without a plan");
    if (!p.ips?.length && this.poolFull) throw new VirtualizorError("addvs", "There are no free IPs in the IP pool of the server");
    for (const x of p.ips ?? []) if (this.inUse(x)) throw new VirtualizorError("addvs", "The IP " + x + " is already in use");
    const vpsid = ++this.seq + Math.floor(Math.random() * 100000);
    const o = (vpsid % 200) + 20;
    const ip = p.ips?.[0] ?? "185.143.233." + o, ipv6 = "2a01:4f8:c0c:" + vpsid.toString(16) + "::1";
    this.made.set(vpsid, { vpsid, hostname: p.hostname, ip, ipv6, uid: p.uid, status: "running", req: p });
    const disks = p.disks?.length ? p.disks : [p.space || 20];
    this.vms.set(vpsid, {
      vpsid, uid: p.uid, hostname: p.hostname, cores: p.cores || 1, ramMb: p.ram || 1024, disks: disks.map((sizeGb, i) => ({ slot: i, sizeGb, primary: i === 0 })),
      ipv4: p.ips?.length ? [...p.ips] : [ip], ipv6: [ipv6], bwLimit: p.bandwidth ?? 0, bwUsed: 0, osid: p.osid, osName: SIM_OS.find((x) => x[0] === p.osid)?.[1] ?? "", plid: p.plid,
      serverId: p.node ?? 1, serverName: p.node && p.node !== 1 ? "hv-" + p.node : "thr-hv-01", status: "running", suspendReason: "", netSpeed: 0, vnc: { port: 5900 + (vpsid % 1000), password: "" },
    });
    if (disks.length > 1) this.slots.set(vpsid, disks.length - 1);
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
    if (vm) return { vpsid, hostname: vm.hostname, ip: vm.ipv4[0] ?? "", ipv6: vm.ipv6[0] ?? "", uid: vm.uid, status: live(vm.status) };
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
  async findVps(hostname: string, uid?: number, exclude?: number) {
    const m = [...this.made.values()].find((x) => x.hostname === hostname && (uid === undefined || x.uid === uid) && x.vpsid !== exclude && !this.gone.has(x.vpsid));
    if (!m) return null;
    const { req: _r, ...info } = m;
    return info;
  }
  async buildDone() { return true; }
  /** smooth, deterministic-per-VPS waves so charts look like real load in demos (at time ms) */
  private sample(vpsid: number, ms: number): UsagePoint {
    const t = ms / 600_000;
    const w = (base: number, amp: number, k: number) => Math.max(0, Math.round((base + amp * Math.sin(t + vpsid * k) + (amp / 3) * Math.sin(t / 9 + k)) * 10) / 10);
    return { t: ms, cpu: Math.min(100, w(10 + (vpsid % 40), 8, 0.7)), ram: Math.min(100, w(30 + (vpsid % 50), 5, 1.3)), disk: 20 + (vpsid % 30), netIn: w(5 + (vpsid % 50), 4, 2.1), netOut: w(20 + (vpsid % 90), 15, 0.4),
      ioRead: w(200 + (vpsid % 300), 150, 1.7), ioWrite: w(120 + (vpsid % 200), 90, 0.9) };
  }
  /** tests: power actions take effect only after this many status reads (a booting VPS still reads "off") */
  powerLag = 0;
  /** tests: VPSs the status call leaves out of its answer */
  readonly silent = new Set<number>();
  private lagging = new Map<number, { target: PowerState; left: number }>();
  private settle(vpsid: number) {
    const p = this.lagging.get(vpsid), vm = this.vms.get(vpsid);
    if (!p || !vm) return;
    if (--p.left <= 0) { if (vm.status !== "suspended") vm.status = p.target; this.lagging.delete(vpsid); }
  }
  /** the last action on a VPS the simulator does not model (the demo seed's): it confirms that action only */
  private loose = new Map<number, PowerState>();
  async status(vpsids: number[]): Promise<VpsLive[]> {
    const now = Date.now();
    return vpsids.filter((id) => !this.silent.has(id) && !this.gone.has(id)).map((vpsid) => {
      this.settle(vpsid);
      const vm = this.vms.get(vpsid);
      const { t: _t, ...u } = this.sample(vpsid, now);
      // a VPS it does not model gets usage (demo charts) but no power reading, so the seed's state stays
      return { vpsid, status: live(vm?.status), ...(vm ? {} : { noPower: true }), ...u, bwUsed: vm ? vm.bwUsed : 400 + (vpsid % 900), bwLimit: vm ? vm.bwLimit : 2000, usage: true };
    });
  }
  async powerState(vpsid: number) {
    if (this.silent.has(vpsid) || this.gone.has(vpsid)) return null;
    this.settle(vpsid);
    const vm = this.vms.get(vpsid);
    return vm ? live(vm.status) : this.loose.get(vpsid) ?? null;
  }
  async power(vpsid: number, action: PowerAction) {
    const vm = this.vms.get(vpsid);
    const target: PowerState = action === "stop" || action === "poweroff" ? "stopped" : "running";
    if (!vm) { this.loose.set(vpsid, target); return; }
    if (vm.status === "suspended") return;
    if (this.powerLag > 0) this.lagging.set(vpsid, { target, left: this.powerLag });
    else vm.status = target;
  }
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
    for (const x of keep) if (this.inUse(x, vpsid)) throw new VirtualizorError("managevps", "The IP " + x + " is already in use");
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

  async setDiskLayout(vpsid: number, sizes: number[]) {
    const vm = this.vms.get(vpsid);
    // what the real Edit VPS answers to a smaller (or removed) disk
    if (vm && (sizes.length < vm.disks.length || vm.disks.some((d, i) => sizes[i] < d.sizeGb))) throw new VirtualizorError("managevps", "You cannot shrink the disk space of a vps");
    const slots = sizes.map((_, i) => i);
    if (vm) vm.disks = sizes.map((sizeGb, i) => ({ slot: i, sizeGb, primary: i === 0 }));
    this.slots.set(vpsid, sizes.length - 1);
    return slots;
  }
  async history(vpsid: number, since: number) {
    const now = Date.now(), span = now - since;
    const step = span > 2 * 86400_000 ? 3600_000 : 300_000;
    const out: UsagePoint[] = [];
    for (let t = Math.ceil(since / step) * step; t <= now; t += step) out.push(this.sample(vpsid, t));
    return out;
  }
  /** what the Virtualizor log would hold: tests and the demo read it back */
  readonly vlog = new Map<number, VirtLogEntry[]>();
  async logs(vpsid: number) {
    const own = this.vlog.get(vpsid) ?? [];
    const base = Date.now() - 3 * 86400_000;
    const seed: VirtLogEntry[] = [
      { id: "sim-" + vpsid + "-1", at: new Date(base), action: "addvs", text: "", status: "done", progress: 100 },
      { id: "sim-" + vpsid + "-2", at: new Date(base + 3600_000), action: "vps_start", text: "", status: "done", progress: 100 },
    ];
    return [...own, ...seed].sort((a, b) => b.at.getTime() - a.at.getTime());
  }
  private log(vpsid: number, action: string) {
    const list = this.vlog.get(vpsid) ?? [];
    list.unshift({ id: "sim-" + vpsid + "-" + Date.now() + "-" + list.length, at: new Date(), action, text: "", status: "done", progress: 100 });
    this.vlog.set(vpsid, list);
  }
  private bk = new Map<number, VirtBackup[]>();
  async backups(vpsid: number) { return [...(this.bk.get(vpsid) ?? [])]; }
  async createBackup(vpsid: number) {
    const list = this.bk.get(vpsid) ?? [];
    const d = new Date(), date = d.toISOString().slice(0, 10).replace(/-/g, "");
    const file = "backup-" + vpsid + "-" + d.getTime() + ".tar.gz";
    list.unshift({ id: date + "/" + file, date, file, sizeMb: 900 + (vpsid % 700) });
    this.bk.set(vpsid, list);
    this.log(vpsid, "backup");
  }
  async restoreBackup(vpsid: number, b: { date: string; file: string }) {
    if (!(this.bk.get(vpsid) ?? []).some((x) => x.date === b.date && x.file === b.file)) throw new Error("Virtualizor backups: backup not found");
    this.log(vpsid, "restore");
  }
  private killed = new Map<number, Set<number>>();
  async processes(vpsid: number) {
    const all: VirtProcess[] = [[1, "root", 0, 0.4, "/sbin/init"], [412, "root", 0.1, 0.9, "/usr/sbin/sshd -D"], [733, "www-data", 2.4, 3.1, "nginx: worker process"], [801, "mysql", 4.8, 12.6, "/usr/sbin/mysqld"], [1290, "root", 0.3, 1.2, "/usr/bin/dockerd"]]
      .map(([pid, user, cpu, mem, command]) => ({ pid: pid as number, user: user as string, cpu: cpu as number, mem: mem as number, command: command as string }));
    const k = this.killed.get(vpsid);
    return all.filter((p) => !k?.has(p.pid));
  }
  async killProcesses(vpsid: number, pids: number[]) {
    const k = this.killed.get(vpsid) ?? new Set<number>();
    pids.forEach((p) => k.add(p));
    this.killed.set(vpsid, k);
  }
  private svc = new Map<number, Map<string, boolean>>();
  async services(vpsid: number) {
    const m = this.svc.get(vpsid) ?? new Map([["sshd", true], ["nginx", true], ["mysqld", true], ["cron", true], ["postfix", false]]);
    this.svc.set(vpsid, m);
    return [...m].map(([name, running]) => ({ name, running }));
  }
  async serviceAction(vpsid: number, names: string[], action: "start" | "stop" | "restart") {
    await this.services(vpsid);
    const m = this.svc.get(vpsid)!;
    for (const n of names) { if (!m.has(n)) throw new Error("Virtualizor services: unknown service " + n); m.set(n, action !== "stop"); }
  }
  readonly keys = new Map<number, string[]>();
  async applySshKeys(vpsid: number, keys: { name: string; publicKey: string }[]) {
    this.keys.set(vpsid, [...new Set([...(this.keys.get(vpsid) ?? []), ...keys.map((k) => k.publicKey)])]);
  }
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
