"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { TLDS } from "@/lib/catalog";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import {
  ALERT_METRICS, CDN_RULE_LABEL, DNS_RECORD_TYPES, HOST_RE, IRNIC_RE, PROXIABLE, RECORD_HINT, TRANSFER_STATUS, validateRecord, WITH_PRIORITY,
  type AlertMetric, type CdnConfig, type CdnPoint, type CdnRule, type DnsSuggestion, type DomainAlertView, type TransferView, type WhoisView,
} from "@/lib/domains";
import { fa, toEnDigits, toman } from "@/lib/format";
import { api, useDB, useMyId, type DnsRecord } from "@/lib/store";
import type { Domain } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field, StatusBadge } from "../ui";
import { AreaChart, AsyncButton, CopyText, DataTable, IconBtn, Modal, PageTitle, Select, StatCard, Switch, Tabs, useMedia } from "../ui-client";

/** fetches on mount and on reload(); errors become a message instead of a crash */
function useLoad<T>(fn: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fn().then((d) => { if (alive) { setData(d); setError(""); } }, (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "خطا"); });
    return () => { alive = false; };
    // the key names everything the request depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}
const Pill = ({ s }: { s: string }) => { const [l, t] = TRANSFER_STATUS[s] ?? [s, "gray"]; return <Badge tone={t} dot>{l}</Badge>; };
const Row = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 p-3 rounded-xl"><div className="min-w-0"><div className="text-sm font-bold">{title}</div>{hint && <div className="text-xs text-white/55 mt-1 leading-6">{hint}</div>}</div><div className="shrink-0">{children}</div></div>
);
const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/* ================= transfer-in (domains list) ================= */
export function TransferInButton({ onDone }: { onDone: () => void }) {
  const { notify } = useApp();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ domain: "", authCode: "", irnicHandle: "" });
  const ir = /\.ir$/i.test(f.domain.trim());
  const tld = TLDS.slice().sort((a, b) => b.tld.length - a.tld.length).find((x) => f.domain.trim().toLowerCase().endsWith(x.tld));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BTN_G + " px-4 h-10 text-sm"}><Icon name="arrow-left-right" size={16} /> انتقال دامنه</button>
      <Modal open={open} onClose={() => setOpen(false)} title="انتقال دامنه به گره" icon="arrow-left-right"
        footer={<><button type="button" onClick={() => setOpen(false)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => {
          const domain = f.domain.trim().toLowerCase();
          if (!domain) throw new Error("نام دامنه را وارد کنید.");
          if (ir && !IRNIC_RE.test(f.irnicHandle.trim())) throw new Error("شناسه ایرنیک مالک را وارد کنید؛ مثل ab1234-irnic");
          if (!ir && f.authCode.trim().length < 6) throw new Error("کد انتقال (EPP) را وارد کنید.");
          await api.domains.transferIn({ domain, authCode: f.authCode.trim(), irnicHandle: f.irnicHandle.trim() });
          setOpen(false); setF({ domain: "", authCode: "", irnicHandle: "" }); onDone();
          notify("درخواست انتقال ثبت شد؛ پس از تأیید کارشناس انجام می‌شود");
        }}>{tld && tld.transfer > 0 ? "پرداخت " + toman(tld.transfer) + " از کیف پول" : "ثبت درخواست"}</AsyncButton></>}>
        <div className="space-y-4">
          <p className="text-sm text-white/60 leading-7">دامنه را نزد ثبت‌کننده فعلی از قفل خارج کنید و کد انتقال (EPP) را بگیرید. هزینه انتقال از کیف پول کم می‌شود و یک سال به اعتبار دامنه اضافه می‌شود؛ اگر انتقال انجام نشود مبلغ برمی‌گردد.</p>
          <Field label="نام دامنه"><input value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} placeholder="example.com" /></Field>
          {ir ? <Field label="شناسه ایرنیک مالک" hint="دامنه‌های ‎.ir با شناسه ایرنیک منتقل می‌شوند و کد EPP ندارند."><input value={f.irnicHandle} onChange={(e) => setF({ ...f, irnicHandle: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} placeholder="ab1234-irnic" /></Field>
            : <Field label="کد انتقال (EPP / Auth Code)"><input value={f.authCode} onChange={(e) => setF({ ...f, authCode: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} autoComplete="off" /></Field>}
          {tld && <div className="text-xs text-white/55">هزینه انتقال پسوند <span dir="ltr">{tld.tld}</span>: {tld.transfer ? toman(tld.transfer) : "رایگان"}</div>}
        </div>
      </Modal>
    </>
  );
}

/** transfer-in requests; `version` changes when a new one is filed */
export function TransferList({ version }: { version: number }) {
  const { notify, confirm } = useApp();
  const list = useLoad(() => api.domains.transfers(), String(version));
  const rows = (list.data ?? []).filter((t) => t.direction === "in");
  if (!rows.length) return null;
  return (
    <Card title="درخواست‌های انتقال به گره" icon="arrow-left-right" className="mb-5" pad="p-3 sm:p-4">
      <ul className="divide-y divide-white/[0.06]">
        {rows.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <span className="flex items-center gap-3"><b dir="ltr">{t.domain}</b><Pill s={t.status} /></span>
            <span className="flex items-center gap-3 text-xs text-white/55">
              {t.note && <span>{t.note}</span>}<span>{t.at}</span>{t.price > 0 && <span className="tabular">{toman(t.price)}</span>}
              {t.status === "pending" && <AsyncButton className={BTN_G + " h-8 px-3 text-xs"} onClick={async () => { if (await confirm("درخواست انتقال " + t.domain + " لغو و مبلغ به کیف پول برگردانده شود؟")) { await api.domains.cancelTransfer(t.id); list.reload(); notify("درخواست لغو شد"); } }}>لغو</AsyncButton>}
              {t.status === "completed" && t.domainId && <Link href={("/panel/domains/" + t.domainId) as never} className="acc">مدیریت</Link>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ================= IRNIC handle (domains list) ================= */
export function IrnicHandle() {
  const { notify } = useApp();
  const c = useLoad(() => api.domains.contact(), "");
  const [v, setV] = useState<string | null>(null);
  const val = v ?? c.data?.irnicHandle ?? "";
  return (
    <Card title="شناسه ایرنیک برای دامنه‌های ‎.ir" icon="id-card" className="mt-5">
      <p className="text-sm text-white/55 leading-7 mb-3">برای ثبت یا انتقال دامنه‌های ‎.ir شناسه مالک در ایرنیک لازم است. اگر ندارید، در nic.ir رایگان بسازید.</p>
      <div className="flex flex-wrap gap-2 max-w-lg">
        <input value={val} onChange={(e) => setV(e.target.value)} dir="ltr" className={INPUT + " text-left mono flex-1 min-w-[200px]"} placeholder="ab1234-irnic" aria-label="شناسه ایرنیک" />
        <AsyncButton onClick={async () => { const h = val.trim().toLowerCase(); if (h && !IRNIC_RE.test(h)) throw new Error("شناسه ایرنیک به شکل ab1234-irnic است."); await api.domains.setContact({ irnicHandle: h }); setV(null); c.reload(); notify("شناسه ایرنیک ذخیره شد"); }}>ذخیره</AsyncButton>
      </div>
    </Card>
  );
}

/* ================= domain page ================= */
const TABS = [
  { id: "dns", label: "DNS", icon: "settings-2" }, { id: "cdn", label: "CDN", icon: "cloud" }, { id: "ns", label: "نام‌سرورها", icon: "server" },
  { id: "settings", label: "تنظیمات", icon: "lock" }, { id: "transfer", label: "انتقال", icon: "arrow-left-right" }, { id: "renew", label: "تمدید", icon: "refresh-cw" },
];
export function DomainManage({ id }: { id: string }) {
  const db = useDB(); const myId = useMyId();
  const d = db.domains.find((x) => x.id === id && x.userId === myId);
  const [tab, setTab] = useState("dns");
  if (!d) return <Card><Empty icon="globe" title="دامنه پیدا نشد" action={<Link href="/panel/domains" className={BTN_G + " px-4 h-10 text-sm"}>بازگشت به فهرست</Link>} /></Card>;
  return (
    <div>
      <PageTitle back={["/panel/domains", "دامنه‌ها"]} title={<span className="ltr inline-block">{d.name}</span>} sub={<span className="flex gap-3 items-center"><StatusBadge s={d.status} />سررسید {d.expires}</span>} />
      <div className="overflow-x-auto no-scrollbar mb-6"><Tabs size="sm" value={tab} onChange={setTab} label="بخش‌های دامنه" options={TABS} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "dns" && <DnsTab d={d} />}
        {tab === "cdn" && <CdnTab d={d} />}
        {tab === "ns" && <NsTab d={d} />}
        {tab === "settings" && <SettingsTab d={d} />}
        {tab === "transfer" && <TransferTab d={d} />}
        {tab === "renew" && <RenewTab d={d} />}
      </div>
    </div>
  );
}

/* ---------- DNS ---------- */
type Rec = Omit<DnsRecord, "id"> & { id?: string };
const TTLS = [{ value: "300", label: "۵ دقیقه" }, { value: "60", label: "۱ دقیقه" }, { value: "1800", label: "۳۰ دقیقه" }, { value: "3600", label: "۱ ساعت" }, { value: "14400", label: "۴ ساعت" }, { value: "86400", label: "۱ روز" }];
const managedHere = (d: Domain) => d.ns.every((n) => /\.gereh\.net$/.test(n));

function DnsTab({ d }: { d: Domain }) {
  const { notify, confirm } = useApp();
  const [rec, setRec] = useState<Rec | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [zone, setZone] = useState<"import" | null>(null);
  const [quick, setQuick] = useState(false);
  const managed = managedHere(d);
  const rows = useMemo(() => d.dns.filter((r) => (!type || r.type === type) && (!q || (r.name + " " + r.value).toLowerCase().includes(q.trim().toLowerCase()))), [d.dns, q, type]);
  const types = [...new Set(d.dns.map((r) => r.type))];
  const narrow = useMedia("(max-width: 767.98px)");
  if (!managed) return <><Card><Empty icon="server" title="DNS این دامنه جای دیگری مدیریت می‌شود" text={"نام‌سرورها روی " + d.ns[0] + " تنظیم شده‌اند. برای مدیریت رکوردها، CDN و DNSSEC در گره، نام‌سرورها را به ns1.gereh.net و ns2.gereh.net تغییر دهید."} /></Card><NsCheck d={d} /></>;
  const cdn = (r: (typeof rows)[number]) => PROXIABLE.includes(r.type) ? (
    <button type="button" aria-pressed={!!r.proxied} title={r.proxied ? "از CDN عبور می‌کند" : "مستقیم (فقط DNS)"} onClick={async () => { try { await api.domains.setProxied(d.id, r.id, !r.proxied); notify(r.proxied ? "رکورد مستقیم شد" : "رکورد از CDN عبور می‌کند"); } catch (e) { notify((e as Error).message, "circle-alert"); } }}
      className={"inline-flex items-center gap-1 text-xs rounded-lg px-2 h-7 border " + (r.proxied ? "border-amber-300/40 text-amber-200 bg-amber-400/10" : "border-white/10 text-white/50")}>
      <Icon name={r.proxied ? "cloud" : "cloud-off"} size={14} />{r.proxied ? "پروکسی" : "مستقیم"}
    </button>) : <span className="text-white/30">—</span>;
  const actions = (r: (typeof rows)[number]) => <>
    <IconBtn icon="pencil" label={"ویرایش رکورد " + r.name} onClick={() => setRec({ ...r })} />
    <IconBtn icon="trash-2" label={"حذف رکورد " + r.name} className="hover:text-rose-300" onClick={async () => { if (await confirm("رکورد " + r.type + " " + r.name + " حذف شود؟", { danger: true, ok: "حذف" })) { await api.domains.removeRecord(d.id, r.id); notify("رکورد حذف شد"); } }} />
  </>;
  return (
    <div className="space-y-5">
      <Card title="رکوردها" icon="settings-2" pad="p-3 sm:p-4" action={<div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setQuick(true)} className={BTN_G + " px-3 h-9 text-xs"}><Icon name="zap" size={15} /> اتصال سریع</button>
        <button type="button" onClick={() => setZone("import")} className={BTN_G + " px-3 h-9 text-xs"}><Icon name="upload" size={15} /> ورود فایل زون</button>
        <AsyncButton className={BTN_G + " px-3 h-9 text-xs"} onClick={async () => download(d.name + ".zone", await api.domains.exportZone(d.id))}><Icon name="download" size={15} /> خروجی BIND</AsyncButton>
        <button type="button" onClick={() => setRec({ type: "A", name: "", value: "", ttl: 3600 })} className={BTN_P + " px-3 h-9 text-xs"}><Icon name="plus" size={15} /> رکورد جدید</button>
      </div>}>
        <div className="flex flex-wrap gap-2 mb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در نام و مقدار" aria-label="جستجوی رکورد" className={INPUT + " h-10 max-w-xs"} />
          <Select value={type} onChange={setType} label="فیلتر نوع" options={[{ value: "", label: "همه انواع" }, ...types.map((t) => ({ value: t, label: t }))]} className="w-40" ltr />
          <span className="text-xs text-white/50 self-center">{fa(rows.length)} از {fa(d.dns.length)} رکورد</span>
        </div>
        {d.dns.length === 0 ? <Empty icon="settings-2" title="رکوردی ندارید" text="با «اتصال سریع» دامنه را به اپ، سرور یا سرویس ایمیل خود وصل کنید." /> : (
          narrow ? (
            <ul className="space-y-2">{rows.map((r) => (
              <li key={r.id} className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge tone="blue">{r.type}</Badge><span className="mono ltr text-sm min-w-0 truncate">{r.name}</span>
                  <span className="ms-auto flex shrink-0">{actions(r)}</span>
                </div>
                <div className="mono text-xs ltr text-left text-white/70 mt-2 [overflow-wrap:anywhere]">{r.priority !== undefined && WITH_PRIORITY.includes(r.type) ? r.priority + " " : ""}{r.value}</div>
                <div className="flex items-center justify-between gap-2 mt-2 text-xs text-white/55"><span>TTL {fa(r.ttl)}</span>{cdn(r)}</div>
              </li>
            ))}</ul>
          ) :
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[720px]">
            <thead><tr className="text-xs text-white/55"><th scope="col" className="text-right font-medium p-3">نوع</th><th scope="col" className="text-right font-medium p-3">نام</th><th scope="col" className="text-right font-medium p-3">مقدار</th><th scope="col" className="text-right font-medium p-3">TTL</th><th scope="col" className="text-right font-medium p-3">CDN</th><th><span className="sr-only-focusable">اقدامات</span></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-white/[0.06] hover:bg-white/[0.02]">
                <td className="p-3"><Badge tone="blue">{r.type}</Badge></td><td className="p-3 mono ltr text-right">{r.name}</td>
                <td className="p-3 mono text-xs ltr text-right text-white/70 max-w-[300px] truncate" title={r.value}>{r.priority !== undefined && WITH_PRIORITY.includes(r.type) ? r.priority + " " : ""}{r.value}</td>
                <td className="p-3 tabular text-white/55">{fa(r.ttl)}</td>
                <td className="p-3">{cdn(r)}</td>
                <td className="p-3"><div className="flex justify-end gap-1">{actions(r)}</div></td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Card>
      <div className="grid lg:grid-cols-2 gap-5"><Dnssec d={d} /><NsCheck d={d} /></div>
      <RecordModal d={d} rec={rec} setRec={setRec} />
      <ZoneImport d={d} open={zone === "import"} onClose={() => setZone(null)} />
      <QuickConnect d={d} open={quick} onClose={() => setQuick(false)} />
    </div>
  );
}

function RecordModal({ d, rec, setRec }: { d: Domain; rec: Rec | null; setRec: (r: Rec | null) => void }) {
  const { notify } = useApp();
  const up = (p: Partial<Rec>) => rec && setRec({ ...rec, ...p });
  return (
    <Modal open={!!rec} onClose={() => setRec(null)} title={rec?.id ? "ویرایش رکورد" : "رکورد جدید"} icon="settings-2"
      footer={<><button type="button" onClick={() => setRec(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => {
        if (!rec) return;
        const withP = WITH_PRIORITY.includes(rec.type);
        const r = { ...rec, name: rec.name.trim(), value: rec.value.trim(), priority: withP ? Number(rec.priority ?? 10) : undefined, proxied: PROXIABLE.includes(rec.type) && !!rec.proxied };
        const err = validateRecord(r); if (err) throw new Error(err);
        if (r.id) await api.domains.updateRecord(d.id, r as DnsRecord); else await api.domains.addRecord(d.id, r);
        setRec(null); notify("رکورد ذخیره شد");
      }}>ذخیره</AsyncButton></>}>
      {rec && <div className="grid grid-cols-2 gap-4">
        <Field label="نوع"><Select value={rec.type} label="نوع رکورد" onChange={(v) => up({ type: v, proxied: PROXIABLE.includes(v) ? rec.proxied : false })} options={[...DNS_RECORD_TYPES]} ltr /></Field>
        <Field label="TTL"><Select value={String(rec.ttl)} label="TTL" onChange={(v) => up({ ttl: +v })} options={TTLS.some((t) => t.value === String(rec.ttl)) ? TTLS : [...TTLS, { value: String(rec.ttl), label: fa(rec.ttl) + " ثانیه" }]} /></Field>
        <Field label="نام" hint="@ برای خود دامنه، * برای همه زیردامنه‌ها"><input value={rec.name} onChange={(e) => up({ name: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} /></Field>
        {WITH_PRIORITY.includes(rec.type) ? <Field label="اولویت"><input value={rec.priority ?? 10} inputMode="numeric" onChange={(e) => up({ priority: +toEnDigits(e.target.value).replace(/\D/g, "") })} dir="ltr" className={INPUT + " text-left mono"} /></Field> : <div />}
        <Field className="col-span-2" label="مقدار" hint={RECORD_HINT[rec.type as keyof typeof RECORD_HINT]}>
          {rec.type === "TXT" ? <textarea value={rec.value} onChange={(e) => up({ value: e.target.value })} dir="ltr" rows={3} className={TEXTAREA + " text-left mono"} />
            : <input value={rec.value} onChange={(e) => up({ value: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} />}
        </Field>
        {PROXIABLE.includes(rec.type) && <div className="col-span-2"><Row title="عبور از CDN" hint="پاسخ DNS آدرس لبه CDN گره می‌شود و ترافیک کش و محافظت می‌شود. تنظیمات در تب CDN."><Switch on={!!rec.proxied} label="عبور از CDN" onChange={(v) => up({ proxied: v })} /></Row></div>}
      </div>}
    </Modal>
  );
}

function ZoneImport({ d, open, onClose }: { d: Domain; open: boolean; onClose: () => void }) {
  const { notify } = useApp();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <Modal open={open} onClose={onClose} title="ورود فایل زون (BIND)" icon="upload" size="max-w-2xl"
      footer={<><button type="button" onClick={onClose} className={BTN_G + " px-4 h-10 text-sm"}>بستن</button><AsyncButton confirmText={mode === "replace" ? "همه رکوردهای فعلی حذف و با فایل جایگزین شوند؟" : undefined} danger={mode === "replace"} onClick={async () => {
        const r = await api.domains.importZone(d.id, text, mode);
        setErrors(r.errors);
        notify(fa(r.added) + " رکورد وارد شد" + (r.errors.length ? "؛ " + fa(r.errors.length) + " خط نادیده ماند" : ""));
        if (!r.errors.length) { setText(""); onClose(); }
      }}>ورود</AsyncButton></>}>
      <div className="space-y-4">
        <p className="text-sm text-white/55 leading-7">خروجی BIND از سرویس قبلی را بچسبانید یا فایل را انتخاب کنید. SOA و NS ریشه نادیده گرفته می‌شوند؛ «; proxied» در انتهای خط یعنی عبور از CDN.</p>
        <input type="file" accept=".zone,.txt,.db,text/plain" aria-label="انتخاب فایل زون" className="text-xs" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} dir="ltr" className={TEXTAREA + " text-left mono text-xs"} placeholder={"$ORIGIN " + d.name + ".\n@ 3600 IN A 185.143.232.17\nwww 3600 IN CNAME " + d.name + "."} />
        <div role="radiogroup" aria-label="شیوه ورود" className="flex gap-2">
          {([["merge", "افزودن به رکوردهای فعلی"], ["replace", "جایگزینی کامل"]] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={(mode === k ? BTN_P : BTN_G) + " h-9 px-3 text-xs"}>{l}</button>)}
        </div>
        {errors.length > 0 && <ul className="text-xs text-amber-200 space-y-1 max-h-40 overflow-auto">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      </div>
    </Modal>
  );
}

function QuickConnect({ d, open, onClose }: { d: Domain; open: boolean; onClose: () => void }) {
  const { notify } = useApp();
  const s = useLoad(() => (open ? api.domains.suggestions(d.id) : Promise.resolve([] as DnsSuggestion[])), open + d.id);
  return (
    <Modal open={open} onClose={onClose} title="اتصال سریع دامنه" icon="zap" size="max-w-2xl">
      <p className="text-sm text-white/55 leading-7 mb-4">رکوردهای لازم ساخته می‌شوند و رکوردهای ناسازگار هم‌نام جایگزین می‌شوند.</p>
      {s.error ? <p className="text-sm text-rose-300">{s.error}</p> : !s.data ? <p className="text-sm text-white/50">در حال بارگذاری…</p> : s.data.length === 0 ? <Empty icon="zap" title="سرویسی برای اتصال ندارید" text="اپ، سرور ابری یا دامنه ایمیل بسازید تا اینجا پیشنهاد شود." /> : (
        <ul className="space-y-3">{s.data.map((x) => (
          <li key={x.key} className="rounded-2xl border border-white/[0.1] bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-bold text-sm"><Icon name={x.icon} size={16} />{x.label}</span>
              <AsyncButton className={BTN_P + " h-9 px-3 text-xs"} onClick={async () => { const r = await api.domains.applySuggestion(d.id, x.key); notify(fa(r.added) + " رکورد ساخته شد" + (r.replaced ? "، " + fa(r.replaced) + " رکورد جایگزین شد" : "")); onClose(); }}>اعمال</AsyncButton>
            </div>
            <ul className="mt-3 text-[11px] mono ltr text-left text-white/60 space-y-0.5">{x.records.map((r, i) => <li key={i} className="truncate">{r.type} {r.name} {r.priority !== null ? r.priority + " " : ""}{r.value}</li>)}</ul>
          </li>
        ))}</ul>
      )}
    </Modal>
  );
}

function Dnssec({ d }: { d: Domain }) {
  const { notify } = useApp();
  const x = useLoad(() => api.domains.extras(d.id), d.id);
  return (
    <Card title="DNSSEC" icon="shield-check" pad="p-3 sm:p-4">
      <Row title="امضای زون" hint="پاسخ‌های DNS امضا می‌شوند تا جعل نشوند. پس از روشن کردن، رکورد DS زیر را در ثبت‌کننده دامنه ثبت کنید.">
        <Switch on={!!x.data?.dnssec} label="DNSSEC" disabled={!x.data} onChange={async (v) => { try { await api.domains.setDnssec(d.id, v); x.reload(); notify(v ? "DNSSEC فعال شد" : "DNSSEC خاموش شد؛ DS را از ثبت‌کننده هم حذف کنید"); } catch (e) { notify((e as Error).message, "circle-alert"); } }} />
      </Row>
      {x.data?.dnssec && x.data.ds.map((ds) => (
        <div key={ds} className="m-3 rounded-xl bg-black/30 border border-white/10 p-3">
          <div className="text-[11px] text-white/50 mb-1">رکورد DS (keytag الگوریتم نوع‌هش هش)</div>
          <div className="flex items-start gap-2"><code className="mono text-[11px] ltr text-left break-all flex-1">{ds}</code><CopyText text={ds} className="text-xs" /></div>
        </div>
      ))}
    </Card>
  );
}

function NsCheck({ d }: { d: Domain }) {
  const [r, setR] = useState<{ ok: boolean; seen: string[]; expected: string[] } | null>(null);
  return (
    <Card title="بررسی واگذاری NS" icon="radar" pad="p-3 sm:p-4" className="mt-0">
      <p className="text-xs text-white/55 leading-6 px-3 pt-1">نام‌سرورهایی که رجیستری برای این دامنه اعلام می‌کند با تنظیمات اینجا مقایسه می‌شود.</p>
      <div className="p-3 flex items-center gap-3 flex-wrap">
        <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} onClick={async () => setR(await api.domains.nsCheck(d.id))}><Icon name="search" size={14} /> بررسی</AsyncButton>
        {r && (r.ok ? <Badge tone="green" dot>درست واگذار شده است</Badge> : <Badge tone="amber" dot>هنوز به این نام‌سرورها اشاره نمی‌کند</Badge>)}
      </div>
      {r && <div className="px-3 pb-2 text-[11px] text-white/55 space-y-1"><div>دیده‌شده: <span className="mono ltr inline-block">{r.seen.join("، ") || "—"}</span></div><div>مورد انتظار: <span className="mono ltr inline-block">{r.expected.join("، ")}</span></div></div>}
    </Card>
  );
}

/* ---------- name servers ---------- */
function NsTab({ d }: { d: Domain }) {
  const { notify } = useApp();
  const [ns, setNs] = useState<string[] | null>(null);
  const curNs = ns || d.ns;
  return (
    <div className="space-y-5">
      <Card title="نام‌سرورها" icon="server">
        <div className="space-y-3 max-w-lg">
          {curNs.map((n, i) => (
            <Field key={i} label={"نام‌سرور " + fa(i + 1)}>
              <div className="flex gap-2">
                <input value={n} onChange={(e) => { const a = curNs.slice(); a[i] = e.target.value; setNs(a); }} dir="ltr" className={INPUT + " text-left mono"} />
                {curNs.length > 2 && <IconBtn icon="x" label={"حذف نام‌سرور " + fa(i + 1)} onClick={() => setNs(curNs.filter((_, k) => k !== i))} />}
              </div>
            </Field>
          ))}
          {curNs.length < 4 && <button type="button" onClick={() => setNs([...curNs, ""])} className="text-xs text-white/55 hover:text-white flex items-center gap-1"><Icon name="plus" size={14} /> افزودن نام‌سرور</button>}
        </div>
        <div className="mt-6 flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={() => setNs(["ns1.gereh.net", "ns2.gereh.net"])} className={BTN_G + " px-4 h-10 text-sm"}>بازگشت به پیش‌فرض گره</button>
          <AsyncButton onClick={async () => {
            const list = curNs.map((x) => x.trim().toLowerCase()).filter(Boolean);
            if (list.length < 2) throw new Error("حداقل دو نام‌سرور لازم است.");
            if (list.some((x) => !HOST_RE.test(x))) throw new Error("نام‌سرور معتبر نیست؛ مثل ns1.example.com");
            if (new Set(list).size !== list.length) throw new Error("نام‌سرور تکراری است.");
            await api.domains.setNs(d.id, list); setNs(null); notify("نام‌سرورها به‌روز شدند؛ اعمال تا ۲۴ ساعت");
          }}>ذخیره تغییرات</AsyncButton>
        </div>
      </Card>
      <NsCheck d={d} />
    </div>
  );
}

/* ---------- settings: lock, auto-renew, privacy, WHOIS ---------- */
function SettingsTab({ d }: { d: Domain }) {
  const { notify } = useApp();
  const [w, setW] = useState<WhoisView | null>(null);
  const [raw, setRaw] = useState(false);
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="تنظیمات" icon="lock" pad="p-2 sm:p-3">
        {([["autoRenew", "تمدید خودکار", "پیش از سررسید از کیف پول تمدید می‌شود."], ["privacy", "محافظت از اطلاعات مالک (WHOIS Privacy)", "اطلاعات تماس شما در WHOIS نمایش داده نمی‌شود."], ["locked", "قفل انتقال", "از انتقال بدون اجازه دامنه جلوگیری می‌کند."]] as const).map(([k, l, hint]) => (
          <Row key={k} title={l} hint={hint}><Switch on={d[k]} label={l} onChange={async () => { await api.domains.toggle(d.id, k); notify(l + (d[k] ? " خاموش شد" : " فعال شد")); }} /></Row>
        ))}
      </Card>
      <Card title="WHOIS" icon="search" action={<AsyncButton className={BTN_G + " h-9 px-3 text-xs"} onClick={async () => setW(await api.domains.whois(d.name, !!w))}>{w ? "به‌روزرسانی" : "استعلام"}</AsyncButton>}>
        {!w ? <p className="text-sm text-white/55 leading-7">اطلاعات ثبت این دامنه از سرور WHOIS رجیستری (برای ‎.ir از ایرنیک) خوانده می‌شود.</p> : (
          <dl className="text-sm space-y-2">
            {([["ثبت‌کننده", w.registrar], ["ثبت", w.created], ["انقضا", w.expires], ["وضعیت", w.status.join("، ")], ["نام‌سرورها", w.nameservers.join("، ")]] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-white/55">{k}</dt><dd className="mono ltr text-left text-xs break-all">{v || "—"}</dd></div>
            ))}
            <div className="text-[11px] text-white/45 pt-2">سرور <span className="mono">{w.server}</span> · {w.cached ? "از حافظه (" + w.at + ")" : w.at}</div>
            <button type="button" className="text-xs acc" onClick={() => setRaw((x) => !x)}>{raw ? "پنهان کردن پاسخ خام" : "پاسخ خام"}</button>
            {raw && <pre className="text-[10px] mono ltr text-left whitespace-pre-wrap max-h-72 overflow-auto bg-black/30 rounded-xl p-3">{w.raw}</pre>}
          </dl>
        )}
      </Card>
    </div>
  );
}

/* ---------- transfer out ---------- */
function TransferTab({ d }: { d: Domain }) {
  const { notify } = useApp();
  const [code, setCode] = useState<string | null>(null);
  const ir = /\.ir$/.test(d.name);
  const shown = code ?? (d.authCode || null);
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="انتقال به ثبت‌کننده دیگر" icon="arrow-left-right">
        <ol className="text-sm text-white/60 leading-7 list-decimal pr-5 space-y-1">
          {ir ? <><li>قفل دامنه برداشته می‌شود.</li><li>در ثبت‌کننده جدید، انتقال را با شناسه ایرنیک مالک درخواست کنید.</li><li>تأیید ایرنیک به ایمیل مالک فرستاده می‌شود.</li></>
            : <><li>با دکمه زیر قفل انتقال برداشته و کد EPP صادر می‌شود.</li><li>کد را در ثبت‌کننده جدید وارد کنید.</li><li>انتقال معمولاً ۵ تا ۷ روز طول می‌کشد؛ DNS تا پایان انتقال از گره پاسخ می‌دهد.</li></>}
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <AsyncButton confirmText={"قفل " + d.name + " برداشته و کد انتقال صادر شود؟ هر کس این کد را داشته باشد می‌تواند دامنه را منتقل کند."} onClick={async () => { const r = await api.domains.transferOut(d.id); setCode(r.authCode); notify(r.ir ? "قفل دامنه برداشته شد" : "کد انتقال صادر شد"); }}>
            {ir ? "آماده‌سازی انتقال" : "دریافت کد انتقال"}
          </AsyncButton>
          <Badge tone={d.locked ? "green" : "amber"} dot>{d.locked ? "قفل است" : "قفل باز است"}</Badge>
        </div>
      </Card>
      <Card title="کد انتقال (EPP)" icon="key-round">
        {d.locked && !code ? <p className="text-sm text-white/55 leading-7">برای دیدن کد انتقال، ابتدا انتقال را آماده کنید یا قفل دامنه را در تب تنظیمات بردارید.</p>
          : !shown ? <p className="text-sm text-white/55 leading-7">{ir ? "دامنه‌های ‎.ir کد EPP ندارند؛ انتقال با شناسه ایرنیک انجام می‌شود." : "کد انتقال هنوز صادر نشده است."}</p> : (
          <div className="rounded-xl bg-black/30 border border-white/10 p-3 flex justify-between items-center gap-2">
            <span className="mono ltr break-all">{shown}</span><CopyText text={shown} className="text-xs" />
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- renew ---------- */
function RenewTab({ d }: { d: Domain }) {
  const router = useRouter(); const { notify } = useApp();
  const [years, setYears] = useState(1);
  const t = TLDS.slice().sort((a, b) => b.tld.length - a.tld.length).find((x) => d.name.endsWith(x.tld)) || TLDS[0];
  const [ey, ...rest] = d.expires.split("/");
  const newExpiry = fa(Number(toEnDigits(ey)) + years, 0).replace(/٬/g, "") + "/" + rest.join("/");
  return (
    <Card title="تمدید دامنه" icon="refresh-cw">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 max-w-2xl" role="radiogroup" aria-label="مدت تمدید">
        {[1, 2, 3, 5, 10].map((y) => <button type="button" role="radio" aria-checked={years === y} key={y} onClick={() => setYears(y)} className={"rounded-xl p-4 border text-center transition " + (years === y ? "bg-white/[0.1] border-white/40" : "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]")}><div className="font-black">{fa(y)} سال</div><div className="text-[11px] text-white/55 mt-1 tabular">{toman(t.renew * y)}</div></button>)}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 max-w-2xl">
        <div className="text-sm text-white/55">سررسید جدید پس از تمدید: <span className="text-white">{newExpiry}</span></div>
        <AsyncButton onClick={async () => { const inv = await api.domains.renew(d.id, years); notify("صورتحساب " + inv.id + " صادر شد"); router.push("/panel/billing"); }}>صدور صورتحساب</AsyncButton>
      </div>
    </Card>
  );
}

/* ---------- CDN ---------- */
const HSTS = [{ value: "0", label: "خاموش" }, { value: "300", label: "۵ دقیقه (آزمایش)" }, { value: "86400", label: "۱ روز" }, { value: "2592000", label: "۳۰ روز" }, { value: "15552000", label: "۶ ماه" }, { value: "31536000", label: "۱ سال" }, { value: "63072000", label: "۲ سال" }];
const BROWSER_TTL = [{ value: "0", label: "مطابق مبدأ" }, { value: "300", label: "۵ دقیقه" }, { value: "3600", label: "۱ ساعت" }, { value: "86400", label: "۱ روز" }, { value: "604800", label: "۱ هفته" }, { value: "2592000", label: "۳۰ روز" }];
const CACHE_TTL = [{ value: "60", label: "۱ دقیقه" }, { value: "600", label: "۱۰ دقیقه" }, { value: "3600", label: "۱ ساعت" }, { value: "86400", label: "۱ روز" }, { value: "604800", label: "۱ هفته" }, { value: "2592000", label: "۳۰ روز" }];
const bytes = (n: number) => (n >= 1e9 ? fa(n / 1e9, 1) + " گیگابایت" : fa(n / 1e6, 1) + " مگابایت");

function CdnTab({ d }: { d: Domain }) {
  const { notify } = useApp();
  const v = useLoad(() => api.domains.cdn(d.id), d.id + ":" + d.dns.length + ":" + d.dns.filter((r) => r.proxied).length);
  if (!managedHere(d)) return <Card><Empty icon="cloud" title="CDN نیاز به DNS گره دارد" text="نام‌سرورهای دامنه را به ns1.gereh.net و ns2.gereh.net تغییر دهید تا رکوردها از لبه CDN پاسخ بگیرند." /></Card>;
  if (v.error) return <Card><Empty icon="circle-alert" title={v.error} /></Card>;
  if (!v.data) return <Card><p className="text-sm text-white/50">در حال بارگذاری…</p></Card>;
  const c = v.data.config;
  const save = async (p: Partial<Omit<CdnConfig, "devUntil" | "cacheVersion">>, msg = "ذخیره شد") => {
    try { await api.domains.cdnUpdate(d.id, p); v.reload(); notify(msg); } catch (e) { notify((e as Error).message, "circle-alert"); }
  };
  return (
    <div className="space-y-5">
      <Card title="وضعیت CDN" icon="cloud" pad="p-2 sm:p-3">
        <Row title={c.enabled ? "CDN روشن است" : "CDN خاموش است"} hint={v.data.proxied ? fa(v.data.proxied) + " رکورد از CDN عبور می‌کند؛ پاسخ DNS آن‌ها " + v.data.edge.ipv4.join("، ") + " است." : "در تب DNS کنار رکوردهای A یا CNAME گزینه «پروکسی» را روشن کنید."}>
          <Switch on={c.enabled} label="CDN" onChange={(on) => save({ enabled: on }, on ? "CDN روشن شد" : "CDN خاموش شد")} />
        </Row>
        <Row title="حالت زیر حمله" hint="بازدیدکننده پیش از ورود یک بررسی کوتاه مرورگر می‌بیند و نرخ درخواست سخت‌تر محدود می‌شود."><Switch on={c.underAttack} label="زیر حمله" onChange={(on) => save({ underAttack: on }, on ? "حالت زیر حمله روشن شد" : "حالت زیر حمله خاموش شد")} /></Row>
        <Row title="حالت توسعه" hint={c.devMode ? "کش تا " + new Date(c.devUntil).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }) + " خاموش است." : "کش به مدت ۳ ساعت خاموش می‌شود تا تغییرات را فوری ببینید."}><Switch on={c.devMode} label="حالت توسعه" onChange={(on) => save({ devMode: on })} /></Row>
      </Card>
      <CdnStats d={d} />
      <div className="grid lg:grid-cols-2 gap-5">
        <OriginCard d={d} c={c} origin={v.data.origin} save={save} />
        <Card title="امنیت و TLS" icon="lock" pad="p-2 sm:p-3">
          <Row title="اجبار HTTPS" hint="درخواست‌های http با ۳۰۸ به https می‌روند."><Switch on={c.forceHttps} label="اجبار HTTPS" onChange={(on) => save({ forceHttps: on, ...(on ? {} : { hstsMaxAge: 0, hstsPreload: false }) })} /></Row>
          <Row title="HSTS (max-age)" hint="مرورگر تا این مدت فقط با HTTPS وصل می‌شود."><Select value={String(c.hstsMaxAge)} label="HSTS" onChange={(x) => save({ hstsMaxAge: +x, ...(+x < 31536000 ? { hstsPreload: false } : {}) })} options={HSTS} className="w-40" /></Row>
          <Row title="includeSubDomains"><Switch on={c.hstsSub} label="includeSubDomains" disabled={!c.hstsMaxAge} onChange={(on) => save({ hstsSub: on, ...(on ? {} : { hstsPreload: false }) })} /></Row>
          <Row title="preload" hint="حداقل یک سال و includeSubDomains لازم است."><Switch on={c.hstsPreload} label="preload" disabled={c.hstsMaxAge < 31536000 || !c.hstsSub} onChange={(on) => save({ hstsPreload: on })} /></Row>
          <Row title="حداقل نسخه TLS"><Select value={c.minTls} label="حداقل TLS" onChange={(x) => save({ minTls: x as CdnConfig["minTls"] })} options={["1.0", "1.1", "1.2", "1.3"].map((x) => ({ value: x, label: "TLS " + x }))} className="w-32" ltr /></Row>
        </Card>
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="کش" icon="database" pad="p-2 sm:p-3">
          <Row title="TTL مرورگر" hint="Cache-Control که به مرورگر بازدیدکننده فرستاده می‌شود."><Select value={String(c.browserTtl)} label="TTL مرورگر" onChange={(x) => save({ browserTtl: +x })} options={BROWSER_TTL} className="w-36" /></Row>
          <Purge d={d} enabled={c.enabled} />
        </Card>
        <CdnAlerts d={d} />
      </div>
      <CdnRules d={d} rules={v.data.rules} reload={v.reload} />
    </div>
  );
}

function OriginCard({ d, c, origin, save }: { d: Domain; c: CdnConfig; origin: string; save: (p: Partial<CdnConfig>) => Promise<void> }) {
  const [f, setF] = useState({ originHost: c.originHost, originHostHeader: c.originHostHeader });
  return (
    <Card title="مبدأ" icon="server">
      <div className="space-y-4">
        <Field label="آدرس مبدأ (IP یا نام میزبان)" hint={c.originHost ? "" : "خالی: آدرس رکورد پروکسی‌شده @ یا www" + (origin ? " (" + origin + ")" : "")}><input value={f.originHost} onChange={(e) => setF({ ...f, originHost: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} placeholder={origin || "185.143.232.17"} /></Field>
        <Field label="هدر Host ارسالی به مبدأ" hint={"خالی: " + d.name}><input value={f.originHostHeader} onChange={(e) => setF({ ...f, originHostHeader: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} placeholder={d.name} /></Field>
        <Row title="اتصال HTTPS به مبدأ"><Switch on={c.originHttps} label="HTTPS به مبدأ" onChange={(on) => save({ originHttps: on })} /></Row>
        <div className="flex justify-end"><AsyncButton onClick={() => save({ originHost: f.originHost.trim(), originHostHeader: f.originHostHeader.trim() })}>ذخیره مبدأ</AsyncButton></div>
      </div>
    </Card>
  );
}

function Purge({ d, enabled }: { d: Domain; enabled: boolean }) {
  const { notify } = useApp();
  const [urls, setUrls] = useState("");
  const [prefix, setPrefix] = useState("");
  const done = (r: { all: boolean }) => notify(r.all ? "کل کش پاک شد" : "کش آدرس‌ها پاک شد");
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between gap-3"><span className="text-sm font-bold">پاک کردن کش</span><AsyncButton disabled={!enabled} danger className={BTN_G + " h-9 px-3 text-xs"} confirmText="کل کش این دامنه پاک شود؟" onClick={async () => done(await api.domains.cdnPurge(d.id, { all: true }))}>پاک کردن همه</AsyncButton></div>
      <textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} dir="ltr" aria-label="آدرس‌ها برای پاک کردن" className={TEXTAREA + " text-left mono text-xs"} placeholder={"https://" + d.name + "/style.css\nhttps://" + d.name + "/app.js"} />
      <div className="flex justify-end"><AsyncButton disabled={!enabled} className={BTN_G + " h-9 px-3 text-xs"} onClick={async () => { const list = urls.split(/\s+/).filter(Boolean); if (!list.length) throw new Error("آدرسی وارد نشده است."); done(await api.domains.cdnPurge(d.id, { urls: list })); setUrls(""); }}>پاک کردن آدرس‌ها</AsyncButton></div>
      <div className="flex gap-2"><input value={prefix} onChange={(e) => setPrefix(e.target.value)} dir="ltr" aria-label="پیشوند" className={INPUT + " h-9 text-left mono text-xs"} placeholder={"https://" + d.name + "/images/"} />
        <AsyncButton disabled={!enabled} className={BTN_G + " h-9 px-3 text-xs shrink-0"} onClick={async () => { if (!prefix.trim()) throw new Error("پیشوند را وارد کنید."); done(await api.domains.cdnPurge(d.id, { prefix: prefix.trim() })); setPrefix(""); }}>پاک کردن پیشوند</AsyncButton></div>
    </div>
  );
}

function CdnStats({ d }: { d: Domain }) {
  const [hours, setHours] = useState(24);
  const s = useLoad(() => api.domains.cdnAnalytics(d.id, hours), d.id + ":" + hours);
  const pts: CdnPoint[] = s.data ?? [];
  const sum = (k: keyof Omit<CdnPoint, "at">) => pts.reduce((a, p) => a + p[k], 0);
  const req = sum("requests"), hit = req ? Math.round((sum("cached") / req) * 100) : 0;
  const labels = pts.map((p) => new Date(p.at).toLocaleString("fa-IR", hours > 48 ? { day: "numeric", month: "short" } : { hour: "2-digit", minute: "2-digit" }));
  return (
    <Card title="ترافیک و کش" icon="chart-column" action={<Select value={String(hours)} label="بازه" onChange={(x) => setHours(+x)} options={[{ value: "24", label: "۲۴ ساعت" }, { value: "168", label: "۷ روز" }, { value: "720", label: "۳۰ روز" }]} className="w-32" />}>
      {s.error ? <p className="text-sm text-rose-300">{s.error}</p> : !pts.length ? <p className="text-sm text-white/50">{s.data ? "هنوز داده‌ای ثبت نشده است." : "در حال بارگذاری…"}</p> : <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <StatCard icon="activity" label="درخواست" value={fa(req)} />
          <StatCard icon="database" label="نرخ کش" value={fa(hit) + "٪"} />
          <StatCard icon="arrow-down-up" label="ترافیک" value={bytes(sum("bytes"))} />
          <StatCard icon="shield-alert" label="مسدودشده" value={fa(sum("blocked"))} />
        </div>
        <AreaChart data={pts.map((p) => p.requests)} labels={labels} unit=" درخواست" />
        <div className="text-xs text-white/50 mt-3">نرخ کش در هر بازه</div>
        <AreaChart data={pts.map((p) => (p.requests ? (p.cached / p.requests) * 100 : 0))} labels={labels} height={120} fmt={(x) => fa(Math.round(x)) + "٪"} />
      </>}
    </Card>
  );
}

function CdnAlerts({ d }: { d: Domain }) {
  const { notify } = useApp();
  const a = useLoad(() => api.domains.alerts(d.id), d.id);
  const [f, setF] = useState<{ metric: AlertMetric; threshold: string }>({ metric: "requests", threshold: "" });
  const list: DomainAlertView[] = a.data ?? [];
  return (
    <Card title="هشدار ترافیک" icon="bell" pad="p-3 sm:p-4">
      <p className="text-xs text-white/55 leading-6 mb-3">هر ساعت ترافیک یک ساعت گذشته بررسی می‌شود؛ با عبور از آستانه اعلان و ایمیل می‌گیرید.</p>
      <ul className="space-y-2 mb-3">{list.map((x) => (
        <li key={x.id} className="flex items-center justify-between gap-2 text-sm rounded-xl bg-white/[0.03] px-3 py-2">
          <span>{ALERT_METRICS[x.metric]} ≥ <b className="tabular">{fa(x.threshold)}</b>{x.fired && <span className="text-[11px] text-amber-200 mr-2">آخرین هشدار {x.fired}</span>}</span>
          <span className="flex items-center gap-1"><Switch on={x.enabled} label="فعال" onChange={async (on) => { await api.domains.toggleAlert(d.id, x.id, on); a.reload(); }} /><IconBtn icon="trash-2" label="حذف هشدار" onClick={async () => { await api.domains.removeAlert(d.id, x.id); a.reload(); notify("هشدار حذف شد"); }} /></span>
        </li>
      ))}</ul>
      <div className="flex flex-wrap gap-2">
        <Select value={f.metric} label="معیار" onChange={(m) => setF({ ...f, metric: m as AlertMetric })} options={Object.entries(ALERT_METRICS).map(([value, label]) => ({ value, label }))} className="flex-1 min-w-[180px]" />
        <input value={f.threshold} onChange={(e) => setF({ ...f, threshold: toEnDigits(e.target.value).replace(/[^\d.]/g, "") })} inputMode="numeric" dir="ltr" aria-label="آستانه" placeholder="آستانه" className={INPUT + " h-10 w-28 text-left"} />
        <AsyncButton className={BTN_G + " h-10 px-3 text-xs"} onClick={async () => { const t = Number(f.threshold); if (!(t > 0)) throw new Error("آستانه را وارد کنید."); await api.domains.addAlert(d.id, { metric: f.metric, threshold: t }); setF({ ...f, threshold: "" }); a.reload(); notify("هشدار اضافه شد"); }}>افزودن</AsyncButton>
      </div>
    </Card>
  );
}

const ruleText = (r: CdnRule) => {
  switch (r.kind) {
    case "cache": return r.path + " ← " + (r.action === "bypass" ? "بدون کش" : "کش " + fa(r.ttl) + " ثانیه");
    case "redirect": return r.path + " ← " + r.code + " " + r.to;
    case "header": return r.name + ": " + r.value;
    case "auth": return r.path + " ← رمز برای " + r.user;
    case "access": return (r.action === "allow" ? "فقط اجازه به " : "مسدود: ") + (r.ip ?? "کشور " + r.country);
    case "ratelimit": return r.path + " ← " + fa(r.rps) + " درخواست در ثانیه (انفجاری " + fa(r.burst) + ")";
  }
};
type RuleForm = { kind: CdnRule["kind"]; path: string; action: string; ttl: string; to: string; code: string; name: string; value: string; user: string; password: string; target: string; rps: string; burst: string };
const EMPTY_RULE: RuleForm = { kind: "cache", path: "/", action: "cache", ttl: "3600", to: "", code: "301", name: "", value: "", user: "", password: "", target: "", rps: "10", burst: "20" };
function toRule(f: RuleForm): CdnRule & { password?: string } {
  switch (f.kind) {
    case "cache": return { kind: "cache", path: f.path, action: f.action as "cache" | "bypass", ttl: +f.ttl };
    case "redirect": return { kind: "redirect", path: f.path, to: f.to.trim(), code: f.code === "302" ? 302 : 301 };
    case "header": return { kind: "header", name: f.name.trim(), value: f.value };
    case "auth": return { kind: "auth", path: f.path, user: f.user.trim(), password: f.password };
    case "access": { const t = f.target.trim(); return { kind: "access", action: f.action === "allow" ? "allow" : "deny", ...(/^[a-z]{2}$/i.test(t) ? { country: t.toUpperCase() } : { ip: t }) }; }
    case "ratelimit": return { kind: "ratelimit", path: f.path, rps: +f.rps, burst: +f.burst };
  }
}

function CdnRules({ d, rules, reload }: { d: Domain; rules: (CdnRule & { id: string })[]; reload: () => void }) {
  const { notify, confirm } = useApp();
  const [f, setF] = useState<RuleForm | null>(null);
  const up = (p: Partial<RuleForm>) => f && setF({ ...f, ...p });
  const pathField = f && f.kind !== "header" && f.kind !== "access" && <Field label="مسیر" hint="مثل /static/* (با * یعنی همه زیرمسیرها)"><input value={f.path} onChange={(e) => up({ path: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} /></Field>;
  return (
    <Card title="قوانین" icon="list-checks" pad="p-3 sm:p-4" action={<button type="button" onClick={() => setF({ ...EMPTY_RULE })} className={BTN_P + " px-3 h-9 text-xs"}><Icon name="plus" size={15} /> قانون جدید</button>}>
      {rules.length === 0 ? <Empty icon="list-checks" title="قانونی ندارید" text="کش بر اساس مسیر، ریدایرکت، هدر پاسخ، رمز روی مسیر، دسترسی IP/کشور و محدودیت نرخ." /> : (
        <ul className="divide-y divide-white/[0.06]">{rules.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <span className="flex items-center gap-3 min-w-0"><Badge tone="blue">{CDN_RULE_LABEL[r.kind]}</Badge><span className="mono ltr text-xs text-white/70 truncate">{ruleText(r)}</span></span>
            <IconBtn icon="trash-2" label="حذف قانون" className="hover:text-rose-300" onClick={async () => { if (await confirm("این قانون حذف شود؟", { danger: true, ok: "حذف" })) { await api.domains.cdnRemoveRule(d.id, r.id); reload(); notify("قانون حذف شد"); } }} />
          </li>
        ))}</ul>
      )}
      <Modal open={!!f} onClose={() => setF(null)} title="قانون جدید CDN" icon="list-checks"
        footer={<><button type="button" onClick={() => setF(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => { if (!f) return; await api.domains.cdnAddRule(d.id, toRule(f)); setF(null); reload(); notify("قانون اضافه شد"); }}>افزودن</AsyncButton></>}>
        {f && <div className="space-y-4">
          <Field label="نوع قانون"><Select value={f.kind} label="نوع قانون" onChange={(k) => setF({ ...EMPTY_RULE, kind: k as CdnRule["kind"], action: k === "access" ? "deny" : "cache" })} options={Object.entries(CDN_RULE_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
          {pathField}
          {f.kind === "cache" && <div className="grid sm:grid-cols-2 gap-4">
            <Field label="رفتار"><Select value={f.action} label="رفتار کش" onChange={(x) => up({ action: x })} options={[{ value: "cache", label: "کش شود" }, { value: "bypass", label: "کش نشود" }]} /></Field>
            {f.action === "cache" && <Field label="مدت کش در لبه"><Select value={f.ttl} label="مدت کش" onChange={(x) => up({ ttl: x })} options={CACHE_TTL} /></Field>}
          </div>}
          {f.kind === "redirect" && <div className="grid sm:grid-cols-3 gap-4">
            <Field className="sm:col-span-2" label="مقصد"><input value={f.to} onChange={(e) => up({ to: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} placeholder={"https://" + d.name + "/new"} /></Field>
            <Field label="کد"><Select value={f.code} label="کد ریدایرکت" onChange={(x) => up({ code: x })} options={[{ value: "301", label: "۳۰۱ دائمی" }, { value: "302", label: "۳۰۲ موقت" }]} /></Field>
          </div>}
          {f.kind === "header" && <div className="grid sm:grid-cols-2 gap-4">
            <Field label="نام هدر"><input value={f.name} onChange={(e) => up({ name: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} placeholder="X-Frame-Options" /></Field>
            <Field label="مقدار"><input value={f.value} onChange={(e) => up({ value: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} placeholder="SAMEORIGIN" /></Field>
          </div>}
          {f.kind === "auth" && <div className="grid sm:grid-cols-2 gap-4">
            <Field label="نام کاربری"><input value={f.user} onChange={(e) => up({ user: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} autoComplete="off" /></Field>
            <Field label="رمز" hint="حداقل ۸ نویسه؛ فقط به شکل هش نگه داشته می‌شود."><input type="password" value={f.password} onChange={(e) => up({ password: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} autoComplete="new-password" /></Field>
          </div>}
          {f.kind === "access" && <div className="grid sm:grid-cols-3 gap-4">
            <Field label="رفتار"><Select value={f.action} label="رفتار دسترسی" onChange={(x) => up({ action: x })} options={[{ value: "deny", label: "مسدود" }, { value: "allow", label: "فقط اجازه" }]} /></Field>
            <Field className="sm:col-span-2" label="IP، بازه CIDR یا کد کشور" hint="مثل 5.160.0.0/16 یا IR"><input value={f.target} onChange={(e) => up({ target: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} /></Field>
          </div>}
          {f.kind === "ratelimit" && <div className="grid sm:grid-cols-2 gap-4">
            <Field label="درخواست در ثانیه برای هر IP"><input value={f.rps} onChange={(e) => up({ rps: toEnDigits(e.target.value).replace(/\D/g, "") })} inputMode="numeric" dir="ltr" className={INPUT + " text-left"} /></Field>
            <Field label="ظرفیت انفجاری"><input value={f.burst} onChange={(e) => up({ burst: toEnDigits(e.target.value).replace(/\D/g, "") })} inputMode="numeric" dir="ltr" className={INPUT + " text-left"} /></Field>
          </div>}
        </div>}
      </Modal>
    </Card>
  );
}

/* ================= admin ================= */
export function AdminDomains() {
  const { notify } = useApp();
  const list = useLoad(() => api.domains.adminTransfers(), "");
  const [reject, setReject] = useState<{ t: TransferView; reason: string } | null>(null);
  const rows: TransferView[] = list.data ?? [];
  const pending = rows.filter((t) => t.status === "pending").length;
  return (
    <div>
      <PageTitle title="دامنه‌ها" sub={fa(pending) + " درخواست انتقال در انتظار تأیید"} action={<Link href={"/admin/products" as never} className={BTN_G + " px-4 h-10 text-sm"}><Icon name="tag" size={16} /> قیمت ثبت، تمدید و انتقال پسوندها</Link>} />
      {list.error ? <Card><Empty icon="circle-alert" title={list.error} /></Card> : (
        <DataTable rows={rows} searchKeys={["domain", "user"]} empty="درخواست انتقالی نیست."
          filters={[{ key: "status", label: "وضعیت", options: Object.keys(TRANSFER_STATUS) }]}
          columns={[
            { key: "domain", label: "دامنه", sortable: true, render: (t) => <span className="font-bold ltr">{t.domain}</span> },
            { key: "direction", label: "جهت", render: (t) => t.direction === "in" ? <Badge tone="blue">ورودی</Badge> : <Badge>خروجی</Badge> },
            { key: "user", label: "مشتری" },
            { key: "price", label: "مبلغ", render: (t) => <span className="tabular">{t.price ? toman(t.price) : "—"}</span> },
            { key: "irnicHandle", label: "ایرنیک", render: (t) => <span className="mono text-xs">{t.irnicHandle || "—"}</span> },
            { key: "at", label: "تاریخ", sortable: true },
            { key: "status", label: "وضعیت", render: (t) => <span title={t.note}><Pill s={t.status} /></span> },
            { key: "actions", label: "", render: (t) => t.status === "pending" && t.direction === "in" ? (
              <span className="flex gap-1 justify-end">
                <AsyncButton className={BTN_P + " h-8 px-3 text-xs"} confirmText={"انتقال " + t.domain + " در رجیستری ثبت شود؟"} onClick={async () => { const r = await api.domains.adminApprove(t.id); list.reload(); notify(r.ok ? "انتقال انجام شد" : "رجیستری انتقال را نپذیرفت؛ مبلغ برگشت داده شد", r.ok ? undefined : "circle-alert"); }}>تأیید</AsyncButton>
                <button type="button" className={BTN_G + " h-8 px-3 text-xs"} onClick={() => setReject({ t, reason: "" })}>رد</button>
              </span>) : null },
          ]} />
      )}
      <Modal open={!!reject} onClose={() => setReject(null)} title={"رد انتقال " + (reject?.t.domain ?? "")} icon="x"
        footer={<><button type="button" onClick={() => setReject(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton danger onClick={async () => { if (!reject) return; await api.domains.adminReject(reject.t.id, reject.reason.trim()); setReject(null); list.reload(); notify("درخواست رد و مبلغ برگشت داده شد"); }}>رد درخواست</AsyncButton></>}>
        {reject && <Field label="دلیل (برای مشتری)"><textarea value={reject.reason} onChange={(e) => setReject({ ...reject, reason: e.target.value })} rows={3} className={TEXTAREA} /></Field>}
      </Modal>
    </div>
  );
}
