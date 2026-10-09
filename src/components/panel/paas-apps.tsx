"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BTN_G, BTN_P, INPUT } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { appMonthly, DB_ENGINES, DISK_PRICE_GB, defaultEnvKeyFor, PAAS_NAME_RE, PAAS_RESERVED, STACKS, stackOf } from "@/lib/paas";
import { api, useDB, useMyId, useSession } from "@/lib/store";
import type { PaasApp } from "@/lib/types";
import { zipFolder } from "@/lib/zip-client";
import { useApp } from "../app-context";
import { AppJobs } from "./paas-jobs";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AreaChart, AsyncButton, CopyText, Modal, PageTitle, Select, Switch, Tabs } from "../ui-client";
import { Cost, cpuLabel, DeployPill, EnvEditor, envProblems, type EnvRow, PlanPicker, ramLabel, StatusPill } from "./paas-shared";

const SOURCES = [
  { id: "git", icon: "code-xml", label: "مخزن Git", hint: "GitHub، GitLab، Gitea یا هر مخزن HTTPS؛ با هر push خودکار مستقر می‌شود" },
  { id: "zip", icon: "upload", label: "فایل ZIP یا پوشه", hint: "پوشه پروژه را مستقیم انتخاب کنید یا فایل ZIP آن را بارگذاری کنید (تا ۲۰۰ مگ)" },
  { id: "image", icon: "box", label: "ایمیج Docker", hint: "از Docker Hub، GHCR یا هر رجیستری عمومی" },
  { id: "compose", icon: "layers", label: "Docker Compose", hint: "ZIP شامل docker-compose.yml و سرویس‌ها" },
] as const;

/* ================= list ================= */
export function UserApps() {
  const db = useDB(); const myId = useMyId();
  const apps = db.paasApps.filter((a) => a.userId === myId);
  const monthly = apps.reduce((s, a) => s + a.hourly * 720, 0);
  return (
    <div>
      <PageTitle title="اپ‌ها" sub={apps.length ? fa(apps.length) + " اپ · حدود " + toman(monthly) + " در ماه" : "کد را بفرستید؛ بیلد، اجرا، SSL و مقیاس با ما."}
        action={<div className="flex gap-2"><Link href={"/panel/apps/templates" as never} className={BTN_G + " h-10 px-4 text-sm"}><Icon name="sparkles" size={16} />اپ‌های آماده</Link><Link href="/panel/apps/new" className={BTN_P + " h-10 px-4 text-sm"}><Icon name="plus" size={16} />اپ جدید</Link></div>} />
      {apps.length === 0 ? (
        <Card><Empty icon="rocket" title="هنوز اپی ندارید" text="از Git، فایل ZIP یا ایمیج Docker در کمتر از دو دقیقه اپ بسازید؛ پرداخت ساعتی از کیف پول."
          action={<div className="flex gap-2 justify-center"><Link href="/panel/apps/new" className={BTN_P + " h-10 px-5 text-sm"}>ساخت اولین اپ</Link><Link href={"/panel/apps/templates" as never} className={BTN_G + " h-10 px-4 text-sm"}>اپ‌های آماده</Link><Link href="/paas" className={BTN_G + " h-10 px-4 text-sm"}>معرفی گره اپ</Link></div>} /></Card>
      ) : (
        <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {apps.map((a) => (
            <li key={a.id}>
              <Link href={("/panel/apps/" + a.id) as never} className="block rounded-[1.4rem] p-5 bg-white/[0.04] border border-white/[0.1] hover:border-white/25 transition">
                <span className="flex items-center justify-between gap-2"><b dir="ltr" className="truncate">{a.name}</b><StatusPill s={a.status} /></span>
                <span className="block text-xs text-white/55 mt-1">{stackOf(a.stack)?.label ?? a.stack} · {a.source === "git" ? a.gitBranch : a.source}</span>
                <span dir="ltr" className="block text-xs acc mt-3 truncate text-right">{a.url.replace("https://", "")}</span>
                <span className="flex justify-between text-[11px] text-white/50 mt-3"><span>{fa(a.instances)} نمونه</span><span className="tabular">{fa(a.hourly)} تومان / ساعت</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ================= create ================= */
export function NewApp() {
  const db = useDB(); const router = useRouter(); const session = useSession();
  const { notify } = useApp();
  const me = db.users.find((u) => u.id === session?.userId);
  const plans = db.paasPlans.filter((p) => p.kind === "app");
  const [source, setSource] = useState<"git" | "zip" | "image" | "compose">("git");
  const [f, setF] = useState({ name: "", gitUrl: "", gitBranch: "main", image: "", rootDir: "", buildCommand: "", startCommand: "", stack: "node", port: 3000, planId: "app-micro", instances: 1, diskGb: 0 });
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [upload, setUpload] = useState<{ uploadId: string; stack: string | null; files: number; bytes: number; name: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const plan = plans.find((p) => p.id === f.planId) ?? plans[0];
  const monthly = plan ? appMonthly(plan, f.instances, f.diskGb) : 0;
  const domain = db.settings.paasDomain || "gereh.dev";
  const nameError = f.name && (!PAAS_NAME_RE.test(f.name) ? "حروف کوچک انگلیسی، عدد و خط تیره؛ ۳ تا ۳۰ نویسه" : PAAS_RESERVED.has(f.name) ? "این نام رزرو شده است" : "");
  const pickStack = (id: string) => set({ stack: id, port: stackOf(id)?.port ?? 3000 });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(""); setProgress(0);
    try {
      const r = await api.paas.upload(file, f.rootDir, setProgress);
      setUpload({ ...r, name: file.name });
      if (r.stack) pickStack(r.stack);
      if (!f.name) set({ name: file.name.replace(/\.zip$/i, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+|-+$/g, "").slice(0, 30) });
    } catch (e) { setError((e as Error).message); } finally { setProgress(null); }
  };
  const create = async () => {
    setError("");
    const envErr = envProblems(env);
    if (envErr) return setError(envErr);
    setBusy(true);
    try {
      const id = await api.paas.createApp({ ...f, source, uploadId: upload?.uploadId, env: env.filter((e) => e.key.trim()).map((e) => ({ key: e.key.trim(), value: e.value, secret: e.secret })) });
      notify("اپ ساخته شد؛ بیلد شروع شد", "rocket");
      router.push(("/panel/apps/" + id) as never);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const ready = !!f.name && !nameError && (source === "git" ? !!f.gitUrl : source === "image" ? !!f.image : !!upload);

  return (
    <div>
      <PageTitle back={["/panel/apps", "اپ‌ها"]} title="اپ جدید" sub="منبع کد را انتخاب کنید؛ بقیه را پیشنهاد می‌دهیم." />
      <div className="grid xl:grid-cols-[1fr_20rem] gap-4 items-start">
        <div className="space-y-4">
          <Card title="۱. منبع" icon="code-xml">
            <div role="radiogroup" aria-label="منبع کد" className="grid sm:grid-cols-2 gap-2">
              {SOURCES.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={source === s.id} onClick={() => { setSource(s.id); if (s.id === "image") pickStack("docker"); if (s.id === "compose") pickStack("compose"); }}
                  className={"text-right rounded-2xl p-4 border transition flex gap-3 " + (source === s.id ? "bg-sky-400/10 border-sky-300/50" : "bg-white/[0.03] border-white/[0.1] hover:border-white/25")}>
                  <Icon name={s.icon} size={20} className="acc shrink-0 mt-0.5" /><span><b className="text-sm">{s.label}</b><span className="block text-[11px] text-white/55 mt-1 leading-5">{s.hint}</span></span>
                </button>
              ))}
            </div>
            <div className="mt-5 space-y-4">
              {source === "git" && <div className="grid sm:grid-cols-[1fr_10rem] gap-3">
                <Field label="نشانی مخزن" hint="برای مخزن خصوصی، توکن دسترسی را در نشانی بگذارید: https://TOKEN@github.com/user/repo.git"><input value={f.gitUrl} onChange={(e) => set({ gitUrl: e.target.value.trim() })} dir="ltr" placeholder="https://github.com/user/repo.git" className={INPUT + " text-left"} /></Field>
                <Field label="شاخه"><input value={f.gitBranch} onChange={(e) => set({ gitBranch: e.target.value.trim() })} dir="ltr" className={INPUT + " text-left"} /></Field>
              </div>}
              {source === "image" && <Field label="ایمیج" hint="باید عمومی باشد؛ پورتی که اپ روی آن گوش می‌دهد را پایین وارد کنید."><input value={f.image} onChange={(e) => set({ image: e.target.value.trim() })} dir="ltr" placeholder="ghcr.io/user/app:latest" className={INPUT + " text-left"} /></Field>}
              {(source === "zip" || source === "compose") && (
                <div className="space-y-2">
                  <label className="block rounded-2xl border-2 border-dashed border-white/[0.15] hover:border-white/30 p-6 text-center cursor-pointer transition">
                    <input type="file" accept=".zip,application/zip" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
                    <Icon name="cloud-upload" size={28} className="mx-auto acc" />
                    <span className="block mt-2 text-sm font-bold">{upload ? upload.name : "فایل ZIP پروژه را انتخاب کنید"}</span>
                    <span className="block text-[11px] text-white/55 mt-1">{upload ? fa(upload.files) + " فایل · " + fa(Math.round(upload.bytes / 1024 / 1024 * 10) / 10, 1) + " مگابایت" + (upload.stack ? " · تشخیص: " + (stackOf(upload.stack)?.label ?? upload.stack) : "") : "node_modules، .git و فایل‌های بیلد را داخل ZIP نگذارید"}</span>
                  </label>
                  <label className={BTN_G + " w-full h-11 text-sm cursor-pointer"}>
                    {/* @ts-expect-error non-standard but supported by every current browser */}
                    <input type="file" webkitdirectory="" multiple className="sr-only" onChange={async (e) => {
                      const list = e.target.files; if (!list?.length) return;
                      try { setError(""); const z = await zipFolder(list); if (z.skipped) notify(fa(z.skipped) + " فایل (node_modules، .git، .env…) کنار گذاشته شد", "info"); await onFile(z.file); }
                      catch (err) { setError((err as Error).message); }
                    }} />
                    <Icon name="folder-open" size={16} />انتخاب پوشه پروژه
                  </label>
                  {progress !== null && <div className="mt-2 h-1.5 rounded-full bg-white/[0.08] overflow-hidden" role="progressbar" aria-label="پیشرفت بارگذاری" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full acc-bg" style={{ width: progress + "%" }} /></div>}
                </div>
              )}
            </div>
          </Card>

          <Card title="۲. پشته و اجرا" icon="terminal">
            {source !== "image" && source !== "compose" && (
              <div role="radiogroup" aria-label="پشته" className="flex flex-wrap gap-1.5 mb-4">
                {STACKS.filter((s) => s.id !== "compose").map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={f.stack === s.id} onClick={() => pickStack(s.id)} title={s.hint}
                    className={"h-9 px-3 rounded-xl text-xs border transition " + (f.stack === s.id ? "bg-sky-400/15 border-sky-300/50 text-white font-bold" : "border-white/[0.12] text-white/70 hover:text-white")}>{s.label}</button>
                ))}
              </div>
            )}
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="پورت اپ" hint="اپ باید روی 0.0.0.0 و این پورت گوش دهد (متغیر PORT هم تنظیم می‌شود)"><input value={f.port} inputMode="numeric" onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, "")) || 0 })} dir="ltr" className={INPUT + " text-left"} /></Field>
              <Field label="پوشه ریشه (اختیاری)" hint="برای monorepo"><input value={f.rootDir} onChange={(e) => set({ rootDir: e.target.value.trim() })} dir="ltr" placeholder="apps/web" className={INPUT + " text-left"} /></Field>
            </div>
            <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} className="mt-4 text-xs acc inline-flex items-center gap-1"><Icon name="chevron-down" size={13} className={advanced ? "rotate-180" : ""} />دستورهای بیلد و اجرا</button>
            {advanced && <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <Field label="دستور بیلد" hint="خالی = تشخیص خودکار"><input value={f.buildCommand} onChange={(e) => set({ buildCommand: e.target.value })} dir="ltr" placeholder={stackOf(f.stack)?.build ?? ""} className={INPUT + " text-left font-mono text-xs"} /></Field>
              <Field label="دستور اجرا" hint="خالی = تشخیص خودکار"><input value={f.startCommand} onChange={(e) => set({ startCommand: e.target.value })} dir="ltr" placeholder={stackOf(f.stack)?.start ?? ""} className={INPUT + " text-left font-mono text-xs"} /></Field>
            </div>}
          </Card>

          <Card title="۳. منابع" icon="gauge">
            <PlanPicker plans={plans} value={f.planId} onChange={(id) => set({ planId: id })} label="پلن اپ" />
            <div className="grid sm:grid-cols-2 gap-3 mt-4">
              <Field label="تعداد نمونه" hint="برای دسترس‌پذیری بالا دست‌کم ۲"><Select label="تعداد نمونه" value={String(f.instances)} onChange={(v) => set({ instances: Number(v), diskGb: Number(v) > 1 ? 0 : f.diskGb })} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: fa(n) }))} /></Field>
              <Field label="دیسک دائمی (گیگابایت)" hint={f.instances > 1 ? "فقط با یک نمونه" : "برای فایل‌های آپلودی؛ ماهانه " + toman(DISK_PRICE_GB) + " هر گیگ"}><Select label="دیسک دائمی" value={String(f.diskGb)} onChange={(v) => set({ diskGb: Number(v) })} options={(f.instances > 1 ? [0] : [0, 1, 5, 10, 20, 50]).map((n) => ({ value: String(n), label: n ? fa(n) + " گیگ" : "ندارد" }))} /></Field>
            </div>
          </Card>

          <Card title="۴. متغیرهای محیطی" icon="sliders-horizontal">
            <EnvEditor rows={env} onChange={setEnv} />
            <p className="text-[11px] text-white/50 mt-3">پایگاه داده را بعد از ساخت اپ متصل کنید؛ DATABASE_URL خودکار اضافه می‌شود.</p>
          </Card>
        </div>

        <div className="xl:sticky xl:top-24 space-y-4">
          <Card title="نام و خلاصه" icon="rocket">
            <Field label="نام اپ" error={nameError || undefined}><input value={f.name} onChange={(e) => set({ name: e.target.value.toLowerCase() })} dir="ltr" placeholder="my-app" aria-invalid={!!nameError} className={INPUT + " text-left"} /></Field>
            <p dir="ltr" className="text-xs text-white/55 mt-2 text-right truncate">https://{f.name || "my-app"}.{domain}</p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-white/55">پلن</dt><dd>{plan ? plan.name + " (" + cpuLabel(plan.cpu) + "، " + ramLabel(plan.ramMb) + ")" : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-white/55">نمونه</dt><dd>{fa(f.instances)}</dd></div>
            </dl>
            <div className="mt-4 pt-4 border-t border-white/[0.08]"><Cost monthly={monthly} /></div>
            {me && <p className="text-[11px] text-white/50 mt-3">موجودی کیف پول: {toman(me.balance)}</p>}
            {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
            <button type="button" disabled={!ready || busy} onClick={create} className={BTN_P + " w-full h-11 mt-4"}>{busy ? <Icon name="loader-circle" size={16} className="animate-spin" /> : <Icon name="rocket" size={16} />}ساخت و استقرار</button>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ================= detail ================= */
const TABS = [
  { id: "overview", label: "نمای کلی", icon: "layout-dashboard" }, { id: "deploys", label: "استقرارها", icon: "rocket" }, { id: "logs", label: "لاگ‌ها", icon: "terminal" },
  { id: "env", label: "متغیرها", icon: "sliders-horizontal" }, { id: "domains", label: "دامنه‌ها", icon: "globe" }, { id: "dbs", label: "پایگاه داده", icon: "database" },
  { id: "scale", label: "منابع و مقیاس", icon: "gauge" }, { id: "jobs", label: "پردازش و زمان‌بندی", icon: "clock" }, { id: "settings", label: "تنظیمات", icon: "settings-2" },
];

export function AppDetail({ id }: { id: string }) {
  const db = useDB(); const myId = useMyId();
  const { notify } = useApp();
  const app = db.paasApps.find((a) => a.id === id && a.userId === myId);
  const [tab, setTab] = useState("overview");
  const [logDep, setLogDep] = useState<string | null>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  if (!app) return <Card><Empty icon="rocket" title="اپ پیدا نشد" action={<Link href="/panel/apps" className={BTN_G + " px-4 h-10 text-sm"}>بازگشت به اپ‌ها</Link>} /></Card>;
  const busy = app.deployments.some((d) => ["queued", "building", "deploying"].includes(d.status));
  const suspended = app.status === "suspended";
  const deployZip = async (file?: File) => {
    if (!file) return;
    try { const r = await api.paas.upload(file, app.rootDir); const dep = await api.paas.deploy(app.id, { uploadId: r.uploadId, message: file.name }); setLogDep(dep); notify("بیلد شروع شد", "rocket"); }
    catch (e) { notify((e as Error).message, "circle-alert"); }
  };
  return (
    <div>
      <AutoRefresh active={busy || app.status === "creating"} />
      <PageTitle back={["/panel/apps", "اپ‌ها"]} title={<span dir="ltr" className="inline-block">{app.name}</span>}
        sub={<span className="flex flex-wrap items-center gap-x-4 gap-y-1"><StatusPill s={app.status} /><a href={app.url} target="_blank" rel="noopener" dir="ltr" className="acc text-xs">{app.url.replace("https://", "")}</a><span className="text-xs">{stackOf(app.stack)?.label}</span><span className="text-xs tabular">{fa(app.hourly)} تومان / ساعت</span></span>}
        action={suspended ? <Badge tone="amber">معلق؛ کیف پول را شارژ کنید</Badge> : <>
          {(app.source === "zip" || app.source === "compose")
            ? <><input ref={zipRef} type="file" accept=".zip" className="sr-only" aria-label="ZIP نسخه جدید" onChange={(e) => deployZip(e.target.files?.[0])} /><button type="button" disabled={busy} onClick={() => zipRef.current?.click()} className={BTN_P + " h-10 px-4 text-sm"}><Icon name="upload" size={16} />بارگذاری نسخه جدید</button></>
            : <AsyncButton disabled={busy} className={BTN_P + " h-10 px-4 text-sm"} onClick={async () => { const dep = await api.paas.deploy(app.id); setLogDep(dep); notify("استقرار شروع شد", "rocket"); }}><Icon name="rocket" size={16} />استقرار مجدد</AsyncButton>}
          {app.liveDeployment && (app.status === "stopped"
            ? <AsyncButton className={BTN_G + " h-10 px-4 text-sm"} onClick={() => api.paas.power(app.id, "start")}><Icon name="play" size={16} />روشن</AsyncButton>
            : <><AsyncButton className={BTN_G + " h-10 px-4 text-sm"} confirmText="همه نمونه‌ها به‌ترتیب ری‌استارت شوند؟" onClick={() => api.paas.power(app.id, "restart")}><Icon name="refresh-cw" size={16} />ری‌استارت</AsyncButton>
              <AsyncButton danger className={BTN_G + " h-10 px-4 text-sm"} confirmText="اپ خاموش شود؟ تا روشن کردن دوباره، فقط هزینه دیسک محاسبه می‌شود." onClick={() => api.paas.power(app.id, "stop")}><Icon name="pause" size={16} />خاموش</AsyncButton></>)}
        </>} />
      <div className="overflow-x-auto no-scrollbar mb-6"><Tabs size="sm" value={tab} onChange={setTab} label="بخش‌های اپ" options={TABS} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "overview" && <AppOverview app={app} onLog={setLogDep} />}
        {tab === "deploys" && <AppDeploys app={app} onLog={setLogDep} />}
        {tab === "logs" && <AppLogs app={app} />}
        {tab === "env" && <AppEnv app={app} />}
        {tab === "domains" && <AppDomains app={app} />}
        {tab === "dbs" && <AppDbs app={app} />}
        {tab === "scale" && <AppScale app={app} />}
        {tab === "jobs" && <AppJobs app={app} />}
        {tab === "settings" && <AppSettings app={app} />}
      </div>
      <BuildLog depId={logDep} onClose={() => setLogDep(null)} />
    </div>
  );
}

/** re-reads state every 3s while something is building */
function AutoRefresh({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { void import("@/lib/store").then((m) => m.refresh()); }, 3000);
    return () => clearInterval(t);
  }, [active]);
  return null;
}

function BuildLog({ depId, onClose }: { depId: string | null; onClose: () => void }) {
  const [data, setData] = useState<{ status: string; log: string } | null>(null);
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!depId) return;
    let live = true;
    const tick = async () => {
      const d = await api.paas.deployment(depId).catch(() => null);
      if (!live || !d) return;
      setData(d);
      requestAnimationFrame(() => pre.current?.scrollTo({ top: pre.current.scrollHeight }));
      if (["queued", "building", "deploying"].includes(d.status)) setTimeout(tick, 2000);
    };
    void tick();
    return () => { live = false; };
  }, [depId]);
  return (
    <Modal open={!!depId} onClose={() => { setData(null); onClose(); }} title={"لاگ استقرار " + (depId ?? "")} icon="terminal" size="max-w-3xl">
      <div className="mb-3">{data ? <DeployPill s={data.status} /> : <Icon name="loader-circle" size={16} className="animate-spin" />}</div>
      <pre ref={pre} dir="ltr" tabIndex={0} aria-label="لاگ بیلد" className="text-left text-[12px] leading-6 font-mono bg-black/50 rounded-xl p-4 h-[55vh] overflow-auto whitespace-pre-wrap">{data?.log || "در انتظار شروع…"}</pre>
    </Modal>
  );
}

function MetricCard({ label, icon, values, unit }: { label: string; icon: string; values: number[]; unit: string }) {
  const cur = values.at(-1);
  return (
    <Card pad="p-5">
      <div className="flex items-center justify-between mb-3"><span className="text-xs text-white/55 flex items-center gap-2"><Icon name={icon} size={15} className="acc" />{label}</span><span className="font-black tabular">{cur === undefined ? "—" : fa(Math.round(cur))} <span className="text-[11px] font-normal text-white/55">{unit}</span></span></div>
      {values.length > 1 ? <AreaChart data={values} height={90} unit={unit} /> : <div className="h-[90px] grid place-items-center text-[11px] text-white/45">نمونه‌برداری هر ۵ دقیقه؛ نمودار به‌زودی پر می‌شود.</div>}
    </Card>
  );
}

function AppOverview({ app, onLog }: { app: PaasApp; onLog: (id: string) => void }) {
  const db = useDB();
  const plan = db.paasPlans.find((p) => p.id === app.planId);
  const live = app.deployments.find((d) => d.id === app.liveDeployment);
  const latest = app.deployments[0];
  return (
    <div className="space-y-4">
      {latest && latest.id !== app.liveDeployment && (
        <div role="status" className={"rounded-2xl px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-3 border " + (latest.status === "failed" ? "border-rose-300/30 bg-rose-400/[0.07]" : "border-sky-300/30 bg-sky-400/[0.07]")}>
          <span className="flex items-center gap-2"><DeployPill s={latest.status} />{latest.message || latest.ref}</span>
          <button type="button" onClick={() => onLog(latest.id)} className="text-xs acc">مشاهده لاگ</button>
        </div>
      )}
      <div className="grid md:grid-cols-3 gap-4">
        <MetricCard label="پردازنده" icon="cpu" values={app.metrics.map((m) => m.cpu)} unit="٪" />
        <MetricCard label="حافظه" icon="memory-stick" values={app.metrics.map((m) => m.ramMb)} unit="MB" />
        <MetricCard label="درخواست در دقیقه" icon="activity" values={app.metrics.map((m) => m.rpm)} unit="rpm" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="نسخه فعال" icon="rocket">
          {live ? <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-white/55">کامیت / منبع</dt><dd dir="ltr" className="font-mono">{live.ref || "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-white/55">توضیح</dt><dd className="truncate">{live.message || "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-white/55">زمان</dt><dd>{live.at}</dd></div>
            <button type="button" onClick={() => onLog(live.id)} className="text-xs acc">لاگ بیلد</button>
          </dl> : <p className="text-sm text-white/55">هنوز نسخه فعالی وجود ندارد.</p>}
        </Card>
        <Card title="منابع و هزینه" icon="gauge">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-white/55">پلن</dt><dd>{plan ? plan.name + " · " + cpuLabel(plan.cpu) + " · " + ramLabel(plan.ramMb) : app.planId}</dd></div>
            <div className="flex justify-between"><dt className="text-white/55">نمونه‌ها</dt><dd>{fa(app.instances)}{app.autoscale ? " تا " + fa(app.maxInstances) + " (خودکار)" : ""}</dd></div>
            <div className="flex justify-between"><dt className="text-white/55">دیسک دائمی</dt><dd>{app.diskGb ? fa(app.diskGb) + " گیگ در " + app.diskMount : "ندارد"}</dd></div>
            <div className="flex justify-between"><dt className="text-white/55">هزینه</dt><dd className="tabular">{fa(app.hourly)} تومان / ساعت</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  );
}

/** result of the image vulnerability scan; opens the report */
function ScanBadge({ d }: { d: PaasApp["deployments"][number] }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  if (!d.scanStatus || d.scanStatus === "failed") return null;
  if (d.scanStatus === "running") return <Badge tone="gray">در حال اسکن امنیتی</Badge>;
  const tone = d.scanCritical ? "red" : d.scanHigh ? "amber" : "green";
  const label = d.scanCritical ? fa(d.scanCritical) + " آسیب‌پذیری بحرانی" : d.scanHigh ? fa(d.scanHigh) + " آسیب‌پذیری مهم" : "بدون آسیب‌پذیری مهم";
  return (
    <>
      <button type="button" onClick={async () => { setOpen(true); setReport((await api.paas.scanReport(d.id)).report); }} title="گزارش اسکن امنیتی"><Badge tone={tone}><Icon name="shield-check" size={11} /> {label}</Badge></button>
      <Modal open={open} onClose={() => setOpen(false)} title="اسکن امنیتی ایمیج" icon="shield-check" size="max-w-2xl">
        <p className="text-sm text-white/65 leading-7">بسته‌های سیستم‌عامل و کتابخانه‌های ایمیج با پایگاه آسیب‌پذیری‌های شناخته‌شده (Trivy) مقایسه شده‌اند؛ فقط موارد مهم و بحرانی که نسخه اصلاح‌شده دارند. برای رفع، ایمیج پایه یا وابستگی را به‌روز و دوباره دیپلوی کنید.</p>
        <pre dir="ltr" tabIndex={0} aria-label="گزارش آسیب‌پذیری‌ها" className="mt-3 text-left text-[11px] leading-5 font-mono bg-black/40 rounded-xl p-3 max-h-[50vh] overflow-auto whitespace-pre">{report === null ? "…" : report || "No HIGH/CRITICAL vulnerabilities with a fix."}</pre>
      </Modal>
    </>
  );
}

function PreviewCard({ app, onLog }: { app: PaasApp; onLog: (id: string) => void }) {
  const { notify } = useApp();
  const [branch, setBranch] = useState("");
  const live = app.deployments.find((d) => d.id === app.previewDeployment);
  const building = app.deployments.find((d) => d.target === "preview" && ["queued", "building", "deploying"].includes(d.status));
  if (app.source !== "git" && app.source !== "zip") return null;
  return (
    <Card title="پیش‌نمایش (Preview)" icon="eye" className="mb-4">
      <p className="text-sm text-white/60 leading-7">نسخه جدید را کنار نسخه اصلی روی <span dir="ltr" className="font-mono text-xs">{app.previewUrl.replace("https://", "")}</span> بسازید و امتحان کنید؛ اگر خوب بود با یک کلیک و بدون بیلد دوباره به نسخه اصلی منتقل کنید. پیش‌نمایش به دیسک، پردازش‌ها و زمان‌بندی‌های اپ دسترسی ندارد و دستور انتشار در آن اجرا نمی‌شود.</p>
      {live && (
        <div className="mt-4 rounded-xl bg-emerald-400/[0.06] border border-emerald-300/20 p-4 flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0"><span className="flex items-center gap-2"><Badge tone="green" dot>فعال</Badge><a href={app.previewUrl} target="_blank" rel="noopener noreferrer" dir="ltr" className="text-sm acc truncate">{app.previewUrl.replace("https://", "")}</a></span>
            <span className="block text-[11px] text-white/50 mt-1">{live.branch ? <>شاخه <b dir="ltr">{live.branch}</b> · </> : null}<span dir="ltr" className="font-mono">{live.ref}</span> · {live.at}</span></span>
          <span className="flex flex-wrap gap-2">
            <AsyncButton className={BTN_P + " h-9 px-3 text-xs"} confirmText="این نسخه جایگزین نسخه اصلی شود؟ (دستور انتشار، اگر تعریف شده، اول اجرا می‌شود)" onClick={async () => { await api.paas.promote(app.id, live.id); notify("انتقال به نسخه اصلی شروع شد", "rocket"); }}><Icon name="rocket" size={13} />انتقال به نسخه اصلی</AsyncButton>
            <button type="button" onClick={() => onLog(live.id)} className={BTN_G + " h-9 px-3 text-xs"}>لاگ</button>
            <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} confirmText="پیش‌نمایش حذف شود؟" onClick={async () => { await api.paas.removePreview(app.id); notify("پیش‌نمایش حذف شد"); }}>حذف</AsyncButton>
          </span>
        </div>
      )}
      {building ? <p className="text-xs text-sky-200 mt-4 flex items-center gap-2"><Icon name="loader-circle" size={14} className="animate-spin" />پیش‌نمایش در حال ساخت… <button type="button" className="acc" onClick={() => onLog(building.id)}>لاگ</button></p>
        : app.source === "git" ? (
          <div className="flex flex-wrap gap-2 mt-4">
            <input dir="ltr" value={branch} onChange={(e) => setBranch(e.target.value.trim())} placeholder={app.gitBranch} aria-label="شاخه" className={INPUT + " h-10 max-w-xs font-mono text-left text-sm"} />
            <AsyncButton className={BTN_G + " h-10 px-4 text-sm"} onClick={async () => { await api.paas.deployPreview(app.id, { branch: branch || undefined }); notify("ساخت پیش‌نمایش شروع شد", "eye"); }}><Icon name="eye" size={15} />{live ? "پیش‌نمایش جدید" : "ساخت پیش‌نمایش"}</AsyncButton>
          </div>
        ) : <p className="text-xs text-white/50 mt-4">برای اپ‌های ZIP: <code dir="ltr">gereh deploy --preview</code></p>}
    </Card>
  );
}

function AppDeploys({ app, onLog }: { app: PaasApp; onLog: (id: string) => void }) {
  const TRIG: Record<string, string> = { create: "ساخت اپ", manual: "دستی", git: "push", cli: "CLI", api: "API", rollback: "بازگشت", config: "تغییر تنظیمات", promote: "انتقال پیش‌نمایش" };
  return (
    <>
    <PreviewCard app={app} onLog={onLog} />
    <Card pad="p-0">
      {app.deployments.length === 0 ? <div className="p-6"><Empty icon="rocket" title="هنوز استقراری نیست" /></div> : (
        <ul className="divide-y divide-white/[0.06]">
          {app.deployments.map((d) => (
            <li key={d.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="flex items-center gap-2 flex-wrap"><DeployPill s={d.status} />{d.target === "preview" && <Badge tone="blue">پیش‌نمایش</Badge>}<ScanBadge d={d} /><span className="text-sm truncate">{d.message || "—"}</span>{d.id === app.liveDeployment && <Badge tone="green">فعال</Badge>}</span>
                <span className="block text-[11px] text-white/50 mt-1">{TRIG[d.trigger] ?? d.trigger}{d.ref ? " · " : ""}<span dir="ltr" className="font-mono">{d.ref}</span> · {d.at}{d.seconds !== null ? " · " + fa(d.seconds) + " ثانیه" : ""}</span>
              </span>
              <span className="flex gap-2">
                <button type="button" onClick={() => onLog(d.id)} className={BTN_G + " h-8 px-3 text-xs"}>لاگ</button>
                {d.image && d.target === "production" && d.id !== app.liveDeployment && ["live", "superseded"].includes(d.status) && <AsyncButton className={BTN_G + " h-8 px-3 text-xs"} confirmText="به این نسخه برگردیم؟ نسخه فعلی جایگزین می‌شود." onClick={() => api.paas.rollback(app.id, d.id)}><Icon name="refresh-cw" size={13} />بازگشت</AsyncButton>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
    </>
  );
}

function AppLogs({ app }: { app: PaasApp }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [follow, setFollow] = useState(true);
  const [q, setQ] = useState("");
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    let live = true;
    const load = async () => { const l = await api.paas.logs(app.id, 300).catch(() => []); if (live) { setLines(l); if (follow) requestAnimationFrame(() => pre.current?.scrollTo({ top: pre.current.scrollHeight })); } };
    void load();
    const t = follow ? setInterval(load, 5000) : undefined;
    return () => { live = false; if (t) clearInterval(t); };
  }, [app.id, follow]);
  const shown = (lines ?? []).filter((l) => !q || l.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card pad="p-4">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="sr-only" htmlFor="log-q">جستجو در لاگ</label>
        <input id="log-q" value={q} onChange={(e) => setQ(e.target.value)} dir="ltr" placeholder="filter…" className={INPUT + " h-9 max-w-xs text-left"} />
        <span className="flex items-center gap-2 text-xs text-white/70"><Switch on={follow} onChange={setFollow} label="دنبال کردن زنده" />دنبال کردن زنده</span>
      </div>
      <pre ref={pre} dir="ltr" tabIndex={0} aria-label="لاگ اپ" className="text-left text-[12px] leading-6 font-mono bg-black/50 rounded-xl p-4 h-[60vh] overflow-auto whitespace-pre-wrap">
        {lines === null ? "…" : shown.length ? shown.join("\n") : app.status === "running" ? "لاگی پیدا نشد." : "اپ در حال اجرا نیست."}
      </pre>
    </Card>
  );
}

function AppEnv({ app }: { app: PaasApp }) {
  const { notify } = useApp();
  const [rows, setRows] = useState<EnvRow[]>(app.env.map((e) => ({ key: e.key, value: e.value ?? "", secret: e.secret, existing: true })));
  const removed = app.env.filter((e) => !rows.some((r) => r.key === e.key)).map((e) => e.key);
  const db = useDB();
  const locked = app.links.map((l) => ({ key: l.envKey, note: "از پایگاه داده " + (db.paasDbs.find((d) => d.id === l.dbId)?.name ?? l.dbId) }));
  return (
    <Card title="متغیرهای محیطی" icon="sliders-horizontal" action={<span className="text-[11px] text-white/50">ذخیره، اپ را بدون بیلد مجدد با مقادیر جدید اجرا می‌کند</span>}>
      <EnvEditor rows={rows} onChange={setRows} locked={[{ key: "PORT", note: "پلتفرم: " + app.port }, ...locked]} />
      <div className="mt-5 flex justify-end">
        <AsyncButton onClick={async () => {
          const err = envProblems(rows); if (err) throw new Error(err);
          await api.paas.setEnv(app.id, rows.filter((r) => r.key.trim()).map((r) => ({ key: r.key.trim(), value: r.value, secret: r.secret })), removed);
          notify("متغیرها ذخیره شد", "check");
        }}>ذخیره و اعمال</AsyncButton>
      </div>
    </Card>
  );
}

function AppDomains({ app }: { app: PaasApp }) {
  const db = useDB();
  const { notify, confirm } = useApp();
  const [host, setHost] = useState("");
  const target = app.url.replace("https://", "");
  return (
    <div className="grid lg:grid-cols-[1.3fr_1fr] gap-4 items-start">
      <Card title="دامنه‌ها" icon="globe" pad="p-3 sm:p-4">
        <ul className="space-y-1">
          <li className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.03]"><span dir="ltr" className="text-sm">{target}</span><Badge tone="green">پیش‌فرض · SSL</Badge></li>
          {app.domains.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
              <span dir="ltr" className="text-sm">{d.host}</span>
              <span className="flex items-center gap-2">
                {d.status === "active" ? <Badge tone="green">فعال · SSL</Badge> : d.status === "pending" ? <Badge tone="amber">در انتظار DNS</Badge> : <Badge tone="red">تأیید نشد</Badge>}
                {d.status !== "active" && <AsyncButton className={BTN_G + " h-8 px-3 text-xs"} onClick={async () => { await api.paas.checkDomain(d.id); notify("دامنه تأیید شد", "check"); }}>بررسی دوباره</AsyncButton>}
                <button type="button" aria-label={"حذف " + d.host} onClick={async () => { if (await confirm("دامنه " + d.host + " جدا شود؟", { danger: true, ok: "حذف" })) await api.paas.removeDomain(d.id); }} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-white/10 hover:text-rose-300"><Icon name="trash-2" size={14} /></button>
              </span>
            </li>
          ))}
        </ul>
        <form className="flex gap-2 mt-4" onSubmit={(e) => e.preventDefault()}>
          <label className="sr-only" htmlFor="new-host">دامنه جدید</label>
          <input id="new-host" value={host} onChange={(e) => setHost(e.target.value.trim().toLowerCase())} dir="ltr" placeholder="www.example.ir" className={INPUT + " text-left"} />
          <AsyncButton className={BTN_P + " h-11 px-4 text-sm shrink-0"} onClick={async () => { await api.paas.addDomain(app.id, host); setHost(""); notify("دامنه اضافه شد", "globe"); }}>افزودن</AsyncButton>
        </form>
      </Card>
      <Card title="تنظیم DNS" icon="network">
        <p className="text-sm text-white/65 leading-7">در سرویس DNS دامنه، یک رکورد بسازید:</p>
        <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="رکورد DNS">
          <table className="w-full text-xs" dir="ltr"><thead><tr className="text-white/55"><th className="text-left p-2">Type</th><th className="text-left p-2">Name</th><th className="text-left p-2">Value</th></tr></thead>
            <tbody><tr className="border-t border-white/[0.08]"><td className="p-2">CNAME</td><td className="p-2">www</td><td className="p-2"><CopyText text={target} className="font-mono" /></td></tr></tbody></table>
        </div>
        <p className="text-[11px] text-white/55 leading-6 mt-3">برای ریشه دامنه (بدون www) اگر سرویس DNS شما CNAME روی @ را پشتیبانی نمی‌کند، از ALIAS/ANAME استفاده کنید. گواهی SSL پس از تأیید خودکار صادر می‌شود.{db.domains.length ? " دامنه‌های شما در گره را از بخش دامنه‌ها می‌توانید تنظیم کنید." : ""}</p>
      </Card>
      <Card title="CDN و کش لبه" icon="zap" className="lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="text-sm text-white/65 leading-7 max-w-2xl">پاسخ‌هایی که اپ با <code dir="ltr">Cache-Control</code> قابل کش اعلام کند (تصاویر، CSS، JS، صفحه‌های عمومی) در لبه شبکه نگه داشته می‌شوند و بدون رسیدن به اپ سرو می‌شوند؛ سریع‌تر و با مصرف کمتر. پاسخ‌هایی که کوکی تنظیم می‌کنند یا <code dir="ltr">private</code> هستند هرگز کش نمی‌شوند. فشرده‌سازی Gzip و Brotli همیشه روشن است. وضعیت هر پاسخ در سربرگ <code dir="ltr">X-Cache-Status</code> دیده می‌شود.</p>
          <Switch on={app.cdn} onChange={async (v) => { await api.paas.updateApp(app.id, { cdn: v }); notify(v ? "CDN روشن شد" : "CDN خاموش شد", "zap"); }} label="CDN" />
        </div>
        {app.cdn && <AsyncButton className={BTN_G + " h-9 px-3 text-xs mt-3"} confirmText="همه پاسخ‌های کش‌شده این اپ پاک شود؟ چند دقیقه بار اپ کمی بیشتر می‌شود." onClick={async () => { await api.paas.purgeCache(app.id); notify("کش پاک شد", "refresh-cw"); }}><Icon name="refresh-cw" size={13} />پاک کردن کش</AsyncButton>}
      </Card>
    </div>
  );
}

function AppDbs({ app }: { app: PaasApp }) {
  const db = useDB(); const myId = useMyId();
  const { notify } = useApp();
  const mine = db.paasDbs.filter((d) => d.userId === myId);
  const free = mine.filter((d) => !app.links.some((l) => l.dbId === d.id));
  const [pick, setPick] = useState("");
  const [key, setKey] = useState("");
  const chosen = mine.find((d) => d.id === (pick || free[0]?.id));
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="پایگاه‌های داده متصل" icon="database" pad="p-3 sm:p-4">
        {app.links.length === 0 ? <Empty icon="database" title="پایگاه داده‌ای متصل نیست" /> : (
          <ul className="space-y-1">{app.links.map((l) => {
            const d = mine.find((x) => x.id === l.dbId);
            return (
              <li key={l.dbId} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
                <span><Link href={("/panel/databases/" + l.dbId) as never} className="font-bold text-sm hover:underline">{d?.name ?? l.dbId}</Link><span className="block text-[11px] text-white/55">{DB_ENGINES.find((e) => e.id === d?.engine)?.label} → <span dir="ltr" className="font-mono">{l.envKey}</span></span></span>
                <AsyncButton className={BTN_G + " h-8 px-3 text-xs"} confirmText={"اتصال برداشته و متغیر " + l.envKey + " حذف شود؟"} onClick={() => api.paas.unlink(app.id, l.dbId)}>جدا کردن</AsyncButton>
              </li>
            );
          })}</ul>
        )}
      </Card>
      <Card title="اتصال پایگاه داده" icon="plus">
        {free.length === 0 ? <Empty icon="database" title="پایگاه داده آزادی ندارید" action={<Link href="/panel/databases?new=1" className={BTN_P + " h-10 px-4 text-sm"}>ساخت پایگاه داده</Link>} /> : (
          <div className="space-y-4">
            <Field label="پایگاه داده"><Select label="پایگاه داده" value={pick || free[0].id} onChange={setPick} options={free.map((d) => ({ value: d.id, label: d.name + " (" + (DB_ENGINES.find((e) => e.id === d.engine)?.label ?? d.engine) + ")" }))} /></Field>
            <Field label="نام متغیر" hint="آدرس اتصال کامل با این نام به اپ داده می‌شود"><input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} dir="ltr" placeholder={chosen ? defaultEnvKeyFor(chosen.engine) : "DATABASE_URL"} className={INPUT + " text-left font-mono"} /></Field>
            <AsyncButton onClick={async () => { await api.paas.link(app.id, pick || free[0].id, key || undefined); setKey(""); setPick(""); notify("پایگاه داده متصل شد", "database"); }}>اتصال و اعمال</AsyncButton>
          </div>
        )}
      </Card>
    </div>
  );
}

function AppScale({ app }: { app: PaasApp }) {
  const db = useDB();
  const { notify } = useApp();
  const plans = db.paasPlans.filter((p) => p.kind === "app");
  const [s, setS] = useState({ planId: app.planId, instances: app.instances, autoscale: app.autoscale, maxInstances: Math.max(app.maxInstances, app.instances), diskGb: app.diskGb, autoscaleCpu: app.autoscaleCpu });
  const plan = plans.find((p) => p.id === s.planId) ?? plans[0];
  const monthly = plan ? appMonthly(plan, s.instances, s.diskGb) : 0;
  return (
    <div className="grid xl:grid-cols-[1fr_20rem] gap-4 items-start">
      <Card title="پلن هر نمونه" icon="gauge"><PlanPicker plans={plans} value={s.planId} onChange={(id) => setS({ ...s, planId: id })} label="پلن" /></Card>
      <Card title="مقیاس" icon="sliders-horizontal">
        <div className="space-y-4">
          <Field label="تعداد نمونه"><Select label="تعداد نمونه" value={String(s.instances)} onChange={(v) => setS({ ...s, instances: Number(v), maxInstances: Math.max(s.maxInstances, Number(v)) })} options={Array.from({ length: s.diskGb ? 1 : 10 }, (_, i) => ({ value: String(i + 1), label: fa(i + 1) }))} /></Field>
          <div className="flex items-center justify-between text-sm"><span>مقیاس خودکار با بار CPU</span><Switch on={s.autoscale} onChange={(v) => setS({ ...s, autoscale: v })} label="مقیاس خودکار" /></div>
          {s.autoscale && <Field label="آستانه افزایش نمونه" hint="وقتی میانگین مصرف CPU هر نمونه از این درصد پلن بیشتر شود، نمونه جدید اضافه می‌شود"><Select label="آستانه CPU" value={String(s.autoscaleCpu)} onChange={(v) => setS({ ...s, autoscaleCpu: Number(v) })} options={[50, 60, 70, 80, 90].map((n) => ({ value: String(n), label: fa(n) + "٪ CPU" }))} /></Field>}
          {s.autoscale && <Field label="حداکثر نمونه"><Select label="حداکثر نمونه" value={String(s.maxInstances)} onChange={(v) => setS({ ...s, maxInstances: Number(v) })} options={Array.from({ length: 20 }, (_, i) => i + 1).filter((n) => n >= s.instances).map((n) => ({ value: String(n), label: fa(n) }))} /></Field>}
          <Field label="دیسک دائمی (گیگ)" hint={app.diskGb ? "قابل کاهش نیست" : "فقط با یک نمونه"}><Select label="دیسک دائمی" value={String(s.diskGb)} onChange={(v) => setS({ ...s, diskGb: Number(v), instances: Number(v) ? 1 : s.instances })} options={[0, 1, 5, 10, 20, 50, 100].filter((n) => n >= app.diskGb).map((n) => ({ value: String(n), label: n ? fa(n) + " گیگ" : "ندارد" }))} /></Field>
          {!s.diskGb && (s.instances > 1 || s.autoscale)
            ? <p className="text-[11px] text-emerald-300/90 leading-6 flex gap-1.5"><Icon name="shield-check" size={14} className="shrink-0 mt-1" />دسترس‌پذیری بالا: نمونه‌ها روی سرورهای فیزیکی مختلف پخش می‌شوند و به‌روزرسانی یا خرابی یک سرور، اپ را از دسترس خارج نمی‌کند.</p>
            : <p className="text-[11px] text-white/45 leading-6">برای دسترس‌پذیری بالا (پخش روی چند سرور) دست‌کم ۲ نمونه انتخاب کنید.</p>}
          <div className="pt-3 border-t border-white/[0.08]"><Cost monthly={monthly} />{s.autoscale && <span className="block text-[11px] text-white/50 mt-1">در اوج بار تا {toman(plan ? appMonthly(plan, s.maxInstances, s.diskGb) : 0)} در ماه</span>}</div>
          <AsyncButton onClick={async () => { await api.paas.scale(app.id, s); notify("منابع به‌روز شد", "gauge"); }}>اعمال</AsyncButton>
        </div>
      </Card>
    </div>
  );
}

function AppSettings({ app }: { app: PaasApp }) {
  const { notify } = useApp(); const router = useRouter();
  const [f, setF] = useState({ gitUrl: app.gitUrl, gitBranch: app.gitBranch, image: app.image, rootDir: app.rootDir, buildCommand: app.buildCommand, startCommand: app.startCommand, port: app.port, healthPath: app.healthPath });
  const [confirmName, setConfirmName] = useState("");
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="بیلد و اجرا" icon="terminal">
        <div className="space-y-3">
          {app.source === "git" && <div className="grid sm:grid-cols-[1fr_9rem] gap-3">
            <Field label="مخزن"><input value={f.gitUrl} onChange={(e) => set({ gitUrl: e.target.value.trim() })} dir="ltr" className={INPUT + " text-left"} /></Field>
            <Field label="شاخه"><input value={f.gitBranch} onChange={(e) => set({ gitBranch: e.target.value.trim() })} dir="ltr" className={INPUT + " text-left"} /></Field>
          </div>}
          {app.source === "image" && <Field label="ایمیج" hint="تغییر ایمیج، استقرار جدید را شروع می‌کند"><input value={f.image} onChange={(e) => set({ image: e.target.value.trim() })} dir="ltr" className={INPUT + " text-left"} /></Field>}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="پوشه ریشه"><input value={f.rootDir} onChange={(e) => set({ rootDir: e.target.value.trim() })} dir="ltr" className={INPUT + " text-left"} /></Field>
            <Field label="پورت"><input value={f.port} inputMode="numeric" onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, "")) || 0 })} dir="ltr" className={INPUT + " text-left"} /></Field>
            <Field label="دستور بیلد"><input value={f.buildCommand} onChange={(e) => set({ buildCommand: e.target.value })} dir="ltr" placeholder="خودکار" className={INPUT + " text-left font-mono text-xs"} /></Field>
            <Field label="دستور اجرا"><input value={f.startCommand} onChange={(e) => set({ startCommand: e.target.value })} dir="ltr" placeholder="خودکار" className={INPUT + " text-left font-mono text-xs"} /></Field>
            <Field label="مسیر سلامت" hint="نسخه جدید فقط وقتی جایگزین می‌شود که این مسیر پاسخ 200 بدهد"><input value={f.healthPath} onChange={(e) => set({ healthPath: e.target.value.trim() })} dir="ltr" className={INPUT + " text-left"} /></Field>
          </div>
          <AsyncButton onClick={async () => { await api.paas.updateApp(app.id, f); notify("تنظیمات ذخیره شد؛ تغییرات بیلد در استقرار بعدی اعمال می‌شود", "check"); }}>ذخیره</AsyncButton>
        </div>
      </Card>
      <div className="space-y-4">
        {app.source === "git" && (
          <Card title="استقرار خودکار با push" icon="code-xml">
            <div className="flex items-center justify-between text-sm mb-3"><span>استقرار خودکار شاخه <b dir="ltr">{app.gitBranch}</b></span><Switch on={app.autoDeploy} onChange={async (v) => { await api.paas.updateApp(app.id, { autoDeploy: v }); }} label="استقرار خودکار" /></div>
            <div className="flex items-center justify-between gap-3 text-sm mb-3"><span>پیش‌نمایش خودکار برای push به شاخه‌های دیگر<span className="block text-[11px] text-white/50">روی <span dir="ltr">{app.previewUrl.replace("https://", "")}</span>؛ هزینه یک نمونه اضافه تا وقتی فعال است</span></span><Switch on={app.previews} onChange={async (v) => { await api.paas.updateApp(app.id, { previews: v }); }} label="پیش‌نمایش خودکار" /></div>
            <Field label="Webhook URL" hint="در GitHub: Settings › Webhooks › Add webhook (Content type: application/json، رویداد push). در GitLab: Settings › Webhooks › Push events."><CopyText text={app.hookUrl} className="font-mono text-[11px] break-all" /></Field>
            <AsyncButton className={BTN_G + " h-9 px-3 text-xs mt-3"} confirmText="آدرس فعلی از کار می‌افتد و باید در مخزن آدرس جدید را ثبت کنید. ادامه؟" onClick={async () => { await api.paas.regenHook(app.id); notify("آدرس جدید ساخته شد", "key-round"); }}>ساخت توکن جدید</AsyncButton>
          </Card>
        )}
        <Card title="حذف اپ" icon="trash-2">
          <p className="text-sm text-white/65 leading-7">اپ، نسخه‌ها، دامنه‌ها و دیسک دائمی آن برای همیشه حذف می‌شوند. پایگاه‌های داده متصل حذف نمی‌شوند.</p>
          <label className="block text-xs text-white/60 mt-3" htmlFor="del-name">برای تأیید، نام اپ را بنویسید: <b dir="ltr">{app.name}</b></label>
          <input id="del-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} dir="ltr" className={INPUT + " text-left mt-1.5"} />
          <AsyncButton danger disabled={confirmName !== app.name} className="mt-3" onClick={async () => { await api.paas.deleteApp(app.id, confirmName); notify("اپ حذف شد", "trash-2"); router.push("/panel/apps"); }}>حذف همیشگی</AsyncButton>
        </Card>
      </div>
    </div>
  );
}
