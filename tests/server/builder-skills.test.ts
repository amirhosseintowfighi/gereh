import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateTokens } from "@/lib/ai";
import type { BuilderEvent, BuilderProjectView } from "@/lib/builder";
import { dirOf, explicitLanguage, resolveSiteLanguage, textLanguage } from "@/lib/site-language";
import { setAiUpstream } from "@/server/ai/upstream";
import { render } from "@/server/builder/format";
import { reviewMessages, taskMessages } from "@/server/builder/prompt";
import { checkFiles } from "@/server/builder/quality";
import { projectFiles, simulateReview } from "@/server/builder/sim";
import { SKILLS, selectSkills, skillCtx, skillTokens } from "@/server/builder/skills";
import { aiUsage, builderRuns, users } from "@/server/db/schema";
import { asUser, call, db, fresh } from "./helpers";

beforeEach(async () => { await fresh(); setAiUpstream(null); });
afterEach(() => { setAiUpstream(null); delete process.env.BUILDER_SKILLS_BUDGET; delete process.env.BUILDER_SELF_REVIEW; });

type Site = { lang: string; dir: "rtl" | "ltr" };
const FA: Site = { lang: "fa", dir: "rtl" }, EN: Site = { lang: "en", dir: "ltr" };
const ids = (s: { id: string }[]) => s.map((x) => x.id);
const balance = async () => (await (await db()).select().from(users).where(eq(users.id, "u1")))[0].balance;
const view = (id: string) => call<BuilderProjectView>("builder.get", id);

async function run(projectId: string, prompt: string) {
  const { POST } = await import("@/app/api/build/run/route");
  const res = await POST(new Request("http://x/api/build/run", { method: "POST", headers: { origin: "http://x", host: "x", "content-type": "application/json" }, body: JSON.stringify({ projectId, prompt }) }));
  if (!res.ok) return [{ type: "error", message: ((await res.json()) as { error: string }).error }] as BuilderEvent[];
  return (await res.text()).split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice(6)) as BuilderEvent);
}
const sse = (text: string, usage?: { prompt_tokens: number; completion_tokens: number }) =>
  new Response("data: " + JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] }) + "\n\n" + (usage ? "data: " + JSON.stringify({ choices: [], usage }) + "\n\n" : "") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

describe("skills: selection and prompt", () => {
  it("picks the core skills by stack and task kind, keyword skills by the request, within the budget", () => {
    const st = ids(selectSkills({ stack: "static", kind: "generate", prompt: "لندینگ ساده" }));
    expect(st.slice(0, 5)).toEqual(["frontend-design", "i18n-typography", "responsive-mobile-first", "accessibility-wcag", "web-security"]);
    expect(st).not.toContain("node-backend");
    expect(ids(selectSkills({ stack: "node", kind: "generate", prompt: "x" }))).toContain("node-backend");
    const shop = ids(selectSkills({ stack: "node", kind: "generate", prompt: "فروشگاه لباس با سبد خرید و پرداخت", budget: 20_000 }));
    expect(shop).toContain("ecommerce-basics");
    expect(shop).not.toContain("auth-accounts");
    expect(ids(selectSkills({ stack: "static", kind: "generate", prompt: "an online store with a cart and checkout", budget: 20_000 }))).toContain("ecommerce-basics");
    // fix/maintain: debugging, security and backend; no design skills unless asked
    const fix = ids(selectSkills({ stack: "node", kind: "fix", prompt: "Error: Cannot find module 'pg'" }));
    expect(fix).toEqual(expect.arrayContaining(["testing-and-debugging", "web-security", "node-backend"]));
    expect(fix).not.toContain("frontend-design");
    // the budget: never exceeded (beyond the first skill), configurable by env
    const small = selectSkills({ stack: "node", kind: "generate", prompt: "فروشگاه", budget: 2000 });
    expect(small.length).toBeGreaterThanOrEqual(1);
    expect(small.slice(1).reduce((s, x) => s + skillTokens(x), skillTokens(small[0]))).toBeLessThanOrEqual(Math.max(2000, skillTokens(small[0])));
    const all = selectSkills({ stack: "node", kind: "generate", prompt: "فروشگاه با سبد خرید، ورود کاربر، داشبورد مدیریت و سئو", budget: 50_000 });
    process.env.BUILDER_SKILLS_BUDGET = "3000";
    expect(selectSkills({ stack: "node", kind: "generate", prompt: "فروشگاه با سبد خرید، ورود کاربر، داشبورد مدیریت و سئو" }).length).toBeLessThan(all.length);
  });

  it("keeps every skill compact, with a checklist", () => {
    expect(SKILLS.length).toBeGreaterThanOrEqual(9);
    for (const s of SKILLS) {
      for (const lang of ["fa", "en", "ar"]) {
        const body = typeof s.body === "function" ? s.body(skillCtx(lang)) : s.body;
        expect(estimateTokens(body.length), s.id + "/" + lang).toBeLessThanOrEqual(1000);
      }
      expect(s.checklist.length).toBeGreaterThanOrEqual(3);
    }
    // the default core set of a node build fits the default budget
    const core = selectSkills({ stack: "node", kind: "generate", prompt: "x" });
    expect(core.reduce((n, s) => n + skillTokens(s), 0)).toBeLessThanOrEqual(6000);
  });

  it("puts the skills block in the system prompt and keeps the output format", () => {
    const [sys, user] = taskMessages("node", { kind: "generate", prompt: "سایت نوبت‌دهی آرایشگاه", lang: "fa", reply: "fa" });
    const s = String(sys.content);
    expect(s).toContain("<skills>");
    expect(s).toContain('<skill id="web-security"');
    expect(s).toContain('<skill id="node-backend"');
    expect(s).toContain("Self-review checklist");
    expect(s).toContain('"skills: <the ids');
    expect(s).toMatch(/<plan>[\s\S]*<file path=[\s\S]*<summary>/);
    expect(String(user.content)).toContain("<user_request>");
    const rv = reviewMessages("node", { "server.js": "x" }, selectSkills({ stack: "node", kind: "generate" }), [{ rule: "sigterm", category: "backend", severity: "warn", file: "server.js", message: "m", hint: "Handle SIGTERM", count: 1 }]);
    expect(String(rv[0].content)).toContain("# Checklists");
    expect(String(rv[1].content)).toContain("<quality_findings>");
    expect(String(rv[1].content)).toContain("Handle SIGTERM");
  });
});

describe("site language", () => {
  it("detects the language from an explicit request, else the prompt's own language", () => {
    expect(resolveSiteLanguage({ prompt: "یک سایت انگلیسی برای کافه بساز" })).toBe("en");
    expect(resolveSiteLanguage({ prompt: "Build a landing page for my coffee shop" })).toBe("en");
    expect(resolveSiteLanguage({ prompt: "یک سایت نوبت‌دهی برای آرایشگاه" })).toBe("fa");
    expect(resolveSiteLanguage({ prompt: "Build a website in German for a bakery in Berlin" })).toBe("de");
    expect(resolveSiteLanguage({ prompt: "یک سایت عربی برای رستوران" })).toBe("ar");
    expect(resolveSiteLanguage({ prompt: "موقع لمطعم في الرياض مع قائمة الطعام" })).toBe("ar");
    expect(resolveSiteLanguage({ prompt: "سایت آموزشگاه زبان انگلیسی" })).toBe("fa"); // the subject, not the site's language
    expect(explicitLanguage("لطفاً سایت به زبان ترکی آذربایجانی باشد")).toBe("az");
    expect(textLanguage("Eine Webseite für unsere Bäckerei mit der Speisekarte")).toBe("de");
    // the setting beats the prompt's language, an explicit request beats the setting
    expect(resolveSiteLanguage({ prompt: "یک سایت برای کافه", setting: "en" })).toBe("en");
    expect(resolveSiteLanguage({ prompt: "یک سایت فرانسوی برای کافه", setting: "en" })).toBe("fr");
    // an edit keeps the project's language
    expect(resolveSiteLanguage({ prompt: "رنگ را سبز کن", current: "en" })).toBe("en");
    expect([dirOf("fa"), dirOf("ar"), dirOf("he"), dirOf("ur"), dirOf("en"), dirOf("de"), dirOf("fa-IR")]).toEqual(["rtl", "rtl", "rtl", "rtl", "ltr", "ltr", "rtl"]);
  });

  it("forces no Persian or RTL on a non-Persian site", () => {
    const en = String(taskMessages("static", { kind: "generate", prompt: "A landing page for a café", lang: "en", reply: "en" })[0].content);
    expect(en).toContain('lang="en" dir="ltr"');
    expect(en).not.toMatch(/lang="fa"|dir="rtl"|Persian digits|Jalali via|Toman unless|Vazirmatn-font-face|نیم‌فاصله/);
    expect(en).toContain("plan> and <summary> in that language");
    const de = String(taskMessages("node", { kind: "generate", prompt: "Webseite auf Deutsch", lang: "de", reply: "en" })[0].content);
    expect(de).toContain('lang="de" dir="ltr"');
    expect(de).toContain('locale "de-DE"');
    expect(de).not.toMatch(/lang="fa"|dir="rtl"|Persian digits/);
    const ar = String(taskMessages("static", { kind: "generate", prompt: "x", lang: "ar", reply: "fa" })[0].content);
    expect(ar).toContain('lang="ar" dir="rtl"');
    expect(ar).toContain("Vazirmatn-font-face");
    expect(ar).toContain("Arabic specifics");
    expect(ar).not.toContain("Persian specifics");
    const fa = String(taskMessages("static", { kind: "generate", prompt: "x", lang: "fa", reply: "fa" })[0].content);
    expect(fa).toContain('lang="fa" dir="rtl"');
    expect(fa).toContain("Persian specifics");
    expect(fa).toContain("Jalali");
  });
});

describe("quality gate: static checks", () => {
  it("passes the simulator's projects in Persian and English", () => {
    for (const [stack, lang] of [["static", "fa"], ["node", "fa"], ["static", "en"], ["node", "en"]] as const) {
      for (const prompt of ["سایت نوبت‌دهی آرایشگاه", "فروشگاه لباس", "رستوران", "همایش", "یک کسب‌وکار"]) {
        const r = checkFiles(projectFiles(prompt, stack, lang), stack, lang === "fa" ? FA : EN);
        expect(r.findings.filter((f) => f.severity === "error"), stack + "/" + lang + "/" + prompt).toEqual([]);
        expect(r.score).toBeGreaterThanOrEqual(90);
        expect(r.scores.backend === null).toBe(stack === "static");
      }
    }
    const html = projectFiles("یک سایت انگلیسی برای کافه", "static", "en")["index.html"];
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).not.toContain("Vazirmatn");
    expect(html).toContain("Reserve");
  });

  it("catches each class of issue", () => {
    const rules = (files: Record<string, string>, stack: "static" | "node" = "static", site = FA) => checkFiles(files, stack, site).findings.map((f) => f.rule);
    const page = (body: string, head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>سلام دنیا</title><meta name="description" content="x">', html = '<html lang="fa" dir="rtl">') => "<!doctype html>" + html + "<head>" + head + "</head><body>" + body + "</body></html>";
    expect(rules({ "index.html": page("<main><h1>سلام</h1></main>") })).toEqual([]);
    expect(rules({ "index.html": page("", "", "<html>") })).toEqual(expect.arrayContaining(["html-lang", "html-dir", "charset", "viewport", "title"]));
    expect(rules({ "index.html": page("") }, "static", EN)).toEqual(expect.arrayContaining(["html-lang", "html-dir"]));
    expect(rules({ "index.html": page("", '<meta charset="utf-8"><meta name="viewport" content="width=device-width, maximum-scale=1"><title>t t</title>') })).toContain("zoom-disabled");
    expect(rules({ "index.html": page('<img src="a.svg">') })).toContain("img-alt");
    expect(rules({ "index.html": page('<img src="a.svg" alt="" width="10" height="10">') })).toEqual([]);
    expect(rules({ "index.html": page('<input id="q" name="q">') })).toContain("input-label");
    expect(rules({ "index.html": page('<label for="q">جستجو</label><input id="q" name="q"><label>نام <input name="n"></label><input type="hidden" name="h"><input aria-label="x">') })).toEqual([]);
    expect(rules({ "index.html": page('<a href="https://x.ir" target="_blank">x</a>') })).toContain("blank-noopener");
    expect(rules({ "index.html": page('<a href="https://x.ir" target="_blank" rel="noopener noreferrer">x</a>') })).toEqual([]);
    expect(rules({ "index.html": page('<script src="http://cdn.example.com/x.js"></script>') })).toContain("http-asset");
    expect(rules({ "index.html": page('<button onclick="go()">x</button>') })).toContain("inline-handler");
    expect(rules({ "index.html": page('<div class="w-[900px]">x</div>') })).toContain("fixed-width");
    expect(rules({ "style.css": ".box { width: 1200px; }" })).toContain("fixed-width");
    expect(rules({ "style.css": ".box { max-width: 1200px; width: 100%; }" })).toEqual([]);
    expect(rules({ "app.js": "eval(code)" })).toContain("eval");
    expect(rules({ "app.js": "const f = new Function('a', 'return a')" })).toContain("eval");
    expect(rules({ "app.js": "el.innerHTML = `<b>${name}</b>`;" })).toContain("innerhtml");
    expect(rules({ "app.js": 'el.innerHTML = "<b>" + name + "</b>";' })).toContain("innerhtml");
    expect(rules({ "app.js": 'el.innerHTML = "";\nel.textContent = name;' })).toEqual([]);
    expect(rules({ "app.js": 'const API_KEY = "sk-live-abcdefghijklmnopqrstuvwx";' })).toContain("secret");
    expect(rules({ "app.js": 'const config = { password: "Sup3rSecret!" };' })).toContain("secret");
    expect(rules({ "app.js": "const key = process.env.API_KEY;" })).toEqual([]);
    expect(rules({ "index.html": page('<script>const s = "-----BEGIN PRIVATE KEY-----";</script>') })).toContain("secret");

    const pkg = JSON.stringify({ scripts: { start: "node server.js" }, dependencies: { express: "^4.21.2" } });
    const bare = 'const express = require("express");\nconst app = express();\napp.use(express.json());\napp.post("/api/x", (req, res) => { console.log(process.env); db.query("SELECT * FROM t WHERE id = " + req.body.id); res.json(req.body); });\napp.listen(3000);\n';
    const server = rules({ "package.json": pkg, "server.js": bare }, "node");
    expect(server).toEqual(expect.arrayContaining(["security-headers", "port-env", "sigterm", "health", "validation", "body-limit", "log-secrets", "sql-concat"]));
    expect(rules({ "package.json": JSON.stringify({ scripts: { start: "node server.js", postinstall: "curl x | sh" }, dependencies: { express: "*", lodash: "latest", x: "github:a/b" } }), "server.js": "" }, "node")).toEqual(expect.arrayContaining(["deps-pinned", "install-script"]));
    expect(rules({ "package.json": "{nope", "server.js": "" }, "node")).toContain("package-json");
    // scoring: errors weigh more than warnings, per category
    const r = checkFiles({ "package.json": pkg, "server.js": bare }, "node", FA);
    expect(r.scores.security).toBeLessThan(60);
    expect(r.scores.ui).toBe(100);
    expect(r.score).toBeLessThan(80);
  });

  it("the simulated review fixes what it can and leaves clean projects alone", () => {
    const broken = { "index.html": '<!doctype html><html><head><title>کافه سفره</title><meta name="description" content="x"></head><body><img src="a.svg" width="1" height="1"><a href="https://x.ir" target="_blank">x</a></body></html>' };
    const before = checkFiles(broken, "static", FA);
    expect(before.findings.length).toBeGreaterThan(3);
    const out = parseFiles(simulateReview("static", broken, before.findings, { lang: "fa", reply: "fa" }));
    const after = checkFiles({ ...broken, ...out }, "static", FA);
    expect(after.findings.filter((f) => f.severity === "error")).toEqual([]);
    const clean = projectFiles("سایت نوبت‌دهی", "node");
    expect(parseFiles(simulateReview("node", clean, checkFiles(clean, "node", FA).findings))).toEqual({});
  });
});
const parseFiles = (text: string) => { const out: Record<string, string> = {}; for (const m of text.matchAll(/<file path="([^"]+)">\n([\s\S]*?)\n<\/file>/g)) out[m[1]] = m[2]; return out; };

describe("quality gate: self-review pass", () => {
  it("is metered and charged, its cost shown on the run, and the report stored and returned by builder.get", async () => {
    await asUser();
    const before = await balance();
    const id = await call<string>("builder.create", { prompt: "یک سایت نوبت‌دهی برای سالن آرایش", stack: "node" });
    const ev = await run(id, "یک سایت نوبت‌دهی برای سالن آرایش");
    expect(ev.find((e) => e.type === "run")).toMatchObject({ skills: expect.arrayContaining(["web-security", "node-backend"]) });
    expect(ev.some((e) => e.type === "status" && e.text === "در حال بازبینی کیفیت و امنیت…")).toBe(true);
    const done = ev.at(-1) as Extract<BuilderEvent, { type: "done" }>;
    expect(done.type).toBe("done");
    const v = await view(id);
    const r = v.runs[0];
    expect(r.skills).toEqual(expect.arrayContaining(["frontend-design", "i18n-typography", "accessibility-wcag", "node-backend"]));
    expect(r.reviewCost).toBeGreaterThan(0);
    expect(r.cost).toBe(done.charged);
    expect(await balance()).toBe(before - r.cost);
    expect(v.spent).toBe(r.cost);
    expect(r.quality).toMatchObject({ review: { status: "done", cost: r.reviewCost }, before: { errors: 0 } });
    expect(r.quality!.score).toBeGreaterThanOrEqual(90);
    expect(Object.keys(r.quality!.scores).sort()).toEqual(["a11y", "backend", "performance", "security", "ui"]);
    expect(r.log).toContain("بررسی کیفیت");
    const usage = await (await db()).select().from(aiUsage).where(and(eq(aiUsage.userId, "u1"), eq(aiUsage.format, "panel")));
    expect(usage.map((u) => u.status)).toEqual(["success", "success"]);
    expect(usage.map((u) => u.charged).sort((a, b) => a - b)).toEqual([r.reviewCost, r.cost - r.reviewCost].sort((a, b) => a - b));
    expect(v.selfReview).toBe(true);
  });

  it("applies the review's patch to the same version and reports the improvement", async () => {
    await asUser();
    const id = await call<string>("builder.create", { prompt: "صفحه معرفی کافه", stack: "static" });
    const bad = '<!doctype html><html><head><title>کافه سفره</title><meta name="description" content="x"></head><body><main><h1>کافه</h1><a href="https://x.ir" target="_blank">ما</a></main></body></html>';
    const good = '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>کافه سفره</title><meta name="description" content="x"></head><body><main><h1>کافه</h1><a href="https://x.ir" target="_blank" rel="noopener noreferrer">ما</a></main></body></html>';
    const seen: string[] = [];
    setAiUpstream({ name: "http", models: async () => [], chat: async (req) => {
      seen.push(String((req.messages as { content: string }[])[0].content));
      return seen.length === 1 ? sse(render({ plan: "- صفحه", files: { "index.html": bad }, summary: "ساخته شد." })) : sse(render({ plan: "- اصلاح lang و rel", files: { "index.html": good }, summary: "اصلاح شد." }));
    } });
    const ev = await run(id, "صفحه معرفی کافه");
    expect(ev.at(-1)).toMatchObject({ type: "done", version: 1 });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("<skills>");
    expect(seen[1]).toContain("reviewing engineer");
    const v = await view(id);
    expect(v.version).toBe(1);
    expect(await call<string>("builder.file", id, "index.html")).toBe(good);
    const q = v.runs[0].quality!;
    expect(q.before!.errors).toBeGreaterThanOrEqual(4);
    expect(q.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(q.score).toBeGreaterThan(q.before!.score);
    expect(q.review).toMatchObject({ status: "done", files: ["index.html"] });
  });

  it("is skipped when the wallet cannot cover it, and when turned off for the project", async () => {
    await asUser();
    const d = await db();
    const id = await call<string>("builder.create", { prompt: "صفحه معرفی کافه", stack: "static" });
    const page = projectFiles("صفحه معرفی کافه", "static");
    let calls = 0;
    // the build itself empties the wallet (it reports a usage that costs the whole reserve)
    setAiUpstream({ name: "http", models: async () => [], chat: async () => {
      calls++;
      await d.update(users).set({ balance: 0 }).where(eq(users.id, "u1"));
      return sse(render({ plan: "- صفحه", files: page, summary: "ساخته شد." }), { prompt_tokens: 50_000, completion_tokens: 32_000 });
    } });
    const ev = await run(id, "صفحه معرفی کافه");
    expect(ev.at(-1)).toMatchObject({ type: "done", version: 1 });
    expect(calls).toBe(1);
    const r = (await view(id)).runs[0];
    expect(r.reviewCost).toBe(0);
    expect(r.quality?.review).toMatchObject({ status: "skipped" });
    expect(r.quality?.review?.note).toContain("موجودی");
    const usage = await d.select().from(aiUsage).where(eq(aiUsage.userId, "u1"));
    expect(usage.map((u) => u.status).sort()).toEqual(["denied", "success"]);

    // off for the project: one call, no review in the report
    await d.update(users).set({ balance: 10_000_000 }).where(eq(users.id, "u1"));
    const id2 = await call<string>("builder.create", { prompt: "صفحه معرفی کافه", stack: "static" });
    await call("builder.update", id2, { selfReview: false });
    calls = 0;
    setAiUpstream({ name: "http", models: async () => [], chat: async () => { calls++; return sse(render({ plan: "- صفحه", files: page, summary: "ساخته شد." })); } });
    await run(id2, "صفحه معرفی کافه");
    expect(calls).toBe(1);
    const v2 = await view(id2);
    expect(v2.selfReview).toBe(false);
    expect(v2.runs[0].quality).toMatchObject({ review: null });
    // and globally by env
    process.env.BUILDER_SELF_REVIEW = "off";
    const id3 = await call<string>("builder.create", { prompt: "صفحه معرفی کافه", stack: "static" });
    calls = 0;
    await run(id3, "صفحه معرفی کافه");
    expect(calls).toBe(1);
  });

  it("an upstream failure during the review keeps the build, refunded", async () => {
    await asUser();
    const id = await call<string>("builder.create", { prompt: "صفحه معرفی کافه", stack: "static" });
    const page = projectFiles("صفحه معرفی کافه", "static");
    let calls = 0;
    setAiUpstream({ name: "http", models: async () => [], chat: async () => (++calls === 1 ? sse(render({ plan: "- صفحه", files: page, summary: "ساخته شد." })) : new Response("overloaded", { status: 529 })) });
    const ev = await run(id, "صفحه معرفی کافه");
    expect(ev.at(-1)).toMatchObject({ type: "done", version: 1 });
    const r = (await view(id)).runs[0];
    expect(r).toMatchObject({ status: "succeeded", reviewCost: 0 });
    expect(r.quality?.review).toMatchObject({ status: "failed" });
    const usage = await (await db()).select().from(aiUsage).where(eq(aiUsage.userId, "u1"));
    expect(usage.map((u) => u.status).sort()).toEqual(["error", "success"]);
  });
});

describe("site language in projects", () => {
  it("builds what the request asks for: English, Arabic, German or Persian, with copy in that language", async () => {
    await asUser();
    const cases: [string, string, string, string][] = [
      ["یک سایت انگلیسی برای کافه بساز", "en", "ltr", "Reserve"],
      ["Build a landing page for my coffee shop", "en", "ltr", "Reserve"],
      ["یک سایت نوبت‌دهی برای آرایشگاه", "fa", "rtl", "نوبت"],
      ["Build a website in German for a bakery", "de", "ltr", "Tisch reservieren"],
      ["یک سایت عربی برای رستوران", "ar", "rtl", "احجز طاولتك"],
    ];
    for (const [prompt, lang, dir, word] of cases) {
      const id = await call<string>("builder.create", { prompt, stack: "static" });
      await run(id, prompt);
      const v = await view(id);
      expect([v.siteLanguage, v.siteDir], prompt).toEqual([lang, dir]);
      const html = await call<string>("builder.file", id, "index.html");
      expect(html, prompt).toContain(`<html lang="${lang}" dir="${dir}">`);
      expect(html).toContain(word);
      expect(v.runs[0].quality!.findings.filter((f) => f.rule === "html-lang" || f.rule === "html-dir")).toEqual([]);
    }
  });

  it("the project setting overrides detection; a Persian edit keeps an English site English", async () => {
    await asUser();
    const id = await call<string>("builder.create", { prompt: "یک سایت برای کافه", stack: "static", language: "en" });
    await run(id, "یک سایت برای کافه");
    expect((await view(id))).toMatchObject({ language: "en", siteLanguage: "en", siteDir: "ltr" });
    expect(await call<string>("builder.file", id, "index.html")).toContain('<html lang="en" dir="ltr">');
    // the customer chats in Persian: the summary stays Persian
    expect((await view(id)).messages.at(-1)!.content).toMatch(/[آ-ی]/);
    await run(id, "بخش سؤالات متداول اضافه کن");
    const html = await call<string>("builder.file", id, "index.html");
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain("Frequently asked questions");
    // changing the setting: the next run follows it
    await call("builder.update", id, { language: "de" });
    expect(await view(id)).toMatchObject({ language: "de", siteLanguage: "de", siteDir: "ltr" });
    await call("builder.update", id, { language: "auto" });
    expect(await view(id)).toMatchObject({ language: "auto", siteLanguage: "de" });
    const runs = await (await db()).select().from(builderRuns).where(eq(builderRuns.projectId, id));
    expect(runs.every((r) => r.skills.includes("i18n-typography"))).toBe(true);
  });
});
