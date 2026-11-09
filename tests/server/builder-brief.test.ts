/* بافت's savings and «طرح حرفه‌ای»: a short request becomes a professional brief before the build; the system
   prompt stays the same between runs (prompt cache); an edit of a larger project sends only the files it
   concerns and never overwrites a file the model did not see. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BuilderEvent } from "@/lib/builder";
import type { ChatRequest } from "@/server/ai/translate";
import { setAiUpstream } from "@/server/ai/upstream";
import { briefMessages, cleanBrief, wantsBrief } from "@/server/builder/enhance";
import { render } from "@/server/builder/format";
import { focusFiles, taskMessages } from "@/server/builder/prompt";
import { aiUsage, builderRuns } from "@/server/db/schema";
import { asUser, call, db, fresh } from "./helpers";

beforeEach(async () => { await fresh(); setAiUpstream(null); });
afterEach(() => { setAiUpstream(null); delete process.env.BUILDER_BRIEF; });

async function run(projectId: string, prompt: string) {
  const { POST } = await import("@/app/api/build/run/route");
  const res = await POST(new Request("http://x/api/build/run", { method: "POST", headers: { origin: "http://x", host: "x", "content-type": "application/json" }, body: JSON.stringify({ projectId, prompt }) }));
  const text = await res.text();
  return text.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice(6)) as BuilderEvent);
}
const sse = (text: string) => new Response("data: " + JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] }) + "\n\ndata: " + JSON.stringify({ choices: [], usage: { prompt_tokens: 3000, completion_tokens: 900 } }) + "\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
const BRIEF = "## Goal\nA warm one-page site for «نان داغ» bakery that brings walk-in customers.\n## Audience\nNeighbours.\n## Pages and sections\n- Hero, menu, hours, contact\n## Features and interactions\n- Call button 0912 000 0000\n## Content and tone\nFriendly.\n## Visual style\nWarm browns.\n## Must keep (from the request)\n- «نان داغ», 0912 000 0000";
const SITE = render({ plan: "- صفحه اصلی", files: { "index.html": "<!doctype html><html lang=\"fa\" dir=\"rtl\"><head><title>نان داغ</title></head><body><main><h1>نان داغ</h1><a href=\"tel:09120000000\">تماس</a></main></body></html>" }, summary: "ساخته شد." });

describe("«طرح حرفه‌ای» (the brief)", () => {
  it("the brief writer keeps the request verbatim and asks for fixed sections", () => {
    const m = briefMessages("static", "یه سایت برای نانوایی «نان داغ» با شماره 0912 000 0000");
    expect(m[0].content).toMatch(/Keep EVERY concrete detail/);
    expect(m[0].content).toContain("## Must keep (from the request)");
    expect(m[0].content).not.toContain("## Data and API");
    expect(briefMessages("node", "x")[0].content).toContain("## Data and API");
    expect(m[1].content).toContain("«نان داغ» با شماره 0912 000 0000");
    expect(cleanBrief("```markdown\n" + BRIEF + "\n```")).toBe(BRIEF);
    expect(cleanBrief("ok")).toBeNull();
    expect(wantsBrief("یه سایت برای نانوایی")).toBe(true);
    expect(wantsBrief("x".repeat(900))).toBe(false);
    process.env.BUILDER_BRIEF = "0";
    expect(wantsBrief("یه سایت برای نانوایی")).toBe(false);
  });

  it("a one-line request is briefed first; the build gets both, and the brief is charged with the run", async () => {
    await asUser();
    const id = await call<string>("builder.create", { prompt: "یه سایت برای نانوایی «نان داغ» با شماره 0912 000 0000", stack: "static" });
    await call("builder.update", id, { selfReview: false });
    const seen: ChatRequest[] = [];
    setAiUpstream({
      name: "http", models: async () => [],
      chat: async (req) => {
        seen.push(JSON.parse(JSON.stringify(req)));
        if (!req.stream) return Response.json({ id: "b", choices: [{ index: 0, message: { role: "assistant", content: BRIEF }, finish_reason: "stop" }], usage: { prompt_tokens: 400, completion_tokens: 200 } });
        return sse(SITE);
      },
    });
    const ev = await run(id, "یه سایت برای نانوایی «نان داغ» با شماره 0912 000 0000");
    expect(ev.some((e) => e.type === "status" && e.text.includes("طرح حرفه‌ای"))).toBe(true);
    expect(ev.at(-1)?.type).toBe("done");
    expect(seen).toHaveLength(2);
    expect(String(seen[0].messages[0].content)).toContain("product lead");
    const build = String(seen[1].messages.at(-1)!.content);
    expect(build).toContain("<user_request>\nیه سایت برای نانوایی «نان داغ» با شماره 0912 000 0000\n</user_request>");
    expect(build).toContain("<brief>\n## Goal");
    expect(build).toMatch(/customer's own words in <user_request> win/);
    const d = await db();
    const usage = await d.select().from(aiUsage).where(eq(aiUsage.userId, "u1"));
    expect(usage).toHaveLength(2);
    const [r] = await d.select().from(builderRuns).where(eq(builderRuns.projectId, id));
    expect(r.cost).toBe(usage.reduce((n, u) => n + u.charged, 0));
    expect(r.inTokens).toBeGreaterThan(3000);
  });

  it("a brief that fails or a detailed request builds from the request as written", async () => {
    await asUser();
    const id = await call<string>("builder.create", { prompt: "کافه", stack: "static" });
    await call("builder.update", id, { selfReview: false });
    const seen: ChatRequest[] = [];
    setAiUpstream({ name: "http", models: async () => [], chat: async (req) => { seen.push(req); return req.stream ? sse(SITE) : new Response("{}", { status: 500 }); } });
    expect((await run(id, "سایت کافه")).at(-1)?.type).toBe("done");
    expect(seen.map((r) => !!r.stream)).toEqual([false, true]);
    expect(String(seen[1].messages.at(-1)!.content)).not.toContain("<brief>");
    seen.length = 0;
    const id2 = await call<string>("builder.create", { prompt: "کافه", stack: "static" });
    await call("builder.update", id2, { selfReview: false });
    await run(id2, "سایت کافه با منو، ساعات کاری و نقشه. ".repeat(25));
    expect(seen.map((r) => !!r.stream)).toEqual([true]);
  });
});

describe("بافت savings", () => {
  it("the system prompt is the same for every request of a kind (cacheable); request-specific skills lead the user message", () => {
    const a = taskMessages("static", { kind: "generate", prompt: "فروشگاه لباس با سبد خرید", lang: "fa" });
    const b = taskMessages("static", { kind: "generate", prompt: "فرم رزرو نوبت برای سئو و گوگل", lang: "fa" });
    expect(a[0].content).toBe(b[0].content);
    expect(String(a[1].content)).toContain('<skill id="ecommerce-basics"');
    expect(String(b[1].content)).toContain('<skill id="forms-and-states"');
    expect(String(a[0].content)).not.toContain('<skill id="ecommerce-basics"');
    expect(String(a[0].content)).toContain('<skill id="frontend-design"');
  });

  it("an edit of a larger project gets the files it concerns in full and an outline of the rest", () => {
    const page = (t: string) => "<!doctype html><html><head><title>" + t + "</title></head><body><h1>" + t + "</h1><section id=\"" + t + "\">" + "متن نمونه. ".repeat(1500) + "</section></body></html>";
    const files = { "index.html": page("home"), "about.html": page("about"), "contact.html": page("contact"), "blog.html": page("blog"), "assets/app.js": "function openMenu() {}\n" };
    expect(focusFiles({ "index.html": "<p>x</p>" }, "contact")).toEqual([]);
    const hidden = focusFiles(files, "در صفحه contact شماره تلفن را عوض کن");
    expect(hidden).not.toContain("contact.html");
    expect(hidden).toEqual(expect.arrayContaining(["about.html", "blog.html"]));
    // site-wide requests see everything
    expect(focusFiles(files, "رنگ همه دکمه‌ها را سبز کن")).toEqual([]);
    expect(focusFiles(files, "change the footer")).toEqual([]);
    const m = taskMessages("static", { kind: "edit", prompt: "در صفحه contact شماره تلفن را عوض کن", files, history: [], outlineOnly: hidden, lang: "fa" });
    const user = String(m[1].content);
    expect(user).toContain('<file path="contact.html">');
    expect(user).not.toContain('<file path="blog.html">');
    expect(user).toContain("<file_outline>\n");
    expect(user).toMatch(/- about\.html \(\d+ characters; title «about»; headings: about; ids: about\)/);
    expect(user.length).toBeLessThan(JSON.stringify(files).length * 0.6);
  });

  it("a file the model only saw as an outline is never overwritten", async () => {
    await asUser();
    const id = await call<string>("builder.create", { prompt: "سایت", stack: "static" });
    await call("builder.update", id, { selfReview: false });
    const big = (t: string) => "<!doctype html><html lang=\"fa\" dir=\"rtl\"><head><title>" + t + "</title></head><body><main><h1>" + t + "</h1><p>" + "متن نمونه. ".repeat(1500) + "</p></main></body></html>";
    for (const p of ["index.html", "about.html", "contact.html", "blog.html"]) await call("builder.saveFile", id, p, big(p));
    let sent = "";
    setAiUpstream({ name: "http", models: async () => [], chat: async (req) => { sent = String(req.messages.at(-1)!.content); return sse(render({ plan: "- تماس", files: { "contact.html": big("contact-new"), "blog.html": "<p>guess</p>" }, summary: "انجام شد." })); } });
    const ev = await run(id, "در صفحه contact شماره تلفن را عوض کن");
    expect(ev.at(-1)?.type).toBe("done");
    expect(sent).toContain("<file_outline>");
    expect(await call<string>("builder.file", id, "contact.html")).toContain("contact-new");
    expect(await call<string>("builder.file", id, "blog.html")).toBe(big("blog.html"));
    const [r] = await (await db()).select().from(builderRuns).where(eq(builderRuns.kind, "edit"));
    expect(r.log).toContain("blog.html (این فایل در این مرحله به مدل نشان داده نشده بود)");
  });
});
