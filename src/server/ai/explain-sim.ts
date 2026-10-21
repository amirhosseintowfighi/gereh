/* The offline error explainer: deterministic rules for the common errors, used when no model service is configured
   (tests, demos, development) and as the fallback when the model's answer is unusable. Persian, like the panel. */
import type { ExplainKind, FixId } from "@/lib/explain";

export type SimFacts = {
  port?: number; healthPath?: string; listeningPort?: number; missingEnv?: string;
  planName?: string; ramMb?: number; nextPlan?: string; stack?: string; builder?: boolean;
};
export type SimAnswer = { summary: string; cause: string; steps: string[]; prefer: FixId[] };
const APP: ExplainKind[] = ["paas", "rpc"];
type Rule = { kinds?: ExplainKind[]; test: RegExp; answer: (f: SimFacts, text: string) => SimAnswer };

const fa = (n: number) => n.toLocaleString("fa-IR", { useGrouping: false });
const ram = (mb?: number) => (mb ? (mb >= 1024 ? (mb / 1024).toLocaleString("fa-IR") + " گیگابایت" : mb.toLocaleString("fa-IR") + " مگابایت") : "پلن فعلی");

const RULES: Rule[] = [
  {
    test: /موجودی کیف پول کافی نیست|insufficient[_ ]balance|wallet balance is not enough/i,
    answer: () => ({
      summary: "موجودی کیف پول برای انجام این کار کافی نیست.",
      cause: "سرویس‌های گره ساعتی از کیف پول کسر می‌شوند و برای ساخت یا بزرگ کردن منابع، هزینه دست‌کم ۲۴ ساعت باید در کیف پول باشد.",
      steps: ["از «صورتحساب و کیف پول» کیف پول را شارژ کنید.", "پس از شارژ، همان کار را دوباره انجام دهید.", "اگر اعتبار کافی دارید و باز همین خطا را می‌بینید، تیکت ثبت کنید."],
      prefer: ["ticket"],
    }),
  },
  {
    kinds: APP,
    test: /ImagePullBackOff|ErrImagePull|ErrImageNeverPull|InvalidImageName|manifest unknown|pull access denied/i,
    answer: () => ({
      summary: "سرور نتوانست ایمیج Docker اپ را دریافت کند، پس نسخه جدید اصلاً اجرا نشد.",
      cause: "نام یا تگ ایمیج اشتباه است، ایمیج خصوصی است و دسترسی ندارد، یا رجیستری از داخل شبکه در دسترس نیست.",
      steps: ["نام و تگ ایمیج را دقیق بررسی کنید (مثلاً ghcr.io/acme/api:1.4.2).", "اگر ایمیج خصوصی است، آن را عمومی کنید یا ایمیج را در رجیستری در دسترس قرار دهید.", "اگر رجیستری خارجی است، پروکسی خروجی را روشن کنید یا از میرور Docker گره استفاده کنید.", "سپس دوباره مستقر کنید."],
      prefer: ["rollback", "enable_proxy", "redeploy"],
    }),
  },
  {
    kinds: APP,
    test: /OOMKilled|JavaScript heap out of memory|Cannot allocate memory|Out of memory|exit code 137|signal: killed|کمبود حافظه/i,
    answer: (f) => ({
      summary: "اپ بیش از حافظه پلن مصرف کرد و سیستم آن را متوقف کرد (OOM).",
      cause: "سقف حافظه پلن " + (f.planName ? "«" + f.planName + "» " : "") + "(" + ram(f.ramMb) + ") برای این اپ کم است، یا اپ نشت حافظه دارد و با گذشت زمان بیشتر مصرف می‌کند.",
      steps: [
        f.nextPlan ? "پلن را به «" + f.nextPlan + "» ارتقا دهید تا حافظه بیشتری داشته باشد." : "پلن بزرگ‌تری انتخاب کنید.",
        "برای Node.js سقف heap را حدود ۷۵٪ حافظه پلن بگذارید: NODE_OPTIONS=--max-old-space-size=…",
        "تعداد worker یا thread را کم کنید و بارگذاری داده‌های بزرگ در حافظه را بررسی کنید.",
      ],
      prefer: ["raise_plan", "rollback"],
    }),
  },
  {
    kinds: APP,
    test: /no node can run it|Insufficient (cpu|memory)|didn't match|untolerated|0\/\d+ nodes are available/i,
    answer: () => ({
      summary: "خوشه در این لحظه جای خالی برای اجرای نسخه جدید ندارد.",
      cause: "هیچ گره‌ای CPU یا حافظه آزاد کافی برای پلن این اپ ندارد؛ این مشکل از کد شما نیست.",
      steps: ["چند دقیقه بعد دوباره مستقر کنید.", "اگر ادامه داشت، تیکت ثبت کنید تا ظرفیت اضافه شود."],
      prefer: ["redeploy", "ticket"],
    }),
  },
  {
    kinds: APP,
    test: /connect: connection refused|ECONNREFUSED|port mismatch|no process listening on port/i,
    answer: (f) => {
      const moved = f.listeningPort && f.port && f.listeningPort !== f.port;
      return {
        summary: moved ? "اپ روی پورت " + fa(f.listeningPort!) + " گوش می‌دهد، اما گره بررسی سلامت را روی پورت " + fa(f.port!) + " انجام می‌دهد." : "بررسی سلامت به اپ وصل نشد (connection refused).",
        cause: moved ? "پورت تنظیم‌شده اپ با پورتی که برنامه واقعاً باز کرده یکی نیست." : "اپ روی پورت تنظیم‌شده یا روی 0.0.0.0 گوش نمی‌دهد (مثلاً فقط به localhost وصل است)، یا پیش از گوش دادن خطا می‌دهد.",
        steps: [
          moved ? "پورت اپ را روی " + fa(f.listeningPort!) + " بگذارید (یک کلیک: «درستش کن»)." : "اپ را روی 0.0.0.0 و پورت متغیر PORT اجرا کنید؛ مثل app.listen(process.env.PORT).",
          "یا در کد، از متغیر PORT که گره تنظیم می‌کند استفاده کنید.",
          "لاگ اپ را برای خطاهای پیش از راه‌اندازی بررسی کنید.",
        ],
        prefer: ["set_port", "builder_fix", "redeploy"],
      };
    },
  },
  {
    kinds: APP,
    test: /Missing script:? "?start"?|No start command could be found|unable to generate a build plan|could not determine how to start/i,
    answer: () => ({
      summary: "گره نمی‌داند اپ را با چه دستوری اجرا کند.",
      cause: "اسکریپت start در package.json یا «دستور اجرا» در تنظیمات اپ تعریف نشده است.",
      steps: ["در package.json اسکریپت \"start\" اضافه کنید (مثلاً \"node server.js\").", "یا در تنظیمات اپ «دستور اجرا» را بنویسید.", "سپس دوباره مستقر کنید."],
      prefer: ["builder_fix", "redeploy"],
    }),
  },
  {
    kinds: APP,
    test: /npm ERR!|ERESOLVE|ERR_PNPM_|Module not found|Cannot find module|SyntaxError|TS\d{4}:|Build failed|build step exited with code|Could not find a version that satisfies|No matching distribution/i,
    answer: (_f, t) => {
      const deps = /ERESOLVE|peer dep|Could not find a version|No matching distribution|ERR_PNPM_/i.test(t);
      return {
        summary: deps ? "نصب وابستگی‌ها هنگام بیلد ناموفق بود." : "بیلد پروژه با خطا متوقف شد.",
        cause: deps ? "نسخه‌های بسته‌ها با هم سازگار نیستند یا فایل قفل (package-lock.json) قدیمی است." : "کد یا تنظیمات بیلد خطا دارد (ماژول پیدا نشد، خطای نحوی یا TypeScript)؛ جزئیات در خطوط آخر لاگ است.",
        steps: deps
          ? ["فایل قفل را به‌روز کنید (npm install) و commit کنید.", "برای ERESOLVE نسخه‌ها را هماهنگ کنید یا در .npmrc بنویسید legacy-peer-deps=true.", "اگر بسته‌ها از اینترنت دریافت نمی‌شوند، آینه بسته‌ها یا پروکسی خروجی را روشن کنید."]
          : ["خطوط آخر لاگ بیلد را ببینید و همان خطا را در سیستم خودتان با npm run build تکرار کنید.", "ماژول‌های جاافتاده را نصب و در package.json ثبت کنید.", "پس از رفع، دوباره مستقر کنید."],
        prefer: ["builder_fix", "rollback", "redeploy"],
      };
    },
  },
  {
    kinds: APP,
    test: /(?:missing|required|not set|not defined|undefined)[^\n]{0,40}?env|env(?:ironment)? variable[^\n]{0,60}?(?:missing|required|not set|undefined)|KeyError: '[A-Z_]+'|is not set in the environment/i,
    answer: (f) => ({
      summary: f.missingEnv ? "اپ به متغیر محیطی " + f.missingEnv + " نیاز دارد اما تعریف نشده است." : "یک متغیر محیطی لازم برای اجرای اپ تعریف نشده است.",
      cause: "برنامه هنگام شروع، مقدار این متغیر را می‌خواند و بدون آن متوقف می‌شود.",
      steps: [f.missingEnv ? "متغیر " + f.missingEnv + " را با مقدار درست تعریف کنید (یک کلیک: «درستش کن»)." : "در «متغیرهای محیطی» متغیر جاافتاده را اضافه کنید.", "مقدارهای محرمانه را به‌صورت «مخفی» ذخیره کنید.", "پس از ذخیره، اپ خودکار با تنظیمات جدید اجرا می‌شود."],
      prefer: ["set_env", "rollback"],
    }),
  },
  {
    kinds: APP,
    test: /CrashLoopBackOff|Back-off restarting|exited with code|container exited|restarted \d+ times|crash/i,
    answer: () => ({
      summary: "اپ پس از شروع، پشت سر هم از کار می‌افتد و دوباره راه‌اندازی می‌شود.",
      cause: "برنامه هنگام اجرا خطای کنترل‌نشده می‌دهد؛ معمولاً اتصال پایگاه داده، متغیر محیطی جاافتاده یا خطای کد.",
      steps: ["لاگ اپ را برای آخرین خطا (Error، Exception) بررسی کنید.", "اتصال پایگاه داده و متغیرهای محیطی را بررسی کنید.", "اگر نسخه قبلی سالم بود، به آن برگردید و خطا را جداگانه رفع کنید."],
      prefer: ["rollback", "builder_fix", "redeploy"],
    }),
  },
  {
    kinds: APP,
    test: /Readiness probe failed|Startup probe failed|Liveness probe failed|did not become healthy|health check failed|statuscode: (404|5\d\d)/i,
    answer: (f, t) => ({
      summary: "نسخه جدید اجرا شد اما به بررسی سلامت پاسخ موفق نداد، پس ترافیک به آن منتقل نشد.",
      cause: /statuscode: 404/i.test(t) && f.healthPath ? "مسیر سلامت «" + f.healthPath + "» در اپ وجود ندارد (۴۰۴)." : "اپ دیر بالا می‌آید یا مسیر سلامت خطا برمی‌گرداند.",
      steps: ["مسیر سلامت باید بدون ورود و با کد ۲xx پاسخ دهد؛ اگر مسیر خاصی ندارید «/» بگذارید.", "اگر اپ دیر بالا می‌آید، مهلت شروع بررسی سلامت را بیشتر کنید.", "لاگ اپ را برای خطای زمان اجرا ببینید."],
      prefer: ["set_health_path", "builder_fix", "rollback"],
    }),
  },
  {
    test: /forbidden|\b403\b|RBAC|اجازه این کار را ندارد|cannot (get|list|create|patch|watch) resource|is not allowed|Permission denied/i,
    answer: () => ({
      summary: "درخواست به‌خاطر نداشتن دسترسی رد شد (۴۰۳).",
      cause: "حساب یا نقش شما (یا حساب سرویس اپ) اجازه این عملیات را ندارد؛ مثلاً عضو تیم با نقش محدود، یا دسترسی RBAC در خوشه.",
      steps: ["اگر عضو تیم هستید، از مدیر حساب بخواهید نقش شما را بررسی کند.", "اگر اپ به API خوشه نیاز دارد، این دسترسی در گره اپ داده نمی‌شود؛ راه دیگری لازم است.", "اگر فکر می‌کنید باید دسترسی داشته باشید، تیکت ثبت کنید."],
      prefer: ["ticket"],
    }),
  },
  {
    kinds: APP,
    test: /ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|i\/o timeout|connect timeout|Network is unreachable|Could not resolve host|getaddrinfo/i,
    answer: () => ({
      summary: "اپ نتوانست به سرویسی بیرون از شبکه وصل شود.",
      cause: "برخی سرویس‌های خارجی از داخل شبکه در دسترس نیستند یا کند پاسخ می‌دهند؛ اتصال قطع یا منقضی شد.",
      steps: ["پروکسی خروجی گره را برای اپ روشن کنید تا درخواست‌های خارجی از آن عبور کنند.", "اگر مقصد داخلی است (پایگاه داده)، نشانی و پورت را بررسی کنید.", "برای دریافت بسته‌ها از آینه بسته‌های گره استفاده کنید."],
      prefer: ["enable_proxy", "redeploy"],
    }),
  },
  {
    kinds: ["vps", "rpc"],
    test: /cannot shrink|shrink the disk/i,
    answer: () => ({
      summary: "Virtualizor اجازه کوچک کردن دیسک سرور را نمی‌دهد.",
      cause: "دیسک یک سرور مجازی فقط بزرگ می‌شود؛ کوچک یا حذف کردن دیسک یعنی ساخت دوباره سرور با چیدمان جدید (داده‌ها پاک می‌شوند).",
      steps: ["اگر فقط فضای بیشتر می‌خواهید، دیسک را بزرگ‌تر کنید یا دیسک جدید اضافه کنید.", "برای کوچک کردن، از داده‌ها پشتیبان بگیرید و «تغییر چیدمان دیسک» با ساخت دوباره را انتخاب کنید.", "اگر مطمئن نیستید، تیکت ثبت کنید."],
      prefer: ["sync_server", "ticket"],
    }),
  },
  {
    kinds: ["vps", "rpc"],
    test: /no free IPs?|There are no free IPs|IP pool|IP آزاد/i,
    answer: () => ({
      summary: "در این مکان فعلاً IP آزاد برای سرور وجود ندارد.",
      cause: "استخر IP گره میزبان پر شده است؛ تیم فنی باید IP اضافه کند یا سرور را روی گره دیگری بسازد.",
      steps: ["نیازی به پرداخت دوباره نیست؛ سفارش شما محفوظ است.", "تیکت ثبت کنید تا تیم فنی سریع‌تر IP اختصاص دهد.", "یا مکان دیگری برای سرور انتخاب کنید."],
      prefer: ["ticket"],
    }),
  },
  {
    kinds: ["vps"],
    test: /تأیید نشد|did not confirm|not confirmed/i,
    answer: () => ({
      summary: "دستور روشن/خاموش به سرور فرستاده شد اما وضعیت آن پس از چند دقیقه تأیید نشد.",
      cause: "Virtualizor دیر پاسخ داد یا سیستم‌عامل سرور به فرمان (مثلاً خاموش شدن نرم) واکنش نشان نداد.",
      steps: ["وضعیت سرور را از Virtualizor به‌روز کنید.", "همان عملیات را دوباره امتحان کنید.", "اگر سرور هنوز پاسخ نمی‌دهد، از کنسول VNC وضعیت سیستم‌عامل را ببینید یا تیکت ثبت کنید."],
      prefer: ["sync_server", "retry_power", "start_server", "ticket"],
    }),
  },
  {
    kinds: ["vps"],
    test: /تحویل با تأخیر|provision|addvs|ساخت دوباره سرور|بازسازی|چیدمان دیسک/i,
    answer: () => ({
      summary: "ساخت یا تغییر سرور در زیرساخت با خطا روبه‌رو شد.",
      cause: "Virtualizor درخواست را رد کرد یا پاسخ نداد؛ تیم فنی مطلع شده است.",
      steps: ["نیازی به پرداخت دوباره نیست.", "وضعیت سرور را به‌روز کنید.", "برای پیگیری سریع‌تر، تیکت با خلاصه همین خطا ثبت کنید."],
      prefer: ["sync_server", "ticket"],
    }),
  },
  {
    kinds: ["dbaas"],
    test: /import|ورود|restore|dump|syntax error at|ERROR:|duplicate key|already exists/i,
    answer: (_f, t) => ({
      summary: "ورود یا بازگردانی داده در پایگاه داده ناموفق بود.",
      cause: /already exists|duplicate key/i.test(t) ? "جدول‌ها یا رکوردهای فایل از قبل در پایگاه داده وجود دارند." : "فایل پشتیبان با نسخه یا موتور پایگاه داده سازگار نیست یا ناقص است.",
      steps: ["فایل پشتیبان را با همان نسخه موتور (مثلاً pg_dump نسخه هم‌خوان) بسازید.", "اگر داده‌ها تکراری‌اند، پایگاه داده خالی بسازید یا جدول‌های قبلی را حذف کنید.", "سپس فایل را دوباره وارد کنید."],
      prefer: ["ticket"],
    }),
  },
  {
    kinds: ["dbaas"],
    test: /refused|failed|unreachable|not ready|ناموفق|crash/i,
    answer: () => ({
      summary: "پایگاه داده در دسترس نیست یا راه‌اندازی آن ناموفق بود.",
      cause: "سرویس پایگاه داده متوقف شده یا هنگام شروع خطا داده است؛ اتصال‌ها رد می‌شوند.",
      steps: ["پایگاه داده را دوباره راه‌اندازی کنید.", "اگر حافظه پلن کم است، پلن بزرگ‌تری انتخاب کنید.", "اگر مشکل ادامه داشت، تیکت ثبت کنید."],
      prefer: ["db_restart", "ticket"],
    }),
  },
];

const FALLBACK = (kind: ExplainKind): SimAnswer => ({
  summary: "خطایی رخ داد که الگوی شناخته‌شده‌ای ندارد.",
  cause: "جزئیات خطا برای تشخیص خودکار کافی نیست.",
  steps: kind === "rpc"
    ? ["متن خطا را بخوانید؛ معمولاً ورودی نامعتبر یا شرطی که برقرار نیست را می‌گوید.", "چند لحظه بعد دوباره امتحان کنید.", "اگر تکرار شد، تیکت ثبت کنید."]
    : ["لاگ کامل را بررسی کنید.", "اگر تغییر تازه‌ای داده‌اید، به نسخه یا تنظیمات قبلی برگردید.", "اگر مشکل ادامه داشت، تیکت ثبت کنید."],
  prefer: ["rollback", "ticket"],
});

/** the first rule that matches (in order: the specific errors before the generic ones) */
export function simulateExplain(kind: ExplainKind, text: string, facts: SimFacts): SimAnswer {
  for (const r of RULES) if ((!r.kinds || r.kinds.includes(kind)) && r.test.test(text)) return r.answer(facts, text);
  return FALLBACK(kind);
}
