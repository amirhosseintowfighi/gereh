/* The documentation index: every guide under /docs, grouped for the hub page (/docs), the sitemap and search.
   Guides with their own route (api, mcp, paas, ai-api, inquiry, geo-dns) are listed here too; the rest render
   through /docs/[doc] from the GUIDES map below. Bodies use the Markdown subset of src/lib/markdown.tsx. */
import { accountDocs } from "./account";
import { aiToolsDocs } from "./ai-tools";
import { billingDocs } from "./billing";
import { builderDocs } from "./builder";
import { databasesDocs } from "./databases";
import { devopsDocs } from "./devops";
import { domainsDocs } from "./domains";
import { hostingDocs } from "./hosting";
import { mailDocs } from "./mail";
import { mirrorDocs } from "./mirror";
import { startDocs } from "./start";
import { storageDocs } from "./storage";
import { supportDocs } from "./support";
import { vpsDocs } from "./vps";
import { wordpressDocs } from "./wordpress";

export type DocGroup = "start" | "infra" | "apps" | "services" | "dev" | "account";
export const DOC_GROUPS: Record<DocGroup, { label: string; icon: string }> = {
  start: { label: "شروع", icon: "rocket" },
  infra: { label: "زیرساخت", icon: "server" },
  apps: { label: "اپ و وب‌سایت", icon: "layers" },
  services: { label: "سرویس‌ها و API", icon: "plug" },
  dev: { label: "توسعه‌دهندگان", icon: "code-xml" },
  account: { label: "حساب و پشتیبانی", icon: "user-round" },
};

export type DocEntry = { slug: string; group: DocGroup; icon: string; title: string; description: string;
  /** the product's page and the panel page where it is used (aside links) */
  product?: [string, string]; panel?: [string, string] };

/** the order here is the order on the hub page */
export const DOCS: DocEntry[] = [
  { slug: "getting-started", group: "start", icon: "rocket", title: "شروع کار با گره", description: "معرفی محصولات، انتخاب سرویس مناسب، پنج قدم اول و آشنایی با پنل." },
  { slug: "vps", group: "infra", icon: "server", title: "سرور ابری و اختصاصی", description: "انتخاب پلن و دیتاسنتر، پرداخت ماهانه یا ساعتی، SSH، بکاپ و اسنپ‌شات، شبکه، فایروال، دیسک، ترافیک، ارتقا و ریسکیو.", product: ["سرور ابری", "/vps"], panel: ["سرورهای ابری", "/panel/servers"] },
  { slug: "domains", group: "infra", icon: "globe", title: "دامنه، DNS و CDN", description: "ثبت و انتقال دامنه، دامنه‌های .ir و شناسه ایرنیک، نام‌سرورها، رکوردهای DNS، DNSSEC و CDN گره.", product: ["دامنه", "/domains"], panel: ["دامنه‌ها", "/panel/domains"] },
  { slug: "geo-dns", group: "infra", icon: "radar", title: "Geo DNS", description: "تفکیک بازدیدکنندگان ایران و خارج، سوییچ خودکار هنگام قطعی و همگام‌سازی سرور خارج.", product: ["Geo DNS", "/geo-dns"], panel: ["Geo DNS", "/panel/geo"] },
  { slug: "storage", group: "infra", icon: "hard-drive", title: "فضای ذخیره‌سازی ابری (S3)", description: "باکت، کلید دسترسی، نمونه کد Node.js، Python، PHP، Go، rclone و aws-cli، دامنه اختصاصی، CORS، نسخه‌بندی و حذف خودکار.", product: ["فضای ذخیره‌سازی", "/storage"], panel: ["فضای ذخیره‌سازی", "/panel/storage"] },
  { slug: "mirror", group: "infra", icon: "package-open", title: "میرور مخازن", description: "تنظیم npm، PyPI، Composer، Go، Docker Hub، GHCR، apt، dnf و ده‌ها مخزن دیگر روی میرور رایگان گره.", product: ["میرور", "/mirror"] },
  { slug: "hosting", group: "apps", icon: "layers", title: "هاست وب (cPanel)", description: "پلن‌ها، اتصال دامنه، کار با cPanel، ایمیل، انتقال سایت، تمدید و رفع خطاهای رایج.", product: ["هاست وب", "/hosting"], panel: ["هاست‌ها", "/panel/hosting"] },
  { slug: "wordpress", group: "apps", icon: "layers", title: "وردپرس مدیریت‌شده", description: "بسته‌های اکو و توربو، ساخت سایت، انتقال از cPanel، اتصال دامنه، کش و ایمیل وردپرس.", product: ["وردپرس", "/wordpress"], panel: ["وردپرس", "/panel/wordpress"] },
  { slug: "paas", group: "apps", icon: "rocket", title: "گره اپ (PaaS)", description: "استقرار از Git، ZIP، Docker و Compose، بیلد خودکار، متغیرها، دامنه، مقیاس، CLI و CI/CD.", product: ["گره اپ", "/paas"], panel: ["اپ‌ها", "/panel/apps"] },
  { slug: "databases", group: "apps", icon: "database", title: "پایگاه داده مدیریت‌شده", description: "۱۶ موتور از PostgreSQL تا Redis و MongoDB، اتصال، کاربران، پشتیبان و بازگردانی، درون‌ریزی، افزونه‌ها و پرسش با هوش مصنوعی.", product: ["پایگاه داده", "/paas/databases"], panel: ["پایگاه داده", "/panel/databases"] },
  { slug: "builder", group: "apps", icon: "sparkles", title: "بافت: ساخت اپ با هوش مصنوعی", description: "از ایده فارسی تا سایت منتشرشده: نوشتن ایده، ویرایش، نسخه‌ها، انتشار، رفع خودکار خطا و نگهداری.", product: ["بافت", "/build"], panel: ["بافت", "/panel/build"] },
  { slug: "mail", group: "services", icon: "mail", title: "سرویس ایمیل", description: "ایمیل تراکنشی با HTTP API و SMTP، رکوردهای DKIM و SPF و DMARC، صندوق ایمیل، کدهای خطا و تحویل به صندوق.", product: ["سرویس ایمیل", "/mail"], panel: ["سرویس ایمیل", "/panel/mail"] },
  { slug: "ai-api", group: "services", icon: "bot", title: "API هوش مصنوعی", description: "اتصال Claude Code، Codex، Cursor و SDKهای OpenAI، Anthropic و Gemini، استریم، هزینه و کدهای خطا.", product: ["API هوش مصنوعی", "/ai-api"], panel: ["API هوش مصنوعی", "/panel/ai"] },
  { slug: "inquiry", group: "services", icon: "fingerprint", title: "API استعلام", description: "احراز هویت، sandbox رایگان، قالب پاسخ، خطاها و ورودی و خروجی هر سرویس استعلام.", product: ["API استعلام", "/inquiry"], panel: ["API استعلام", "/panel/inquiry"] },
  { slug: "ai-tools", group: "services", icon: "sparkles", title: "ابزارهای هوشمند پنل", description: "دستیار گره در پنل و تلگرام و بله، پایش هوشمند، پایش پیشرفته، مشاور هزینه و «توضیح بده و درستش کن».", panel: ["دستیار گره", "/panel/assistant"] },
  { slug: "devops", group: "services", icon: "workflow", title: "خدمات دواپس", description: "خدمات، مراحل همکاری، بسته‌ها، زمان پاسخ به حادثه و قواعد دسترسی و امنیت.", product: ["دواپس", "/devops"], panel: ["خدمات دواپس", "/panel/devops"] },
  { slug: "api", group: "dev", icon: "code-xml", title: "API عمومی و Terraform", description: "REST API برای سرورها، DNS، اپ‌ها و صورتحساب، احراز هویت با توکن، کدهای خطا، OpenAPI و Terraform provider.", panel: ["ساخت توکن", "/panel/keys"] },
  { slug: "mcp", group: "dev", icon: "bot", title: "MCP: اتصال ایجنت‌های هوش مصنوعی", description: "مدیریت سرورها، اپ‌ها و DNS از Claude Code، Cursor، Codex و VS Code با زبان طبیعی.", panel: ["ساخت توکن", "/panel/keys"] },
  { slug: "billing", group: "account", icon: "wallet", title: "کیف پول، صورتحساب و پرداخت", description: "شارژ کیف پول، پرداخت ساعتی و ماهانه، تمدید خودکار، تعلیق، بودجه، کیف پول پروژه، فاکتور رسمی و معرفی دوستان.", panel: ["صورتحساب و کیف پول", "/panel/billing"] },
  { slug: "account", group: "account", icon: "shield-check", title: "حساب، امنیت و تیم", description: "ورود و ورود دومرحله‌ای، کدهای بازیابی، احراز هویت، نقش‌های تیم، کلید SSH، توکن API و اعلان‌ها.", panel: ["تنظیمات حساب", "/panel/account"] },
  { slug: "support", group: "account", icon: "life-buoy", title: "پشتیبانی، وضعیت و SLA", description: "تیکت و گفتگوی آنلاین، نوشتن یک تیکت خوب، پاسخ هوش مصنوعی، زمان پاسخ، صفحه وضعیت و توافق سطح خدمات.", panel: ["تیکت‌ها", "/panel/tickets"] },
];

export type GuideEnv = { site: string; storageEndpoint: string; storageRegion: string; mirror: string };
export type Guide = { lead: string; body: (env: GuideEnv) => string };

/** guides rendered by /docs/[doc] (the others have their own page) */
export const GUIDES: Record<string, Guide> = {
  "getting-started": { lead: "سرویس مناسب را انتخاب کنید و در چند دقیقه شروع کنید.", body: () => startDocs() },
  vps: { lead: "از انتخاب پلن تا بکاپ، فایروال و رفع مشکل دسترسی.", body: (e) => vpsDocs(e.site) },
  domains: { lead: "ثبت، انتقال، رکوردهای DNS، DNSSEC و CDN در یک‌جا.", body: () => domainsDocs() },
  storage: { lead: "هر ابزاری که با S3 کار می‌کند، با گره هم کار می‌کند.", body: (e) => storageDocs(e.storageEndpoint, e.storageRegion) },
  mirror: { lead: "نصب بسته‌ها با سرعت شبکه داخلی، حتی در قطعی اینترنت بین‌الملل.", body: (e) => mirrorDocs(e.mirror, e.site) },
  hosting: { lead: "سایت را بالا بیاورید؛ سرور، SSL و بکاپ با ما.", body: () => hostingDocs() },
  wordpress: { lead: "وردپرس با منابع اختصاصی، پایگاه داده جدا و انتقال رایگان از cPanel.", body: () => wordpressDocs() },
  databases: { lead: "پایگاه داده آماده در چند ثانیه؛ پشتیبان و به‌روزرسانی با ما.", body: () => databasesDocs() },
  builder: { lead: "ایده را به فارسی بنویسید؛ سایت یا اپ را تحویل بگیرید.", body: () => builderDocs() },
  mail: { lead: "ایمیل‌هایتان به صندوق برسند، نه به هرزنامه.", body: (e) => mailDocs(e.site) },
  "ai-tools": { lead: "هوش مصنوعی‌ای که سرویس‌هایتان را می‌شناسد و کمک می‌کند.", body: () => aiToolsDocs() },
  devops: { lead: "زیرساختتان را به تیم دواپس گره بسپارید.", body: () => devopsDocs() },
  billing: { lead: "هزینه‌ها را بشناسید، کنترل کنید و غافلگیر نشوید.", body: () => billingDocs() },
  account: { lead: "حساب را امن کنید و با تیم‌تان کار کنید.", body: () => accountDocs() },
  support: { lead: "سریع‌ترین راه برای گرفتن جواب.", body: () => supportDocs() },
};

export const docOf = (slug: string) => DOCS.find((d) => d.slug === slug);
export const docHref = (slug: string) => "/docs/" + slug;
