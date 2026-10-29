"use client";
/* «مشاور هزینه»: the panel page, the dashboard widget and the staff card (src/server/advisor). Every amount comes from
   the server's pricing functions; «اعمال» sends only the finding id, a confirm and, for costly or destructive actions,
   the typed resource name. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ADVISOR, RULE_LABEL, type AdvisorAdminStats, type AdvisorBrief, type AdvisorReport, type FindingView } from "@/lib/advisor";
import { advisorApi } from "@/lib/advisor-api";
import { BTN_D, BTN_G, BTN_MD, BTN_P, BTN_SM } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty } from "../ui";
import { AreaChart, AsyncButton, PageTitle, StatCard, Switch } from "../ui-client";

const RISK: Record<string, ["green" | "amber" | "red", string]> = { low: ["green", "ریسک کم"], medium: ["amber", "ریسک متوسط"], high: ["red", "ریسک بالا"] };
const runway = (d: number | null) => (d === null ? "—" : d < 1 ? "کمتر از یک روز" : fa(Math.floor(d)) + " روز");

export function AdvisorPage() {
  const { notify } = useApp();
  const [data, setData] = useState<AdvisorReport | null>(null);
  const [error, setError] = useState("");
  const load = useCallback((force = false) => advisorApi.report(force).then((r) => { setData(r); setError(""); }).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { await load(true); notify("گزارش دوباره محاسبه شد.", "refresh-cw"); };
  return (
    <div>
      <PageTitle title={ADVISOR.name} sub="کجا می‌توانید صرفه‌جویی کنید و کجا به سقف منابع نزدیک شده‌اید؛ با عدد واقعی و اعمال با یک کلیک."
        action={<AsyncButton onClick={refresh} className={BTN_G + BTN_MD}><Icon name="refresh-cw" size={16} />محاسبه دوباره</AsyncButton>} />
      {error ? <div role="alert" className="rounded-xl border border-rose-300/30 bg-rose-400/[0.07] p-4 text-sm text-rose-200">{error}</div>
        : !data ? <div role="status" className="py-16 grid place-items-center text-sm text-white/60"><Icon name="loader-circle" size={22} className="animate-spin acc" /><span className="mt-3">در حال بررسی مصرف و هزینه‌ها…</span></div>
        : <AdvisorBody data={data} reload={() => load()} />}
    </div>
  );
}

function AdvisorBody({ data, reload }: { data: AdvisorReport; reload: () => unknown }) {
  const { notify } = useApp();
  const [muted, setMuted] = useState(data.muted);
  const risks = data.findings.filter((f) => f.saving === 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon="receipt" label="هزینه ماهانه فعلی" value={data.runRate} suffix="تومان" sub="بدون مالیات، با قیمت‌های فعلی" />
        <StatCard icon="trending-down" label="صرفه‌جویی ممکن" value={data.potentialSaving} suffix="تومان / ماه" tone={data.potentialSaving ? "up" : ""} sub={fa(data.findings.length) + " پیشنهاد باز"} />
        <StatCard icon="wallet" label="موجودی کیف پول" value={data.balance} suffix="تومان" href="/panel/billing?tab=wallet" />
        <StatCard icon="timer" label="کفایت موجودی" value={runway(data.runwayDays)} sub={data.burn ? "مصرف روزانه " + toman(data.burn) : "مصرف ساعتی ندارید"} tone={data.runwayDays !== null && data.runwayDays < 7 ? "down" : ""} />
      </div>
      <Card title="خلاصه" icon="sparkles" action={data.summary.simulated ? <Badge tone="gray">خلاصه قاعده‌محور</Badge> : <Badge tone="blue">خلاصه با AI</Badge>}>
        <p className="text-sm leading-8 text-white/85">{data.summary.text || "—"}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-white/50">
          <span>آخرین محاسبه: {data.computedAt || "—"}{data.applied ? "؛ " + fa(data.applied) + " پیشنهاد اعمال شده" : ""}{data.ignored ? "؛ " + fa(data.ignored) + " نادیده گرفته شده" : ""}</span>
          <label className="flex items-center gap-2"><span>اعلان و ایمیل هفتگی</span>
            <Switch on={!muted} label="اعلان و ایمیل هفتگی مشاور هزینه" onChange={async (v) => { setMuted(!v); try { await advisorApi.setMute(!v); notify(v ? "گزارش هفتگی روشن شد." : "گزارش هفتگی خاموش شد."); } catch (e) { setMuted(v); notify((e as Error).message, "circle-alert"); } }} />
          </label>
        </div>
      </Card>
      {data.parts.length > 0 && (
        <Card title="هزینه ماهانه به تفکیک" icon="chart-column" pad="p-4 sm:p-5">
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">{data.parts.map((p) => <li key={p.label} className="flex justify-between gap-3"><span className="text-white/65">{p.label}</span><span className="tabular">{toman(p.amount)}</span></li>)}</ul>
        </Card>
      )}
      {data.findings.length === 0 ? <Card><Empty icon="circle-check" title="پیشنهاد تازه‌ای نیست" text="منابع شما با مصرفشان متناسب است. هر هفته دوباره بررسی می‌کنیم." /></Card>
        : <section aria-label="پیشنهادها" className="grid lg:grid-cols-2 gap-4">{[...risks, ...data.findings.filter((f) => f.saving > 0)].map((f) => <FindingCard key={f.id} f={f} onDone={reload} />)}</section>}
      {data.insufficient.length > 0 && (
        <Card title="داده کافی نیست" icon="timer" pad="p-4 sm:p-5">
          <p className="text-xs text-white/55 mb-3 leading-6">برای این منابع هنوز داده مصرف کافی نداریم؛ تا آن موقع پیشنهاد کوچک‌سازی یا توقف نمی‌دهیم.</p>
          <ul className="space-y-2 text-sm">{data.insufficient.map((x) => <li key={x.kind + x.id} className="flex flex-wrap justify-between gap-2"><span className="font-bold ltr">{x.name}</span><span className="text-white/60 text-xs">{fa(x.days)} روز داده — {x.reason}</span></li>)}</ul>
        </Card>
      )}
    </div>
  );
}

function FindingCard({ f, onDone }: { f: FindingView; onDone: () => unknown }) {
  const { notify, confirm, prompt } = useApp();
  const [busy, setBusy] = useState(false);
  const a = f.action;
  const run = async () => {
    if (!a) return;
    let typed: string | undefined;
    if (a.typed) {
      const v = await prompt("برای تأیید، نام «" + f.resource.name + "» را بنویسید.", { title: a.label, ok: "تأیید و اجرا", ltr: true, hint: a.preview });
      if (v === null) return;
      typed = v;
    } else if (!(await confirm(a.preview + ". ادامه می‌دهید؟", { title: a.label, ok: "تأیید و اجرا", danger: a.destructive }))) return;
    setBusy(true);
    try { const r = await advisorApi.apply(f.id, typed); notify(r.message, "circle-check"); await onDone(); }
    catch (e) { notify((e as Error).message, "circle-alert"); }
    finally { setBusy(false); }
  };
  const ignore = async () => { await advisorApi.ignore(f.id); notify("تا ۳۰ روز نمایش داده نمی‌شود."); await onDone(); };
  return (
    <article className="rounded-2xl border border-white/[0.09] bg-white/[0.03] p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="gray">{RULE_LABEL[f.rule]}</Badge>
        <Badge tone={RISK[f.risk][0]}>{RISK[f.risk][1]}</Badge>
        {f.saving > 0 && <Badge tone="green">−{toman(f.saving)} / ماه</Badge>}
        {f.extraCost > 0 && <Badge tone="amber">+{toman(f.extraCost)} / ماه</Badge>}
        {f.oneTime > 0 && <Badge tone="amber">{toman(f.oneTime)} یک‌باره</Badge>}
        <span className="text-[11px] text-white/45 ms-auto">اطمینان {fa(Math.round(f.confidence * 100))}٪</span>
      </div>
      <div>
        <h3 className="font-bold text-[15px] leading-7">{f.title}</h3>
        <p className="text-sm text-white/70 leading-7 mt-1">{f.detail}</p>
      </div>
      <ul className="text-xs text-white/60 leading-6 space-y-1 list-disc ps-4">{f.evidence.lines.map((l, i) => <li key={i} className="[overflow-wrap:anywhere]">{l}</li>)}</ul>
      {f.evidence.series && f.evidence.series.data.length > 1 && (
        <div aria-label={f.evidence.series.label}><div className="text-[10px] text-white/45 mb-1">{f.evidence.series.label}</div><AreaChart data={f.evidence.series.data} labels={f.evidence.series.labels} unit={f.evidence.series.unit} height={64} /></div>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-auto pt-1">
        {a?.link ? <Link href={a.link as never} className={BTN_G + BTN_SM}><Icon name="external-link" size={14} />{a.label}</Link>
          : a ? <button type="button" disabled={busy} onClick={run} className={(a.destructive ? BTN_D : BTN_P) + BTN_SM}><Icon name={busy ? "loader-circle" : "zap"} size={14} className={busy ? "animate-spin" : ""} />اعمال: {a.label}</button> : null}
        <AsyncButton onClick={ignore} className={BTN_G + BTN_SM}><Icon name="eye-off" size={14} />نادیده بگیر (۳۰ روز)</AsyncButton>
        <Link href={f.resource.href as never} className="text-xs text-white/50 hover:text-white ms-auto">{f.resource.name}</Link>
      </div>
      {a && !a.link && <p className="text-[11px] text-white/50 leading-5">{a.preview}{a.typed ? " — برای تأیید نام منبع را می‌نویسید." : ""}</p>}
    </article>
  );
}

/** the panel dashboard widget */
export function AdvisorWidget() {
  const [b, setB] = useState<AdvisorBrief | null>(null);
  useEffect(() => { advisorApi.brief().then(setB).catch(() => setB(null)); }, []);
  if (!b || (!b.findings && b.runwayDays === null)) return null;
  return (
    <Link href="/panel/advisor" className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] p-4 hover:border-emerald-300/40 transition">
      <Icon name="trending-down" size={20} className="text-emerald-200" />
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-bold">{ADVISOR.name}</div>
        <div className="text-white/65 text-xs mt-0.5">{b.potentialSaving ? "تا " + toman(b.potentialSaving) + " صرفه‌جویی ماهانه ممکن است" : "پیشنهادی برای صرفه‌جویی نیست"}{b.risks ? "؛ " + fa(b.risks) + " هشدار" : ""}</div>
      </div>
      <span className="text-xs acc font-bold">مشاهده پیشنهادها</span>
    </Link>
  );
}

/** the staff dashboard card: what the advisor saves customers, and whether they act on it */
export function AdvisorAdminCard() {
  const [s, setS] = useState<AdvisorAdminStats | null>(null);
  useEffect(() => { advisorApi.adminStats().then(setS).catch(() => setS(null)); }, []);
  if (!s) return null;
  return (
    <Card title={ADVISOR.name} icon="trending-down" className="mt-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div><div className="text-xs text-white/55">صرفه‌جویی ممکن مشتریان</div><div className="font-black tabular mt-1">{toman(s.potentialSaving)}</div><div className="text-[11px] text-white/45">{fa(s.openFindings)} پیشنهاد، {fa(s.accounts)} حساب</div></div>
        <div><div className="text-xs text-white/55">اعمال‌شده</div><div className="font-black tabular mt-1">{fa(s.applied)}</div><div className="text-[11px] text-white/45">{toman(s.appliedSaving)} در ماه</div></div>
        <div><div className="text-xs text-white/55">نادیده گرفته‌شده</div><div className="font-black tabular mt-1">{fa(s.ignored)}</div></div>
        <div><div className="text-xs text-white/55">هزینه AI امروز</div><div className="font-black tabular mt-1">{toman(s.spendToday)}</div><div className="text-[11px] text-white/45">سقف {toman(s.dailyCap)}؛ این ماه {toman(s.spendMonth)}</div></div>
      </div>
      {s.byRule.length > 0 && <ul className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">{s.byRule.slice(0, 8).map((r) => <li key={r.rule} className="flex justify-between gap-2"><span className="text-white/65">{r.label} ({fa(r.open)})</span><span className="tabular">{toman(r.saving)}</span></li>)}</ul>}
    </Card>
  );
}
