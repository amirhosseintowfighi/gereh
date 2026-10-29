/* «پایش هوشمند»: the detectors. Pure functions over a resource's recent 5-minute samples, its hour-of-week baseline
   (./stats.ts) and its hourly rollups; each returns which detectors had enough data to run and the hits, with severity,
   confidence and evidence (numbers, the time window and a chart with the baseline band). Thresholds live in
   MONITOR_RULES (src/lib/monitor.ts); sensitivity scales them. A resource younger than newResourceDays, or without
   enough history for a baseline, is judged on static thresholds (the baseline-only detectors do not run); a young
   resource raises critical incidents only. */
import { MINER_NAMES, MONITOR_RULES as R, type Detector, type MonitorEvidence, type MonitorSeries, type Sensitivity, type Severity } from "@/lib/monitor";
import { fa } from "@/lib/format";
import { expected, linreg, mean, std, type Baseline, type Point } from "./stats";

const H = 3600_000, MIN = 60_000, DAY = 86400_000;
export type Hit = { detector: Detector; severity: Severity; confidence: number; title: string; evidence: MonitorEvidence; abuse?: boolean };
export type Result = { ran: Detector[]; hits: Hit[] };

const clock = (d: Date | number) => new Date(d).toLocaleTimeString("fa-IR", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hour12: false });
const dayClock = (d: Date | number) => new Date(d).toLocaleString("fa-IR", { timeZone: "Asia/Tehran", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const n1 = (v: number) => fa(Math.round(v * 10) / 10, Math.abs(v) < 10 && Math.round(v * 10) % 10 ? 1 : 0);
const pct = (v: number) => fa(Math.round(v)) + "٪";
const span = (w: { at: Date }[]) => "از " + clock(w[0].at) + " تا " + clock(w[w.length - 1].at);
const conf = (v: number) => Math.round(Math.min(0.99, v) * 100) / 100;
const within = <T extends { at: Date }>(rows: T[], now: number, ms: number) => rows.filter((r) => r.at.getTime() > now - ms && r.at.getTime() <= now + MIN);

/** the samples as a chart, with the baseline band (median ± 3σ) when there is one */
function series(w: Point[], m: keyof Point & ("cpu" | "netOut" | "netIn" | "ioWrite" | "ram" | "disk"), label: string, unit: string, b: Baseline | null): MonitorSeries {
  const band = b ? w.map((p) => expected(b, m, p.at)) : null;
  return {
    label, unit, data: w.map((p) => Math.round(p[m] * 10) / 10), labels: w.map((p) => clock(p.at)),
    ...(band ? { lo: band.map((e) => Math.max(0, Math.round((e.median - 3 * e.sigma) * 10) / 10)), hi: band.map((e) => Math.round((e.median + 3 * e.sigma) * 10) / 10) } : {}),
  };
}
function trendSeries(rows: { at: Date; v: number }[], label: string, unit: string): MonitorSeries {
  return { label, unit, data: rows.map((r) => Math.round(r.v * 10) / 10), labels: rows.map((r) => dayClock(r.at)) };
}

/* ---------------- shared trend detectors ---------------- */
export function leakOf(rows: { at: Date; v: number }[], k: number, current?: number): Omit<Hit, "title"> | null | undefined {
  const r = R.leak;
  if (rows.length < r.minHours || rows[rows.length - 1].at.getTime() - rows[0].at.getTime() < (r.minHours - 1) * H) return undefined;
  const t0 = rows[0].at.getTime();
  const fit = linreg(rows.map((p) => ({ x: (p.at.getTime() - t0) / H, y: p.v })));
  const diffs = rows.slice(1).map((p, i) => p.v - rows[i].v);
  const up = diffs.filter((d) => d >= -1).length / Math.max(1, diffs.length);
  const now = current ?? rows[rows.length - 1].v, rise = rows[rows.length - 1].v - rows[0].v;
  if (fit.slope <= 0 || fit.r2 < r.minR2 || up < r.monotonic || rise < r.minRise * k || now >= r.target) return null;
  const eta = (r.target - now) / fit.slope;
  if (eta > r.etaHours / k) return null;
  const hours = Math.round((rows[rows.length - 1].at.getTime() - t0) / H);
  return {
    detector: "memory_leak", severity: eta <= r.criticalEta ? "critical" : "warn", confidence: conf(0.5 + 0.4 * fit.r2 + (up > 0.95 ? 0.05 : 0)),
    evidence: {
      lines: [
        "مصرف رم در " + fa(hours) + " ساعت اخیر پیوسته بالا رفته است: از " + pct(rows[0].v) + " به " + pct(now) + " (حدود " + n1(fit.slope) + " واحد درصد در ساعت).",
        "با همین روند، حدود " + fa(Math.round(eta)) + " ساعت دیگر رم به " + pct(r.target) + " می‌رسد و سیستم‌عامل پردازه‌ها را می‌کشد (OOM).",
      ],
      series: trendSeries(rows, "مصرف رم", "٪"), etaHours: Math.round(eta),
    },
  };
}
export function diskOf(rows: { at: Date; v: number }[], k: number): Omit<Hit, "title"> | null | undefined {
  const r = R.disk;
  if (rows.length < r.minHours || rows[rows.length - 1].at.getTime() - rows[0].at.getTime() < (r.minHours - 1) * H) return undefined;
  const t0 = rows[0].at.getTime();
  const fit = linreg(rows.map((p) => ({ x: (p.at.getTime() - t0) / H, y: p.v })));
  const now = rows[rows.length - 1].v, rise = now - rows[0].v;
  if (fit.slope <= 0 || fit.r2 < r.minR2 || rise < r.minRise * k || now >= 100) return null;
  const eta = (100 - now) / fit.slope;
  if (eta > r.etaWarn / k) return null;
  const hours = Math.round((rows[rows.length - 1].at.getTime() - t0) / H);
  return {
    detector: "disk_fill", severity: eta <= r.etaCritical ? "critical" : "warn", confidence: conf(0.5 + 0.45 * fit.r2),
    evidence: {
      lines: [
        "دیسک در " + fa(hours) + " ساعت اخیر از " + pct(rows[0].v) + " به " + pct(now) + " رسیده است (حدود " + n1(fit.slope) + " واحد درصد در ساعت).",
        "با همین روند، حدود " + fa(Math.round(eta)) + " ساعت دیگر دیسک کاملاً پر می‌شود؛ پایگاه داده و لاگ‌ها از کار می‌افتند.",
      ],
      series: trendSeries(rows, "مصرف دیسک", "٪"), etaHours: Math.round(eta),
    },
  };
}

/* ---------------- cloud servers ---------------- */
export type ServerInput = {
  name: string; createdAt: Date; now: number; sensitivity: Sensitivity;
  /** 5-minute samples of the last ~2.5 hours, oldest first ([] when nothing new arrived) */
  samples: Point[];
  baseline: Baseline | null;
  /** hourly rollups of the last 72 hours, oldest first; null when the trend detectors are not due this round */
  hourly: Point[] | null;
  /** this month's traffic: GB used, the quota (0 = unlimited) and the hours elapsed / left */
  traffic: { usedGb: number; quota: number; autoBuy: boolean; elapsedHours: number; leftHours: number } | null;
  /** the server stopped and nobody asked for it */
  downSince: Date | null;
};

export const isYoung = (createdAt: Date, now: number) => now - createdAt.getTime() < R.newResourceDays * DAY;
export const isStatic = (createdAt: Date, now: number, b: Baseline | null) => isYoung(createdAt, now) || !b || b.days < R.baselineMinDays;

export function detectServer(s: ServerInput): Result {
  const k = R.sensitivity[s.sensitivity];
  const ran: Detector[] = ["service_down"], hits: Hit[] = [];
  const st = isStatic(s.createdAt, s.now, s.baseline), young = isYoung(s.createdAt, s.now);
  const b = st ? null : s.baseline;
  const add = (h: Omit<Hit, "title">, title: string) => hits.push({ ...h, title });

  if (s.downSince) add({ detector: "service_down", severity: "critical", confidence: 0.8, evidence: { lines: ["سرور از " + dayClock(s.downSince) + " خاموش است، بدون اینکه شما یا اعضای تیم آن را خاموش کرده باشید.", "ممکن است سیستم‌عامل از کار افتاده (kernel panic)، رم تمام شده یا سرور از داخل خاموش شده باشد."] } }, "سرور «" + s.name + "» به‌طور غیرمنتظره خاموش شد");

  /* 1. crypto-miner: flat, sustained high CPU on a server that normally idles, with little IO and network */
  const m = R.miner;
  const w2 = within(s.samples, s.now, m.hours * H);
  if (w2.length >= Math.floor((m.hours * 60 / 5) * m.coverage)) {
    ran.push("miner");
    const cpus = w2.map((p) => p.cpu), sd = std(cpus);
    const hot = cpus.filter((c) => c > (st ? m.staticCpu : m.cpu)).length / cpus.length;
    const io = mean(w2.map((p) => p.ioRead + p.ioWrite)), out = mean(w2.map((p) => p.netOut));
    const ioBase = b ? b.overall.ioRead + b.overall.ioWrite : 0, netBase = b ? b.overall.netOut : 0;
    const quietIo = io <= Math.max(m.ioRatio * ioBase, 2000), quietNet = out <= Math.max(m.ioRatio * netBase, m.netFloor);
    const slotCpu = b ? mean(w2.map((p) => expected(b, "cpu", p.at).median)) : 0;
    const lowBase = !b || (b.overall.cpu < m.baselineMax / k && slotCpu < 50 / k);
    if (hot >= 0.95 && sd < m.maxStd / k && quietIo && quietNet && lowBase) {
      add({
        detector: "miner", severity: "critical", confidence: conf(st ? 0.6 : 0.75 + (sd < 3 ? 0.1 : 0) + (b && b.overall.cpu < 15 ? 0.05 : 0)),
        evidence: {
          lines: [
            "CPU " + span(w2) + " به‌طور پیوسته بالای " + pct(st ? m.staticCpu : m.cpu) + " بوده است (میانگین " + pct(mean(cpus)) + "، نوسان فقط " + n1(sd) + " واحد).",
            b ? "در حالت عادی CPU این سرور حدود " + pct(b.overall.cpu) + " است؛ این الگوی صاف و طولانی با خواندن و نوشتن کم دیسک (" + fa(Math.round(io)) + " KB/s) و ترافیک خروجی کم (" + n1(out) + " Mb/s) شبیه استخراج رمزارز است." : "سرور تازه است و پایه مصرف ندارد؛ این الگوی صاف و طولانی با دیسک و شبکه آرام شبیه استخراج رمزارز است.",
          ],
          series: series(w2, "cpu", "مصرف CPU", "٪", b),
        },
      }, "CPU سرور «" + s.name + "» مدام در حداکثر است (احتمال استخراج رمزارز)");
    }
  }

  /* 2. outbound abuse and 3. inbound attack: the last 15 minutes against the hour-of-week baseline */
  const w15 = within(s.samples, s.now, R.outbound.minutes * MIN);
  if (w15.length >= 3) {
    ran.push("outbound_abuse");
    const o = R.outbound;
    const out = mean(w15.map((p) => p.netOut)), inn = mean(w15.map((p) => p.netIn));
    const exp = b ? mean(w15.map((p) => expected(b, "netOut", p.at).median)) : 0;
    const ratio = out / Math.max(0.1, inn);
    const over = b ? w15.every((p) => p.netOut > Math.max(o.ratio * k * expected(b, "netOut", p.at).median, o.floorMbps * k)) : w15.every((p) => p.netOut > o.staticFloorMbps * k) && ratio >= o.outInRatio;
    if (over) add({
      detector: "outbound_abuse", severity: "critical", abuse: true, confidence: conf(b ? (ratio >= o.outInRatio ? 0.9 : 0.72) : 0.6),
      evidence: {
        lines: [
          "ترافیک خروجی " + span(w15) + " به‌طور میانگین " + n1(out) + " Mb/s بوده است" + (b ? "؛ حالت عادی این ساعت حدود " + n1(exp) + " Mb/s است." : "."),
          "ترافیک ورودی در همین زمان " + n1(inn) + " Mb/s بوده است؛ ارسال بسیار بیشتر از دریافت معمولاً یعنی حمله از روی سرور (DDoS)، ارسال اسپم یا اسکن شبکه، و می‌تواند IPهای گره را در فهرست سیاه قرار دهد.",
        ],
        series: series(w15, "netOut", "ترافیک خروجی", "Mb/s", b),
      },
    }, "ترافیک خروجی غیرعادی از سرور «" + s.name + "»");

    if (b) {
      ran.push("inbound_attack");
      const i = R.inbound;
      const cpu = mean(w15.map((p) => p.cpu)), cpuExp = mean(w15.map((p) => expected(b, "cpu", p.at).median));
      const expIn = mean(w15.map((p) => expected(b, "netIn", p.at).median));
      const flood = w15.every((p) => p.netIn > Math.max(i.ratio * k * expected(b, "netIn", p.at).median, i.floorMbps * k));
      if (flood && cpu >= Math.min(i.cpuHigh, cpuExp + i.cpuRise * k)) add({
        detector: "inbound_attack", severity: cpu > 95 ? "critical" : "warn", confidence: conf(0.65 + (cpu > 90 ? 0.15 : 0)),
        evidence: {
          lines: [
            "ترافیک ورودی " + span(w15) + " به‌طور میانگین " + n1(inn) + " Mb/s بوده است؛ حالت عادی این ساعت حدود " + n1(expIn) + " Mb/s است.",
            "هم‌زمان CPU به " + pct(cpu) + " رسیده است (عادی: " + pct(cpuExp) + ")؛ این الگو با حمله DDoS یا هجوم ربات‌ها سازگار است.",
          ],
          series: series(w15, "netIn", "ترافیک ورودی", "Mb/s", b),
        },
      }, "هجوم ترافیک ورودی به سرور «" + s.name + "»");
    }
  }

  /* 8. unusual disk writes */
  const w30 = within(s.samples, s.now, R.io.minutes * MIN);
  if (b && w30.length >= 5) {
    ran.push("unusual_io");
    const io = R.io;
    const wr = mean(w30.map((p) => p.ioWrite)), exp = mean(w30.map((p) => expected(b, "ioWrite", p.at).median));
    if (w30.every((p) => p.ioWrite > Math.max(io.ratio * k * expected(b, "ioWrite", p.at).median, io.floorKBs * k))) add({
      detector: "unusual_io", severity: "warn", confidence: 0.7,
      evidence: {
        lines: [
          "نوشتن روی دیسک " + span(w30) + " به‌طور میانگین " + fa(Math.round(wr)) + " KB/s بوده است؛ حالت عادی این ساعت حدود " + fa(Math.round(exp)) + " KB/s است.",
          "نوشتن سنگین و طولانی می‌تواند از یک پردازه خارج از کنترل، لاگ بی‌پایان یا در بدترین حالت باج‌افزار (رمزگذاری فایل‌ها) باشد.",
        ],
        series: series(w30, "ioWrite", "نوشتن دیسک", "KB/s", b),
      },
    }, "نوشتن غیرعادی روی دیسک سرور «" + s.name + "»");
  }

  /* 5, 6 and 4: the hourly trends (once an hour) */
  if (s.hourly) {
    const ram = s.hourly.slice(-R.leak.hours).map((p) => ({ at: p.at, v: p.ram }));
    const leak = leakOf(ram, k, s.samples.length ? s.samples[s.samples.length - 1].ram : undefined);
    if (leak !== undefined) { ran.push("memory_leak"); if (leak) add(leak, "احتمال نشت حافظه در سرور «" + s.name + "»"); }
    const disk = diskOf(s.hourly.slice(-R.disk.hours).map((p) => ({ at: p.at, v: p.disk })), k);
    if (disk !== undefined) { ran.push("disk_fill"); if (disk) add(disk, "دیسک سرور «" + s.name + "» به‌زودی پر می‌شود"); }
    const tr = s.traffic, t = R.traffic;
    if (tr && tr.quota > 0 && tr.elapsedHours >= t.minElapsedDays * 24) {
      const recent = s.hourly.slice(-t.recentHours);
      if (recent.length >= t.recentHours / 2) {
        ran.push("traffic_burn");
        // Mb/s averaged over an hour → GB in that hour
        const rate = mean(recent.map((p) => p.netIn + p.netOut)) * 0.45, avg = tr.usedGb / tr.elapsedHours;
        const projected = tr.usedGb + rate * tr.leftHours, before = tr.usedGb + avg * tr.leftHours;
        if (projected > tr.quota && before <= tr.quota && rate >= t.rateJump * k * avg) add({
          detector: "traffic_burn", severity: tr.autoBuy ? "info" : "warn", confidence: 0.7,
          evidence: {
            lines: [
              "سرعت مصرف ترافیک در " + fa(t.recentHours) + " ساعت اخیر حدود " + n1(rate) + " گیگ در ساعت است؛ میانگین این ماه " + n1(avg) + " گیگ در ساعت بوده است.",
              "تا امروز " + fa(Math.round(tr.usedGb)) + " گیگ مصرف شده و با سرعت فعلی تا پایان ماه حدود " + fa(Math.round(projected)) + " گیگ می‌شود؛ سهمیه " + fa(tr.quota) + " گیگ است.",
              tr.autoBuy ? "خرید خودکار بسته ترافیک روشن است؛ با رسیدن به سقف، بسته خودکار خریده می‌شود." : "خرید خودکار خاموش است؛ با رسیدن به سقف، سرعت شبکه سرور محدود می‌شود.",
            ],
            series: trendSeries(recent.map((p) => ({ at: p.at, v: p.netIn + p.netOut })), "ترافیک ورودی و خروجی", "Mb/s"),
          },
        }, "ترافیک سرور «" + s.name + "» ناگهان زیاد شده است");
      }
    }
  }
  return { ran, hits: young ? hits.filter((h) => h.severity === "critical") : hits };
}

/** a process list → the known miner names in it */
export function minerProcesses(procs: { command: string; user?: string }[]) {
  return procs.filter((p) => MINER_NAMES.some((n) => p.command.toLowerCase().includes(n))).map((p) => p.command.slice(0, 120));
}

/* ---------------- Gereh Apps ---------------- */
export type AppInput = {
  name: string; createdAt: Date; now: number; sensitivity: Sensitivity;
  /** 5-minute metrics of the last ~2.5 hours, oldest first; cpu in % of the plan */
  metrics: { at: Date; cpu: number; ramMb: number; rpm: number }[];
  /** whole-window CPU median of the hourly metrics and the days they cover */
  cpuBaseline: { median: number; days: number } | null;
  hourly: { at: Date; cpu: number; ramMb: number }[] | null;
  /** RAM of all instances (MB) */
  ramMb: number;
  /** crash / oom / health_failed of the last hour, oldest first */
  events: { id: number; kind: string; at: Date; message: string }[];
  /** auth failures in the app's logs over the brute-force window; null = no logs collected */
  authFailures: number | null;
};

export function detectApp(a: AppInput): Result {
  const k = R.sensitivity[a.sensitivity];
  const ran: Detector[] = ["service_down"], hits: Hit[] = [];
  const young = isYoung(a.createdAt, a.now), st = young || !a.cpuBaseline || a.cpuBaseline.days < R.baselineMinDays;
  const add = (h: Omit<Hit, "title">, title: string) => hits.push({ ...h, title });

  /* 7. crash loop / flapping */
  const f = R.flap;
  const ev = a.events.filter((e) => e.at.getTime() > a.now - f.windowMinutes * MIN);
  const ooms = ev.filter((e) => e.kind === "oom").length;
  if (ev.length >= Math.max(2, Math.round(f.warn * k))) {
    const last = ev[ev.length - 1];
    const kinds = (["crash", "oom", "health_failed"] as const).map((x) => [x, ev.filter((e) => e.kind === x).length] as const).filter(([, c]) => c);
    const fa_: Record<string, string> = { crash: "توقف ناگهانی", oom: "کمبود حافظه (OOM)", health_failed: "شکست بررسی سلامت" };
    add({
      detector: "service_down", severity: ev.length >= Math.round(f.critical * k) || ooms >= 3 ? "critical" : "warn", confidence: 0.9,
      evidence: {
        lines: [
          "اپ در " + fa(f.windowMinutes) + " دقیقه اخیر " + fa(ev.length) + " بار از کار افتاده و دوباره راه‌اندازی شده است: " + kinds.map(([x, c]) => fa_[x] + " " + fa(c) + " بار").join("، ") + ".",
          "آخرین مورد (" + clock(last.at) + "): " + last.message.slice(0, 160),
        ],
        eventId: last.id,
      },
    }, "اپ «" + a.name + "» پشت سر هم از کار می‌افتد");
  }

  /* 1. a miner inside a container: flat full CPU with no requests, on an app that normally idles */
  const m = R.miner;
  const w2 = within(a.metrics, a.now, m.hours * H);
  if (w2.length >= Math.floor((m.hours * 60 / 5) * m.coverage)) {
    ran.push("miner");
    const cpus = w2.map((p) => p.cpu), sd = std(cpus), rpm = mean(w2.map((p) => p.rpm));
    const hot = cpus.filter((c) => c > (st ? m.staticCpu : m.cpu)).length / cpus.length;
    if (hot >= 0.95 && sd < m.maxStd / k && rpm < 5 && (st || a.cpuBaseline!.median < m.baselineMax / k)) add({
      detector: "miner", severity: "critical", confidence: conf(st ? 0.55 : 0.7),
      evidence: {
        lines: [
          "CPU اپ " + span(w2) + " به‌طور پیوسته بالای " + pct(st ? m.staticCpu : m.cpu) + " سهم پلن بوده است (نوسان " + n1(sd) + " واحد) در حالی که فقط " + n1(rpm) + " درخواست در دقیقه رسیده است.",
          a.cpuBaseline && !st ? "در حالت عادی CPU این اپ حدود " + pct(a.cpuBaseline.median) + " است؛ مصرف کامل و صاف بدون درخواست شبیه یک پردازه استخراج رمزارز یا حلقه بی‌پایان است." : "مصرف کامل و صاف بدون درخواست شبیه یک پردازه استخراج رمزارز یا حلقه بی‌پایان است.",
        ],
        series: { label: "مصرف CPU", unit: "٪", data: cpus.map((c) => Math.round(c * 10) / 10), labels: w2.map((p) => clock(p.at)) },
      },
    }, "CPU اپ «" + a.name + "» بدون درخواست در حداکثر است");
  }

  /* 5. memory leak (RAM as % of the plan) */
  if (a.hourly && a.ramMb > 0) {
    const rows = a.hourly.slice(-R.leak.hours).map((p) => ({ at: p.at, v: (p.ramMb / a.ramMb) * 100 }));
    const cur = a.metrics.length ? (a.metrics[a.metrics.length - 1].ramMb / a.ramMb) * 100 : undefined;
    const leak = leakOf(rows, k, cur);
    if (leak !== undefined) { ran.push("memory_leak"); if (leak) add(leak, "احتمال نشت حافظه در اپ «" + a.name + "»"); }
  }

  /* 9. brute force: a burst of auth failures in the app's own logs */
  if (a.authFailures !== null) {
    ran.push("brute_force");
    const b = R.brute;
    if (a.authFailures >= b.warn * k) add({
      detector: "brute_force", severity: a.authFailures >= b.critical * k ? "critical" : "warn", confidence: 0.75,
      evidence: { lines: [fa(a.authFailures) + " خطای ورود (رمز اشتباه، کاربر نامعتبر یا پاسخ 401) در " + fa(b.windowMinutes) + " دقیقه اخیر در لاگ‌های اپ ثبت شده است.", "این حجم خطا معمولاً یعنی رباتی در حال حدس زدن رمز کاربران یا مدیر است."] },
    }, "تلاش برای حدس رمز در اپ «" + a.name + "»");
  }
  return { ran, hits: young ? hits.filter((h) => h.severity === "critical") : hits };
}
