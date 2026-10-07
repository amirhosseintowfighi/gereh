import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { context } from "@/server/ctx";
import { devopsLeads, devopsProjects, invoices } from "@/server/db/schema";
import { outbox } from "@/server/messaging";
import { devopsBilling } from "@/server/rpc/devops";
import { drain } from "@/server/worker";
import { buildState } from "@/server/state";
import { asAdmin, asUser, call, db, fails, fresh, jar, login } from "./helpers";

beforeEach(fresh);
const form = {
  name: "نگار احمدی", company: "استارتاپ نمونه", role: "CTO", email: "Negar@Example.com", phone: "۰۹۱۲۱۲۳۴۵۶۷", website: "example.com",
  size: "۱۱ تا ۵۰ نفر", stage: "در حال رشد سریع", infra: ["گره"], services: ["ci-cd", "kubernetes"], pkg: "growth",
  budget: "۲۵ تا ۶۰ میلیون تومان در ماه", urgency: "ظرف یک ماه", needsNda: true, message: "استقرار دستی داریم و می‌خواهیم به کوبرنتیز مهاجرت کنیم.", consent: true, source: "/devops",
};
const anon = () => { jar.clear(); };

describe("devops requests", () => {
  it("stores a qualified lead, emails sales and the client, notifies staff", async () => {
    anon();
    const { ref } = await call<{ ref: string }>("devops.request", form);
    expect(ref).toMatch(/^DO-\d+$/);
    const [l] = await (await db()).select().from(devopsLeads).where(eq(devopsLeads.id, ref));
    expect(l).toMatchObject({ email: "negar@example.com", phone: "09121234567", status: "new", needsNda: true, services: ["ci-cd", "kubernetes"] });
    await drain(await db());
    expect(outbox.some((m) => m.subject?.includes("درخواست دواپس " + ref))).toBe(true);
    expect(outbox.some((m) => m.to === "negar@example.com" && m.subject?.includes(ref))).toBe(true);
  });

  it("validates input and enumerations", async () => {
    anon();
    await fails("devops.request", { ...form, email: "bad" });
    await fails("devops.request", { ...form, phone: "123" });
    await fails("devops.request", { ...form, services: ["mining"] });
    await fails("devops.request", { ...form, services: [] });
    await fails("devops.request", { ...form, message: "کوتاه" });
    await fails("devops.request", { ...form, consent: false });
  });

  it("silently drops honeypot submissions and rate-limits per IP", async () => {
    anon();
    const before = (await (await db()).select().from(devopsLeads)).length;
    expect(await call("devops.request", { ...form, hp: "http://spam" })).toEqual({ ref: "DO-0" });
    expect(await (await db()).select().from(devopsLeads)).toHaveLength(before);
    for (let i = 0; i < 3; i++) await call("devops.request", form);
    await expect(call("devops.request", form)).rejects.toThrow();
  });

  it("pipeline is staff-only (owner/sales), not support or customers", async () => {
    anon();
    const { ref } = await call<{ ref: string }>("devops.request", form);
    await asUser();
    await fails("devops.updateLead", ref, { status: "contacted" });
    const s = await buildState((await context()).db, (await context()).auth, "customer");
    expect(s.db.devopsLeads).toEqual([]);
    await login("kaveh@gereh.net");
    await fails("devops.noteLead", ref, "تماس گرفتم");
    await asAdmin();
    await call("devops.updateLead", ref, { status: "meeting", value: 58_000_000 });
    await call("devops.noteLead", ref, "جلسه سه‌شنبه ساعت ۱۰");
    const st = await buildState((await context()).db, (await context()).auth, "admin");
    expect(st.db.devopsLeads[0]).toMatchObject({ id: ref, status: "meeting", value: 58_000_000 });
    expect(st.db.devopsLeads[0].notes[0].text).toBe("جلسه سه‌شنبه ساعت ۱۰");
  });
});

describe("devops projects", () => {
  it("won lead → active project the customer sees, with milestones and updates", async () => {
    anon();
    const { ref } = await call<{ ref: string }>("devops.request", form);
    await asAdmin();
    const pid = await call<string>("devops.createProject", { userId: "u1", leadId: ref, title: "مهاجرت به کوبرنتیز", plan: "growth", services: ["kubernetes"], monthlyFee: 58_000_000, hoursIncluded: 50, engineer: "کاوه نوری", start: true });
    await call("devops.setMilestones", pid, [{ title: "ممیزی", due: "۱۴۰۵/۰۸/۰۱", done: true }, { title: "کلاستر staging", due: "۱۴۰۵/۰۸/۱۵", done: false }]);
    await call("devops.postUpdate", pid, "کلاستر staging آماده شد و در حال تست است.");
    const [lead] = await (await db()).select().from(devopsLeads).where(eq(devopsLeads.id, ref));
    expect(lead.status).toBe("won");

    await asUser();
    const s = await buildState((await context()).db, (await context()).auth, "customer");
    const mine = s.db.devopsProjects.find((x) => x.id === pid)!;
    expect(mine).toMatchObject({ title: "مهاجرت به کوبرنتیز", status: "active", leadId: null });
    expect(mine.milestones).toHaveLength(2);
    expect(mine.updates[0].text).toContain("staging");
    await fails("devops.postUpdate", pid, "من مشتری هستم و نباید بتوانم");
  });

  it("other customers never see someone else's project", async () => {
    await asAdmin();
    await call("devops.createProject", { userId: "u1", title: "پروژه محرمانه", plan: "audit", services: [], monthlyFee: 0, hoursIncluded: 0, engineer: "", start: true });
    jar.clear();
    await call("auth.register", { name: "دیگری", email: "other@example.com", phone: "09351112299", password: "Abcdefg1" });
    const s = await buildState((await context()).db, (await context()).auth, "customer");
    expect(s.db.devopsProjects).toEqual([]);
  });

  it("monthly billing issues one invoice per period and is idempotent", async () => {
    await asAdmin();
    const pid = await call<string>("devops.createProject", { userId: "u1", title: "نگه‌داری ماهانه", plan: "startup", services: ["managed-devops"], monthlyFee: 24_000_000, hoursIncluded: 20, engineer: "", start: true });
    const d = await db();
    const before = (await d.select().from(invoices).where(eq(invoices.userId, "u1"))).length;
    expect(await devopsBilling(d)).toBe(1);
    expect(await devopsBilling(d)).toBe(0);
    expect((await d.select().from(invoices).where(eq(invoices.userId, "u1"))).length).toBe(before + 1);
    const [p] = await d.select().from(devopsProjects).where(eq(devopsProjects.id, pid));
    expect(p.nextBillAt!.getTime()).toBeGreaterThan(Date.now() + 25 * 86400_000);
    await call("devops.updateProject", pid, { status: "paused" });
    await d.update(devopsProjects).set({ nextBillAt: new Date(0) }).where(eq(devopsProjects.id, pid));
    expect(await devopsBilling(d)).toBe(0);
  });

  it("one-off invoices and validation", async () => {
    await asAdmin();
    const pid = await call<string>("devops.createProject", { userId: "u1", title: "ممیزی", plan: "audit", services: [], monthlyFee: 0, hoursIncluded: 0, engineer: "", start: false });
    const inv = await call<string>("devops.invoice", pid, { desc: "ممیزی زیرساخت", amount: 18_000_000 });
    expect(inv).toMatch(/^INV-/);
    await fails("devops.createProject", { userId: "u1", title: "بدون مبلغ", plan: "growth", services: [], monthlyFee: 0, hoursIncluded: 0, engineer: "", start: true });
    await fails("devops.createProject", { userId: "admin", title: "کارمند", plan: "audit", services: [], monthlyFee: 0, hoursIncluded: 0, engineer: "", start: false });
  });
});
