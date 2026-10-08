import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as SYNC } from "@/app/api/geo/sync/[zone]/route";
import { answerFor } from "@/lib/geo";
import { context } from "@/server/ctx";
import { geoZones, users } from "@/server/db/schema";
import { renderZone, SimGeo } from "@/server/geo/driver";
import { setNsResolver } from "@/server/geo/service";
import { buildState } from "@/server/state";
import { geoBilling, geoHealth, setGeoProbe } from "@/server/worker/geo";
import { drain } from "@/server/worker";
import { asUser, call, db, fails, fresh } from "./helpers";

beforeEach(async () => { await fresh(); SimGeo.zones.clear(); setNsResolver(async () => ["ns1.gereh.net", "ns2.gereh.net"]); });
const state = async () => { const c = await context(); return (await buildState(c.db, c.auth, "customer")).db.geo; };

describe("geo dns rendering", () => {
  it("splits by country, with health-checked failover when the plan has it", () => {
    const rec = { name: "www", type: "A" as const, iran: "185.1.1.1", world: "94.1.1.1", ttl: 60, priority: null };
    const [plain] = renderZone({ domain: "shop.ir", geo: true, failover: false, healthPath: "/", records: [rec] });
    expect(plain).toMatchObject({ name: "www.shop.ir.", type: "LUA" });
    expect(plain.records[0].content).toBe("A \";if country('IR') then return '185.1.1.1' else return '94.1.1.1' end\"");
    const [fo] = renderZone({ domain: "shop.ir", geo: true, failover: true, healthPath: "/health", records: [rec] });
    expect(fo.records[0].content).toContain("ifurlup('https://www.shop.ir/health', {{'185.1.1.1'}, {'94.1.1.1'}}");
    // suspended (geo off) and non-geo types are plain records
    const off = renderZone({ domain: "shop.ir", geo: false, failover: true, healthPath: "/", records: [rec, { name: "@", type: "MX", iran: "mail.shop.ir", world: "", ttl: 3600, priority: 10 }, { name: "@", type: "TXT", iran: "v=spf1 mx ~all", world: "", ttl: 3600, priority: null }] });
    expect(off.map((s) => [s.type, s.records[0].content])).toEqual([["A", "185.1.1.1"], ["MX", "10 mail.shop.ir."], ["TXT", "\"v=spf1 mx ~all\""]]);
  });
  it("the panel's test tool follows the same rule", () => {
    const r = { type: "A" as const, iran: "1.1.1.1", world: "2.2.2.2", iranUp: false, worldUp: true };
    expect(answerFor(r, "world", { geo: true, failover: true })).toBe("2.2.2.2");
    expect(answerFor(r, "iran", { geo: true, failover: true })).toBe("2.2.2.2");
    expect(answerFor(r, "iran", { geo: true, failover: false })).toBe("1.1.1.1");
    expect(answerFor(r, "world", { geo: false, failover: true })).toBe("1.1.1.1");
  });
});

describe("geo dns zones", () => {
  it("create charges the first month, publishes, then activates when NS point to us", async () => {
    await asUser();
    expect(await fails("geo.create", { domain: "bad domain", planId: "geo-basic", iran: "1.2.3.4", world: "5.6.7.8" })).toContain("دامنه");
    expect(await fails("geo.create", { domain: "site.ir", planId: "geo-basic", iran: "192.168.1.1", world: "5.6.7.8" })).toContain("خصوصی");
    const before = (await (await db()).select().from(users).where(eq(users.id, "u1")))[0].balance;
    const id = await call<string>("geo.create", { domain: "https://www.Site.ir/", planId: "geo-basic", iran: "185.1.1.1", world: "94.1.1.1" });
    expect((await (await db()).select().from(users).where(eq(users.id, "u1")))[0].balance).toBe(before - 490_000);
    expect(SimGeo.zones.get("site.ir")!.map((s) => s.name)).toEqual(["site.ir.", "www.site.ir."]);
    await drain(await db());
    const z = (await state()).zones.find((x) => x.id === id)!;
    expect(z).toMatchObject({ domain: "site.ir", status: "active", nsOk: true });
    expect(await fails("geo.create", { domain: "site.ir", planId: "geo-basic", iran: "185.1.1.1", world: "94.1.1.1" })).toContain("قبلاً");
  });

  it("records: validation, conflicts, plan limits", async () => {
    await asUser();
    const add = (r: Record<string, unknown>) => call("geo.addRecord", "geo-demo2", { ttl: 60, priority: null, world: "", ...r });
    expect(await fails("geo.addRecord", "geo-demo2", { name: "api", type: "A", iran: "999.1.1.1", world: "", ttl: 60, priority: null })).toContain("IPv4");
    expect(await fails("geo.addRecord", "geo-demo2", { name: "www", type: "CNAME", iran: "x.example.com", world: "", ttl: 60, priority: null })).toContain("CNAME");
    expect(await fails("geo.addRecord", "geo-demo2", { name: "@", type: "TXT", iran: "hello", world: "other", ttl: 60, priority: null })).toContain("یکسان");
    for (let i = 0; i < 8; i++) await add({ name: "s" + i, type: "A", iran: "185.1.1." + (i + 1) });
    expect(await fails("geo.addRecord", "geo-demo2", { name: "s9", type: "A", iran: "185.1.1.9", world: "", ttl: 60, priority: null })).toContain("سقف ۱۰ رکورد");
    await call("geo.changePlan", "geo-demo2", "geo-pro");
    await add({ name: "s9", type: "A", iran: "185.1.1.9" });
    expect((await state()).zones.find((x) => x.id === "geo-demo2")!.records).toHaveLength(11);
  });

  it("unpaid renewals switch the geo split off and a top-up brings it back", async () => {
    const d = await db();
    await d.update(geoZones).set({ paidUntil: new Date(Date.now() - 3600_000) }).where(eq(geoZones.id, "geo-demo1"));
    await d.update(users).set({ balance: 0 }).where(eq(users.id, "u1"));
    await geoBilling(d);
    expect((await d.select().from(geoZones).where(eq(geoZones.id, "geo-demo1")))[0].status).toBe("suspended");
    expect(SimGeo.zones.get("novinshop.ir")!.every((s) => s.type !== "LUA")).toBe(true);
    await d.update(users).set({ balance: 5_000_000 }).where(eq(users.id, "u1"));
    await geoBilling(d);
    const z = (await d.select().from(geoZones).where(eq(geoZones.id, "geo-demo1")))[0];
    expect(z.status).toBe("active");
    expect(z.paidUntil.getTime()).toBeGreaterThan(Date.now() + 25 * 86400_000);
    expect(SimGeo.zones.get("novinshop.ir")!.some((s) => s.type === "LUA")).toBe(true);
  });

  it("health checks record reachability; sync heartbeats need the zone token", async () => {
    setGeoProbe(async (host) => host !== "94.130.88.21");
    await geoHealth(await db());
    await asUser();
    const rec = (await state()).zones.find((x) => x.id === "geo-demo1")!.records.find((r) => r.name === "www")!;
    expect(rec).toMatchObject({ iranUp: true, worldUp: false });
    const send = (token: string, body: unknown) => SYNC(new Request("http://x/api/geo/sync/geo-demo1", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ zone: "geo-demo1" }) } as never);
    expect((await send("wrong-token-wrong-token-wrong", { ok: true })).status).toBe(401);
    expect(await (await send("demo-sync-token-novinshop-0000000000", { ok: true, lagSeconds: 1200 })).json()).toMatchObject({ status: "lagging" });
    expect((await state()).zones.find((x) => x.id === "geo-demo1")).toMatchObject({ syncStatus: "lagging", syncLagSec: 1200, syncToken: "" });
  });
});
