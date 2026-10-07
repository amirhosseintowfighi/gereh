/* Jalali (Solar Hijri) ⇄ Gregorian. Formatting uses Intl (fa-IR, Asia/Tehran); parsing uses the
   standard jalaali algorithm (Borkowski), valid for years 1–3177. */
import { toEnDigits } from "./format";

export const TZ = "Asia/Tehran";
const fmtDate = new Intl.DateTimeFormat("fa-IR", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtTime = new Intl.DateTimeFormat("fa-IR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "۱۴۰۵/۰۷/۱۵" */
export const faDate = (d: Date | null | undefined) => (d ? fmtDate.format(d) : "—");
/** "۱۴۰۵/۰۷/۱۵ ۰۹:۳۰" */
export const faDateTime = (d: Date | null | undefined) => (d ? fmtDate.format(d) + " " + fmtTime.format(d) : "—");

const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
const div = (a: number, b: number) => ~~(a / b);
const mod = (a: number, b: number) => a - ~~(a / b) * b;

function jalCal(jy: number) {
  const gy = jy + 621;
  let leapJ = -14, jp = breaks[0], jm = 0, jump = 0;
  if (jy < jp || jy >= breaks[breaks.length - 1]) throw new Error("invalid Jalali year " + jy);
  for (let i = 1; i < breaks.length; i++) {
    jm = breaks[i]; jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number) {
  const d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
}
function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
const j2d = (jy: number, jm: number, jd: number) => {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
};

export const isLeapJalali = (jy: number) => jalCal(jy).leap === 0;
const monthLength = (jy: number, jm: number) => (jm <= 6 ? 31 : jm <= 11 ? 30 : isLeapJalali(jy) ? 30 : 29);

export function jalaliToGregorian(jy: number, jm: number, jd: number) {
  if (jm < 1 || jm > 12 || jd < 1 || jd > monthLength(jy, jm)) throw new Error("invalid Jalali date");
  return d2g(j2d(jy, jm, jd));
}

/** Parses "1405/07/15" (Persian or ASCII digits) as the start of that day in Tehran; null if malformed. */
export function parseJalali(raw: string): Date | null {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(toEnDigits(raw.trim()));
  if (!m) return null;
  try {
    const { gy, gm, gd } = jalaliToGregorian(+m[1], +m[2], +m[3]);
    // Iran has used a fixed UTC+03:30 offset since 2022 (no DST)
    return new Date(Date.UTC(gy, gm - 1, gd, 0, 0) - 3.5 * 3600_000);
  } catch {
    return null;
  }
}

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);
export const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
