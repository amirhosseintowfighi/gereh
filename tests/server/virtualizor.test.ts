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
    reply = (u) => u.searchParams.get("act") === "servergroups" ? { servergroups: { 0: { sgid: "0", sg_name: "Default" }, 3: { sgid: "3", sg_name: "thr-cloud" } } }
      : { newvs: { vpsid: "4410", ips: ["185.1.2.3"], ipv6: ["2a01::1"], vncport: "5911", vncpass: "abc" } };
    const r = await v().create({ uid: 7, plid: 12, osid: 347, hostname: "web.example.com", rootpass: "x", serverGroup: "thr-cloud" });
    expect(r).toMatchObject({ vpsid: 4410, ip: "185.1.2.3", ipv6: "2a01::1", vncPort: 5911, vncPassword: "abc" });
    // the group name is resolved to its numeric sgid; virt defaults to kvm
    expect(Object.fromEntries(calls[1].body!)).toMatchObject({ addvps: "1", virt: "kvm", uid: "7", plid: "12", osid: "347", hostname: "web.example.com", node_select: "1", server_group: "3" });
    expect(calls[1].body!.has("space")).toBe(false);
  });

  it("creates without a plan from explicit resources and explains a missing group", async () => {
    reply = (u) => u.searchParams.get("act") === "servergroups" ? { servergroups: { 0: { sgid: "0", sg_name: "Default" } } } : { newvs: { vpsid: "9" } };
    await v().create({ uid: 7, plid: 0, osid: 347, hostname: "a.b.c", rootpass: "x", serverGroup: "Default", virt: "xen", space: 40, ram: 2048, cores: 1, bandwidth: 0 });
    expect(Object.fromEntries(calls[1].body!)).toMatchObject({ virt: "xen", server_group: "0", space: "40", ram: "2048", cores: "1", bandwidth: "0" });
    expect(calls[1].body!.has("plid")).toBe(false);
    await expect(v().create({ uid: 7, plid: 0, osid: 1, hostname: "a.b.c", rootpass: "x", serverGroup: "nope", space: 1, ram: 1, cores: 1 })).rejects.toThrow(/nope.*Default \(0\)/);
    await expect(v().create({ uid: 7, plid: 0, osid: 1, hostname: "a.b.c", rootpass: "x", serverGroup: "5" })).rejects.toThrow(/Plan ID/);
  });

  it("reads one VPS and finds one by hostname", async () => {
    reply = () => ({ vs: { 77: { vpsid: "77", hostname: "web.example.com", uid: "7", ips: { 1: "185.1.2.3", 2: "2a01::7" }, status: "1" } } });
    expect(await v().getVps(77)).toEqual({ vpsid: 77, hostname: "web.example.com", ip: "185.1.2.3", ipv6: "2a01::7", uid: 7, status: "running" });
    expect(await v().findVps("web.example.com", 8)).toBeNull();
    expect((await v().findVps("WEB.example.com", 7))?.vpsid).toBe(77);
    reply = () => ({ error: ["Invalid plan", { x: "No storage" }] });
    await expect(v().plans()).rejects.toThrow("Invalid plan، No storage");
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
    expect(await v().servers()).toEqual([{ serid: 1, name: "thr-hv-01", group: "thr-cloud", sgid: -1, cpu: 0, ram: 75, disk: 50, vms: 38 }]);
    expect(await v().osTemplates()).toEqual([{ osid: 347, name: "Ubuntu 24.04", distro: "ubuntu" }]);
    expect(await v().test()).toEqual({ version: "Virtualizor 3.1.2" });
  });

  it("refuses to start without credentials", () => {
    expect(() => new VirtualizorDriver({ host: "", key: "", pass: "" })).toThrow();
  });
});

describe("Virtualizor connection errors", () => {
  it("strips scheme, path and port from a pasted address", async () => {
    const { normalizeHost } = await import("@/server/virt/virtualizor");
    expect(normalizeHost("https://Panel.Example.com:4085/index.php?act=home")).toEqual({ host: "panel.example.com", port: 4085 });
    expect(normalizeHost(" 185.1.2.3 ")).toEqual({ host: "185.1.2.3", port: undefined });
    const d = new VirtualizorDriver({ host: "https://panel.example.com:4086/", key: "k", pass: "p" });
    expect(d.url(4086, "servers")).toMatch(/^https:\/\/panel\.example\.com:4086\/index\.php\?/);
  });

  it("explains the cause instead of a bare 'fetch failed'", async () => {
    const { explainFetchError } = await import("@/server/virt/virtualizor");
    const failed = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code, message: code } });
    expect(explainFetchError(failed("DEPTH_ZERO_SELF_SIGNED_CERT"), "h", 4085)).toContain("خودامضا");
    expect(explainFetchError(failed("ECONNREFUSED"), "h", 4085)).toContain("بسته");
    expect(explainFetchError(failed("UND_ERR_CONNECT_TIMEOUT"), "h", 4085)).toContain("فایروال");
    expect(explainFetchError(failed("ENOTFOUND"), "h", 4085)).toContain("DNS");
  });

  it("reports a refused connection with its cause", async () => {
    reply = () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED", message: "connect ECONNREFUSED" } }); };
    await expect(v().test()).rejects.toThrow(/پورت 4085 روی vz\.example\.com.*ECONNREFUSED/);
  });
});
