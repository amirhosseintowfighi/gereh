/* Copy for the public Gereh Apps (PaaS) pages: /paas, /paas/databases, /paas/<stack>, /docs/paas.
   Prices are not here: they come from paas_plans so staff can change them in the admin panel. */
import type { StackId } from "@/lib/paas";

export const PAAS_FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: "code-xml", title: "استقرار از Git با هر push", text: "مخزن GitHub، GitLab یا Gitea را وصل کنید؛ هر push روی شاخه انتخابی، خودکار بیلد و بدون قطعی جایگزین نسخه قبلی می‌شود." },
  { icon: "upload", title: "ZIP، Docker یا Compose", text: "مخزن ندارید؟ پوشه پروژه را ZIP کنید، یک ایمیج Docker بدهید یا فایل docker-compose.yml را بفرستید." },
  { icon: "sparkles", title: "تشخیص خودکار زبان", text: "Node.js، Next.js، Python، Django، Laravel، Go، Java، .NET و… را تشخیص می‌دهیم و بدون Dockerfile بیلد می‌کنیم." },
  { icon: "shield-check", title: "SSL و دامنه اختصاصی", text: "هر اپ از لحظه ساخت آدرس HTTPS دارد. دامنه خودتان را با یک رکورد CNAME وصل کنید؛ گواهی خودکار صادر و تمدید می‌شود." },
  { icon: "database", title: "پایگاه داده مدیریت‌شده", text: "PostgreSQL، MySQL، MariaDB، MongoDB و Redis با پشتیبان روزانه؛ با یک کلیک به اپ وصل می‌شود و DATABASE_URL خودکار تنظیم می‌شود." },
  { icon: "gauge", title: "مقیاس افقی و خودکار", text: "تعداد نمونه‌ها را با یک کلیک زیاد کنید یا بگذارید با بار CPU خودکار بالا و پایین برود؛ ترافیک بین نمونه‌ها پخش می‌شود." },
  { icon: "refresh-cw", title: "استقرار بدون قطعی و بازگشت", text: "نسخه جدید فقط وقتی جایگزین می‌شود که health check آن موفق باشد. هر نسخه قبلی با یک کلیک برمی‌گردد." },
  { icon: "terminal", title: "لاگ زنده و نمودار مصرف", text: "لاگ بیلد و اجرا را زنده ببینید، جستجو کنید و مصرف CPU، حافظه و تعداد درخواست را در نمودار دنبال کنید." },
  { icon: "lock", title: "متغیرهای محیطی امن", text: "مقادیر محرمانه رمزنگاری‌شده ذخیره می‌شوند و بعد از ثبت حتی در پنل هم نمایش داده نمی‌شوند. فایل ‎.env را مستقیم بچسبانید." },
  { icon: "hard-drive", title: "دیسک دائمی", text: "برای فایل‌های آپلودی، WordPress یا SQLite یک دیسک NVMe دائمی بگیرید که با هر استقرار پاک نمی‌شود." },
  { icon: "wallet", title: "پرداخت ساعتی از کیف پول", text: "هر ساعت فقط به اندازه منابع روشن پرداخت می‌کنید. اپ خاموش هزینه پردازش ندارد. بدون قرارداد و بدون حداقل." },
  { icon: "key-round", title: "CLI و API", text: "با یک دستور از ترمینال یا CI مستقر کنید، لاگ بگیرید و متغیرها را تنظیم کنید؛ همه چیز با API عمومی گره هم در دسترس است." },
];

export const PAAS_STEPS: [string, string, string][] = [
  ["code-xml", "کد را بدهید", "مخزن Git، فایل ZIP یا ایمیج Docker."],
  ["sparkles", "بیلد خودکار", "زبان و فریم‌ورک تشخیص داده و ایمیج ساخته می‌شود."],
  ["rocket", "اجرا با HTTPS", "اپ روی <نام>.gereh.app با SSL بالا می‌آید."],
  ["gauge", "رشد کنید", "دامنه، پایگاه داده و نمونه بیشتر؛ هر وقت لازم شد."],
];

export const PAAS_COMPARE: { row: string; paas: string; vps: string; host: string }[] = [
  { row: "مناسب برای", paas: "اپ‌های Node، Python، Go، PHP و…", vps: "کنترل کامل سیستم‌عامل", host: "سایت‌های PHP و وردپرس" },
  { row: "نصب و نگهداری سرور", paas: "ندارد", vps: "با شما", host: "ندارد" },
  { row: "استقرار با git push", paas: "دارد", vps: "باید راه بیندازید", host: "ندارد" },
  { row: "SSL و دامنه", paas: "خودکار", vps: "دستی", host: "خودکار" },
  { row: "مقیاس افقی", paas: "یک کلیک یا خودکار", vps: "دستی", host: "ندارد" },
  { row: "پرداخت", paas: "ساعتی", vps: "ساعتی یا ماهانه", host: "ماهانه یا سالانه" },
];

export const PAAS_FAQ: [string, string][] = [
  ["گره اپ با سرور ابری چه فرقی دارد؟", "در سرور ابری شما مسئول سیستم‌عامل، به‌روزرسانی، Nginx، SSL و استقرار هستید. در گره اپ فقط کد را می‌دهید؛ بیلد، اجرا، SSL، لاگ، مقیاس و پشتیبان پایگاه داده با ماست."],
  ["هزینه چطور حساب می‌شود؟", "قیمت هر پلن ماهانه اعلام شده و هر ساعت ۱/۷۲۰ آن از کیف پول کم می‌شود. اپ خاموش فقط هزینه دیسک دائمی (اگر داشته باشد) دارد. برای ساخت یا بزرگ کردن سرویس باید دست‌کم اعتبار ۲۴ ساعت در کیف پول باشد."],
  ["اگر موجودی کیف پول تمام شود چه می‌شود؟", "سرویس‌ها معلق (خاموش) می‌شوند ولی داده‌ها، پایگاه‌های داده و پشتیبان‌ها حذف نمی‌شوند. با شارژ کیف پول همه چیز خودکار دوباره روشن می‌شود."],
  ["مخزن خصوصی را پشتیبانی می‌کنید؟", "بله. یک توکن دسترسی فقط-خواندنی (GitHub fine-grained token یا GitLab deploy token) در نشانی مخزن بگذارید. برای استقرار خودکار، آدرس webhook اپ را در تنظیمات مخزن ثبت کنید."],
  ["Dockerfile لازم است؟", "نه. برای زبان‌های رایج بیلد خودکار انجام می‌شود. اگر Dockerfile در ریشه پروژه باشد، همان استفاده می‌شود؛ می‌توانید ایمیج آماده هم بدهید."],
  ["اپ من باید روی چه پورتی گوش بدهد؟", "روی 0.0.0.0 و پورتی که هنگام ساخت مشخص کرده‌اید. متغیر PORT همیشه تنظیم می‌شود؛ بهترین کار خواندن پورت از همین متغیر است."],
  ["داده‌ها کجا نگه داشته می‌شوند؟", "اپ‌ها و پایگاه‌های داده در دیتاسنتر تهران اجرا می‌شوند و پشتیبان‌ها در فضای ذخیره‌سازی جداگانه در داخل کشور نگه داشته می‌شوند."],
  ["پشتیبان پایگاه داده چطور است؟", "پشتیبان خودکار روزانه با نگهداری ۷ نسخه آخر، به‌علاوه تا ۱۰ پشتیبان دستی. بازگردانی از پنل با یک کلیک انجام می‌شود."],
  ["WebSocket و کارهای پس‌زمینه پشتیبانی می‌شود؟", "WebSocket و Server-Sent Events پشتیبانی می‌شوند. برای worker یا صف، یک اپ جدا با همان کد و دستور اجرای متفاوت بسازید یا از Docker Compose استفاده کنید."],
  ["می‌توانم از گره اپ به سرور ابری مهاجرت کنم؟", "بله، هیچ قفلی وجود ندارد: ایمیج‌ها استاندارد Docker هستند و پشتیبان پایگاه داده را می‌توانید دانلود کنید. تیم دواپس گره هم در مهاجرت کمک می‌کند."],
];

export const DB_FAQ: [string, string][] = [
  ["از بیرون گره می‌توانم به پایگاه داده وصل شوم؟", "به‌طور پیش‌فرض فقط اپ‌های خود شما به آن دسترسی دارند. با روشن کردن «دسترسی از بیرون» یک پورت عمومی با TLS می‌گیرید تا از سیستم خودتان یا ابزارهایی مثل DBeaver وصل شوید."],
  ["پلن را می‌توانم بزرگ‌تر کنم؟", "بله، از پنل و با چند ثانیه ری‌استارت. دیسک قابل کوچک کردن نیست؛ برای کوچک‌تر شدن، پایگاه جدید بسازید و داده را منتقل کنید."],
  ["نسخه موتور را چه کسی به‌روز می‌کند؟", "به‌روزرسانی‌های امنیتی نسخه‌های فرعی (patch) را ما در پنجره نگهداری اعمال می‌کنیم. ارتقای نسخه اصلی با خود شماست تا ناسازگاری غافلگیرتان نکند."],
  ["پشتیبان را می‌توانم دانلود کنم؟", "بله؛ از طریق تیکت یا API لینک دانلود موقت فایل پشتیبان صادر می‌شود."],
];

export type StackGuide = { id: StackId; slug: string; title: string; intro: string; detect: string; tips: string[]; sample?: { file: string; code: string } };

export const STACK_GUIDES: StackGuide[] = [
  { id: "nextjs", slug: "nextjs", title: "هاست Next.js", intro: "Next.js را با SSR، ISR، App Router و API Routes روی گره اپ اجرا کنید؛ بدون محدودیت توابع serverless و با پرداخت ساعتی.",
    detect: "وجود next در dependencies فایل package.json",
    tips: ["در next.config گزینه output: \"standalone\" حجم ایمیج و زمان شروع را کم می‌کند.", "متغیرهایی که با NEXT_PUBLIC_ شروع می‌شوند هنگام بیلد خوانده می‌شوند؛ بعد از تغییرشان یک استقرار جدید بزنید.", "برای کش ISR مشترک بین چند نمونه از Redis گره استفاده کنید."],
    sample: { file: "package.json", code: "{\n  \"scripts\": {\n    \"build\": \"next build\",\n    \"start\": \"next start -p $PORT\"\n  }\n}" } },
  { id: "node", slug: "nodejs", title: "هاست Node.js", intro: "Express، NestJS، Fastify، Koa یا هر سرور Node.js را با استقرار از Git و SSL خودکار اجرا کنید.",
    detect: "فایل package.json در ریشه پروژه",
    tips: ["پورت را از process.env.PORT بخوانید و روی 0.0.0.0 گوش دهید.", "نسخه Node را با فیلد engines در package.json مشخص کنید.", "اسکریپت start باید سرور را اجرا کند؛ اگر TypeScript دارید، build را هم تعریف کنید."],
    sample: { file: "server.js", code: "const app = require(\"express\")();\napp.get(\"/\", (_, res) => res.send(\"سلام از گره\"));\napp.listen(process.env.PORT || 3000, \"0.0.0.0\");" } },
  { id: "nuxt", slug: "nuxt", title: "هاست Nuxt", intro: "اپ‌های Nuxt 3 با رندر سمت سرور و Nitro را بدون تنظیمات اضافه مستقر کنید.",
    detect: "وجود nuxt در package.json",
    tips: ["خروجی پیش‌فرض node-server را تغییر ندهید.", "متغیرهای runtimeConfig را با پیشوند NUXT_ در بخش متغیرها تعریف کنید."] },
  { id: "react", slug: "react", title: "هاست React و Vite", intro: "اپ‌های React، Vue یا Svelte ساخته‌شده با Vite را بیلد کنید و پشت Nginx با کش درست و HTTPS سرو کنید.",
    detect: "وجود vite یا react-scripts در package.json",
    tips: ["برای مسیریابی سمت کاربر، همه مسیرها به index.html برمی‌گردند (SPA fallback فعال است).", "متغیرهای VITE_ هنگام بیلد خوانده می‌شوند."] },
  { id: "django", slug: "django", title: "هاست Django", intro: "پروژه Django را با gunicorn، collectstatic خودکار و PostgreSQL مدیریت‌شده در چند دقیقه بالا بیاورید.",
    detect: "فایل manage.py و Django در requirements.txt",
    tips: ["ALLOWED_HOSTS را از متغیر محیطی بخوانید و دامنه اپ را در آن بگذارید.", "برای فایل‌های استاتیک از whitenoise استفاده کنید.", "DATABASE_URL را با dj-database-url بخوانید؛ با اتصال پایگاه داده خودکار تنظیم می‌شود.", "migrate را در دستور اجرا قبل از gunicorn بگذارید."],
    sample: { file: "دستور اجرا", code: "python manage.py migrate --noinput && gunicorn config.wsgi --bind 0.0.0.0:$PORT" } },
  { id: "fastapi", slug: "fastapi", title: "هاست FastAPI", intro: "API های FastAPI را با uvicorn و چند نمونه پشت لودبالانسر اجرا کنید.",
    detect: "fastapi در requirements.txt یا pyproject.toml",
    tips: ["دستور اجرا: uvicorn main:app --host 0.0.0.0 --port $PORT", "برای چند پردازه از gunicorn -k uvicorn.workers.UvicornWorker استفاده کنید."] },
  { id: "flask", slug: "flask", title: "هاست Flask", intro: "اپ Flask را با gunicorn و SSL خودکار مستقر کنید.",
    detect: "flask در requirements.txt",
    tips: ["gunicorn را به requirements.txt اضافه کنید.", "دستور اجرا: gunicorn app:app --bind 0.0.0.0:$PORT"] },
  { id: "python", slug: "python", title: "هاست Python", intro: "هر اپلیکیشن وب یا ربات پایتونی را با نصب خودکار وابستگی‌ها اجرا کنید.",
    detect: "requirements.txt، Pipfile یا pyproject.toml",
    tips: ["نسخه پایتون را در فایل ‎.python-version مشخص کنید.", "دستور اجرا را در تنظیمات اپ بنویسید."] },
  { id: "laravel", slug: "laravel", title: "هاست Laravel", intro: "Laravel را با PHP 8.3، Nginx، کش config و MySQL یا PostgreSQL مدیریت‌شده اجرا کنید.",
    detect: "فایل artisan و laravel/framework در composer.json",
    tips: ["APP_KEY را در متغیرهای محیطی (محرمانه) بگذارید.", "برای فایل‌های storage دیسک دائمی بگیرید یا از S3 استفاده کنید.", "برای queue یک اپ دوم با دستور php artisan queue:work بسازید.", "متغیرهای DB_* را از DATABASE_URL یا مستقیم تنظیم کنید."] },
  { id: "php", slug: "php", title: "هاست PHP", intro: "پروژه‌های PHP 8 را با Composer و Nginx بدون مدیریت سرور اجرا کنید.",
    detect: "composer.json یا index.php",
    tips: ["ریشه وب پوشه public است اگر وجود داشته باشد.", "افزونه‌های رایج PHP از پیش نصب‌اند."] },
  { id: "wordpress", slug: "wordpress", title: "وردپرس روی گره اپ", intro: "وردپرس را با دیسک دائمی برای uploads و MySQL مدیریت‌شده، با امکان چند نمونه و کش، اجرا کنید.",
    detect: "فایل wp-config.php یا wp-content",
    tips: ["حتماً دیسک دائمی بگیرید و مسیر آن را wp-content قرار دهید.", "اگر فقط یک سایت ساده وردپرس می‌خواهید، هاست وردپرس گره ساده‌تر و ارزان‌تر است."] },
  { id: "go", slug: "golang", title: "هاست Go", intro: "سرویس‌های Go را با بیلد خودکار به باینری سبک و زمان شروع چند میلی‌ثانیه‌ای اجرا کنید.",
    detect: "فایل go.mod",
    tips: ["پورت را از os.Getenv(\"PORT\") بخوانید.", "اگر main در زیرپوشه است، دستور بیلد را تغییر دهید: go build -o app ./cmd/server"] },
  { id: "java", slug: "java", title: "هاست Java و Spring Boot", intro: "Spring Boot، Quarkus یا Micronaut را با Maven یا Gradle بیلد و اجرا کنید.",
    detect: "pom.xml یا build.gradle",
    tips: ["server.port=${PORT:8080} را در application.properties بگذارید.", "برای JVM پلن با دست‌کم ۱ گیگ حافظه انتخاب کنید."] },
  { id: "dotnet", slug: "dotnet", title: "هاست ASP.NET Core", intro: "اپ‌های ASP.NET Core 8 را با dotnet publish خودکار روی لینوکس اجرا کنید.",
    detect: "فایل ‎*.csproj",
    tips: ["ASPNETCORE_URLS به‌طور خودکار روی پورت اپ تنظیم می‌شود.", "برای چند پروژه، پوشه ریشه را مشخص کنید."] },
  { id: "ruby", slug: "rails", title: "هاست Ruby on Rails", intro: "Rails را با Puma، precompile خودکار assets و PostgreSQL مدیریت‌شده اجرا کنید.",
    detect: "Gemfile",
    tips: ["RAILS_MASTER_KEY را به‌صورت متغیر محرمانه تعریف کنید.", "db:migrate را در دستور اجرا قبل از puma بگذارید."] },
  { id: "static", slug: "static", title: "هاست سایت استاتیک", intro: "سایت‌های HTML یا خروجی Hugo، Astro و Jekyll را با HTTPS و کش درست منتشر کنید.",
    detect: "index.html در ریشه",
    tips: ["پلن Nano برای بیشتر سایت‌های استاتیک کافی است."] },
  { id: "docker", slug: "docker", title: "اجرای ایمیج و Dockerfile", intro: "هر چیزی که Dockerfile دارد را بیلد کنید یا ایمیج آماده را از Docker Hub و GHCR مستقیم اجرا کنید.",
    detect: "Dockerfile در ریشه پروژه",
    tips: ["پورت EXPOSE شده را در تنظیمات اپ وارد کنید.", "کاربر غیر root در ایمیج توصیه می‌شود.", "برای کاهش حجم از multi-stage build استفاده کنید."] },
  { id: "compose", slug: "docker-compose", title: "اجرای Docker Compose", intro: "چند سرویس وابسته را با یک فایل docker-compose.yml با هم مستقر کنید.",
    detect: "docker-compose.yml یا compose.yaml",
    tips: ["سرویسی که پورت عمومی دارد را با label گره مشخص کنید.", "برای پایگاه داده به‌جای کانتینر از پایگاه داده مدیریت‌شده با پشتیبان استفاده کنید."] },
];
export const guideBySlug = (slug: string) => STACK_GUIDES.find((g) => g.slug === slug);
