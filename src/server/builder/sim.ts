/* The builder without an upstream model (no AI_UPSTREAM_KEY: tests, offline demos): deterministic,
   good-looking Persian projects chosen from the prompt's keywords, keyword-driven edits, fixes for the
   common build failures and a maintenance diagnosis. The answer uses the same tagged format as a real
   model, so it goes through the same parser, validation and billing. */
import "server-only";
import type { BuilderStack } from "@/lib/builder";
import { CDN } from "./assets";
import { render } from "./format";
import type { TaskInput } from "./prompt";

type Item = { icon: string; name: string; desc: string; price?: number; meta?: string };
type Field = { name: string; label: string; type: "text" | "tel" | "email" | "date" | "select" | "textarea" | "number"; options?: string[]; required?: boolean };
type Kind = {
  key: "salon" | "shop" | "restaurant" | "event" | "business"; brand: string; emoji: string; palette: string; title: string; hero: string; sub: string;
  stats: [string, string][]; itemsTitle: string; itemsSub: string; items: Item[]; itemCta: string;
  features: [string, string, string][]; formTitle: string; formSub: string; fields: Field[]; submit: string; success: string;
  testimonials: [string, string, string][]; address: string; phone: string; hours: string; endpoint: string; nav: [string, string][];
};

export const PALETTES: Record<string, string[]> = {
  rose: ["#fff1f2", "#ffe4e6", "#fecdd3", "#fda4af", "#fb7185", "#f43f5e", "#e11d48", "#be123c", "#9f1239", "#881337"],
  indigo: ["#eef2ff", "#e0e7ff", "#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#312e81"],
  amber: ["#fffbeb", "#fef3c7", "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706", "#b45309", "#92400e", "#78350f"],
  violet: ["#f5f3ff", "#ede9fe", "#ddd6fe", "#c4b5fd", "#a78bfa", "#8b5cf6", "#7c3aed", "#6d28d9", "#5b21b6", "#4c1d95"],
  emerald: ["#ecfdf5", "#d1fae5", "#a7f3d0", "#6ee7b7", "#34d399", "#10b981", "#059669", "#047857", "#065f46", "#064e3b"],
  blue: ["#eff6ff", "#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a"],
  orange: ["#fff7ed", "#ffedd5", "#fed7aa", "#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c", "#9a3412", "#7c2d12"],
  pink: ["#fdf2f8", "#fce7f3", "#fbcfe8", "#f9a8d4", "#f472b6", "#ec4899", "#db2777", "#be185d", "#9d174d", "#831843"],
  teal: ["#f0fdfa", "#ccfbf1", "#99f6e4", "#5eead4", "#2dd4bf", "#14b8a6", "#0d9488", "#0f766e", "#115e59", "#134e4a"],
};
const COLOR_WORDS: [RegExp, string, string][] = [
  [/سرمه[‌ ]?ای/, "indigo", "سرمه‌ای"], [/فیروزه[‌ ]?ای/, "teal", "فیروزه‌ای"], [/آبی/, "blue", "آبی"], [/سبز/, "emerald", "سبز"], [/بنفش|یاسی/, "violet", "بنفش"],
  [/قرمز|زرشکی/, "rose", "قرمز"], [/صورتی/, "pink", "صورتی"], [/نارنجی/, "orange", "نارنجی"], [/طلایی|زرد/, "amber", "طلایی"],
];

const fa = (n: number) => n.toLocaleString("fa-IR");
const toman = (n: number) => fa(n) + " تومان";
const TIMES = ["۱۰:۰۰", "۱۱:۰۰", "۱۲:۰۰", "۱۴:۰۰", "۱۵:۰۰", "۱۶:۰۰", "۱۷:۰۰", "۱۸:۰۰", "۱۹:۰۰"];

function kindOf(prompt: string): Kind["key"] {
  if (/نوبت|آرایش|سالن|زیبایی|باربر|ناخن|مژه/.test(prompt)) return "salon";
  if (/فروشگاه|لباس|پوشاک|محصول|خرید|کفش|shop|store/i.test(prompt)) return "shop";
  if (/رستوران|کافه|منو|غذا|کافی[‌ ]?شاپ|فست[‌ ]?فود/.test(prompt)) return "restaurant";
  if (/رویداد|همایش|کنفرانس|ورکشاپ|کارگاه|سمینار|ثبت[‌ ]?نام/.test(prompt)) return "event";
  return "business";
}

function kind(prompt: string): Kind {
  const key = kindOf(prompt);
  const common = { address: "تهران، خیابان ولیعصر، بالاتر از پارک ساعی، پلاک ۱۲۴۰", phone: "۰۲۱-۸۸۷۷۶۶۵۵", hours: "شنبه تا پنجشنبه، ۱۰ صبح تا ۸ شب" };
  const nameF: Field = { name: "name", label: "نام و نام خانوادگی", type: "text", required: true };
  const phoneF: Field = { name: "phone", label: "شماره موبایل", type: "tel", required: true };
  switch (key) {
    case "salon": {
      const items: Item[] = [
        { icon: "✂️", name: "کوتاهی و براشینگ", desc: "مشاوره فرم صورت، کوتاهی مدرن و براشینگ حرفه‌ای", price: 450_000, meta: "۶۰ دقیقه" },
        { icon: "🎨", name: "رنگ و هایلایت", desc: "رنگ‌های اورجینال ایتالیایی با تست حساسیت رایگان", price: 1_800_000, meta: "۱۸۰ دقیقه" },
        { icon: "💆‍♀️", name: "کراتینه و احیای مو", desc: "صاف و براق تا شش ماه، مناسب موهای آسیب‌دیده", price: 2_500_000, meta: "۱۵۰ دقیقه" },
        { icon: "💄", name: "میکاپ و شینیون", desc: "گریم مجلسی و عروس با محصولات ضدحساسیت", price: 3_200_000, meta: "۱۲۰ دقیقه" },
        { icon: "💅", name: "کاشت و ترمیم ناخن", desc: "ژلیش، کاشت و طراحی ناخن با ابزار استریل", price: 650_000, meta: "۹۰ دقیقه" },
        { icon: "🌸", name: "اصلاح ابرو و صورت", desc: "فرم‌دهی ابرو و پاکسازی پوست", price: 250_000, meta: "۳۰ دقیقه" },
      ];
      return { ...common, key, brand: "سالن زیبایی رز", emoji: "💇‍♀️", palette: "rose", title: "سالن زیبایی رز | نوبت‌دهی آنلاین",
        hero: "زیبایی شما، در زمانی که خودتان انتخاب می‌کنید", sub: "نوبت سالن را در کمتر از یک دقیقه آنلاین رزرو کنید؛ بدون تماس و انتظار. متخصصان باتجربه، محیط بهداشتی و قیمت‌های شفاف.",
        stats: [["۱۲+", "سال تجربه"], ["۸٬۵۰۰+", "مشتری راضی"], ["۴٫۹", "امتیاز مشتریان"]], itemsTitle: "خدمات و قیمت‌ها", itemsSub: "قیمت‌ها نهایی است و هزینه پنهانی ندارد.", items, itemCta: "رزرو همین خدمت",
        features: [["🧴", "مواد اورجینال", "فقط برندهای معتبر با تاریخ مصرف مشخص"], ["🧼", "بهداشت کامل", "ابزار استریل و یک‌بار مصرف برای هر مشتری"], ["⏰", "دقیق سر وقت", "با نوبت آنلاین، بدون معطلی در سالن"]],
        formTitle: "رزرو آنلاین نوبت", formSub: "خدمت و زمان دلخواه را انتخاب کنید؛ برای تأیید با شما تماس می‌گیریم.",
        fields: [nameF, phoneF, { name: "service", label: "خدمت", type: "select", options: items.map((i) => i.name), required: true }, { name: "date", label: "تاریخ", type: "date", required: true }, { name: "time", label: "ساعت", type: "select", options: TIMES, required: true }, { name: "note", label: "توضیحات (اختیاری)", type: "textarea" }],
        submit: "ثبت نوبت", success: "نوبت شما ثبت شد! به‌زودی برای تأیید با شما تماس می‌گیریم.",
        testimonials: [["مریم احمدی", "رنگ مو دقیقاً همان چیزی شد که می‌خواستم. نوبت‌دهی آنلاین هم خیلی راحت بود.", "⭐⭐⭐⭐⭐"], ["سارا کریمی", "محیط تمیز و آرام، پرسنل مهربان. برای عروسی خواهرم هم اینجا را انتخاب کردیم.", "⭐⭐⭐⭐⭐"], ["نگار رضایی", "کاشت ناخن عالی بود و سر ساعت کارم شروع شد.", "⭐⭐⭐⭐"]],
        endpoint: "bookings", nav: [["#services", "خدمات"], ["#why", "چرا ما"], ["#book", "رزرو نوبت"], ["#reviews", "نظرات"], ["#contact", "تماس"]] };
    }
    case "shop": {
      const items: Item[] = [
        { icon: "👗", name: "مانتو کتان تابستانه", desc: "کتان خنک، دوخت تمیز، سایز ۳۸ تا ۴۶", price: 1_890_000 },
        { icon: "👕", name: "تیشرت نخی ساده", desc: "پنبه ۱۰۰٪، در شش رنگ", price: 590_000 },
        { icon: "👖", name: "شلوار جین راسته", desc: "جین ترک با کش‌سانی ملایم", price: 1_350_000 },
        { icon: "🧥", name: "کت پاییزه", desc: "پارچه فوتر، آستر ساتن", price: 3_200_000 },
        { icon: "👟", name: "کفش اسنیکر سفید", desc: "رویه چرم، زیره طبی", price: 2_450_000 },
        { icon: "🧣", name: "شال نخی طرح‌دار", desc: "سبک و نرم، مناسب چهار فصل", price: 420_000 },
      ];
      return { ...common, key, brand: "پوشاک نیلا", emoji: "🛍️", palette: "indigo", title: "پوشاک نیلا | فروشگاه آنلاین لباس",
        hero: "استایل روزمره، با کیفیتی که حس می‌کنید", sub: "لباس‌های راحت و باکیفیت با قیمت منصفانه؛ ارسال سریع به سراسر ایران و ضمانت بازگشت هفت‌روزه.",
        stats: [["۲۴ ساعته", "ارسال تهران"], ["۷ روز", "ضمانت بازگشت"], ["۱۲٬۰۰۰+", "سفارش موفق"]], itemsTitle: "محصولات پرفروش", itemsSub: "موجودی محدود است؛ به سبد اضافه کنید و سفارش را ثبت کنید.", items, itemCta: "افزودن به سبد",
        features: [["🚚", "ارسال رایگان", "برای خریدهای بالای ۲ میلیون تومان"], ["↩️", "بازگشت آسان", "تا هفت روز بدون پرسش"], ["🔒", "پرداخت امن", "درگاه بانکی معتبر و پرداخت در محل"]],
        formTitle: "ثبت سفارش", formSub: "مشخصات گیرنده را وارد کنید؛ پیش از ارسال تماس می‌گیریم.",
        fields: [nameF, phoneF, { name: "address", label: "نشانی کامل", type: "textarea", required: true }],
        submit: "ثبت سفارش", success: "سفارش شما ثبت شد! همکاران ما برای هماهنگی ارسال تماس می‌گیرند.",
        testimonials: [["الهام نوری", "کیفیت پارچه از عکس‌ها هم بهتر بود و دو روزه رسید.", "⭐⭐⭐⭐⭐"], ["حمید رستمی", "سایز را اشتباه گرفته بودم، خیلی راحت تعویض کردند.", "⭐⭐⭐⭐⭐"], ["زهرا موسوی", "قیمت‌ها منصفانه است و بسته‌بندی شیک.", "⭐⭐⭐⭐"]],
        endpoint: "orders", nav: [["#services", "محصولات"], ["#why", "چرا نیلا"], ["#book", "سبد خرید"], ["#reviews", "نظرات"], ["#contact", "تماس"]] };
    }
    case "restaurant": {
      const items: Item[] = [
        { icon: "🍢", name: "چلوکباب کوبیده", desc: "دو سیخ کوبیده مخلوط، برنج ایرانی و گوجه کبابی", price: 420_000 },
        { icon: "🍗", name: "جوجه‌کباب زعفرانی", desc: "سینه مرغ در مزه زعفران و لیمو", price: 380_000 },
        { icon: "🍲", name: "قورمه‌سبزی", desc: "سبزی تازه، لوبیا قرمز و گوشت گوساله", price: 290_000 },
        { icon: "🍛", name: "زرشک‌پلو با مرغ", desc: "ران مرغ مجلسی با زرشک و پسته", price: 340_000 },
        { icon: "🍆", name: "میرزاقاسمی", desc: "پیش‌غذای گیلانی با بادمجان دودی", price: 180_000 },
        { icon: "🍧", name: "فالوده شیرازی", desc: "با آبلیمو تازه و آلبالو", price: 120_000 },
      ];
      return { ...common, key, brand: "رستوران سفره", emoji: "🍽️", palette: "amber", title: "رستوران سفره | طعم اصیل ایرانی", hours: "همه روزه، ۱۲ ظهر تا ۱۱ شب",
        hero: "طعم اصیل ایرانی، هر روز تازه", sub: "غذاهای سنتی با دستور خانگی، مواد تازه روز و فضایی گرم برای دورهمی‌های خانوادگی. میز خود را آنلاین رزرو کنید.",
        stats: [["۲۵+", "غذای ایرانی"], ["۱۸ سال", "سابقه"], ["۴٫۸", "امتیاز مهمانان"]], itemsTitle: "منوی امروز", itemsSub: "همه غذاها با برنج ایرانی درجه یک سرو می‌شود.", items, itemCta: "رزرو میز",
        features: [["🥬", "مواد تازه روز", "خرید روزانه از بازار"], ["👨‍🍳", "سرآشپز باتجربه", "دستورهای اصیل خانگی"], ["🚗", "پارکینگ اختصاصی", "برای مهمانان رستوران"]],
        formTitle: "رزرو میز", formSub: "تعداد مهمانان و زمان را انتخاب کنید.",
        fields: [nameF, phoneF, { name: "guests", label: "تعداد نفرات", type: "select", options: ["۱", "۲", "۳", "۴", "۵", "۶", "۸", "۱۰"], required: true }, { name: "date", label: "تاریخ", type: "date", required: true }, { name: "time", label: "ساعت", type: "select", options: ["۱۲:۳۰", "۱۳:۳۰", "۱۴:۳۰", "۱۹:۰۰", "۲۰:۰۰", "۲۱:۰۰", "۲۲:۰۰"], required: true }],
        submit: "رزرو میز", success: "میز شما رزرو شد! منتظر دیدارتان هستیم.",
        testimonials: [["علی محمدی", "کوبیده‌اش بهترین کوبیده‌ای بود که در تهران خوردم.", "⭐⭐⭐⭐⭐"], ["فاطمه حسینی", "برای تولد مادرم رزرو کردیم؛ پذیرایی عالی بود.", "⭐⭐⭐⭐⭐"], ["رضا قاسمی", "قورمه‌سبزی دقیقاً طعم غذای خانه را می‌داد.", "⭐⭐⭐⭐"]],
        endpoint: "reservations", nav: [["#services", "منو"], ["#why", "چرا سفره"], ["#book", "رزرو میز"], ["#reviews", "نظرات"], ["#contact", "تماس"]] };
    }
    case "event": {
      const items: Item[] = [
        { icon: "🎤", name: "افتتاحیه: آینده هوش مصنوعی در ایران", desc: "دکتر سارا شریفی، پژوهشگر یادگیری ماشین", meta: "۹:۰۰ تا ۹:۴۵" },
        { icon: "☁️", name: "زیرساخت ابری برای استارتاپ‌ها", desc: "مهندس کاوه نوری، معمار سامانه‌های ابری", meta: "۱۰:۰۰ تا ۱۰:۴۵" },
        { icon: "🛒", name: "رشد فروشگاه‌های آنلاین", desc: "نیلوفر احمدی، مدیر محصول", meta: "۱۱:۰۰ تا ۱۱:۴۵" },
        { icon: "🔐", name: "امنیت داده‌های کاربران", desc: "دکتر امید رحیمی، کارشناس امنیت", meta: "۱۳:۳۰ تا ۱۴:۱۵" },
        { icon: "💡", name: "پنل: از ایده تا محصول", desc: "گفت‌وگو با بنیان‌گذاران سه استارتاپ موفق", meta: "۱۴:۳۰ تا ۱۵:۳۰" },
        { icon: "🤝", name: "شبکه‌سازی و پذیرایی", desc: "آشنایی با سخنران‌ها و شرکت‌کنندگان", meta: "۱۵:۳۰ تا ۱۷:۰۰" },
      ];
      return { ...common, key, brand: "همایش فناوری تهران", emoji: "🎟️", palette: "violet", title: "همایش فناوری تهران ۱۴۰۵ | ثبت‌نام", hours: "پنجشنبه ۲۰ آذر ۱۴۰۵، ساعت ۹ تا ۱۷",
        address: "تهران، مرکز همایش‌های برج میلاد، سالن خلیج فارس",
        hero: "یک روز، شش جلسه، صدها ایده تازه", sub: "بزرگ‌ترین گردهمایی سالانه فعالان فناوری؛ از هوش مصنوعی تا زیرساخت ابری. ظرفیت محدود است، همین حالا ثبت‌نام کنید.",
        stats: [["۸۰۰", "شرکت‌کننده"], ["۱۲", "سخنران"], ["۶", "جلسه تخصصی"]], itemsTitle: "برنامه همایش", itemsSub: "پنجشنبه ۲۰ آذر ۱۴۰۵ — مرکز همایش‌های برج میلاد", items, itemCta: "ثبت‌نام",
        features: [["🎓", "گواهی حضور", "برای همه شرکت‌کنندگان"], ["🍱", "پذیرایی کامل", "ناهار و میان‌وعده"], ["📹", "ویدیوی جلسات", "دسترسی یک‌ساله پس از همایش"]],
        formTitle: "ثبت‌نام در همایش", formSub: "پس از ثبت‌نام، بلیت و جزئیات به ایمیل شما ارسال می‌شود.",
        fields: [nameF, { name: "email", label: "ایمیل", type: "email", required: true }, phoneF, { name: "ticket", label: "نوع بلیت", type: "select", options: ["عادی — ۸۵۰٬۰۰۰ تومان", "دانشجویی — ۴۵۰٬۰۰۰ تومان", "ویژه (VIP) — ۲٬۵۰۰٬۰۰۰ تومان"], required: true }],
        submit: "ثبت‌نام", success: "ثبت‌نام شما انجام شد! بلیت به ایمیلتان ارسال می‌شود.",
        testimonials: [["محسن کاظمی", "پارسال شرکت کردم و دو همکار خوب برای تیمم پیدا کردم.", "⭐⭐⭐⭐⭐"], ["لیلا صادقی", "جلسات کاربردی و دقیق سر وقت بود.", "⭐⭐⭐⭐⭐"], ["پویا عباسی", "بهترین رویداد فناوری سال برای من.", "⭐⭐⭐⭐"]],
        endpoint: "registrations", nav: [["#services", "برنامه"], ["#why", "مزایا"], ["#book", "ثبت‌نام"], ["#reviews", "نظرات"], ["#contact", "محل برگزاری"]] };
    }
    default: {
      const words = prompt.replace(/[^\p{L}\p{N}\s‌]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(یک|برای|سایت|صفحه|اپ|که|با|و|را|های|می)$/.test(w));
      const topic = words.slice(0, 3).join(" ") || "کسب‌وکار شما";
      return { ...common, key, brand: "استودیو " + (words[0] ?? "نو"), emoji: "✨", palette: "emerald", title: topic + " | معرفی و تماس",
        hero: topic + "، ساده و حرفه‌ای", sub: "هر آنچه مشتریان باید بدانند در یک صفحه: خدمات، مزیت‌ها و راه تماس. درخواست خود را ثبت کنید تا با شما تماس بگیریم.",
        stats: [["۱۰+", "سال تجربه"], ["۳۰۰+", "پروژه موفق"], ["۲۴/۷", "پشتیبانی"]], itemsTitle: "خدمات ما", itemsSub: "راهکار مناسب نیاز شما", itemCta: "درخواست مشاوره",
        items: [
          { icon: "💬", name: "مشاوره رایگان", desc: "بررسی نیاز شما و پیشنهاد بهترین مسیر" }, { icon: "🎯", name: "طراحی اختصاصی", desc: "متناسب با هدف و بودجه شما" },
          { icon: "⚡", name: "اجرای سریع", desc: "تحویل مرحله‌ای با گزارش پیشرفت" }, { icon: "🛟", name: "پشتیبانی", desc: "همراه شما پس از تحویل" },
          { icon: "📈", name: "گزارش و تحلیل", desc: "اندازه‌گیری نتیجه با عدد" }, { icon: "🤝", name: "قرارداد شفاف", desc: "بدون هزینه پنهان" },
        ],
        features: [["✅", "تضمین کیفیت", "تا رضایت کامل شما"], ["⏱️", "پاسخ سریع", "در کمتر از یک ساعت کاری"], ["💳", "پرداخت مرحله‌ای", "متناسب با پیشرفت کار"]],
        formTitle: "درخواست تماس", formSub: "پیام خود را بگذارید؛ در کمتر از یک روز کاری پاسخ می‌دهیم.",
        fields: [nameF, phoneF, { name: "message", label: "پیام شما", type: "textarea", required: true }], submit: "ارسال درخواست", success: "درخواست شما ثبت شد! به‌زودی با شما تماس می‌گیریم.",
        testimonials: [["نرگس یوسفی", "حرفه‌ای و دقیق؛ دقیقاً همان چیزی که لازم داشتیم.", "⭐⭐⭐⭐⭐"], ["امیر جعفری", "پاسخگویی سریع و قیمت منصفانه.", "⭐⭐⭐⭐⭐"], ["شیما تهرانی", "تجربه همکاری خیلی خوبی بود.", "⭐⭐⭐⭐"]],
        endpoint: "messages", nav: [["#services", "خدمات"], ["#why", "چرا ما"], ["#book", "تماس با ما"], ["#reviews", "نظرات"], ["#contact", "نشانی"]] };
    }
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paletteVars = (name: string) => (PALETTES[name] ?? PALETTES.emerald).map((c, i) => "--color-brand-" + (i ? i * 100 : 50) + ": " + c + ";").join(" ");

function field(f: Field) {
  const req = f.required ? " required" : "";
  const cls = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100 transition";
  const input = f.type === "select"
    ? `<select id="f-${f.name}" name="${f.name}" class="${cls}"${req}><option value="">انتخاب کنید</option>${(f.options ?? []).map((o) => `<option>${esc(o)}</option>`).join("")}</select>`
    : f.type === "textarea" ? `<textarea id="f-${f.name}" name="${f.name}" rows="3" maxlength="1000" class="${cls}"${req}></textarea>`
    : `<input id="f-${f.name}" name="${f.name}" type="${f.type}" maxlength="120" class="${cls}"${f.type === "tel" ? ' dir="ltr" inputmode="tel" pattern="0?9[0-9]{9}" placeholder="09121234567"' : f.type === "email" ? ' dir="ltr" placeholder="you@example.com"' : ""}${req}>`;
  return `<div class="${f.type === "textarea" ? "sm:col-span-2" : ""}"><label for="f-${f.name}" class="block text-sm font-bold text-slate-700 mb-2">${esc(f.label)}</label>${input}</div>`;
}

export function indexHtml(k: Kind, stack: BuilderStack) {
  const asset = (p: string) => (stack === "node" ? p : "assets/" + p);
  const shop = k.key === "shop";
  const card = (it: Item, i: number) => `
        <article class="group rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-100">
          <div class="flex items-start justify-between gap-4">
            <span class="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-3xl transition group-hover:scale-110" aria-hidden="true">${it.icon}</span>
            ${it.meta ? `<span class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">${esc(it.meta)}</span>` : ""}
          </div>
          <h3 class="mt-5 text-lg font-extrabold text-slate-900">${esc(it.name)}</h3>
          <p class="mt-2 text-sm leading-7 text-slate-600">${esc(it.desc)}</p>
          <div class="mt-5 flex items-center justify-between gap-3">
            ${it.price ? `<span class="text-lg font-black text-brand-700">${toman(it.price)}</span>` : "<span></span>"}
            <button type="button" class="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-200" ${shop ? `data-add="${i}"` : `data-pick="${esc(it.name)}"`}>${k.itemCta}</button>
          </div>
        </article>`;
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(k.title)}</title>
  <meta name="description" content="${esc(k.sub)}">
  <link rel="stylesheet" href="${CDN.font}">
  <script src="${CDN.tailwind}"></script>
  <style type="text/tailwindcss">
    @theme {
      --font-sans: Vazirmatn, Tahoma, sans-serif;
      /*brand*/${paletteVars(k.palette)}/*/brand*/
    }
  </style>
  <link rel="stylesheet" href="${asset("style.css")}">
</head>
<body class="bg-slate-50 font-sans text-slate-800 antialiased">
  <header class="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur">
    <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
      <a href="#top" class="flex items-center gap-2 text-lg font-black text-slate-900"><span class="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white" aria-hidden="true">${k.emoji}</span><span data-brand>${esc(k.brand)}</span></a>
      <nav class="hidden items-center gap-6 text-sm font-bold text-slate-600 md:flex" aria-label="منوی اصلی">
        ${k.nav.map(([h, l]) => `<a href="${h}" class="transition hover:text-brand-600">${l}</a>`).join("\n        ")}
      </nav>
      <div class="flex items-center gap-2">
        ${shop ? `<button type="button" id="cart-btn" class="relative rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200" aria-label="سبد خرید">🛒 <span id="cart-count" class="absolute -top-1.5 -left-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[11px] text-white">۰</span></button>` : `<a href="#book" class="hidden rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-brand-200 transition hover:bg-brand-700 sm:inline-block">${k.submit}</a>`}
        <button type="button" id="menu-btn" class="rounded-xl p-2 text-slate-700 hover:bg-slate-100 md:hidden" aria-expanded="false" aria-controls="mobile-menu" aria-label="منو">☰</button>
      </div>
    </div>
    <nav id="mobile-menu" class="hidden border-t border-slate-100 bg-white px-4 py-3 md:hidden" aria-label="منوی موبایل">
      ${k.nav.map(([h, l]) => `<a href="${h}" class="block rounded-lg px-3 py-2.5 font-bold text-slate-700 hover:bg-brand-50">${l}</a>`).join("\n      ")}
    </nav>
  </header>

  <main id="top">
    <section class="relative overflow-hidden bg-gradient-to-b from-brand-50 via-white to-slate-50">
      <div class="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-brand-200/50 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-brand-100 blur-3xl"></div>
      <div class="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:py-24 lg:grid-cols-2">
        <div>
          <span class="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-xs font-bold text-brand-700 shadow-sm ring-1 ring-brand-100">${k.emoji} ${esc(k.brand)}</span>
          <h1 class="mt-6 text-4xl font-black leading-[1.35] text-slate-900 sm:text-5xl">${esc(k.hero)}</h1>
          <p class="mt-6 max-w-xl text-lg leading-8 text-slate-600">${esc(k.sub)}</p>
          <div class="mt-8 flex flex-wrap gap-3">
            <a href="#book" class="rounded-2xl bg-brand-600 px-7 py-3.5 font-bold text-white shadow-xl shadow-brand-200 transition hover:-translate-y-0.5 hover:bg-brand-700">${k.submit}</a>
            <a href="#services" class="rounded-2xl bg-white px-7 py-3.5 font-bold text-slate-700 ring-1 ring-slate-200 transition hover:ring-brand-300">${k.itemsTitle}</a>
          </div>
          <dl class="mt-10 grid max-w-md grid-cols-3 gap-4">
            ${k.stats.map(([v, l]) => `<div><dt class="text-xs text-slate-500">${l}</dt><dd class="mt-1 text-2xl font-black text-slate-900">${v}</dd></div>`).join("\n            ")}
          </dl>
        </div>
        <div class="relative">
          <div class="rounded-[2rem] bg-white p-6 shadow-2xl shadow-brand-100 ring-1 ring-slate-100">
            <div class="grid aspect-[4/3] place-items-center rounded-3xl bg-gradient-to-br from-brand-400 to-brand-700 text-8xl" aria-hidden="true">${k.emoji}</div>
            <div class="mt-5 grid grid-cols-3 gap-3">
              ${k.items.slice(0, 3).map((it) => `<div class="rounded-2xl bg-brand-50 p-3 text-center"><div class="text-2xl" aria-hidden="true">${it.icon}</div><div class="mt-1 truncate text-xs font-bold text-slate-700">${esc(it.name)}</div></div>`).join("\n              ")}
            </div>
          </div>
          <div class="absolute -bottom-5 right-6 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-xl ring-1 ring-slate-100">⭐ ${k.stats[2][0]} — ${k.stats[2][1]}</div>
        </div>
      </div>
    </section>

    <section id="services" class="mx-auto max-w-6xl px-4 py-20">
      <div class="text-center">
        <h2 class="text-3xl font-black text-slate-900">${k.itemsTitle}</h2>
        <p class="mt-3 text-slate-600">${esc(k.itemsSub)}</p>
      </div>
      <div class="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">${k.items.map(card).join("")}
      </div>
    </section>

    <section id="why" class="bg-white py-20">
      <div class="mx-auto max-w-6xl px-4">
        <h2 class="text-center text-3xl font-black text-slate-900">چرا ${esc(k.brand)}؟</h2>
        <div class="mt-12 grid gap-6 md:grid-cols-3">
          ${k.features.map(([i, t, d]) => `<div class="rounded-3xl bg-slate-50 p-7 text-center ring-1 ring-slate-100"><div class="text-4xl" aria-hidden="true">${i}</div><h3 class="mt-4 text-lg font-extrabold">${t}</h3><p class="mt-2 text-sm leading-7 text-slate-600">${d}</p></div>`).join("\n          ")}
        </div>
      </div>
    </section>

    <section id="book" class="mx-auto max-w-6xl px-4 py-20">
      <div class="grid gap-10 rounded-[2rem] bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white shadow-2xl shadow-brand-200 sm:p-10 lg:grid-cols-[1fr_1.3fr]">
        <div>
          <h2 class="text-3xl font-black">${k.formTitle}</h2>
          <p class="mt-4 leading-8 text-brand-50">${esc(k.formSub)}</p>
          ${shop ? `<div id="cart-box" class="mt-6 rounded-2xl bg-white/10 p-4 text-sm"><p id="cart-empty">سبد خرید خالی است؛ از بخش محصولات انتخاب کنید.</p><ul id="cart-list" class="space-y-2"></ul><p id="cart-total" class="mt-3 hidden border-t border-white/20 pt-3 font-black"></p></div>` : `<ul class="mt-6 space-y-3 text-brand-50"><li>📍 ${esc(k.address)}</li><li>☎️ <span dir="ltr">${k.phone}</span></li><li>🕘 ${esc(k.hours)}</li></ul>`}
        </div>
        <form id="lead-form" class="grid gap-4 rounded-3xl bg-white p-6 text-slate-800 sm:grid-cols-2" novalidate>
          ${k.fields.map(field).join("\n          ")}
          <div class="sm:col-span-2">
            <button type="submit" class="w-full rounded-2xl bg-brand-600 py-3.5 font-black text-white transition hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:opacity-60">${k.submit}</button>
            <p id="form-msg" class="mt-3 hidden rounded-xl px-4 py-3 text-sm font-bold" role="status" aria-live="polite"></p>
          </div>
        </form>
      </div>
    </section>

    <section id="reviews" class="bg-white py-20">
      <div class="mx-auto max-w-6xl px-4">
        <h2 class="text-center text-3xl font-black text-slate-900">مشتریان چه می‌گویند</h2>
        <div class="mt-12 grid gap-6 md:grid-cols-3">
          ${k.testimonials.map(([n, t, s]) => `<figure class="rounded-3xl bg-slate-50 p-7 ring-1 ring-slate-100"><div aria-label="امتیاز">${s}</div><blockquote class="mt-4 leading-8 text-slate-700">«${esc(t)}»</blockquote><figcaption class="mt-4 text-sm font-bold text-slate-900">${esc(n)}</figcaption></figure>`).join("\n          ")}
        </div>
      </div>
    </section>
    <!-- sections:end -->
  </main>

  <footer id="contact" class="bg-slate-900 text-slate-300">
    <div class="mx-auto grid max-w-6xl gap-8 px-4 py-14 md:grid-cols-3">
      <div><div class="text-lg font-black text-white">${k.emoji} <span data-brand>${esc(k.brand)}</span></div><p class="mt-3 text-sm leading-7">${esc(k.sub.split("؛")[0])}.</p></div>
      <div><h3 class="font-bold text-white">نشانی</h3><p class="mt-3 text-sm leading-7">${esc(k.address)}</p></div>
      <div><h3 class="font-bold text-white">تماس و ساعت کاری</h3><p class="mt-3 text-sm leading-7"><a href="tel:02188776655" dir="ltr" class="hover:text-white">${k.phone}</a><br>${esc(k.hours)}</p></div>
    </div>
    <p class="border-t border-white/10 py-5 text-center text-xs text-slate-500">© <span id="year"></span> <span data-brand>${esc(k.brand)}</span> — همه حقوق محفوظ است.</p>
  </footer>
  <script src="${asset("app.js")}"></script>
</body>
</html>
`;
}

const STYLE = `html { scroll-behavior: smooth; }
body { font-feature-settings: "ss01"; }
:focus-visible { outline: 3px solid rgba(0, 0, 0, .15); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } * { transition: none !important; } }
`;

export function appJs(k: Kind, stack: BuilderStack) {
  const products = k.key === "shop" ? "const PRODUCTS = " + JSON.stringify(k.items.map((i) => ({ name: i.name, price: i.price ?? 0 }))) + ";\n" : "";
  return `// ${k.brand}: menu, ${k.key === "shop" ? "cart, " : ""}form
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const fa = (n) => Number(n).toLocaleString("fa-IR");
  ${products.trim()}
  const year = $("#year");
  if (year) year.textContent = new Date().toLocaleDateString("fa-IR", { year: "numeric" });

  const menuBtn = $("#menu-btn"), menu = $("#mobile-menu");
  if (menuBtn && menu) {
    menuBtn.addEventListener("click", () => { const open = menu.classList.toggle("hidden") === false; menuBtn.setAttribute("aria-expanded", String(open)); });
    menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => menu.classList.add("hidden")));
  }
${k.key === "shop" ? `
  const cart = [];
  const renderCart = () => {
    const list = $("#cart-list"), total = $("#cart-total");
    $("#cart-count").textContent = fa(cart.length);
    $("#cart-empty").classList.toggle("hidden", cart.length > 0);
    list.textContent = "";
    cart.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "flex items-center justify-between gap-3";
      const name = document.createElement("span"); name.textContent = p.name + " — " + fa(p.price) + " تومان";
      const rm = document.createElement("button"); rm.type = "button"; rm.textContent = "حذف"; rm.className = "rounded-lg bg-white/15 px-2 py-1 text-xs";
      rm.addEventListener("click", () => { cart.splice(i, 1); renderCart(); });
      li.append(name, rm); list.append(li);
    });
    const sum = cart.reduce((s, p) => s + p.price, 0);
    total.textContent = "جمع کل: " + fa(sum) + " تومان";
    total.classList.toggle("hidden", cart.length === 0);
  };
  document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
    cart.push(PRODUCTS[Number(b.dataset.add)]); renderCart();
    b.textContent = "✓ اضافه شد"; setTimeout(() => { b.textContent = "${k.itemCta}"; }, 1200);
  }));
  const cartBtn = $("#cart-btn");
  if (cartBtn) cartBtn.addEventListener("click", () => $("#book").scrollIntoView({ behavior: "smooth" }));
` : `
  document.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
    const sel = $("#f-service");
    if (sel) sel.value = b.dataset.pick;
    $("#book").scrollIntoView({ behavior: "smooth" });
  }));
`}
  const form = $("#lead-form"), msg = $("#form-msg");
  const show = (text, ok) => {
    msg.textContent = text;
    msg.className = "mt-3 rounded-xl px-4 py-3 text-sm font-bold " + (ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700");
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const missing = [...form.querySelectorAll("[required]")].find((el) => !String(el.value).trim());
    if (missing) { show("لطفاً «" + form.querySelector("label[for='" + missing.id + "']").textContent + "» را کامل کنید.", false); missing.focus(); return; }
    if (data.phone && !/^0?9\\d{9}$/.test(String(data.phone).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)))) { show("شماره موبایل معتبر نیست (مثل ۰۹۱۲۱۲۳۴۵۶۷).", false); return; }
${k.key === "shop" ? `    if (!cart.length) { show("سبد خرید خالی است.", false); return; }
    data.items = cart.map((p) => p.name);
` : ""}    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
${stack === "node" ? `    try {
      const res = await fetch("api/${k.endpoint}", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "ثبت انجام نشد؛ دوباره تلاش کنید.");
      show("${k.success}", true);
      form.reset();${k.key === "shop" ? " cart.length = 0; renderCart();" : ""}
    } catch (err) {
      // the panel preview has no server: say so instead of failing
      if (err instanceof TypeError) show("پیش‌نمایش: ${k.success} (پس از انتشار، اطلاعات در پایگاه داده ذخیره می‌شود.)", true);
      else show(err.message, false);
    } finally { btn.disabled = false; }` : `    setTimeout(() => {
      show("${k.success}", true);
      form.reset();${k.key === "shop" ? " cart.length = 0; renderCart();" : ""}
      btn.disabled = false;
    }, 500);`}
  });
})();
`;
}

export function serverJs(k: Kind) {
  const fields = k.fields.map((f) => f.name);
  return `// ${k.brand}: Express server — static frontend from public/, JSON API under /api, PostgreSQL when DATABASE_URL is set
const path = require("path");
const express = require("express");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

let pool = null;
const memory = [];
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  pool.on("error", (err) => console.error("database pool error:", err.message));
}

async function init() {
  if (!pool) return console.log("DATABASE_URL is not set: keeping data in memory");
  try {
    await pool.query("CREATE TABLE IF NOT EXISTS ${k.endpoint} (id SERIAL PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  } catch (err) {
    console.error("database init failed, using memory:", err.message);
    pool = null;
  }
}

const FIELDS = ${JSON.stringify(fields)};
const REQUIRED = ${JSON.stringify(k.fields.filter((f) => f.required).map((f) => f.name))};
const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => { console.error(err); res.status(500).json({ error: "خطای سرور؛ چند لحظه بعد دوباره تلاش کنید." }); });

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.post("/api/${k.endpoint}", wrap(async (req, res) => {
  const body = req.body || {};
  const data = {};
  for (const f of FIELDS) data[f] = clean(body[f], f === "note" || f === "message" || f === "address" ? 1000 : 120);
  const missing = REQUIRED.find((f) => !data[f]);
  if (missing) return res.status(400).json({ error: "همه فیلدهای ضروری را کامل کنید." });
  if (data.phone && !/^0?9\\d{9}$/.test(data.phone.replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)))) return res.status(400).json({ error: "شماره موبایل معتبر نیست." });
${k.key === "shop" ? `  data.items = Array.isArray(body.items) ? body.items.slice(0, 50).map((x) => clean(x, 120)) : [];
  if (!data.items.length) return res.status(400).json({ error: "سبد خرید خالی است." });
` : ""}  if (pool) {
    const r = await pool.query("INSERT INTO ${k.endpoint} (data) VALUES ($1) RETURNING id", [data]);
    return res.status(201).json({ ok: true, id: r.rows[0].id });
  }
  memory.push({ id: memory.length + 1, data, created_at: new Date() });
  res.status(201).json({ ok: true, id: memory.length });
}));

app.get("/api/${k.endpoint}/count", wrap(async (req, res) => {
  if (pool) { const r = await pool.query("SELECT count(*)::int AS n FROM ${k.endpoint}"); return res.json({ count: r.rows[0].n }); }
  res.json({ count: memory.length });
}));

process.on("unhandledRejection", (err) => console.error("unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("uncaught exception:", err));

const port = Number(process.env.PORT) || 8080;
init().then(() => app.listen(port, "0.0.0.0", () => console.log("listening on 0.0.0.0:" + port)));
`;
}

export const packageJson = (k: Kind) => JSON.stringify({
  name: k.key + "-site", version: "1.0.0", private: true, description: k.brand,
  scripts: { start: "node server.js" }, engines: { node: ">=20" },
  dependencies: { express: "^4.21.2", pg: "^8.13.1" },
}, null, 2) + "\n";

const readme = (k: Kind, stack: BuilderStack) => `# ${k.brand}

${k.sub}

${stack === "node" ? "- اجرا: `npm install` و سپس `npm start` (پورت از متغیر PORT)\n- داده‌ها در PostgreSQL (متغیر DATABASE_URL) و در نبود آن در حافظه\n- API: `POST /api/" + k.endpoint + "`، سلامت: `GET /healthz`" : "- سایت ایستا: index.html و پوشه assets"}
`;

export function projectFiles(prompt: string, stack: BuilderStack): Record<string, string> {
  const k = kind(prompt);
  if (stack === "node") return { "package.json": packageJson(k), "server.js": serverJs(k), "public/index.html": indexHtml(k, "node"), "public/app.js": appJs(k, "node"), "public/style.css": STYLE, "README.md": readme(k, "node") };
  return { "index.html": indexHtml(k, "static"), "assets/app.js": appJs(k, "static"), "assets/style.css": STYLE, "README.md": readme(k, "static") };
}

/* ---------- edits ---------- */
const SECTIONS: { re: RegExp; id: string; label: string; html: (brand: string) => string }[] = [
  { re: /سوال|سؤال|پرسش|faq/i, id: "faq", label: "بخش سؤالات متداول", html: () => `
    <section id="faq" class="mx-auto max-w-3xl px-4 py-20">
      <h2 class="text-center text-3xl font-black text-slate-900">سؤالات متداول</h2>
      <div class="mt-10 space-y-3">
        ${[["چطور زمان را تغییر دهم؟", "کافی است تا ۲۴ ساعت قبل با شماره ما تماس بگیرید."], ["پرداخت چگونه است؟", "پرداخت در محل با کارت یا به‌صورت آنلاین."], ["پارکینگ دارید؟", "بله، پارکینگ عمومی در ۵۰ متری ما قرار دارد."]].map(([q, a]) => `<details class="group rounded-2xl bg-white p-5 ring-1 ring-slate-100"><summary class="cursor-pointer list-none font-bold text-slate-800">${q}</summary><p class="mt-3 leading-7 text-slate-600">${a}</p></details>`).join("\n        ")}
      </div>
    </section>` },
  { re: /گالری|نمونه[‌ ]?کار|تصاویر|عکس/, id: "gallery", label: "گالری نمونه‌کارها", html: () => `
    <section id="gallery" class="mx-auto max-w-6xl px-4 py-20">
      <h2 class="text-center text-3xl font-black text-slate-900">نمونه‌کارها</h2>
      <div class="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
        ${["from-brand-300 to-brand-600", "from-brand-200 to-brand-500", "from-brand-400 to-brand-800", "from-brand-100 to-brand-400"].map((g, i) => `<div class="grid aspect-square place-items-center rounded-3xl bg-gradient-to-br ${g} text-5xl text-white shadow-lg" aria-label="نمونه‌کار ${fa(i + 1)}">${["✨", "🌟", "💫", "⭐"][i]}</div>`).join("\n        ")}
      </div>
    </section>` },
  { re: /نقشه|مسیر|لوکیشن/, id: "map", label: "بخش نقشه و مسیریابی", html: () => `
    <section id="map" class="mx-auto max-w-6xl px-4 py-20">
      <div class="grid gap-6 rounded-[2rem] bg-white p-8 ring-1 ring-slate-100 md:grid-cols-2">
        <div><h2 class="text-3xl font-black text-slate-900">مسیریابی</h2><p class="mt-4 leading-8 text-slate-600">با نشان و بلد مستقیم به ما برسید.</p>
        <div class="mt-6 flex flex-wrap gap-3"><a class="rounded-xl bg-brand-600 px-5 py-3 font-bold text-white" href="https://neshan.org/maps" target="_blank" rel="noopener">مسیریابی با نشان</a><a class="rounded-xl bg-slate-100 px-5 py-3 font-bold text-slate-700" href="https://balad.ir" target="_blank" rel="noopener">مسیریابی با بلد</a></div></div>
        <div class="grid min-h-48 place-items-center rounded-3xl bg-gradient-to-br from-brand-100 to-brand-300 text-6xl" aria-hidden="true">📍</div>
      </div>
    </section>` },
  { re: /خبرنامه|ایمیل/, id: "newsletter", label: "فرم عضویت در خبرنامه", html: () => `
    <section id="newsletter" class="mx-auto max-w-4xl px-4 py-16">
      <div class="rounded-[2rem] bg-brand-600 p-8 text-center text-white"><h2 class="text-2xl font-black">از تخفیف‌ها باخبر شوید</h2><p class="mt-2 text-brand-50">ماهی یک ایمیل، بدون مزاحمت.</p>
      <form class="mx-auto mt-6 flex max-w-md gap-2" onsubmit="event.preventDefault(); this.innerHTML='<p class=&quot;w-full font-bold&quot;>عضویت شما ثبت شد ✓</p>'"><label for="nl" class="sr-only">ایمیل</label><input id="nl" type="email" required dir="ltr" placeholder="you@example.com" class="flex-1 rounded-xl px-4 py-3 text-slate-800"><button class="rounded-xl bg-slate-900 px-5 font-bold">عضویت</button></form></div>
    </section>` },
  { re: /قیمت|تعرفه|پلن|پکیج/, id: "pricing", label: "جدول بسته‌ها و قیمت‌ها", html: () => `
    <section id="pricing" class="mx-auto max-w-6xl px-4 py-20">
      <h2 class="text-center text-3xl font-black text-slate-900">بسته‌ها</h2>
      <div class="mt-10 grid gap-6 md:grid-cols-3">
        ${[["پایه", 490_000, "مناسب شروع"], ["ویژه", 990_000, "پرطرفدارترین"], ["کامل", 1_890_000, "همه خدمات"]].map(([n, p, d], i) => `<div class="rounded-3xl bg-white p-7 ring-1 ${i === 1 ? "ring-2 ring-brand-500 shadow-xl" : "ring-slate-100"}"><h3 class="text-lg font-extrabold">${n}</h3><p class="text-sm text-slate-500">${d}</p><p class="mt-4 text-3xl font-black text-brand-700">${toman(p as number)}</p><a href="#book" class="mt-6 block rounded-xl bg-brand-600 py-3 text-center font-bold text-white">انتخاب</a></div>`).join("\n        ")}
      </div>
    </section>` },
];

function editProject(files: Record<string, string>, prompt: string): { files: Record<string, string>; summary: string; plan: string } {
  const htmlPath = files["public/index.html"] !== undefined ? "public/index.html" : files["index.html"] !== undefined ? "index.html" : Object.keys(files).find((p) => p.endsWith(".html"));
  if (!htmlPath) return { files: {}, summary: "فایل صفحه اصلی پیدا نشد؛ لطفاً دوباره بخواهید پروژه ساخته شود.", plan: "- بررسی فایل‌ها" };
  let html = files[htmlPath];
  const done: string[] = [];
  const out: Record<string, string> = {};

  const color = COLOR_WORDS.find(([re]) => re.test(prompt));
  if (color && /\/\*brand\*\/[\s\S]*?\/\*\/brand\*\//.test(html)) {
    html = html.replace(/\/\*brand\*\/[\s\S]*?\/\*\/brand\*\//, "/*brand*/" + paletteVars(color[1]) + "/*/brand*/");
    done.push("رنگ اصلی سایت " + color[2] + " شد");
  }
  const rename = /[«"]([^»"]{2,40})[»"]/.exec(prompt);
  const current = /data-brand>([^<]+)</.exec(html)?.[1];
  if (rename && current && /اسم|نام|عنوان|برند/.test(prompt) && rename[1] !== current) {
    for (const [p, c] of Object.entries(files)) if (p !== htmlPath && c.includes(current)) out[p] = c.split(current).join(rename[1]);
    html = html.split(current).join(esc(rename[1]));
    done.push("نام کسب‌وکار به «" + rename[1] + "» تغییر کرد");
  }
  if (/واتس[‌ ]?اپ|تلگرام|دکمه تماس|تماس فوری/.test(prompt) && !html.includes('id="float-contact"')) {
    html = html.replace("</body>", `  <a id="float-contact" href="tel:02188776655" class="fixed bottom-5 left-5 z-50 flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 font-bold text-white shadow-2xl shadow-emerald-300 transition hover:bg-emerald-600">📞 تماس فوری</a>\n</body>`);
    done.push("دکمه شناور «تماس فوری» اضافه شد");
  }
  for (const s of SECTIONS) {
    if (s.re.test(prompt) && !html.includes('id="' + s.id + '"')) { html = html.replace("<!-- sections:end -->", s.html("").trim() + "\n    <!-- sections:end -->"); done.push(s.label + " اضافه شد"); }
  }
  if (!done.length) {
    const next = SECTIONS.find((s) => !html.includes('id="' + s.id + '"'));
    const note = prompt.replace(/\s+/g, " ").trim().slice(0, 90);
    if (!html.includes('id="announce"')) {
      html = html.replace(/<header /, `<div id="announce" class="bg-brand-700 px-4 py-2 text-center text-sm font-bold text-white">📣 ${esc(note)}</div>\n  <header `);
      done.push("نوار اطلاع‌رسانی بالای صفحه با متن درخواستی شما اضافه شد");
    } else if (next) {
      html = html.replace("<!-- sections:end -->", next.html("").trim() + "\n    <!-- sections:end -->");
      done.push(next.label + " اضافه شد");
    } else {
      html = html.replace(/<div id="announce"[^>]*>[\s\S]*?<\/div>/, `<div id="announce" class="bg-brand-700 px-4 py-2 text-center text-sm font-bold text-white">📣 ${esc(note)}</div>`);
      done.push("متن نوار اطلاع‌رسانی به‌روز شد");
    }
  }
  out[htmlPath] = html;
  return { files: out, plan: done.map((d) => "- " + d).join("\n"), summary: "انجام شد: " + done.join("، ") + ". پیش‌نمایش را ببینید؛ اگر تغییر دیگری لازم است، همین‌جا بنویسید." };
}

/* ---------- fixes for failed deployments ---------- */
const requires = (src: string) => [...src.matchAll(/require\(\s*["']([^"'./][^"']*)["']\s*\)|from\s+["']([^"'./][^"']*)["']/g)].map((m) => (m[1] ?? m[2]).split("/")[0]).filter((x) => !/^node:|^(path|fs|http|https|crypto|url|os|util|events|stream|zlib|child_process)$/.test(x));

function fixProject(files: Record<string, string>, log: string, stack: BuilderStack): { files: Record<string, string>; summary: string; plan: string } {
  if (stack === "static") {
    if (!files["index.html"]) return { files: { "index.html": indexHtml(kind(""), "static") }, plan: "- ساخت صفحه اصلی index.html", summary: "علت خطا: صفحه اصلی سایت (index.html) وجود نداشت و سرور وب چیزی برای نمایش نداشت. یک صفحه اصلی کامل ساختم و دوباره منتشر می‌کنم." };
    return { files: { "index.html": files["index.html"].replace(/^﻿/, "") }, plan: "- بازنویسی صفحه اصلی", summary: "فایل‌های سایت را بازبینی کردم و صفحه اصلی را دوباره ذخیره کردم تا انتشار دوباره امتحان شود." };
  }
  const out: Record<string, string> = {};
  const why: string[] = [];
  const server = files["server.js"] ?? "";
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; [k: string]: unknown } | null = null;
  try { pkg = JSON.parse(files["package.json"] ?? ""); } catch { pkg = null; }
  if (!pkg || typeof pkg !== "object") { pkg = { name: "app", version: "1.0.0", private: true }; why.push("فایل package.json خراب بود (JSON نامعتبر)"); }
  if (!pkg.scripts?.start) { pkg.scripts = { ...(pkg.scripts ?? {}), start: "node server.js" }; why.push("دستور اجرای اپ (اسکریپت start) در package.json تعریف نشده بود"); }
  const deps = { ...(pkg.dependencies ?? {}) };
  for (const r of requires(server + "\n" + Object.entries(files).filter(([p]) => p.endsWith(".js") && !p.startsWith("public/")).map(([, c]) => c).join("\n"))) {
    if (!deps[r]) { deps[r] = r === "express" ? "^4.21.2" : r === "pg" ? "^8.13.1" : "*"; why.push("بسته «" + r + "» استفاده شده اما در وابستگی‌ها نبود"); }
  }
  pkg.dependencies = deps;
  if (!pkg.engines) pkg.engines = { node: ">=20" };
  const pkgText = JSON.stringify(pkg, null, 2) + "\n";
  if (pkgText !== files["package.json"]) out["package.json"] = pkgText;
  if (server && !/process\.env\.PORT/.test(server)) {
    out["server.js"] = server.replace(/\.listen\(\s*(\d+)/, ".listen(Number(process.env.PORT) || 8080");
    why.push("سرور روی پورت ثابت اجرا می‌شد، نه پورت تعیین‌شده توسط گره (PORT)");
  }
  if (!server) { out["server.js"] = serverJs(kind("")); why.push("فایل server.js وجود نداشت"); }
  if (!Object.keys(out).length) { out["server.js"] = server.replace(/\n*$/, "\n"); why.push("در لاگ (" + (log.split("\n").filter(Boolean).pop() ?? "").slice(0, 80) + ") علت روشنی نبود؛ فایل‌ها را بازبینی کردم"); }
  return { files: out, plan: "- بررسی لاگ بیلد\n" + why.map((w) => "- رفع: " + w).join("\n"), summary: "علت خطا: " + why.join("؛ ") + ". همین موارد را اصلاح کردم و نسخه جدید را دوباره منتشر می‌کنم." };
}

/* ---------- maintenance diagnosis ---------- */
function diagnose(files: Record<string, string>, raw: string, stack: BuilderStack): { files: Record<string, string>; summary: string; plan: string } {
  // a routine scan reads like the manual check
  const incident = raw === "scan" ? "manual" : raw;
  const server = files["server.js"];
  if (/oom/.test(incident)) return { files: {}, plan: "- بررسی مصرف حافظه", summary: "علت احتمالی: مصرف حافظه اپ از سقف پلن فعلی بیشتر شد و سیستم آن را ری‌استارت کرد.\nاثر: چند ثانیه قطعی هنگام ری‌استارت.\nراه‌حل: کد مشکلی ندارد؛ پلن اپ را یک پله بزرگ‌تر کنید (از بخش اپ‌ها › مقیاس) یا ترافیک را زیر نظر بگیرید." };
  if (stack === "node" && server) {
    const patch: Record<string, string> = {};
    let s = server;
    if (!/unhandledRejection/.test(s)) s = s.replace(/\nconst port =/, '\nprocess.on("unhandledRejection", (err) => console.error("unhandled rejection:", err));\nprocess.on("uncaughtException", (err) => console.error("uncaught exception:", err));\n\nconst port =');
    if (!/\/healthz/.test(s)) s = s.replace(/\napp\.use\(express\.static/, '\napp.get("/healthz", (req, res) => res.json({ ok: true }));\napp.use(express.static');
    if (/pool = new Pool/.test(s) && !/pool\.on\("error"/.test(s)) s = s.replace(/(pool = new Pool\([^\n]*\);)/, '$1\n  pool.on("error", (err) => console.error("database pool error:", err.message));');
    const handlers = s !== server;
    if (incident !== "manual" && /new Pool\(\{[^}\n]*\}\)/.test(s) && !/connectionTimeoutMillis/.test(s)) s = s.replace(/new Pool\(\{([^}\n]*)\}\)/, (_m, a: string) => "new Pool({ " + a.trim() + ", connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 })");
    if (s !== server && !handlers) return { files: { "server.js": s }, plan: "- بررسی لاگ‌ها و رخدادها\n- مهلت زمانی برای اتصال به پایگاه داده", summary: "علت احتمالی: اتصال به پایگاه داده لحظه‌ای قطع شد و درخواست‌ها بدون مهلت زمانی منتظر ماندند تا اپ از پاسخ افتاد و ری‌استارت شد.\nاثر: چند ثانیه قطعی و خطای ۵۰۰ برای چند کاربر.\nراه‌حل: برای اتصال‌ها مهلت زمانی (۵ ثانیه) و آزادسازی اتصال‌های بیکار تعریف کردم تا قطعی لحظه‌ای پایگاه داده اپ را از کار نیندازد. با «اعمال وصله» نسخه جدید منتشر می‌شود." };
    if (s !== server) patch["server.js"] = s;
    if (Object.keys(patch).length) return { files: patch, plan: "- بررسی لاگ‌ها و رخدادها\n- افزودن مدیریت خطا و مسیر سلامت", summary: "علت احتمالی: یک خطای مدیریت‌نشده (مثلاً قطع لحظه‌ای اتصال پایگاه داده) کل پردازه را متوقف می‌کند.\nاثر: اپ چند ثانیه از دسترس خارج می‌شود تا دوباره بالا بیاید.\nراه‌حل: مدیریت سراسری خطا و مسیر سلامت /healthz را اضافه کردم تا چنین خطایی فقط ثبت شود و اپ از کار نیفتد. با «اعمال وصله» نسخه جدید منتشر می‌شود." };
    return { files: {}, plan: "- بررسی لاگ‌ها و رخدادها", summary: (incident === "manual" ? "وضعیت: سالم — اپ پاسخ می‌دهد و رخداد مهمی در لاگ‌ها دیده نشد.\n" : "علت احتمالی: ری‌استارت‌های پراکنده از سمت زیرساخت یا یک درخواست سنگین.\n") + "اثر: " + (incident === "manual" ? "ندارد." : "قطعی کوتاه.") + "\nراه‌حل: کد مدیریت خطا و مسیر سلامت را دارد؛ فعلاً تغییری لازم نیست و عامل نگهداری اپ را زیر نظر دارد." };
  }
  return { files: {}, plan: "- بررسی وضعیت سایت", summary: incident === "manual" ? "وضعیت: سالم — سایت ایستا پاسخ می‌دهد.\nاثر: ندارد.\nراه‌حل: تغییری لازم نیست." : "علت احتمالی: ری‌استارت سرور وب از سمت زیرساخت.\nاثر: قطعی چندثانیه‌ای.\nراه‌حل: سایت ایستا کدی سمت سرور ندارد؛ تغییری لازم نیست و دوباره خودکار بالا آمده است." };
}

/** the simulated model answer for a task, in the builder format */
export function simulate(stack: BuilderStack, t: TaskInput): string {
  switch (t.kind) {
    case "generate": {
      const k = kind(t.prompt);
      const files = projectFiles(t.prompt, stack);
      return render({
        plan: ["- طراحی صفحه اصلی «" + k.brand + "» با معرفی، " + k.itemsTitle + " و نظرات مشتریان", "- " + k.formTitle + (stack === "node" ? " با ذخیره در پایگاه داده (API در server.js)" : " با پیام تأیید"), "- نسخه موبایل، فونت وزیرمتن و راست‌به‌چپ کامل"].join("\n"),
        files,
        summary: "«" + k.brand + "» آماده است: " + k.itemsTitle + "، بخش «" + k.formTitle + "» و نظرات مشتریان، با طراحی واکنش‌گرا برای موبایل. " + (stack === "node" ? "اطلاعات فرم پس از انتشار در پایگاه داده ذخیره می‌شود. " : "") + "می‌توانید بنویسید مثلاً «رنگ را سبز کن» یا «بخش سؤالات متداول اضافه کن».",
      });
    }
    case "edit": return render(editProject(t.files, t.prompt));
    case "fix": return render(fixProject(t.files, t.log, stack));
    case "maintain": return render(diagnose(t.files, t.incident, stack));
  }
}
