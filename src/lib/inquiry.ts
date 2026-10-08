/* Gereh inquiry API (استعلام): the catalog of services, their inputs, sample outputs and the input
   validators. Shared by the API gateway, the panel (playground, docs) and the public pages.
   Prices, names and on/off live in the database (inquiry_services) so staff can change them;
   the definitions below are the defaults and the contract of each endpoint. */

export type FieldKind = "nationalCode" | "birthDate" | "mobile" | "iban" | "card" | "postalCode" | "companyId" | "bankCode" | "deposit" | "name" | "image";
export type InquiryField = { key: string; label: string; kind: FieldKind; example: string };
export type InquiryCategory = "identity" | "bank" | "business" | "address" | "kyc";
export type InquiryDef = {
  id: string; name: string; category: InquiryCategory; price: number; approval: boolean;
  summary: string; fields: InquiryField[]; sample: Record<string, unknown>;
};

export const INQUIRY_CATEGORIES: { id: InquiryCategory; label: string; icon: string }[] = [
  { id: "identity", label: "هویت و ثبت احوال", icon: "fingerprint" },
  { id: "bank", label: "بانکی", icon: "wallet" },
  { id: "kyc", label: "احراز هویت دیجیتال", icon: "shield-check" },
  { id: "business", label: "کسب‌وکار و چک", icon: "building-2" },
  { id: "address", label: "نشانی و ارتباط", icon: "map-pin" },
];

const f = (key: string, label: string, kind: FieldKind, example: string): InquiryField => ({ key, label, kind, example });
const NC = f("nationalCode", "کد ملی", "nationalCode", "0012345679");
const BD = f("birthDate", "تاریخ تولد (شمسی)", "birthDate", "1370/05/12");
const MOB = f("mobile", "شماره موبایل", "mobile", "09121234567");
const IBAN = f("iban", "شماره شبا", "iban", "IR820540102680020817909002");
const CARD = f("card", "شماره کارت", "card", "6037991234567893");

export const INQUIRY_SERVICES: InquiryDef[] = [
  { id: "identity_v2", name: "استعلام ثبت احوال نسخه ۲", category: "identity", price: 6950, approval: true,
    summary: "با کد ملی و تاریخ تولد، نام، نام خانوادگی، نام پدر، جنسیت و وضعیت حیات فرد را از ثبت احوال برمی‌گرداند.",
    fields: [NC, BD], sample: { firstName: "علی", lastName: "محمدی", fatherName: "حسن", gender: "male", alive: true, birthDate: "1370/05/12" } },
  { id: "identity_match", name: "تطابق نام با کد ملی", category: "identity", price: 3950, approval: true,
    summary: "بررسی می‌کند نام و نام خانوادگی واردشده با کد ملی و تاریخ تولد در ثبت احوال یکی است یا نه؛ بدون برگرداندن اطلاعات شخص.",
    fields: [NC, BD, f("firstName", "نام", "name", "علی"), f("lastName", "نام خانوادگی", "name", "محمدی")], sample: { firstNameMatch: true, lastNameMatch: true } },
  { id: "shahkar_lite", name: "شاهکار لایت", category: "identity", price: 1430, approval: true,
    summary: "تطابق مالکیت سیم‌کارت با کد ملی (سامانه شاهکار)؛ برای ثبت‌نام امن و جلوگیری از حساب‌های جعلی.",
    fields: [MOB, NC], sample: { matched: true } },
  { id: "mobile_operator", name: "تشخیص اپراتور موبایل", category: "address", price: 120, approval: false,
    summary: "اپراتور (همراه اول، ایرانسل، رایتل…) و نوع سیم‌کارت را برای ارسال پیامک یا شارژ مستقیم تشخیص می‌دهد.",
    fields: [MOB], sample: { operator: "MCI", operatorName: "همراه اول", ported: false } },
  { id: "ibans", name: "استعلام شماره شبا", category: "bank", price: 572, approval: false,
    summary: "نام صاحب حساب، بانک و وضعیت حساب (فعال، مسدود، راکد) را پیش از واریز برمی‌گرداند.",
    fields: [IBAN], sample: { bank: "بانک سامان", bankCode: "056", owners: ["علی محمدی"], depositStatus: "active", deposit: "1268002081790900" } },
  { id: "cards", name: "استعلام کارت بانکی", category: "bank", price: 572, approval: false,
    summary: "نام دارنده کارت و بانک صادرکننده را برمی‌گرداند؛ برای نمایش نام گیرنده پیش از کارت‌به‌کارت.",
    fields: [CARD], sample: { bank: "بانک صادرات", owner: "علی محمدی" } },
  { id: "cards_iban", name: "تبدیل شماره کارت به شبا", category: "bank", price: 644, approval: false,
    summary: "شماره شبای حساب متصل به کارت را همراه با نام صاحب حساب برمی‌گرداند.",
    fields: [CARD], sample: { iban: "IR820540102680020817909002", bank: "بانک سامان", owner: "علی محمدی" } },
  { id: "cards_deposit", name: "تبدیل شماره کارت به حساب", category: "bank", price: 644, approval: false,
    summary: "شماره حساب متصل به کارت و بانک آن را برمی‌گرداند.",
    fields: [CARD], sample: { deposit: "1268002081790900", bank: "بانک سامان", owner: "علی محمدی" } },
  { id: "deposit_iban", name: "تبدیل شماره حساب به شبا", category: "bank", price: 644, approval: false,
    summary: "با کد بانک و شماره حساب، شماره شبای معتبر و نام صاحب حساب را برمی‌گرداند.",
    fields: [f("bankCode", "کد بانک (سه رقم)", "bankCode", "056"), f("deposit", "شماره حساب", "deposit", "1268002081790900")], sample: { iban: "IR820540102680020817909002", owner: "علی محمدی" } },
  { id: "iban_owner", name: "تطابق شبا با کد ملی", category: "bank", price: 1150, approval: false,
    summary: "بررسی می‌کند حساب متعلق به همین کد ملی است؛ برای تسویه امن با کاربران و فروشندگان.",
    fields: [IBAN, NC, BD], sample: { matched: true } },
  { id: "card_owner", name: "تطابق کارت با کد ملی", category: "bank", price: 1150, approval: false,
    summary: "بررسی می‌کند کارت متعلق به همین کد ملی است؛ جلوی پرداخت با کارت دیگران را می‌گیرد.",
    fields: [CARD, NC, BD], sample: { matched: true } },
  { id: "postal_code", name: "استعلام کد پستی", category: "address", price: 990, approval: false,
    summary: "نشانی کامل (استان، شهر، خیابان، پلاک، طبقه) را از کد پستی ده‌رقمی برمی‌گرداند.",
    fields: [f("postalCode", "کد پستی", "postalCode", "1434863111")], sample: { province: "تهران", city: "تهران", street: "خیابان کارگر شمالی", plate: "۱۲", floor: "۳", address: "تهران، خیابان کارگر شمالی، پلاک ۱۲، طبقه ۳" } },
  { id: "company", name: "استعلام اشخاص حقوقی", category: "business", price: 2400, approval: false,
    summary: "نام ثبتی، شماره و تاریخ ثبت، نوع شرکت، وضعیت (فعال، منحل…) و نشانی را با شناسه ملی برمی‌گرداند.",
    fields: [f("companyId", "شناسه ملی شرکت", "companyId", "10101234567")], sample: { name: "شرکت نمونه فناوران", registrationNumber: "123456", registrationDate: "1395/02/20", type: "سهامی خاص", status: "active", address: "تهران، ونک" } },
  { id: "economic_code", name: "استعلام کد اقتصادی", category: "business", price: 1500, approval: false,
    summary: "ثبت‌نام در نظام مالیاتی و ارزش افزوده را برای صدور فاکتور رسمی و سامانه مودیان بررسی می‌کند.",
    fields: [f("companyId", "شناسه ملی یا کد ملی", "companyId", "10101234567")], sample: { name: "شرکت نمونه فناوران", economicCode: "411111111111", vatRegistered: true } },
  { id: "sayad_cheque", name: "استعلام رنگ چک صیادی", category: "business", price: 2900, approval: true,
    summary: "وضعیت اعتباری صادرکننده چک (سفید، زرد، نارنجی، قهوه‌ای، قرمز) را از سامانه صیاد برمی‌گرداند.",
    fields: [NC], sample: { color: "white", colorName: "سفید", bouncedCount: 0 } },
  { id: "national_card_ocr", name: "خواندن کارت ملی (OCR)", category: "kyc", price: 1990, approval: false,
    summary: "از عکس کارت ملی هوشمند، کد ملی، نام، نام خانوادگی، تاریخ تولد و تاریخ انقضا را می‌خواند.",
    fields: [f("image", "تصویر روی کارت (base64)", "image", "data:image/jpeg;base64,…")], sample: { nationalCode: "0012345679", firstName: "علی", lastName: "محمدی", birthDate: "1370/05/12", expiry: "1410/05/12" } },
  { id: "face_match", name: "تطابق چهره با کارت ملی", category: "kyc", price: 3900, approval: true,
    summary: "عکس سلفی را با تصویر ثبت‌شده در ثبت احوال مقایسه و درصد شباهت و نتیجه زنده‌بودن را برمی‌گرداند.",
    fields: [NC, BD, f("image", "عکس سلفی (base64)", "image", "data:image/jpeg;base64,…")], sample: { matched: true, similarity: 0.94, liveness: true } },
];
export const inquiryDef = (id: string) => INQUIRY_SERVICES.find((s) => s.id === id);

/* ---------- validators ---------- */
const enDigits = (s: string) => s.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));

export function validNationalCode(code: string) {
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const sum = [...code.slice(0, 9)].reduce((s, d, i) => s + Number(d) * (10 - i), 0) % 11;
  const check = Number(code[9]);
  return sum < 2 ? check === sum : check === 11 - sum;
}
export function validCard(card: string) {
  if (!/^\d{16}$/.test(card)) return false;
  const sum = [...card].reduce((s, d, i) => { let n = Number(d); if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } return s + n; }, 0);
  return sum % 10 === 0;
}
export function validIban(iban: string) {
  if (!/^IR\d{24}$/.test(iban)) return false;
  const r = (iban.slice(4) + "1827" + iban.slice(2, 4)); // I=18 R=27
  let rem = 0;
  for (const c of r) rem = (rem * 10 + Number(c)) % 97;
  return rem === 1;
}
const validJalali = (s: string) => {
  const m = /^(1[34]\d\d)\/(\d\d)\/(\d\d)$/.exec(s);
  if (!m) return false;
  const mo = Number(m[2]), d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= (mo <= 6 ? 31 : mo < 12 ? 30 : 30);
};

/** normalizes (Persian digits, spaces, dashes) and validates one input; returns the clean value or an error */
export function checkField(kind: FieldKind, raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { error: "خالی است" };
  let v = enDigits(raw.trim());
  switch (kind) {
    case "nationalCode": v = v.replace(/\D/g, ""); return validNationalCode(v) ? { value: v } : { error: "کد ملی معتبر نیست" };
    case "birthDate": v = v.replace(/-/g, "/"); return validJalali(v) ? { value: v } : { error: "تاریخ باید شمسی و به شکل ۱۳۷۰/۰۵/۱۲ باشد" };
    case "mobile": v = v.replace(/\D/g, "").replace(/^98/, "0").replace(/^9/, "09"); return /^09\d{9}$/.test(v) ? { value: v } : { error: "شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود" };
    case "iban": v = v.toUpperCase().replace(/[\s-]/g, ""); if (/^\d{24}$/.test(v)) v = "IR" + v; return validIban(v) ? { value: v } : { error: "شماره شبا معتبر نیست" };
    case "card": v = v.replace(/\D/g, ""); return validCard(v) ? { value: v } : { error: "شماره کارت معتبر نیست" };
    case "postalCode": v = v.replace(/\D/g, ""); return /^[13-9]{5}\d{5}$/.test(v) ? { value: v } : { error: "کد پستی ده‌رقمی معتبر نیست" };
    case "companyId": v = v.replace(/\D/g, ""); return /^\d{10,11}$/.test(v) ? { value: v } : { error: "شناسه ملی ۱۱ رقم (یا کد ملی ۱۰ رقم) است" };
    case "bankCode": v = v.replace(/\D/g, ""); return /^\d{3}$/.test(v) ? { value: v } : { error: "کد بانک سه رقم است" };
    case "deposit": v = v.replace(/[^\d.]/g, ""); return /^[\d.]{5,26}$/.test(v) ? { value: v } : { error: "شماره حساب معتبر نیست" };
    case "name": return v.length >= 2 && v.length <= 60 ? { value: v } : { error: "باید ۲ تا ۶۰ نویسه باشد" };
    case "image": return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]{1000,}$/.test(v) && v.length < 3_000_000 ? { value: v } : { error: "تصویر JPEG/PNG به‌صورت data URL و کمتر از ۲ مگابایت" };
  }
}

/** validates every input of a service; masked copy is what gets logged (never the full personal data) */
export function checkInputs(def: InquiryDef, body: Record<string, unknown>): { values: Record<string, string>; masked: string } | { errors: Record<string, string> } {
  const values: Record<string, string> = {}, errors: Record<string, string> = {};
  for (const fd of def.fields) {
    const r = checkField(fd.kind, body[fd.key]);
    if ("error" in r) errors[fd.key] = fd.label + ": " + r.error; else values[fd.key] = r.value;
  }
  if (Object.keys(errors).length) return { errors };
  const mask = (fd: InquiryField) => { const v = values[fd.key]; return fd.kind === "image" ? "[image]" : fd.kind === "name" ? v[0] + "…" : v.length > 6 ? "…" + v.slice(-4) : "…"; };
  return { values, masked: def.fields.map((fd) => fd.key + "=" + mask(fd)).join(" ") };
}
