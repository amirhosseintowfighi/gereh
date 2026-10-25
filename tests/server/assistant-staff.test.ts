import { and, desc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssistantEvent, AssistantThreadView, ConfirmCard } from "@/lib/assistant";
import { setAiUpstream, type Upstream } from "@/server/ai/upstream";
import { STAFF_TOOLS, staffKit } from "@/server/assistant/staff";
import { toolByName } from "@/server/assistant/tools";
import { context } from "@/server/ctx";
import { aiUsage, assistantActions, audit, jobs, servers, ticketMessages, tickets, transactions, users, vpsLayouts, vpsRelayout } from "@/server/db/schema";
import { SimulatorDriver, setVirt } from "@/server/virt/driver";
import { asAdmin, asUser, call, db, fails, fresh, login } from "./helpers";

beforeEach(async () => { await fresh(); setAiUpstream(null); });
afterEach(() => { setAiUpstream(null); setVirt(undefined); });

type Body = { threadId?: string | null; message?: string; mode?: "staff"; confirm?: { token: string; args: Record<string, unknown> }; cancel?: { token: string } };
async function chat(body: Body) {
  const { POST } = await import("@/app/api/assistant/chat/route");
  const res = await POST(new Request("http://x/api/assistant/chat", { method: "POST", headers: { origin: "http://x", host: "x", "content-type": "application/json" }, body: JSON.stringify(body) }));
  if (!res.ok) return { res, events: [{ type: "error", message: ((await res.json()) as { error: string }).error }] as AssistantEvent[] };
  const text = await res.text();
  return { res, events: text.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice(6)) as AssistantEvent) };
}
const textOf = (ev: AssistantEvent[]) => ev.map((e) => (e.type === "text" ? e.delta : "")).join("");
const cardOf = (ev: AssistantEvent[]) => (ev.find((e) => e.type === "confirm") as { card: ConfirmCard } | undefined)?.card;
const threadOf = (ev: AssistantEvent[]) => (ev.find((e) => e.type === "thread") as { id: string }).id;
const balance = async (uid: string) => (await (await db()).select().from(users).where(eq(users.id, uid)))[0].balance;
const fund = async (uid: string) => (await db()).update(users).set({ balance: 5_000_000 }).where(eq(users.id, uid));

function scripted(steps: ({ text: string } | { calls: { name: string; args: Record<string, unknown> }[] })[]) {
  const seen: Record<string, unknown>[] = [];
  const up: Upstream = {
    name: "http",
    async models() { return []; },
    async chat(req) {
      seen.push(JSON.parse(JSON.stringify(req)));
      const s = steps[Math.min(seen.length - 1, steps.length - 1)];
      const base = { id: "x", object: "chat.completion.chunk", created: 1, model: req.model };
      const chunks = "text" in s
        ? [{ ...base, choices: [{ index: 0, delta: { content: s.text }, finish_reason: "stop" }] }]
        : [{ ...base, choices: [{ index: 0, delta: { tool_calls: s.calls.map((c, i) => ({ index: i, id: "call_" + seen.length + "_" + i, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) }, finish_reason: "tool_calls" }] }];
      chunks.push({ ...base, choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50 } } as never);
      return new Response(chunks.map((c) => "data: " + JSON.stringify(c) + "\n\n").join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    },
  };
  setAiUpstream(up);
  return seen;
}
const toolNames = (seen: Record<string, unknown>[], i = 0) => ((seen[i].tools as { function: { name: string } }[]) ?? []).map((t) => t.function.name);

describe("assistant: disk layout tools", () => {
  const SRV = "srv-1042"; // u1, 160 GB, vpsid 3300
  let sim: SimulatorDriver;
  beforeEach(async () => {
    sim = new SimulatorDriver(); setVirt(sim);
    const [s] = await (await db()).select().from(servers).where(eq(servers.id, SRV));
    sim.adopt({ vpsid: 3300, uid: 7, hostname: s.hostname, disks: [{ slot: 0, sizeGb: 160, primary: true }], ipv4: ["185.143.232.17"], ipv6: ["2a01:4f8:c0c:1042::1"], bwLimit: 2000, cores: 4, ramMb: 8192, osName: "Ubuntu 24.04", serverId: 1 });
  });

  it("classifies the tools: reading is immediate, changing the layout needs confirmation", () => {
    expect(toolByName("get_disk_layout")!.risk({})).toBe("read");
    expect(toolByName("set_disk_layout")!.risk({})).toBe("danger");
    expect(toolByName("set_disk_layout")!.inputSchema.properties).not.toHaveProperty("confirm");
  });

  it("«دیسک … تقسیم» proposes a rebuild with a warning card; nothing runs until the owner confirms, then the relayout starts", async () => {
    await asUser();
    const { events } = await chat({ message: "دیسک سرور web-prod-1 را به ۶۰ و ۱۰۰ گیگ تقسیم کن" });
    expect(events.filter((e) => e.type === "tool_result").map((e) => (e as { name: string }).name)).toEqual(["list_servers", "get_disk_layout"]);
    const card = cardOf(events)!;
    expect(card).toMatchObject({ tool: "set_disk_layout", args: { server_id: SRV, sizes: [60, 100], os: "Ubuntu 24.04" } });
    expect(card.title).toContain("بازسازی");
    expect(card.summary).toContain("همه داده‌های همه دیسک‌ها برای همیشه پاک می‌شود");
    expect(card.summary).toContain("Ubuntu 24.04");
    expect(card.summary).toMatch(/۱۶۰.*۶۰ \+ ۱۰۰/);
    expect(card.summary).toContain("در صورت امکان حفظ");
    // a proposal only
    const d = await db();
    expect(await d.select().from(vpsRelayout).where(eq(vpsRelayout.serverId, SRV))).toHaveLength(0);
    expect((await d.select().from(servers).where(eq(servers.id, SRV)))[0].status).toBe("running");

    const ok = await chat({ threadId: threadOf(events), confirm: { token: card.token, args: card.args } });
    expect(ok.events.find((e) => e.type === "decided")).toMatchObject({ status: "done" });
    const [r] = await d.select().from(vpsRelayout).where(eq(vpsRelayout.serverId, SRV));
    expect(r).toMatchObject({ sizes: [60, 100], os: "Ubuntu 24.04" });
    expect((await d.select().from(servers).where(eq(servers.id, SRV)))[0].status).toBe("relayout");
    expect(await d.select().from(jobs).where(eq(jobs.type, "virt.relayout"))).toHaveLength(1);
    expect(textOf(ok.events)).toContain("بازسازی سرور");
  });

  it("an append keeps the data and says so; a rebuild without an OS is refused before any card", async () => {
    await asUser();
    scripted([{ calls: [{ name: "set_disk_layout", args: { server_id: SRV, sizes: [60, 100] } }] }, { text: "سیستم‌عامل را بگویید." }]);
    const r = await chat({ message: "دیسک را دو تکه کن" });
    expect(cardOf(r.events)).toBeUndefined();
    expect(r.events.find((e) => e.type === "tool_result")).toMatchObject({ name: "set_disk_layout", ok: false });
    expect((r.events.find((e) => e.type === "tool_result") as { summary: string }).summary).toContain("سیستم‌عامل");

    // 100 GB used of a 160 GB allowance: a new 60 GB disk is an append
    const d = await db();
    await d.update(servers).set({ disk: 100 }).where(eq(servers.id, SRV));
    await d.insert(vpsLayouts).values({ serverId: SRV, allowanceGb: 160 });
    sim.vms.get(3300)!.disks[0].sizeGb = 100;
    // a hostname the model invents is never used
    scripted([{ calls: [{ name: "set_disk_layout", args: { server_id: SRV, sizes: [100, 60], confirm: "evil" } }] }, { text: "اضافه شد." }]);
    const a = await chat({ message: "یک دیسک ۶۰ گیگ اضافه کن" });
    const card = cardOf(a.events)!;
    expect(card.title).toBe("افزودن دیسک از سهم آزاد");
    expect(card.summary).toContain("هیچ داده‌ای پاک نمی‌شود");
    expect(card.summary).not.toContain("بازسازی");
    const ok = await chat({ threadId: threadOf(a.events), confirm: { token: card.token, args: card.args } });
    expect(ok.events.find((e) => e.type === "decided")).toMatchObject({ status: "done" });
    expect(sim.vms.get(3300)!.disks.map((x) => x.sizeGb)).toEqual([100, 60]);
    expect(await d.select().from(vpsRelayout).where(eq(vpsRelayout.serverId, SRV))).toHaveLength(0);
  });
});

describe("assistant: staff console on /admin", () => {
  it("only staff in their own session can open it; customers cannot reach staff tools even by naming them", async () => {
    await asUser();
    expect((await chat({ mode: "staff", message: "سفارش‌های تحویل‌نشده" })).events[0]).toMatchObject({ type: "error" });
    expect(await fails("assistant.threads", "staff")).toContain("اجازه");
    const before = await balance("u1");
    const seen = scripted([{ calls: [{ name: "adjust_wallet", args: { user: "u1", amount: 9_000_000, reason: "x" } }, { name: "undelivered_orders", args: {} }] }, { text: "نشد." }]);
    const { events } = await chat({ message: "کیف پولم را ۹ میلیون شارژ کن" });
    expect(toolNames(seen)).not.toContain("adjust_wallet");
    expect(cardOf(events)).toBeUndefined();
    expect(events.filter((e) => e.type === "tool_result")).toMatchObject([{ name: "adjust_wallet", ok: false }, { name: "undelivered_orders", ok: false }]);
    expect(await balance("u1")).toBeLessThanOrEqual(before);
    expect((await (await db()).select().from(transactions).where(and(eq(transactions.userId, "u1"), eq(transactions.method, "اصلاح دستی")))).length).toBe(0);
    // staff impersonating a customer stay in the customer's read-only panel assistant
    await asAdmin();
    await call("admin.impersonate", "u1");
    expect((await chat({ mode: "staff", message: "تیکت‌ها" })).events[0]).toMatchObject({ type: "error" });
  });

  it("gates every tool by the staff role: support has no revenue or wallet tools, finance has no delivery tools", async () => {
    await login("kaveh@gereh.net"); // support
    let names = (await staffKit.specs(await context())).map((s) => s.function.name);
    expect(names).toEqual(expect.arrayContaining(["search_customers", "customer_360", "undelivered_orders", "failed_jobs", "open_tickets", "server_details", "retry_delivery", "manual_deliver", "set_service_status", "reply_ticket"]));
    expect(names).not.toContain("sales_summary");
    expect(names).not.toContain("adjust_wallet");
    await fund("st-2");
    // the simulator answers that the role does not cover it
    const sales = await chat({ mode: "staff", message: "گزارش فروش این ماه" });
    expect(sales.events.find((e) => e.type === "tool")).toBeUndefined();
    expect(textOf(sales.events)).toContain("دسترسی ندارد");
    // a model that calls them anyway gets nothing
    const seen = scripted([{ calls: [{ name: "sales_summary", args: {} }, { name: "adjust_wallet", args: { user: "u1", amount: 1000, reason: "test" } }] }, { text: "x" }]);
    const forced = await chat({ mode: "staff", message: "فروش" });
    expect(toolNames(seen)).not.toContain("sales_summary");
    expect(forced.events.filter((e) => e.type === "tool_result")).toMatchObject([{ name: "sales_summary", ok: false }, { name: "adjust_wallet", ok: false }]);
    expect(cardOf(forced.events)).toBeUndefined();

    await login("shima@gereh.net"); // finance
    names = (await staffKit.specs(await context())).map((s) => s.function.name);
    expect(names).toEqual(expect.arrayContaining(["sales_summary", "adjust_wallet", "customer_360", "search_customers"]));
    for (const n of ["retry_delivery", "manual_deliver", "set_service_status", "reply_ticket", "undelivered_orders"]) expect(names).not.toContain(n);
    await fund("st-3");
    setAiUpstream(null);
    const r = await chat({ mode: "staff", message: "گزارش فروش این ماه" });
    expect(r.events.find((e) => e.type === "tool_result")).toMatchObject({ name: "sales_summary", ok: true });
    // every danger tool has a confirmation card
    for (const t of STAFF_TOOLS) if (t.risk({}) === "danger") expect(t.quote, t.name).toBeTypeOf("function");
  });

  it("reads across customers and summarises failed jobs without payloads", async () => {
    await asAdmin();
    await fund("a1");
    const d = await db();
    await d.insert(jobs).values({ type: "provision.server", status: "failed", attempts: 6, lastError: "Virtualizor addvs: no storage\n    at x (y.js:1)", payload: { phase: "wait", serverId: "srv-1042", rootpassEnc: "v1.secret", tries: 3 } });
    const { events } = await chat({ mode: "staff", message: "کارهای ناموفق را خلاصه کن" });
    const res = events.find((e) => e.type === "tool_result") as { name: string; ok: boolean; summary: string };
    expect(res).toMatchObject({ name: "failed_jobs", ok: true });
    expect(textOf(events)).toContain("Virtualizor addvs: no storage");
    expect(textOf(events)).not.toContain("y.js");
    const [msg] = await d.select().from(aiUsage).where(eq(aiUsage.userId, "a1")).orderBy(desc(aiUsage.createdAt)).limit(1);
    expect(msg).toBeDefined();
    const srv = await chat({ mode: "staff", message: "سرور 185.143.232.17 مال کیست؟" });
    expect(srv.events.find((e) => e.type === "tool_result")).toMatchObject({ name: "server_details", ok: true });
    expect(textOf(srv.events)).toContain("web-prod-1");
    // the console's threads are its own
    expect((await call<AssistantThreadView[]>("assistant.threads", "staff")).length).toBe(2);
    expect(await call<AssistantThreadView[]>("assistant.threads")).toHaveLength(0);
  });

  it("a wallet credit is proposed with amount and reason, runs only after confirm, and is audited via the assistant; the staff member's wallet pays", async () => {
    await asAdmin();
    await fund("a1");
    const before = await balance("u1");
    scripted([{ calls: [{ name: "adjust_wallet", args: { user: "demo@gereh.net", amount: 50_000, reason: "جبران قطعی سرور" } }] }, { text: "انجام شد." }]);
    const first = await chat({ mode: "staff", message: "به کیف پول demo@gereh.net پنجاه هزار تومان بابت قطعی بده" });
    const card = cardOf(first.events)!;
    expect(card.tool).toBe("adjust_wallet");
    expect(card.summary).toContain("جبران قطعی سرور");
    expect(card.summary).toContain("۵۰٬۰۰۰");
    expect(await balance("u1")).toBe(before);
    const staffBefore = await balance("a1");

    const ok = await chat({ mode: "staff", threadId: threadOf(first.events), confirm: { token: card.token, args: card.args } });
    expect(ok.events.find((e) => e.type === "decided")).toMatchObject({ status: "done" });
    expect(await balance("u1")).toBe(before + 50_000);
    const d = await db();
    const [tx] = await d.select().from(transactions).where(and(eq(transactions.userId, "u1"), eq(transactions.method, "اصلاح دستی")));
    expect(tx.desc).toContain("جبران قطعی سرور");
    const lines = await d.select().from(audit);
    expect(lines.some((l) => l.action.startsWith("via assistant") && l.action.includes("adjust_wallet"))).toBe(true);
    expect(lines.some((l) => l.action.startsWith("تغییر موجودی"))).toBe(true);
    expect(await balance("a1")).toBeLessThan(staffBefore);

    // a reason is required, and nobody credits their own wallet
    scripted([{ calls: [{ name: "adjust_wallet", args: { user: "u1", amount: 1000, reason: "" } }, { name: "adjust_wallet", args: { user: "a1", amount: 1000, reason: "خودم" } }] }, { text: "x" }]);
    const bad = await chat({ mode: "staff", message: "شارژ" });
    expect(cardOf(bad.events)).toBeUndefined();
  });

  it("a ticket reply shows its text on the card and is sent only after confirm", async () => {
    await asAdmin();
    await fund("a1");
    const d = await db();
    const [t] = await d.select().from(tickets).limit(1);
    const text = "سلام، مشکل اتصال برطرف شد؛ لطفاً دوباره امتحان کنید.";
    scripted([{ calls: [{ name: "reply_ticket", args: { ticket_id: t.id, text } }] }, { text: "ارسال شد." }]);
    const first = await chat({ mode: "staff", message: "به تیکت " + t.id + " جواب بده" });
    const card = cardOf(first.events)!;
    expect(card.tool).toBe("reply_ticket");
    expect(card.summary).toContain(text);
    const count = async () => (await d.select().from(ticketMessages).where(eq(ticketMessages.ticketId, t.id))).length;
    const n = await count();
    // only the staff member who saw it can confirm it
    await asUser();
    expect(await fails("assistant.confirm", card.token, card.args)).toContain("معتبر نیست");
    await asAdmin();
    const ok = await chat({ mode: "staff", threadId: threadOf(first.events), confirm: { token: card.token, args: card.args } });
    expect(ok.events.find((e) => e.type === "decided")).toMatchObject({ status: "done" });
    expect(await count()).toBe(n + 1);
    expect((await d.select().from(audit)).some((l) => l.action.startsWith("via assistant") && l.action.includes("reply_ticket"))).toBe(true);
    expect((await d.select().from(assistantActions).where(eq(assistantActions.id, card.id)))[0].status).toBe("done");
  });
});
