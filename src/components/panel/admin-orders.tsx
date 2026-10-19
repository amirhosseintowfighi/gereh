"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { locLabel } from "@/lib/catalog";
import { BTN_G, BTN_P, INPUT } from "@/lib/cls";
import { fa, toEnDigits, toman } from "@/lib/format";
import { useLocs } from "@/lib/use-locs";
import { api, useDB, type UndeliveredOrder } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { DeliverModal, ManualFields, OrderDetailModal, RefundModal, UserLink, manual } from "./admin-order-detail";
import { AsyncButton, Modal, PageTitle, Select, StatCard } from "../ui-client";

const num = (s: string) => Number(toEnDigits(s).replace(/[^\d]/g, "")) || 0;
const STAGE: Record<UndeliveredOrder["stage"], [string, "blue" | "amber" | "red" | "gray"]> = {
  queued: ["در صف", "gray"], retrying: ["در حال تلاش دوباره", "amber"], stuck: ["گیر کرده", "red"], failed: ["ناموفق", "red"], building: ["ساخت طولانی شد", "amber"],
};
const KIND: Record<UndeliveredOrder["kind"], [string, string]> = { server: ["سرور", "server"], hosting: ["هاست", "layers"], domain: ["دامنه", "globe"], ip: ["IPv4 اضافه", "network"] };
const age = (m: number) => m < 60 ? fa(m) + " دقیقه" : m < 1440 ? fa(Math.round(m / 60)) + " ساعت" : fa(Math.round(m / 1440)) + " روز";

/* ================= Admin › سفارش‌های تحویل‌نشده ================= */
export function AdminOrders() {
  const { notify } = useApp();
  const [rows, setRows] = useState<UndeliveredOrder[] | null>(null);
  const [err, setErr] = useState("");
  const [deliver, setDeliver] = useState<UndeliveredOrder | null>(null);
  const [refund, setRefund] = useState<UndeliveredOrder | null>(null);
  const [assign, setAssign] = useState(false);
  const [detail, setDetail] = useState<UndeliveredOrder | null>(null);
  const load = useCallback(async () => {
    try { setRows(await api.provisioning.list()); setErr(""); } catch (e) { setErr(e instanceof Error ? e.message : "خطا"); }
  }, []);
  useEffect(() => { const first = setTimeout(load, 0), t = setInterval(load, 20_000); return () => { clearTimeout(first); clearInterval(t); }; }, [load]);
  const list = rows ?? [];
  return (
    <div>
      <PageTitle title="سفارش‌های تحویل‌نشده" sub="سفارش‌هایی که پرداخت شده‌اند اما سرویسشان هنوز تحویل نشده است."
        action={<div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setAssign(true)} className={BTN_G + " px-4 h-10 text-sm"}><Icon name="user-plus" size={15} /> تخصیص دستی سرور</button>
          {list.length > 0 && <AsyncButton confirmText="برای همه سفارش‌ها دوباره تلاش شود؟" onClick={async () => { const n = await api.provisioning.retryAll(); notify(fa(n) + " سفارش دوباره در صف قرار گرفت", "refresh-cw"); await load(); }}><Icon name="refresh-cw" size={15} /> تلاش دوباره برای همه</AsyncButton>}
        </div>} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <StatCard icon="package-open" label="تحویل‌نشده" value={list.length} tone={list.length ? "down" : ""} />
        <StatCard icon="circle-alert" label="ناموفق" value={list.filter((r) => r.stage === "failed").length} />
        <StatCard icon="wallet" label="مبلغ معلق" value={list.reduce((s, r) => s + r.amount, 0)} suffix="تومان" />
        <StatCard icon="clock" label="قدیمی‌ترین" value={list.length ? age(Math.max(...list.map((r) => r.ageMin))) : "—"} />
      </div>
      {err && <p role="alert" className="mb-4 p-3 rounded-[12px] bg-rose-400/10 text-rose-200 text-sm">{err}</p>}
      {rows === null ? <Card><div className="py-10 grid place-items-center"><Icon name="loader-circle" size={22} className="animate-spin text-white/50" /></div></Card>
        : list.length === 0 ? <Card><Empty icon="circle-check" title="همه سفارش‌ها تحویل شده‌اند" text="سفارشی که ساختش با خطا روبه‌رو شود این‌جا نمایش داده می‌شود." /></Card>
          : <div className="space-y-3">{list.map((r) => (
            <Card key={r.key} pad="p-4 sm:p-5">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon name={KIND[r.kind][1]} size={16} className="acc" />
                    <b className="text-sm">{r.item || KIND[r.kind][0]}</b>
                    <Badge tone={STAGE[r.stage][1]} dot>{STAGE[r.stage][0]}</Badge>
                    {r.serverName && <span className="mono text-xs text-white/55 ltr">{r.serverName}</span>}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                    <div><dt className="text-white/45">مشتری</dt><dd className="mt-0.5"><UserLink id={r.userId} name={r.userName} /><div className="text-white/45 ltr text-right truncate">{r.email}</div></dd></div>
                    <div><dt className="text-white/45">صورتحساب</dt><dd className="mt-0.5 mono">{r.invoiceId} · ردیف {fa(r.index + 1)}</dd></div>
                    <div><dt className="text-white/45">مبلغ</dt><dd className="mt-0.5 tabular">{toman(r.amount)}</dd></div>
                    <div><dt className="text-white/45">عمر / تلاش</dt><dd className="mt-0.5">{age(r.ageMin)} · {fa(r.attempts)} تلاش{r.ticket ? <> · <Link className="acc" href={("/admin/tickets/" + r.ticket) as never}>{r.ticket}</Link></> : null}</dd></div>
                  </dl>
                  {r.error && <pre className="mt-3 p-3 rounded-[10px] bg-black/30 border border-white/[0.08] text-[11px] leading-5 text-rose-100/90 whitespace-pre-wrap break-words max-h-48 overflow-auto ltr text-left" dir="auto">{r.error}</pre>}
                </div>
                <div className="flex flex-wrap lg:flex-col gap-2 shrink-0">
                  <button type="button" onClick={() => setDetail(r)} className={BTN_P + " px-3 h-9 text-xs"}><Icon name="file-text" size={14} /> جزئیات</button>
                  <AsyncButton className={BTN_G + " px-3 h-9 text-xs"} onClick={async () => { await api.provisioning.retry(r.key); notify("دوباره در صف قرار گرفت", "refresh-cw"); await load(); }}><Icon name="refresh-cw" size={14} /> تلاش دوباره</AsyncButton>
                  {r.kind !== "ip" && <button type="button" onClick={() => setDeliver(r)} className={BTN_G + " px-3 h-9 text-xs"}><Icon name="circle-check" size={14} /> تحویل دستی</button>}
                  {!r.vpsid && <button type="button" onClick={() => setRefund(r)} className={BTN_G + " px-3 h-9 text-xs text-rose-200"}><Icon name="wallet" size={14} /> بازگشت وجه</button>}
                </div>
              </div>
            </Card>
          ))}</div>}
      {deliver && <DeliverModal r={deliver} onClose={() => setDeliver(null)} onDone={load} />}
      {refund && <RefundModal r={refund} onClose={() => setRefund(null)} onDone={load} />}
      {assign && <AssignModal onClose={() => setAssign(false)} />}
      {detail && <OrderDetailModal invoiceId={detail.invoiceId} index={detail.index} onClose={() => setDetail(null)} onChanged={load} />}
    </div>
  );
}

function AssignModal({ onClose }: { onClose: () => void }) {
  const { notify } = useApp();
  const locs = useLocs();
  const [v, setV] = useState({ vpsid: "", ip: "", hostname: "", rootpass: "" });
  const [f, setF] = useState({ email: "", plan: "", cpu: "2", ram: "4", disk: "80", loc: locs[0]?.id ?? "thr", os: "Ubuntu 24.04", price: "", billing: "monthly", months: "1" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((c) => ({ ...c, [k]: e.target.value }));
  return (
    <Modal open onClose={onClose} title="تخصیص دستی سرور به مشتری" icon="user-plus" size="max-w-2xl"
      footer={<><button type="button" onClick={onClose} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => {
        await api.provisioning.assign({ ...manual(v), email: f.email.trim(), plan: f.plan.trim(), cpu: num(f.cpu), ram: num(f.ram), disk: num(f.disk), loc: f.loc, os: f.os.trim(), price: num(f.price), billing: f.billing as "monthly" | "hourly", months: num(f.months) });
        notify("سرور به مشتری تخصیص یافت", "circle-check"); onClose();
      }}>تخصیص</AsyncButton></>}>
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <Field label="ایمیل مشتری"><input value={f.email} onChange={set("email")} dir="ltr" className={INPUT + " text-left"} /></Field>
        <Field label="نام پلن"><input value={f.plan} onChange={set("plan")} className={INPUT} /></Field>
        <Field label="هسته / رم (گیگ) / دیسک (گیگ)"><div className="grid grid-cols-3 gap-2"><input value={f.cpu} onChange={set("cpu")} inputMode="numeric" aria-label="هسته" className={INPUT + " text-center"} /><input value={f.ram} onChange={set("ram")} inputMode="numeric" aria-label="رم" className={INPUT + " text-center"} /><input value={f.disk} onChange={set("disk")} inputMode="numeric" aria-label="دیسک" className={INPUT + " text-center"} /></div></Field>
        <Field label="موقعیت"><Select value={f.loc} onChange={(x) => setF((c) => ({ ...c, loc: x }))} options={locs.map((l) => ({ value: l.id, label: locLabel(l.id) }))} label="موقعیت" /></Field>
        <Field label="سیستم‌عامل"><input value={f.os} onChange={set("os")} dir="ltr" className={INPUT + " text-left"} /></Field>
        <Field label="قیمت ماهانه (تومان)"><input value={f.price} onChange={set("price")} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} /></Field>
        <Field label="نوع صورتحساب"><Select value={f.billing} onChange={(x) => setF((c) => ({ ...c, billing: x }))} options={[{ value: "monthly", label: "ماهانه" }, { value: "hourly", label: "ساعتی" }]} label="نوع صورتحساب" /></Field>
        <Field label="پرداخت‌شده تا (ماه از امروز)" hint="۰ = سررسید امروز"><input value={f.months} onChange={set("months")} inputMode="numeric" className={INPUT + " text-center"} /></Field>
      </div>
      <ManualFields v={v} set={(k, x) => setV((c) => ({ ...c, [k]: x }))} />
    </Modal>
  );
}

/** dashboard: warns while paid orders wait for delivery */
export function UndeliveredCard() {
  const db = useDB();
  if (!db.undelivered) return null;
  return (
    <Link href={"/admin/orders" as never} className="mb-4 flex items-center gap-3 p-4 rounded-[1.2rem] bg-amber-400/10 border border-amber-300/25 text-amber-100 hover:bg-amber-400/15">
      <Icon name="triangle-alert" size={20} />
      <span className="flex-1 text-sm leading-6"><b>{fa(db.undelivered)} سفارش پرداخت‌شده</b> هنوز تحویل نشده است؛ مشتری پول داده و سرویسی نگرفته است.</span>
      <span className="text-xs font-bold">بررسی</span>
    </Link>
  );
}

/** Virtualizor page: validates every mapping a real order needs */
export function VirtDryRun() {
  const [out, setOut] = useState<{ level: "error" | "warn" | "ok"; text: string }[] | null>(null);
  const tone = { error: "text-rose-200", warn: "text-amber-200", ok: "text-emerald-200" };
  return (
    <Card title="بررسی آزمایشی سفارش" icon="list-checks" action={<AsyncButton className={BTN_P + " px-4 h-9 text-xs"} onClick={async () => setOut(await api.provisioning.dryRun())}><Icon name="activity" size={14} /> اجرای بررسی</AsyncButton>}>
      <p className="text-xs text-white/55 leading-6">بدون ساختن VPS، همه پلن‌ها، Plan IDها، گروه‌های سرور موقعیت‌ها و قالب‌های سیستم‌عامل را با Virtualizor مقایسه می‌کند.</p>
      {out && <ul className="mt-4 space-y-2 text-sm">{out.map((x, i) => <li key={i} className={"flex gap-2 leading-6 " + tone[x.level]}><Icon name={x.level === "ok" ? "circle-check" : x.level === "warn" ? "triangle-alert" : "circle-alert"} size={16} className="mt-1 shrink-0" />{x.text}</li>)}</ul>}
    </Card>
  );
}
