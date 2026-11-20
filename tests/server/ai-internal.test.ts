import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EXPLAIN_MIN_FEE, type Explanation } from "@/lib/explain";
import { gateway } from "@/server/ai/gateway";
import { internalModel, setInternalUpstream } from "@/server/ai/internal";
import { createKey } from "@/server/ai/service";
import { setAiUpstream, type Upstream } from "@/server/ai/upstream";
import { assistantModels, staffSystemPrompt, systemPrompt } from "@/server/assistant/prompt";
import { paasDeployments } from "@/server/db/schema";
import { drain } from "@/server/worker";
import { asUser, call, db, fresh } from "./helpers";

const ENV = { AI_INTERNAL_URL: "http://10.0.0.5:11434/v1", AI_INTERNAL_MODEL: "qwen3.5:9b" };
const setEnv = (on: boolean) => { for (const [k, v] of Object.entries(ENV)) { if (on) process.env[k] = v; else delete process.env[k]; } };

/** a model service that records which model each request asked for */
function fake(text: string) {
  const models: string[] = [];
  const up: Upstream = {
    name: "http",
    async chat(req) { models.push(String(req.model)); return Response.json({ id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 40 } }); },
    async models() { return []; },
  };
  return { up, models };
}
const ANSWER = JSON.stringify({ summary: "اپ روی پورت دیگری گوش می‌دهد.", cause: "پورت", steps: ["پورت را درست کنید."], actions: [] });

beforeAll(() => { process.env.PAAS_SIM_BUILD_SECONDS = "0"; process.env.PAAS_POLL_MS = "0"; });
beforeEach(async () => { await fresh(); setAiUpstream(null); setInternalUpstream(null); setEnv(false); });
afterEach(() => { setAiUpstream(null); setInternalUpstream(null); setEnv(false); });

const settle = async () => { for (let i = 0; i < 12; i++) if (!(await drain(await db()))) break; };

describe("internal model (AI_INTERNAL_*) for the site's own features", () => {
  it("without it, nothing changes: the site features pick from the paid catalog", async () => {
    expect(internalModel()).toBeNull();
    const list = await assistantModels(await db());
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((m) => m.vendor !== "gereh-internal" && m.outPrice > 0)).toBe(true);
  });

  it("with it, the assistant uses only the internal model, at price 0", async () => {
    setEnv(true);
    expect(await assistantModels(await db())).toEqual([expect.objectContaining({ id: "qwen3.5:9b", vendor: "gereh-internal", inPrice: 0, outPrice: 0, tools: true })]);
  });

  it("a site feature (error explanation) goes to the internal model and never to the paid provider", async () => {
    setEnv(true);
    const paid = fake(ANSWER), own = fake(ANSWER);
    setAiUpstream(paid.up); setInternalUpstream(own.up);
    await asUser();
    const appId = await call<string>("paas.createApp", { name: "bad-port", stack: "node", source: "git", gitUrl: "https://github.com/acme/sim-badport.git", gitBranch: "main", port: 3000, planId: "app-micro", env: [] });
    await settle();
    const [dep] = await (await db()).select().from(paasDeployments).where(and(eq(paasDeployments.appId, appId), eq(paasDeployments.status, "failed")));
    const x = await call<Explanation>("ai.explain", "paas", appId, dep.id);
    expect(x).toMatchObject({ simulated: false, summary: "اپ روی پورت دیگری گوش می‌دهد." });
    expect(own.models).toEqual(["qwen3.5:9b"]);
    expect(paid.models).toEqual([]);
    // the model costs Gereh nothing; the feature's own minimum fee is unchanged
    expect(x.charged).toBe(EXPLAIN_MIN_FEE);
  });

  it("the AI API sold to customers keeps the paid provider and never lists or serves the internal model", async () => {
    setEnv(true);
    const paid = fake("paid answer"), own = fake("local answer");
    setAiUpstream(paid.up); setInternalUpstream(own.up);
    const key = (await createKey(await db(), "u1", { name: "t", models: [], dailyCap: 0, monthlyCap: 0, rpm: 120, expiresDays: 0 })).key;
    const d = await db();
    const send = (path: string, init: { method?: string; body?: unknown }) =>
      gateway(d, new Request("https://api.gereh.dev/" + path, { method: init.method ?? "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: init.body ? JSON.stringify(init.body) : undefined }), path);
    const r = await send("v1/chat/completions", { body: { model: "gpt-5.6-luna", messages: [{ role: "user", content: "سلام" }], max_tokens: 50 } });
    expect(r.status).toBe(200);
    expect(paid.models).toEqual(["gpt-5.6-luna"]);
    expect(own.models).toEqual([]);
    expect((await send("v1/chat/completions", { body: { model: "qwen3.5:9b", messages: [{ role: "user", content: "سلام" }] } })).status).toBe(404);
    const list = (await (await send("v1/models", { method: "GET" })).json()) as { data: { id: string }[] };
    expect(list.data.map((m) => m.id)).not.toContain("qwen3.5:9b");
  });

  it("the conversational prompts say who they are: «من دستیار هوش مصنوعی گره هستم»", () => {
    const customer = systemPrompt({ name: "امیر", context: "", summary: "", readOnly: false, today: "۱۴۰۵/۰۸/۲۹" });
    const staff = staffSystemPrompt({ name: "مدیر", role: "owner", tools: [], summary: "", today: "۱۴۰۵/۰۸/۲۹" });
    for (const p of [customer, staff]) {
      expect(p).toContain("من دستیار هوش مصنوعی گره هستم.");
      expect(p).toContain("Never name the underlying model");
    }
  });
});
