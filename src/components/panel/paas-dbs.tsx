"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BTN_G, BTN_P, INPUT } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { DB_ENGINES, engineOf, PAAS_NAME_RE, PAAS_RESERVED } from "@/lib/paas";
import { api, useDB, useMyId } from "@/lib/store";
import type { PaasDb } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AreaChart, AsyncButton, CopyText, Modal, PageTitle, Select, Switch, Tabs } from "../ui-client";
import { Cost, cpuLabel, PlanPicker, ramLabel, StatusPill } from "./paas-shared";

/* ================= list + create ================= */
export function UserDatabases({ create = false }: { create?: boolean }) {
  const db = useDB(); const myId = useMyId();
  const dbs = db.paasDbs.filter((d) => d.userId === myId);
  const [open, setOpen] = useState(create);
  const monthly = dbs.reduce((s, d) => s + d.hourly * 720, 0);
  return (
    <div>
      <PageTitle title="پایگاه داده" sub={dbs.length ? fa(dbs.length) + " پایگاه داده · حدود " + toman(monthly) + " در ماه" : "PostgreSQL، MySQL، MariaDB، MongoDB و Redis مدیریت‌شده با پشتیبان روزانه."}
        action={<button type="button" onClick={() => setOpen(true)} className={BTN_P + " h-10 px-4 text-sm"}><Icon name="plus" size={16} />پایگاه داده جدید</button>} />
      {dbs.length === 0 ? (
        <Card><Empty icon="database" title="هنوز پایگاه داده‌ای ندارید" text="در کمتر از یک دقیقه بسازید و با یک کلیک به اپ‌هایتان متصل کنید."
          action={<button type="button" onClick={() => setOpen(true)} className={BTN_P + " h-10 px-5 text-sm"}>ساخت پایگاه داده</button>} /></Card>
      ) : (
        <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {dbs.map((d) => (
            <li key={d.id}>
              <Link href={("/panel/databases/" + d.id) as never} className="block rounded-[1.4rem] p-5 bg-white/[0.04] border border-white/[0.1] hover:border-white/25 transition">
                <span className="flex items-center justify-between gap-2"><b dir="ltr" className="truncate">{d.name}</b><StatusPill s={d.status} /></span>
                <span className="block text-xs text-white/55 mt-1">{engineOf(d.engine)?.label ?? d.engine} {d.version}</span>
                <span className="block text-xs text-white/55 mt-3">{d.links.length ? "متصل به " + d.links.map((l) => l.appName).join("، ") : "به اپی متصل نیست"}</span>
                <span className="flex justify-between text-[11px] text-white/50 mt-3"><span>{d.backups ? "پشتیبان روزانه" : "بدون پشتیبان خودکار"}</span><span className="tabular">{fa(d.hourly)} تومان / ساعت</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NewDatabase open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function NewDatabase({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB(); const router = useRouter();
  const { notify } = useApp();
  const plans = db.paasPlans.filter((p) => p.kind === "db");
  const [f, setF] = useState({ name: "", engine: "postgres", version: "17", planId: "db-micro", publicAccess: false, backups: true });
  const [error, setError] = useState("");
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const plan = plans.find((p) => p.id === f.planId) ?? plans[0];
  const engine = engineOf(f.engine);
  const nameError = f.name && (!PAAS_NAME_RE.test(f.name) ? "حروف کوچک انگلیسی، عدد و خط تیره؛ ۳ تا ۳۰ نویسه" : PAAS_RESERVED.has(f.name) ? "این نام رزرو شده است" : "");
  return (
    <Modal open={open} onClose={onClose} title="پایگاه داده جدید" icon="database" size="max-w-3xl">
      <div className="space-y-5">
        <div role="radiogroup" aria-label="موتور" className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {DB_ENGINES.map((e) => (
            <button key={e.id} type="button" role="radio" aria-checked={f.engine === e.id} title={e.hint} onClick={() => set({ engine: e.id, version: e.versions[0] })}
              className={"rounded-2xl p-3 border text-center transition " + (f.engine === e.id ? "bg-sky-400/10 border-sky-300/50" : "bg-white/[0.03] border-white/[0.1] hover:border-white/25")}>
              <Icon name={e.icon} size={18} className="acc mx-auto" /><b className="block text-xs mt-1.5">{e.label}</b>
            </button>
          ))}
        </div>
        {engine && <p className="text-xs text-white/55 -mt-2">{engine.hint}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="نام" error={nameError || undefined}><input value={f.name} onChange={(e) => set({ name: e.target.value.toLowerCase() })} dir="ltr" placeholder="shop-db" aria-invalid={!!nameError} className={INPUT + " text-left"} /></Field>
          <Field label="نسخه"><Select label="نسخه" value={f.version} onChange={(v) => set({ version: v })} options={(engine?.versions ?? []).map((v) => ({ value: v, label: v }))} /></Field>
        </div>
        <PlanPicker plans={plans} value={f.planId} onChange={(id) => set({ planId: id })} label="پلن پایگاه داده" />
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3"><span>پشتیبان خودکار روزانه<span className="block text-[11px] text-white/50">۷ نسخه آخر نگه داشته می‌شود</span></span><Switch on={f.backups} onChange={(v) => set({ backups: v })} label="پشتیبان خودکار" /></div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3"><span>دسترسی از بیرون<span className="block text-[11px] text-white/50">برای اتصال از سیستم خودتان</span></span><Switch on={f.publicAccess} onChange={(v) => set({ publicAccess: v })} label="دسترسی عمومی" /></div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4 pt-4 border-t border-white/[0.08]">
          {plan && <Cost monthly={plan.price} />}
          <div className="flex flex-col items-end gap-2">
            {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
            <AsyncButton disabled={!f.name || !!nameError} onClick={async () => {
              setError("");
              try { const id = await api.paas.createDb(f); notify("پایگاه داده در حال ساخت است", "database"); onClose(); router.push(("/panel/databases/" + id) as never); }
              catch (e) { setError((e as Error).message); }
            }}><Icon name="database" size={16} />ساخت</AsyncButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ================= detail ================= */
const TABS = [
  { id: "overview", label: "اتصال", icon: "plug" }, { id: "backups", label: "پشتیبان‌ها", icon: "archive" },
  { id: "resources", label: "منابع", icon: "gauge" }, { id: "settings", label: "تنظیمات", icon: "settings-2" },
];

export function DbDetail({ id }: { id: string }) {
  const db = useDB(); const myId = useMyId();
  const d = db.paasDbs.find((x) => x.id === id && x.userId === myId);
  const [tab, setTab] = useState("overview");
  if (!d) return <Card><Empty icon="database" title="پایگاه داده پیدا نشد" action={<Link href="/panel/databases" className={BTN_G + " px-4 h-10 text-sm"}>بازگشت</Link>} /></Card>;
  const pending = d.status === "creating" || d.backupList.some((b) => b.status === "running" || b.status === "restoring");
  return (
    <div>
      <Refresh active={pending} />
      <PageTitle back={["/panel/databases", "پایگاه داده"]} title={<span dir="ltr" className="inline-block">{d.name}</span>}
        sub={<span className="flex flex-wrap items-center gap-x-4 gap-y-1"><StatusPill s={d.status} /><span className="text-xs">{engineOf(d.engine)?.label} {d.version}</span><span className="text-xs tabular">{fa(d.hourly)} تومان / ساعت</span></span>}
        action={d.status === "suspended" ? <Badge tone="amber">معلق؛ کیف پول را شارژ کنید</Badge> : d.status === "stopped"
          ? <AsyncButton className={BTN_G + " h-10 px-4 text-sm"} onClick={() => api.paas.dbPower(d.id, "start")}><Icon name="play" size={16} />روشن</AsyncButton>
          : d.status === "running" ? <AsyncButton danger className={BTN_G + " h-10 px-4 text-sm"} confirmText="پایگاه داده خاموش شود؟ اپ‌های متصل به آن خطا خواهند داد." onClick={() => api.paas.dbPower(d.id, "stop")}><Icon name="pause" size={16} />خاموش</AsyncButton> : null} />
      <div className="overflow-x-auto no-scrollbar mb-6"><Tabs size="sm" value={tab} onChange={setTab} label="بخش‌های پایگاه داده" options={TABS} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "overview" && <DbConnect d={d} />}
        {tab === "backups" && <DbBackups d={d} />}
        {tab === "resources" && <DbResources d={d} />}
        {tab === "settings" && <DbSettings d={d} />}
      </div>
    </div>
  );
}

function Refresh({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { void import("@/lib/store").then((m) => m.refresh()); }, 3000);
    return () => clearInterval(t);
  }, [active]);
  return null;
}

function DbConnect({ d }: { d: PaasDb }) {
  const { notify } = useApp();
  const [creds, setCreds] = useState<{ password: string; url: string; publicUrl: string } | null>(null);
  const reveal = async () => setCreds(await api.paas.dbCredentials(d.id));
  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="اطلاعات اتصال" icon="plug">
          <dl className="space-y-2.5 text-sm">
            {([["میزبان داخلی", d.host], ["پورت", String(d.port)], ...(d.engine === "redis" ? [] : [["نام کاربری", d.username], ["نام پایگاه داده", d.dbName]])] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-white/55 shrink-0">{k}</dt><dd className="min-w-0"><CopyText text={v} className="font-mono text-xs break-all" /></dd></div>
            ))}
            <div className="flex justify-between gap-3"><dt className="text-white/55">رمز عبور</dt><dd>{creds ? <CopyText text={creds.password} className="font-mono text-xs" /> : <button type="button" onClick={reveal} className="text-xs acc inline-flex items-center gap-1"><Icon name="eye" size={13} />نمایش</button>}</dd></div>
          </dl>
          {creds && <div className="mt-4 space-y-3">
            <Field label="آدرس اتصال داخلی (برای اپ‌های گره)"><CopyText text={creds.url} className="font-mono text-[11px] break-all" /></Field>
            {creds.publicUrl && <Field label="آدرس اتصال عمومی"><CopyText text={creds.publicUrl} className="font-mono text-[11px] break-all" /></Field>}
          </div>}
          <p className="text-[11px] text-white/50 leading-6 mt-4">نمایش رمز در گزارش فعالیت حساب ثبت می‌شود. میزبان داخلی فقط از اپ‌های خود شما در گره در دسترس است.</p>
          <AsyncButton className={BTN_G + " h-9 px-3 text-xs mt-3"} confirmText="رمز جدید ساخته و اپ‌های متصل با رمز جدید دوباره اجرا می‌شوند. ادامه؟" onClick={async () => { await api.paas.resetDbPassword(d.id); setCreds(null); notify("رمز عبور عوض شد", "key-round"); }}><Icon name="key-round" size={13} />ساخت رمز جدید</AsyncButton>
        </Card>
        <Card title="اپ‌های متصل" icon="rocket">
          {d.links.length === 0 ? <p className="text-sm text-white/60 leading-7">به اپی متصل نیست. از تب «پایگاه داده» در صفحه اپ متصلش کنید تا آدرس اتصال خودکار به‌صورت متغیر محیطی به اپ برسد.</p> : (
            <ul className="space-y-1">{d.links.map((l) => (
              <li key={l.appId} className="flex justify-between items-center gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
                <Link href={("/panel/apps/" + l.appId) as never} dir="ltr" className="font-bold text-sm hover:underline">{l.appName}</Link>
                <span dir="ltr" className="font-mono text-xs text-white/60">{l.envKey}</span>
              </li>
            ))}</ul>
          )}
          {d.publicAccess && d.publicPort && <p className="text-[11px] text-amber-200/80 leading-6 mt-4 flex gap-2"><Icon name="triangle-alert" size={14} className="shrink-0 mt-1" />دسترسی عمومی روشن است (پورت {fa(d.publicPort)}). از رمز قوی استفاده کنید و اگر لازم نیست خاموشش کنید.</p>}
        </Card>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <MetricCard label="پردازنده" icon="cpu" values={d.metrics.map((m) => m.cpu)} unit="٪" />
        <MetricCard label="حافظه" icon="memory-stick" values={d.metrics.map((m) => m.ramMb)} unit="MB" />
      </div>
    </div>
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

const BK_STATUS: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]> = { running: ["در حال تهیه", "blue"], done: ["آماده", "green"], failed: ["ناموفق", "red"], restoring: ["در حال بازگردانی", "amber"] };

function DbBackups({ d }: { d: PaasDb }) {
  const { notify } = useApp();
  const manual = d.backupList.filter((b) => b.kind === "manual").length;
  return (
    <>
    <Card title="پشتیبان‌ها" icon="archive" pad="p-3 sm:p-4"
      action={<AsyncButton className={BTN_P + " h-9 px-3 text-xs"} disabled={d.status !== "running" || manual >= 10} onClick={async () => { await api.paas.backupDb(d.id); notify("پشتیبان‌گیری شروع شد", "archive"); }}><Icon name="plus" size={14} />پشتیبان الان</AsyncButton>}>
      <p className="text-[11px] text-white/50 px-2 mb-3">{d.backups ? "پشتیبان خودکار روزانه روشن است؛ ۷ نسخه آخر نگه داشته می‌شود." : "پشتیبان خودکار خاموش است (از تب تنظیمات روشن کنید)."} تا ۱۰ پشتیبان دستی.</p>
      {d.backupList.length === 0 ? <Empty icon="archive" title="هنوز پشتیبانی نیست" /> : (
        <ul className="divide-y divide-white/[0.06]">
          {d.backupList.map((b) => {
            const [label, tone] = BK_STATUS[b.status] ?? [b.status, "gray"];
            return (
              <li key={b.id} className="p-3 flex flex-wrap items-center justify-between gap-3">
                <span><span className="flex items-center gap-2"><Badge tone={tone} dot>{label}</Badge><span className="text-sm">{b.at}</span></span>
                  <span className="block text-[11px] text-white/50 mt-1">{b.kind === "auto" ? "خودکار" : "دستی"}{b.sizeMb ? " · " + fa(b.sizeMb, 1) + " مگابایت" : ""}
                    {b.verified === true && <span className="text-emerald-300"> · آزمون بازگردانی موفق ({b.verifiedAt})</span>}
                    {b.verified === false && <span className="text-rose-300" title={b.verifyDetail}> · آزمون بازگردانی ناموفق</span>}</span></span>
                <span className="flex gap-2">
                  {b.status === "done" && <AsyncButton className={BTN_G + " h-8 px-3 text-xs"} confirmText="همه داده‌های فعلی با این پشتیبان جایگزین می‌شود و قابل برگشت نیست. ادامه؟" onClick={async () => { await api.paas.restoreDb(b.id); notify("بازگردانی شروع شد", "refresh-cw"); }}><Icon name="refresh-cw" size={13} />بازگردانی</AsyncButton>}
                  {b.kind === "manual" && b.status !== "running" && b.status !== "restoring" && <AsyncButton className={BTN_G + " h-8 px-3 text-xs"} confirmText="این پشتیبان حذف شود؟" onClick={() => api.paas.deleteBackup(b.id)}><Icon name="trash-2" size={13} /></AsyncButton>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] text-white/45 px-2 mt-3 leading-6">هر هفته آخرین پشتیبان در یک سرور جداگانه بازگردانی و بررسی می‌شود تا مطمئن شوید پشتیبان‌ها واقعاً قابل استفاده‌اند.</p>
    </Card>
    {d.engine === "postgres" && <Pitr d={d} />}
    </>
  );
}

/** PostgreSQL point-in-time recovery: WAL archiving + restore into a new database */
function Pitr({ d }: { d: PaasDb }) {
  const { notify } = useApp(); const router = useRouter();
  const [at, setAt] = useState("");
  const [name, setName] = useState((d.name + "-restore").slice(0, 30));
  return (
    <Card title="بازیابی لحظه‌ای (PITR)" icon="clock" className="mt-4" action={<Switch on={d.pitr} onChange={async (v) => { await api.paas.updateDb(d.id, { pitr: v }); notify(v ? "آرشیو پیوسته فعال شد" : "بازیابی لحظه‌ای خاموش شد", "clock"); }} label="بازیابی لحظه‌ای" />}>
      <p className="text-sm text-white/60 leading-7">تغییرات پایگاه داده به‌صورت پیوسته آرشیو می‌شود و می‌توانید حالت آن را در هر لحظه از ۷ روز گذشته (مثلاً یک دقیقه پیش از یک DELETE اشتباه) در یک پایگاه داده جدید بازیابی کنید. پایگاه داده فعلی دست نمی‌خورد.</p>
      {d.restoredFrom && <p className="text-xs text-sky-200 mt-2">این پایگاه داده بازیابی لحظه‌ای «{d.restoredFrom}» در {d.restoredAt} است.</p>}
      {d.pitr && <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end mt-4">
        <Field label="زمان (به وقت دستگاه شما)"><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} dir="ltr" className={INPUT + " text-left"} /></Field>
        <Field label="نام پایگاه داده جدید"><input value={name} onChange={(e) => setName(e.target.value.toLowerCase().trim())} dir="ltr" className={INPUT + " text-left font-mono"} /></Field>
        <AsyncButton disabled={!at || !PAAS_NAME_RE.test(name)} className={BTN_P + " h-11 px-4 text-sm"} onClick={async () => { const id = await api.paas.pitrRestore(d.id, new Date(at).toISOString(), name); notify("بازیابی شروع شد", "clock"); router.push(("/panel/databases/" + id) as never); }}>بازیابی</AsyncButton>
      </div>}
    </Card>
  );
}

function DbResources({ d }: { d: PaasDb }) {
  const db = useDB();
  const { notify } = useApp();
  const plans = db.paasPlans.filter((p) => p.kind === "db");
  const cur = plans.find((p) => p.id === d.planId);
  const [planId, setPlanId] = useState(d.planId);
  const next = plans.find((p) => p.id === planId);
  return (
    <div className="grid xl:grid-cols-[1fr_20rem] gap-4 items-start">
      <Card title="پلن" icon="gauge">
        <PlanPicker plans={plans.filter((p) => !cur || p.diskGb >= cur.diskGb)} value={planId} onChange={setPlanId} label="پلن پایگاه داده" />
        <p className="text-[11px] text-white/50 mt-3">دیسک پایگاه داده قابل کوچک کردن نیست؛ فقط پلن‌های هم‌اندازه یا بزرگ‌تر نمایش داده می‌شوند.</p>
      </Card>
      <Card title="خلاصه" icon="receipt">
        {cur && <p className="text-sm text-white/65">فعلی: {cur.name} · {cpuLabel(cur.cpu)} · {ramLabel(cur.ramMb)} · {fa(cur.diskGb)} گیگ</p>}
        {next && <div className="mt-4"><Cost monthly={next.price} /></div>}
        <AsyncButton disabled={planId === d.planId} className="mt-4" confirmText="پایگاه داده برای اعمال پلن جدید چند ثانیه ری‌استارت می‌شود. ادامه؟" onClick={async () => { await api.paas.updateDb(d.id, { planId }); notify("پلن عوض شد", "gauge"); }}>اعمال</AsyncButton>
      </Card>
    </div>
  );
}

function DbSettings({ d }: { d: PaasDb }) {
  const { notify } = useApp(); const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="تنظیمات" icon="settings-2">
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3"><span>پشتیبان خودکار روزانه</span><Switch on={d.backups} onChange={async (v) => { await api.paas.updateDb(d.id, { backups: v }); notify(v ? "پشتیبان خودکار روشن شد" : "پشتیبان خودکار خاموش شد", "archive"); }} label="پشتیبان خودکار" /></div>
          <div className="flex items-center justify-between gap-3"><span>دسترسی از بیرون<span className="block text-[11px] text-white/50">{d.publicPort ? "پورت عمومی " + fa(d.publicPort) : "فقط از اپ‌های خودتان در گره"}</span></span><Switch on={d.publicAccess} onChange={async (v) => { await api.paas.updateDb(d.id, { publicAccess: v }); notify("ذخیره شد", "check"); }} label="دسترسی عمومی" /></div>
        </div>
      </Card>
      <Card title="حذف پایگاه داده" icon="trash-2">
        {d.links.length > 0 ? <p className="text-sm text-white/65 leading-7">ابتدا اتصال آن را از اپ‌های {d.links.map((l) => l.appName).join("، ")} بردارید.</p> : <>
          <p className="text-sm text-white/65 leading-7">پایگاه داده و همه پشتیبان‌هایش برای همیشه حذف می‌شوند.</p>
          <label className="block text-xs text-white/60 mt-3" htmlFor="del-db">برای تأیید، نام را بنویسید: <b dir="ltr">{d.name}</b></label>
          <input id="del-db" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} dir="ltr" className={INPUT + " text-left mt-1.5"} />
          <AsyncButton danger disabled={confirmName !== d.name} className="mt-3" onClick={async () => { await api.paas.deleteDb(d.id, confirmName); notify("پایگاه داده حذف شد", "trash-2"); router.push("/panel/databases"); }}>حذف همیشگی</AsyncButton>
        </>}
      </Card>
    </div>
  );
}
