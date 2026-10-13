/* What the Gereh backend needs from the hypervisor layer. Two implementations:
   - VirtualizorDriver (./virtualizor.ts): the real Admin/Enduser API, used when VIRTUALIZOR_HOST,
     VIRTUALIZOR_KEY and VIRTUALIZOR_PASS are set.
   - SimulatorDriver: deterministic in-process stand-in for dev, CI and demos. */
import "server-only";

export type PowerAction = "start" | "stop" | "restart" | "poweroff";
export type CreateVps = { uid: number; plid: number; osid: number; hostname: string; rootpass: string; serverGroup: string; sshKey?: string; cloudInit?: string };
/** ws: websocket URL for noVNC ("" = no web console, e.g. the simulator) */
export type VncInfo = { host: string; port: number; password: string; ws: string };
export type VpsLive = { vpsid: number; status: "running" | "stopped" | "suspended"; cpu: number; ram: number; disk: number; netIn: number; netOut: number; bwUsed: number; bwLimit: number };

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
  servers(): Promise<{ serid: number; name: string; group: string; cpu: number; ram: number; disk: number; vms: number }[]>;
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

export class SimulatorDriver implements VirtDriver {
  readonly name = "simulator" as const;
  private seq = 4000;
  async test() { return { version: "Simulator" }; }
  async ensureUser() { return 1000 + Math.floor(Math.random() * 1000); }
  async create(p: CreateVps) {
    const vpsid = ++this.seq + Math.floor(Math.random() * 100000);
    const o = (vpsid % 200) + 20;
    return { vpsid, ip: "185.143.233." + o, ipv6: "2a01:4f8:c0c:" + vpsid.toString(16) + "::1", vncHost: "vnc-" + p.serverGroup.split("-")[0] + ".gereh.net", vncPort: 5900 + (vpsid % 1000), vncPassword: Math.random().toString(36).slice(2, 10) };
  }
  async buildDone() { return true; }
  async status(vpsids: number[]) {
    // smooth, deterministic-per-VPS waves so charts look like real load in demos
    const t = Date.now() / 600_000;
    const w = (vpsid: number, base: number, amp: number, k: number) => Math.max(0, Math.round((base + amp * Math.sin(t + vpsid * k)) * 10) / 10);
    return vpsids.map((vpsid) => ({ vpsid, status: "running" as const, cpu: w(vpsid, 10 + (vpsid % 40), 8, 0.7), ram: w(vpsid, 30 + (vpsid % 50), 5, 1.3), disk: 20 + (vpsid % 30), netIn: w(vpsid, 5 + (vpsid % 50), 4, 2.1), netOut: w(vpsid, 20 + (vpsid % 90), 15, 0.4), bwUsed: 400 + (vpsid % 900), bwLimit: 2000 }));
  }
  async power() {}
  async hostname() {}
  async rootPassword() {}
  async vncPassword() {}
  async rescue() {}
  async reinstall() {}
  async controlPanel() {}
  async manage() {}
  async suspend() {}
  async unsuspend() {}
  async remove() {}
  async bandwidth(vpsid: number) {
    return Array.from({ length: 30 }, (_, i) => ({ day: i + 1, inMb: 10_000 + ((vpsid * (i + 3)) % 30_000), outMb: 30_000 + ((vpsid * (i + 7)) % 80_000) }));
  }
  async plans() { return [10, 11, 12, 13, 14, 15, 16].map((plid, i) => ({ plid, name: "plan-" + (i + 1) })); }
  async servers() { return [{ serid: 1, name: "thr-hv-01", group: "thr-cloud", cpu: 62, ram: 71, disk: 48, vms: 38 }]; }
  async osTemplates() { return [{ osid: 347, name: "Ubuntu 24.04", distro: "ubuntu" }, { osid: 351, name: "Debian 12", distro: "debian" }, { osid: 901, name: "Windows Server 2022", distro: "windows" }]; }
  private ipSeq = 0;
  async setIps(vpsid: number, keep: string[], count: number) {
    const out = keep.slice(0, count);
    while (out.length < count) out.push("185.143.234." + (((vpsid + ++this.ipSeq * 7) % 230) + 20));
    return out;
  }
  async setPtr() {}
  async networkReset() {}
  private slots = new Map<number, number>();
  async addDisk(vpsid: number) { const n = (this.slots.get(vpsid) ?? 0) + 1; this.slots.set(vpsid, n); return n; }
  async resizeDisk() {}
  async detachDisk() {}
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
