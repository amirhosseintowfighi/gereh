import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { jobs } from "@/server/db/schema";
import { claim, enqueue, heartbeat, type JobType } from "@/server/jobs";
import { LANES, SCHEDULE, drain } from "@/server/worker";
import { db, fresh } from "./helpers";

beforeEach(async () => { await fresh(); });

const laneOf = (t: JobType) => LANES.filter((l) => (l.filter.only ? l.filter.only.includes(t) : !l.filter.except!.includes(t))).map((l) => l.name);

describe("worker lanes: a slow job never holds the queue behind it", () => {
  it("every job type belongs to exactly one lane; customer work is never behind periodic or long jobs", () => {
    const types: JobType[] = ["paas.build", "paas.poll", "provision.server", "virt.power", "builder.watch", "notify.send", "virt.relayout", "dbaas.import", "builder.fix", "builder.maintain", "virt.sync", "usage.collect", "paas.daily"];
    for (const t of types) expect(laneOf(t)).toHaveLength(1);
    for (const t of ["paas.build", "paas.poll", "provision.server", "virt.power", "builder.watch"] as JobType[]) expect(laneOf(t)).toEqual(["work"]);
    for (const t of ["virt.relayout", "dbaas.import", "builder.fix"] as JobType[]) expect(laneOf(t)).toEqual(["long"]);
    for (const [t] of SCHEDULE) expect(laneOf(t)).toEqual(["background"]);
  });

  it("claims one job at a time and honours the lane filter", async () => {
    const d = await db();
    await enqueue(d, "builder.maintain", {}, { dedupe: "m" });
    await enqueue(d, "notify.send", { userId: "u1", text: "x" }, { dedupe: "n1" });
    await enqueue(d, "notify.send", { userId: "u1", text: "y" }, { dedupe: "n2" });
    const [work] = await claim(d, 1, LANES[0].filter);
    expect(work.type).toBe("notify.send");
    // nothing else was taken along with it
    const running = await d.select().from(jobs).where(eq(jobs.status, "running"));
    expect(running.map((j) => j.id)).toEqual([work.id]);
    const [bg] = await claim(d, 1, LANES[2].filter);
    expect(bg.type).toBe("builder.maintain");
    // a heartbeat keeps a long job from being reclaimed as a crashed one
    await d.update(jobs).set({ lockedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(jobs.id, bg.id));
    await heartbeat(d, bg.id);
    expect((await claim(d, 5, LANES[2].filter))).toHaveLength(0);
    // drain with a filter runs only that lane's jobs
    expect(await drain(d, 10, LANES[1].filter)).toBe(0);
    expect(await drain(d, 10, LANES[0].filter)).toBe(1);
  });
});
