"use client";
/* «پایش پیشرفته» in the panel (a tab of «پایش هوشمند») and the admin's pricing card (src/server/watch). */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { WATCH, WATCH_HEALTH_LABEL, WATCH_MODE_HINT, WATCH_MODE_LABEL, WATCH_STATUS_LABEL, WATCH_TRIGGER_LABEL, type WatchAdminView, type WatchHealth, type WatchHistory, type WatchMode, type WatchPlanMode, type WatchReport, type WatchResourceView, type WatchSettings } from "@/lib/watch";
import { watchApi } from "@/lib/watch-api";
import { BTN_G, BTN_P, BTN_SM, INPUT_SM } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty } from "../ui";
import { AsyncButton, Switch } from "../ui-client";

const HEALTH_TONE: Record<WatchHealth, "green" | "amber" | "red" | "gray"> = { healthy: "green", warn: "amber", critical: "red", failed: "gray" };
const MODES: WatchMode[] = ["on_demand", "every3h", "continuous"];

export function WatchSection() {
  const [data, setData] = useState<WatchReport | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => watchApi.report().then((r) => { setData(r); setError(""); }).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  if (error) return <div role="alert" className="rounded-xl border border-rose-300/30 bg-rose-400/[0.07] p-4 text-sm text-rose-200">{error}</div>;
  if (!data) return <div role="status" className="py-10 text-center text-sm text-white/55">در حال خواندن…</div>;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <Icon name="heart-pulse" size={22} className="acc mt-0.5" />
          <div className="flex-1 min-w-0 text-sm leading-7 text-white/75">
            <div className="font-bold text-white">{WATCH.name}: وقتی سرویس بالا آمده و می‌خواهید حواستان به آن باشد</div>
            پایش پایه رایگان است و برای بالا آوردن سرویس کافی است (خطای بیلد و انتشار، «توضیح بده و درستش کن»، هشدارهای امنیتی).
            پایش پیشرفته برای بعد از آن است: هوش مصنوعی لاگ‌ها و مصرف را می‌خواند، از کار افتادن و نشت حافظه و پر شدن دیسک را زود خبر می‌دهد و هر دقیقه دسترس‌پذیری را چک می‌کند.
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mt-4">
          {MODES.map((m) => (
            <div key={m} className="rounded-xl border border-white/[0.09] bg-white/[0.03] p-3">
              <div className="font-bold text-sm">{WATCH_MODE_LABEL[m]}</div>
              <div className="text-lg font-black tabular mt-1">{toman(m === "on_demand" ? data.prices.onDemand : m === "every3h" ? data.prices.every3h : data.prices.continuous)}<span className="text-[11px] font-normal text-white/50"> {m === "on_demand" ? "هر بررسی" : "در ماه"}</span></div>
              <p className="text-[11px] text-white/55 leading-5 mt-1">{WATCH_MODE_HINT[m]}</p>
            </div>
          ))}
        </div>
        {data.trialAvailable && data.trialDays > 0 && <p className="text-xs text-emerald-200/90 mt-3"><Icon name="gift" size={13} className="inline" /> اولین پایش پیشرفته شما {fa(data.trialDays)} روز رایگان است.</p>}
      </Card>
      {data.resources.length === 0 ? <Card><Empty icon="server" title="سرور یا اپی ندارید" /></Card>
        : <section aria-label="سرویس‌ها" className="grid xl:grid-cols-2 gap-4 items-start">{data.resources.map((r) => <WatchCard key={r.kind + r.id} r={r} data={data} reload={load} />)}</section>}
    </div>
  );
}

function WatchCard({ r, data, reload }: { r: WatchResourceView; data: WatchReport; reload: () => unknown }) {
  const { notify, confirm } = useApp();
  const [hist, setHist] = useState<WatchHistory | null>(null);
  const [url, setUrl] = useState(r.plan?.uptimeUrl ?? "");
  const p = r.plan;
  const act = async (f: () => Promise<{ message: string }>) => { try { notify((await f()).message, "circle-check"); await reload(); } catch (e) { notify((e as Error).message, "circle-alert"); } };
  const choose = async (m: WatchPlanMode) => {
    const price = m === "every3h" ? data.prices.every3h : data.prices.continuous;
    const free = !p && data.trialAvailable && data.trialDays > 0;
    if (!(await confirm(free ? "«" + WATCH_MODE_LABEL[m] + "» برای «" + r.name + "» " + fa(data.trialDays) + " روز رایگان روشن شود؟ پس از آن فقط اگر «ادامه پایش» را بزنید هزینه " + toman(price) + " در ماه کسر می‌شود."
      : p ? "حالت پایش «" + r.name + "» به «" + WATCH_MODE_LABEL[m] + "» (" + toman(price) + " در ماه) تغییر کند؟ ارتقا برای روزهای باقی‌مانده محاسبه و کسر می‌شود؛ کاهش از تمدید بعدی اعمال می‌شود."
      : "«" + WATCH_MODE_LABEL[m] + "» برای «" + r.name + "» روشن شود؟ " + toman(price) + " برای یک ماه از کیف پول کسر می‌شود و هر ماه تمدید می‌شود.", { title: WATCH.name, ok: free ? "روشن کن" : "تأیید" }))) return;
    await act(() => watchApi.enable(r.kind, r.id, m));
  };
  const check = async () => {
    if (r.checkPrice > 0 && !(await confirm("هزینه این بررسی " + toman(r.checkPrice) + " است و فقط وقتی هوش مصنوعی گزارش را بنویسد کسر می‌شود. ادامه می‌دهید؟", { title: "الان بررسی کن", ok: "بررسی کن" }))) return;
    try { const c = await watchApi.checkNow(r.kind, r.id); notify(WATCH_HEALTH_LABEL[c.status] + (c.charged ? " — " + toman(c.charged) + " کسر شد" : ""), c.status === "healthy" ? "circle-check" : "circle-alert"); await reload(); }
    catch (e) { notify((e as Error).message, "circle-alert"); }
  };
  return (
    <article className={"rounded-2xl border p-4 min-w-0 " + (r.down ? "border-rose-300/30 bg-rose-400/[0.05]" : "border-white/[0.09] bg-white/[0.03]")}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon name={r.kind === "server" ? "server" : "rocket"} size={16} className="text-white/55" />
        <Link href={r.href as never} className="font-bold ltr">{r.name}</Link>
        {r.builder && <Badge tone="violet">بافت</Badge>}
        {!r.running && <Badge tone="gray">خاموش</Badge>}
        {p ? <Badge tone={p.status === "trial" ? "blue" : "green"}>{WATCH_MODE_LABEL[p.mode]} · {WATCH_STATUS_LABEL[p.status]}</Badge> : <Badge tone="gray">پایش پایه</Badge>}
        {r.down && <Badge tone="red">پاسخ نمی‌دهد</Badge>}
        {r.uptime !== null && <span className="ms-auto text-[11px] text-white/55 tabular">دسترس‌پذیری ۳۰ روز: {fa(r.uptime)}٪</span>}
      </div>
      {p && (
        <p className="text-[11px] text-white/55 mt-2 leading-5">
          {p.status === "trial" ? "رایگان تا " + p.trialEnds + " (" + fa(p.daysLeft) + " روز)" + (p.renew ? "؛ پس از آن " + toman(data.prices[p.mode === "every3h" ? "every3h" : "continuous"]) + " در ماه ادامه می‌یابد." : "؛ پس از آن به پایش پایه برمی‌گردد مگر «ادامه پایش» را بزنید.")
            : (p.renew ? "تمدید خودکار در " : "پایان در ") + p.paidUntil + " · " + toman(p.price) + " در ماه" + (p.nextMode ? " · از تمدید بعدی: " + WATCH_MODE_LABEL[p.nextMode] : "")}
        </p>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        {(["every3h", "continuous"] as const).map((m) => (
          <button key={m} type="button" disabled={p?.mode === m && !p.nextMode} onClick={() => choose(m)} className={(p?.mode === m ? BTN_P : BTN_G) + BTN_SM}>
            <Icon name={m === "continuous" ? "radar" : "clock"} size={14} />{WATCH_MODE_LABEL[m]}
          </button>
        ))}
        <AsyncButton className={BTN_G + BTN_SM} onClick={check}><Icon name="scan-search" size={14} />الان بررسی کن{r.checkPrice ? " (" + toman(r.checkPrice) + ")" : p ? " (رایگان)" : ""}</AsyncButton>
        {p && (p.status === "trial"
          ? !p.renew && <AsyncButton className={BTN_P + BTN_SM} onClick={() => act(() => watchApi.renew(r.kind, r.id, true))}><Icon name="circle-check" size={14} />ادامه پایش پس از دوره رایگان</AsyncButton>
          : <AsyncButton className={BTN_G + BTN_SM} onClick={() => act(() => watchApi.renew(r.kind, r.id, !p.renew))}>{p.renew ? "لغو تمدید" : "روشن کردن تمدید"}</AsyncButton>)}
      </div>
      {p && (
        <div className="mt-3 space-y-2 text-xs">
          {r.builder && <label className="flex items-center justify-between gap-2"><span>رفع خودکار (وصله کد بافت را خودش اعمال و منتشر کند)</span><Switch label="رفع خودکار" on={p.autoFix} onChange={(v) => act(() => watchApi.options(r.kind, r.id, { autoFix: v }))} /></label>}
          <div className="flex items-center gap-2">
            <input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={r.kind === "app" ? "نشانی پیش‌فرض اپ" : "https://example.com/health"} aria-label="نشانی پینگ" className={INPUT_SM + " text-left"} />
            <AsyncButton className={BTN_G + BTN_SM + " shrink-0"} onClick={() => act(() => watchApi.options(r.kind, r.id, { uptimeUrl: url.trim() }))}>ذخیره پینگ</AsyncButton>
          </div>
          {r.kind === "server" && !p.uptimeUrl && <p className="text-[11px] text-white/45">برای پینگ هر دقیقه، نشانی سایتی که روی این سرور است را وارد کنید.</p>}
        </div>
      )}
      {r.last && (
        <div className="mt-3 rounded-xl bg-white/[0.04] border border-white/[0.07] p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/50 mb-1"><Badge tone={HEALTH_TONE[r.last.status]}>{WATCH_HEALTH_LABEL[r.last.status]}</Badge>{WATCH_TRIGGER_LABEL[r.last.trigger]} · {r.last.at}</div>
          <p className="text-sm leading-7 text-white/85 whitespace-pre-line [overflow-wrap:anywhere]">{r.last.summary}</p>
        </div>
      )}
      <button type="button" className="text-[11px] acc mt-2" onClick={async () => setHist(hist ? null : await watchApi.history(r.kind, r.id))}>{hist ? "بستن تاریخچه" : "تاریخچه بررسی‌ها"}</button>
      {hist && (hist.checks.length === 0 ? <p className="text-[11px] text-white/45 mt-1">بررسی‌ای ثبت نشده است.</p>
        : <ul className="mt-2 space-y-1.5 text-[11px] text-white/65">{hist.checks.map((c) => <li key={c.id} className="flex gap-2"><Badge tone={HEALTH_TONE[c.status]}>{WATCH_HEALTH_LABEL[c.status]}</Badge><span>{c.at} · {WATCH_TRIGGER_LABEL[c.trigger]}{c.charged ? " · " + toman(c.charged) : ""}</span></li>)}</ul>)}
    </article>
  );
}

/* ---------------- staff ---------------- */
const NUM_FIELDS: { k: keyof WatchSettings; label: string; hint?: string }[] = [
  { k: "margin", label: "حاشیه سود (ضریب)", hint: "۱ یعنی قیمت دو برابر هزینه توکن" },
  { k: "tokensIn", label: "توکن ورودی هر بررسی" }, { k: "tokensOut", label: "توکن خروجی هر بررسی" },
  { k: "checksEvery3h", label: "بررسی در ماه (هر ۳ ساعت)" }, { k: "checksContinuous", label: "بررسی در ماه (همیشه روشن)" },
  { k: "continuousMaxPerDay", label: "سقف بررسی AI در روز (همیشه روشن)" }, { k: "freeManualPerDay", label: "بررسی دستی رایگان در روز (با اشتراک)" },
  { k: "baseMonthly", label: "هزینه پایه ماهانه (پینگ و قاعده‌ها)" }, { k: "minCheck", label: "کمترین قیمت هر بررسی" },
  { k: "priceOnDemand", label: "قیمت دستی هر بررسی (۰ = محاسبه)" }, { k: "priceEvery3h", label: "قیمت دستی هر ۳ ساعت (۰ = محاسبه)" }, { k: "priceContinuous", label: "قیمت دستی همیشه روشن (۰ = محاسبه)" },
  { k: "trialDays", label: "روزهای آزمایش رایگان" },
];
const toNum = (s: string) => Number(s.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/[٬,]/g, ""));

export function WatchAdminCard() {
  const { notify } = useApp();
  const [v, setV] = useState<WatchAdminView | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => { watchApi.admin().then((x) => { setV(x); setForm(Object.fromEntries(Object.entries(x.settings).map(([k, val]) => [k, String(val)]))); }).catch(() => setV(null)); }, []);
  if (!v) return null;
  const save = async () => {
    const patch: Partial<WatchSettings> = { model: form.model ?? "" };
    for (const f of NUM_FIELDS) (patch as Record<string, number>)[f.k] = toNum(form[f.k] ?? "0");
    try { const x = await watchApi.adminSettings(patch); setV(x); notify("ذخیره شد."); } catch (e) { notify((e as Error).message, "circle-alert"); }
  };
  const q = v.quote;
  return (
    <Card title={WATCH.name + " — قیمت‌ها"} icon="heart-pulse" className="mb-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
        <div><div className="text-xs text-white/55">هر بررسی</div><div className="font-black tabular mt-1">{toman(q.onDemand)}</div><div className="text-[11px] text-white/45">محاسبه‌شده {toman(q.computed.onDemand)}</div></div>
        <div><div className="text-xs text-white/55">هر ۳ ساعت (ماهانه)</div><div className="font-black tabular mt-1">{toman(q.every3h)}</div><div className="text-[11px] text-white/45">محاسبه‌شده {toman(q.computed.every3h)}</div></div>
        <div><div className="text-xs text-white/55">همیشه روشن (ماهانه)</div><div className="font-black tabular mt-1">{toman(q.continuous)}</div><div className="text-[11px] text-white/45">محاسبه‌شده {toman(q.computed.continuous)}</div></div>
        <div><div className="text-xs text-white/55">هزینه توکن هر بررسی</div><div className="font-black tabular mt-1">{toman(Math.round(q.costPerCheck))}</div><div className="text-[11px] text-white/45 ltr">{q.model || "مدلی فعال نیست"}{q.costKnown ? "" : " (قیمت فروش؛ قیمت تمام‌شده ثبت نشده)"}</div></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-white/65 mb-4">
        <div>اشتراک‌ها: {fa(v.plans.every3h)} هر ۳ ساعت · {fa(v.plans.continuous)} همیشه روشن · {fa(v.plans.trial)} آزمایشی</div>
        <div>درآمد این ماه: {toman(v.month.revenue)}</div>
        <div>هزینه توکن این ماه: {toman(v.month.aiCost)} ({fa(v.month.checks)} بررسی)</div>
        <div className={v.month.margin < 0 ? "text-rose-300" : "text-emerald-200"}>سود این ماه: {toman(v.month.margin)}</div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs space-y-1"><span className="text-white/60">مدل بررسی (خالی = مدل پایش)</span><input dir="ltr" className={INPUT_SM + " text-left"} value={form.model ?? ""} onChange={(e) => setForm({ ...form, model: e.target.value })} /></label>
        {NUM_FIELDS.map((f) => (
          <label key={f.k} className="text-xs space-y-1"><span className="text-white/60">{f.label}</span><input inputMode="decimal" dir="ltr" className={INPUT_SM + " text-left"} value={form[f.k] ?? ""} onChange={(e) => setForm({ ...form, [f.k]: e.target.value })} />{f.hint && <span className="block text-[10px] text-white/40">{f.hint}</span>}</label>
        ))}
      </div>
      <p className="text-[11px] text-white/45 leading-5 mt-3">قیمت محاسبه‌شده = هزینه پایه + هزینه توکن هر بررسی (با قیمت تمام‌شده مدل) × تعداد بررسی مورد انتظار در ماه × (۱ + حاشیه سود)، گرد به بالا تا هزار تومان. پلتفرم هزینه توکن بررسی‌ها را می‌دهد و مشتری اشتراک را.</p>
      <div className="mt-3"><AsyncButton className={BTN_P + BTN_SM} onClick={save}>ذخیره و محاسبه دوباره</AsyncButton></div>
    </Card>
  );
}
