"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Check, LineState, OrderDetail } from "@/lib/admin-detail";
import { adminDetailApi } from "@/lib/admin-detail-api";
import { BTN_G, INPUT, TEXTAREA } from "@/lib/cls";
import { fa, toEnDigits, toman } from "@/lib/format";
import { api, type UndeliveredOrder } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Field, StatusBadge, type Tone } from "../ui";
import { AsyncButton, CodeBlock, Modal, Select } from "../ui-client";

const num = (s: string) => Number(toEnDigits(s).replace(/[^\d]/g, "")) || 0;
const KIND_LABEL = { server: "سرور", hosting: "هاست", domain: "دامنه", ip: "IPv4 اضافه" } as const;
export const LINE_TONE: Record<LineState["state"], Tone> = { delivered: "green", pending: "blue", failed: "red", refunded: "gray", closed: "gray", renewal: "violet", none: "gray" };
export const userHref = (id: string) => ("/admin/users/" + encodeURIComponent(id)) as never;

/** a customer's name that opens the customer 360 view */
export function UserLink({ id, name, className = "" }: { id: string; name?: string; className?: string }) {
  return <Link href={userHref(id)} onClick={(e) => e.stopPropagation()} className={"hover:underline underline-offset-4 " + className}>{name || id}</Link>;
}

/* ---------- fix actions shared with Admin › سفارش‌های تحویل‌نشده ---------- */
export type FixTarget = Pick<UndeliveredOrder, "key" | "kind" | "vpsid" | "sku" | "item" | "userName" | "amount">;
export type ServerInput = { vpsid: string; ip: string; hostname: string; rootpass: string };

export function ManualFields({ v, set }: { v: ServerInput; set: (k: keyof ServerInput, x: string) => void }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label="شناسه VPS در Virtualizor" hint="با وارد کردن آن، IP و hostname از Virtualizor خوانده می‌شود."><input value={v.vpsid} onChange={(e) => set("vpsid", e.target.value)} inputMode="numeric" dir="ltr" className={INPUT + " text-left mono"} /></Field>
      <Field label="آدرس IPv4"><input value={v.ip} onChange={(e) => set("ip", e.target.value)} dir="ltr" placeholder="185.143.233.20" className={INPUT + " text-left mono"} /></Field>
      <Field label="Hostname"><input value={v.hostname} onChange={(e) => set("hostname", e.target.value)} dir="ltr" className={INPUT + " text-left mono"} /></Field>
      <Field label="رمز root" hint="اگر وارد شود، یک بار برای مشتری ایمیل می‌شود."><input value={v.rootpass} onChange={(e) => set("rootpass", e.target.value)} autoComplete="off" dir="ltr" className={INPUT + " text-left mono"} /></Field>
    </div>
  );
}
export const manual = (v: ServerInput) => ({ ...(num(v.vpsid) ? { vpsid: num(v.vpsid) } : {}), ...(v.ip.trim() ? { ip: v.ip.trim() } : {}), ...(v.hostname.trim() ? { hostname: v.hostname.trim() } : {}), ...(v.rootpass ? { rootpass: v.rootpass } : {}) });

export function DeliverModal({ r, onClose, onDone }: { r: FixTarget; onClose: () => void; onDone: () => Promise<void> }) {
  const { notify } = useApp();
  const [v, setV] = useState({ vpsid: r.vpsid ? String(r.vpsid) : "", ip: "", hostname: "", rootpass: "" });
  const [o, setO] = useState({ domain: r.sku?.t === "hosting" ? r.sku.domain ?? "" : r.sku?.t === "domain" ? r.sku.name : "", username: "", password: "", server: "" });
  const [note, setNote] = useState("");
  const submit = async () => {
    if (r.kind === "server") await api.provisioning.deliverServer(r.key, { ...manual(v), ...(note ? { note } : {}) });
    else await api.provisioning.deliverOther(r.key, { domain: o.domain.trim(), ...(o.username ? { username: o.username.trim() } : {}), ...(o.password ? { password: o.password } : {}), ...(o.server ? { server: o.server.trim() } : {}), ...(note ? { note } : {}) });
    notify("سفارش تحویل شد و به مشتری اطلاع داده شد", "circle-check");
    await onDone(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={"تحویل دستی " + KIND_LABEL[r.kind]} icon="circle-check" size="max-w-xl"
      footer={<><button type="button" onClick={onClose} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={submit}>تحویل و اطلاع به مشتری</AsyncButton></>}>
      <p className="text-xs text-white/60 leading-6 mb-4">{r.item} — {r.userName}</p>
      {r.kind === "server" ? <ManualFields v={v} set={(k, x) => setV((c) => ({ ...c, [k]: x }))} /> : (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="دامنه"><input value={o.domain} onChange={(e) => setO((c) => ({ ...c, domain: e.target.value }))} dir="ltr" className={INPUT + " text-left mono"} /></Field>
          {r.kind === "hosting" && <>
            <Field label="نام کاربری cPanel"><input value={o.username} onChange={(e) => setO((c) => ({ ...c, username: e.target.value }))} dir="ltr" className={INPUT + " text-left mono"} /></Field>
            <Field label="رمز cPanel" hint="یک بار برای مشتری ایمیل می‌شود."><input value={o.password} onChange={(e) => setO((c) => ({ ...c, password: e.target.value }))} autoComplete="off" dir="ltr" className={INPUT + " text-left mono"} /></Field>
            <Field label="سرور هاست"><input value={o.server} onChange={(e) => setO((c) => ({ ...c, server: e.target.value }))} dir="ltr" className={INPUT + " text-left mono"} /></Field>
          </>}
        </div>
      )}
      <Field label="یادداشت داخلی" className="mt-3"><input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} /></Field>
    </Modal>
  );
}

export function RefundModal({ r, onClose, onDone }: { r: FixTarget; onClose: () => void; onDone: () => Promise<void> }) {
  const { notify } = useApp();
  const [note, setNote] = useState("");
  return (
    <Modal open onClose={onClose} title="بازگشت وجه به کیف پول" icon="wallet"
      footer={<><button type="button" onClick={onClose} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton danger onClick={async () => { const a = await api.provisioning.refund(r.key, note.trim()); notify(toman(a) + " به کیف پول مشتری بازگشت", "wallet"); await onDone(); onClose(); }}>بازگشت {toman(r.amount)}</AsyncButton></>}>
      <p className="text-sm text-white/70 leading-7">مبلغ ردیف «{r.item}» (با مالیات و پس از سهم تخفیف) به کیف پول {r.userName} برمی‌گردد، سفارش بسته می‌شود و سرور در حال آماده‌سازی حذف می‌شود.</p>
      <Field label="پیام برای مشتری (اختیاری)" className="mt-4"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={TEXTAREA} /></Field>
    </Modal>
  );
}

/* ---------- order detail ---------- */
function Pairs({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
      {rows.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[11px] text-white/50">{k}</dt><dd className="mt-0.5 min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap leading-6">{v || "—"}</dd></div>)}
    </dl>
  );
}
function Section({ title, icon, children, action }: { title: string; icon: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-4">
      <div className="flex items-center justify-between gap-2 mb-3"><h3 className="text-sm font-bold flex items-center gap-2"><Icon name={icon} size={16} className="acc" />{title}</h3>{action}</div>
      {children}
    </section>
  );
}

export function PreflightList({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-2">
      {checks.map((c) => (
        <li key={c.key} className="flex gap-2.5 text-sm leading-6">
          <Icon name={!c.ok ? "circle-x" : c.warn ? "triangle-alert" : "circle-check"} size={17} className={"mt-1 shrink-0 " + (!c.ok ? "text-rose-300" : c.warn ? "text-amber-200" : "text-emerald-300")} />
          <div className="min-w-0">
            <b>{c.ok ? "✓" : "✗"} {c.label}</b> <span className="text-white/65 [overflow-wrap:anywhere]">— {c.detail}</span>
            {c.hint && <div className="text-xs text-amber-100/80">{c.hint} {c.href && <Link href={c.href as never} className="acc hover:underline">رفتن به صفحه</Link>}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function EditSpec({ d, onSaved }: { d: OrderDetail; onSaved: (retry: boolean) => Promise<void> }) {
  const { notify } = useApp();
  const [f, setF] = useState({ os: d.item.os, osid: "auto", loc: d.item.loc, plid: d.item.plid ? String(d.item.plid) : "" });
  const save = async (retry: boolean) => {
    const patch: { os?: string; osid?: number; loc?: string; plid?: number } = {};
    if (f.os !== d.item.os) patch.os = f.os;
    if (f.osid !== "auto") patch.osid = Number(f.osid);
    if (f.loc !== d.item.loc) patch.loc = f.loc;
    if (num(f.plid) !== d.item.plid) patch.plid = num(f.plid);
    const changes = await adminDetailApi.editOrder(d.invoiceId, d.index, patch);
    notify("مشخصات سفارش ویرایش شد: " + changes.join("، "), "pencil");
    if (retry) { await api.provisioning.retry(d.key); notify("دوباره در صف قرار گرفت", "refresh-cw"); }
    await onSaved(retry);
  };
  return (
    <Section title="ویرایش مشخصات قبل از تلاش دوباره" icon="pencil">
      <p className="text-xs text-white/55 leading-6 mb-3">فقط مشخصات همین سفارش تغییر می‌کند؛ نگاشت‌های عمومی دست نمی‌خورند. تغییرات در گزارش فعالیت ثبت می‌شود.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="سیستم‌عامل سفارش"><Select value={f.os} label="سیستم‌عامل" onChange={(x) => setF((c) => ({ ...c, os: x }))} options={d.options.oses.map((o) => ({ value: o.id, label: o.label }))} /></Field>
        <Field label="قالب همگام‌شده Virtualizor" hint={"فعلی: OSID " + (d.item.osid || "—")}><Select value={f.osid} label="قالب سیستم‌عامل" ltr onChange={(x) => setF((c) => ({ ...c, osid: x }))}
          options={[{ value: "auto", label: "بدون تغییر" }, { value: "0", label: "انتخاب خودکار از روی سیستم‌عامل" }, ...d.options.templates.map((x) => ({ value: String(x.osid), label: x.name + " (" + x.osid + ")" + (x.on ? "" : " — خاموش") }))]} /></Field>
        <Field label="موقعیت"><Select value={f.loc} label="موقعیت" onChange={(x) => setF((c) => ({ ...c, loc: x }))} options={d.options.locs.map((l) => ({ value: l.id, label: l.label + (l.group ? " — " + l.group : " — بدون گروه") }))} /></Field>
        <Field label="Plan ID در Virtualizor" hint="خالی یا ۰ = نگاشت پلن"><input value={f.plid} onChange={(e) => setF((c) => ({ ...c, plid: e.target.value }))} inputMode="numeric" dir="ltr" className={INPUT + " text-left mono"} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <AsyncButton className={BTN_G + " px-4 h-10 text-sm"} onClick={() => save(false)}><Icon name="check" size={15} /> ذخیره</AsyncButton>
        <AsyncButton onClick={() => save(true)}><Icon name="refresh-cw" size={15} /> ذخیره و تلاش دوباره</AsyncButton>
      </div>
    </Section>
  );
}

/** the full detail of one order line with its provisioning state and every fix action */
export function OrderDetailModal({ invoiceId, index, onClose, onChanged }: { invoiceId: string; index: number; onClose: () => void; onChanged?: () => Promise<void> | void }) {
  const { notify } = useApp();
  const [d, setD] = useState<OrderDetail | null>(null);
  const [err, setErr] = useState("");
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [fix, setFix] = useState<"deliver" | "refund" | null>(null);
  const load = useCallback(async () => {
    try { setD(await adminDetailApi.order(invoiceId, index)); setErr(""); } catch (e) { setErr(e instanceof Error ? e.message : "خطا"); }
  }, [invoiceId, index]);
  const pre = useCallback(async () => {
    try { setChecks(await adminDetailApi.preflight(invoiceId, index)); } catch { setChecks([]); }
  }, [invoiceId, index]);
  useEffect(() => { const t = setTimeout(() => { void load(); void pre(); }, 0); return () => clearTimeout(t); }, [load, pre]);
  const changed = async () => { await load(); await pre(); await onChanged?.(); };
  const kind = d && (d.item.type === "server" || d.item.type === "hosting" || d.item.type === "domain" || d.item.type === "ip") ? d.item.type : null;
  const open = !!d && !!kind && ["pending", "failed", "none"].includes(d.state.state) && (!!d.job || !!d.server);
  const target: FixTarget | null = d && kind ? { key: d.key, kind, vpsid: d.server?.vpsid ?? null, sku: (d.item.raw as { sku?: UndeliveredOrder["sku"] } | null)?.sku ?? null, item: d.item.title, userName: d.customer.name, amount: d.invoice.lineAmount } : null;
  return (
    <Modal open onClose={onClose} title={"جزئیات سفارش " + invoiceId + " · ردیف " + fa(index + 1)} icon="file-search" size="max-w-4xl"
      footer={open && target ? <>
        <AsyncButton className={BTN_G + " px-4 h-10 text-sm"} onClick={async () => { await api.provisioning.retry(d!.key); notify("دوباره در صف قرار گرفت", "refresh-cw"); await changed(); }}><Icon name="refresh-cw" size={15} /> تلاش دوباره</AsyncButton>
        {kind !== "ip" && <button type="button" onClick={() => setFix("deliver")} className={BTN_G + " px-4 h-10 text-sm"}><Icon name="circle-check" size={15} /> تحویل دستی</button>}
        {!d!.server?.vpsid && <button type="button" onClick={() => setFix("refund")} className={BTN_G + " px-4 h-10 text-sm text-rose-200"}><Icon name="wallet" size={15} /> بازگشت وجه</button>}
      </> : undefined}>
      {err && <p role="alert" className="p-3 rounded-[12px] bg-rose-400/10 text-rose-200 text-sm">{err}</p>}
      {!d && !err && <div className="py-10 grid place-items-center"><Icon name="loader-circle" size={22} className="animate-spin text-white/50" /></div>}
      {d && <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-base">{d.item.title}</b>
          <Badge tone={LINE_TONE[d.state.state]} dot>{d.state.label}</Badge>
          {d.state.state === "delivered" && d.state.href && <Link href={d.state.href as never} className="text-xs acc hover:underline">مشاهده سرویس</Link>}
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <Section title="مشتری" icon="user-round" action={<Link href={userHref(d.customer.id)} className="text-xs acc hover:underline">نمای کامل مشتری</Link>}>
            <Pairs rows={[["نام", <UserLink key="n" id={d.customer.id} name={d.customer.name} />], ["ایمیل", <span key="e" dir="ltr">{d.customer.email}</span>], ["موبایل", <span key="p" dir="ltr">{d.customer.phone}</span>], ["سطح حساب", d.customer.level],
              ["موجودی", toman(d.customer.balance)], ["احراز / وضعیت", <span key="k" className="inline-flex flex-wrap gap-1.5"><StatusBadge s={d.customer.kyc} /><StatusBadge s={d.customer.status} /></span>]]} />
          </Section>
          <Section title="صورتحساب" icon="receipt">
            <Pairs rows={[["شماره", <span key="i" className="mono">{d.invoice.id}</span>], ["وضعیت", <StatusBadge key="s" s={d.invoice.status} />], ["ایجاد", d.invoice.created], ["پرداخت", d.invoice.paid],
              ["روش پرداخت", d.invoice.method], ["درگاه / کد پیگیری", [d.invoice.gateway, d.invoice.refId].filter(Boolean).join(" · ")], ["کد تخفیف", d.invoice.coupon], ["مالیات", fa(d.invoice.taxRate) + "٪"]]} />
            <ul className="mt-3 divide-y divide-white/[0.06] text-sm">
              {d.invoice.lines.map((l, i) => <li key={i} className={"flex justify-between gap-3 py-2 " + (l.mine ? "text-white font-bold" : "text-white/65")}><span className="min-w-0 [overflow-wrap:anywhere]">{fa(i + 1)}. {l.desc}{l.mine && <Badge tone="blue">این سفارش</Badge>}</span><span className="tabular shrink-0">{toman(l.amount)}</span></li>)}
              <li className="flex justify-between py-2 text-white/60"><span>جمع / تخفیف / مالیات</span><span className="tabular">{toman(d.invoice.subtotal)} / {toman(d.invoice.discount)} / {toman(d.invoice.tax)}</span></li>
              <li className="flex justify-between py-2 font-black"><span>مبلغ کل</span><span className="tabular">{toman(d.invoice.total)}</span></li>
              <li className="flex justify-between py-2 text-xs text-white/55"><span>سهم پرداختی این ردیف (با مالیات)</span><span className="tabular">{toman(d.invoice.lineAmount)}</span></li>
            </ul>
          </Section>
        </div>
        <Section title="مشخصات درخواستی" icon="file-text">
          <Pairs rows={d.item.spec} />
          <details className="mt-3"><summary className="cursor-pointer text-xs text-white/55 hover:text-white">JSON خام سفارش</summary><CodeBlock className="mt-2" code={JSON.stringify(d.item.raw, null, 2)} label="JSON سفارش" title="sku.json" wrap /></details>
        </Section>
        <Section title="بررسی پیش از تحویل" icon="list-checks" action={<AsyncButton className={BTN_G + " px-3 h-8 text-xs"} onClick={pre}><Icon name="activity" size={13} /> اجرای دوباره</AsyncButton>}>
          {checks === null ? <Icon name="loader-circle" size={18} className="animate-spin text-white/50" /> : checks.length ? <PreflightList checks={checks} /> : <p className="text-sm text-white/55">برای این ردیف بررسی‌ای نیست.</p>}
        </Section>
        {d.item.editable && <EditSpec d={d} onSaved={changed} />}
        <Section title="تحویل" icon="package-open">
          {d.job ? <Pairs rows={[["کار", d.job.type + " #" + d.job.id], ["وضعیت", d.job.status], ["تلاش‌ها", fa(d.job.attempts)], ["اجرای بعدی", d.job.runAt], ["ایجاد", d.job.created], ...(d.job.resolved ? [["بسته‌شده", d.job.resolved] as [string, string]] : [])]} /> : <p className="text-sm text-white/55">کار تحویلی برای این ردیف نیست.</p>}
          {d.job?.error && <pre className="mt-3 p-3 rounded-[10px] bg-black/30 border border-white/[0.08] text-[11px] leading-5 text-rose-100/90 whitespace-pre-wrap break-words max-h-60 overflow-auto ltr text-left" dir="auto">{d.job.error}</pre>}
          {d.server && <div className="mt-4">
            <div className="text-xs text-white/55 mb-2">ردیف سرور</div>
            <Pairs rows={[["سرور", <span key="s" className="mono">{d.server.id} · {d.server.name}</span>], ["Hostname", <span key="h" dir="ltr">{d.server.hostname}</span>], ["وضعیت", <StatusBadge key="st" s={d.server.status} />], ["VPS", d.server.vpsid ? String(d.server.vpsid) : "ساخته نشده"],
              ["تیکت", d.server.ticket ? <Link key="t" className="acc hover:underline" href={("/admin/tickets/" + d.server.ticket) as never}>{d.server.ticket}</Link> : ""]]} />
            {d.server.error && <pre className="mt-3 p-3 rounded-[10px] bg-black/30 border border-white/[0.08] text-[11px] leading-5 text-rose-100/90 whitespace-pre-wrap break-words max-h-60 overflow-auto ltr text-left" dir="auto">{d.server.error}</pre>}
          </div>}
          {d.tasks.length > 0 && <ol className="mt-4 border-r border-white/10 pr-4 space-y-2">
            {d.tasks.map((x, i) => <li key={i} className="relative text-sm"><span className={"absolute -right-[21px] top-2 w-2 h-2 rounded-full " + (x.status === "failed" ? "bg-rose-300" : x.status === "running" ? "bg-sky-300" : "bg-emerald-300")} /><span>{x.action}</span> <span className="text-[11px] text-white/45">{x.at}{x.status === "running" ? " · " + fa(x.progress) + "٪" : ""}</span></li>)}
          </ol>}
          {d.ticket && <p className="mt-4 text-sm">تیکت پشتیبانی: <Link className="acc hover:underline" href={("/admin/tickets/" + d.ticket.id) as never}>{d.ticket.id}</Link> — {d.ticket.subject} <StatusBadge s={d.ticket.status} /></p>}
        </Section>
      </div>}
      {fix === "deliver" && target && <DeliverModal r={target} onClose={() => setFix(null)} onDone={changed} />}
      {fix === "refund" && target && <RefundModal r={target} onClose={() => setFix(null)} onDone={changed} />}
    </Modal>
  );
}
