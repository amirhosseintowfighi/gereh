/* Geo DNS (دسترسی دوطرفه): visitors inside Iran get the Iranian server, everyone else (Googlebot
   included) gets the server abroad, so the site stays reachable and indexed when international
   traffic is cut. Shared by the panel, the public page and the server. */

export type GeoRecordType = "A" | "AAAA" | "CNAME" | "TXT" | "MX";
export const GEO_TYPES: { id: GeoRecordType; label: string; geo: boolean; hint: string }[] = [
  { id: "A", label: "A", geo: true, hint: "آدرس IPv4 سرور" },
  { id: "AAAA", label: "AAAA", geo: true, hint: "آدرس IPv6 سرور" },
  { id: "CNAME", label: "CNAME", geo: true, hint: "نام دامنه مقصد" },
  { id: "TXT", label: "TXT", geo: false, hint: "متن (SPF، تأیید مالکیت…)؛ برای همه یکسان" },
  { id: "MX", label: "MX", geo: false, hint: "سرور ایمیل؛ برای همه یکسان" },
];

export const GEO_PLAN_DEFAULTS = [
  { id: "geo-basic", name: "پایه", price: 490_000, records: 10, healthChecks: false, sync: "none" as const },
  { id: "geo-pro", name: "حرفه‌ای", price: 990_000, records: 50, healthChecks: true, sync: "none" as const },
  { id: "geo-managed", name: "مدیریت‌شده", price: 3_900_000, records: 100, healthChecks: true, sync: "full" as const },
];
export const SYNC_LABEL: Record<string, string> = { none: "بدون همگام‌سازی", files: "همگام‌سازی فایل‌ها", full: "همگام‌سازی فایل‌ها و پایگاه داده" };
export const SYNC_STATUS: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]> = {
  none: ["فعال نیست", "gray"], setup: ["در حال راه‌اندازی", "blue"], ok: ["به‌روز", "green"], lagging: ["با تأخیر", "amber"], failed: ["متوقف", "red"],
};
export const ZONE_STATUS: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]> = {
  pending: ["در انتظار تغییر NS", "amber"], active: ["فعال", "green"], suspended: ["معلق (بدون تفکیک)", "red"],
};

export const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,7}:|([0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|::([0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4}|::)$/i;
const HOST = /^(?=.{1,253}\.?$)([a-z0-9_]([a-z0-9_-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?\.?$/i;
const PRIVATE4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/** record name relative to the zone: "@", "www", "api.v2", "*" */
export const validName = (n: string) => n === "@" || n === "*" || /^(\*\.)?([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?)(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?)*$/i.test(n);

export function checkValue(type: GeoRecordType, v: string): string | null {
  const s = v.trim();
  if (!s) return "مقدار را وارد کنید";
  switch (type) {
    case "A": return !IPV4.test(s) ? "آدرس IPv4 معتبر نیست" : PRIVATE4.test(s) ? "آدرس خصوصی از اینترنت در دسترس نیست" : null;
    case "AAAA": return IPV6.test(s) ? null : "آدرس IPv6 معتبر نیست";
    case "CNAME": case "MX": return HOST.test(s) && s.includes(".") ? null : "نام دامنه معتبر نیست";
    case "TXT": return s.length <= 255 && !/["\\]/.test(s) ? null : "حداکثر ۲۵۵ نویسه، بدون \" و \\";
  }
}

/** what a visitor gets: the panel's "test" tool and the driver use the same rule */
export function answerFor(r: { type: GeoRecordType; iran: string; world: string; iranUp: boolean | null; worldUp: boolean | null }, from: "iran" | "world", opts: { geo: boolean; failover: boolean }) {
  const ir = r.iran, w = r.world || r.iran;
  if (!opts.geo || !GEO_TYPES.find((t) => t.id === r.type)?.geo) return ir;
  const [first, second, firstUp] = from === "iran" ? [ir, w, r.iranUp] : [w, ir, r.worldUp];
  return opts.failover && firstUp === false ? second : first;
}
