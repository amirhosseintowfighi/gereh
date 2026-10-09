import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { VPS, type Plan } from "@/lib/catalog";
import { geoPlans, inquiryServices, kv, plans } from "@/server/db/schema";
import { upgrade } from "@/server/seed";
import { db, fresh } from "./helpers";

beforeEach(fresh);

describe("boot upgrade on an existing database", () => {
  it("adds catalog rows from later releases and reprices cloud plans once", async () => {
    const d = await db();
    // a database from before this release: no inquiry/geo catalog, old cloud prices, a plan switched off
    await d.delete(inquiryServices);
    await d.delete(geoPlans);
    await d.delete(kv).where(eq(kv.key, "pricing"));
    await d.update(plans).set({ data: { ...VPS.cloud[0], price: 390000, active: false } }).where(eq(plans.id, "c1"));
    await d.update(plans).set({ data: { ...VPS.cloud[1], price: 690000 } }).where(eq(plans.id, "c2"));

    await upgrade(d);
    expect((await d.select().from(inquiryServices)).length).toBeGreaterThan(10);
    expect((await d.select().from(geoPlans)).length).toBe(3);
    const row = async (id: string) => (await d.select().from(plans).where(eq(plans.id, id)))[0].data as Plan;
    expect(await row("c1")).toMatchObject({ price: VPS.cloud[0].price, active: false });
    expect((await row("c2")).price).toBe(VPS.cloud[1].price);

    // later admin edits survive the next boot
    await d.update(plans).set({ data: { ...VPS.cloud[1], price: 5000000 } }).where(eq(plans.id, "c2"));
    await upgrade(d);
    expect((await row("c2")).price).toBe(5000000);
  });
});
