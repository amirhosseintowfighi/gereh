/* «راه‌اندازی کسب‌وکار»: packages for small businesses, sold as an outcome ("your shop online in a week"), not as
   resources. Each one is a done-for-you service: the customer asks, sales calls, then the project and its
   invoices run through the DevOps pipeline (/admin/devops). Prices are in Toman, excluding VAT. Staff edit the
   packages (prices, contents, order, visibility) in /admin/products › «بسته‌های کسب‌وکار» (kv "business");
   BIZ_DEFAULTS below is only the first set, used until staff save their own. No CPU, RAM or disk words. */

export type BizGoal = "shop" | "site" | "menu" | "dev";
export type BizPackage = {
  /** stable: leads refer to it; a package is hidden (active: false), never renamed or deleted */
  id: string;
  name: string;
  /** who it is for, in the customer's words */
  for: string;
  /** one-time setup fee; 0 with `quote` = priced after a call */
  setup: number;
  /** monthly fee after launch (hosting, domain, support, small changes) */
  monthly: number;
  quote?: boolean;
  /** days from the first call to going live */
  days: string;
  includes: string[];
  popular?: boolean;
  /** shown on the site and offered in the form */
  active: boolean;
};

export const BIZ_DEFAULTS: BizPackage[] = [
  {
    id: "biz-start", active: true, name: "شروع", for: "مغازه، مطب، دفتر و هر کسب‌وکاری که می‌خواهد در اینترنت دیده شود",
    setup: 4_900_000, monthly: 490_000, days: "۳ تا ۵ روز",
    includes: [
      "سایت معرفی آماده با طراحی اختصاصی",
      "دامنه به نام شما (یک سال رایگان)",
      "ایمیل با نام کسب‌وکار (مثلا info@shoma.ir)",
      "نقشه، شماره تماس و دکمه واتس‌اپ و اینستاگرام",
      "قفل امنیتی سایت (SSL) و پشتیبان‌گیری روزانه",
      "ماهی یک بار تغییر متن و عکس توسط ما",
    ],
  },
  {
    id: "biz-shop", active: true, name: "فروشگاه", for: "کسی که می‌خواهد آنلاین بفروشد و پول را مستقیم بگیرد",
    setup: 14_900_000, monthly: 990_000, days: "۱ تا ۲ هفته", popular: true,
    includes: [
      "همه چیزهای بسته «شروع»",
      "فروشگاه آنلاین با سبد خرید و مدیریت سفارش",
      "اتصال درگاه پرداخت بانکی",
      "کمک قدم‌به‌قدم برای گرفتن نماد اعتماد (اینماد)",
      "وارد کردن تا ۵۰ محصول اول توسط ما",
      "آموزش کوتاه کار با پنل فروشگاه",
    ],
  },
  {
    id: "biz-grow", active: true, name: "رشد", for: "فروشگاه یا سایتی که فروش دارد و می‌خواهد بیشتر دیده شود",
    setup: 29_000_000, monthly: 3_900_000, days: "۲ تا ۳ هفته",
    includes: [
      "همه چیزهای بسته «فروشگاه»",
      "بهینه‌سازی برای گوگل (سئو) و ثبت در ترب و گوگل‌مپ",
      "گزارش ماهانه بازدید و فروش به زبان ساده",
      "تا ۸ ساعت تغییر و طراحی در ماه",
      "پشتیبان‌گیری در شهر دیگر و بازگردانی سریع",
      "پشتیبانی تلفنی در ساعت کاری",
    ],
  },
  {
    id: "biz-enterprise", active: true, name: "سازمانی", for: "محصول بزرگ، اپلیکیشن یا سرویسی با کاربران زیاد",
    setup: 0, monthly: 0, quote: true, days: "بعد از جلسه آشنایی",
    includes: [
      "طراحی و ساخت محصول با معماری مقیاس‌پذیر",
      "زیرساخت ابری با مقیاس خودکار و بدون قطعی",
      "تیم دواپس و پشتیبانی شبانه‌روزی با تعهد زمانی (SLA)",
      "امنیت، پایش و پشتیبان‌گیری حرفه‌ای",
      "قرارداد و جلسه‌های منظم با مدیر پروژه",
    ],
  },
];

export const BIZ_GOALS: { id: BizGoal; icon: string; title: string; text: string; pkg?: string }[] = [
  { id: "shop", icon: "shopping-bag", title: "فروشگاه آنلاین", text: "محصولاتم را در اینترنت بفروشم و پول را مستقیم بگیرم", pkg: "biz-shop" },
  { id: "site", icon: "store", title: "سایت کسب‌وکار", text: "مشتری‌ها مرا در گوگل پیدا کنند، آدرس و تلفنم را ببینند", pkg: "biz-start" },
  { id: "menu", icon: "calendar-check", title: "منوی دیجیتال یا نوبت‌دهی", text: "برای کافه، رستوران، آرایشگاه یا مطب", pkg: "biz-start" },
  { id: "dev", icon: "code-xml", title: "من برنامه‌نویسم", text: "سرور، هاست، دامنه و ابزارهای فنی را خودم مدیریت می‌کنم" },
];

/** the three steps every package follows, shown on /business and the home page */
export const BIZ_STEPS: [string, string, string][] = [
  ["phone-call", "یک تماس کوتاه", "درخواست می‌دهید، همان روز تماس می‌گیریم و نیازتان را می‌پرسیم. رایگان است و تعهدی ندارد."],
  ["hammer", "ما می‌سازیم", "طراحی، ساخت، دامنه، ایمیل و درگاه را ما انجام می‌دهیم. شما فقط عکس و متن را می‌فرستید."],
  ["rocket", "کسب‌وکارتان آنلاین است", "سایت را تحویل می‌گیرید و ما هر ماه نگهش می‌داریم؛ هر وقت سؤالی داشتید، یک نفر جواب می‌دهد."],
];

export const BIZ_FAQ: [string, string][] = [
  ["من هیچ چیز فنی بلد نیستم؛ مشکلی نیست؟", "نه. همه کارهای فنی با ماست. شما فقط عکس محصولات، متن معرفی و اطلاعات تماس را می‌فرستید."],
  ["هزینه ماهانه برای چیست؟", "نگهداری سایت روی سرورهای گره، تمدید دامنه، ایمیل، پشتیبان‌گیری روزانه، به‌روزرسانی‌های امنیتی و تغییرهای کوچک ماهانه. هزینه پنهان دیگری ندارد."],
  ["اگر بخواهم بسته را عوض کنم یا لغو کنم؟", "هر ماه می‌توانید بسته را بالا یا پایین ببرید. اگر لغو کنید، دامنه مال شماست و یک نسخه کامل از سایت تحویلتان می‌دهیم."],
  ["درگاه پرداخت و اینماد را هم شما می‌گیرید؟", "درخواست آن‌ها باید به نام خود شما ثبت شود، اما در بسته «فروشگاه» قدم‌به‌قدم کمک می‌کنیم و فرم‌ها را با هم پر می‌کنیم."],
  ["قیمت‌ها مالیات دارد؟", "قیمت‌ها بدون مالیات بر ارزش افزوده است؛ مالیات طبق قانون روی فاکتور اضافه می‌شود."],
];

export const bizPackage = (list: BizPackage[], id: string) => list.find((p) => p.id === id);
/** the packages the site shows, in the order staff set */
export const bizVisible = (list: BizPackage[]) => list.filter((p) => p.active);
/** the package a goal points to; the first visible one when that package is hidden */
export const bizForGoal = (list: BizPackage[], goal: string) => {
  const want = BIZ_GOALS.find((g) => g.id === goal)?.pkg;
  const vis = bizVisible(list);
  return vis.find((p) => p.id === want) ?? vis.find((p) => p.popular) ?? vis[0];
};
/** the cheapest monthly fee among the visible packages that have a list price (0 when none) */
export const bizFromMonthly = (list: BizPackage[]) => {
  const m = bizVisible(list).filter((p) => !p.quote && p.monthly > 0).map((p) => p.monthly);
  return m.length ? Math.min(...m) : 0;
};
/** label for a lead's package in the sales pipeline ("" when it is not a business package) */
export const bizPackageLabel = (list: BizPackage[], id: string) => { const p = bizPackage(list, id); return p ? "بسته کسب‌وکار «" + p.name + "»" : ""; };
