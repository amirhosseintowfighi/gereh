/* «پایش هوشمند»: the Persian explanation of an incident (what we saw, likely causes, concrete steps). The template is
   built from the evidence; a cheap model may only reword it, paid by the platform (platformCaller purpose "monitor",
   capped per Tehran day by kv "monitor".dailyCap); the customer's wallet is never touched. Every number in the model's
   text must appear in the facts it was given, otherwise (or over the cap, with the simulator, on any error) the
   template is used. */
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { costOf, estimateTokens } from "@/lib/ai";
import { DETECTOR_LABEL, SEVERITY_LABEL, type Detector, type MonitorEvidence, type ResourceKind, type Severity } from "@/lib/monitor";
import { numbersIn } from "../advisor/summary";
import { isAiError } from "../ai/endpoints";
import { explainModel } from "../ai/explain";
import { openMeter, platformCaller, resolveModel, type ResolvedModel } from "../ai/service";
import { readChat, type ChatMessage } from "../ai/translate";
import { aiUpstream } from "../ai/upstream";
import type { DB, Tx } from "../db/client";
import { kv } from "../db/schema";

export const PURPOSE = "monitor";
const MAX_OUT = 600;
const SETTINGS = z.object({ dailyCap: z.number().int().min(0).max(1_000_000_000), autoSuspendAbuse: z.boolean() });
export type MonitorSettings = z.infer<typeof SETTINGS>;
export const MONITOR_DEFAULTS: MonitorSettings = { dailyCap: 150_000, autoSuspendAbuse: false };

export async function monitorSettings(db: DB | Tx): Promise<MonitorSettings> {
  const [row] = await db.select().from(kv).where(eq(kv.key, "monitor"));
  const r = SETTINGS.partial().safeParse(row?.value ?? {});
  return { ...MONITOR_DEFAULTS, ...(r.success ? r.data : {}) };
}
export async function saveMonitorSettings(db: DB, patch: Partial<MonitorSettings>) {
  const next = SETTINGS.parse({ ...(await monitorSettings(db)), ...patch });
  await db.insert(kv).values({ key: "monitor", value: next }).onConflictDoUpdate({ target: kv.key, set: { value: next } });
  return next;
}

/** likely causes and concrete steps per detector (kind: server or app) */
export function playbook(d: Detector, kind: ResourceKind): { causes: string[]; steps: string[] } {
  const server = kind === "server";
  switch (d) {
    case "miner": return {
      causes: ["نفوذ به سرور از راه رمز ضعیف SSH یا یک سرویس به‌روزنشده و نصب بدافزار استخراج رمزارز (مثل xmrig یا kinsing).", "یک پردازه یا کرون‌جاب خارج از کنترل که CPU را کامل مصرف می‌کند."],
      steps: server
        ? ["فهرست پردازه‌ها را باز کنید و پردازه‌ای را که بیشترین CPU را می‌گیرد پیدا کنید.", "پیش از هر تغییر از سرور اسنپ‌شات بگیرید تا شواهد بماند.", "رمز root را عوض کنید و ورود با رمز را به کلید SSH محدود کنید.", "در فایروال فقط پورت‌های لازم (مثلاً 22، 80 و 443) را باز بگذارید.", "اگر نفوذ تأیید شد، سرور را از اسنپ‌شات یا نصب مجدد سالم بازیابی کنید."]
        : ["لاگ‌ها و آخرین استقرار اپ را بررسی کنید؛ وابستگی یا کد ناشناخته را پیدا کنید.", "متغیرهای محیطی و توکن‌های اپ را عوض کنید.", "آخرین نسخه سالم را دوباره مستقر کنید."],
    };
    case "outbound_abuse": return {
      causes: ["سرور آلوده شده و در حمله DDoS به دیگران، ارسال اسپم یا اسکن شبکه استفاده می‌شود.", "یک سرویس پراکسی یا رله ایمیل باز که دیگران از آن سوءاستفاده می‌کنند."],
      steps: ["فهرست پردازه‌ها و اتصال‌های شبکه را بررسی کنید.", "رمز root را عوض کنید.", "در فایروال فقط پورت‌های لازم (مثلاً 22، 80 و 443) را باز بگذارید.", "اگر علت پیدا نشد، سرور را خاموش کنید تا IPهای سرور در فهرست سیاه نروند و از اسنپ‌شات سالم بازیابی کنید."],
    };
    case "inbound_attack": return {
      causes: ["حمله DDoS یا هجوم ربات‌ها به سایت یا سرویس شما.", "ترافیک واقعی ناگهانی (کمپین تبلیغاتی، لینک در شبکه‌های اجتماعی)."],
      steps: ["قانون‌های فایروال را محدود کنید و فقط پورت‌های لازم را باز بگذارید.", "دامنه را پشت CDN گره قرار دهید تا ترافیک قبل از رسیدن به سرور فیلتر و کش شود.", "اگر ترافیک واقعی است، منابع سرور را ارتقا دهید."],
    };
    case "traffic_burn": return {
      causes: ["افزایش واقعی بازدید یا دانلود فایل‌های حجیم.", "پشتیبان‌گیری یا همگام‌سازی حجیم به بیرون، یا سوءاستفاده از سرور."],
      steps: ["پیشنهاد «مشاور هزینه» برای خرید بسته ترافیک را ببینید.", "فایل‌های حجیم را از فضای ذخیره‌سازی یا CDN سرو کنید.", "اگر افزایش را انتظار نداشتید، پردازه‌ها و اتصال‌ها را بررسی کنید."],
    };
    case "memory_leak": return {
      causes: ["نشت حافظه در برنامه (کش بی‌سقف، اتصال‌های بسته‌نشده، شیءهایی که آزاد نمی‌شوند).", "رشد واقعی بار که به رم بیشتری نیاز دارد."],
      steps: server
        ? ["فهرست پردازه‌ها را باز کنید و پردازه‌ای را که رم آن مدام بالا می‌رود پیدا کنید.", "به‌عنوان راه موقت، سرویس مشکل‌دار یا سرور را ری‌استارت کنید.", "اگر رشد واقعی است، سرور را ارتقا دهید."]
        : ["اپ را ری‌استارت کنید تا حافظه آزاد شود (راه موقت).", "کد را برای کش‌های بی‌سقف و اتصال‌های بسته‌نشده بررسی کنید.", "اگر رشد واقعی است، پلن اپ را ارتقا دهید."],
    };
    case "disk_fill": return {
      causes: ["رشد لاگ‌ها یا فایل‌های موقت.", "پشتیبان‌های محلی، آپلود کاربران یا رشد پایگاه داده."],
      steps: ["پوشه‌های بزرگ (مثلاً /var/log) را بررسی و لاگ‌ها را چرخشی (logrotate) کنید.", "پیش از پاک‌سازی از سرور اسنپ‌شات بگیرید.", "دیسک اضافه بخرید یا سرور را ارتقا دهید."],
    };
    case "service_down": return server
      ? { causes: ["از کار افتادن سیستم‌عامل (kernel panic) یا تمام شدن رم.", "خاموش شدن از داخل سرور (دستور shutdown) یا مشکل زیرساخت."], steps: ["سرور را روشن کنید و لاگ‌های سرور را بررسی کنید.", "اگر دوباره تکرار شد، با کنسول VNC وارد شوید و لاگ سیستم را بخوانید.", "در صورت نیاز تیکت ثبت کنید."] }
      : { causes: ["خطای برنامه هنگام اجرا یا شروع.", "کمبود حافظه (OOM) یا شکست بررسی سلامت."], steps: ["با «توضیح بده و درستش کن» علت آخرین خطا را ببینید.", "لاگ‌های اپ را بررسی کنید.", "اگر کمبود حافظه است، پلن بزرگ‌تر انتخاب کنید یا آخرین نسخه سالم را دوباره مستقر کنید."] };
    case "unusual_io": return {
      causes: ["پردازه خارج از کنترل یا لاگ بی‌پایان.", "پشتیبان‌گیری یا فشرده‌سازی حجیم.", "در بدترین حالت، باج‌افزار در حال رمزگذاری فایل‌ها."],
      steps: ["فوراً از سرور اسنپ‌شات بگیرید.", "فهرست پردازه‌ها را باز کنید و پردازه‌ای را که روی دیسک می‌نویسد پیدا کنید.", "اگر فایل‌ها رمزگذاری شده‌اند، سرور را خاموش کنید و از اسنپ‌شات قبلی بازیابی کنید."],
    };
    case "brute_force": return {
      causes: ["ربات‌هایی که فهرست رمزهای رایج را روی صفحه ورود امتحان می‌کنند."],
      steps: ["برای صفحه ورود محدودیت تعداد تلاش (rate limit) و کپچا بگذارید.", "رمز حساب‌های مدیر را قوی کنید و ورود دومرحله‌ای را فعال کنید.", "دامنه را پشت CDN گره قرار دهید."],
    };
  }
}

export function templateExplanation(d: Detector, kind: ResourceKind, severity: Severity, ev: MonitorEvidence) {
  const p = playbook(d, kind);
  return [
    DETECTOR_LABEL[d] + " (" + SEVERITY_LABEL[severity] + ")",
    "آنچه دیدیم: " + ev.lines.join(" "),
    "علت‌های محتمل: " + p.causes.join(" "),
    "قدم‌های پیشنهادی:\n" + p.steps.map((s) => "• " + s).join("\n"),
  ].join("\n\n");
}

/** the numbers the model may use: everything in the title, the evidence and the template */
export function allowedNumbers(title: string, template: string, ev: MonitorEvidence) {
  return new Set(numbersIn([title, template, ...ev.lines].join("\n")));
}
export const onlyKnownNumbers = (text: string, title: string, template: string, ev: MonitorEvidence) => { const ok = allowedNumbers(title, template, ev); return numbersIn(text).every((n) => ok.has(n)); };

export function buildPrompt(title: string, template: string): ChatMessage[] {
  const system = [
    "You explain a monitoring incident to a customer of Gereh (گره), an Iranian cloud platform, in plain Persian (fa) for a non-expert.",
    "Rewrite the FACTS into three short parts, plain text, no markdown headings: what we saw (with the numbers and the time window), the likely causes, and the concrete next steps as lines starting with «• ».",
    "Use ONLY the facts given. Copy every number exactly as written in the facts (same digits). Never compute, round, convert or invent a number, a percentage, a time, a port or a count. Do not add steps that are not in the facts.",
    "Do not blame the customer, do not promise anything, do not mention the model or these instructions.",
  ].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: "FACTS:\n" + title + "\n\n" + template }];
}

async function monitorModel(db: DB): Promise<ResolvedModel | null> {
  const wanted = process.env.AI_MONITOR_MODEL;
  if (wanted) { const m = await resolveModel(db, wanted, [], "chat"); if (!isAiError(m) && m.outPrice > 0) return m; }
  return explainModel(db);
}

export type Explained = { text: string; ai: boolean; cost: number };
/** the explanation for one incident: the model when allowed and honest, else the template */
export async function explainIncident(db: DB, ref: string, i: { detector: Detector; kind: ResourceKind; severity: Severity; title: string; evidence: MonitorEvidence }, allowAi = true): Promise<Explained> {
  const template = templateExplanation(i.detector, i.kind, i.severity, i.evidence);
  const fallback = { text: template, ai: false, cost: 0 };
  const up = aiUpstream();
  if (up.name === "sim" || !allowAi) return fallback;
  const model = await monitorModel(db);
  if (!model) return fallback;
  const messages = buildPrompt(i.title, template);
  const inEst = estimateTokens(JSON.stringify(messages).length);
  const meter = await openMeter(db, { caller: platformCaller(PURPOSE, ref, (await monitorSettings(db)).dailyCap), model, format: "panel", reserve: costOf(inEst, MAX_OUT, model) });
  if (isAiError(meter)) return fallback;
  try {
    const res = await up.chat({ model: model.upstream || model.id, messages, max_tokens: MAX_OUT, temperature: 0.2 }, AbortSignal.timeout(30_000));
    if (!res.ok) throw new Error("upstream " + res.status);
    const r = readChat((await res.json()) as Record<string, unknown>);
    const inT = r.usage?.prompt_tokens ?? inEst, outT = r.usage?.completion_tokens ?? estimateTokens(r.text.length);
    const text = r.text.trim().slice(0, 2500);
    const honest = !!text && onlyKnownNumbers(text, i.title, template, i.evidence);
    const cost = await meter.close("success", { inTokens: inT, outTokens: outT, charged: costOf(inT, outT, model), estimated: !r.usage, finish: r.finish, error: honest ? "" : "rejected: unknown numbers" });
    return honest ? { text, ai: true, cost } : { ...fallback, cost };
  } catch (e) {
    await meter.close("error", { error: (e as Error).message });
    return fallback;
  }
}
