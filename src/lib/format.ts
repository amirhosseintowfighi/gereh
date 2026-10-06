export const fa = (n: number | string, d = 0) =>
  Number(n).toLocaleString("fa-IR", { minimumFractionDigits: d, maximumFractionDigits: d });
export const toman = (n: number) => fa(n) + " تومان";
export const roundK = (n: number) => Math.round(n / 1000) * 1000;

/** Persian/Arabic digits → ASCII, so inputs typed on a Persian keyboard still validate. */
export const toEnDigits = (s: string) =>
  s.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));

export const hashStr = (s: string) => {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
};

export function strength(p: string) {
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return s;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_RE = /^09\d{9}$/;

export const nowFa = () => new Date().toLocaleDateString("fa-IR", { year: "numeric", month: "2-digit", day: "2-digit" });
export const nowTime = () => new Date().toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
