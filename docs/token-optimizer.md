# Token optimizer («بهینه‌ساز توکن»)

An in-process layer that reduces the input tokens of Gereh's AI traffic and adds prompt caching, while the
customer is billed for the request as the customer (or the feature) built it. The savings go to Gereh.

Code: `src/server/ai/optimizer/`. Tests: `tests/unit/ai-opt.test.ts`, `tests/unit/ai-opt-benchmark.test.ts`,
`tests/server/ai-opt.test.ts`. Dataset: `tests/fixtures/ai-opt/` (built by `scripts/ai-opt-fixtures.mjs`).

## Architecture

Every model call already goes through `aiUpstream().chat()`. `aiUpstream()` now returns the provider wrapped by
`withOptimizer()` (`optimizer/gateway.ts`); `rawUpstream()` is the unwrapped provider (used only by the live
benchmark for the original side). A call site passes an `OptCall` as the fourth argument:

```ts
const opt = new OptCall("assistant");                    // the feature picks the default policy
const res = await aiUpstream().chat(req, signal, headers, opt);
// … after the answer:
const inT = opt.billedIn(usage, inEstOfTheOriginal);    // what the customer is billed for
await meter.close("success", { inTokens: inT, outTokens, charged: costOf(inT, outTokens, model), usage, opt });
```

Without an `OptCall` the feature is `playground`: prompt caching only, content untouched.

| Module | What it does |
|---|---|
| `analyzer.ts` | roles, content types, multimodal parts, tools; protected blocks (code fences, JSON, YAML, XML, shell lines) and spans (inline code, URLs, domains, paths, IPs, emails, identifiers, numbers, dates); negation and condition words in English and Persian |
| `prompt.ts` | system prompt: whitespace/format normalization outside protected blocks; exact and formatting-only duplicate rules removed. Rules whose words differ are never merged; short and `key: value` lines are deduped only inside their own section |
| `context.ts` | history: the latest user message, everything after it and the last N turns stay verbatim; older exact duplicates and long tool results (head + tail + key lines, `[… N lines omitted from tool result X …]`) ; deterministic summary of old turns (verbatim sentences: decisions, facts with numbers/ids and constraints, open questions, active tasks, references). The verbatim window moves in blocks of 4 turns so the summarized prefix stays byte-stable for caching |
| `markdown.ts` | repeated paragraphs (marker), heading chunks, BM25 section selection against the latest user message, `[section: heading path]` citations, one marker per omitted run listing every omitted title; sections with security/hard rules are always kept |
| `language.ts` | optional Persian→English adapter (LibreTranslate-compatible, local only), see below |
| `estimator.ts` | BPE tokenizer (`gpt-tokenizer`, o200k_base) + per-model calibration (EMA of actual ÷ estimate, `ai_opt_calibration`) for providers with other tokenizers; a per-script heuristic for texts over 400k characters |
| `validator.ts` | deterministic integrity check per changed message: *rewrite* steps must keep every protected block byte-identical and every span, number, date, URL, identifier, negation and condition word; *extract* steps may keep only whole verbatim lines/sentences around explicit markers. A failing message reverts to its previous state and is counted |
| `cache.ts` | stable-prefix rules, `cache_control` breakpoints per model family (configurable list, minimum size, read/write multipliers), cost check, prefix hash |
| `policy.ts` | per feature / model prefix / plan / request type; level 0–3, recent turns, max input tokens, tool-result limits, summary, sections, near-dedupe, cache, translate, time budget |
| `optimize.ts` | `optimizeRequest(req, policy, ctx) → { req, report }` |
| `call.ts` | `OptCall` and the billing rule `billedInput()` |
| `record.ts`, `analytics.ts`, `stats.ts` | `ai_opt_events` rows, the cost model and the admin formulas |
| `config.ts` | env defaults, kv overrides (`kv["ai_optimizer"]`), calibration store, observed cache hit rates |
| `benchmark.ts`, `offline.ts` | offline and live benchmark |

### Policies (defaults)

| Feature | Default | Notes |
|---|---|---|
| `api` (public API, gk- keys) | level 2, 6 recent turns verbatim | the admin's choice alone (row `api` in admin › بهینه‌ساز توکن: off, or level 0 = caching only). Customers have no switch and see nothing of it: same answer, and the usage they are shown and billed is the size of the request they sent |
| `playground` | level 2 | the panel playground, same rule |
| `panel-chat` | level 2, 6 recent turns, 24k budget | the panel chat history (stored messages are untouched) |
| `assistant` | level 2, 2 recent turns (its own 30-row window already limits the history), 30k budget | long tool results |
| `builder` (بافت) | level 1 | skills blocks are instructions: no section selection |
| `support-ai` | level 2 | |
| `explain`, `advisor`, `monitor`, `dbquery` | level 1 | short one-shot prompts |
| `model-test` | level 0, no cache | admin «تست اتصال» |

A JSON-mode request (`response_format`) never gets near-dedupe or section selection.

## Request lifecycle

1. The call site builds the request as today and passes `OptCall(feature)`.
2. `prepare()` (wrapper): env switch → kv settings → `resolvePolicy()` → cache family → calibration factor.
3. `optimizeRequest()`:
   1. system prompt: whitespace + dedupe (rewrite-checked), sections if the policy allows (extract-checked);
   2. older messages (before the latest user message): whitespace, repeated paragraphs, sections (checked);
   3. history: duplicates and tool-result shrink (checked), then the summary of old turns (checked against the
      original sentences);
   4. optional translation (its own fidelity checks);
   5. cache breakpoints.
   The input request is never mutated. Any exception → the original request (`fallback: "error"`); past the
   time budget (default 50 ms) → the original request (`fallback: "timeout"`).
4. Transport: with OpenRouter, `usage: { include: true }` is added so the provider reports `usage.cost` and
   cache details.
5. The response is returned as the upstream sent it: streams are not buffered or altered by the wrapper.
6. Billing (`meter.close`): the customer row (`ai_usage` / `platform_ai_usage`) and one `ai_opt_events` row.

## Billing: who gets the savings

* The customer pays `costOf(originalInputTokens, outputTokens)`, exactly today's formula.
* `originalInputTokens` = the provider's `prompt_tokens` when content was not changed, or `prompt_tokens + calibrated(estimate(original) − estimate(optimized))` when
  the optimizer removed content. Both are counted with the same tokenizer, and the difference is corrected by the
  model's calibration factor (learned from real usage), so it is not inflated.
* `prompt_tokens` includes cached tokens (OpenAI/OpenRouter convention), so cache reads are billed to the
  customer at the normal input price: the cache discount stays with Gereh.
* Recorded per request:
  * `ai_usage.in_tokens` — the request's input size as billed; `sent_tokens` — what the provider received;
    `cached_tokens` — cache reads (previously ignored; now read from `usage.prompt_tokens_details.cached_tokens`
    or `cache_read_input_tokens`). Same for `platform_ai_usage`.
  * `ai_opt_events` — feature, model, policy, estimates, billed input, actual prompt / cached / cache-write /
    output tokens, the customer charge, Gereh's actual cost, the unoptimized cost, the cost source, the
    provider-reported USD (`usage.cost` × 1e6), latency, validator failures, fallback, cache info, prefix hash.
* Gereh's actual cost (Toman): the provider's `usage.cost` × the USD rate when both are known (`reported`);
  otherwise the model's cost price (`ai_models.cost_in/out`, set in admin › مدل‌ها) with cache reads/writes
  priced by the family multipliers (`model`); otherwise sale prices as a proxy (`sale-proxy`: ratios only, no
  margin is shown for those rows).
* Customer views label the input as «حجم ورودی درخواست» (the request's input size), which is what is billed.
  The API response's `usage` is the provider's report, with its cost and cache details removed.

## Formulas (admin)

* Token Reduction % = (original − optimized) / original — estimated input tokens; cached tokens are not
  counted as removed.
* Cost Savings % = (cost if unoptimized − actual cost) / cost if unoptimized — same price basis; actual includes
  cache pricing.
* Margin = customer charge − actual cost, over rows with a known cost.
* Cache hit rate = requests with `cached_tokens > 0` / requests with reported usage.
* Fallback rate = requests sent unoptimized because of an error or the time budget / all requests.

## Prompt caching

* System prompt and tools come first and are not changed between turns (the optimizer never reorders
  messages; the summary window moves in blocks).
* Explicit `cache_control: {type: "ephemeral"}` only for the families that need it — Anthropic (`claude`,
  `anthropic/…`: up to 2 breakpoints, minimum 1024 tokens) and Gemini (`gemini`, `google/…`: 1 breakpoint,
  minimum 2048) — and only when the upstream accepts it: `AI_OPT_CACHE_CONTROL=auto` (OpenRouter only), `on`,
  `off`. OpenAI, DeepSeek and Grok cache automatically: nothing is added.
* Cost check: a breakpoint is added only when `expectedReuse × (1 − read) > write − 1` (Anthropic: reuse > 28%).
  The prior comes from the feature policy; after 20 requests the observed hit rate of the feature and family
  replaces it.
* A request that already carries `cache_control` is left as the customer built it.
* Minimums and multipliers per family can be overridden in `kv["ai_optimizer"].families`.

## Persian → English (optional, off)

Enabled per feature in admin, and only when `AI_OPT_TRANSLATE_URL` points at a local / self-hosted
LibreTranslate-compatible service (`POST /translate {q:[…], source:"fa", target:"en"}`). Never a paid LLM call.

* Cost-benefit: the estimated saving must exceed `AI_OPT_TRANSLATE_MIN_SAVING` tokens, or nothing is sent.
* Masking: protected blocks, spans and numbers travel as `⟦n⟧` placeholders.
* Fidelity: every placeholder back exactly as often as it went, the numbers unchanged, length ratio 0.5–3, no
  Persian left, translator confidence ≥ `AI_OPT_TRANSLATE_MIN_CONFIDENCE` when it reports one; otherwise that
  message stays Persian. Translator errors or timeouts (`AI_OPT_TRANSLATE_TIMEOUT_MS`) skip translation.
* The latest user message is kept in Persian unless `AI_OPT_TRANSLATE_LATEST=1`; stored conversations always
  keep the original.
* A system instruction tells the model to answer in Persian; `answerLanguageOk()` checks answers whose text
  reaches `meter.close`, and a mismatch is counted (`lang_mismatch`).

## Configuration

Environment (see `.env.example`):

| Variable | Default | |
|---|---|---|
| `AI_OPTIMIZER` | on | `0` disables everything — the rollback switch |
| `AI_OPT_CACHE_CONTROL` | `auto` | `auto` (OpenRouter only) / `on` / `off` |
| `AI_OPT_BUDGET_MS` | 50 | time budget of the optimization per request |
| `AI_USD_TOMAN` | — | Toman per USD for `usage.cost` |
| `AI_OPT_BENCH_MAX_USD` | 5 | cap of one live benchmark run |
| `AI_OPT_TRANSLATE_URL`, `_KEY`, `_MIN_SAVING` (300), `_MIN_CONFIDENCE` (0.8), `_TIMEOUT_MS` (1500), `_LATEST` | — | translation adapter |

Admin overrides (admin › API هوش مصنوعی › «بهینه‌ساز توکن», stored in `kv["ai_optimizer"]`): the master switch
(can only turn off), per-feature policy (enabled, level, recent turns, input budget, cache, translate), model
prefix and plan overrides (via the RPC), cache_control mode, family overrides, the USD rate and the benchmark
cap. OpenRouter is supported by setting `AI_UPSTREAM_URL=https://openrouter.ai/api/v1` and the catalog's
`upstream` ids (e.g. `anthropic/…`).

## API

Staff RPCs (group `aiOpt`, `src/server/rpc/ai-opt.ts`):

* `aiOpt.stats(days)` — summary, by feature, by model, by day, calibration factors;
* `aiOpt.settings()` / `aiOpt.saveSettings(patch)` — settings, effective policies;
* `aiOpt.offline()` — the offline benchmark;
* `aiOpt.benchStart(modelId, budgetUsd, judge)` — starts a live run in the background (one at a time);
* `aiOpt.benchList()` — the last 20 runs and their reports.

Public API: nothing. There is no customer-facing switch, header or key field (migration 0044 dropped the short-lived `ai_keys.optimize`). The usage in answers (JSON and the stream's usage chunk) carries the billed input size; provider cost and cache details are never shown.

## Install / deploy

Part of the app: `gereh update` pulls, builds and restarts as usual; migration `0043_ai_optimizer` runs on
start (new tables `ai_opt_events`, `ai_opt_calibration`, `ai_opt_benchmarks`; new columns on `ai_models`,
`ai_keys`, `ai_usage`, `platform_ai_usage`, all with defaults). No new service, no new dependency.

### Docker

The repository had no Dockerfile for the app, so an optional one was added (`Dockerfile`, `.dockerignore`):
`docker build -t gereh . && docker run -p 3000:3000 --env-file .env gereh`. It is not used by the supported
install and was not built in CI.

## Security

* No message content is logged or stored by the optimizer: `ai_opt_events` holds counts, costs, policy names
  and an FNV hash of the prefix. The existing opt-in body logging (`ai_bodies`) is unchanged.
* Upstream and translator keys stay server-side; the provider's cost and cache details are stripped from the
  usage customers receive.
* Stored conversations (panel chat, assistant, بافت) always keep the original messages; only the outgoing
  request is optimized.
* The latest user message, code, JSON, YAML, XML, shell lines, URLs, paths, IPs, identifiers, numbers, dates,
  negations and tool definitions are never changed; nothing is invented (every kept line is verbatim).

## Rollback

`AI_OPTIMIZER=0` in the environment (and restart) sends every request exactly as built, without cache
breakpoints or transport additions; billing then uses the provider's `prompt_tokens` as before. The admin switch
does the same without a restart (within 10 s). Per feature: disable it in admin.

## Benchmark

* Offline (deterministic, no network): `npx vitest run tests/unit/ai-opt-benchmark.test.ts`
  (`AI_OPT_BENCH_PRINT=1` prints the table), or admin › بهینه‌ساز توکن › «محک آفلاین».
* Live (admin-triggered only, never automatic): admin › بهینه‌ساز توکن › «محک زنده»: pick a model and a USD
  budget (≤ `AI_OPT_BENCH_MAX_USD`, default 5). Each fixture is sent twice to the same model with the same
  parameters (temperature 0, max_tokens 400) — original through the raw provider, optimized through the
  production path. Before each pair the worst-case cost is checked against what is left of the budget
  (provider-reported `usage.cost` when available, else model prices ÷ the USD rate, else a deliberately high
  default of 15/75 USD per 1M tokens). Answers are compared by tool call, JSON, code, expected strings or
  lexical similarity; an optional LLM judge runs inside the same budget. The report is saved in
  `ai_opt_benchmarks` and shown in admin.
* Regenerate the dataset: `node scripts/ai-opt-fixtures.mjs` (deterministic).

### Offline results — ESTIMATES, not billed numbers

Estimated input tokens (the heuristic estimator, uncalibrated) on the synthetic dataset, with each feature's
default policy. Every integrity check passed (validator, latest message, tools, tool calls, images).

| workload | feature / policy | original (est.) | optimized (est.) | reduction | steps |
|---|---|---:|---:|---:|---|
| public API (default) | api:L0 | 5803 | 5803 | 0% | — (cache only) |
| tool calls (public API) | api:L2 | 5803 | 5803 | 0% | — (all within the 6 recent turns) |
| assistant history + tool results | assistant:L2 | 12003 | 6154 | 48.7% | toolShrink×1, duplicate×5 |
| long Markdown (handbook in system) | panel-chat:L2 | 4404 | 2972 | 32.5% | system×1 |
| English chat | panel-chat:L2 | 1776 | 1298 | 26.9% | system×1, whitespace×8, repeated×7 |
| JSON-heavy (dbquery) | dbquery:L1 | 10856 | 9768 | 10% | duplicate×1 |
| بافت project | builder:L1 | 2833 | 2821 | 0.4% | system×1 |
| code-heavy | panel-chat:L2 | 8651 | 8651 | 0% | — (code is never touched) |
| multimodal | panel-chat:L2 | 5475 | 5475 | 0% | whitespace×5 |
| mixed fa/en | panel-chat:L2 | 470 | 470 | 0% | — |
| Persian support | support-ai:L2 | 941 | 941 | 0% | — |

Reading: savings come from long histories with repeated or long tool results, duplicated instruction lines
and repeated boilerplate; short conversations, code and the latest message are left alone by design. Real
billed numbers come from the live benchmark and from `ai_opt_events` in production.

## بافت (the builder)

* **«طرح حرفه‌ای» (`src/server/builder/enhance.ts`):** a new project's request under 700 characters is first
  turned into a professional build brief by a short call (English, fixed sections, every concrete detail of the
  request kept verbatim, at most ~280 words). The build gets the customer's words and the brief; where they
  differ, the customer's words win. Charged with the run, like the self-review. Any failure builds from the
  request as written. `BUILDER_BRIEF=0` turns it off; `BUILDER_BRIEF_MODEL` picks the model.
* **Prompt cache:** the system prompt holds only the task's core skills, so it is identical between runs of the
  same kind, stack and language and the provider's cache serves it; skills the request's words bring in lead the
  user message.
* **Focused edits:** an edit of a project over 40k characters sends in full only the files the request concerns
  (up to 36k characters: named files, entry files, word matches) and an outline of the rest (size, title,
  headings, ids, functions, routes). Site-wide requests (colors, fonts, header/footer, menu, language, every
  page…) still send everything. A file the model saw only as an outline is never written or deleted.
* **Focused review:** an edit's self-review sees the files the run changed and those with errors, not the whole
  project.

## Known limits

* The tokenizer is OpenAI's o200k; for other providers the billed "removed" tokens use the calibrated
  difference of two counts until calibration has samples for that model.
* Section selection only applies to system prompts and older user messages; a large document in the latest
  user message is never cut.
* The time budget is checked between steps; a single very large message can overrun it slightly before the
  fallback.
* The answer-language check runs where the answer text reaches `meter.close` (not on every streamed path).

---

## خلاصه فارسی

**بهینه‌ساز توکن** لایه‌ای درون برنامه است که پیش از هر فراخوانی مدل (از مسیر `aiUpstream().chat`) درخواست را
کوچک‌تر می‌کند و کش پرامپت را اعمال می‌کند؛ صرفه‌جویی برای گره است.

* **API عمومی (کلیدهای gk-):** روشن یا خاموش بودن فقط با مدیر است (ردیف «api»؛ پیش‌فرض: روشن، سطح متعادل).
  مشتری کلید، هدر یا گزینه‌ای برای آن ندارد و چیزی از آن نمی‌بیند: همان پاسخ مدل برمی‌گردد و حجم ورودی‌ای که
  در پاسخ و صورت‌حساب می‌بیند حجم درخواست خودش است.
* **بخش‌های داخلی** (دستیار گره، بافت، پشتیبانی AI، توضیح خطا، مشاور هزینه، پایش، پرسش از دیتابیس، چت پنل):
  به‌طور پیش‌فرض روشن، با سیاست جدا برای هر بخش.
* **صورت‌حساب:** مشتری بر پایه حجم ورودی اصلی درخواست پرداخت می‌کند (همان فرمول `costOf`)؛ تخفیف کش هم نزد گره
  می‌ماند. هزینه واقعی گره، توکن‌های کش‌شده و حاشیه سود ثبت و در مدیریت نمایش داده می‌شود.
* **حفاظت:** آخرین پیام کاربر، کد، JSON، YAML، XML، دستورهای شل، URL، مسیر، IP، شناسه، عدد، تاریخ، واژه‌های
  نفی و تعریف ابزارها هرگز تغییر نمی‌کنند؛ هر بخشی که حذف شود نشانگر صریح دارد و هر تغییر اعتبارسنجی می‌شود و
  در صورت شکست به متن اصلی برمی‌گردد. متن پیام‌ها هیچ‌جا ثبت نمی‌شود.
* **ترجمه فارسی→انگلیسی:** اختیاری و خاموش؛ فقط با سرویس محلی LibreTranslate، با بررسی صرفه، وفاداری و اطمینان.
* **بافت:** درخواست کوتاه برای پروژه جدید اول به «طرح حرفه‌ای» تبدیل می‌شود (`BUILDER_BRIEF=0` خاموشش می‌کند)؛
  پرامپت سیستم ثابت می‌ماند تا کش شود؛ ویرایش پروژه‌های بزرگ فقط فایل‌های مربوط را کامل می‌فرستد و بازبینی فقط
  فایل‌های تغییرکرده را می‌بیند.
* **شمارش توکن:** با کتابخانه `gpt-tokenizer` و کالیبراسیون برای هر مدل.
* **بازگشت:** `AI_OPTIMIZER=0` همه‌چیز را خاموش می‌کند.
* **محک:** آفلاین (تخمینی) و زنده (فقط با دستور مدیر، با سقف ۵ دلار برای هر اجرا).
* **مدیریت:** API هوش مصنوعی › «بهینه‌ساز توکن».
