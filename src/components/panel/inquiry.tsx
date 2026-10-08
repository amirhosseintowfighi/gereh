"use client";
import Link from "next/link";
import { useState } from "react";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { INQUIRY_CATEGORIES, INQUIRY_SERVICES, inquiryDef, type InquiryField } from "@/lib/inquiry";
import { api, useDB, useMyId } from "@/lib/store";
import type { InquiryAccess } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, Bars, CopyText, Modal, PageTitle, Select, StatCard, Switch, Tabs } from "../ui-client";

export const ACCESS: Record<InquiryAccess, [string, "green" | "blue" | "amber" | "red" | "gray"]> = {
  open: ["فعال", "green"], approved: ["فعال", "green"], pending: ["در حال بررسی", "amber"], rejected: ["رد شده", "red"], none: ["نیازمند تأیید", "gray"],
};
export const CALL_STATUS: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]> = {
  success: ["موفق", "green"], not_found: ["یافت نشد", "blue"], invalid: ["ورودی نامعتبر", "gray"], error: ["خطای سرویس‌دهنده", "red"], denied: ["موجودی ناکافی", "amber"],
};
const QUICK = [1_000_000, 5_000_000, 10_000_000, 50_000_000];

export function UserInquiry() {
  const db = useDB(); const myId = useMyId();
  const { notify } = useApp();
  const me = db.users.find((u) => u.id === myId);
  const q = db.inquiry;
  const [tab, setTab] = useState("services");
  if (!q.account) return <Activate kyc={me?.kyc ?? "none"} />;
  const acct = q.account;
  return (
    <div>
      <div className="relative overflow-hidden rounded-[1.75rem] p-6 sm:p-8 mb-5 text-white" style={{ background: "linear-gradient(120deg, #1e2a78 0%, #2347c9 55%, #0ea5e9 100%)" }}>
        <div aria-hidden="true" className="absolute -left-16 -top-24 w-72 h-72 rounded-full bg-white/10" />
        <div className="relative flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <p className="text-xs text-white/75">پنل یکپارچه سرویس‌های استعلامی</p>
            <h1 className="text-2xl sm:text-3xl font-black mt-1">مدیریت API</h1>
            <p className="text-sm text-white/80 mt-2">اعتبار، اطلاعات اتصال و سرویس‌های فعال شما در یک صفحه</p>
          </div>
          <div className="sm:text-left">
            <p className="text-xs text-white/75">موجودی قابل استفاده</p>
            <p className="text-2xl sm:text-3xl font-black tabular mt-1">{fa(me?.balance ?? 0)} <span className="text-sm font-normal">تومان</span></p>
            <p className="text-[11px] text-white/70 mt-1">مصرف امروز: {toman(q.stats.todaySpend)} · {fa(q.stats.todayCount)} درخواست</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-5">
        <Credentials />
        <Topup />
      </div>

      <div className="overflow-x-auto no-scrollbar mb-4"><Tabs size="sm" value={tab} onChange={setTab} label="بخش‌های API" options={[
        { id: "services", label: "سرویس‌ها", icon: "layers" }, { id: "logs", label: "گزارش درخواست‌ها", icon: "activity" },
        { id: "test", label: "تست سرویس", icon: "terminal" }, { id: "security", label: "امنیت", icon: "shield-check" },
      ]} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "services" && <Services />}
        {tab === "logs" && <Logs />}
        {tab === "test" && <Playground />}
        {tab === "security" && <Security ips={acct.ipAllow} onSaved={() => notify("محدودیت IP ذخیره شد", "shield-check")} />}
      </div>
    </div>
  );
}

function Activate({ kyc }: { kyc: string }) {
  const { notify } = useApp();
  return (
    <div>
      <PageTitle title="API استعلام" sub="استعلام هویتی، بانکی و کسب‌وکار با یک API؛ پرداخت فقط به ازای هر درخواست." />
      <Card>
        <div className="grid md:grid-cols-[1.2fr_1fr] gap-8 items-center">
          <div>
            <h2 className="text-xl font-black leading-9">کلید API خود را بسازید و در چند دقیقه اولین استعلام را بگیرید</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-white/75">
              {["بدون هزینه ماهانه؛ فقط درخواست‌های موفق از کیف پول کم می‌شوند", "ورودی اشتباه رایگان است و خطای سرویس‌دهنده برگشت داده می‌شود", "محیط آزمایشی (sandbox) رایگان برای توسعه", "محدودیت IP، گزارش کامل درخواست‌ها و کد پیگیری"].map((t) => <li key={t} className="flex gap-2"><Icon name="check" size={16} className="acc shrink-0 mt-1" />{t}</li>)}
            </ul>
          </div>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.1] p-5">
            {kyc === "verified" ? <>
              <p className="text-sm text-white/70 leading-7">با فعال‌سازی، شناسه کاربری، API Key و رمز API برای شما ساخته می‌شود.</p>
              <AsyncButton className={BTN_P + " w-full h-11 mt-4"} onClick={async () => { await api.inquiry.activate(); notify("دسترسی API فعال شد", "key-round"); }}><Icon name="key-round" size={16} />فعال‌سازی API</AsyncButton>
            </> : <>
              <p className="text-sm text-white/70 leading-7">به دلیل حساسیت اطلاعات، سرویس‌های استعلام فقط به حساب‌های <b>احرازشده</b> ارائه می‌شوند.</p>
              <Link href="/panel/account" className={BTN_P + " w-full h-11 mt-4"}><Icon name="fingerprint" size={16} />تکمیل احراز هویت</Link>
            </>}
            <Link href={"/docs/inquiry" as never} className={BTN_G + " w-full h-10 mt-2 text-sm"}><Icon name="book-open" size={15} />مستندات API</Link>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Credentials() {
  const db = useDB(); const { notify } = useApp();
  const a = db.inquiry.account!;
  const [secret, setSecret] = useState<string | null>(null);
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[6.5rem_1fr] sm:grid-cols-[8rem_1fr] items-center gap-3 py-3 border-b border-white/[0.06] last:border-0">
      <span className="text-xs text-white/60">{label}</span><div className="min-w-0">{value}</div>
    </div>
  );
  return (
    <Card title="اطلاعات اتصال" icon="plug" action={a.status === "active" ? <Badge tone="green" dot>فعال</Badge> : <Badge tone="red" dot>معلق</Badge>}>
      {row("شناسه کاربر", <CopyText text={String(a.accountNo)} className="font-mono text-sm" />)}
      {row("API Key", <CopyText text={a.apiKey} className="font-mono text-sm break-all" />)}
      {row("API Password", secret
        ? <CopyText text={secret} className="font-mono text-sm break-all" />
        : <button type="button" onClick={async () => setSecret(await api.inquiry.reveal())} className="text-sm acc inline-flex items-center gap-1.5"><Icon name="eye" size={14} />نمایش رمز</button>)}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        <span className="text-[11px] text-white/50">فعال از {a.since}</span>
        <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} confirmText="رمز فعلی بلافاصله از کار می‌افتد و باید رمز جدید را در برنامه‌تان جایگزین کنید. ادامه؟" onClick={async () => { await api.inquiry.rotate(); setSecret(null); notify("رمز جدید ساخته شد؛ آن را در برنامه‌تان جایگزین کنید", "key-round"); }}><Icon name="refresh-cw" size={13} />ساخت رمز جدید</AsyncButton>
      </div>
    </Card>
  );
}

function Topup() {
  const [amount, setAmount] = useState("");
  const n = Number(amount.replace(/[^\d۰-۹]/g, "").replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))) || 0;
  return (
    <Card title="افزایش موجودی" icon="wallet">
      <Field label="مبلغ موردنظر (تومان)">
        <input value={amount ? fa(n) : ""} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="مثلاً ۵٬۰۰۰٬۰۰۰" className={INPUT + " tabular"} />
      </Field>
      <div className="flex flex-wrap gap-2 mt-3">
        {QUICK.map((v) => <button key={v} type="button" onClick={() => setAmount(String(v))} aria-pressed={n === v} className={"h-8 px-3 rounded-full text-xs border transition " + (n === v ? "bg-sky-400/15 border-sky-300/50 text-white" : "border-white/[0.14] text-white/70 hover:text-white")}>{fa(v / 1e6)} میلیون</button>)}
      </div>
      <AsyncButton disabled={n < 100_000} className={BTN_P + " w-full h-11 mt-4"} onClick={async () => { if (n > 500_000_000) throw new Error("حداکثر مبلغ هر پرداخت ۵۰۰ میلیون تومان است."); await api.billing.topup(n); }}>
        <Icon name="lock" size={16} />{n >= 100_000 ? "پرداخت " + toman(n) : "مبلغ را وارد کنید"}
      </AsyncButton>
      <p className="text-[11px] text-white/50 mt-3 leading-6">حداقل ۱۰۰ هزار و حداکثر ۵۰۰ میلیون تومان. موجودی بلافاصله پس از پرداخت قابل استفاده است و برای همه سرویس‌های گره مشترک است.</p>
    </Card>
  );
}

function Services() {
  const q = useDB().inquiry;
  const [ask, setAsk] = useState<string | null>(null);
  const [cat, setCat] = useState("all");
  const list = q.services.filter((s) => cat === "all" || inquiryDef(s.id)?.category === cat);
  return (
    <Card pad="p-3 sm:p-4" title={<span className="flex items-center gap-2">سرویس‌های فعال <Badge>{fa(q.services.length)} سرویس</Badge></span>}
      action={<Link href={"/docs/inquiry" as never} className="text-xs acc inline-flex items-center gap-1"><Icon name="book-open" size={13} />مستندات</Link>}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {[{ id: "all", label: "همه" }, ...INQUIRY_CATEGORIES].map((c) => (
          <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)} className={"h-8 px-3 rounded-lg text-xs transition " + (cat === c.id ? "bg-white text-black font-bold" : "bg-white/[0.05] text-white/65 hover:text-white")}>{c.label}</button>
        ))}
      </div>
      {/* table on wide screens, cards on phones */}
      <div className="hidden md:block overflow-x-auto" tabIndex={0} role="region" aria-label="سرویس‌ها">
        <table className="w-full text-sm">
          <thead><tr className="text-white/55 text-xs text-right"><th className="p-3">نام سرویس</th><th className="p-3">شناسه فنی</th><th className="p-3">قیمت هر درخواست</th><th className="p-3">وضعیت</th></tr></thead>
          <tbody>{list.map((s) => (
            <tr key={s.id} className="border-t border-white/[0.06]">
              <td className="p-3 font-bold">{s.name}<span className="block text-[11px] font-normal text-white/50 mt-0.5 max-w-md">{inquiryDef(s.id)?.summary}</span></td>
              <td className="p-3"><code dir="ltr" className="text-xs text-white/75">{s.id}</code></td>
              <td className="p-3 tabular font-bold text-emerald-300 whitespace-nowrap">{toman(s.price)}</td>
              <td className="p-3"><AccessCell access={s.access} note={s.note} onAsk={() => setAsk(s.id)} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <ul className="md:hidden space-y-2">
        {list.map((s) => (
          <li key={s.id} className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-4">
            <div className="flex items-start justify-between gap-3"><b className="text-sm leading-6">{s.name}</b><span className="tabular font-bold text-emerald-300 text-sm whitespace-nowrap">{toman(s.price)}</span></div>
            <code dir="ltr" className="block text-[11px] text-white/55 mt-1 text-right">{s.id}</code>
            <div className="mt-3"><AccessCell access={s.access} note={s.note} onAsk={() => setAsk(s.id)} /></div>
          </li>
        ))}
      </ul>
      <RequestAccess serviceId={ask} onClose={() => setAsk(null)} />
    </Card>
  );
}

function AccessCell({ access, note, onAsk }: { access: InquiryAccess; note: string; onAsk: () => void }) {
  const [label, tone] = ACCESS[access];
  if (access === "none" || access === "rejected") return (
    <span className="flex flex-wrap items-center gap-2"><Badge tone={tone}>{label}</Badge><button type="button" onClick={onAsk} className="text-xs acc">درخواست فعال‌سازی</button>{note && <span className="text-[11px] text-rose-300/80 w-full">{note}</span>}</span>
  );
  return <Badge tone={tone} dot>{label}</Badge>;
}

function RequestAccess({ serviceId, onClose }: { serviceId: string | null; onClose: () => void }) {
  const { notify } = useApp();
  const [text, setText] = useState("");
  const def = serviceId ? inquiryDef(serviceId) : undefined;
  return (
    <Modal open={!!serviceId} onClose={onClose} title={"درخواست دسترسی: " + (def?.name ?? "")} icon="file-check">
      <p className="text-sm text-white/70 leading-7">این سرویس با اطلاعات شخصی سروکار دارد و طبق مقررات فقط برای کاربرد مشخص و قانونی فعال می‌شود. کاربرد خود را دقیق بنویسید؛ معمولاً ظرف یک روز کاری بررسی می‌شود.</p>
      <Field label="کاربرد شما" className="mt-4"><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلاً: احراز هویت فروشندگان مارکت‌پلیس پیش از تسویه حساب" className={TEXTAREA} /></Field>
      <p className="text-[11px] text-white/50 mt-1">{fa(text.trim().length)} از حداقل ۲۰ نویسه</p>
      <AsyncButton disabled={text.trim().length < 20} className="mt-4" onClick={async () => { await api.inquiry.requestAccess(serviceId!, text.trim()); notify("درخواست ثبت شد", "file-check"); setText(""); onClose(); }}>ثبت درخواست</AsyncButton>
    </Modal>
  );
}

function Logs() {
  const q = useDB().inquiry;
  const [svc, setSvc] = useState("all");
  const rows = q.calls.filter((c) => svc === "all" || c.serviceId === svc);
  const name = (id: string) => q.services.find((s) => s.id === id)?.name ?? id;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon="activity" label="درخواست امروز" value={q.stats.todayCount} />
        <StatCard icon="wallet" label="هزینه امروز" value={q.stats.todaySpend} suffix="تومان" />
        <StatCard icon="chart-column" label="درخواست ۳۰ روز" value={q.stats.monthCount} />
        <StatCard icon="receipt" label="هزینه ۳۰ روز" value={q.stats.monthSpend} suffix="تومان" />
      </div>
      {q.stats.daily.length > 1 && <Card title="درخواست‌های روزانه" icon="chart-column"><Bars data={q.stats.daily.map((d) => d.count)} labels={q.stats.daily.map((d) => d.day.split("/").slice(-2).join("/"))} height={140} /></Card>}
      <Card pad="p-3 sm:p-4" title="آخرین درخواست‌ها" icon="scroll-text" action={<div className="w-48"><Select label="سرویس" value={svc} onChange={setSvc} options={[{ value: "all", label: "همه سرویس‌ها" }, ...q.services.map((s) => ({ value: s.id, label: s.name }))]} /></div>}>
        {rows.length === 0 ? <Empty icon="activity" title="درخواستی ثبت نشده است" text="پس از اولین فراخوانی API، جزئیات هر درخواست اینجا دیده می‌شود." /> : (
          <ul className="divide-y divide-white/[0.06]">
            {rows.map((c) => { const [label, tone] = CALL_STATUS[c.status] ?? [c.status, "gray"]; return (
              <li key={c.id} className="py-3 px-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                <span className="text-sm font-bold truncate">{name(c.serviceId)}</span>
                <span className="text-sm tabular text-left">{c.charged ? toman(c.charged) : "رایگان"}</span>
                <span className="flex flex-wrap items-center gap-2 text-[11px] text-white/55"><Badge tone={tone}>{label}</Badge>{c.sandbox && <Badge tone="blue">sandbox</Badge>}{c.source === "panel" && <span>از پنل</span>}<span dir="ltr" className="font-mono">{c.input}</span></span>
                <span className="text-[11px] text-white/50 text-left whitespace-nowrap">{c.at}</span>
                <span className="col-span-2 text-[11px] text-white/40" dir="ltr">{c.id} · {fa(c.latencyMs)}ms</span>
              </li>
            ); })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function FieldInput({ f, value, onChange }: { f: InquiryField; value: string; onChange: (v: string) => void }) {
  if (f.kind === "image") return (
    <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={f.label} className="block w-full text-xs text-white/70 file:me-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-white/10 file:text-white"
      onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const r = new FileReader(); r.onload = () => onChange(String(r.result)); r.readAsDataURL(file); }} />
  );
  return <input value={value} onChange={(e) => onChange(e.target.value)} dir={f.kind === "name" ? "rtl" : "ltr"} placeholder={f.example} className={INPUT + (f.kind === "name" ? "" : " text-left font-mono")} />;
}

function Playground() {
  const q = useDB().inquiry;
  const usable = q.services.filter((s) => s.access === "open" || s.access === "approved");
  const [sid, setSid] = useState(usable[0]?.id ?? "");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [sandbox, setSandbox] = useState(true);
  const [out, setOut] = useState<{ http: number; body: Record<string, unknown> } | null>(null);
  const def = inquiryDef(sid);
  const svc = q.services.find((s) => s.id === sid);
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="ارسال درخواست آزمایشی" icon="terminal">
        {!usable.length ? <Empty icon="layers" title="سرویس فعالی ندارید" /> : <div className="space-y-4">
          <Field label="سرویس"><Select label="سرویس" value={sid} onChange={(v) => { setSid(v); setVals({}); setOut(null); }} options={usable.map((s) => ({ value: s.id, label: s.name }))} /></Field>
          {def?.fields.map((f) => <Field key={f.key} label={f.label}><FieldInput f={f} value={vals[f.key] ?? ""} onChange={(v) => setVals({ ...vals, [f.key]: v })} /></Field>)}
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3 text-sm">
            <span>حالت آزمایشی (sandbox)<span className="block text-[11px] text-white/50">پاسخ نمونه و رایگان؛ برای پاسخ واقعی خاموش کنید ({svc ? toman(svc.price) : ""})</span></span>
            <Switch on={sandbox} onChange={setSandbox} label="حالت آزمایشی" />
          </div>
          <div className="flex flex-wrap gap-2">
            <AsyncButton confirmText={sandbox ? undefined : "این درخواست واقعی است و " + (svc ? toman(svc.price) : "") + " از کیف پول کم می‌شود (در صورت پاسخ قطعی). ادامه؟"} onClick={async () => setOut(await api.inquiry.test(sid, vals, sandbox))}><Icon name="send" size={15} />ارسال</AsyncButton>
            {def && <button type="button" className={BTN_G + " h-11 px-4 text-sm"} onClick={() => setVals(Object.fromEntries(def.fields.filter((f) => f.kind !== "image").map((f) => [f.key, f.example])))}>پر کردن با نمونه</button>}
          </div>
        </div>}
      </Card>
      <Card title="پاسخ" icon="code-xml">
        {out ? <>
          <div className="flex items-center gap-2 mb-3"><Badge tone={out.http === 200 ? "green" : out.http >= 500 ? "red" : "amber"}>HTTP {out.http}</Badge>{out.body.charged !== undefined && <span className="text-xs text-white/60">هزینه: {Number(out.body.charged) ? toman(Number(out.body.charged)) : "رایگان"}</span>}</div>
          <pre dir="ltr" tabIndex={0} aria-label="پاسخ JSON" className="text-left text-[12px] leading-6 font-mono bg-black/40 rounded-xl p-4 max-h-[60vh] overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(out.body, null, 2)}</pre>
        </> : <p className="text-sm text-white/55 leading-7">پاسخ JSON همان‌طور که API به برنامه شما برمی‌گرداند اینجا نمایش داده می‌شود.</p>}
      </Card>
    </div>
  );
}

function Security({ ips, onSaved }: { ips: string[]; onSaved: () => void }) {
  const [text, setText] = useState(ips.join("\n"));
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="محدودیت IP" icon="shield-check">
        <p className="text-sm text-white/65 leading-7">فقط درخواست‌هایی که از این IPها یا بازه‌ها بیایند پذیرفته می‌شوند. هر مورد در یک خط؛ خالی یعنی بدون محدودیت.</p>
        <textarea rows={5} dir="ltr" value={text} onChange={(e) => setText(e.target.value)} placeholder={"185.10.20.30\n5.160.0.0/16"} aria-label="IPهای مجاز" className={TEXTAREA + " font-mono text-left mt-3"} />
        <AsyncButton className="mt-3" onClick={async () => { await api.inquiry.setIps(text.split(/[\s,]+/).filter(Boolean)); onSaved(); }}>ذخیره</AsyncButton>
      </Card>
      <Card title="توصیه‌های امنیتی" icon="lock">
        <ul className="space-y-3 text-sm text-white/70 leading-7">
          {["رمز API را فقط سمت سرور نگه دارید؛ هرگز در اپ موبایل یا کد مرورگر قرار ندهید.", "محدودیت IP را روی IP سرورهای خود فعال کنید تا رمز لورفته قابل استفاده نباشد.", "اگر رمز در جایی منتشر شد، فوراً «ساخت رمز جدید» را بزنید.", "اطلاعات شخصی کاربران را فقط تا زمانی که لازم است نگه دارید؛ گره فقط چهار رقم آخر ورودی‌ها را در گزارش نگه می‌دارد."].map((t) => <li key={t} className="flex gap-2"><Icon name="check" size={16} className="acc shrink-0 mt-1" />{t}</li>)}
        </ul>
      </Card>
    </div>
  );
}

export const INQUIRY_COUNT = INQUIRY_SERVICES.length;
