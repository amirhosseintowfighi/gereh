"use client";
/* Gereh Apps operator tools, part 2: log search and live tail, metric history charts, .env
   import/export and raw editing, and the release history. */
import { useCallback, useEffect, useRef, useState } from "react";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { fa } from "@/lib/format";
import { ENV_KEY_RE, ENV_RESERVED } from "@/lib/paas";
import { LOG_DAYS, LOG_LEVELS, logLevel, METRIC_RANGES, parseDotenv, toDotenv, type LogLevel, type MetricRange } from "@/lib/paas-tools";
import { api, type PaasLogLine, type PaasRelease } from "@/lib/store";
import type { PaasApp } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty } from "../ui";
import { AreaChart, AsyncButton, Select, Switch, Tabs } from "../ui-client";
import { DeployPill } from "./paas-shared";

const LEVEL_TONE: Record<LogLevel, string> = { error: "text-rose-300", warn: "text-amber-200", info: "text-white/85", debug: "text-white/45" };
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/* ================= logs ================= */
export function AppLogsPro({ app }: { app: PaasApp }) {
  const [q, setQ] = useState("");
  const [levels, setLevels] = useState<LogLevel[]>(["error", "warn", "info", "debug"]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [wrap, setWrap] = useState(true);
  const [live, setLive] = useState(false);
  const [lines, setLines] = useState<PaasLogLine[] | null>(null);
  const [more, setMore] = useState<number | null>(null);
  const [days, setDays] = useState(7);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const [applied, setApplied] = useState("");
  const [nonce, setNonce] = useState(0);
  const filters = useCallback(() => ({ q: applied.trim() || undefined, levels: levels.length < 4 ? levels : undefined, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(to).toISOString() : undefined }), [applied, levels, from, to]);
  const show = useCallback((r: Awaited<ReturnType<typeof api.paas.logSearch>>, before?: number) => {
    setError("");
    setDays(r.retentionDays);
    setMore(r.more ? r.cursor : null);
    setLines((cur) => (before ? [...r.lines, ...(cur ?? [])] : r.lines));
    if (!before) requestAnimationFrame(() => box.current?.scrollTo({ top: box.current.scrollHeight }));
  }, []);
  const older = (before: number) => api.paas.logSearch(app.id, { ...filters(), before, limit: 300 }).then((r) => show(r, before), (e: Error) => setError(e.message));
  useEffect(() => {
    let on = true;
    api.paas.logSearch(app.id, { ...filters(), limit: 300 }).then((r) => { if (on) show(r); }, (e: Error) => { if (on) setError(e.message); });
    return () => { on = false; };
  }, [app.id, filters, show, nonce]);
  // live tail: new lines straight from the instances (filtered here)
  useEffect(() => {
    if (!live) return;
    const es = new EventSource("/api/paas/logs/" + app.id + "?tail=1");
    let n = -1;
    es.onmessage = (e) => {
      const got = JSON.parse(e.data) as { at: string; instance: string; line: string }[];
      const ql = applied.trim().toLowerCase();
      const add = got.map((l) => ({ id: n--, at: l.at, instance: l.instance, line: l.line, level: logLevel(l.line) })).filter((l) => (!ql || l.line.toLowerCase().includes(ql)) && levels.includes(l.level));
      if (!add.length) return;
      setLines((cur) => [...(cur ?? []), ...add].slice(-5000));
      requestAnimationFrame(() => box.current?.scrollTo({ top: box.current.scrollHeight }));
    };
    return () => es.close();
  }, [live, app.id, applied, levels]);
  const exportUrl = () => { const f = filters(); const p = new URLSearchParams(); if (f.q) p.set("q", f.q); if (f.levels) p.set("level", f.levels.join(",")); if (f.from) p.set("from", f.from); if (f.to) p.set("to", f.to); return "/api/paas/logs/" + app.id + "?" + p.toString(); };
  const toggle = (l: LogLevel) => setLevels((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));
  return (
    <Card pad="p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); setApplied(q); setNonce((n) => n + 1); }}>
          <label className="sr-only" htmlFor="log-q">جستجو در لاگ</label>
          <input id="log-q" value={q} onChange={(e) => setQ(e.target.value)} dir="ltr" placeholder="search…" className={INPUT + " h-9 w-52 text-left text-xs"} />
          <button type="submit" aria-label="جستجو" className={BTN_G + " h-9 w-9"}><Icon name="search" size={14} /></button>
        </form>
        <span className="flex gap-1" role="group" aria-label="سطح لاگ">
          {LOG_LEVELS.map((l) => <button key={l.id} type="button" aria-pressed={levels.includes(l.id)} onClick={() => toggle(l.id)} className={"h-8 px-2.5 rounded-lg text-[11px] border " + (levels.includes(l.id) ? "border-white/30 bg-white/[0.08] " + LEVEL_TONE[l.id] : "border-white/[0.08] text-white/40")}>{l.label}</button>)}
        </span>
        <label className="text-[11px] text-white/55 flex items-center gap-1">از<input type="datetime-local" value={from} max={localInput(new Date())} onChange={(e) => setFrom(e.target.value)} className={INPUT + " h-8 w-auto text-[11px]"} /></label>
        <label className="text-[11px] text-white/55 flex items-center gap-1">تا<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT + " h-8 w-auto text-[11px]"} /></label>
        <span className="flex items-center gap-1.5 text-[11px] text-white/70 mr-auto"><Switch on={live} onChange={setLive} label="دنبال کردن زنده" />زنده</span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/70"><Switch on={wrap} onChange={setWrap} label="شکستن خطوط" />شکستن خط</span>
        <a href={exportUrl()} className={BTN_G + " h-8 px-3 text-[11px]"}><Icon name="download" size={13} />‎.txt</a>
      </div>
      {error && <p role="alert" className="text-sm text-rose-300 mb-2">{error}</p>}
      <div ref={box} dir="ltr" tabIndex={0} role="log" aria-label="لاگ اپ" className={"text-left text-[12px] leading-6 font-mono bg-black/50 rounded-xl p-4 h-[60vh] overflow-auto " + (wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>
        {more !== null && <button type="button" onClick={() => older(more)} className="text-[11px] acc mb-2">↑ older</button>}
        {lines === null ? "…" : lines.length === 0 ? <span className="text-white/50">{app.status === "running" ? "لاگی با این فیلترها پیدا نشد؛ لاگ‌ها هر ۵ دقیقه جمع‌آوری می‌شوند." : "اپ در حال اجرا نیست."}</span>
          : lines.map((l) => <div key={l.id} className={LEVEL_TONE[l.level]}><span className="text-white/35">{l.at.slice(5, 19).replace("T", " ")} </span>{l.instance && <span className="text-white/30">[{l.instance.slice(-5)}] </span>}{l.line}</div>)}
      </div>
      <p className="text-[11px] text-white/45 mt-2">لاگ‌ها {fa(days)} روز نگه داشته می‌شوند (بسته به پلن). جستجو روی متن کامل خطوط است.</p>
    </Card>
  );
}

/* ================= metrics ================= */
export function AppMetrics({ app }: { app: PaasApp }) {
  const [range, setRange] = useState<MetricRange>("24h");
  const [data, setData] = useState<{ ramLimitMb: number; points: { t: number; cpu: number; ramMb: number; rpm: number; netBytes: number }[] } | null>(null);
  useEffect(() => {
    let live = true;
    api.paas.metrics(app.id, range).then((d) => { if (live) setData(d); }, () => { if (live) setData({ ramLimitMb: 0, points: [] }); });
    return () => { live = false; };
  }, [app.id, range]);
  const p = data?.points ?? [];
  const label = (t: number) => { const d = new Date(t); return range === "1h" || range === "24h" ? d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("fa-IR", { month: "short", day: "numeric" }) + (range === "7d" ? " " + d.toLocaleTimeString("fa-IR", { hour: "2-digit" }) : ""); };
  const labels = p.map((x) => label(x.t));
  const charts: [string, string, number[], string, ((v: number) => string)?][] = [
    ["CPU", "cpu", p.map((x) => x.cpu), "٪"],
    ["حافظه", "memory-stick", p.map((x) => x.ramMb), "مگ"],
    ["ترافیک شبکه", "network", p.map((x) => x.netBytes / 1024 / 1024), "مگ"],
    ["درخواست‌ها", "activity", p.map((x) => x.rpm), "در دقیقه"],
  ];
  return (
    <div>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <Tabs size="sm" label="بازه" value={range} onChange={(v) => setRange(v as MetricRange)} options={(Object.keys(METRIC_RANGES) as MetricRange[]).map((k) => ({ id: k, label: METRIC_RANGES[k].label }))} />
        {data?.ramLimitMb ? <span className="text-[11px] text-white/50">سقف حافظه {fa(data.ramLimitMb)} مگ</span> : null}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {charts.map(([title, icon, values, unit]) => (
          <Card key={title} pad="p-5">
            <div className="flex items-center justify-between mb-3 text-xs text-white/55"><span className="flex items-center gap-2"><Icon name={icon} size={15} className="acc" />{title}</span>
              <span className="tabular">{values.length ? "میانگین " + fa(Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10, 1) + " " + unit : ""}</span></div>
            {data === null ? <div className="h-[140px] grid place-items-center"><Icon name="loader-circle" size={16} className="animate-spin" /></div>
              : values.length > 1 ? <AreaChart data={values} labels={labels} height={140} unit={unit} fmt={(v) => fa(Math.round(v * 10) / 10, 1)} />
              : <div className="h-[140px] grid place-items-center text-[11px] text-white/45">داده‌ای برای این بازه نیست؛ نمونه‌برداری هر ۵ دقیقه انجام می‌شود.</div>}
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ================= env: import / export / raw ================= */
export function EnvBulk({ app }: { app: PaasApp }) {
  const { notify } = useApp();
  const [raw, setRaw] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const locked = new Set(["PORT", ...app.links.map((l) => l.envKey)]);
  const current = app.env.filter((e) => !locked.has(e.key));
  const apply = async (text: string, replace: boolean) => {
    const { vars, errors } = parseDotenv(text);
    if (errors.length) throw new Error("خطوط نامعتبر: " + errors.slice(0, 3).join("، "));
    const bad = vars.find((v) => !ENV_KEY_RE.test(v.key) || ENV_RESERVED.has(v.key) || locked.has(v.key));
    if (bad) throw new Error("متغیر «" + bad.key + "» را نمی‌توان تنظیم کرد.");
    if (vars.length > 100) throw new Error("حداکثر ۱۰۰ متغیر.");
    const secret = new Set(current.filter((e) => e.secret).map((e) => e.key));
    // an empty value on an existing secret keeps it (the raw editor cannot show secrets)
    const set = vars.map((v) => ({ key: v.key, value: v.value, secret: secret.has(v.key) }));
    const remove = replace ? current.filter((e) => !vars.some((v) => v.key === e.key)).map((e) => e.key) : [];
    await api.paas.setEnv(app.id, set, remove);
    notify(fa(set.length) + " متغیر ذخیره شد" + (remove.length ? "، " + fa(remove.length) + " حذف شد" : ""), "check");
  };
  const download = (text: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = app.name + ".env";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <Card title="فایل ‎.env" icon="file-text" className="mt-4" action={<div className="flex flex-wrap gap-2">
      <input ref={file} type="file" accept=".env,text/plain" className="sr-only" aria-label="فایل ‎.env" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { await apply(await f.text(), false); } catch (er) { notify((er as Error).message, "circle-alert"); } }} />
      <button type="button" onClick={() => file.current?.click()} className={BTN_G + " h-9 px-3 text-xs"}><Icon name="upload" size={14} />وارد کردن</button>
      <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} onClick={async () => download(await api.paas.envFile(app.id))}><Icon name="download" size={14} />خروجی ‎.env</AsyncButton>
      <button type="button" aria-expanded={raw !== null} onClick={() => setRaw(raw === null ? toDotenv(current.map((e) => ({ key: e.key, value: e.secret ? "" : e.value ?? "" }))) : null)} className={BTN_G + " h-9 px-3 text-xs"}><Icon name="file-pen" size={14} />ویرایش متنی</button>
    </div>}>
      {raw === null ? <p className="text-xs text-white/55 leading-6">فایل ‎.env را وارد کنید (متغیرهای هم‌نام جایگزین می‌شوند)، از همه متغیرها (با مقدار محرمانه‌ها؛ ثبت می‌شود) خروجی بگیرید، یا همه را یک‌جا به‌صورت متن ویرایش کنید.</p> : (
        <div>
          <label className="sr-only" htmlFor="env-raw">متغیرها به‌صورت متن</label>
          <textarea id="env-raw" value={raw} onChange={(e) => setRaw(e.target.value)} dir="ltr" spellCheck={false} rows={14} className={TEXTAREA + " font-mono text-xs leading-6 text-left resize-y"} />
          <p className="text-[11px] text-white/50 mt-1">هر خط KEY=value. مقدار خالی برای متغیر محرمانه یعنی بدون تغییر؛ خط‌هایی که حذف کنید، متغیرشان حذف می‌شود.</p>
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setRaw(null)} className={BTN_G + " h-10 px-4 text-sm"}>انصراف</button>
            <AsyncButton className={BTN_P + " h-10 px-4 text-sm"} onClick={async () => { await apply(raw, true); setRaw(null); }}>ذخیره و اعمال</AsyncButton>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ================= releases ================= */
export function AppReleases({ app }: { app: PaasApp }) {
  const [list, setList] = useState<PaasRelease[] | null>(null);
  useEffect(() => {
    let live = true;
    api.paas.releases(app.id).then((l) => { if (live) setList(l); }, () => { if (live) setList([]); });
    return () => { live = false; };
  }, [app.id, app.liveDeployment]);
  const builds = (list ?? []).filter((r) => r.image || r.source || r.commitUrl);
  return (
    <Card title="تاریخچه نسخه‌ها" icon="git-commit-horizontal" className="mt-4" pad="p-3 sm:p-4">
      {list === null ? <p className="text-sm text-white/55 p-2">…</p> : builds.length === 0 ? <Empty icon="git-commit-horizontal" title="هنوز نسخه‌ای ساخته نشده" /> : (
        <ul className="divide-y divide-white/[0.06]">
          {builds.map((r) => (
            <li key={r.id} className="p-3 flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2"><DeployPill s={r.status} />{r.live && <Badge tone="green">فعال</Badge>}{r.target === "preview" && <Badge tone="blue">پیش‌نمایش</Badge>}<span className="text-sm truncate max-w-md">{r.message || "—"}</span></span>
                <span className="block text-[11px] text-white/50 mt-1">{r.at}{r.branch ? " · شاخه " : ""}<span dir="ltr">{r.branch}</span>{r.ref ? " · " : ""}<span dir="ltr" className="font-mono">{r.ref.slice(0, 12)}</span>{r.seconds !== null ? " · " + fa(r.seconds) + " ثانیه" : ""}</span>
              </span>
              <span className="flex gap-2">
                {r.commitUrl && <a href={r.commitUrl} target="_blank" rel="noopener noreferrer" className={BTN_G + " h-8 px-3 text-xs"}><Icon name="external-link" size={13} />کامیت</a>}
                {r.source ? <a href={r.source} className={BTN_G + " h-8 px-3 text-xs"}><Icon name="download" size={13} />سورس</a>
                  : r.archiveUrl ? <a href={r.archiveUrl} target="_blank" rel="noopener noreferrer" className={BTN_G + " h-8 px-3 text-xs"}><Icon name="download" size={13} />سورس</a> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ================= staff: log retention per plan ================= */
export function PlanLogRetention() {
  const { notify } = useApp();
  const [rows, setRows] = useState<{ id: string; name: string; logDays: number }[] | null>(null);
  useEffect(() => { void api.paas.adminLogDays().then(setRows).catch(() => setRows([])); }, []);
  return (
    <Card title="نگهداری لاگ پلن‌های اپ" icon="scroll-text" className="lg:col-span-2" pad="p-3 sm:p-4">
      {!rows ? <p className="text-sm text-white/55 p-2">…</p> : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1">{rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 p-2">
            <span className="text-sm">{r.name} <span className="text-[11px] text-white/45">{r.id}</span></span>
            <Select label={"نگهداری لاگ " + r.name} value={String(r.logDays)} onChange={async (v) => { await api.paas.adminSetLogDays(r.id, Number(v)); setRows(rows.map((x) => (x.id === r.id ? { ...x, logDays: Number(v) } : x))); notify("ذخیره شد", "check"); }}
              options={LOG_DAYS.map((d) => ({ value: String(d), label: fa(d) + " روز" }))} />
          </li>
        ))}</ul>
      )}
    </Card>
  );
}
