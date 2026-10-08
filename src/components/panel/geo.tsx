"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BTN_G, BTN_P, INPUT } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { answerFor, GEO_TYPES, SYNC_LABEL, SYNC_STATUS, ZONE_STATUS, type GeoRecordType } from "@/lib/geo";
import { api, useDB, useMyId, type GeoRecordInput } from "@/lib/store";
import type { GeoRecord, GeoZone } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, CopyText, Modal, PageTitle, Select, Switch, Tabs } from "../ui-client";

const Pill = ({ map, s }: { map: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]>; s: string }) => { const [l, t] = map[s] ?? [s, "gray"]; return <Badge tone={t} dot>{l}</Badge>; };
const Up = ({ v }: { v: boolean | null }) => v === null ? <span className="text-white/40">—</span> : v ? <span className="text-emerald-300 inline-flex items-center gap-1"><Icon name="circle-check" size={13} />در دسترس</span> : <span className="text-rose-300 inline-flex items-center gap-1"><Icon name="circle-alert" size={13} />قطع</span>;

/* ================= list + order ================= */
export function UserGeo({ create = false }: { create?: boolean }) {
  const db = useDB(); const myId = useMyId();
  const zones = db.geo.zones.filter((z) => z.userId === myId);
  const [open, setOpen] = useState(create);
  return (
    <div>
      <PageTitle title="Geo DNS" sub="بازدیدکننده ایرانی به سرور ایران، بقیه دنیا و گوگل به سرور خارج؛ سایت در قطعی اینترنت هم دیده می‌شود و رتبه گوگل حفظ می‌شود."
        action={<button type="button" onClick={() => setOpen(true)} className={BTN_P + " h-10 px-4 text-sm"}><Icon name="plus" size={16} />دامنه جدید</button>} />
      {zones.length === 0 ? (
        <Card><Empty icon="globe" title="هنوز دامنه‌ای در Geo DNS ندارید" text="دامنه، IP سرور ایران و IP سرور خارج را وارد کنید؛ بقیه کار با ماست."
          action={<div className="flex flex-wrap gap-2 justify-center"><button type="button" onClick={() => setOpen(true)} className={BTN_P + " h-10 px-5 text-sm"}>شروع</button><Link href={"/geo-dns" as never} className={BTN_G + " h-10 px-4 text-sm"}>Geo DNS چیست؟</Link></div>} /></Card>
      ) : (
        <ul className="grid md:grid-cols-2 gap-4">
          {zones.map((z) => { const plan = db.geo.plans.find((p) => p.id === z.planId); return (
            <li key={z.id}>
              <Link href={("/panel/geo/" + z.id) as never} className="block rounded-[1.4rem] p-5 bg-white/[0.04] border border-white/[0.1] hover:border-white/25 transition">
                <span className="flex items-center justify-between gap-2"><b dir="ltr" className="truncate">{z.domain}</b><Pill map={ZONE_STATUS} s={z.status} /></span>
                <span className="block text-xs text-white/55 mt-1">پلن {plan?.name ?? z.planId} · {fa(z.records.length)} رکورد</span>
                <span className="flex flex-wrap justify-between gap-2 text-[11px] text-white/50 mt-3"><span>اعتبار تا {z.paidUntil}</span>{plan && plan.sync !== "none" && <Pill map={SYNC_STATUS} s={z.syncStatus} />}</span>
              </Link>
            </li>
          ); })}
        </ul>
      )}
      <NewZone open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function NewZone({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB(); const router = useRouter(); const { notify } = useApp();
  const plans = db.geo.plans;
  const [f, setF] = useState({ domain: "", planId: plans[1]?.id ?? plans[0]?.id ?? "geo-pro", iran: "", world: "" });
  const [error, setError] = useState("");
  const plan = plans.find((p) => p.id === f.planId);
  return (
    <Modal open={open} onClose={onClose} title="Geo DNS برای دامنه جدید" icon="globe" size="max-w-3xl">
      <div className="space-y-5">
        <div role="radiogroup" aria-label="پلن" className="grid sm:grid-cols-3 gap-2">
          {plans.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={f.planId === p.id} onClick={() => setF({ ...f, planId: p.id })}
              className={"text-right rounded-2xl p-4 border transition " + (f.planId === p.id ? "bg-sky-400/10 border-sky-300/50" : "bg-white/[0.03] border-white/[0.1] hover:border-white/25")}>
              <b>{p.name}</b>
              <span className="block text-sm tabular mt-1">{toman(p.price)}<span className="text-[11px] text-white/50"> / ماه</span></span>
              <span className="block text-[11px] text-white/55 mt-2 leading-5">تا {fa(p.records)} رکورد{p.healthChecks ? " · سوییچ خودکار هنگام قطعی" : ""}{p.sync !== "none" ? " · " + SYNC_LABEL[p.sync] : ""}</span>
            </button>
          ))}
        </div>
        <Field label="دامنه"><input value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value.trim().toLowerCase() })} dir="ltr" placeholder="example.ir" className={INPUT + " text-left"} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="IP سرور ایران" hint="بازدیدکنندگان داخل ایران"><input value={f.iran} onChange={(e) => setF({ ...f, iran: e.target.value.trim() })} dir="ltr" placeholder="185.x.x.x" className={INPUT + " text-left font-mono"} /></Field>
          <Field label="IP سرور خارج" hint={plan?.sync === "full" ? "اگر ندارید خالی نگذارید؛ تیم ما پس از خرید با شما هماهنگ می‌کند" : "بقیه دنیا و موتورهای جستجو"}><input value={f.world} onChange={(e) => setF({ ...f, world: e.target.value.trim() })} dir="ltr" placeholder="94.x.x.x" className={INPUT + " text-left font-mono"} /></Field>
        </div>
        <p className="text-[11px] text-white/55 leading-6">رکوردهای ریشه (@) و www با همین دو IP ساخته می‌شوند؛ بقیه رکوردها (ایمیل، زیردامنه‌ها…) را بعداً اضافه کنید. ماه اول از کیف پول کسر می‌شود و سرویس پس از تغییر NS دامنه فعال می‌شود.</p>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/[0.08]">
          <span className="text-sm">{plan && <>هزینه: <b className="tabular">{toman(plan.price)}</b> در ماه</>}</span>
          <div className="flex flex-col items-end gap-2">
            {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
            <AsyncButton disabled={!f.domain || !f.iran || !f.world} onClick={async () => {
              setError("");
              try { const id = await api.geo.create(f); notify("دامنه ثبت شد؛ حالا NS را تغییر دهید", "globe"); onClose(); router.push(("/panel/geo/" + id) as never); }
              catch (e) { setError((e as Error).message); }
            }}><Icon name="globe" size={16} />ثبت و پرداخت</AsyncButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ================= detail ================= */
export function GeoDetail({ id }: { id: string }) {
  const db = useDB(); const myId = useMyId();
  const z = db.geo.zones.find((x) => x.id === id && x.userId === myId);
  const [tab, setTab] = useState(z && !z.nsOk ? "setup" : "records");
  if (!z) return <Card><Empty icon="globe" title="دامنه پیدا نشد" action={<Link href={"/panel/geo" as never} className={BTN_G + " px-4 h-10 text-sm"}>بازگشت</Link>} /></Card>;
  const plan = db.geo.plans.find((p) => p.id === z.planId);
  return (
    <div>
      <PageTitle back={["/panel/geo", "Geo DNS"]} title={<span dir="ltr" className="inline-block">{z.domain}</span>}
        sub={<span className="flex flex-wrap items-center gap-x-4 gap-y-1"><Pill map={ZONE_STATUS} s={z.status} /><span className="text-xs">پلن {plan?.name}</span><span className="text-xs">اعتبار تا {z.paidUntil}</span></span>} />
      {z.status === "suspended" && <div role="alert" className="mb-4 rounded-2xl border border-rose-300/30 bg-rose-400/[0.07] px-4 py-3 text-sm leading-7">تمدید انجام نشده و تفکیک جغرافیایی متوقف است: همه بازدیدکنندگان به سرور ایران می‌روند. کیف پول را شارژ کنید؛ سرویس ظرف یک روز خودکار فعال می‌شود.</div>}
      <div className="overflow-x-auto no-scrollbar mb-5"><Tabs size="sm" value={tab} onChange={setTab} label="بخش‌های دامنه" options={[
        { id: "setup", label: "راه‌اندازی", icon: "list-checks" }, { id: "records", label: "رکوردها", icon: "network" }, { id: "test", label: "تست پاسخ", icon: "radar" }, { id: "settings", label: "پلن و تنظیمات", icon: "settings-2" },
      ]} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "setup" && <Setup z={z} />}
        {tab === "records" && <Records z={z} />}
        {tab === "test" && <TestTool z={z} />}
        {tab === "settings" && <Settings z={z} />}
      </div>
    </div>
  );
}

function Setup({ z }: { z: GeoZone }) {
  const db = useDB(); const { notify } = useApp();
  const plan = db.geo.plans.find((p) => p.id === z.planId);
  const step = (n: number, done: boolean, title: string, body: React.ReactNode) => (
    <li className="flex gap-4">
      <span className={"w-8 h-8 rounded-full grid place-items-center shrink-0 font-black text-sm " + (done ? "bg-emerald-400/20 text-emerald-300" : "bg-white/10")}>{done ? <Icon name="check" size={16} /> : fa(n)}</span>
      <div className="min-w-0 flex-1 pb-6"><b>{title}</b><div className="text-sm text-white/70 leading-7 mt-1">{body}</div></div>
    </li>
  );
  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
      <Card title="سه قدم تا فعال‌سازی" icon="list-checks">
        <ol>
          {step(1, true, "ثبت دامنه و سرورها", <>رکوردهای @ و www با IP ایران و خارج ساخته شد. رکوردهای دیگر (ایمیل، زیردامنه‌ها) را در تب «رکوردها» اضافه کنید.</>)}
          {step(2, z.nsOk, "تغییر NS دامنه", <>
            در پنل ثبت‌کننده دامنه (برای .ir در nic.ir)، نام‌سرورها را به این دو تغییر دهید:
            <div className="mt-2 space-y-1.5">{db.geo.nameservers.map((n) => <div key={n} className="rounded-lg bg-black/30 px-3 py-2"><CopyText text={n} className="font-mono text-sm" /></div>)}</div>
            <p className="text-[11px] text-white/50 mt-2">پیش از تغییر، همه رکوردهای فعلی دامنه (به‌خصوص MX ایمیل) را در تب «رکوردها» وارد کنید تا چیزی قطع نشود. اعمال تغییر بین چند دقیقه تا ۲۴ ساعت طول می‌کشد.</p>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} onClick={async () => { const r = await api.geo.checkNs(z.id); notify(r.ok ? "NS درست است؛ Geo DNS فعال شد" : "هنوز NS دامنه تغییر نکرده است", r.ok ? "circle-check" : "clock"); }}><Icon name="refresh-cw" size={13} />بررسی دوباره</AsyncButton>
              <span className="text-[11px] text-white/50">{z.nsChecked ? "آخرین بررسی: " + z.nsChecked : ""}{z.nsSeen.length ? " · NS فعلی: " : ""}<span dir="ltr">{z.nsSeen.join(", ")}</span></span>
            </div>
          </>)}
          {step(3, plan?.sync === "none" ? z.nsOk : z.syncStatus === "ok", plan?.sync === "none" ? "به‌روز نگه داشتن سرور خارج" : "همگام‌سازی سرور خارج (با تیم گره)", plan?.sync === "none"
            ? <>سرور خارج باید نسخه به‌روز سایت را داشته باشد. اگر نمی‌خواهید خودتان این کار را انجام دهید، پلن «مدیریت‌شده» را انتخاب کنید تا فایل‌ها و پایگاه داده را ما همگام نگه داریم.</>
            : <>تیم گره پس از خرید با شما تماس می‌گیرد، سرور خارج را راه‌اندازی می‌کند و فایل‌ها و پایگاه داده را به‌صورت خودکار همگام نگه می‌دارد. وضعیت: <Pill map={SYNC_STATUS} s={z.syncStatus} />{z.lastSync && <span className="text-[11px] text-white/50"> · آخرین همگام‌سازی {z.lastSync}{z.syncLagSec !== null ? " (تأخیر " + fa(Math.round(z.syncLagSec / 60)) + " دقیقه)" : ""}</span>}</>)}
        </ol>
      </Card>
      <Card title="چطور کار می‌کند؟" icon="network">
        <ul className="space-y-3 text-sm text-white/70 leading-7">
          <li className="flex gap-2"><Icon name="map-pin" size={16} className="acc shrink-0 mt-1" />کاربری که از داخل ایران سایت را باز می‌کند، به سرور ایران فرستاده می‌شود؛ سریع و بدون وابستگی به اینترنت بین‌الملل.</li>
          <li className="flex gap-2"><Icon name="globe" size={16} className="acc shrink-0 mt-1" />بازدیدکنندگان خارج از ایران و ربات‌های گوگل به سرور خارج می‌روند؛ پس در قطعی اینترنت بین‌الملل، سایت از دید گوگل از دسترس خارج نمی‌شود.</li>
          {plan?.healthChecks && <li className="flex gap-2"><Icon name="refresh-cw" size={16} className="acc shrink-0 mt-1" />اگر یکی از سرورها از کار بیفتد، ترافیک خودکار به سرور دیگر می‌رود.</li>}
        </ul>
      </Card>
    </div>
  );
}

const EMPTY: GeoRecordInput = { name: "", type: "A", iran: "", world: "", ttl: 60, priority: null };
function Records({ z }: { z: GeoZone }) {
  const db = useDB(); const { confirm } = useApp();
  const plan = db.geo.plans.find((p) => p.id === z.planId);
  const [edit, setEdit] = useState<{ id: number | null; r: GeoRecordInput } | null>(null);
  const fqdn = (r: GeoRecord) => (r.name === "@" ? z.domain : r.name + "." + z.domain);
  return (
    <Card pad="p-3 sm:p-4" title={<span className="flex items-center gap-2">رکوردها <Badge>{fa(z.records.length)} از {fa(plan?.records ?? 0)}</Badge></span>}
      action={<button type="button" onClick={() => setEdit({ id: null, r: { ...EMPTY } })} className={BTN_P + " h-9 px-3 text-xs"}><Icon name="plus" size={14} />رکورد</button>}>
      {z.records.length === 0 ? <Empty icon="network" title="رکوردی ندارید" /> : (
        <ul className="divide-y divide-white/[0.06]">
          {z.records.map((r) => { const geo = GEO_TYPES.find((t) => t.id === r.type)!.geo && !!r.world; return (
            <li key={r.id} className="py-3 px-1">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0"><span className="flex items-center gap-2 flex-wrap"><Badge>{r.type}</Badge><b dir="ltr" className="text-sm break-all">{fqdn(r)}</b>{geo && <Badge tone="blue">تفکیک جغرافیایی</Badge>}</span></span>
                <span className="flex gap-1 shrink-0">
                  <button type="button" aria-label={"ویرایش " + fqdn(r)} onClick={() => setEdit({ id: r.id, r: { name: r.name, type: r.type, iran: r.iran, world: r.world, ttl: r.ttl, priority: r.priority } })} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-white/10"><Icon name="pencil" size={14} /></button>
                  <button type="button" aria-label={"حذف " + fqdn(r)} onClick={async () => { if (await confirm("رکورد " + r.type + " " + fqdn(r) + " حذف شود؟", { danger: true, ok: "حذف" })) await api.geo.removeRecord(z.id, r.id); }} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-white/10 hover:text-rose-300"><Icon name="trash-2" size={14} /></button>
                </span>
              </div>
              <div className={"grid gap-2 mt-2 text-xs " + (geo ? "sm:grid-cols-2" : "")}>
                <div className="rounded-xl bg-white/[0.03] px-3 py-2 min-w-0"><span className="text-white/50">{geo ? "ایران" : "مقدار"}{r.type === "MX" ? " (اولویت " + fa(r.priority ?? 10) + ")" : ""}</span><span dir="ltr" className="block font-mono mt-0.5 break-all text-right">{r.iran}</span>{geo && plan?.healthChecks && <span className="block mt-1"><Up v={r.iranUp} /></span>}</div>
                {geo && <div className="rounded-xl bg-white/[0.03] px-3 py-2 min-w-0"><span className="text-white/50">خارج و موتورهای جستجو</span><span dir="ltr" className="block font-mono mt-0.5 break-all text-right">{r.world}</span>{plan?.healthChecks && <span className="block mt-1"><Up v={r.worldUp} /></span>}</div>}
              </div>
            </li>
          ); })}
        </ul>
      )}
      <RecordModal z={z} edit={edit} onClose={() => setEdit(null)} />
    </Card>
  );
}

function RecordModal({ z, edit, onClose }: { z: GeoZone; edit: { id: number | null; r: GeoRecordInput } | null; onClose: () => void }) {
  const { notify } = useApp();
  const [r, setR] = useState<GeoRecordInput>(EMPTY);
  const [key, setKey] = useState<string>("");
  const k = edit ? String(edit.id) + edit.r.name : "";
  if (edit && key !== k) { setKey(k); setR(edit.r); }
  const t = GEO_TYPES.find((x) => x.id === r.type)!;
  return (
    <Modal open={!!edit} onClose={onClose} title={edit?.id ? "ویرایش رکورد" : "رکورد جدید"} icon="network">
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="نام" hint={"@ یعنی خود " + z.domain}><input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value.trim().toLowerCase() })} dir="ltr" placeholder="www" className={INPUT + " text-left"} /></Field>
          <Field label="نوع"><Select label="نوع رکورد" value={r.type} onChange={(v) => setR({ ...r, type: v as GeoRecordType, world: GEO_TYPES.find((x) => x.id === v)!.geo ? r.world : "" })} options={GEO_TYPES.map((x) => ({ value: x.id, label: x.label }))} /></Field>
        </div>
        <Field label={t.geo ? "مقدار برای ایران" : "مقدار"} hint={t.hint}><input value={r.iran} onChange={(e) => setR({ ...r, iran: e.target.value })} dir="ltr" className={INPUT + " text-left font-mono"} /></Field>
        {t.geo && <Field label="مقدار برای خارج و موتورهای جستجو" hint="خالی = برای همه یکسان (بدون تفکیک)"><input value={r.world} onChange={(e) => setR({ ...r, world: e.target.value })} dir="ltr" className={INPUT + " text-left font-mono"} /></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="TTL (ثانیه)" hint="برای رکوردهای تفکیک‌شده ۶۰ پیشنهاد می‌شود"><input value={r.ttl} inputMode="numeric" onChange={(e) => setR({ ...r, ttl: Number(e.target.value.replace(/\D/g, "")) || 60 })} dir="ltr" className={INPUT + " text-left"} /></Field>
          {r.type === "MX" && <Field label="اولویت"><input value={r.priority ?? 10} inputMode="numeric" onChange={(e) => setR({ ...r, priority: Number(e.target.value.replace(/\D/g, "")) || 0 })} dir="ltr" className={INPUT + " text-left"} /></Field>}
        </div>
        <AsyncButton onClick={async () => {
          if (edit?.id) await api.geo.updateRecord(z.id, edit.id, r); else await api.geo.addRecord(z.id, r);
          notify("رکورد ذخیره و منتشر شد", "check"); onClose();
        }}>ذخیره</AsyncButton>
      </div>
    </Modal>
  );
}

function TestTool({ z }: { z: GeoZone }) {
  const db = useDB();
  const plan = db.geo.plans.find((p) => p.id === z.planId);
  const opts = { geo: z.status === "active", failover: !!plan?.healthChecks };
  const rows = z.records.filter((r) => ["A", "AAAA", "CNAME"].includes(r.type));
  return (
    <Card title="هر بازدیدکننده چه پاسخی می‌گیرد؟" icon="radar">
      <p className="text-sm text-white/65 leading-7 mb-4">پاسخ فعلی DNS برای کاربر داخل ایران و برای کاربر خارج (از جمله ربات گوگل)، با در نظر گرفتن وضعیت سرورها.{z.status !== "active" && " تا فعال شدن دامنه، تفکیک انجام نمی‌شود."}</p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-4">
            <b dir="ltr" className="text-sm block text-right break-all">{(r.name === "@" ? "" : r.name + ".") + z.domain} <span className="text-white/50 font-normal">{r.type}</span></b>
            <div className="grid sm:grid-cols-2 gap-2 mt-3 text-sm">
              <div className="flex items-center justify-between gap-2 rounded-xl bg-black/25 px-3 py-2"><span className="text-white/60 text-xs">🇮🇷 کاربر ایران</span><code dir="ltr" className="font-mono break-all">{answerFor(r, "iran", opts)}</code></div>
              <div className="flex items-center justify-between gap-2 rounded-xl bg-black/25 px-3 py-2"><span className="text-white/60 text-xs">🌍 خارج و گوگل</span><code dir="ltr" className="font-mono break-all">{answerFor(r, "world", opts)}</code></div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Settings({ z }: { z: GeoZone }) {
  const db = useDB(); const router = useRouter(); const { notify } = useApp();
  const [planId, setPlanId] = useState(z.planId);
  const [path, setPath] = useState(z.healthPath);
  const [conf, setConf] = useState("");
  const plan = db.geo.plans.find((p) => p.id === z.planId);
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="پلن" icon="gauge">
        <Select label="پلن" value={planId} onChange={setPlanId} options={db.geo.plans.map((p) => ({ value: p.id, label: p.name + " — " + toman(p.price) + " / ماه" }))} />
        <p className="text-[11px] text-white/50 mt-2 leading-6">ارتقا: مابه‌تفاوت باقی‌مانده ماه از کیف پول کسر می‌شود. کاهش پلن بلافاصله اعمال می‌شود و مبلغی برگشت داده نمی‌شود.</p>
        <AsyncButton disabled={planId === z.planId} className="mt-3" onClick={async () => { await api.geo.changePlan(z.id, planId); notify("پلن تغییر کرد", "gauge"); }}>تغییر پلن</AsyncButton>
      </Card>
      <Card title="تمدید و سلامت" icon="settings-2">
        <div className="flex items-center justify-between gap-3 text-sm"><span>تمدید خودکار ماهانه از کیف پول<span className="block text-[11px] text-white/50">اعتبار فعلی تا {z.paidUntil}</span></span><Switch on={z.autoRenew} onChange={async (v) => { await api.geo.settings(z.id, { autoRenew: v }); notify(v ? "تمدید خودکار روشن شد" : "تمدید خودکار خاموش شد", "refresh-cw"); }} label="تمدید خودکار" /></div>
        {plan?.healthChecks && <div className="mt-5">
          <Field label="مسیر بررسی سلامت" hint="نام‌سرورها هر چند ثانیه این مسیر را با HTTPS روی هر دو سرور باز می‌کنند؛ اگر پاسخ نیاید، ترافیک به سرور دیگر می‌رود."><input value={path} onChange={(e) => setPath(e.target.value.trim())} dir="ltr" className={INPUT + " text-left"} /></Field>
          <AsyncButton disabled={path === z.healthPath} className={BTN_G + " h-9 px-3 text-xs mt-2"} onClick={async () => { await api.geo.settings(z.id, { healthPath: path }); notify("ذخیره شد", "check"); }}>ذخیره</AsyncButton>
        </div>}
      </Card>
      <Card title="حذف از Geo DNS" icon="trash-2" className="lg:col-span-2">
        <p className="text-sm text-white/65 leading-7">پیش از حذف، NS دامنه را به سرویس DNS دیگری برگردانید؛ وگرنه دامنه از کار می‌افتد. مبلغ باقی‌مانده برگشت داده نمی‌شود.</p>
        <label className="block text-xs text-white/60 mt-3" htmlFor="geo-del">برای تأیید، دامنه را بنویسید: <b dir="ltr">{z.domain}</b></label>
        <input id="geo-del" value={conf} onChange={(e) => setConf(e.target.value)} dir="ltr" className={INPUT + " text-left mt-1.5 max-w-sm"} />
        <AsyncButton danger disabled={conf.trim().toLowerCase() !== z.domain} className="mt-3" onClick={async () => { await api.geo.remove(z.id, conf); notify("حذف شد", "trash-2"); router.push("/panel/geo" as never); }}>حذف همیشگی</AsyncButton>
      </Card>
    </div>
  );
}
