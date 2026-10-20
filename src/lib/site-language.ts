/* The language of a site the AI builder writes (BCP-47), separate from the language the customer
   chats in. Resolution, most specific first:
   1. an explicit request in this message («سایت انگلیسی», "in German", "an Arabic website")
   2. the project's setting, when it is not "auto"
   3. the language the project already has (so a Persian edit to an English site keeps it English)
   4. the language the request itself is written in (a Persian prompt with no hint → fa) */

export type SiteDir = "rtl" | "ltr";
type Lang = { id: string; label: string; native: string; fa: string; en: string; locale: string };

/** the languages offered in the panel (any BCP-47 tag detected from a request is accepted too) */
export const SITE_LANGUAGES: Lang[] = [
  { id: "fa", label: "فارسی", native: "فارسی", fa: "فارسی|پارسی", en: "persian|farsi", locale: "fa-IR" },
  { id: "en", label: "انگلیسی", native: "English", fa: "انگلیسی", en: "english", locale: "en-US" },
  { id: "ar", label: "عربی", native: "العربية", fa: "عربی", en: "arabic", locale: "ar" },
  { id: "tr", label: "ترکی استانبولی", native: "Türkçe", fa: "ترکی(?:\\s+استانبولی)?", en: "turkish", locale: "tr-TR" },
  { id: "az", label: "ترکی آذربایجانی", native: "Azərbaycanca", fa: "آذری|ترکی\\s+آذربایجانی", en: "azerbaijani|azeri", locale: "az" },
  { id: "de", label: "آلمانی", native: "Deutsch", fa: "آلمانی", en: "german|deutsch", locale: "de-DE" },
  { id: "fr", label: "فرانسوی", native: "Français", fa: "فرانسوی|فرانسه", en: "french|français", locale: "fr-FR" },
  { id: "es", label: "اسپانیایی", native: "Español", fa: "اسپانیایی", en: "spanish|español", locale: "es-ES" },
  { id: "it", label: "ایتالیایی", native: "Italiano", fa: "ایتالیایی", en: "italian", locale: "it-IT" },
  { id: "ru", label: "روسی", native: "Русский", fa: "روسی", en: "russian", locale: "ru-RU" },
  { id: "zh", label: "چینی", native: "中文", fa: "چینی", en: "chinese|mandarin", locale: "zh-CN" },
  { id: "ja", label: "ژاپنی", native: "日本語", fa: "ژاپنی", en: "japanese", locale: "ja-JP" },
  { id: "hi", label: "هندی", native: "हिन्दी", fa: "هندی", en: "hindi", locale: "hi-IN" },
  { id: "ur", label: "اردو", native: "اردو", fa: "اردو", en: "urdu", locale: "ur-PK" },
  { id: "ps", label: "پشتو", native: "پښتو", fa: "پشتو", en: "pashto", locale: "ps-AF" },
  { id: "he", label: "عبری", native: "עברית", fa: "عبری", en: "hebrew", locale: "he-IL" },
];
const RTL = new Set(["fa", "ar", "he", "ur", "ps", "ckb", "ku-arab", "yi", "dv", "sd", "ug"]);
export const SITE_LANGUAGE_IDS = SITE_LANGUAGES.map((l) => l.id);
export const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** the base language of a tag ("fa-IR" → "fa") */
export const baseLang = (tag: string) => tag.toLowerCase().split("-")[0];
export const dirOf = (tag: string): SiteDir => (RTL.has(tag.toLowerCase()) || RTL.has(baseLang(tag)) ? "rtl" : "ltr");
export const langInfo = (tag: string) => SITE_LANGUAGES.find((l) => l.id === baseLang(tag)) ?? null;
/** Intl locale for numbers and dates */
export const localeOf = (tag: string) => langInfo(tag)?.locale ?? tag;
/** a label for the panel (Persian) */
export const langLabel = (tag: string) => langInfo(tag)?.label ?? tag;

// letters end the word: JavaScript's \b does not know Persian
const END = "(?=$|[^\\p{L}\\p{M}\\u200c])";
const SITE_FA = "(?:سایت|وب[\\s\\u200c]?سایت|صفحه|لندینگ|اپ|اپلیکیشن|فروشگاه|نسخه|متن|محتوا|منو|پنل)(?:ی|‌ای)?";
const SITE_EN = "(?:site|website|web\\s*site|page|landing(?:\\s*page)?|version|app|store|shop|portfolio|blog|menu)";

/** a language the request explicitly asks the site to be in, else null */
export function explicitLanguage(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  // the more specific «ترکی آذربایجانی» before «ترکی»
  for (const l of [...SITE_LANGUAGES].sort((a, b) => Number(b.id === "az") - Number(a.id === "az"))) {
    const fa = new RegExp("(?:" + SITE_FA + "\\s+(?:(?:به|با)\\s+)?(?:زبان\\s+)?(?:" + l.fa + ")|(?:به|با)\\s+زبان\\s+(?:" + l.fa + ")|به\\s+(?:" + l.fa + ")\\s+(?:باشد|باشه|بنویس|بساز|طراحی)|زبان\\s+(?:سایت|صفحه|محتوا)\\s*[:：]?\\s*(?:" + l.fa + "))" + END, "u");
    const en = new RegExp("(?:\\b(?:in|into)\\s+(?:" + l.en + ")\\b|\\b(?:" + l.en + ")[\\s-]+(?:language\\s+|speaking\\s+)?" + SITE_EN + "\\b|\\blanguage\\s*[:=]\\s*(?:" + l.en + ")\\b)", "iu");
    if (fa.test(t) || en.test(t)) return l.id;
  }
  return null;
}

/** the language a text is written in, from its script (and a few stop words for Latin languages) */
export function textLanguage(text: string): string {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const arabicScript = count(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g);
  const scripts: [string, number][] = [
    ["arabic", arabicScript], ["latin", count(/[A-Za-zÀ-ɏ]/g)], ["cyrillic", count(/[Ѐ-ӿ]/g)], ["hebrew", count(/[֐-׿]/g)],
    ["kana", count(/[぀-ヿ]/g)], ["han", count(/[一-鿿]/g)], ["devanagari", count(/[ऀ-ॿ]/g)],
  ];
  const [top, n] = scripts.reduce((a, b) => (b[1] > a[1] ? b : a));
  if (!n) return "fa";
  if (top === "arabic") {
    const persian = count(/[پچژگکی]/g), arabic = count(/[ةيكىإأ]|ال[ء-ي]/g);
    if (/[ٹڈڑںےۓ]/.test(text)) return "ur";
    return arabic > persian ? "ar" : "fa";
  }
  if (top === "cyrillic") return "ru";
  if (top === "hebrew") return "he";
  if (top === "devanagari") return "hi";
  if (top === "han") return count(/[぀-ヿ]/g) ? "ja" : "zh";
  if (top === "kana") return "ja";
  const w = ` ${text.toLowerCase()} `;
  const hits = (words: string[]) => words.reduce((s, x) => s + (w.includes(` ${x} `) ? 1 : 0), 0);
  const latin: [string, number][] = [
    ["de", hits(["und", "der", "die", "das", "für", "mit", "eine", "ich", "wir", "ist"]) + count(/[äöüß]/g)],
    ["fr", hits(["le", "la", "les", "et", "pour", "une", "des", "avec", "nous", "est"]) + count(/[éèêàçù]/g)],
    ["es", hits(["el", "los", "las", "y", "para", "una", "con", "nuestro", "es"]) + count(/[ñ¿¡]/g)],
    ["tr", hits(["ve", "bir", "için", "ile", "bu", "çok"]) + count(/[ğışİ]/g) * 2],
    ["it", hits(["il", "gli", "e", "per", "una", "con", "della", "è"])],
  ];
  const [best, score] = latin.reduce((a, b) => (b[1] > a[1] ? b : a));
  return score >= 2 ? best : "en";
}

/** the site language for a run (see the header) */
export function resolveSiteLanguage(o: { prompt: string; setting?: string | null; current?: string | null }): string {
  const asked = explicitLanguage(o.prompt);
  if (asked) return asked;
  if (o.setting && o.setting !== "auto" && LANG_RE.test(o.setting)) return o.setting;
  if (o.current && LANG_RE.test(o.current)) return o.current;
  return textLanguage(o.prompt);
}
