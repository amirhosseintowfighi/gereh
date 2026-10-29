/* «پایش هوشمند»: robust statistics for the detectors. A baseline is the median and MAD of each metric per hour of the
   week (Tehran time) over the last weeks, with the hour of the day and then the whole window as fallbacks for slots
   with too few points. Pure functions: the tests feed them crafted series. */

export const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const mad = (v: number[], m = median(v)) => median(v.map((x) => Math.abs(x - m)));
export const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
export const std = (v: number[]) => { const m = mean(v); return Math.sqrt(mean(v.map((x) => (x - m) ** 2))); };

/** least squares y = a + b·x with R² (x in hours) */
export function linreg(points: { x: number; y: number }[]) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0 };
  const mx = mean(points.map((p) => p.x)), my = mean(points.map((p) => p.y));
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of points) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

/** hour of the week in Tehran (UTC+3:30): 0 … 167 */
export const hourOfWeek = (t: Date | number) => {
  const d = new Date((typeof t === "number" ? t : t.getTime()) + 3.5 * 3600_000);
  return d.getUTCDay() * 24 + d.getUTCHours();
};

export const METRICS = ["cpu", "ram", "disk", "netIn", "netOut", "ioRead", "ioWrite"] as const;
export type Metric = (typeof METRICS)[number];
export type Point = { at: Date } & Record<Metric, number>;
/** per metric: 168 [median, MAD] pairs, plus the whole-window median and the days covered */
export type Baseline = { days: number; slots: Record<Metric, [number, number][]>; overall: Record<Metric, number>; at: number };

export function buildBaseline(rows: Point[], now = Date.now()): Baseline {
  const days = new Set(rows.map((r) => Math.floor(r.at.getTime() / 86400_000))).size;
  const slots = {} as Baseline["slots"], overall = {} as Baseline["overall"];
  for (const m of METRICS) {
    const byWeek: number[][] = Array.from({ length: 168 }, () => []), byDay: number[][] = Array.from({ length: 24 }, () => []);
    for (const r of rows) { const h = hourOfWeek(r.at); byWeek[h].push(r[m]); byDay[h % 24].push(r[m]); }
    const all = rows.map((r) => r[m]);
    const allMed = median(all), allMad = mad(all, allMed);
    overall[m] = round(allMed);
    slots[m] = byWeek.map((v, h) => {
      const src = v.length >= 2 ? v : byDay[h % 24].length >= 3 ? byDay[h % 24] : all;
      if (!src.length) return [0, 0];
      const med = src === all ? allMed : median(src);
      return [round(med), round(src === all ? allMad : mad(src, med))];
    });
  }
  return { days, slots, overall, at: now };
}
const round = (n: number) => Math.round(n * 100) / 100;

/** the expected value and robust spread for a metric at a time */
export function expected(b: Baseline, m: Metric, at: Date | number) {
  const [med, d] = b.slots[m][hourOfWeek(at)] ?? [b.overall[m], 0];
  return { median: med, sigma: 1.4826 * d };
}
