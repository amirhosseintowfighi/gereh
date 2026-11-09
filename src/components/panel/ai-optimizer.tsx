"use client";
/* Admin › API هوش مصنوعی › «بهینه‌ساز توکن»: token reduction, cost savings, margin, cache hit rate, fallbacks and
   validation failures per feature / model / day; per-feature settings; the offline and the live benchmark. */
import { useCallback, useEffect, useState } from "react";
import { OPT_FEATURE_LABEL, OPT_LEVEL_LABEL, type BenchRow, type OfflineRow, type OptPolicy, type OptSettingsView, type OptStats, type OptSummary } from "@/lib/ai-opt";
import { aiOptApi } from "@/lib/ai-opt-api";
import { BTN_G, BTN_P, BTN_SM, INPUT_BASE } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { useDB } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, Bars, Select, StatCard, Switch } from "../ui-client";

const pct = (n: number) => fa(Math.round(n * 10) / 10) + "٪";

function SummaryTable({ title, icon, rows, label }: { title: string; icon: string; rows: { key: string; summary: OptSummary }[]; label: (k: string) => string }) {
  return (
    <Card pad="p-3 sm:p-4" title={title} icon={icon}>
      {rows.length === 0 ? <Empty icon="activity" title="هنوز رویدادی ثبت نشده" text="پس از اولین درخواست‌های مدل، آمار اینجا دیده می‌شود." /> : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={title}>
          <table className="w-full text-xs min-w-[760px]">
            <thead><tr className="text-white/55 text-right">{["", "درخواست", "کاهش توکن", "صرفه‌جویی هزینه", "حاشیه سود", "نرخ برخورد کش", "بازگشت به اصل", "خطای اعتبارسنجی", "فراتر از بودجه"].map((h) => <th key={h} scope="col" className="text-right font-medium p-2">{h}</th>)}</tr></thead>
            <tbody>{rows.map(({ key, summary: s }) => (
              <tr key={key} className="border-t border-white/[0.06]">
                <td className="p-2 font-bold" dir="auto">{label(key)}</td>
                <td className="p-2 tabular">{fa(s.requests)}</td>
                <td className="p-2 tabular">{pct(s.tokenReductionPct)}</td>
                <td className="p-2 tabular">{pct(s.costSavingsPct)}</td>
                <td className="p-2 tabular">{s.knownCostRequests ? toman(Math.round(s.margin)) + " (" + pct(s.marginPct) + ")" : "هزینه نامعلوم"}</td>
                <td className="p-2 tabular">{pct(s.cacheHitRate)}</td>
                <td className="p-2 tabular">{pct(s.fallbackRate)}</td>
                <td className="p-2 tabular">{fa(s.validatorFailures)}</td>
                <td className="p-2 tabular">{fa(s.overBudget)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function FeatureSettings({ view, onSaved }: { view: OptSettingsView; onSaved: () => void }) {
  const { notify } = useApp();
  const [features, setFeatures] = useState(view.settings.features);
  const [cacheControl, setCacheControl] = useState(view.settings.cacheControl);
  const [usdToman, setUsdToman] = useState(String(view.settings.usdToman || ""));
  const [enabled, setEnabled] = useState(view.settings.enabled);
  const patch = (f: string, p: Partial<OptPolicy>) => setFeatures({ ...features, [f]: { ...(features[f] ?? {}), ...p } });
  const eff = (f: string): OptPolicy => ({ ...view.effective[f], ...(features[f] ?? {}) });
  return (
    <Card title="تنظیمات بهینه‌ساز" icon="sliders-horizontal">
      <div className="space-y-3 text-sm">
        {!view.envEnabled && <p className="rounded-xl bg-amber-400/10 border border-amber-300/20 px-3 py-2 text-xs text-amber-100">AI_OPTIMIZER=0 روی سرور تنظیم شده است: بهینه‌ساز کاملاً خاموش است و این تنظیمات اثری ندارند.</p>}
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-2"><Switch on={enabled} onChange={setEnabled} label="بهینه‌ساز روشن" />بهینه‌ساز روشن</span>
          <Field label="cache_control"><Select label="cache_control" value={cacheControl} onChange={(v) => setCacheControl(v as typeof cacheControl)} options={[{ value: "auto", label: "خودکار (فقط OpenRouter)" + (view.openRouter ? " — فعال" : "") }, { value: "on", label: "روشن" }, { value: "off", label: "خاموش" }]} /></Field>
          <Field label="نرخ دلار (تومان) برای usage.cost"><input inputMode="numeric" value={usdToman} onChange={(e) => setUsdToman(e.target.value.replace(/[^\d]/g, ""))} className={INPUT_BASE + " h-9 w-36 tabular"} /></Field>
        </div>
        <p className="text-[11px] text-white/50 leading-6">API عمومی (کلیدهای gk-) بدون رضایت مشتری فقط کش پرامپت می‌گیرد؛ تنظیم این ردیف فقط برای مشتریانی است که فشرده‌سازی را روشن کرده‌اند. ترجمه فارسی→انگلیسی {view.translateConfigured ? "پیکربندی شده است (AI_OPT_TRANSLATE_URL)" : "پیکربندی نشده است (AI_OPT_TRANSLATE_URL خالی)"}.</p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="سیاست هر بخش">
          <table className="w-full text-xs min-w-[720px]">
            <thead><tr className="text-white/55 text-right">{["بخش", "روشن", "سطح", "نوبت‌های کامل اخیر", "سقف ورودی (توکن)", "کش", "ترجمه"].map((h) => <th key={h} scope="col" className="text-right font-medium p-2">{h}</th>)}</tr></thead>
            <tbody>{Object.keys(view.effective).filter((f) => f !== "benchmark").map((f) => { const p = eff(f); return (
              <tr key={f} className="border-t border-white/[0.06]">
                <td className="p-2 font-bold">{OPT_FEATURE_LABEL[f] ?? f}</td>
                <td className="p-2"><Switch on={p.enabled} onChange={(v) => patch(f, { enabled: v })} label={"روشن " + f} /></td>
                <td className="p-2 w-40"><Select label={"سطح " + f} value={String(f === "api" ? view.optInPolicy.level : p.level)} onChange={(v) => patch(f, { level: Number(v) as OptPolicy["level"] })} options={OPT_LEVEL_LABEL.map((l, i) => ({ value: String(i), label: l }))} /></td>
                <td className="p-2"><input inputMode="numeric" value={String(p.recentTurns)} onChange={(e) => patch(f, { recentTurns: Math.max(1, Number(e.target.value.replace(/[^\d]/g, "")) || 1) })} aria-label={"نوبت‌های اخیر " + f} className={INPUT_BASE + " h-8 w-16 tabular"} /></td>
                <td className="p-2"><input inputMode="numeric" value={String(p.maxInputTokens)} onChange={(e) => patch(f, { maxInputTokens: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })} aria-label={"سقف ورودی " + f} className={INPUT_BASE + " h-8 w-24 tabular"} /></td>
                <td className="p-2"><Switch on={p.cache} onChange={(v) => patch(f, { cache: v })} label={"کش " + f} /></td>
                <td className="p-2"><Switch on={p.translate} disabled={f === "api" && !view.translateConfigured} onChange={(v) => patch(f, { translate: v })} label={"ترجمه " + f} /></td>
              </tr>
            ); })}</tbody>
          </table>
        </div>
        <AsyncButton className={BTN_P + BTN_SM} onClick={async () => { await aiOptApi.saveSettings({ enabled, features, cacheControl, usdToman: Number(usdToman) || 0 }); notify("تنظیمات بهینه‌ساز ذخیره شد", "circle-check"); onSaved(); }}>ذخیره تنظیمات</AsyncButton>
      </div>
    </Card>
  );
}

function Benchmarks() {
  const models = useDB().ai.models.filter((m) => m.kind === "chat" && m.active);
  const { notify } = useApp();
  const [offline, setOffline] = useState<OfflineRow[] | null>(null);
  const [runs, setRuns] = useState<BenchRow[]>([]);
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [budget, setBudget] = useState("5");
  const [judge, setJudge] = useState(false);
  const load = useCallback(() => { aiOptApi.benchList().then(setRuns).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!runs.some((r) => r.status === "running")) return; const t = setInterval(load, 5000); return () => clearInterval(t); }, [runs, load]);
  return (
    <div className="space-y-4">
      <Card title="محک آفلاین (تخمینی)" icon="flask-conical" action={<AsyncButton className={BTN_G + BTN_SM} onClick={async () => setOffline(await aiOptApi.offline())}>اجرا</AsyncButton>}>
        <p className="text-[11px] text-white/50 leading-6 mb-2">روی مجموعه نمونه tests/fixtures/ai-opt، بدون فراخوانی مدل. اعداد تخمین توکن ورودی‌اند، نه توکن صورت‌حساب‌شده.</p>
        {offline && <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="محک آفلاین"><table className="w-full text-xs min-w-[640px]">
          <thead><tr className="text-white/55 text-right">{["نمونه", "سیاست", "اصلی (تخمین)", "بهینه (تخمین)", "کاهش", "بررسی‌ها"].map((h) => <th key={h} scope="col" className="text-right font-medium p-2">{h}</th>)}</tr></thead>
          <tbody>{offline.map((r) => <tr key={r.id} className="border-t border-white/[0.06]"><td className="p-2" dir="auto">{r.workload}</td><td className="p-2" dir="ltr">{r.policy}</td><td className="p-2 tabular">{fa(r.origTokens)}</td><td className="p-2 tabular">{fa(r.optTokens)}</td><td className="p-2 tabular">{pct(r.reductionPct)}</td><td className="p-2">{r.pass ? <Badge tone="green">قبول</Badge> : <Badge tone="red">رد</Badge>}</td></tr>)}</tbody>
        </table></div>}
      </Card>
      <Card title="محک زنده (اصلی در برابر بهینه)" icon="gauge">
        <p className="text-[11px] text-white/50 leading-6 mb-3">فقط با دستور مدیر اجرا می‌شود. هر نمونه دو بار با همان مدل و پارامترها فرستاده می‌شود؛ مصرف واقعی ثبت و پاسخ‌ها مقایسه می‌شوند. سقف هزینه هر اجرا به دلار است (حداکثر طبق تنظیمات).</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="مدل"><Select label="مدل محک" value={model} onChange={setModel} options={models.map((m) => ({ value: m.id, label: m.name }))} /></Field>
          <Field label="سقف هزینه (دلار)"><input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} className={INPUT_BASE + " h-9 w-24 tabular"} /></Field>
          <span className="flex items-center gap-2 text-xs pb-2"><Switch on={judge} onChange={setJudge} label="داور LLM" />داور LLM (در همان بودجه)</span>
          <AsyncButton disabled={!model} className={BTN_P + BTN_SM} confirmText={"محک زنده با سقف " + budget + " دلار اجرا شود؟"} onClick={async () => { await aiOptApi.benchStart(model, Number(budget) || 5, judge); notify("محک شروع شد", "gauge"); load(); }}>اجرای محک</AsyncButton>
        </div>
        <div className="mt-4 space-y-2">{runs.length === 0 ? <p className="text-xs text-white/50">هنوز محکی اجرا نشده است.</p> : runs.map((r) => (
          <details key={r.id} className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3">
            <summary className="cursor-pointer text-xs flex flex-wrap gap-2 items-center"><b dir="ltr">{r.model}</b><Badge tone={r.status === "done" ? "green" : r.status === "running" ? "blue" : r.status === "budget" ? "amber" : "red"}>{{ done: "پایان", running: "در حال اجرا", budget: "توقف در سقف بودجه", failed: "ناموفق" }[r.status]}</Badge><span className="tabular">{fa(Math.round(r.spentUsd * 1000) / 1000)} / {fa(r.budgetUsd)} دلار</span>{r.report.passRate !== undefined && <span>قبولی {pct(r.report.passRate)} · کاهش واقعی میانگین {pct(r.report.meanActualReductionPct ?? 0)}</span>}</summary>
            {r.error && <p className="text-xs text-rose-300 mt-2">{r.error}</p>}
            {r.report.priceBasis && <p className="text-[11px] text-white/50 mt-2">مبنای قیمت: {r.report.priceBasis}</p>}
            {r.report.results && <ul className="mt-2 space-y-1 text-[11px]">{r.report.results.map((x) => <li key={x.id} className="flex flex-wrap gap-2"><b>{x.workload}</b><span className="tabular">{fa(x.original.promptTokens)} → {fa(x.optimized.promptTokens)} توکن ({pct(x.actualReductionPct)})</span><span>{x.check.pass ? "✓" : "✗"} {x.check.detail}</span>{x.judge !== null && <span>داور: {x.judge ? "یکسان" : "متفاوت"}</span>}</li>)}</ul>}
          </details>
        ))}</div>
      </Card>
    </div>
  );
}

export function AdminOptimizer() {
  const [days, setDays] = useState("7");
  const [stats, setStats] = useState<OptStats | null>(null);
  const [view, setView] = useState<OptSettingsView | null>(null);
  const loadSettings = useCallback(() => { aiOptApi.settings().then(setView).catch(() => {}); }, []);
  useEffect(() => { aiOptApi.stats(Number(days)).then(setStats).catch(() => {}); }, [days]);
  useEffect(() => { loadSettings(); }, [loadSettings]);
  const t = stats?.total;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-white/60 leading-6 max-w-3xl"><Icon name="shield-check" size={14} className="inline" /> صرفه‌جویی برای گره است: مشتری بر پایه حجم ورودی اصلی درخواست پرداخت می‌کند و تخفیف کش هم نزد گره می‌ماند. متن پیام‌ها ذخیره نمی‌شود؛ فقط شمارش‌ها، هزینه‌ها و هش‌ها.</p>
        <div className="w-36"><Select label="بازه" value={days} onChange={setDays} options={[{ value: "1", label: "۲۴ ساعت" }, { value: "7", label: "۷ روز" }, { value: "30", label: "۳۰ روز" }, { value: "90", label: "۹۰ روز" }]} /></div>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        <StatCard icon="split" label="کاهش توکن" value={t ? pct(t.tokenReductionPct) : "—"} sub={t ? fa(t.optimized) + " از " + fa(t.requests) + " درخواست" : ""} />
        <StatCard icon="calculator" label="صرفه‌جویی هزینه" value={t ? pct(t.costSavingsPct) : "—"} />
        <StatCard icon="wallet" label="حاشیه سود" value={t && t.knownCostRequests ? toman(Math.round(t.margin)) : "—"} sub={t ? (t.knownCostRequests ? pct(t.marginPct) : "هزینه واقعی مدل‌ها ثبت نشده") : ""} />
        <StatCard icon="zap" label="نرخ برخورد کش" value={t ? pct(t.cacheHitRate) : "—"} sub={t ? fa(t.cachedTokens) + " توکن از کش" : ""} />
        <StatCard icon="rotate-ccw" label="بازگشت به درخواست اصلی" value={t ? pct(t.fallbackRate) : "—"} tone={t && t.fallbackRate > 5 ? "down" : ""} />
        <StatCard icon="triangle-alert" label="خطای اعتبارسنجی" value={t ? t.validatorFailures : "—"} tone={t && t.validatorFailures ? "down" : ""} />
      </div>
      {stats && stats.daily.length > 1 && <Card title="کاهش توکن روزانه" icon="chart-column"><Bars data={stats.daily.map((d) => d.summary.tokenReductionPct)} labels={stats.daily.map((d) => d.key.slice(5))} height={120} fmt={(v) => pct(v)} /></Card>}
      {stats && <SummaryTable title="به تفکیک بخش" icon="layers" rows={stats.byFeature} label={(k) => OPT_FEATURE_LABEL[k] ?? k} />}
      {stats && <SummaryTable title="به تفکیک مدل" icon="cpu" rows={stats.byModel} label={(k) => k} />}
      {stats && stats.calibration.length > 0 && <Card title="کالیبراسیون تخمین‌گر (واقعی ÷ تخمین)" icon="scale"><ul className="grid sm:grid-cols-2 gap-1 text-xs">{stats.calibration.map((c) => <li key={c.model} className="flex justify-between gap-2"><span dir="ltr">{c.model}</span><span className="tabular">{fa(Math.round(c.factor * 1000) / 1000)} · {fa(c.samples)} نمونه</span></li>)}</ul></Card>}
      {view && <FeatureSettings key={JSON.stringify(view.settings)} view={view} onSaved={loadSettings} />}
      <Benchmarks />
    </div>
  );
}
