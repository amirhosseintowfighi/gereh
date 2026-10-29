"use client";
/* «پایش هوشمند»: the panel page, the dashboard widget, the badge on server and app pages, and the staff card and page
   (src/server/monitor). Actions send only the incident id, the action id, a confirm and, for disruptive ones, the
   typed resource name; the server derives the rest. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DETECTOR_LABEL, MONITOR, SENSITIVITY_LABEL, SEVERITY_LABEL, type ChannelPrefs, type IncidentView, type MonitorActionView, type MonitorAdminIncident, type MonitorAdminStats, type MonitorBadge, type MonitorBrief, type MonitorReport, type ResourceKind, type ResourceSetting, type Sensitivity, type Severity } from "@/lib/monitor";
import { monitorApi } from "@/lib/monitor-api";
import { BTN_D, BTN_G, BTN_P, BTN_SM } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty } from "../ui";
import { AreaChart, AsyncButton, Bars, PageTitle, Select, StatCard, Switch, Tabs } from "../ui-client";
import { ExplainButton } from "./explain";

const SEV: Record<Severity, ["red" | "amber" | "blue", string]> = { critical: ["red", "بحرانی"], warn: ["amber", "هشدار"], info: ["blue", "اطلاع"] };
const STATUS_FA: Record<string, string> = { open: "باز", muted: "بی‌صدا", resolved: "برطرف شد", false_positive: "هشدار اشتباه" };
const MUTE_OPTS = [{ value: "1", label: "۱ ساعت" }, { value: "4", label: "۴ ساعت" }, { value: "24", label: "۲۴ ساعت" }, { value: "72", label: "۳ روز" }];

export function MonitorPage() {
  const [data, setData] = useState<MonitorReport | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("open");
  const load = useCallback(() => monitorApi.report().then((r) => { setData(r); setError(""); }).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); const t = setInterval(() => { void load(); }, 60_000); return () => clearInterval(t); }, [load]);
  return (
    <div>
      <PageTitle title={MONITOR.name} sub="رفتار غیرعادی سرورها و اپ‌ها را زود می‌بینیم (حمله، استخراج رمزارز، نشت حافظه، پر شدن دیسک، از کار افتادن) و با زبان ساده می‌گوییم چه کنید." />
      {error ? <div role="alert" className="rounded-xl border border-rose-300/30 bg-rose-400/[0.07] p-4 text-sm text-rose-200">{error}</div>
        : !data ? <div role="status" className="py-16 grid place-items-center text-sm text-white/60"><Icon name="loader-circle" size={22} className="animate-spin acc" /><span className="mt-3">در حال خواندن رخدادها…</span></div>
        : <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-4">
            <StatCard icon="shield-alert" label="رخدادهای باز" value={data.open.length} tone={data.open.length ? "down" : ""} />
            <StatCard icon="triangle-alert" label="بحرانی" value={data.open.filter((i) => i.severity === "critical").length} tone={data.open.some((i) => i.severity === "critical") ? "down" : ""} />
            <StatCard icon="history" label="۳۰ روز اخیر" value={data.history.length} sub="برطرف‌شده یا اشتباه" />
            <StatCard icon="radar" label="آخرین بررسی" value={data.scannedAt || "—"} sub="هر ۵ دقیقه" />
          </div>
          <div className="mb-4"><Tabs size="sm" value={tab} onChange={setTab} label="بخش‌های پایش" options={[{ id: "open", label: "رخدادهای باز", icon: "shield-alert" }, { id: "history", label: "تاریخچه", icon: "history" }, { id: "settings", label: "تنظیمات", icon: "settings-2" }]} /></div>
          {tab === "open" && (data.open.length === 0
            ? <Card><Empty icon="shield-check" title="همه چیز عادی است" text="رخداد بازی روی سرورها و اپ‌های شما نیست. هر ۵ دقیقه دوباره بررسی می‌کنیم." /></Card>
            : <section aria-label="رخدادهای باز" className="space-y-4">{data.open.map((i) => <IncidentCard key={i.id} i={i} onDone={load} />)}</section>)}
          {tab === "history" && (data.history.length === 0 ? <Card><Empty icon="history" title="تاریخچه‌ای نیست" /></Card>
            : <section aria-label="تاریخچه" className="space-y-3">{data.history.map((i) => <IncidentCard key={i.id} i={i} onDone={load} compact />)}</section>)}
          {tab === "settings" && <MonitorSettings data={data} reload={load} />}
        </>}
    </div>
  );
}

function IncidentCard({ i, onDone, compact = false }: { i: IncidentView; onDone: () => unknown; compact?: boolean }) {
  const { notify } = useApp();
  const [open, setOpen] = useState(!compact);
  const live = i.status === "open" || i.status === "muted";
  const s = i.evidence.series;
  return (
    <article className={"rounded-2xl border p-4 sm:p-5 min-w-0 " + (i.severity === "critical" && live ? "border-rose-300/30 bg-rose-400/[0.05]" : "border-white/[0.09] bg-white/[0.03]")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEV[i.severity][0]}>{SEV[i.severity][1]}</Badge>
        <Badge tone="gray">{i.label}</Badge>
        {i.abuse && <Badge tone="red">خطر برای IPهای گره</Badge>}
        {i.status !== "open" && <Badge tone="gray">{STATUS_FA[i.status]}{i.status === "muted" && i.mutedUntil ? " تا " + i.mutedUntil : ""}</Badge>}
        <span className="text-[11px] text-white/45 ms-auto">اطمینان {fa(Math.round(i.confidence * 100))}٪ · از {i.startedAt}{i.resolvedAt ? " تا " + i.resolvedAt : ""}</span>
      </div>
      <button type="button" className="mt-2 text-right w-full" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <h3 className="font-bold text-[15px] leading-7">{i.title}</h3>
      </button>
      <Link href={i.resource.href as never} className="text-xs acc ltr inline-block">{i.resource.name}</Link>
      {open && (
        <div className="mt-3 space-y-3">
          <ul className="text-xs text-white/65 leading-6 space-y-1 list-disc ps-4">{i.evidence.lines.map((l, k) => <li key={k} className="[overflow-wrap:anywhere]">{l}</li>)}</ul>
          {s && s.data.length > 1 && (
            <div aria-label={s.label}>
              <div className="flex flex-wrap gap-3 text-[10px] text-white/50 mb-1"><span>{s.label} ({s.unit})</span>{s.lo && <span className="text-emerald-200/80">نوار سبز: محدوده عادی همین ساعت در هفته‌های اخیر</span>}</div>
              <AreaChart data={s.data} labels={s.labels} unit={s.unit} height={90} band={s.lo && s.hi ? { lo: s.lo, hi: s.hi } : undefined} />
            </div>
          )}
          {i.explanation && (
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.07] p-3">
              <div className="flex items-center gap-2 mb-1.5 text-[11px] text-white/50"><Icon name="sparkles" size={12} />{i.explanationAi ? "توضیح با AI (اعداد از داده‌های واقعی بررسی شده)" : "توضیح"}</div>
              <p className="text-sm leading-7 text-white/85 whitespace-pre-line">{i.explanation}</p>
            </div>
          )}
          {i.taken.length > 0 && <ul className="text-[11px] text-white/50 space-y-0.5">{i.taken.map((t, k) => <li key={k}>✓ {t.label} — {t.at}</li>)}</ul>}
          {live && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {i.actions.map((a) => <ActionButton key={a.id} i={i} a={a} onDone={onDone} />)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.06] mt-2">
            {live && <Select label="بی‌صدا کردن" value="" onChange={async (v) => { if (!v) return; await monitorApi.mute(i.id, Number(v)); notify("اعلان‌های این رخداد بی‌صدا شد."); await onDone(); }} options={[{ value: "", label: i.status === "muted" ? "بی‌صدا تا " + i.mutedUntil : "بی‌صدا کردن…" }, ...MUTE_OPTS]} className="max-w-[170px]" />}
            {i.status === "muted" && <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { await monitorApi.mute(i.id, 0); await onDone(); }}><Icon name="bell" size={14} />فعال کردن اعلان</AsyncButton>}
            {i.status !== "false_positive" && !i.feedback && <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { await monitorApi.feedback(i.id, "false_positive"); notify("ممنون؛ این مورد بسته شد و تا ۲۴ ساعت دوباره هشدار داده نمی‌شود."); await onDone(); }}><Icon name="circle-x" size={14} />هشدار اشتباه بود</AsyncButton>}
            {!i.feedback && i.status !== "false_positive" && <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { await monitorApi.feedback(i.id, "useful"); notify("ممنون از بازخورد شما."); await onDone(); }}><Icon name="circle-check" size={14} />مفید بود</AsyncButton>}
          </div>
        </div>
      )}
    </article>
  );
}

function ActionButton({ i, a, onDone }: { i: IncidentView; a: MonitorActionView; onDone: () => unknown }) {
  const { notify, confirm, prompt } = useApp();
  const [busy, setBusy] = useState(false);
  if (a.id === "explain") return i.evidence.eventId ? <ExplainButton kind="paas" resourceId={i.resource.id} errorRef={"ev-" + i.evidence.eventId} /> : null;
  if (a.link) return <Link href={a.link as never} className={BTN_G + BTN_SM}><Icon name={a.id === "assistant" ? "bot" : "external-link"} size={14} />{a.label}</Link>;
  const run = async () => {
    let typed: string | undefined;
    if (a.typed) {
      const v = await prompt("برای تأیید، نام «" + i.resource.name + "» را بنویسید.", { title: a.label, ok: "تأیید و اجرا", ltr: true, hint: a.preview });
      if (v === null) return;
      typed = v;
    } else if (!(await confirm(a.preview + " ادامه می‌دهید؟", { title: a.label, ok: "تأیید و اجرا", danger: a.destructive }))) return;
    setBusy(true);
    try { const r = await monitorApi.act(i.id, a.id, typed); notify(r.message, "circle-check"); await onDone(); }
    catch (e) { notify((e as Error).message, "circle-alert"); }
    finally { setBusy(false); }
  };
  return <button type="button" disabled={busy} onClick={run} className={(a.destructive ? BTN_D : BTN_P) + BTN_SM}><Icon name={busy ? "loader-circle" : "zap"} size={14} className={busy ? "animate-spin" : ""} />{a.label}</button>;
}

const PANEL_OPTS = [{ value: "info", label: "همه (اطلاع به بالا)" }, { value: "warn", label: "هشدار و بحرانی" }, { value: "critical", label: "فقط بحرانی" }, { value: "off", label: "خاموش" }];
function MonitorSettings({ data, reload }: { data: MonitorReport; reload: () => unknown }) {
  const { notify } = useApp();
  const [prefs, setPrefs] = useState<ChannelPrefs>(data.prefs);
  const save = async (p: ChannelPrefs) => { setPrefs(p); try { await monitorApi.setPrefs(p); notify("ذخیره شد."); } catch (e) { notify((e as Error).message, "circle-alert"); } };
  return (
    <div className="grid xl:grid-cols-2 gap-4 items-start">
      <Card title="کانال‌های اعلان" icon="bell">
        <p className="text-xs text-white/55 leading-6 mb-4">برای هر کانال حداقل شدت رخداد را انتخاب کنید. ایمیل فقط برای هشدار و بحرانی ارسال می‌شود.{data.channels ? "" : " ربات تلگرام یا بله را از تنظیمات حساب › اعلان‌ها وصل کنید."}</p>
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between gap-3"><span>اعلان در پنل</span><Select label="اعلان در پنل" value={prefs.panel} onChange={(v) => save({ ...prefs, panel: v as ChannelPrefs["panel"] })} options={PANEL_OPTS} className="max-w-[200px]" /></label>
          <label className="flex items-center justify-between gap-3"><span>ایمیل</span><Select label="ایمیل" value={prefs.email} onChange={(v) => save({ ...prefs, email: v as ChannelPrefs["email"] })} options={PANEL_OPTS.slice(1)} className="max-w-[200px]" /></label>
          <label className="flex items-center justify-between gap-3"><span>تلگرام / بله / وب‌هوک {data.channels ? "(" + fa(data.channels) + " کانال)" : "(وصل نیست)"}</span><Select label="تلگرام و بله" value={prefs.channel} onChange={(v) => save({ ...prefs, channel: v as ChannelPrefs["channel"] })} options={PANEL_OPTS} className="max-w-[200px]" /></label>
        </div>
      </Card>
      <Card title="حساسیت و بی‌صدا کردن منابع" icon="sliders-horizontal">
        {data.resources.length === 0 ? <Empty icon="server" title="سرور یا اپی ندارید" /> : (
          <ul className="divide-y divide-white/[0.06]">{data.resources.map((r) => <ResourceRow key={r.kind + r.id} r={r} reload={reload} />)}</ul>
        )}
        <p className="text-[11px] text-white/45 leading-5 mt-3">حساسیت «کم» آستانه‌ها را ۱٫۵ برابر و «زیاد» ۰٫۷ برابر می‌کند. منابع تازه (کمتر از ۳ روز) فقط هشدار بحرانی می‌گیرند.</p>
      </Card>
    </div>
  );
}

function ResourceRow({ r, reload }: { r: ResourceSetting; reload: () => unknown }) {
  const { notify } = useApp();
  const set = async (patch: { sensitivity?: Sensitivity; muteHours?: number }) => { try { await monitorApi.setResource(r.kind, r.id, patch); notify("ذخیره شد."); await reload(); } catch (e) { notify((e as Error).message, "circle-alert"); } };
  return (
    <li className="py-3 flex flex-wrap items-center gap-2 text-sm">
      <Icon name={r.kind === "server" ? "server" : "rocket"} size={15} className="text-white/50" />
      <span className="font-bold ltr">{r.name}</span>
      {r.muted && <Badge tone="gray">بی‌صدا تا {r.mutedUntil}</Badge>}
      <span className="ms-auto flex items-center gap-2">
        <Select label={"حساسیت " + r.name} value={r.sensitivity} onChange={(v) => set({ sensitivity: v as Sensitivity })} options={(Object.keys(SENSITIVITY_LABEL) as Sensitivity[]).map((k) => ({ value: k, label: "حساسیت " + SENSITIVITY_LABEL[k] }))} className="w-[130px]" />
        {r.muted ? <button type="button" className={BTN_G + BTN_SM} onClick={() => set({ muteHours: 0 })}>لغو بی‌صدا</button>
          : <Select label={"بی‌صدا کردن " + r.name} value="" onChange={(v) => v && set({ muteHours: Number(v) })} options={[{ value: "", label: "بی‌صدا…" }, ...MUTE_OPTS]} className="w-[120px]" />}
      </span>
    </li>
  );
}

/** the panel dashboard widget */
export function MonitorWidget() {
  const [b, setB] = useState<MonitorBrief | null>(null);
  useEffect(() => { monitorApi.brief().then(setB).catch(() => setB(null)); }, []);
  if (!b) return null;
  const bad = b.critical > 0;
  return (
    <Link href="/panel/monitor" className={"mt-4 flex flex-wrap items-center gap-3 rounded-2xl border p-4 transition " + (bad ? "border-rose-300/30 bg-rose-400/[0.07] hover:border-rose-300/50" : b.open ? "border-amber-300/25 bg-amber-400/[0.06] hover:border-amber-300/45" : "border-white/[0.09] bg-white/[0.03] hover:border-white/20")}>
      <Icon name={b.open ? "shield-alert" : "shield-check"} size={20} className={bad ? "text-rose-200" : b.open ? "text-amber-200" : "text-emerald-200"} />
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-bold">{MONITOR.name}</div>
        <div className="text-white/65 text-xs mt-0.5 truncate">{b.open ? fa(b.open) + " رخداد باز" + (b.critical ? "، " + fa(b.critical) + " بحرانی" : "") + (b.top ? " — " + b.top.title : "") : "همه سرورها و اپ‌ها عادی‌اند"}</div>
      </div>
      <span className="text-xs acc font-bold">{b.open ? "بررسی رخدادها" : "مشاهده"}</span>
    </Link>
  );
}

/** the badge on a server or app page */
export function MonitorBadgeBar({ kind, id }: { kind: ResourceKind; id: string }) {
  const [b, setB] = useState<MonitorBadge | null>(null);
  useEffect(() => { monitorApi.badge(kind, id).then(setB).catch(() => setB(null)); }, [kind, id]);
  if (!b?.open || !b.severity) return null;
  return (
    <Link href="/panel/monitor" role="status" className={"mb-4 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm " + (b.severity === "critical" ? "border-rose-300/30 bg-rose-400/[0.07]" : "border-amber-300/25 bg-amber-400/[0.06]")}>
      <Icon name="shield-alert" size={16} />
      <span className="font-bold">{MONITOR.name}: {SEVERITY_LABEL[b.severity]}</span>
      <span className="text-white/70 min-w-0 truncate flex-1">{b.titles[0]}{b.open > 1 ? " و " + fa(b.open - 1) + " مورد دیگر" : ""}</span>
      <span className="text-xs acc font-bold">جزئیات و اقدام</span>
    </Link>
  );
}

/* ---------------- staff ---------------- */
export function MonitorAdminCard() {
  const [s, setS] = useState<MonitorAdminStats | null>(null);
  useEffect(() => { monitorApi.adminStats().then(setS).catch(() => setS(null)); }, []);
  if (!s) return null;
  return (
    <Card title={MONITOR.name} icon="shield-alert" className="mt-4" action={<Link href="/admin/monitor" className="text-xs text-white/50 hover:text-white">جزئیات</Link>}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div><div className="text-xs text-white/55">رخدادهای باز</div><div className="font-black tabular mt-1">{fa(s.open)}</div><div className="text-[11px] text-white/45">{fa(s.critical)} بحرانی</div></div>
        <div><div className="text-xs text-white/55">سوءاستفاده (خطر IP)</div><div className={"font-black tabular mt-1 " + (s.abuse ? "text-rose-300" : "")}>{fa(s.abuse)}</div></div>
        <div><div className="text-xs text-white/55">هشدار اشتباه (۳۰ روز)</div><div className="font-black tabular mt-1">{fa(Math.round(s.falsePositiveRate * 1000) / 10)}٪</div><div className="text-[11px] text-white/45">{fa(s.feedbackCount)} بازخورد</div></div>
        <div><div className="text-xs text-white/55">هزینه AI امروز</div><div className="font-black tabular mt-1">{toman(s.spendToday)}</div><div className="text-[11px] text-white/45">سقف {toman(s.dailyCap)}</div></div>
      </div>
    </Card>
  );
}

export function MonitorAdminPage() {
  const { notify, confirm, prompt } = useApp();
  const [list, setList] = useState<MonitorAdminIncident[] | null>(null);
  const [stats, setStats] = useState<MonitorAdminStats | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => Promise.all([monitorApi.adminIncidents(), monitorApi.adminStats()]).then(([l, s]) => { setList(l); setStats(s); setError(""); }).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const suspend = async (i: MonitorAdminIncident) => {
    if (!(await confirm("سرور «" + i.resource.name + "» (" + i.user.name + ") معلق شود؟ این کار در گزارش ممیزی ثبت می‌شود.", { title: "تعلیق سرور", ok: "معلق کن", danger: true }))) return;
    try { notify((await monitorApi.staffAct(i.id, "suspend")).message, "circle-check"); await load(); } catch (e) { notify((e as Error).message, "circle-alert"); }
  };
  const contact = async (i: MonitorAdminIncident) => {
    const text = await prompt("پیام به " + i.user.name + " (به‌صورت تیکت و ایمیل ارسال می‌شود):", { title: "تماس با مشتری", ok: "ارسال", value: "سلام؛ روی «" + i.resource.name + "» رخداد «" + i.label + "» دیدیم. لطفاً بررسی کنید و نتیجه را در همین تیکت اعلام کنید." });
    if (!text) return;
    try { notify((await monitorApi.staffAct(i.id, "contact", text)).message, "circle-check"); await load(); } catch (e) { notify((e as Error).message, "circle-alert"); }
  };
  const saveAuto = async (v: boolean) => {
    if (v && !(await confirm("با روشن کردن این گزینه، سرورهایی که ترافیک خروجی حمله یا اسپم دارند بدون دخالت انسان معلق می‌شوند. ادامه می‌دهید؟", { title: "تعلیق خودکار", danger: true }))) return;
    try { await monitorApi.adminSettings({ autoSuspendAbuse: v }); notify("ذخیره شد."); await load(); } catch (e) { notify((e as Error).message, "circle-alert"); }
  };
  return (
    <div>
      <PageTitle title={MONITOR.name} sub="رخدادهای بحرانی همه مشتریان؛ سوءاستفاده‌ها (خطر قرار گرفتن IPها در فهرست سیاه) اول." />
      {error && <div role="alert" className="rounded-xl border border-rose-300/30 bg-rose-400/[0.07] p-4 text-sm text-rose-200 mb-4">{error}</div>}
      {stats && (
        <div className="grid xl:grid-cols-[1.4fr_1fr] gap-4 mb-4">
          <Card title="رخدادها در ۱۴ روز اخیر" icon="chart-column">
            <Bars data={stats.perDay.map((d) => d.count)} labels={stats.perDay.map((d) => new Date(d.day + "T12:00:00Z").toLocaleDateString("fa-IR", { month: "short", day: "numeric" }))} height={150} />
          </Card>
          <Card title="به تفکیک نوع (۳۰ روز)" icon="list-checks">
            <ul className="space-y-1.5 text-xs">{stats.byDetector.map((d) => <li key={d.detector} className="flex justify-between gap-2"><span className="text-white/70">{d.label}</span><span className="tabular text-white/55">{fa(d.total)} کل · {fa(d.open)} باز · {fa(d.falsePositive)} اشتباه</span></li>)}</ul>
            <div className="mt-4 pt-3 border-t border-white/[0.06] text-xs text-white/60 space-y-2">
              <div>نرخ هشدار اشتباه (بازخورد مشتری): {fa(Math.round(stats.falsePositiveRate * 1000) / 10)}٪</div>
              <div>هزینه AI توضیح‌ها: امروز {toman(stats.spendToday)}، این ماه {toman(stats.spendMonth)} (سقف روزانه {toman(stats.dailyCap)})</div>
              <label className="flex items-center justify-between gap-2"><span>تعلیق خودکار سرورهای سوءاستفاده‌کننده</span><Switch on={stats.autoSuspendAbuse} label="تعلیق خودکار سوءاستفاده" onChange={saveAuto} /></label>
            </div>
          </Card>
        </div>
      )}
      {!list ? <div role="status" className="py-10 text-center text-sm text-white/55">در حال خواندن…</div>
        : list.length === 0 ? <Card><Empty icon="shield-check" title="رخداد بحرانی بازی نیست" /></Card>
        : <section className="space-y-3" aria-label="رخدادهای بحرانی">{list.map((i) => (
          <article key={i.id} className={"rounded-2xl border p-4 " + (i.abuse ? "border-rose-300/35 bg-rose-400/[0.06]" : "border-white/[0.09] bg-white/[0.03]")}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SEV[i.severity][0]}>{SEV[i.severity][1]}</Badge><Badge tone="gray">{DETECTOR_LABEL[i.detector]}</Badge>{i.abuse && <Badge tone="red">سوءاستفاده</Badge>}
              {i.resourceStatus && <Badge tone="gray">{i.resourceStatus}</Badge>}
              <span className="text-[11px] text-white/45 ms-auto">{i.startedAt}</span>
            </div>
            <h3 className="font-bold mt-2">{i.title}</h3>
            <div className="text-xs text-white/60 mt-1"><Link href={("/admin/users/" + i.user.id) as never} className="acc">{i.user.name}</Link> · <span className="ltr">{i.user.email}</span> · <span className="ltr">{i.resource.id}</span></div>
            <ul className="text-xs text-white/60 leading-6 mt-2 list-disc ps-4">{i.evidence.lines.map((l, k) => <li key={k}>{l}</li>)}</ul>
            {i.taken.length > 0 && <ul className="text-[11px] text-white/45 mt-2">{i.taken.map((t, k) => <li key={k}>✓ {t.label} — {t.at}</li>)}</ul>}
            <div className="flex flex-wrap gap-2 mt-3">
              {i.resource.kind === "server" && i.resourceStatus !== "suspended" && <button type="button" className={BTN_D + BTN_SM} onClick={() => suspend(i)}><Icon name="pause" size={14} />تعلیق سرور</button>}
              <button type="button" className={BTN_G + BTN_SM} onClick={() => contact(i)}><Icon name="message-circle" size={14} />تماس با مشتری</button>
            </div>
          </article>
        ))}</section>}
      <p className="text-[11px] text-white/40 mt-4">محدود کردن سرعت شبکه (throttle) از Virtualizor در گره پیاده نشده است؛ برای آن از پنل Virtualizor استفاده کنید.</p>
    </div>
  );
}
