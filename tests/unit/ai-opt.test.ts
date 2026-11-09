/* Token optimizer modules (src/server/ai/optimizer), each on its own. */
import { describe, expect, it } from "vitest";
import { analyzeRequest, invariants, segments } from "@/server/ai/optimizer/analyzer";
import { costs, summarize, upstreamCost, type EventRow } from "@/server/ai/optimizer/analytics";
import { DEFAULT_FAMILIES, familyOf, placeCache, worthCaching } from "@/server/ai/optimizer/cache";
import { billedInput, OptCall } from "@/server/ai/optimizer/call";
import { compressContext, shrinkToolResult, summarizeTurns, windowStart } from "@/server/ai/optimizer/context";
import { calibrate, estimateRequest, estimateText } from "@/server/ai/optimizer/estimator";
import { ANSWER_IN_PERSIAN, answerLanguageOk, mask, persianRatio, translateMessages, unmask, type Translator } from "@/server/ai/optimizer/language";
import { bm25, chunkByHeading, dedupeParagraphs, REPEATED_MARKER, selectSections } from "@/server/ai/optimizer/markdown";
import { optimizeRequest } from "@/server/ai/optimizer/optimize";
import { resolvePolicy } from "@/server/ai/optimizer/policy";
import { dedupeInstructions, normalizeWhitespace, optimizeSystemText } from "@/server/ai/optimizer/prompt";
import { emptyReport, type ChatMessage, type ChatRequest } from "@/server/ai/optimizer/types";
import { checkExtract, checkRewrite } from "@/server/ai/optimizer/validator";

const FENCE = "```";

describe("analyzer", () => {
  it("splits prose from code, JSON, YAML, XML and shell, losslessly", () => {
    const t = "Intro text.\n" + FENCE + "ts\nconst a  =  1;\n" + FENCE + "\n{\"a\": 1,\n \"b\": [1, 2]}\nname: web\nimage: nginx\nports: 80\n<config>\n  <x>1</x>\n</config>\n$ sudo systemctl restart nginx\nOutro.";
    const s = segments(t);
    expect(s.map((x) => x.text).join("")).toBe(t);
    expect(s.map((x) => x.kind)).toEqual(["prose", "code", "json", "yaml", "xml", "shell", "prose"]);
  });
  it("a Markdown list with a «Note:» line stays prose", () => {
    expect(segments("- first item here\n- Note: second item is longer than four words here\n- third\n").map((x) => x.kind)).toEqual(["prose"]);
  });
  it("finds protected spans, numbers, dates and negations in English, Persian and mixed text", () => {
    const en = invariants("Do not restart srv-4821 at 10.0.0.5 before 2026-11-08; see https://gereh.net/docs and /etc/nginx/nginx.conf, port 8080, user ops@gereh.net, key DATABASE_URL, `npm ci`.");
    for (const s of ["srv-4821", "10.0.0.5", "2026-11-08", "https://gereh.net/docs", "/etc/nginx/nginx.conf", "8080", "ops@gereh.net", "DATABASE_URL", "`npm ci`"]) expect(en.spans).toContain(s);
    expect(en.words).toEqual(expect.arrayContaining(["not", "before"]));
    const fa = invariants("هرگز پورت ۲۲ را نبندید مگر اینکه سرور srv-4821 در دسترس نباشد. باید تا ۱۴۰۳/۰۸/۱۲ تمدید شود.");
    expect(fa.words).toEqual(expect.arrayContaining(["هرگز", "مگر", "باید"]));
    expect(fa.spans).toEqual(expect.arrayContaining(["22", "srv-4821", "1403/08/12"]));
    const mixed = invariants("فایل `src/config/db.ts` را بدون تغییر DB_URL نگه دار.");
    expect(mixed.spans).toEqual(expect.arrayContaining(["`src/config/db.ts`", "DB_URL"]));
    expect(mixed.words).toContain("بدون");
  });
  it("describes roles, multimodal parts and tools", () => {
    const r = analyzeRequest({ model: "m", messages: [{ role: "system", content: "s" }, { role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "data:x" } }] }], tools: [{ type: "function", function: { name: "f" } }] });
    expect(r.latestUser).toBe(1);
    expect(r.multimodal).toBe(true);
    expect(r.tools).toBe(1);
    expect(r.messages[1].parts).toMatchObject({ text: 1, image: 1 });
  });
});

describe("estimator", () => {
  it("estimates per script: Persian costs more tokens per character than English, code more than prose", () => {
    const en = "The quick brown fox jumps over the lazy dog. ".repeat(20), fa = "روباه قهوه‌ای سریع از روی سگ تنبل می‌پرد. ".repeat(20);
    expect(estimateText(en) / en.length).toBeLessThan(estimateText(fa) / fa.length);
    const code = FENCE + "\nfunction add(a, b) { return a + b; }\n".repeat(10) + FENCE;
    expect(estimateText(code) / code.length).toBeGreaterThan(estimateText(en) / en.length);
    expect(estimateText("")).toBe(0);
  });
  it("counts tools and images, and calibrates per model by EMA", () => {
    const req: ChatRequest = { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: "u" } }] }], tools: [{ type: "function", function: { name: "f", parameters: {} } }] };
    expect(estimateRequest(req)).toBeGreaterThan(800);
    let c = calibrate(null, 120, 100);
    expect(c).toEqual({ factor: 1.2, samples: 1 });
    c = calibrate(c, 80, 100);
    expect(c.factor).toBeCloseTo(1.0, 5);
    expect(calibrate(c, 1000, 100)).toBe(c); // a 10× sample is noise
    for (let i = 0; i < 50; i++) c = calibrate(c, 130, 100);
    expect(c.factor).toBeGreaterThan(1.25);
  });
});

describe("validator", () => {
  it("a rewrite must keep every negation, number, span and protected block — or it is rejected", () => {
    expect(checkRewrite("Do not delete   the files.", "Do not delete the files.")).toBeNull();
    expect(checkRewrite("Do not delete the files.", "Do delete the files.")).toMatch(/not/);
    expect(checkRewrite("Keep 3 replicas on port 8080.", "Keep replicas on port 8080.")).toMatch(/3/);
    expect(checkRewrite("هرگز پورت ۲۲ را نبندید.", "پورت ۲۲ را ببندید.")).toMatch(/هرگز/);
    expect(checkRewrite("x\n" + FENCE + "\na  =  1\n" + FENCE + "\n", "x\n" + FENCE + "\na = 1\n" + FENCE + "\n")).toMatch(/protected/);
    expect(checkRewrite("Open https://a.example/x?y=1 now", "Open https://a.example/x now")).toMatch(/span/);
  });
  it("an extract may only keep whole verbatim lines or sentences, around explicit markers", () => {
    const src = "line one\nDo not touch prod.\nline three\n";
    expect(checkExtract(src, "line one\n[… 1 lines omitted from tool result t …]\nline three")).toBeNull();
    expect(checkExtract(src, "line one\ntouch prod.\nline three")).toMatch(/partial/);
    expect(checkExtract(src, "line one\nan invented line\n")).toMatch(/invented/);
  });
});

describe("prompt optimizer", () => {
  it("normalizes whitespace outside code and keeps indentation, tables and ZWNJ", () => {
    const t = "Rules:   be  brief.  \r\n\n\n\n  - indented   item\n| a  | b |\nمی‌شود\n" + FENCE + "\nx  =  1   \n\n\n\n" + FENCE + "\n";
    const n = normalizeWhitespace(t);
    expect(n).toBe("Rules: be brief.\n\n  - indented item\n| a  | b |\nمی‌شود\n" + FENCE + "\nx  =  1   \n\n\n\n" + FENCE + "\n");
  });
  it("dedupes exact and formatting-only duplicates, never rules with different words or sections", () => {
    const t = "Never share the customer's API key with anyone.\nAlways answer in Persian.\n**never share the customer’s API key with anyone**\nAnswer in Persian.\nNever share the customer's API key with anyone.";
    const exact = dedupeInstructions(t, false);
    expect(exact.removed).toBe(1);
    const near = dedupeInstructions(t.replace("’", "'"), true);
    expect(near.removed).toBe(2);
    expect(near.text).toContain("Always answer in Persian.");
    expect(near.text).toContain("Answer in Persian.");
    // a short «key: value» line under two different headings means two things
    const plans = "## Plan A\n- Price: 100 Toman\n## Plan B\n- Price: 100 Toman\n";
    expect(dedupeInstructions(plans, true).removed).toBe(0);
    const r = optimizeSystemText("A  rule  that is long enough to dedupe here.\nA rule that is long enough to dedupe here.", { near: false });
    expect(r).toMatchObject({ whitespace: true, deduped: 1 });
    expect(checkRewrite("A  rule  that is long enough to dedupe here.\nA rule that is long enough to dedupe here.", r.text)).toBeNull();
  });
});

const handbook = () => {
  let d = "# Handbook\n\nIntro paragraph.\n\n";
  for (const p of ["VPS", "Postgres", "Storage", "Mail", "DNS", "Mirror"]) d += `## ${p}\n\n${p} details: ${"lorem ipsum dolor sit amet consectetur. ".repeat(30)}\n\n### ${p} limits\n\nRate limit for ${p}: ${p.length * 60} per minute.\n\n`;
  return d + "## Security\n\nNever share API keys.\n";
};

describe("markdown processor", () => {
  it("replaces a repeated long paragraph with a marker", () => {
    const p = "This paragraph is long enough to count as a real paragraph of documentation text, really.";
    const r = dedupeParagraphs(p + "\n\nother\n\n" + p);
    expect(r.removed).toBe(1);
    expect(r.text).toBe(p + "\n\nother\n\n" + REPEATED_MARKER);
  });
  it("chunks by heading (outside code) and ranks sections with BM25", () => {
    const secs = chunkByHeading("pre\n# A\na text\n" + FENCE + "\n# not a heading\n" + FENCE + "\n## B\npostgres pooling\n");
    expect(secs.map((s) => s.path.join(">"))).toEqual(["", "A", "A>B"]);
    expect(secs.map((s) => s.text).join("")).toContain("# not a heading");
    const s = bm25(["vps cpu", "postgres pooling postgres", "mail dns"], "postgres pool");
    expect(s[1]).toBeGreaterThan(s[0]);
  });
  it("selects query-relevant sections, keeps security sections, cites and lists every omitted title", () => {
    const doc = handbook();
    const r = selectSections(doc, "What is the Postgres rate limit?", { minTokens: 500, budget: 600 });
    expect(r.text).toContain("Rate limit for Postgres: 480 per minute.");
    expect(r.text).toContain("[section: Handbook > Postgres > Postgres limits]");
    expect(r.text).toContain("Never share API keys.");
    expect(r.omitted.length).toBeGreaterThan(3);
    for (const t of r.omitted) expect(r.text).toContain("«" + t + "»");
    expect(r.text).toMatch(/\[… \d+ sections? omitted as not relevant to the latest request: /);
    expect(checkExtract(doc, r.text)).toBeNull();
    // a short document is left alone
    expect(selectSections("# a\nx\n# b\ny\n# c\nz", "x", { minTokens: 500, budget: 100 }).omitted).toEqual([]);
  });
});

const turn = (i: number, extra = ""): ChatMessage[] => [{ role: "user", content: "question " + i + extra }, { role: "assistant", content: "answer " + i }];

describe("context compressor", () => {
  it("keeps the last turns verbatim; the window moves in blocks", () => {
    const msgs: ChatMessage[] = [{ role: "system", content: "s" }, ...Array.from({ length: 12 }, (_, i) => turn(i)).flat(), { role: "user", content: "latest" }];
    const w = windowStart(msgs, 4, 1);
    expect(msgs[w].content).toBe("question 8");
    const more = [...msgs.slice(0, -1), ...turn(12), { role: "user" as const, content: "latest" }];
    expect(more[windowStart(more, 4, 1)].content).toBe("question 8");
  });
  it("shrinks an old tool result to head, tail and key lines with an explicit marker", () => {
    const log = Array.from({ length: 200 }, (_, i) => (i === 100 ? "ERROR upstream timed out" : "line " + i)).join("\n");
    const s = shrinkToolResult(log, "app_logs", 20, 6000)!;
    expect(s).toContain("line 0");
    expect(s).toContain("line 199");
    expect(s).toContain("ERROR upstream timed out");
    expect(s).toMatch(/\[… \d+ lines omitted from tool result app_logs …\]/);
    expect(checkExtract(log, s)).toBeNull();
    const json = JSON.stringify({ rows: Array.from({ length: 400 }, (_, i) => ({ id: i, v: i * 2 })) });
    const j = shrinkToolResult(json, "q", 60, 2000)!;
    expect(j).toMatch(/\[… \d+ characters omitted from tool result q …\]/);
    expect(j.length).toBeLessThan(json.length / 2);
    expect(shrinkToolResult("short", "x", 60, 6000)).toBeNull();
  });
  it("summarizes old turns deterministically from their own sentences, keeping tool-call pairs whole", () => {
    const old: ChatMessage[] = [
      { role: "user", content: "Please deploy srv-4821 to Frankfurt. Can you also check the DNS?" },
      { role: "assistant", content: "We decided to use the small plan. It costs 90000 Toman per month. I won't change the firewall." },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "dns", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "{\"zone\":\"example.ir\",\"ns\":\"ns1.gereh.net\"}" },
    ];
    const s = summarizeTurns(old, { decisions: 5, facts: 5, questions: 5, tasks: 5, refs: 10 });
    expect(s).toContain("- We decided to use the small plan.");
    expect(s).toContain("- It costs 90000 Toman per month.");
    expect(s).toContain("- Can you also check the DNS?");
    expect(s).toContain("- Please deploy srv-4821 to Frankfurt.");
    expect(s).toContain("ns1.gereh.net");
    expect(summarizeTurns(old, { decisions: 5, facts: 5, questions: 5, tasks: 5, refs: 10 })).toBe(s);
    expect(checkExtract(old.map((m) => String(m.content ?? "")).join("\n"), s)).toBeNull();
    const policy = resolvePolicy({ feature: "assistant", call: { recentTurns: 1, summarizeOverTokens: 500 } });
    const msgs: ChatMessage[] = [{ role: "system", content: "sys" }, ...Array.from({ length: 10 }, () => old).flat().map((m, i) => ({ ...m, content: typeof m.content === "string" ? m.content + " (" + i + ")" : m.content })), ...turn(99), { role: "user", content: "latest" }];
    const r = compressContext(msgs, policy, { overBudget: false });
    expect(r.summarized).toBeGreaterThan(0);
    expect(r.messages[1].role).toBe("system");
    // no tool message lost its assistant call
    const ids = new Set(r.messages.flatMap((m) => m.tool_calls?.map((c) => c.id) ?? []));
    for (const m of r.messages.filter((x) => x.role === "tool")) expect(ids.has(m.tool_call_id!)).toBe(true);
    expect(r.messages.at(-1)).toEqual({ role: "user", content: "latest" });
  });
});

describe("cache", () => {
  const big = "x".repeat(20_000);
  const req = (model: string): ChatRequest => ({ model, messages: [{ role: "system", content: big }, { role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "latest" }] });
  it("places cache_control only for families that need it, above their minimum", () => {
    const anth = placeCache(req("anthropic/claude-x"), { family: familyOf("anthropic/claude-x"), explicitAllowed: true, expectedReuse: 0.8 });
    expect(anth.info.breakpoints).toBe(2);
    expect((anth.req.messages[0].content as { cache_control?: unknown }[])[0].cache_control).toEqual({ type: "ephemeral" });
    expect((anth.req.messages[0].content as { text: string }[])[0].text).toBe(big);
    expect(anth.req.messages[3].content).toBe("latest");
    const gem = placeCache(req("google/gemini-x"), { family: familyOf("google/gemini-x"), explicitAllowed: true, expectedReuse: 0.8 });
    expect(gem.info.breakpoints).toBe(1);
    const oai = placeCache(req("openai/gpt-x"), { family: familyOf("openai/gpt-x"), explicitAllowed: true, expectedReuse: 0.8 });
    expect(oai).toMatchObject({ info: { breakpoints: 0, skipped: "automatic" } });
    expect(oai.req).toEqual(req("openai/gpt-x"));
    const ds = placeCache(req("deepseek-x"), { family: familyOf("deepseek-x"), explicitAllowed: true, expectedReuse: 0.8 });
    expect(ds.info.skipped).toBe("automatic");
  });
  it("skips below the minimum, when not worth it, for an upstream without support, and when the customer set it", () => {
    const small: ChatRequest = { model: "claude-x", messages: [{ role: "system", content: "short" }, { role: "user", content: "q" }] };
    expect(placeCache(small, { family: familyOf("claude-x"), explicitAllowed: true, expectedReuse: 0.8 }).info.skipped).toBe("below-min");
    expect(placeCache(req("claude-x"), { family: familyOf("claude-x"), explicitAllowed: true, expectedReuse: 0.1 }).info.skipped).toBe("not-worth");
    expect(placeCache(req("claude-x"), { family: familyOf("claude-x"), explicitAllowed: false, expectedReuse: 0.9 }).info.skipped).toBe("upstream");
    const own: ChatRequest = { model: "claude-x", messages: [{ role: "system", content: [{ type: "text", text: big, cache_control: { type: "ephemeral" } }] }, { role: "user", content: "q" }] };
    expect(placeCache(own, { family: familyOf("claude-x"), explicitAllowed: true, expectedReuse: 0.9 })).toMatchObject({ req: own, info: { skipped: "customer" } });
    const anth = DEFAULT_FAMILIES.find((f) => f.name === "anthropic")!;
    expect(worthCaching(anth, 0.3)).toBe(true);
    expect(worthCaching(anth, 0.2)).toBe(false);
  });
  it("keeps the prefix hash stable while only the conversation grows", () => {
    const a = placeCache(req("claude-x"), { family: null, explicitAllowed: true, expectedReuse: 1 });
    const longer = req("claude-x");
    longer.messages.push({ role: "assistant", content: "c" }, { role: "user", content: "next" });
    expect(placeCache(longer, { family: null, explicitAllowed: true, expectedReuse: 1 }).info.prefixHash).toBe(a.info.prefixHash);
  });
});

describe("policy", () => {
  it("the public API is optimized at the balanced level by default; only the admin changes that", () => {
    expect(resolvePolicy({ feature: "api" })).toMatchObject({ enabled: true, level: 2, recentTurns: 6, cache: true });
    expect(resolvePolicy({ feature: "api" }, { features: { api: { level: 0 } } })).toMatchObject({ level: 0, summarize: false, cache: true });
    expect(resolvePolicy({ feature: "api" }, { features: { api: { enabled: false } } }).enabled).toBe(false);
  });
  it("internal features are on by default, with per-feature, model, plan and request-type layers", () => {
    expect(resolvePolicy({ feature: "assistant" })).toMatchObject({ level: 2, summarize: true, recentTurns: 2 });
    expect(resolvePolicy({ feature: "builder" })).toMatchObject({ level: 1, sections: false });
    expect(resolvePolicy({ feature: "assistant", model: "claude-x" }, { models: { "claude-": { recentTurns: 9 } } }).recentTurns).toBe(9);
    expect(resolvePolicy({ feature: "panel-chat", plan: "pro" }, { plans: { pro: { maxInputTokens: 99_000 } } }).maxInputTokens).toBe(99_000);
    expect(resolvePolicy({ feature: "panel-chat", requestType: { json: true } })).toMatchObject({ nearDedupe: false, sections: false });
    expect(resolvePolicy({ feature: "assistant" }, { features: { assistant: { enabled: false } } }).enabled).toBe(false);
  });
});

describe("language adapter", () => {
  const fa = "سرور srv-4821 از ساعت ۲۳:۴۰ در دسترس نیست و پورت ۲۲ بسته شده است. لطفاً فایروال را بررسی کنید و قانون 185.12.0.0/16 را اصلاح کنید. ".repeat(6);
  const fake = (fn: (q: string) => string, confidence?: number): Translator => async (texts) => texts.map((t) => ({ text: fn(t), confidence }));
  const toEn = (t: string) => t.replace(/[؀-ۿ‌]+/g, "word").replace(/\s+/g, " ");
  const opts = (translator: Translator) => ({ translator, minSavingTokens: 10, minConfidence: 0.8, timeoutMs: 1000, includeLatest: false });
  const msgs = (): ChatMessage[] => [{ role: "system", content: "sys" }, { role: "user", content: fa }, { role: "assistant", content: "ok" }, { role: "user", content: fa }];

  it("masks protected spans and numbers, and unmasks only an exact round trip", () => {
    const m = mask("پورت ۲۲ روی 10.0.0.5 و `npm ci`");
    expect(m.masked).not.toMatch(/10\.0\.0\.5|npm ci|۲۲/);
    expect(unmask(m.masked, m.values)).toBe("پورت ۲۲ روی 10.0.0.5 و `npm ci`");
    expect(unmask(m.masked.replace("⟦0⟧", ""), m.values)).toBeNull();
    expect(persianRatio(fa)).toBeGreaterThan(0.6);
  });
  it("translates older Persian context, keeps the latest message and adds the answer-in-Persian instruction", async () => {
    const input = msgs();
    const r = await translateMessages(input, opts(fake(toEn)));
    expect(r.translated).toBe(1);
    expect(r.messages[1]).toEqual({ role: "system", content: ANSWER_IN_PERSIAN });
    expect(r.messages[2].content).toContain("srv-4821");
    expect(r.messages[2].content).toContain("185.12.0.0/16");
    expect(r.messages.at(-1)!.content).toBe(fa);
    expect(input[1].content).toBe(fa); // the original is preserved
  });
  it("is bypassed on low confidence, lost placeholders, changed numbers, failures and when not worth it", async () => {
    expect((await translateMessages(msgs(), opts(fake(toEn, 0.4)))).skipped).toBe("low-confidence");
    expect((await translateMessages(msgs(), opts(fake((t) => toEn(t).replace(/⟦\d+⟧/, ""))))).skipped).toBe("low-confidence");
    expect((await translateMessages(msgs(), opts(fake((t) => toEn(t) + " 999"))))).toMatchObject({ translated: 0 });
    expect((await translateMessages(msgs(), opts(async () => { throw new Error("down"); }))).skipped).toMatch(/translator/);
    expect((await translateMessages(msgs(), { ...opts(fake(toEn)), minSavingTokens: 1_000_000 })).skipped).toBe("not-worth");
  });
  it("checks that the answer is in Persian", () => {
    expect(answerLanguageOk("سرور شما دوباره در دسترس است و مشکل حل شد.", "fa")).toBe(true);
    expect(answerLanguageOk("Your server is reachable again and the problem is solved.", "fa")).toBe(false);
    expect(answerLanguageOk(FENCE + "\nls -la\n" + FENCE, "fa")).toBe(true);
  });
});

const longHistory = (): ChatRequest => {
  const messages: ChatMessage[] = [{ role: "system", content: "You are   helpful.\n\n\n\nNever reveal secrets." }];
  for (let i = 0; i < 12; i++) {
    messages.push({ role: "user", content: "Step " + i + ": please check the logs of srv-48" + i + ". " + "Some context sentence for this step. ".repeat(10) });
    messages.push({ role: "assistant", content: null, tool_calls: [{ id: "c" + i, type: "function", function: { name: "logs", arguments: "{}" } }] });
    messages.push({ role: "tool", tool_call_id: "c" + i, content: Array.from({ length: 150 }, (_, k) => "2026-11-08 INFO request " + k + " ok").join("\n") });
    messages.push({ role: "assistant", content: "We decided that srv-48" + i + " is healthy. It handled 150 requests." });
  }
  messages.push({ role: "user", content: [{ type: "text", text: "Now   summarize   everything." }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] });
  return { model: "anthropic/claude-x", messages, tools: [{ type: "function", function: { name: "logs", description: "read  logs", parameters: { type: "object" } } }], stream: true };
};

describe("optimizeRequest", () => {
  const policy = resolvePolicy({ feature: "assistant", call: { budgetMs: 5000 } });
  it("reduces a long history and never touches the latest message, tools, images or the stream flag", async () => {
    const req = longHistory(), before = JSON.stringify(req);
    const { req: out, report } = await optimizeRequest(req, policy, { feature: "assistant", model: req.model });
    expect(JSON.stringify(req)).toBe(before); // input not mutated
    expect(report.changed).toBe(true);
    expect(report.optTokens).toBeLessThan(report.origTokens * 0.7);
    expect(report.validatorFailures).toBe(0);
    expect(out.messages.at(-1)).toEqual(req.messages.at(-1));
    expect(out.tools).toBe(req.tools);
    expect(out.stream).toBe(true);
    expect(report.steps.toolShrink).toBeGreaterThan(0);
  });
  it("reverts a step whose output dropped a negation or a number, and counts it", async () => {
    const req: ChatRequest = { model: "m", messages: [{ role: "system", content: "Do not   delete files.\nKeep   3 replicas." }, { role: "user", content: "hi" }] };
    const dropNot = await optimizeRequest(req, policy, { feature: "assistant", model: "m", hook: (stage, _b, a) => (stage === "system" ? a.replace("not ", "") : a) });
    expect(dropNot.report.validatorFailures).toBe(1);
    expect(dropNot.req.messages[0].content).toBe("Do not   delete files.\nKeep   3 replicas.");
    const dropNum = await optimizeRequest(req, policy, { feature: "assistant", model: "m", hook: (stage, _b, a) => (stage === "system" ? a.replace("3 ", "") : a) });
    expect(dropNum.report.validatorFailures).toBe(1);
    const ok = await optimizeRequest(req, policy, { feature: "assistant", model: "m" });
    expect(ok.req.messages[0].content).toBe("Do not delete files.\nKeep 3 replicas.");
    expect(ok.report.validatorFailures).toBe(0);
  });
  it("falls back to the original request on an exception and when over its time budget", async () => {
    const req = longHistory();
    const boom = await optimizeRequest(req, policy, { feature: "assistant", model: "m", hook: () => { throw new Error("bug"); } });
    expect(boom.req).toBe(req);
    expect(boom.report.fallback).toBe("error");
    let t = 0;
    const slow = await optimizeRequest(req, { ...policy, budgetMs: 50 }, { feature: "assistant", model: "m", now: () => (t += 30) });
    expect(slow.req).toBe(req);
    expect(slow.report.fallback).toBe("timeout");
    const off = await optimizeRequest(req, { ...policy, enabled: false }, { feature: "assistant", model: "m" });
    expect(off).toMatchObject({ req, report: { fallback: "disabled" } });
  });
  it("level 0 (the admin's caching-only choice) leaves content alone and only adds cache breakpoints", async () => {
    const req = longHistory();
    const p = resolvePolicy({ feature: "api" }, { features: { api: { level: 0 } } });
    const { req: out, report } = await optimizeRequest(req, p, { feature: "api", model: req.model, family: familyOf(req.model), explicitCache: true });
    expect(report.changed).toBe(false);
    expect(report.cache.breakpoints).toBeGreaterThan(0);
    const strip = (r: ChatRequest) => JSON.stringify(r.messages.map((m) => (Array.isArray(m.content) ? (m.content as { type: string; text?: string }[]).map(({ type, text }) => ({ type, text })) : m.content)));
    const flat = (r: ChatRequest) => strip({ ...r, messages: r.messages.map((m) => (Array.isArray(m.content) && m.role !== "user" ? { ...m, content: (m.content as { text: string }[]).map((x) => x.text).join("") } : m)) });
    expect(flat(out)).toBe(flat(req));
    const none = await optimizeRequest(req, p, { feature: "api", model: req.model, family: familyOf(req.model), explicitCache: false });
    expect(none.req).toBe(req);
  });
  it("code and JSON in older messages stay byte-identical", async () => {
    const code = FENCE + "ts\nconst  a   =  1;   \n\n\n\n" + FENCE;
    const json = "{\n  \"a\":   1\n}";
    const req: ChatRequest = { model: "m", messages: [{ role: "system", content: "s" }, { role: "user", content: "see   this:\n" + code + "\n" + json }, { role: "assistant", content: "ok" }, { role: "user", content: "q" }] };
    const { req: out } = await optimizeRequest(req, policy, { feature: "assistant", model: "m" });
    expect(out.messages[1].content).toBe("see this:\n" + code + "\n" + json);
  });
});

describe("billing and analytics formulas", () => {
  it("bills the original size: actual prompt tokens plus the calibrated tokens the optimizer removed", () => {
    const r = { ...emptyReport("assistant", "m"), changed: true, origTokens: 10_000, optTokens: 4000, factor: 1.1 };
    expect(billedInput(r, { prompt_tokens: 4500, completion_tokens: 10 }, 9999)).toBe(4500 + 6600);
    expect(billedInput({ ...r, changed: false }, { prompt_tokens: 4500, completion_tokens: 10, cached_tokens: 4000 }, 9999)).toBe(4500);
    expect(billedInput(r, null, 9999)).toBe(9999);
    const c = new OptCall("api");
    expect(c.billedIn({ prompt_tokens: 7, completion_tokens: 1 }, 50)).toBe(7);
  });
  it("prices cache reads and writes for Gereh's actual cost; the customer's price does not change", () => {
    const p = { in: 1_000_000, out: 2_000_000 };
    expect(upstreamCost(p, { prompt: 1000, cached: 800, cacheWrite: 0, out: 100 }, { read: 0.1, write: 1.25 })).toBeCloseTo((200 + 80) + 200, 6);
    expect(upstreamCost(p, { prompt: 1000, cached: 0, cacheWrite: 1000, out: 0 }, { read: 0.1, write: 1.25 })).toBeCloseTo(1250, 6);
    const known = costs({ cost: p, sale: { in: 2_000_000, out: 4_000_000 }, cache: { read: 0.1, write: 1.25 }, usage: { prompt: 1000, cached: 800, cacheWrite: 0, out: 100 }, originalIn: 3000 });
    expect(known.source).toBe("model");
    expect(known.unopt).toBeCloseTo(3000 + 200, 6);
    const rep = costs({ cost: { in: 0, out: 0 }, sale: p, cache: { read: 0.1, write: 1.25 }, usage: { prompt: 1000, cached: 0, cacheWrite: 0, out: 0 }, originalIn: 2000, reportedUsd: 0.01, usdToman: 100_000 });
    expect(rep).toMatchObject({ source: "reported", actual: 1000, unopt: 2000 });
    expect(costs({ cost: { in: 0, out: 0 }, sale: p, cache: { read: 1, write: 1 }, usage: { prompt: 10, cached: 0, cacheWrite: 0, out: 0 }, originalIn: 10 }).source).toBe("sale-proxy");
  });
  it("token reduction, cost savings, margin, hit rate and fallback rate", () => {
    const row = (o: Partial<EventRow>): EventRow => ({ feature: "assistant", model: "m", changed: true, origEst: 1000, optEst: 600, billedIn: 1000, actualIn: 600, cachedTokens: 0, outTokens: 0, usageReported: true, charged: 100, actualCost: 30, unoptCost: 50, costSource: "model", validatorFailures: 0, fallback: "", overBudget: false, cacheHit: false, cacheBreakpoints: 0, langMismatch: false, ...o });
    const s = summarize([row({}), row({ origEst: 1000, optEst: 1000, changed: false, cachedTokens: 900, cacheHit: true, actualCost: 20, unoptCost: 50 }), row({ fallback: "timeout", costSource: "sale-proxy", charged: 999, actualCost: 0, unoptCost: 0 })]);
    expect(s.tokenReductionPct).toBe(26.67); // (3000 − 2200) / 3000; cached tokens are not removed tokens
    expect(s.costSavingsPct).toBe(50); // (100 − 50) / 100
    expect(s.margin).toBe(150); // known-cost rows: 200 charged − 50 cost
    expect(s.cacheHitRate).toBe(33.33);
    expect(s.fallbackRate).toBe(33.33);
  });
});
