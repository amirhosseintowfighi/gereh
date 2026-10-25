/* The assistant without a model service (no AI_UPSTREAM_KEY): a deterministic planner for tests, demos and
   offline use. Keywords of the customer's message pick a tool plan, the tools run for real (as the customer, with
   the same confirmation rules) and the answer is written in Persian from their results. It only ever reads the
   customer's own message to decide what to do: tool results are summarised, never obeyed. */
import "server-only";
import type { AssistantContext, AssistantMode } from "@/lib/assistant";
import { fa } from "@/lib/format";
import { statusFa } from "./tools";

type Json = Record<string, unknown>;
export type SimDone = { name: string; args: Json; out: unknown; ok: boolean; summary: string };
export type SimCall = { name: string; args: Json };
export type SimInput = { ask: string; earlier: string[]; context: AssistantContext | null; done: SimDone[]; tools: Set<string>; mode?: AssistantMode };

const norm = (s: string) => s.replace(/[‌‏]/g, " ").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).toLowerCase();
const rows = (out: unknown): Json[] => { const d = (out as { data?: unknown })?.data; return Array.isArray(d) ? (d as Json[]) : []; };
const S = (v: unknown) => String(v ?? "");
const toman = (n: unknown) => fa(Math.round(Number(n) || 0)) + " تومان";

type Intent = "baft" | "buy" | "suggest" | "delete" | "disk" | "restart" | "app_error" | "cost" | "status" | "help";
export function intentOf(text: string): Intent {
  const t = norm(text);
  if (/بافت|baft/.test(t) || (/سایت|لندینگ|فروشگاه اینترنتی|وبلاگ/.test(t) && /بساز|طراحی کن|درست کن/.test(t))) return "baft";
  if (/بخر|خرید|سفارش بده|سفارش بزن/.test(t) && /سرور|همین|پلن/.test(t)) return "buy";
  if (/سرور/.test(t) && /پیشنهاد|کدام پلن|چه پلنی|معرفی کن/.test(t)) return "suggest";
  if (/دیسک|disk/.test(t) && /تقسیم|چیدمان|پارتیشن|layout|split|جدا کن/.test(t)) return "disk";
  if (/حذف|پاک کن/.test(t) && /سرور/.test(t)) return "delete";
  if (/ریستارت|ری استارت|راه ?اندازی مجدد|ریبوت|reboot|restart/.test(t)) return "restart";
  if (/خطا|ارور|error|کار نمی|بالا نمی|مشکل|لاگ|crash/.test(t) && /اپ|app|n8n|سایت|برنامه/.test(t)) return "app_error";
  if (/هزینه|خرج|صورتحساب|فاکتور|موجودی|کیف پول|پرداخت/.test(t)) return "cost";
  if (/وضعیت|سرویس|چطور|چه خبر|status|سلامت/.test(t)) return "status";
  return "help";
}

const LOCS: [RegExp, string, string][] = [[/تهران|tehran/, "thr", "تهران"], [/اصفهان|isfahan/, "isf", "اصفهان"], [/فرانکفورت|آلمان|frankfurt/, "fra", "فرانکفورت"], [/آمستردام|هلند|amsterdam/, "ams", "آمستردام"]];
function wants(texts: string[]) {
  const t = norm(texts.join(" \n "));
  const ram = Number(/(\d{1,3})\s*(?:گیگ|gb|g\b|گیگابایت)/.exec(t)?.[1] ?? 0);
  const loc = LOCS.find(([re]) => re.test(t)) ?? LOCS[0];
  return { ram, loc: loc[1], locName: loc[2] };
}
type PlanRow = { id: string; name: string; cpu: number | null; ram_gb: number | null; disk_gb: number | null; traffic: string; monthly_price_toman: number };
function pickPlan(plans: PlanRow[], ram: number) {
  const sorted = [...plans].sort((a, b) => a.monthly_price_toman - b.monthly_price_toman);
  return sorted.find((p) => p.ram_gb === ram) ?? sorted.find((p) => (p.ram_gb ?? 0) >= (ram || 4)) ?? sorted[0] ?? null;
}
const planLine = (p: PlanRow) => "**" + p.name + "**: " + fa(p.cpu ?? 0) + " هسته، " + fa(p.ram_gb ?? 0) + " گیگ رم، " + fa(p.disk_gb ?? 0) + " گیگ NVMe، ترافیک " + p.traffic + " — ماهانه **" + toman(p.monthly_price_toman) + "**";

const findServer = (out: unknown, ask: string) => { const t = norm(ask); return rows(out).find((s) => t.includes(norm(S(s.name)))) ?? null; };
const has = (done: SimDone[], name: string) => done.find((d) => d.name === name);

/** the next step: tool calls, or the final answer */
export function simPlan(i: SimInput): { text: string; calls: SimCall[] } {
  if (i.mode === "staff") return staffPlan(i);
  const intent = intentOf(i.ask);
  const d = i.done;
  const call = (name: string, args: Json = {}): { text: string; calls: SimCall[] } => (i.tools.has(name) ? { text: "", calls: [{ name, args }] } : { text: "این کار با دسترسی فعلی شما در این حساب ممکن نیست.", calls: [] });
  const failed = d.find((x) => !x.ok);
  if (failed && !d.some((x) => x.ok && x.name === failed.name)) return { text: "متأسفانه انجام نشد: " + failed.summary, calls: [] };

  switch (intent) {
    case "baft": {
      const b = has(d, "builder_create");
      if (!b) return i.tools.has("builder_create") ? call("builder_create", { prompt: i.ask, stack: "auto" }) : { text: "دسترسی ساخت پروژه با بافت را در این حساب ندارید.", calls: [] };
      const id = S((b.out as { project?: Json })?.project?.id);
      return { text: "پروژه شما با **بافت** ساخته شد. ✅\n\n- مشاهده و ویرایش: [/panel/build/" + id + "](/panel/build/" + id + ")\n- برای انتشار روی اینترنت، در صفحه پروژه «استقرار» را بزنید یا به من بگویید «منتشرش کن».", calls: [] };
    }
    case "buy": case "suggest": {
      const p = has(d, "list_cloud_plans");
      if (!p) return call("list_cloud_plans");
      const w = wants([...i.earlier, i.ask]);
      const plans = ((p.out as { plans?: PlanRow[] })?.plans ?? []);
      const best = pickPlan(plans, w.ram);
      if (!best) return { text: "در حال حاضر پلن فعالی برای سرور ابری ارائه نمی‌شود.", calls: [] };
      if (intent === "buy") {
        const b = has(d, "buy_cloud_server");
        if (!b) return call("buy_cloud_server", { plan_id: best.id, location: w.loc, os: "ubuntu" });
        return { text: "سفارش سرور **" + best.name + "** در " + w.locName + " ثبت و از کیف پول پرداخت شد. سرور تا چند دقیقه دیگر در [سرورهای ابری](/panel/servers) آماده می‌شود و رمز root یک‌بار در صفحه آن نمایش داده می‌شود.", calls: [] };
      }
      const alts = plans.filter((x) => x.id !== best.id).sort((a, b) => Math.abs((a.ram_gb ?? 0) - (best.ram_gb ?? 0)) - Math.abs((b.ram_gb ?? 0) - (best.ram_gb ?? 0))).slice(0, 2);
      return { text: "پیشنهاد من برای " + (w.ram ? fa(w.ram) + " گیگ رم" : "شروع") + " در **" + w.locName + "**:\n\n- " + planLine(best) + "\n\nگزینه‌های نزدیک:\n" + alts.map((a) => "- " + planLine(a)).join("\n") + "\n\nقیمت‌ها بدون مالیات بر ارزش افزوده است و پرداخت ساعتی هم ممکن است. اگر بخواهید بگویید «همین را بخر» تا سفارش را آماده کنم؛ پیش از پرداخت از شما تأیید می‌گیرم.", calls: [] };
    }
    case "disk": {
      const ls = has(d, "list_servers");
      const here = i.context?.kind === "server" ? i.context.id : "";
      let target = here && /این سرور|this server/.test(norm(i.ask)) ? here : "";
      let name = "";
      if (!target) {
        if (!ls) return call("list_servers");
        const s = findServer(ls.out, i.ask) ?? (here ? rows(ls.out).find((x) => x.id === here) : null) ?? (rows(ls.out).length === 1 ? rows(ls.out)[0] : null);
        if (!s) return { text: "دیسک کدام سرور؟ سرورهای شما: " + rows(ls.out).map((x) => "**" + S(x.name) + "**").join("، "), calls: [] };
        target = S(s.id); name = S(s.name);
      }
      const set = has(d, "set_disk_layout");
      if (set) return { text: set.summary, calls: [] };
      const lay = has(d, "get_disk_layout");
      if (!lay) return call("get_disk_layout", { server_id: target });
      const o = lay.out as { allowance_gb: number; disks_gb: number[]; os: string };
      return call("set_disk_layout", { server_id: target, sizes: splitSizes(i.ask, name, o.allowance_gb), os: osIn(i.ask) ?? o.os });
    }
    case "delete": case "restart": {
      const tool = intent === "delete" ? "delete_server" : "server_action";
      const act = has(d, tool);
      if (act) return { text: intent === "delete" ? "سرور حذف شد." : "فرمان راه‌اندازی مجدد ارسال شد؛ سرور تا یکی دو دقیقه دیگر دوباره در دسترس است.", calls: [] };
      const ls = has(d, "list_servers");
      const here = i.context?.kind === "server" ? i.context.id : "";
      // «این سرور» is the page's server; a server named in the message wins over the page
      let target = here && /این سرور|this server/.test(norm(i.ask)) ? here : "";
      if (!target) {
        if (!ls) return call("list_servers");
        const s = findServer(ls.out, i.ask) ?? (here ? rows(ls.out).find((x) => x.id === here) : null) ?? (rows(ls.out).length === 1 ? rows(ls.out)[0] : null);
        if (!s) return { text: "کدام سرور؟ سرورهای شما: " + rows(ls.out).map((x) => "**" + S(x.name) + "**").join("، "), calls: [] };
        target = S(s.id);
      }
      return call(tool, intent === "delete" ? { server_id: target } : { server_id: target, action: "reboot" });
    }
    case "app_error": {
      const ls = has(d, "list_apps");
      if (!ls) return call("list_apps");
      const apps = rows(ls.out);
      const t = norm(i.ask);
      const app = apps.find((a) => t.includes(norm(S(a.name)))) ?? (/n8n/.test(t) ? apps.find((a) => /n8n/i.test(S(a.name)) || /n8n/i.test(S(a.stack))) : undefined)
        ?? (i.context?.kind === "app" ? apps.find((a) => a.id === i.context!.id) : undefined) ?? (/n8n/.test(t) ? undefined : apps.find((a) => a.status !== "running"));
      if (!app) return { text: (/n8n/.test(t) ? "اپی با نام n8n در حساب شما پیدا نشد." : "اپ مشکل‌داری پیدا نکردم.") + (apps.length ? " اپ‌های شما: " + apps.map((a) => "**" + S(a.name) + "** (" + statusFa(a.status) + ")").join("، ") + ". نام اپ را بگویید تا لاگ‌هایش را بررسی کنم." : " هنوز اپی نساخته‌اید."), calls: [] };
      const logs = has(d, "app_logs");
      if (!logs) return { text: "", calls: [{ name: "get_app", args: { app: S(app.name) } }, { name: "app_logs", args: { app: S(app.name) } }].filter((c) => i.tools.has(c.name)) };
      const lines = ((logs.out as { lines?: { line?: string; level?: string }[] })?.lines ?? []).map((l) => (typeof l === "string" ? l : S(l.line)));
      const errs = lines.filter((l) => /error|exception|fatal|fail|ECONN|refused|denied|OOM|killed/i.test(l)).slice(-3);
      const info = (has(d, "get_app")?.out ?? {}) as Json;
      const dep = info.latest_deployment as Json | null;
      return { text: "بررسی اپ **" + S(app.name) + "**:\n\n- وضعیت: **" + statusFa(info.status ?? app.status) + "**" + (dep ? "، آخرین استقرار: " + statusFa(dep.status) : "") + "\n- " + fa(lines.length) + " خط لاگ خواندم" + (errs.length ? "؛ خطاهای اخیر:\n\n```\n" + errs.map((e) => e.slice(0, 200)).join("\n") + "\n```\n\n" + advice(errs.join(" ")) : "؛ خطای مشخصی در لاگ‌های اخیر دیده نمی‌شود. اگر مشکل ادامه دارد، اپ را یک‌بار راه‌اندازی مجدد کنید یا متغیرهای محیطی را بررسی کنید."), calls: [] };
    }
    case "cost": {
      const s = has(d, "spending_summary");
      if (!s) return call("spending_summary");
      const o = s.out as { balance_toman: number; month_spent_toman: number; by_kind: { kind: string; toman: number; count: number }[]; unpaid_invoices: number; unpaid_total_toman: number };
      const KIND: Record<string, string> = { usage: "مصرف ساعتی و API", payment: "پرداخت صورتحساب", transfer: "انتقال" };
      return { text: "این ماه **" + toman(o.month_spent_toman) + "** هزینه کرده‌اید." + (o.by_kind.length ? "\n\n" + o.by_kind.map((k) => "- " + (KIND[k.kind] ?? k.kind) + ": " + toman(k.toman) + " (" + fa(k.count) + " تراکنش)").join("\n") : "") + "\n\n- موجودی کیف پول: **" + toman(o.balance_toman) + "**" + (o.unpaid_invoices ? "\n- " + fa(o.unpaid_invoices) + " صورتحساب پرداخت‌نشده به مبلغ " + toman(o.unpaid_total_toman) : ""), calls: [] };
    }
    case "status": {
      if (i.context && /این/.test(norm(i.ask))) {
        const name = i.context.kind === "server" ? "get_server" : i.context.kind === "app" ? "get_app" : "list_databases";
        const got = has(d, name);
        if (!got) return call(name, i.context.kind === "server" ? { server_id: i.context.id } : i.context.kind === "app" ? { app: i.context.id } : {});
        return { text: got.summary, calls: [] };
      }
      const want = ["list_servers", "list_apps", "list_databases"].filter((n) => i.tools.has(n) && !has(d, n));
      if (want.length && !d.length) return { text: "", calls: want.map((name) => ({ name, args: {} })) };
      const HEAD: Record<string, string> = { list_servers: "سرورهای ابری", list_apps: "اپ‌ها", list_databases: "پایگاه‌های داده" };
      const bad = d.flatMap((x) => rows(x.out).filter((r) => r.status && !["running", "active", "live"].includes(S(r.status))).map((r) => S(r.name) + " (" + statusFa(r.status) + ")"));
      return { text: "وضعیت سرویس‌های شما:\n\n" + d.map((x) => "- **" + (HEAD[x.name] ?? x.name) + ":** " + x.summary).join("\n") + (bad.length ? "\n\nنیاز به توجه: " + bad.join("، ") + "." : "\n\nهمه سرویس‌ها روشن و سالم‌اند. ✅"), calls: [] };
    }
    default:
      return { text: "سلام! من **دستیار گره** هستم و می‌توانم حساب شما را مدیریت کنم:\n\n- وضعیت سرورها، اپ‌ها و پایگاه‌های داده\n- پیشنهاد و خرید سرور ابری با قیمت دقیق\n- بررسی لاگ و علت خطای اپ‌ها\n- هزینه‌ها و صورتحساب‌ها\n- ساخت سایت با **بافت**\n\nکارهای حساس (خرید، حذف، استقرار…) فقط پس از تأیید شما انجام می‌شود.", calls: [] };
  }
}

function advice(errs: string) {
  if (/ECONNREFUSED|connect|refused|database|postgres|DATABASE_URL/i.test(errs)) return "به نظر می‌رسد اپ به پایگاه داده یا سرویس دیگری وصل نمی‌شود. متغیر `DATABASE_URL` و روشن بودن پایگاه داده را بررسی کنید.";
  if (/OOM|out of memory|killed|heap/i.test(errs)) return "اپ کمبود حافظه دارد؛ پلن بزرگ‌تر یا کاهش مصرف حافظه پیشنهاد می‌شود.";
  if (/permission|denied|EACCES/i.test(errs)) return "خطای دسترسی فایل دیده می‌شود؛ مسیر دیسک و کاربر اجرای اپ را بررسی کنید.";
  if (/port|EADDRINUSE|listen/i.test(errs)) return "اپ روی پورت درست گوش نمی‌دهد؛ پورت تنظیم‌شده اپ را با پورت برنامه یکی کنید.";
  return "برای رفع، تغییرات اخیر کد یا متغیرهای محیطی را بررسی کنید؛ اگر بخواهید می‌توانم اپ را راه‌اندازی مجدد کنم.";
}

const OS_RE = /(ubuntu|debian|alma(?:linux)?|rocky|centos|windows|اوبونتو|دبیان|ویندوز)\s*[\d.]*/g;
/** the OS template named in the message, if any */
function osIn(ask: string): string | null {
  const t = norm(ask);
  if (/debian|دبیان/.test(t)) return /\b11\b/.test(t) ? "Debian 11" : "Debian 12";
  if (/ubuntu|اوبونتو/.test(t)) return /22/.test(t) ? "Ubuntu 22.04" : "Ubuntu 24.04";
  return null;
}
/** the disk sizes the message asks for: explicit sizes summing to the allowance, one size split off the primary,
    or N equal parts (two by default; the primary takes the remainder) */
export function splitSizes(ask: string, serverName: string, allowance: number): number[] {
  let t = norm(ask).replace(OS_RE, " ");
  if (serverName) t = t.split(norm(serverName)).join(" ");
  const partsM = /(\d+)\s*(?:قسمت|بخش|دیسک|part)/.exec(t);
  let parts = /سه (?:قسمت|بخش|دیسک)/.test(t) ? 3 : /چهار (?:قسمت|بخش|دیسک)/.test(t) ? 4 : 2;
  if (partsM) { parts = Math.min(8, Math.max(2, Number(partsM[1]))); t = t.replace(partsM[0], " "); }
  const nums = [...t.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n > 0 && n < allowance + 1);
  const sum = nums.reduce((a, b) => a + b, 0);
  if (nums.length > 1 && sum === allowance) return nums;
  if (nums.length === 1 && nums[0] < allowance) return [allowance - nums[0], nums[0]];
  const each = Math.floor(allowance / parts);
  return [allowance - each * (parts - 1), ...Array(parts - 1).fill(each)];
}

/* ---------- the staff console ---------- */
type StaffIntent = "undelivered" | "jobs" | "sales" | "tickets" | "server" | "search" | "help";
export function staffIntentOf(text: string): { intent: StaffIntent; arg: string } {
  const t = norm(text);
  const ip = /\b\d{1,3}(?:\.\d{1,3}){3}\b/.exec(t)?.[0] ?? /\bsrv-\d+\b/.exec(t)?.[0];
  if (/تحویل/.test(t)) return { intent: "undelivered", arg: "" };
  if (/ناموفق|failed|جاب|job|صف کار|کارهای/.test(t)) return { intent: "jobs", arg: "" };
  if (/فروش|درآمد|گزارش مالی|revenue|sales/.test(t)) return { intent: "sales", arg: "" };
  if (/تیکت|ticket/.test(t)) return { intent: "tickets", arg: "" };
  if (ip) return { intent: "server", arg: ip };
  const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(t)?.[0];
  if (email || /مشتری|کاربر|جست ?و ?جو|پیدا کن/.test(t)) return { intent: "search", arg: email ?? t.replace(/مشتری|کاربر|را|جست ?و ?جو کن|پیدا کن|بگرد/g, " ").trim().split(/\s+/).slice(-2).join(" ") };
  return { intent: "help", arg: "" };
}
const STAFF_TOOL: Record<Exclude<StaffIntent, "help">, string> = { undelivered: "undelivered_orders", jobs: "failed_jobs", sales: "sales_summary", tickets: "open_tickets", server: "server_details", search: "search_customers" };

function staffPlan(i: SimInput): { text: string; calls: SimCall[] } {
  const first = i.done[0];
  if (first) {
    if (!first.ok) return { text: "انجام نشد: " + first.summary, calls: [] };
    const o = first.out as Json;
    const list = (k: string, f: (r: Json) => string) => ((o[k] as Json[] | undefined) ?? []).slice(0, 8).map((r) => "- " + f(r)).join("\n");
    const body: Record<string, string> = {
      undelivered_orders: list("orders", (r) => "`" + S(r.order_key) + "` " + S(r.item) + " — " + S(r.customer) + " (" + S(r.stage) + ")" + (r.error ? ": " + S(r.error) : "")),
      failed_jobs: list("newest", (r) => S(r.type) + " #" + S(r.id) + " (" + S(r.status) + "): " + S(r.error)),
      open_tickets: list("tickets", (r) => S(r.id) + " «" + S(r.subject) + "» — " + S(r.customer)),
      search_customers: list("hits", (r) => S(r.label) + " — " + S(r.detail) + " (" + S(r.user_id) + ")"),
    };
    return { text: "**" + first.summary + "**" + (body[first.name] ? "\n\n" + body[first.name] : ""), calls: [] };
  }
  const { intent, arg } = staffIntentOf(i.ask);
  if (intent === "help") return { text: "سلام! **دستیار گره** در حالت کنسول پشتیبانی است. می‌توانم مشتری‌ها را جست‌وجو کنم، سفارش‌های تحویل‌نشده و کارهای ناموفق را خلاصه کنم، تیکت‌های باز و گزارش فروش را نشان دهم و جزئیات یک سرور را بخوانم؛ کارهایی مثل تلاش دوباره برای تحویل، تعلیق، تغییر موجودی یا پاسخ تیکت فقط با تأیید شما انجام می‌شود.", calls: [] };
  const name = STAFF_TOOL[intent];
  if (!i.tools.has(name)) return { text: "نقش شما در پنل مدیریت به این بخش دسترسی ندارد.", calls: [] };
  return { text: "", calls: [{ name, args: intent === "server" ? { server: arg } : intent === "search" ? { query: arg } : {} }] };
}
