/* English copy for /en. Plan prices and specs come from the same catalogue as the Persian site;
   specs are machine-translated with a small glossary so the two never drift apart. */
import { toEnDigits } from "@/lib/format";

export const PLAN_EN: Record<string, { name: string; tag?: string }> = {
  c1: { name: "Start", tag: "Side projects and test environments" }, c2: { name: "Basic", tag: "Websites and light APIs" },
  c3: { name: "Pro", tag: "Busy stores and apps" }, c4: { name: "Business", tag: "Databases and critical services" },
  m1: { name: "BM-1" }, m2: { name: "BM-2" }, m3: { name: "BM-3" },
  h1: { name: "Bronze" }, h2: { name: "Silver" }, h3: { name: "Gold" }, h4: { name: "Diamond" },
  w1: { name: "WordPress Personal" }, w2: { name: "WordPress Business" }, w3: { name: "WooCommerce" },
};

export const LOC_EN: Record<string, [string, string]> = { thr: ["Tehran", "Primary datacenter"], isf: ["Isfahan", "Backup datacenter"], fra: ["Frankfurt", "Germany"], ams: ["Amsterdam", "Netherlands"] };

const WORDS: [RegExp, string | ((m: string, n: string) => string)][] = [
  [/(\d+(?:\.\d+)?) هسته \/ (\d+) رشته/g, "$1 cores / $2 threads"], [/(\d+) هسته/g, "$1 vCPU"],
  [/گیگابایت|گیگ(?!ابیت)/g, "GB"], [/ترابایت/g, "TB"], [/گیگابیت/g, "Gbps"],
  [/(\d+) عدد/g, "$1"], [/نامحدود/g, "Unlimited"], [/ندارد/g, "—"], [/اختیاری/g, "Optional"], [/هفتگی/g, "Weekly"], [/روزانه/g, "Daily"],
  [/(\d+) سایت/g, (_, n) => n + (n === "1" ? " site" : " sites")], [/(\d+) ایمیل/g, "$1 mailboxes"], [/(\d+) دیتابیس/g, "$1 databases"],
];
/** "۴ هسته" → "4 vCPU", "۱۶۰ گیگ NVMe" → "160 GB NVMe" */
export function enSpec(s: string | undefined) {
  if (!s) return "—";
  let out = toEnDigits(s).replace(/٫/g, ".");
  for (const [re, to] of WORDS) out = typeof to === "string" ? out.replace(re, to) : out.replace(re, to);
  return out.replace(/\s+/g, " ").trim();
}

export const tomanEn = (toman: number) => toman.toLocaleString("en-US") + " Toman";
