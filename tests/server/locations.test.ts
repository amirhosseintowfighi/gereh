import { beforeEach, describe, expect, it } from "vitest";
import { catalog } from "@/server/rpc/billing";
import { getLocations, locationGroup } from "@/server/locations";
import { LOCS, locLabel, priceSku } from "@/lib/catalog";
import { asAdmin, asUser, call, db, fails, fresh } from "./helpers";

beforeEach(fresh);

const ist = { id: "ist", label: "استانبول", sub: "ترکیه", ping: 40, up: 99.9, speed: 800, metal: false, foreign: true, active: true, groupCloud: "ist-cloud", groupMetal: "", isNew: true };

describe("datacenter locations", () => {
  it("adds a location, links it to a Virtualizor group and uses it for pricing and provisioning", async () => {
    await asAdmin();
    await call("admin.saveLocation", ist);
    const list = await getLocations(await db());
    expect(list.find((l) => l.id === "ist")?.groupCloud).toBe("ist-cloud");
    expect(locLabel("ist")).toBe("استانبول");
    expect(locationGroup(list.find((l) => l.id === "ist"), "cloud")).toBe("ist-cloud");
    const cat = await catalog(await db());
    const p = priceSku({ t: "plan", kind: "cloud", plan: cat.plans.cloud[0].id, loc: "ist", cycle: "m" }, cat);
    expect("error" in p).toBe(false);
    expect(await fails("admin.saveLocation", ist)).toContain("وجود دارد");
  });

  it("a disabled location keeps its label but takes no new orders", async () => {
    await asAdmin();
    await call("admin.saveLocation", { ...ist, active: false });
    const cat = await catalog(await db());
    const p = priceSku({ t: "plan", kind: "cloud", plan: cat.plans.cloud[0].id, loc: "ist", cycle: "m" }, cat);
    expect("error" in p && p.error).toContain("در دسترس نیست");
    expect(LOCS.some((l) => l.id === "ist")).toBe(true);
  });

  it("deletes only empty locations; nodes can be moved and removed", async () => {
    await asAdmin();
    await call("admin.saveLocation", ist);
    await call("admin.addNode", { id: "ist-hv-01", loc: "ist", model: "EPYC" });
    expect(await fails("admin.deleteLocation", "ist")).toContain("نود");
    await call("admin.updateNode", "ist-hv-01", { loc: "thr" });
    await call("admin.deleteNode", "ist-hv-01");
    await call("admin.deleteLocation", "ist");
    expect((await getLocations(await db())).some((l) => l.id === "ist")).toBe(false);
    // a location with customer servers must be disabled instead
    expect(await fails("admin.deleteLocation", "thr")).toContain("غیرفعال");
  });

  it("requires a cloud server group and blocks customers", async () => {
    await asAdmin();
    expect(await fails("admin.saveLocation", { ...ist, groupCloud: "" })).toContain("Server Group");
    expect(await fails("admin.saveLocation", { ...ist, id: "X!" })).toContain("شناسه");
    await asUser();
    await expect(call("admin.saveLocation", ist)).rejects.toThrow();
  });
});
