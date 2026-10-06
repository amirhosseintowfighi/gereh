import { hashStr, roundK } from "./format";

export type Tld = { tld: string; reg: number; renew: number; transfer: number; cat: string; hot?: boolean; promo?: boolean };
export const TLDS: Tld[] = [
  { tld: ".ir", reg: 95000, renew: 95000, transfer: 0, cat: "national", hot: true },
  { tld: ".co.ir", reg: 95000, renew: 95000, transfer: 0, cat: "national" },
  { tld: ".com", reg: 1450000, renew: 1590000, transfer: 1450000, cat: "popular", hot: true },
  { tld: ".net", reg: 1690000, renew: 1790000, transfer: 1690000, cat: "popular" },
  { tld: ".org", reg: 1590000, renew: 1690000, transfer: 1590000, cat: "popular" },
  { tld: ".co", reg: 2390000, renew: 2790000, transfer: 2390000, cat: "popular" },
  { tld: ".io", reg: 4900000, renew: 5200000, transfer: 4900000, cat: "tech", hot: true },
  { tld: ".dev", reg: 1890000, renew: 1990000, transfer: 1890000, cat: "tech" },
  { tld: ".app", reg: 2100000, renew: 2200000, transfer: 2100000, cat: "tech" },
  { tld: ".ai", reg: 8900000, renew: 8900000, transfer: 8900000, cat: "tech" },
  { tld: ".cloud", reg: 690000, renew: 2100000, transfer: 2100000, cat: "tech", promo: true },
  { tld: ".xyz", reg: 290000, renew: 1450000, transfer: 1450000, cat: "new", promo: true },
  { tld: ".online", reg: 390000, renew: 3200000, transfer: 3200000, cat: "new", promo: true },
  { tld: ".shop", reg: 490000, renew: 3100000, transfer: 3100000, cat: "new" },
  { tld: ".store", reg: 590000, renew: 4200000, transfer: 4200000, cat: "new" },
  { tld: ".tech", reg: 790000, renew: 4100000, transfer: 4100000, cat: "tech" },
];
export const TLD_CATS = [
  { id: "all", label: "همه" }, { id: "national", label: "ملی" }, { id: "popular", label: "محبوب" },
  { id: "tech", label: "فناوری" }, { id: "new", label: "جدید" },
];

const TAKEN = ["google", "apple", "digikala", "snapp", "amazon", "gereh", "facebook", "aparat", "divar", "test"];
const sortedTlds = TLDS.slice().sort((a, b) => b.tld.length - a.tld.length);

export function parseDomain(raw: string): { name: string; tld: string | null; error?: undefined } | { error: string } {
  const s = String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (!s) return { error: "یک نام وارد کنید؛ مثلا mybrand یا mybrand.ir" };
  const match = sortedTlds.find((t) => s.endsWith(t.tld) && s.length > t.tld.length);
  const name = match ? s.slice(0, -match.tld.length) : s.split(".")[0];
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name))
    return { error: "نام دامنه فقط حروف انگلیسی، عدد و خط تیره می‌پذیرد و نباید با خط تیره شروع یا تمام شود." };
  return { name, tld: match ? match.tld : null };
}
// ponytail: deterministic fake WHOIS until the registrar API (/domains/check) is wired.
export const isAvailable = (name: string, tld: string) =>
  !(TAKEN.includes(name) || name.length <= 2 || hashStr(name + tld) % 3 === 0);

export type Plan = {
  id: string; name: string; tag?: string; price: number; popular?: boolean; active?: boolean;
  cpu?: string; ram?: string; disk: string; traffic: string; port?: string; ipv4?: string; snap?: string; backup?: string;
  sites?: string; email?: string; db?: string;
};
export const VPS: { cloud: Plan[]; metal: Plan[] } = {
  cloud: [
    { id: "c1", name: "استارت", tag: "پروژه شخصی و محیط تست", price: 390000, cpu: "۱ هسته", ram: "۲ گیگابایت", disk: "۴۰ گیگ NVMe", traffic: "۲ ترابایت", port: "۱ گیگابیت", ipv4: "۱ عدد", snap: "۱ عدد", backup: "هفتگی" },
    { id: "c2", name: "پایه", tag: "وب‌سایت و API سبک", price: 690000, cpu: "۲ هسته", ram: "۴ گیگابایت", disk: "۸۰ گیگ NVMe", traffic: "۴ ترابایت", port: "۱ گیگابیت", ipv4: "۱ عدد", snap: "۲ عدد", backup: "هفتگی" },
    { id: "c3", name: "حرفه‌ای", tag: "فروشگاه و اپ پرترافیک", price: 1290000, popular: true, cpu: "۴ هسته", ram: "۸ گیگابایت", disk: "۱۶۰ گیگ NVMe", traffic: "۶ ترابایت", port: "۱ گیگابیت", ipv4: "۱ عدد", snap: "۵ عدد", backup: "روزانه" },
    { id: "c4", name: "سازمانی", tag: "دیتابیس و سرویس حیاتی", price: 2390000, cpu: "۸ هسته", ram: "۱۶ گیگابایت", disk: "۳۲۰ گیگ NVMe", traffic: "۱۰ ترابایت", port: "۲ گیگابیت", ipv4: "۲ عدد", snap: "۱۰ عدد", backup: "روزانه" },
  ],
  metal: [
    { id: "m1", name: "BM-1", tag: "Intel Xeon E-2388G", price: 9800000, cpu: "۸ هسته / ۱۶ رشته", ram: "۶۴ گیگ ECC", disk: "۲×۱ ترابایت NVMe", traffic: "نامحدود", port: "۱ گیگابیت", ipv4: "۴ عدد", snap: "ندارد", backup: "اختیاری" },
    { id: "m2", name: "BM-2", tag: "Intel Xeon Silver 4314", price: 14900000, popular: true, cpu: "۱۶ هسته / ۳۲ رشته", ram: "۱۲۸ گیگ ECC", disk: "۲×۱٫۹۲ ترابایت NVMe", traffic: "نامحدود", port: "۱ گیگابیت", ipv4: "۸ عدد", snap: "ندارد", backup: "اختیاری" },
    { id: "m3", name: "BM-3", tag: "AMD EPYC 7443P", price: 24900000, cpu: "۲۴ هسته / ۴۸ رشته", ram: "۲۵۶ گیگ ECC", disk: "۴×۳٫۸۴ ترابایت NVMe", traffic: "نامحدود", port: "۱۰ گیگابیت", ipv4: "۱۶ عدد", snap: "ندارد", backup: "اختیاری" },
  ],
};
/** Numeric resources for each cloud plan (cpu, ram GB, disk GB) — used by resize. */
export const PLAN_NUMS: Record<string, [number, number, number]> = { c1: [1, 2, 40], c2: [2, 4, 80], c3: [4, 8, 160], c4: [8, 16, 320] };

export const BILLING = [
  { id: "m", label: "ماهانه", months: 1, disc: 0 },
  { id: "q", label: "سه‌ماهه", months: 3, disc: 0.05, badge: "۵٪" },
  { id: "y", label: "سالانه", months: 12, disc: 0.2, badge: "۲۰٪" },
];
export type Loc = { id: string; label: string; sub: string; ping: number; metal: boolean; foreign: boolean; up: number; speed: number };
export const LOCS: Loc[] = [
  { id: "thr", label: "تهران", sub: "دیتاسنتر اصلی", ping: 8, metal: true, foreign: false, up: 99.998, speed: 940 },
  { id: "isf", label: "اصفهان", sub: "دیتاسنتر پشتیبان", ping: 14, metal: false, foreign: false, up: 99.991, speed: 870 },
  { id: "fra", label: "فرانکفورت", sub: "آلمان", ping: 86, metal: true, foreign: true, up: 99.996, speed: 610 },
  { id: "ams", label: "آمستردام", sub: "هلند", ping: 93, metal: false, foreign: true, up: 99.993, speed: 580 },
];
export const locLabel = (id: string) => (LOCS.find((l) => l.id === id) || LOCS[0]).label;
export const OSES = [
  { id: "ubuntu", label: "Ubuntu 24.04" }, { id: "debian", label: "Debian 12" },
  { id: "alma", label: "AlmaLinux 9" }, { id: "win", label: "Windows 2022" },
];
export const HOSTING: { linux: Plan[]; wordpress: Plan[] } = {
  linux: [
    { id: "h1", name: "برنز", price: 89000, disk: "۲ گیگ NVMe", sites: "۱ سایت", traffic: "۵۰ گیگ", email: "۵ ایمیل", db: "۲ دیتابیس" },
    { id: "h2", name: "نقره", price: 189000, popular: true, disk: "۱۰ گیگ NVMe", sites: "۳ سایت", traffic: "۲۰۰ گیگ", email: "۲۵ ایمیل", db: "۱۰ دیتابیس" },
    { id: "h3", name: "طلا", price: 349000, disk: "۳۰ گیگ NVMe", sites: "۱۰ سایت", traffic: "نامحدود", email: "نامحدود", db: "نامحدود" },
    { id: "h4", name: "الماس", price: 590000, disk: "۸۰ گیگ NVMe", sites: "نامحدود", traffic: "نامحدود", email: "نامحدود", db: "نامحدود" },
  ],
  wordpress: [
    { id: "w1", name: "وردپرس شخصی", price: 129000, disk: "۵ گیگ NVMe", sites: "۱ سایت", traffic: "۱۰۰ گیگ", email: "۵ ایمیل", db: "۱ دیتابیس" },
    { id: "w2", name: "وردپرس کسب‌وکار", price: 259000, popular: true, disk: "۲۰ گیگ NVMe", sites: "۳ سایت", traffic: "نامحدود", email: "۳۰ ایمیل", db: "۵ دیتابیس" },
    { id: "w3", name: "ووکامرس", price: 449000, disk: "۵۰ گیگ NVMe", sites: "۵ سایت", traffic: "نامحدود", email: "نامحدود", db: "نامحدود" },
  ],
};
export const CPU_STEPS = [1, 2, 4, 6, 8, 12, 16, 24, 32];
export const RAM_STEPS = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128];
export const DISK_STEPS = [20, 40, 80, 120, 160, 240, 320, 480, 640, 960, 1280, 1920];

export type Config = { cpu: number; ram: number; disk: number; loc: string; os: string; ips: number; backup: boolean };
export function configPrice(c: Config) {
  let p = 90000 + c.cpu * 150000 + c.ram * 60000 + c.disk * 900;
  if (LOCS.find((l) => l.id === c.loc)?.foreign) p *= 1.12;
  if (c.os === "win") p += 150000;
  p += c.ips * 120000;
  if (c.backup) p *= 1.12;
  return roundK(p);
}

export const PRESETS = [
  { id: "p1", name: "سبک", cpu: 2, ram: 4, disk: 80, use: "وب‌سایت شرکتی" },
  { id: "p2", name: "متعادل", cpu: 4, ram: 8, disk: 160, use: "فروشگاه اینترنتی" },
  { id: "p3", name: "قدرتمند", cpu: 8, ram: 16, disk: 320, use: "اپلیکیشن و دیتابیس" },
];
export const SITE_REC = [
  { id: "1", label: "۱ سایت", plan: HOSTING.linux[0] },
  { id: "3", label: "تا ۳ سایت", plan: HOSTING.linux[1] },
  { id: "10", label: "تا ۱۰ سایت", plan: HOSTING.linux[2] },
  { id: "n", label: "بیشتر", plan: HOSTING.linux[3] },
];

export const HOME_FAQ: [string, string][] = [
  ["سرور ابری چقدر طول می‌کشد آماده شود؟", "پس از پرداخت، سرور در کمتر از یک دقیقه ساخته می‌شود و اطلاعات ورود به ایمیل و پنل شما ارسال می‌شود."],
  ["انتقال سایت یا سرور فعلی‌ام چطور انجام می‌شود؟", "دسترسی سرور یا هاست فعلی را در تیکت بفرستید. تیم ما فایل‌ها و دیتابیس را منتقل می‌کند و تنها پس از تأیید شما DNS را تغییر می‌دهد؛ بدون قطعی و بدون هزینه."],
  ["پرداخت ساعتی یعنی چه؟", "هزینه سرور ابری بر اساس ساعت‌های روشن بودن از کیف پول کم می‌شود. سرور را حذف کنید، هزینه متوقف می‌شود."],
  ["اگر از سرویس راضی نباشم؟", "تا ۷ روز پس از اولین خرید، کل مبلغ بدون هیچ پرسشی بازگردانده می‌شود."],
];
export const HOSTING_FAQ: [string, string][] = [
  ["تفاوت هاست وردپرس با هاست لینوکس چیست؟", "هاست وردپرس روی همان زیرساخت است، اما با PHP بهینه، کش Redis و به‌روزرسانی خودکار وردپرس و افزونه‌ها ارائه می‌شود."],
  ["می‌توانم بعدا پلن را ارتقا دهم؟", "بله. ارتقا بدون جابه‌جایی فایل و بدون قطعی انجام می‌شود و فقط مابه‌التفاوت روزهای باقی‌مانده محاسبه می‌شود."],
  ["ایمیل سازمانی هم دارید؟", "همه پلن‌ها ایمیل با دامنه شخصی دارند که از وب‌میل یا نرم‌افزارهای ایمیل در دسترس است."],
  ["هاست در کدام دیتاسنتر است؟", "همه هاست‌ها در دیتاسنتر تهران میزبانی می‌شوند و بکاپ‌ها در دیتاسنتر اصفهان نگهداری می‌شوند."],
];
