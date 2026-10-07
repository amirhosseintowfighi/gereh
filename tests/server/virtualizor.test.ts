import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { url: URL; method: string; body: URLSearchParams | null }[] = [];
let reply: (url: URL) => unknown = () => ({});
vi.mock("undici", () => ({
  Agent: class { constructor(public opts: unknown) {} },
  fetch: async (url: string, init: { method: string; body?: URLSearchParams }) => {
    const u = new URL(url);
    calls.push({ url: u, method: init.method, body: init.body ?? null });
    const r = reply(u);
    return { ok: true, status: 200, json: async () => r };
  },
}));
const { VirtualizorDriver, VirtualizorError } = await import("@/server/virt/virtualizor");

const v = () => new VirtualizorDriver({ host: "vz.example.com", key: "KEY", pass: "PASS" });
beforeEach(() => { calls.length = 0; reply = () => ({}); });

describe("Virtualizor client", () => {
  it("signs admin calls on :4085 and enduser calls on :4083 with svs", async () => {
    await v().power(3301, "restart");
    await v().suspend(3301);
    expect(calls[0].url.port).toBe("4083");
    expect(Object.fromEntries(calls[0].url.searchParams)).toMatchObject({ act: "restart", api: "json", adminapikey: "KEY", adminapipass: "PASS", svs: "3301", do: "1" });
    expect(calls[1].url.port).toBe("4085");
    expect(Object.fromEntries(calls[1].url.searchParams)).toMatchObject({ act: "vs", suspend: "3301" });
  });

  it("supports the apikey/apipass style", () => {
    const u = new URL(new VirtualizorDriver({ host: "h", key: "K", pass: "P", auth: "apikey" }).url(4085, "servers"));
    expect(u.searchParams.get("apikey")).toBe("K");
    expect(u.searchParams.has("adminapikey")).toBe(false);
  });

  it("encodes arrays as name[] and posts forms", async () => {
    reply = () => ({ status: { 3301: { status: 1, used_cpu: "12.5", used_ram: 40, used_bandwidth: 900, bandwidth: 2000 }, 3302: { status: 2 } } });
    const s = await v().status([3301, 3302]);
    expect(calls[0].url.searchParams.getAll("vs_status[]")).toEqual(["3301", "3302"]);
    expect(s).toEqual([
      { vpsid: 3301, status: "running", cpu: 12.5, ram: 40, disk: 0, netIn: 0, netOut: 0, bwUsed: 900, bwLimit: 2000 },
      { vpsid: 3302, status: "suspended", cpu: 0, ram: 0, disk: 0, netIn: 0, netOut: 0, bwUsed: 0, bwLimit: 0 },
    ]);
    await v().rescue(3301, true, "secret1");
    expect(calls[1].method).toBe("POST");
    expect(Object.fromEntries(calls[1].body!)).toEqual({ enablerescue: "1", password: "secret1", conf_password: "secret1" });
  });

  it("creates a VPS and reads vpsid + network info", async () => {
    reply = () => ({ newvs: { vpsid: "4410", ips: ["185.1.2.3"], ipv6: ["2a01::1"], vncport: "5911", vncpass: "abc" } });
    const r = await v().create({ uid: 7, plid: 12, osid: 347, hostname: "web.example.com", rootpass: "x", serverGroup: "thr-cloud" });
    expect(r).toMatchObject({ vpsid: 4410, ip: "185.1.2.3", ipv6: "2a01::1", vncPort: 5911, vncPassword: "abc" });
    expect(Object.fromEntries(calls[0].body!)).toMatchObject({ addvps: "1", uid: "7", plid: "12", osid: "347", hostname: "web.example.com" });
  });

  it("turns API errors into VirtualizorError", async () => {
    reply = () => ({ error: { bad_plid: "Invalid plan" } });
    await expect(v().plans()).rejects.toBeInstanceOf(VirtualizorError);
    await expect(v().plans()).rejects.toThrow("Invalid plan");
    reply = () => ({ error: [] });
    await expect(v().plans()).resolves.toEqual([]);
  });

  it("parses bandwidth, plans, servers and templates", async () => {
    reply = (u) => ({
      bandwidth: { bandwidth: { usage: { 1: 10, 2: 20 }, in: { 1: 4, 2: 5 }, out: { 1: 6, 2: 15 } } },
      plans: { plans: { 10: { plid: "10", plan_name: "c1" } } },
      servers: { version: "3.1.2", servs: { 1: { serid: "1", server_name: "thr-hv-01", sg_name: "thr-cloud", ram: "256", total_ram: "1024", space: "500", total_space: "1000", numvps: "38" } } },
      ostemplates: { oslist: { kvm: { 347: { name: "Ubuntu 24.04", distro: "ubuntu" } } } },
    } as Record<string, unknown>)[u.searchParams.get("act")!];
    expect(await v().bandwidth(1, "202510")).toEqual([{ day: 1, inMb: 4, outMb: 6 }, { day: 2, inMb: 5, outMb: 15 }]);
    expect(await v().plans()).toEqual([{ plid: 10, name: "c1" }]);
    expect(await v().servers()).toEqual([{ serid: 1, name: "thr-hv-01", group: "thr-cloud", cpu: 0, ram: 75, disk: 50, vms: 38 }]);
    expect(await v().osTemplates()).toEqual([{ osid: 347, name: "Ubuntu 24.04", distro: "ubuntu" }]);
    expect(await v().test()).toEqual({ version: "Virtualizor 3.1.2" });
  });

  it("refuses to start without credentials", () => {
    expect(() => new VirtualizorDriver({ host: "", key: "", pass: "" })).toThrow();
  });
});
