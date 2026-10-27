/* «پشتیبانی AI» without a model service (no AI_UPSTREAM_KEY), and its deterministic guards.
   - guard(): reads ONLY the customer's own words and finds the always-escalate categories, a request for a human and
     injection attempts. It runs on every ticket, model or not, so a model talked into "category: how-to" still
     cannot auto-answer a refund dispute.
   - simulate(): a rule-based classifier and replier over the same facts the model sees (tests, demos, offline, and the
     free fallback when the model fails or the daily budget is spent). Persian, like the panel. */
import { fa } from "@/lib/format";
import { ALWAYS_ESCALATE, type SupportCategory } from "@/lib/support-ai";

export type Facts = {
  subject: string;
  /** the customer-visible thread, oldest first, already redacted */
  thread: { from: "customer" | "support"; text: string }[];
  services: { kind: "server" | "app" | "database" | "domain"; id: string; name: string; status: string; detail: string; link: string }[];
  /** failed tasks, failed deployments, delayed deliveries (one line each) */
  problems: string[];
  billing: { balance: number; monthSpent: number; unpaidInvoices: number; unpaidTotal: number; invoices: { id: string; status: string; total: number }[] } | null;
  kb: { title: string; slug: string; description: string }[];
  /** the service the ticket is about, when it names one */
  resource: { kind: string; id: string; name: string; status: string; detail: string; link: string } | null;
};
export type Answer = { category: SupportCategory; confidence: number; needsHuman: boolean; reason: string; reply: string; internalNote: string; suggestedActions: string[] };

const norm = (s: string) => s.replace(/[‌‏]/g, " ").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).toLowerCase();

/** attempts to steer the model (or a reviewer) through the ticket text */
const INJECTION = /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|rules|messages)|disregard (the|all|your) (instructions|rules)|system prompt|you are now|developer mode|jailbreak|act as (an? )?(admin|system|developer)|<\/?\s*(system|tool_result|instructions?)\b|"?(needsHuman|confidence|category|mode)"?\s*[:=]|دستور(ات|العمل)?(‌| )?(های)? ?(قبلی|بالا|سیستم).{0,20}(نادیده|فراموش)|نادیده بگیر|تو (الان|از این به بعد|اکنون) .{0,20}(ادمین|مدیر|سیستم)|حالت.{0,15}(را )?(خودکار|auto).{0,10}(کن|بگذار)|اعتبار.{0,20}(اضافه|شارژ) کن|موجودی.{0,20}(اضافه|زیاد) کن/i;
const HUMAN = /پشتیبان انسانی|اپراتور|کارشناس (انسانی|واقعی)|آدم واقعی|با یک انسان|human (agent|support)|real person|talk to (a )?(human|person|agent)/;
const ANGRY = /افتضاح|مسخره|بی ?شرف|شرم ?آور|لعنت|کلاهبردار|دزد|آشغال|بدترین|بی ?عرضه|بی ?کفایت|اعتراض دارم|شکایت (دارم|می ?کنم)|ناراضی|خسته شدم|دیگه بسه|حالم به ?هم|!{3,}|\bwtf\b|terrible|worst|scam|unacceptable|ridiculous/;
const RULES: [SupportCategory, RegExp][] = [
  ["abuse", /سوء ?استفاده|\babuse\b|فیشینگ|phishing|اسپم|\bspam\b|ddos|دیداس|حمله (به|شده)|هک (شده|کرده)|نفوذ (شده|کرده)|شکایت قضایی|پلیس|فتا|حقوقی|وکیل|دادگاه|\blegal\b|dmca|کپی ?رایت|نشت (اطلاعات|داده)|\bleak|آسیب ?پذیری|vulnerab|security incident|بدافزار|malware|ویروس/],
  ["data-loss", /(داده|اطلاعات|فایل|دیتابیس|پایگاه داده|بکاپ|پشتیبان|ایمیل)(ها|های)?(م)? .{0,25}(پاک شد|پاک شده|از دست (رفت|رفته|دادم)|حذف شد|حذف شده|گم شد|گم شده|از بین رفت)|data loss|lost (my |all )?(data|files)/],
  ["refund", /بازگشت (وجه|پول)|پول(م|مو|ام)? .{0,12}(برگرد|پس بد|برگشت)|برگشت پول|استرداد|ریفاند|\brefund|chargeback|(دو ?بار|اضافه|اشتباهی?) (کسر|کم|برداشت) (شد|شده|کرد)|اختلاف (مبلغ|حساب)|جریمه.{0,10}(ناحق|اشتباه)|اعتراض به (صورتحساب|فاکتور)/],
  ["account-access", /(رمز|پسورد|گذرواژه)(م)?.{0,20}(یادم|فراموش)|نمی ?(توانم|تونم) وارد|وارد (حساب|پنل).{0,15}نمی|دسترسی.{0,15}حساب.{0,15}(ندارم|از دست)|حساب(م)? (هک|مسدود|قفل)|انتقال مالکیت|مالکیت (حساب|دامنه|سرور)|تغییر (ایمیل|مالک) حساب|(کد|ورود) دو ?مرحله.{0,20}(گم|از دست|ندارم)|\b2fa\b.{0,20}(lost|lose)|account (locked|access|ownership)/],
  ["money-or-deletion", /(حذف|پاک|بستن) (حساب|اکانت|همه (سرور|سرویس))|(حساب|اکانت|همه (سرور|سرویس|داده))[^.\n]{0,25}(را )?(حذف|پاک|ببندید|ببند|غیرفعال) ?(کن|کنید|شود)?|انتقال (وجه|پول|موجودی|اعتبار)|موجودی.{0,15}(منتقل|انتقال|برداشت|تسویه)|واریز (کنید|به کارت)|delete (my )?(account|all)|close my account|transfer (the )?(money|balance|credit)|withdraw/],
];

export type Guard = { escalate: SupportCategory | null; human: boolean; injection: boolean };
/** the customer's own words only; never tool results */
export function guard(customerText: string): Guard {
  const t = norm(customerText);
  const hit = RULES.find(([, re]) => re.test(t));
  return { escalate: hit ? hit[0] : ANGRY.test(t) ? "complaint" : null, human: HUMAN.test(t), injection: INJECTION.test(customerText) || INJECTION.test(t) };
}
/** the customer's words with injection-looking lines dropped, for classification */
export const withoutInjection = (text: string) => text.split(/\n|(?<=[.!؟?])\s+/).filter((l) => !INJECTION.test(l) && !INJECTION.test(norm(l))).join("\n");

/** promises the AI must never make (money, credits, SLAs, timelines) */
const PROMISE = /بازگشت (وجه|پول)|استرداد|(اعتبار|شارژ) (هدیه|رایگان|جبرانی)|جبران (می|خواهیم|کنیم)|تضمین (می|کنیم)|قول می ?دهیم|(تا|ظرف|طی) [^\s]+ (ساعت|دقیقه|روز)(ی)? (آینده|دیگر)|ظرف [^\s]+ (ساعت|دقیقه|روز)|\brefund|\bcredit|guarantee|within \d+ (hours?|minutes?|days?)/i;
export const promises = (reply: string) => PROMISE.test(norm(reply));

const STOPPED = new Set(["stopped", "suspended", "failed", "crashed", "error", "sleeping"]);
const STATUS_FA: Record<string, string> = { running: "روشن", stopped: "خاموش", suspended: "معلق", provisioning: "در حال آماده‌سازی", failed: "ناموفق", crashed: "از کار افتاده", building: "در حال ساخت", deploying: "در حال استقرار", live: "فعال", active: "فعال", sleeping: "در خواب", pending: "در انتظار" };
const statusFa = (s: string) => STATUS_FA[s] ?? s;
const kindFa: Record<string, string> = { server: "سرور", app: "اپ", database: "پایگاه داده", domain: "دامنه" };
const kbLinks = (kb: Facts["kb"]) => kb.map((a) => "- [" + a.title + "](/kb/" + a.slug + ")").join("\n");
const ASSISTANT = "اگر بخواهید، «دستیار گره» (/panel/assistant) می‌تواند پس از تأیید شما این کار را انجام دهد.";

function classify(t: string, f: Facts): SupportCategory {
  if (/\bdns\b|رکورد|نیم ?سرور|name ?server|\bns[12]?\b|cname|a record|اشاره (به|کند)|وصل کردن دامنه|اتصال دامنه/.test(t)) return "dns";
  if (/خاموش|روشن نمی|بالا نمی|بالا نیست|قطع (است|شد|شده)|\bdown\b|در دسترس نیست|باز نمی ?شود|کار نمی ?کند|وضعیت|status/.test(t)) return "status";
  if (/خطا|ارور|error|\b50[0234]\b|crash|failed|ناموفق|استقرار نشد|بیلد/.test(t)) return "known-error";
  if (/صورتحساب|فاکتور|پرداخت|کیف پول|موجودی|invoice|شارژ|هزینه/.test(t)) return "billing";
  if (/قیمت|پلن|خرید|تعرفه|ارتقا|تخفیف/.test(t)) return "sales";
  if (/چطور|چگونه|آموزش|راهنما|how (do|to|can)|\bhow\b|می ?شود .{0,20}\?|؟/.test(t) && f.kb.length) return "how-to";
  return f.kb.length ? "how-to" : "other";
}

/** the deterministic answer; `customer` is the customer's own text (latest messages) */
export function simulate(customer: string, f: Facts): Answer {
  const g = guard(customer);
  const t = norm(withoutInjection(customer));
  const hello = "سلام، وقت بخیر.";
  const note: string[] = [];
  if (g.injection) note.push("متن تیکت شامل دستورالعمل‌هایی برای تغییر رفتار هوش مصنوعی بود؛ نادیده گرفته شد.");

  if (g.escalate || g.human) {
    const category: SupportCategory = g.escalate ?? "other";
    const why = g.escalate ? "دسته «" + category + "» همیشه به پشتیبان انسانی ارجاع می‌شود." : "مشتری پشتیبان انسانی خواست.";
    const reply = category === "complaint"
      ? hello + " از اینکه تجربه خوبی نداشته‌اید متأسفیم. پیام شما را برای همکاران پشتیبانی فرستادیم تا شخصاً بررسی کنند و در همین تیکت پاسخ بدهند."
      : hello + " درخواست شما ثبت شد و برای بررسی دقیق به همکاران پشتیبانی ارجاع شد. پاسخ را در همین تیکت دریافت می‌کنید.";
    const actions = category === "refund" ? ["بررسی تراکنش‌ها و صورتحساب‌های اخیر مشتری در بخش مالی", "تصمیم‌گیری درباره درخواست توسط واحد مالی"]
      : category === "account-access" ? ["احراز هویت مالک حساب پیش از هر تغییری"]
      : category === "abuse" ? ["بررسی گزارش توسط تیم امنیت و ثبت در سامانه سوءاستفاده"]
      : category === "data-loss" ? ["بررسی اسنپ‌شات‌ها و نسخه‌های پشتیبان موجود سرویس"]
      : category === "money-or-deletion" ? ["تأیید هویت و درخواست کتبی مالک حساب پیش از هر جابه‌جایی پول یا حذف"]
      : ["پاسخ شخصی کارشناس پشتیبانی"];
    return { category, confidence: 0.9, needsHuman: true, reason: why, reply, internalNote: [why, ...note].join(" "), suggestedActions: actions };
  }

  const category = classify(t, f);
  const stopped = f.services.filter((s) => STOPPED.has(s.status));
  const named = f.resource ?? f.services.find((s) => t.includes(norm(s.name))) ?? null;
  if (category === "status") {
    const target = named ?? stopped[0] ?? null;
    if (!target) {
      return { category, confidence: 0.5, needsHuman: true, reason: "سرویس مورد اشاره پیدا نشد.", reply: hello + " همه سرویس‌های حساب شما در حال حاضر وضعیت عادی دارند. لطفاً نام یا شناسه سرویسی را که مشکل دارد بنویسید تا دقیق‌تر بررسی کنیم.",
        internalNote: ["هیچ سرویس خاموش یا ناموفقی در حساب نیست.", ...f.problems.slice(0, 3), ...note].join(" "), suggestedActions: ["بررسی دستی سرویس‌های مشتری"] };
    }
    const off = STOPPED.has(target.status);
    const reply = hello + " " + kindFa[target.kind] + " «" + target.name + "»" + (target.detail ? " (" + target.detail + ")" : "") + " در حال حاضر **" + statusFa(target.status) + "** است." +
      (off ? (target.kind === "server" ? " می‌توانید از صفحه سرور (" + target.link + ") آن را روشن کنید. " + ASSISTANT : " از صفحه آن (" + target.link + ") می‌توانید وضعیت و لاگ‌ها را ببینید؛ دکمه «توضیح بده و درستش کن» علت را توضیح می‌دهد.")
        : " اگر همچنان به آن دسترسی ندارید، نشانی یا خطایی را که می‌بینید بنویسید.") +
      (f.problems.length ? "\n\nرویدادهای اخیر:\n" + f.problems.slice(0, 3).map((p) => "- " + p).join("\n") : "");
    return { category, confidence: off ? 0.9 : 0.75, needsHuman: false, reason: kindFa[target.kind] + " " + target.name + " وضعیت " + target.status + " دارد.", reply,
      internalNote: [kindFa[target.kind] + " " + target.name + " (" + target.id + "): " + target.status + ".", ...f.problems.slice(0, 3), ...note].join(" "),
      suggestedActions: off ? (target.kind === "server" ? ["روشن کردن سرور " + target.name + " (فقط با تأیید مشتری)"] : ["بررسی لاگ و آخرین استقرار " + target.name]) : ["بررسی شبکه و فایروال " + target.name] };
  }
  if (category === "dns" || category === "how-to") {
    if (!f.kb.length) return { category, confidence: 0.45, needsHuman: true, reason: "راهنمای مرتبطی پیدا نشد.", reply: hello + " لطفاً کمی بیشتر توضیح دهید چه کاری می‌خواهید انجام دهید تا راهنمای دقیق را بفرستیم.", internalNote: ["مقاله مرتبطی در پایگاه دانش نبود.", ...note].join(" "), suggestedActions: [] };
    const domain = f.services.find((s) => s.kind === "domain");
    const reply = hello + " این راهنماها قدم‌به‌قدم کمک می‌کنند:\n" + kbLinks(f.kb) +
      (category === "dns" ? "\n\nرکوردهای DNS را از «دامنه‌ها» (" + (domain ? domain.link : "/panel/domains") + ") ← «رکوردهای DNS» اضافه یا ویرایش کنید؛ تغییرات معمولاً پس از مدتی در اینترنت دیده می‌شوند." : "") +
      "\n\nاگر جایی گیر کردید، همین‌جا بنویسید.";
    return { category, confidence: 0.85, needsHuman: false, reason: "راهنمای مرتبط در پایگاه دانش هست.", reply, internalNote: ["پاسخ با مقاله‌های " + f.kb.map((a) => a.slug).join("، ") + ".", ...note].join(" "), suggestedActions: [] };
  }
  if (category === "known-error") {
    const p = f.problems[0];
    if (!p) return { category, confidence: 0.5, needsHuman: true, reason: "خطای ثبت‌شده‌ای پیدا نشد.", reply: hello + " لطفاً متن کامل خطا و نام سرویس را بنویسید تا بررسی کنیم.", internalNote: ["در رویدادهای اخیر خطایی نبود.", ...note].join(" "), suggestedActions: [] };
    const reply = hello + " آخرین خطای ثبت‌شده در حساب شما:\n- " + p + "\n\nدر صفحه همان سرویس دکمه «توضیح بده و درستش کن» علت را توضیح می‌دهد و راه‌حل‌های یک‌کلیکی پیشنهاد می‌کند. " + ASSISTANT;
    return { category, confidence: 0.8, needsHuman: false, reason: "خطای ثبت‌شده: " + p, reply, internalNote: ["خطاهای اخیر: " + f.problems.slice(0, 3).join(" | "), ...note].join(" "), suggestedActions: ["بررسی علت خطا با «توضیح بده و درستش کن»"] };
  }
  if (category === "billing" && f.billing) {
    const b = f.billing;
    const reply = hello + " موجودی کیف پول شما " + fa(b.balance) + " تومان است و این ماه " + fa(b.monthSpent) + " تومان هزینه داشته‌اید." +
      (b.unpaidInvoices ? " " + fa(b.unpaidInvoices) + " صورتحساب پرداخت‌نشده به مبلغ " + fa(b.unpaidTotal) + " تومان دارید که از «صورتحساب‌ها» (/panel/billing) قابل پرداخت است." : " صورتحساب پرداخت‌نشده‌ای ندارید.");
    return { category, confidence: 0.75, needsHuman: false, reason: "پرسش مالی با داده کیف پول.", reply, internalNote: ["خلاصه مالی از کیف پول و صورتحساب‌ها.", ...note].join(" "), suggestedActions: [] };
  }
  return { category, confidence: 0.35, needsHuman: true, reason: "موضوع روشن نیست.", reply: hello + " پیام شما رسید. برای بررسی دقیق‌تر، همکاران پشتیبانی به‌زودی در همین تیکت پاسخ می‌دهند.", internalNote: ["دسته‌بندی نامطمئن.", ...note].join(" "), suggestedActions: ["پاسخ کارشناس"] };
}

export const escalates = (c: SupportCategory | "" | null) => !!c && ALWAYS_ESCALATE.includes(c as SupportCategory);
