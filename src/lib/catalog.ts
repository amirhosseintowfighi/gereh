import { fa, hashStr, roundK } from "./format";

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

/* ---------- cloud server unit prices (Toman / month) ----------
   Every cloud price on the site is built from these: plans, the custom builder, upgrades and extra IPs.
   Traffic is stepped: 840k per TB at 1 TB, sliding down to 800k per TB at 10 TB, never below 800k. */
export const UNIT = { cpu: 299_000, ram: 125_000, ip: 240_000, disk10: 125_000, tb: 840_000, tbFloor: 800_000, tbFloorAt: 10 };
/** price of one TB when tb TB are bought */
export const tbRate = (tb: number) => tb <= 1 ? UNIT.tb : Math.max(UNIT.tbFloor, UNIT.tb - ((UNIT.tb - UNIT.tbFloor) * (tb - 1)) / (UNIT.tbFloorAt - 1));
export type Res = { cpu: number; ram: number; disk: number; tb: number; ips: number };
export type PriceLine = { key: "cpu" | "ram" | "disk" | "traffic" | "ip" | "extra"; label: string; amount: number };
/** itemised monthly price of cloud resources (ips = every IPv4, the first one included) */
export function cloudLines(r: Res): PriceLine[] {
  return [
    { key: "cpu", label: fa(r.cpu) + " هسته پردازنده", amount: r.cpu * UNIT.cpu },
    { key: "ram", label: fa(r.ram) + " گیگابایت رم", amount: r.ram * UNIT.ram },
    { key: "disk", label: fa(r.disk) + " گیگابایت NVMe", amount: roundK((r.disk / 10) * UNIT.disk10) },
    { key: "traffic", label: fa(r.tb) + " ترابایت ترافیک (هر ترابایت " + fa(Math.round(tbRate(r.tb) / 1000)) + " هزار)", amount: roundK(r.tb * tbRate(r.tb)) },
    { key: "ip", label: fa(r.ips) + " آی‌پی IPv4", amount: r.ips * UNIT.ip },
  ];
}
export const cloudPrice = (r: Res) => cloudLines(r).reduce((s, l) => s + l.amount, 0);

/** numeric resources of each cloud plan — the plan price is computed from them */
export const CLOUD_SPECS: Record<string, Res> = {
  c1: { cpu: 1, ram: 2, disk: 40, tb: 2, ips: 1 },
  c2: { cpu: 2, ram: 4, disk: 80, tb: 4, ips: 1 },
  c3: { cpu: 4, ram: 8, disk: 160, tb: 6, ips: 1 },
  c4: { cpu: 8, ram: 16, disk: 320, tb: 10, ips: 2 },
};
export const VPS: { cloud: Plan[]; metal: Plan[] } = {
  cloud: [
    { id: "c1", name: "استارت", tag: "پروژه شخصی و محیط تست", price: cloudPrice(CLOUD_SPECS.c1), cpu: "۱ هسته", ram: "۲ گیگابایت", disk: "۴۰ گیگ NVMe", traffic: "۲ ترابایت", port: "۱ گیگابیت", ipv4: "۱ عدد", snap: "۱ عدد", backup: "هفتگی" },
    { id: "c2", name: "پایه", tag: "وب‌سایت و API سبک", price: cloudPrice(CLOUD_SPECS.c2), cpu: "۲ هسته", ram: "۴ گیگابایت", disk: "۸۰ گیگ NVMe", traffic: "۴ ترابایت", port: "۱ گیگابیت", ipv4: "۱ عدد", snap: "۲ عدد", backup: "هفتگی" },
    { id: "c3", name: "حرفه‌ای", tag: "فروشگاه و اپ پرترافیک", price: cloudPrice(CLOUD_SPECS.c3), popular: true, cpu: "۴ هسته", ram: "۸ گیگابایت", disk: "۱۶۰ گیگ NVMe", traffic: "۶ ترابایت", port: "۱ گیگابیت", ipv4: "۱ عدد", snap: "۵ عدد", backup: "روزانه" },
    { id: "c4", name: "سازمانی", tag: "دیتابیس و سرویس حیاتی", price: cloudPrice(CLOUD_SPECS.c4), cpu: "۸ هسته", ram: "۱۶ گیگابایت", disk: "۳۲۰ گیگ NVMe", traffic: "۱۰ ترابایت", port: "۲ گیگابیت", ipv4: "۲ عدد", snap: "۱۰ عدد", backup: "روزانه" },
  ],
  metal: [
    { id: "m1", name: "BM-1", tag: "Intel Xeon E-2388G", price: 9800000, cpu: "۸ هسته / ۱۶ رشته", ram: "۶۴ گیگ ECC", disk: "۲×۱ ترابایت NVMe", traffic: "نامحدود", port: "۱ گیگابیت", ipv4: "۴ عدد", snap: "ندارد", backup: "اختیاری" },
    { id: "m2", name: "BM-2", tag: "Intel Xeon Silver 4314", price: 14900000, popular: true, cpu: "۱۶ هسته / ۳۲ رشته", ram: "۱۲۸ گیگ ECC", disk: "۲×۱٫۹۲ ترابایت NVMe", traffic: "نامحدود", port: "۱ گیگابیت", ipv4: "۸ عدد", snap: "ندارد", backup: "اختیاری" },
    { id: "m3", name: "BM-3", tag: "AMD EPYC 7443P", price: 24900000, cpu: "۲۴ هسته / ۴۸ رشته", ram: "۲۵۶ گیگ ECC", disk: "۴×۳٫۸۴ ترابایت NVMe", traffic: "نامحدود", port: "۱۰ گیگابیت", ipv4: "۱۶ عدد", snap: "ندارد", backup: "اختیاری" },
  ],
};
/** Numeric resources for each cloud plan (cpu, ram GB, disk GB) — used by resize. */
export const PLAN_NUMS: Record<string, [number, number, number]> = Object.fromEntries(Object.entries(CLOUD_SPECS).map(([k, r]) => [k, [r.cpu, r.ram, r.disk]]));

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
export const TB_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50];
export const WIN_LICENSE = 150000;

/** ips = extra IPv4s on top of the one every server has; tb defaults to 1 for carts saved before traffic was a choice */
export type Config = { cpu: number; ram: number; disk: number; tb?: number; loc: string; os: string; ips: number; backup: boolean };
export function configLines(c: Config): PriceLine[] {
  const lines = cloudLines({ cpu: c.cpu, ram: c.ram, disk: c.disk, tb: c.tb ?? 1, ips: 1 + c.ips });
  const sub = lines.reduce((s, l) => s + l.amount, 0);
  const extra: PriceLine[] = [];
  if (LOCS.find((l) => l.id === c.loc)?.foreign) extra.push({ key: "extra", label: "دیتاسنتر خارج (۱۲٪)", amount: roundK(sub * 0.12) });
  if (c.os === "win") extra.push({ key: "extra", label: "لایسنس ویندوز", amount: WIN_LICENSE });
  const before = sub + extra.reduce((s, l) => s + l.amount, 0);
  if (c.backup) extra.push({ key: "extra", label: "بکاپ روزانه (۱۲٪)", amount: roundK(before * 0.12) });
  return [...lines, ...extra];
}
export const configPrice = (c: Config) => configLines(c).reduce((s, l) => s + l.amount, 0);

export const PRESETS = [
  { id: "p1", name: "سبک", cpu: 2, ram: 4, disk: 80, tb: 2, use: "وب‌سایت شرکتی" },
  { id: "p2", name: "متعادل", cpu: 4, ram: 8, disk: 160, tb: 4, use: "فروشگاه اینترنتی" },
  { id: "p3", name: "قدرتمند", cpu: 8, ram: 16, disk: 320, tb: 10, use: "اپلیکیشن و دیتابیس" },
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

/* ---------- orderable items ----------
   The cart stores a SKU; the browser shows a price computed from it, and the server re-prices the
   same SKU from the database catalog at checkout. A client-supplied amount is never trusted. */
export type Sku =
  | { t: "plan"; kind: "cloud" | "metal"; plan: string; loc: string; cycle: "m" | "q" | "y"; os?: string; app?: string; hourly?: boolean }
  | { t: "custom"; cpu: number; ram: number; disk: number; tb?: number; loc: string; os: string; ips: number; backup: boolean; app?: string; hourly?: boolean }
  | { t: "hosting"; plan: string; yearly: boolean; domain?: string }
  | { t: "domain"; name: string; years: number }
  | { t: "ip"; serverId: string; serverName: string };

export type PricedItem = { title: string; meta: string; base: number; icon: string; ltr?: boolean };
export type CatalogView = { plans: Record<"cloud" | "metal" | "hosting", Plan[]>; tlds: Tld[] };
export const IP_PRICE = UNIT.ip;
export const MAX_DOMAIN_YEARS = 10;
export const APPS = [
  { id: "", label: "بدون اپلیکیشن" }, { id: "docker", label: "Docker" }, { id: "wordpress", label: "WordPress" },
  { id: "n8n", label: "n8n" }, { id: "nextcloud", label: "Nextcloud" }, { id: "gitlab", label: "GitLab CE" }, { id: "outline-vpn", label: "Outline VPN" },
  { id: "portainer", label: "Portainer" }, { id: "uptime-kuma", label: "Uptime Kuma" }, { id: "wg-easy", label: "WireGuard (wg-easy)" }, { id: "minio", label: "MinIO (S3)" }, { id: "coolify", label: "Coolify" },
];

const locOf = (id: string) => LOCS.find((l) => l.id === id);
/** price for one SKU, or an error message when the SKU is not orderable */
export function priceSku(sku: Sku, cat: CatalogView): PricedItem | { error: string } {
  switch (sku.t) {
    case "plan": {
      const p = cat.plans[sku.kind]?.find((x) => x.id === sku.plan);
      const l = locOf(sku.loc), b = BILLING.find((x) => x.id === sku.cycle);
      if (!p || p.active === false) return { error: "این پلن فعلا ارائه نمی‌شود." };
      if (!l || (sku.kind === "metal" && !l.metal)) return { error: "این موقعیت برای پلن انتخابی در دسترس نیست." };
      if (!b) return { error: "دوره پرداخت نامعتبر است." };
      if (sku.hourly && (sku.kind !== "cloud" || sku.cycle !== "m")) return { error: "پرداخت ساعتی فقط برای سرور ابری ماهانه است." };
      if (sku.app && !APPS.some((a) => a.id === sku.app)) return { error: "اپلیکیشن نامعتبر است." };
      const monthly = roundK(p.price * (l.foreign && sku.kind === "cloud" ? 1.12 : 1) * (1 - b.disc));
      return { title: (sku.kind === "cloud" ? "سرور ابری " : "سرور اختصاصی ") + p.name, meta: l.label + "، " + (sku.hourly ? "پرداخت ساعتی (پیش‌پرداخت یک ماه)" : "پرداخت " + b.label) + (sku.app ? "، " + APPS.find((a) => a.id === sku.app)!.label : ""), base: monthly * b.months, icon: "server" };
    }
    case "custom": {
      const l = locOf(sku.loc);
      if (!CPU_STEPS.includes(sku.cpu) || !RAM_STEPS.includes(sku.ram) || !DISK_STEPS.includes(sku.disk) || (sku.tb !== undefined && !TB_STEPS.includes(sku.tb))) return { error: "منابع انتخابی نامعتبر است." };
      if (!l || !OSES.some((o) => o.id === sku.os) || !Number.isInteger(sku.ips) || sku.ips < 0 || sku.ips > 8) return { error: "پیکربندی نامعتبر است." };
      if (sku.app && !APPS.some((a) => a.id === sku.app)) return { error: "اپلیکیشن نامعتبر است." };
      return { title: "سرور ابری سفارشی", meta: sku.cpu + " هسته، " + sku.ram + " گیگ رم، " + sku.disk + " گیگ NVMe، " + (sku.tb ?? 1) + " ترابایت ترافیک، " + l.label + (sku.ips ? "، " + sku.ips + " آی‌پی اضافه" : "") + (sku.backup ? "، بکاپ روزانه" : "") + (sku.hourly ? "، پرداخت ساعتی" : ""), base: configPrice(sku), icon: "server" };
    }
    case "hosting": {
      const p = cat.plans.hosting.find((x) => x.id === sku.plan);
      if (!p || p.active === false) return { error: "این پلن هاست فعلا ارائه نمی‌شود." };
      const linux = HOSTING.linux.some((x) => x.id === p.id);
      return { title: "هاست " + p.name, meta: (linux ? "لینوکس" : "وردپرس") + "، پرداخت " + (sku.yearly ? "سالانه" : "ماهانه") + (sku.domain ? "، " + sku.domain : ""), base: sku.yearly ? roundK(p.price * 0.85) * 12 : p.price, icon: "layers" };
    }
    case "domain": {
      const parsed = parseDomain(sku.name);
      if ("error" in parsed && parsed.error) return { error: parsed.error };
      const { name, tld } = parsed as { name: string; tld: string | null };
      const t = tld && cat.tlds.find((x) => x.tld === tld);
      if (!t) return { error: "پسوند دامنه پشتیبانی نمی‌شود." };
      if (!Number.isInteger(sku.years) || sku.years < 1 || sku.years > MAX_DOMAIN_YEARS) return { error: "مدت ثبت باید ۱ تا ۱۰ سال باشد." };
      return { title: name + t.tld, meta: "ثبت " + (sku.years === 1 ? "یک‌ساله" : sku.years + " ساله"), base: t.reg + t.renew * (sku.years - 1), icon: "globe", ltr: true };
    }
    case "ip":
      return { title: "IPv4 اضافه برای " + sku.serverName, meta: "ماهانه", base: IP_PRICE, icon: "hash" };
  }
}
