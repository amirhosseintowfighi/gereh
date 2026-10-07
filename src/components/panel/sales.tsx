"use client";
import Link from "next/link";
import { useState } from "react";
import { BTN_G, BTN_P, INPUT } from "@/lib/cls";
import { fa, toEnDigits, toman } from "@/lib/format";
import { api, byId, invGross, invTotal, useDB, useMyId, type Invoice } from "@/lib/store";
import { SITE_URL } from "@/lib/seo";
import { useApp } from "../app-context";
import { Wordmark } from "../brand";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field, StatusBadge } from "../ui";
import { AsyncButton, CopyText, DataTable, Modal, PageTitle, StatCard, Switch } from "../ui-client";

/* ================= referral programme ================= */
export function UserAffiliate() {
  const db = useDB(); const myId = useMyId();
  const a = db.affiliate;
  const link = SITE_URL + "/auth?ref=" + a.code;
  const earnings = db.transactions.filter((t) => t.userId === myId && t.type === "commission");
  const share = async () => {
    if (navigator.share) await navigator.share({ title: "گره — سرور ابری و هاست", text: "با این لینک در گره ثبت‌نام کنید:", url: link }).catch(() => {});
    else await navigator.clipboard.writeText(link);
  };
  return (
    <div>
      <PageTitle title="کسب درآمد با معرفی" sub={"به ازای هر پرداخت دوستانی که معرفی می‌کنید، " + fa(db.settings.affiliateRate) + "٪ مبلغ تا یک سال به کیف پول شما برمی‌گردد."} />
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <StatCard icon="users-round" label="کاربران معرفی‌شده" value={a.referred} />
        <StatCard icon="gift" label="مجموع پورسانت" value={a.earned} suffix="تومان" />
        <StatCard icon="badge-percent" label="سهم شما" value={db.settings.affiliateRate} suffix="٪" />
      </div>
      <div className="grid xl:grid-cols-[1.2fr_1fr] gap-4">
        <Card title="لینک اختصاصی شما" icon="share-2">
          <div className="rounded-xl bg-black/30 border border-white/10 p-3 flex items-center justify-between gap-3"><CopyText text={link} className="mono text-xs ltr break-all" /></div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm"><span className="text-white/55">کد معرف:</span><CopyText text={a.code} className="mono font-bold" /></div>
          <button type="button" onClick={share} className={BTN_P + " mt-5 px-4 h-10 text-sm"}><Icon name="share-2" size={16} /> اشتراک‌گذاری</button>
        </Card>
        <Card title="چطور کار می‌کند" icon="life-buoy">
          <ol className="space-y-3 text-sm text-white/70 leading-7 list-decimal pr-5">
            <li>لینک را برای دوستان و مشتریان‌تان بفرستید.</li>
            <li>هرکس با لینک شما ثبت‌نام کند، معرَّف شما ثبت می‌شود.</li>
            <li>از هر صورتحسابی که تا یک سال پرداخت می‌کند، {fa(db.settings.affiliateRate)}٪ به کیف پول شما می‌رود.</li>
            <li>موجودی را برای خرید و تمدید سرویس‌ها خرج کنید.</li>
          </ol>
        </Card>
      </div>
      <h2 className="font-extrabold mt-8 mb-3">پورسانت‌های دریافتی</h2>
      <DataTable rows={earnings} empty="هنوز پورسانتی دریافت نکرده‌اید."
        columns={[{ key: "date", label: "تاریخ" }, { key: "desc", label: "شرح" }, { key: "amount", label: "مبلغ", render: (r) => <span className="tabular font-bold text-emerald-300">+{toman(r.amount)}</span> }]} />
    </div>
  );
}

/* ================= wallet auto-pay ================= */
export function AutoPaySwitch() {
  const db = useDB(); const myId = useMyId();
  const { notify } = useApp();
  const me = byId(db.users, myId);
  if (!me) return null;
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] border border-white/[0.08] p-4 mt-6 max-w-2xl">
      <div><div className="text-sm font-bold">تمدید خودکار از کیف پول</div><div className="text-xs text-white/55 mt-1 leading-6">صورتحساب‌های تمدید، اگر موجودی کافی باشد، خودکار پرداخت می‌شوند و سرویس بدون وقفه ادامه می‌یابد.</div></div>
      <Switch on={me.autoPay} label="تمدید خودکار از کیف پول" onChange={async (v) => { await api.account.setAutoPay(v); notify(v ? "تمدید خودکار فعال شد" : "تمدید خودکار خاموش شد"); }} />
    </div>
  );
}

/* ================= official invoice ================= */
const EMPTY_OFFICIAL = { name: "", nationalId: "", economicCode: "", address: "", postalCode: "" };
export function OfficialInvoiceModal({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const db = useDB(); const myId = useMyId();
  const { notify } = useApp();
  const me = byId(db.users, myId);
  const [f, setF] = useState(inv.official ?? { ...EMPTY_OFFICIAL, name: me?.company || me?.name || "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal open onClose={onClose} title={"فاکتور رسمی " + inv.id} icon="file-check"
      footer={<><button type="button" onClick={onClose} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button>
        <AsyncButton onClick={async () => { await api.billing.setOfficial(inv.id, f); notify("اطلاعات فاکتور رسمی ذخیره شد", "file-check"); onClose(); window.open("/panel/billing/" + inv.id + "/print", "_blank", "noopener"); }}>ذخیره و چاپ</AsyncButton></>}>
      <p className="text-sm text-white/60 leading-7 mb-5">مشخصات خریدار طبق کارت ملی یا آگهی تأسیس شرکت. این اطلاعات روی فاکتور رسمی چاپ می‌شود.</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field className="sm:col-span-2" label="نام شخص یا شرکت"><input value={f.name} onChange={set("name")} className={INPUT} /></Field>
        <Field label="کد ملی / شناسه ملی شرکت"><input value={f.nationalId} onChange={set("nationalId")} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} /></Field>
        <Field label="کد اقتصادی (اختیاری)"><input value={f.economicCode} onChange={set("economicCode")} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} /></Field>
        <Field label="کد پستی"><input value={f.postalCode} onChange={set("postalCode")} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} /></Field>
        <Field className="sm:col-span-2" label="نشانی"><textarea value={f.address} onChange={set("address")} rows={2} className={INPUT + " h-auto py-2"} /></Field>
      </div>
    </Modal>
  );
}

/** A4 official invoice (فاکتور رسمی) — seller and buyer details, items, VAT; printed from the browser */
export function InvoicePrint({ id }: { id: string }) {
  const db = useDB(); const myId = useMyId();
  const inv = db.invoices.find((i) => i.id === id && i.userId === myId) ?? db.invoices.find((i) => i.id === id);
  if (!inv) return <Card><Empty icon="receipt" title="صورتحساب پیدا نشد" action={<Link href="/panel/billing" className={BTN_G + " px-4 h-10 text-sm"}>بازگشت</Link>} /></Card>;
  const s = db.settings;
  const sub = invTotal(inv), total = invGross(inv, s.tax), tax = total - sub;
  const o = inv.official;
  return (
    <div>
      <div className="flex flex-wrap justify-between gap-3 mb-6 print:hidden">
        <Link href="/panel/billing" className={BTN_G + " px-4 h-10 text-sm"}><Icon name="arrow-left" size={16} className="rotate-180" /> بازگشت</Link>
        <button type="button" onClick={() => window.print()} className={BTN_P + " px-5 h-10 text-sm"}><Icon name="printer" size={16} /> چاپ / ذخیره PDF</button>
      </div>
      <article className="print-area bg-white text-slate-900 rounded-2xl p-8 sm:p-10 max-w-[210mm] mx-auto text-[13px] leading-7 shadow-2xl">
        <header className="flex justify-between items-start border-b-2 border-slate-900 pb-5">
          <div className="[&_*]:!text-slate-900"><Wordmark size={34} sub={false} /></div>
          <div className="text-center"><h1 className="text-xl font-black">{o ? "صورتحساب فروش کالا و خدمات" : "صورتحساب"}</h1>{!o && <div className="text-xs text-slate-500 mt-1">برای فاکتور رسمی، مشخصات خریدار را ثبت کنید.</div>}</div>
          <div className="text-left text-xs space-y-1"><div>شماره: <b className="mono">{inv.id}</b></div><div>تاریخ: {inv.date}</div>{inv.paidAt && <div>پرداخت: {inv.paidAt}</div>}</div>
        </header>
        <section className="mt-5 rounded-xl border border-slate-300 p-4">
          <h2 className="font-black mb-2">مشخصات فروشنده</h2>
          <div className="grid sm:grid-cols-2 gap-x-6">{row("نام", s.legalName)}{row("شناسه ملی", s.sellerNationalId)}{row("کد اقتصادی", s.sellerEconomicCode)}{row("کد پستی", s.sellerPostalCode)}<div className="sm:col-span-2">{row("نشانی", s.sellerAddress)}</div></div>
        </section>
        <section className="mt-3 rounded-xl border border-slate-300 p-4">
          <h2 className="font-black mb-2">مشخصات خریدار</h2>
          {o ? <div className="grid sm:grid-cols-2 gap-x-6">{row("نام", o.name)}{row(o.nationalId.length === 11 ? "شناسه ملی" : "کد ملی", toEnDigits(o.nationalId))}{row("کد اقتصادی", o.economicCode)}{row("کد پستی", o.postalCode)}<div className="sm:col-span-2">{row("نشانی", o.address)}</div></div>
            : <div className="text-slate-500">{byId(db.users, inv.userId)?.name}</div>}
        </section>
        <table className="w-full mt-5 border border-slate-300 text-center">
          <thead className="bg-slate-100"><tr>{["ردیف", "شرح کالا یا خدمت", "مبلغ (تومان)"].map((h) => <th key={h} scope="col" className="border border-slate-300 p-2 font-bold">{h}</th>)}</tr></thead>
          <tbody>{inv.items.map((it, i) => <tr key={i}><td className="border border-slate-300 p-2">{fa(i + 1)}</td><td className="border border-slate-300 p-2 text-right">{it.desc}</td><td className="border border-slate-300 p-2 tabular">{fa(it.amount)}</td></tr>)}</tbody>
          <tfoot>
            <tr><td colSpan={2} className="border border-slate-300 p-2 text-left font-bold">جمع</td><td className="border border-slate-300 p-2 tabular">{fa(sub)}</td></tr>
            <tr><td colSpan={2} className="border border-slate-300 p-2 text-left font-bold">مالیات و عوارض ارزش افزوده ({fa(inv.tax ?? s.tax)}٪)</td><td className="border border-slate-300 p-2 tabular">{fa(tax)}</td></tr>
            <tr className="bg-slate-100"><td colSpan={2} className="border border-slate-300 p-2 text-left font-black">مبلغ کل</td><td className="border border-slate-300 p-2 tabular font-black">{fa(total)}</td></tr>
          </tfoot>
        </table>
        <footer className="mt-6 flex justify-between items-center text-xs text-slate-500">
          <div>وضعیت: <StatusBadge s={inv.status} /></div>
          <div>این صورتحساب به صورت الکترونیکی صادر شده و بدون مهر معتبر است.</div>
        </footer>
      </article>
    </div>
  );
}

const row = (k: string, v: string) => <div key={k} className="flex gap-2"><span className="text-slate-500 shrink-0">{k}:</span><span className="font-medium">{v || "—"}</span></div>;

export const officialBadge = (inv: Invoice) => (inv.official ? <Badge tone="green">رسمی</Badge> : null);
