"use client";
/* Gereh Apps: build and runtime options, usage and budget, events timeline, domain options, CI
   templates, cloning and the deploy-failure explanation. Data comes from api.paas.runtime(). */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { FAILURES, GB, MAX_DNS, NGINX_STACKS, PHP_STACKS, TIMEZONES, ciTemplates, type FailureKind, type RuntimeConfig } from "@/lib/paas-runtime";
import { SITE_URL } from "@/lib/seo";
import { api, useDB, useMyId, type PaasRuntimeView } from "@/lib/store";
import type { PaasApp } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, CopyText, Select, Switch, Tabs } from "../ui-client";

/** loads the runtime view of one app; reload() after a change */
export function useRuntime(appId: string) {
  const [data, setData] = useState<PaasRuntimeView | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => { try { setData(await api.paas.runtime(appId)); setError(""); } catch (e) { setError((e as Error).message); } }, [appId]);
  useEffect(() => {
    let live = true;
    api.paas.runtime(appId).then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [appId]);
  return { data, error, reload };
}
const Loading = ({ error }: { error?: string }) => <Card>{error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : <p className="text-sm text-white/55 flex items-center gap-2"><Icon name="loader-circle" size={15} className="animate-spin" />در حال بارگذاری…</p>}</Card>;
const num = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;
const bytes = (n: number) => n >= GB ? fa(Math.round((n / GB) * 10) / 10, 1) + " گیگ" : fa(Math.round(n / 1024 / 1024)) + " مگ";

/* ================= build & runtime tab ================= */
export function AppRuntime({ app }: { app: PaasApp }) {
  const { data, error, reload } = useRuntime(app.id);
  if (!data) return <Loading error={error} />;
  return <RuntimeForm key={JSON.stringify(data.config)} app={app} view={data} reload={reload} />;
}

function RuntimeForm({ app, view, reload }: { app: PaasApp; view: PaasRuntimeView; reload: () => Promise<void> }) {
  const { notify } = useApp();
  const [f, setF] = useState<RuntimeConfig>(view.config);
  const [args, setArgs] = useState(Object.entries(view.config.buildArgs).map(([k, v]) => k + "=" + v).join("\n"));
  const [dns, setDns] = useState(view.config.dnsServers.join("\n"));
  const set = (p: Partial<RuntimeConfig>) => setF((x) => ({ ...x, ...p }));
  const builds = app.source !== "image";
  const hooks = app.source !== "compose";
  const save = async () => {
    const buildArgs = Object.fromEntries(args.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=") < 0 ? l.length : l.indexOf("=")), l.includes("=") ? l.slice(l.indexOf("=") + 1) : ""]));
    const patch: Partial<RuntimeConfig> = {
      preStart: f.preStart, healthType: f.healthType, healthCommand: f.healthCommand, healthCodes: f.healthCodes, healthInterval: f.healthInterval, healthTimeout: f.healthTimeout,
      healthRetries: f.healthRetries, healthStartPeriod: f.healthStartPeriod, zeroDowntime: f.zeroDowntime, timezone: f.timezone, readOnlyFs: f.readOnlyFs,
      dnsServers: dns.split(/[\s,]+/).filter(Boolean), mirror: f.mirror,
      ...(builds ? { preBuild: f.preBuild, postBuild: f.postBuild, buildCache: f.buildCache, buildArgs, dockerfile: f.dockerfile || "Dockerfile" } : {}),
      ...(NGINX_STACKS.has(app.stack) ? { nginxConf: f.nginxConf } : {}), ...(PHP_STACKS.has(app.stack) ? { phpIni: f.phpIni } : {}),
    };
    if (!hooks) { delete patch.preBuild; delete patch.postBuild; delete patch.preStart; }
    const dep = await api.paas.setRuntime(app.id, patch);
    await reload();
    notify(dep ? "ذخیره شد؛ اپ با تنظیمات جدید دوباره اجرا می‌شود" : "ذخیره شد؛ در استقرار بعدی اعمال می‌شود", "check");
  };
  const n = (v: number, k: keyof RuntimeConfig, label: string, hint?: string) => (
    <Field label={label} hint={hint}><input value={v} inputMode="numeric" onChange={(e) => set({ [k]: num(e.target.value) } as Partial<RuntimeConfig>)} dir="ltr" className={INPUT + " text-left"} /></Field>
  );
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <div className="space-y-4">
        {hooks && <Card title="هوک‌ها" icon="terminal">
          <p className="text-[11px] text-white/50 leading-6 mb-3">از <code dir="ltr">gereh.json</code> هم خوانده می‌شوند: <code dir="ltr">{'"hooks": { "preBuild": "…", "postBuild": "…", "preStart": "…" }'}</code></p>
          <div className="space-y-3">
            {builds && <Field label="پیش از بیلد (pre-build)" hint="بعد از کپی سورس و پیش از دستور بیلد اجرا می‌شود"><input value={f.preBuild} onChange={(e) => set({ preBuild: e.target.value })} dir="ltr" placeholder="npm run lint" className={INPUT + " text-left font-mono text-xs"} /></Field>}
            {builds && <Field label="پس از بیلد (post-build)" hint="آخرین مرحله ساخت ایمیج"><input value={f.postBuild} onChange={(e) => set({ postBuild: e.target.value })} dir="ltr" placeholder="npm prune --omit=dev" className={INPUT + " text-left font-mono text-xs"} /></Field>}
            <Field label="پیش از اجرا (pre-start)" hint="در هر بار روشن شدن هر نمونه، پیش از دستور اجرا"><input value={f.preStart} onChange={(e) => set({ preStart: e.target.value })} dir="ltr" placeholder="php artisan config:cache" className={INPUT + " text-left font-mono text-xs"} /></Field>
          </div>
        </Card>}
        <Card title="بررسی سلامت و استقرار بدون قطعی" icon="heart-pulse">
          <div className="space-y-3">
            <Field label="نوع بررسی"><Select label="نوع بررسی" value={f.healthType} onChange={(v) => set({ healthType: v as RuntimeConfig["healthType"] })} options={[{ value: "http", label: "درخواست HTTP به مسیر سلامت (" + app.healthPath + ")" }, { value: "command", label: "اجرای دستور (کد خروج ۰)" }, { value: "tcp", label: "باز بودن پورت" }]} /></Field>
            {f.healthType === "http" && <Field label="کدهای وضعیت مجاز" hint="مسیر را در تنظیمات اپ عوض کنید"><input value={f.healthCodes} onChange={(e) => set({ healthCodes: e.target.value })} dir="ltr" placeholder="200-399" className={INPUT + " text-left"} /></Field>}
            {f.healthType === "command" && <Field label="دستور بررسی"><input value={f.healthCommand} onChange={(e) => set({ healthCommand: e.target.value })} dir="ltr" placeholder="curl -fs localhost:3000/health" className={INPUT + " text-left font-mono text-xs"} /></Field>}
            <div className="grid grid-cols-2 gap-3">
              {n(f.healthInterval, "healthInterval", "فاصله (ثانیه)")}{n(f.healthTimeout, "healthTimeout", "مهلت پاسخ (ثانیه)")}
              {n(f.healthRetries, "healthRetries", "تعداد تلاش")}{n(f.healthStartPeriod, "healthStartPeriod", "مهلت شروع (ثانیه)", "برای اپ‌هایی که دیر بالا می‌آیند")}
            </div>
            <div className="flex items-center justify-between gap-3 text-sm pt-2"><span>استقرار بدون قطعی<span className="block text-[11px] text-white/50">نسخه جدید کنار نسخه قبلی بالا می‌آید و فقط پس از سالم بودن، ترافیک به آن منتقل می‌شود. خاموش: نسخه قبلی اول متوقف می‌شود.</span></span><Switch on={f.zeroDowntime} onChange={(v) => set({ zeroDowntime: v })} label="استقرار بدون قطعی" /></div>
          </div>
        </Card>
      </div>
      <div className="space-y-4">
        {builds && <Card title="بیلد" icon="hammer">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 text-sm"><span>کش بیلد<span className="block text-[11px] text-white/50">لایه‌های بدون تغییر دوباره ساخته نمی‌شوند</span></span><Switch on={f.buildCache} onChange={(v) => set({ buildCache: v })} label="کش بیلد" /></div>
            <div className="flex items-center justify-between gap-3 text-sm"><span>آینه بسته‌ها<span className="block text-[11px] text-white/50">npm، pip، composer و Go از آینه گره (سریع و بدون وابستگی به اینترنت بین‌الملل)</span></span><Switch on={f.mirror} onChange={(v) => set({ mirror: v })} label="آینه بسته‌ها" /></div>
            <Field label="مسیر Dockerfile" hint="اگر نباشد، پشته با Nixpacks تشخیص داده می‌شود"><input value={f.dockerfile} onChange={(e) => set({ dockerfile: e.target.value.trim() })} dir="ltr" className={INPUT + " text-left font-mono text-xs"} /></Field>
            <Field label="آرگومان‌های بیلد (build args)" hint="هر خط KEY=VALUE؛ در لاگ بیلد دیده نمی‌شوند ولی در ایمیج می‌مانند، پس رمز نگذارید"><textarea value={args} onChange={(e) => setArgs(e.target.value)} dir="ltr" rows={3} className={TEXTAREA + " text-left font-mono text-xs"} placeholder={"NODE_ENV=production"} /></Field>
          </div>
        </Card>}
        <Card title="محیط اجرا" icon="cpu">
          <div className="space-y-3">
            <Field label="منطقه زمانی (TZ)"><Select label="منطقه زمانی" ltr value={f.timezone} onChange={(v) => set({ timezone: v })} options={[...new Set([f.timezone, ...TIMEZONES])].map((t) => ({ value: t, label: t }))} /></Field>
            <div className="flex items-center justify-between gap-3 text-sm"><span>فایل‌سیستم فقط‌خواندنی<span className="block text-[11px] text-white/50">امن‌تر؛ فقط ‎/tmp‎ و دیسک دائمی قابل نوشتن‌اند</span></span><Switch on={f.readOnlyFs} onChange={(v) => set({ readOnlyFs: v })} label="فایل‌سیستم فقط‌خواندنی" /></div>
            <Field label={"سرورهای DNS سفارشی (تا " + fa(MAX_DNS) + ")"} hint="هر خط یک IP؛ خالی = DNS پلتفرم. Kubernetes حداکثر سه سرور اول را به کار می‌برد."><textarea value={dns} onChange={(e) => setDns(e.target.value)} dir="ltr" rows={2} placeholder={"178.22.122.100\n1.1.1.1"} className={TEXTAREA + " text-left font-mono text-xs"} /></Field>
            {NGINX_STACKS.has(app.stack) && <Field label="پیکربندی nginx (جایگزین پیش‌فرض)" hint="بلاک server کامل؛ خالی = پیش‌فرض پشته"><textarea value={f.nginxConf} onChange={(e) => set({ nginxConf: e.target.value })} dir="ltr" rows={6} placeholder={"server {\n  listen 80;\n  root /app/public;\n  location / { try_files $uri $uri/ /index.php?$query_string; }\n}"} className={TEXTAREA + " text-left font-mono text-xs"} /></Field>}
            {PHP_STACKS.has(app.stack) && <Field label="php.ini سفارشی"><textarea value={f.phpIni} onChange={(e) => set({ phpIni: e.target.value })} dir="ltr" rows={4} placeholder={"upload_max_filesize = 64M\npost_max_size = 64M\nmemory_limit = 256M"} className={TEXTAREA + " text-left font-mono text-xs"} /></Field>}
          </div>
        </Card>
        <div className="flex justify-end"><AsyncButton onClick={save}>ذخیره تنظیمات</AsyncButton></div>
      </div>
      <BasicAuthCard app={app} view={view} reload={reload} />
    </div>
  );
}

function BasicAuthCard({ app, view, reload }: { app: PaasApp; view: PaasRuntimeView; reload: () => Promise<void> }) {
  const { notify } = useApp();
  const [o, setO] = useState({ path: view.config.authPath || "/admin", user: view.config.authUser || "admin", password: "" });
  return (
    <Card title="رمز عبور روی مسیر" icon="lock" className="lg:col-span-2">
      <p className="text-sm text-white/60 leading-7 mb-3">درخواست‌های این مسیر (و زیرمسیرهایش) پیش از رسیدن به اپ نام کاربری و رمز می‌خواهند (HTTP Basic Auth)؛ مثلاً برای پنل مدیریت یا نسخه آزمایشی.</p>
      {view.config.authOn && <p className="mb-3 flex items-center gap-2 text-sm"><Badge tone="green" dot>فعال</Badge><span dir="ltr" className="font-mono text-xs">{view.config.authPath}</span> · کاربر <b dir="ltr">{view.config.authUser}</b></p>}
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="مسیر"><input value={o.path} onChange={(e) => setO({ ...o, path: e.target.value.trim() })} dir="ltr" className={INPUT + " text-left"} /></Field>
        <Field label="نام کاربری"><input value={o.user} onChange={(e) => setO({ ...o, user: e.target.value.trim() })} dir="ltr" className={INPUT + " text-left"} /></Field>
        <Field label="رمز عبور" hint="دست‌کم ۸ نویسه؛ فقط هش آن نگه داشته می‌شود"><input type="password" value={o.password} onChange={(e) => setO({ ...o, password: e.target.value })} dir="ltr" autoComplete="new-password" className={INPUT + " text-left"} /></Field>
      </div>
      <div className="flex gap-2 mt-3">
        <AsyncButton disabled={o.password.length < 8} onClick={async () => { await api.paas.setBasicAuth(app.id, o); setO({ ...o, password: "" }); await reload(); notify("رمز عبور مسیر فعال شد", "lock"); }}>{view.config.authOn ? "به‌روزرسانی" : "فعال کردن"}</AsyncButton>
        {view.config.authOn && <AsyncButton className={BTN_G + " h-11 px-4 text-sm"} confirmText="رمز عبور مسیر برداشته شود؟" onClick={async () => { await api.paas.setBasicAuth(app.id, null); await reload(); notify("رمز عبور مسیر برداشته شد"); }}>برداشتن</AsyncButton>}
      </div>
    </Card>
  );
}

/* ================= usage, budget, outbound IP ================= */
export function AppUsage({ app }: { app: PaasApp }) {
  const { data, error, reload } = useRuntime(app.id);
  const { notify } = useApp();
  const [b, setB] = useState<{ budget: string; pct: string; stop: boolean; traffic: string } | null>(null);
  if (!data) return <Loading error={error} />;
  const c = data.config;
  const form = b ?? { budget: c.budget ? String(c.budget) : "", pct: String(c.budgetAlertPct), stop: c.budgetStop, traffic: c.trafficAlertGb ? String(c.trafficAlertGb) : "" };
  const pct = c.budget ? Math.min(100, Math.round((data.spend.amount / c.budget) * 100)) : 0;
  const maxDay = Math.max(1, ...data.traffic.days.map((d) => d.bytes));
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="هزینه این ماه و بودجه" icon="wallet">
        <div className="flex items-baseline justify-between"><span className="text-2xl font-black tabular">{toman(data.spend.amount)}</span><span className="text-xs text-white/55">ماه {fa(data.spend.month.replace("-", "/"))}{c.budget ? " · از " + toman(c.budget) : ""}</span></div>
        {c.budget > 0 && <div className="mt-3 h-2 rounded-full bg-white/[0.08] overflow-hidden" role="progressbar" aria-label="مصرف بودجه" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className={"h-full " + (pct >= 100 ? "bg-rose-400" : pct >= c.budgetAlertPct ? "bg-amber-400" : "acc-bg")} style={{ width: pct + "%" }} /></div>}
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <Field label="سقف بودجه ماهانه (تومان)" hint="خالی = بدون سقف"><input value={form.budget} inputMode="numeric" onChange={(e) => setB({ ...form, budget: e.target.value.replace(/\D/g, "") })} dir="ltr" className={INPUT + " text-left tabular"} /></Field>
          <Field label="هشدار در"><Select label="درصد هشدار" value={form.pct} onChange={(v) => setB({ ...form, pct: v })} options={[50, 70, 80, 90].map((p) => ({ value: String(p), label: fa(p) + "٪ بودجه" }))} /></Field>
        </div>
        <div className="flex items-center justify-between gap-3 text-sm mt-3"><span>با رسیدن به سقف، اپ خاموش شود<span className="block text-[11px] text-white/50">خاموش نشود: فقط اعلان می‌گیرید</span></span><Switch on={form.stop} onChange={(v) => setB({ ...form, stop: v })} label="خاموش شدن در سقف بودجه" /></div>
        <Field label="هشدار ترافیک ماهانه (گیگابایت)" hint="خالی = بدون هشدار" className="mt-3"><input value={form.traffic} inputMode="numeric" onChange={(e) => setB({ ...form, traffic: e.target.value.replace(/\D/g, "") })} dir="ltr" className={INPUT + " text-left tabular"} /></Field>
        <AsyncButton className={BTN_P + " h-10 px-4 text-sm mt-4"} onClick={async () => {
          await api.paas.setRuntime(app.id, { budget: num(form.budget), budgetAlertPct: num(form.pct) || 80, budgetStop: form.stop, trafficAlertGb: num(form.traffic) });
          setB(null); await reload(); notify("بودجه و هشدارها ذخیره شد", "check");
        }}>ذخیره</AsyncButton>
        {data.spend.history.length > 1 && <ul className="mt-4 pt-3 border-t border-white/[0.08] space-y-1 text-xs">{data.spend.history.map((h) => <li key={h.month} className="flex justify-between"><span className="text-white/55">{fa(h.month.replace("-", "/"))}</span><span className="tabular">{toman(h.amount)}</span></li>)}</ul>}
      </Card>
      <div className="space-y-4">
        <Card title="ترافیک" icon="activity">
          <div className="flex items-baseline justify-between"><span className="text-2xl font-black tabular">{bytes(data.traffic.monthBytes)}</span><span className="text-xs text-white/55">این ماه{c.trafficAlertGb ? " · هشدار در " + fa(c.trafficAlertGb) + " گیگ" : ""}</span></div>
          {data.traffic.days.length ? (
            <div className="mt-4 flex items-end gap-[3px] h-24" role="img" aria-label="ترافیک روزانه ۳۰ روز اخیر">
              {data.traffic.days.map((d) => <span key={d.day} title={d.day + " · " + bytes(d.bytes)} className="flex-1 acc-bg rounded-t opacity-80" style={{ height: Math.max(3, (d.bytes / maxDay) * 100) + "%" }} />)}
            </div>
          ) : <p className="text-[11px] text-white/45 mt-3">ترافیک هر ۵ دقیقه ثبت می‌شود.</p>}
        </Card>
        <Card title="IP خروجی" icon="network">
          {data.egressIps.length ? <>
            <p className="text-sm text-white/60 leading-7">اتصال‌های خروجی اپ (به API بانک، درگاه پرداخت، سرویس پیامک…) از این نشانی‌ها انجام می‌شود؛ برای لیست سفید همه را ثبت کنید.</p>
            <ul className="mt-2 space-y-1">{data.egressIps.map((ip) => <li key={ip}><CopyText text={ip} className="font-mono text-sm" /></li>)}</ul>
          </> : <p className="text-sm text-white/55">IP خروجی ثابت روی این پلتفرم تنظیم نشده است.</p>}
        </Card>
        <Card title="محدودیت‌های پلن" icon="gauge">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-white/55">بیلد در ۲۴ ساعت</dt><dd className="tabular">{data.limits.deploysPerDay ? fa(data.limits.deploysToday) + " از " + fa(data.limits.deploysPerDay) : "نامحدود"}</dd></div>
            <div className="flex justify-between"><dt className="text-white/55">حداکثر زمان بیلد</dt><dd>{fa(data.limits.maxBuildMinutes)} دقیقه</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  );
}

/* ================= events timeline ================= */
const EVENT: Record<string, [string, string, "green" | "blue" | "amber" | "red" | "gray"]> = {
  deploy: ["rocket", "استقرار", "green"], deploy_failed: ["circle-alert", "استقرار ناموفق", "red"], start: ["play", "روشن", "green"], stop: ["pause", "خاموش", "gray"],
  restart: ["refresh-cw", "ری‌استارت", "blue"], crash: ["triangle-alert", "کرش", "red"], oom: ["memory-stick", "کمبود حافظه", "red"], scale: ["sliders-horizontal", "تغییر مقیاس", "blue"],
  health_failed: ["heart-pulse", "سلامت ناموفق", "amber"], budget: ["wallet", "بودجه", "amber"], traffic: ["activity", "ترافیک", "amber"],
};
export function AppEvents({ app }: { app: PaasApp }) {
  const { data, error } = useRuntime(app.id);
  const [filter, setFilter] = useState("all");
  if (!data) return <Loading error={error} />;
  const shown = data.events.filter((e) => filter === "all" || (filter === "problems" ? ["deploy_failed", "crash", "oom", "health_failed"].includes(e.kind) : !["deploy_failed", "crash", "oom", "health_failed"].includes(e.kind)));
  return (
    <Card title="رویدادها" icon="history" action={<Tabs size="sm" value={filter} onChange={setFilter} label="فیلتر رویدادها" options={[{ id: "all", label: "همه" }, { id: "problems", label: "مشکلات" }, { id: "ops", label: "عملیات" }]} />}>
      {shown.length === 0 ? <Empty icon="history" title="رویدادی ثبت نشده است" /> : (
        <ol className="relative border-r border-white/[0.1] mr-2 space-y-4">
          {shown.map((e) => {
            const [icon, label, tone] = EVENT[e.kind] ?? ["info", e.kind, "gray"];
            return (
              <li key={e.id} className="pr-5 relative">
                <span className="absolute -right-[9px] top-0.5 w-[18px] h-[18px] rounded-full bg-[#0b1220] border border-white/20 grid place-items-center"><Icon name={icon} size={10} /></span>
                <span className="flex flex-wrap items-center gap-2"><Badge tone={tone}>{label}</Badge><span className="text-[11px] text-white/50">{e.at}</span></span>
                <p className="text-sm text-white/75 mt-1 break-words">{e.message}</p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

/* ================= deploy-failure explanation ================= */
export function FailureHint({ kind }: { kind?: string }) {
  const f = kind ? FAILURES[kind as FailureKind] : undefined;
  if (!f) return null;
  return (
    <aside role="note" className="rounded-xl border border-amber-300/30 bg-amber-400/[0.07] p-4 text-sm">
      <b className="flex items-center gap-2 text-amber-200"><Icon name="lightbulb" size={15} />{f.title}</b>
      <p className="text-white/70 leading-7 mt-1">{f.explain}</p>
      <ul className="mt-2 space-y-1 list-disc pr-5 text-white/70 leading-7">{f.fix.map((x) => <li key={x}>{x}</li>)}</ul>
    </aside>
  );
}

/** deploy without the layer cache (this deployment only) */
export function DeployNoCache({ app, onLog }: { app: PaasApp; onLog: (id: string) => void }) {
  const { notify } = useApp();
  if (app.source !== "git" && app.source !== "image") return null;
  return <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} confirmText="بیلد کامل بدون کش؟ (کندتر؛ برای رفع مشکلات کش)" onClick={async () => { const dep = await api.paas.deploy(app.id, { noCache: true, message: "استقرار بدون کش" }); onLog(dep); notify("بیلد بدون کش شروع شد", "rocket"); }}><Icon name="rotate-ccw" size={13} />استقرار بدون کش</AsyncButton>;
}

/* ================= domain options ================= */
export function DomainOptions({ app }: { app: PaasApp }) {
  const { data, error, reload } = useRuntime(app.id);
  const { notify } = useApp();
  const db = useDB(); const myId = useMyId();
  const others = db.paasApps.filter((a) => a.userId === myId && a.id !== app.id && a.status !== "suspended");
  const [edit, setEdit] = useState<{ id: string; target: string; code: 301 | 302; keepPath: boolean } | null>(null);
  const [move, setMove] = useState<{ id: string; to: string } | null>(null);
  if (!data) return <Loading error={error} />;
  const active = app.domains.filter((d) => d.status === "active");
  return (
    <Card title="ریدایرکت، انتقال و زیردامنه پیش‌فرض" icon="split" className="lg:col-span-2">
      <div className="flex items-center justify-between gap-3 text-sm mb-4"><span>زیردامنه پیش‌فرض <span dir="ltr" className="font-mono text-xs">{app.url.replace("https://", "")}</span><span className="block text-[11px] text-white/50">خاموش: اپ فقط از دامنه‌های اختصاصی در دسترس است</span></span>
        <Switch on={data.config.defaultDomain} onChange={async (v) => { try { await api.paas.setRuntime(app.id, { defaultDomain: v }); await reload(); notify(v ? "زیردامنه پیش‌فرض روشن شد" : "زیردامنه پیش‌فرض خاموش شد", "globe"); } catch (e) { notify((e as Error).message, "circle-alert"); } }} label="زیردامنه پیش‌فرض" /></div>
      {active.length === 0 ? <p className="text-[11px] text-white/50">برای ریدایرکت یا انتقال، اول یک دامنه اختصاصی تأییدشده لازم است. برای همه زیردامنه‌ها، دامنه را به‌شکل <span dir="ltr">*.example.com</span> اضافه کنید (گواهی wildcard با تأیید DNS صادر می‌شود).</p> : (
        <ul className="space-y-2">
          {active.map((d) => {
            const r = data.redirects.find((x) => x.domainId === d.id);
            return (
              <li key={d.id} className="rounded-xl bg-white/[0.03] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm"><span dir="ltr">{d.host}</span>{r ? <span className="text-[11px] text-white/55"> → {fa(r.code)} <span dir="ltr">{r.target}</span></span> : null}</span>
                  <span className="flex gap-2">
                    <button type="button" className={BTN_G + " h-8 px-3 text-xs"} onClick={() => setEdit({ id: d.id, target: r?.target ?? "https://", code: (r?.code === 302 ? 302 : 301), keepPath: r?.keepPath ?? true })}>ریدایرکت</button>
                    {r && <AsyncButton className={BTN_G + " h-8 px-3 text-xs"} onClick={async () => { await api.paas.setRedirect(d.id, null); await reload(); notify("ریدایرکت برداشته شد"); }}>سرو اپ</AsyncButton>}
                    {others.length > 0 && <button type="button" className={BTN_G + " h-8 px-3 text-xs"} onClick={() => setMove({ id: d.id, to: others[0].id })}>انتقال</button>}
                  </span>
                </div>
                {edit?.id === d.id && (
                  <div className="grid sm:grid-cols-[1fr_8rem_auto] gap-2 mt-3 items-end">
                    <Field label="مقصد"><input value={edit.target} onChange={(e) => setEdit({ ...edit, target: e.target.value.trim() })} dir="ltr" className={INPUT + " text-left h-10"} /></Field>
                    <Field label="نوع"><Select label="نوع ریدایرکت" value={String(edit.code)} onChange={(v) => setEdit({ ...edit, code: v === "302" ? 302 : 301 })} options={[{ value: "301", label: "۳۰۱ دائمی" }, { value: "302", label: "۳۰۲ موقت" }]} /></Field>
                    <AsyncButton className={BTN_P + " h-10 px-4 text-sm"} onClick={async () => { await api.paas.setRedirect(d.id, { target: edit.target, code: edit.code, keepPath: edit.keepPath }); setEdit(null); await reload(); notify("ریدایرکت ذخیره شد", "check"); }}>ذخیره</AsyncButton>
                    <span className="flex items-center gap-2 text-xs text-white/70 sm:col-span-3"><Switch on={edit.keepPath} onChange={(v) => setEdit({ ...edit, keepPath: v })} label="حفظ مسیر" />مسیر و پارامترهای درخواست به مقصد اضافه شود</span>
                  </div>
                )}
                {move?.id === d.id && (
                  <div className="flex flex-wrap gap-2 mt-3 items-center">
                    <Select label="اپ مقصد" value={move.to} onChange={(v) => setMove({ ...move, to: v })} options={others.map((a) => ({ value: a.id, label: a.name }))} className="min-w-48" />
                    <AsyncButton className={BTN_P + " h-10 px-4 text-sm"} confirmText={"دامنه " + d.host + " به اپ دیگر منتقل شود؟"} onClick={async () => { await api.paas.moveDomain(d.id, move.to); setMove(null); notify("دامنه منتقل شد", "globe"); }}>انتقال</AsyncButton>
                    <button type="button" className="text-xs text-white/55" onClick={() => setMove(null)}>انصراف</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ================= CI templates and cloning (settings tab) ================= */
export function CiTemplates({ app }: { app: PaasApp }) {
  const [tab, setTab] = useState("github");
  const t = ciTemplates(app, SITE_URL);
  const code = tab === "github" ? t.github : tab === "gitlab" ? t.gitlab : t.curl;
  return (
    <Card title="استقرار از CI" icon="workflow" action={<Tabs size="sm" value={tab} onChange={setTab} label="سرویس CI" options={[{ id: "github", label: "GitHub Actions" }, { id: "gitlab", label: "GitLab CI" }, { id: "curl", label: "API" }]} />}>
      <p className="text-sm text-white/60 leading-7">یک توکن خواندنی‌نوشتنی از «SSH و API» بسازید و با نام <code dir="ltr">GEREH_TOKEN</code> در secrets مخزن بگذارید؛ سپس این فایل را اضافه کنید.</p>
      <div className="relative mt-3">
        <pre dir="ltr" tabIndex={0} aria-label="نمونه پیکربندی CI" className="text-left text-[11px] leading-5 font-mono bg-black/40 rounded-xl p-3 max-h-80 overflow-auto whitespace-pre">{code}</pre>
        <span className="absolute top-2 left-2"><CopyText text={code} className="text-[11px]" /></span>
      </div>
    </Card>
  );
}

export function CloneApp({ app }: { app: PaasApp }) {
  const { notify } = useApp(); const router = useRouter();
  const [name, setName] = useState((app.name + "-copy").slice(0, 30));
  if (app.product !== "app") return null;
  return (
    <Card title="کپی اپ" icon="copy">
      <p className="text-sm text-white/65 leading-7">یک اپ جدید با همین تنظیمات، متغیرها، پردازش‌ها، زمان‌بندی‌ها و گزینه‌های اجرا؛ بدون داده (دیسک خالی، پایگاه داده متصل نمی‌شود، دامنه‌ها منتقل نمی‌شوند).</p>
      <div className="flex gap-2 mt-3">
        <label className="sr-only" htmlFor="clone-name">نام اپ جدید</label>
        <input id="clone-name" value={name} onChange={(e) => setName(e.target.value.toLowerCase().trim())} dir="ltr" className={INPUT + " text-left"} />
        <AsyncButton className={BTN_P + " h-11 px-4 text-sm shrink-0"} onClick={async () => { const id = await api.paas.cloneApp(app.id, name); notify("کپی ساخته شد؛ استقرار شروع شد", "copy"); router.push(("/panel/apps/" + id) as never); }}>ساخت کپی</AsyncButton>
      </div>
    </Card>
  );
}

/* ================= staff: plan deploy limits ================= */
export function PlanLimits() {
  const { notify } = useApp();
  const [rows, setRows] = useState<{ id: string; name: string; deploysPerDay: number; maxBuildMinutes: number }[] | null>(null);
  useEffect(() => { void api.paas.adminPlanLimits().then(setRows).catch(() => setRows([])); }, []);
  return (
    <Card title="محدودیت استقرار پلن‌های اپ" icon="timer" className="lg:col-span-2" pad="p-3 sm:p-4">
      {!rows ? <p className="text-sm text-white/55 p-2">…</p> : (
        <ul className="space-y-1">{rows.map((r, i) => (
          <li key={r.id} className="grid grid-cols-[1fr_8rem_8rem_auto] gap-2 items-end p-2">
            <span className="text-sm pb-2.5">{r.name} <span className="text-[11px] text-white/45">{r.id}</span></span>
            <Field label="بیلد در روز (۰ = نامحدود)"><input value={r.deploysPerDay} inputMode="numeric" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, deploysPerDay: num(e.target.value) } : x)))} dir="ltr" className={INPUT + " h-10 text-left"} /></Field>
            <Field label="حداکثر دقیقه بیلد"><input value={r.maxBuildMinutes} inputMode="numeric" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, maxBuildMinutes: num(e.target.value) } : x)))} dir="ltr" className={INPUT + " h-10 text-left"} /></Field>
            <AsyncButton className={BTN_G + " h-10 px-3 text-xs"} onClick={async () => { await api.paas.adminSetPlanLimits(r.id, { deploysPerDay: r.deploysPerDay, maxBuildMinutes: r.maxBuildMinutes }); notify("ذخیره شد", "check"); }}>ذخیره</AsyncButton>
          </li>
        ))}</ul>
      )}
    </Card>
  );
}

