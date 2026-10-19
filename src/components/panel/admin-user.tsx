"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchHit, Series, ServiceRow, TxFilter, UserActivity, UserOrders, UserServices, UserSummary, UserTab, UserUsage } from "@/lib/admin-detail";
import { adminDetailApi } from "@/lib/admin-detail-api";
import { BTN_G, BTN_MD, BTN_SM, INPUT, TEXTAREA } from "@/lib/cls";
import { fa, toEnDigits, toman } from "@/lib/format";
import { api } from "@/lib/store";
import { billingApi } from "@/lib/vps-billing-api";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field, StatusBadge } from "../ui";
import { AreaChart, AsyncButton, Bars, DataTable, Modal, PageTitle, Select, StatCard, Tabs } from "../ui-client";
import { LINE_TONE, OrderDetailModal, userHref } from "./admin-order-detail";

const TABS: { id: UserTab; label: string; icon: string }[] = [
  { id: "summary", label: "خلاصه", icon: "user-round" }, { id: "orders", label: "سفارش‌ها و فاکتورها", icon: "receipt" },
  { id: "services", label: "سرویس‌ها", icon: "server" }, { id: "usage", label: "مصرف", icon: "chart-column" }, { id: "activity", label: "تیکت‌ها و فعالیت", icon: "message-circle" },
];
const errText = (e: unknown) => (e instanceof Error ? e.message : "خطا");
const Loading = () => <Card><div className="py-10 grid place-items-center"><Icon name="loader-circle" size={22} className="animate-spin text-white/50" /></div></Card>;
const Failed = ({ text }: { text: string }) => <p role="alert" className="p-3 rounded-[12px] bg-rose-400/10 text-rose-200 text-sm">{text}</p>;

/** loads one tab's data and reloads it on demand */
function useTab<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => { try { setData(await fetcher()); setErr(""); } catch (e) { setErr(errText(e)); } }, [fetcher]);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);
  return { data, err, load };
}

/* ================= Admin › کاربران › نمای کامل مشتری ================= */
export function AdminUser360({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const initial = TABS.some((x) => x.id === params.get("tab")) ? (params.get("tab") as UserTab) : "summary";
  const [tab, setTab] = useState<UserTab>(initial);
  const sum = useTab(useCallback(() => adminDetailApi.summary(id), [id]));
  const u = sum.data?.user;
  const pick = (x: string) => { setTab(x as UserTab); router.replace((("/admin/users/" + encodeURIComponent(id)) + (x === "summary" ? "" : "?tab=" + x)) as never, { scroll: false }); };
  return (
    <div>
      <PageTitle back={["/admin/users", "کاربران"]} title={u?.name ?? "مشتری"} sub={u ? <span className="flex flex-wrap items-center gap-2"><span dir="ltr">{u.email}</span><StatusBadge s={u.status} /><StatusBadge s={u.kyc} /><Badge tone="violet">{sum.data!.level}</Badge></span> : id} />
      {sum.err && <Failed text={sum.err} />}
      <div className="overflow-x-auto no-scrollbar mb-5"><Tabs size="sm" value={tab} onChange={pick} label="بخش‌های مشتری" options={TABS} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "summary" && (sum.data ? <SummaryTab s={sum.data} reload={sum.load} /> : !sum.err && <Loading />)}
        {tab === "orders" && <OrdersTab id={id} />}
        {tab === "services" && <ServicesTab id={id} />}
        {tab === "usage" && <UsageTab id={id} />}
        {tab === "activity" && <ActivityTab id={id} />}
      </div>
    </div>
  );
}

/* ---------- خلاصه ---------- */
function SummaryTab({ s, reload }: { s: UserSummary; reload: () => Promise<void> }) {
  const { notify } = useApp();
  const router = useRouter();
  const u = s.user;
  const [adj, setAdj] = useState({ amount: "", reason: "" });
  const [msg, setMsg] = useState("");
  const COUNT: [string, string][] = [["servers", "سرور"], ["hosting", "هاست"], ["domains", "دامنه"], ["apps", "اپ"], ["dbs", "دیتابیس"], ["buckets", "باکت"], ["mail", "دامنه ایمیل"], ["geo", "Geo DNS"], ["aiKeys", "کلید AI"], ["builder", "پروژه بافت"], ["tickets", "تیکت"]];
  return (
    <div className="space-y-4">
      {s.flags.length > 0 && <div className="flex flex-wrap gap-2">{s.flags.map((f) => <Badge key={f} tone="amber" dot>{f}</Badge>)}</div>}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard icon="wallet" label="موجودی کیف پول" value={u.balance} suffix="تومان" tone={u.balance < 0 ? "down" : ""} />
        <StatCard icon="gauge" label="مصرف روزانه (۷ روز)" value={s.forecast.burn} suffix="تومان" />
        <StatCard icon="calendar-clock" label="اعتبار کافی تا" value={s.forecast.days === null ? "—" : fa(s.forecast.days) + " روز"} sub={s.forecast.until} tone={s.forecast.days !== null && s.forecast.days < 3 ? "down" : ""} />
        <StatCard icon="server" label="سرویس‌ها" value={Object.entries(s.counts).filter(([k]) => k !== "tickets").reduce((a, [, n]) => a + n, 0)} />
      </div>
      <div className="grid xl:grid-cols-[1.3fr_1fr] gap-4">
        <Card title="پروفایل" icon="user-round">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {([["شناسه", <span key="i" className="mono">{u.id}</span>], ["موبایل", <span key="p" dir="ltr">{u.phone || "—"}</span>], ["شرکت", u.company || "—"], ["عضویت", u.joined],
              ["سطح حساب", s.level], ["ورود دومرحله‌ای", u.twofa ? <Badge key="t" tone="green">فعال</Badge> : <Badge key="t">غیرفعال</Badge>], ["پرداخت خودکار", u.autoPay ? "فعال" : "غیرفعال"], ["کد معرفی", <span key="r" className="mono">{u.referralCode}</span>],
              ["کاربر Virtualizor", u.virtUid ? "uid " + u.virtUid : "ساخته نشده"], ["آخرین ورود", s.lastLogin ? s.lastLogin.at + " · " + s.lastLogin.device : "—"], ["IP آخرین ورود", <span key="ip" dir="ltr" className="mono">{s.lastLogin?.ip || "—"}</span>], ["آستانه هشدار اعتبار", toman(s.forecast.threshold)]] as [string, React.ReactNode][]).map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-[11px] text-white/50">{k}</dt><dd className="mt-0.5 min-w-0 [overflow-wrap:anywhere]">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-1.5">{COUNT.filter(([k]) => s.counts[k]).map(([k, l]) => <Badge key={k}>{fa(s.counts[k])} {l}</Badge>)}</div>
        </Card>
        <Card title="اقدامات" icon="settings-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {u.status === "suspended"
              ? <AsyncButton className={BTN_G + BTN_MD} onClick={async () => { await api.admin.updateUser(u.id, { status: "active" }); notify("حساب فعال شد"); await reload(); }}><Icon name="circle-check" size={15} /> رفع تعلیق حساب</AsyncButton>
              : <AsyncButton danger confirmText={"حساب " + u.name + " معلق شود؟"} onClick={async () => { await api.admin.updateUser(u.id, { status: "suspended" }); notify("حساب معلق شد"); await reload(); }}><Icon name="ban" size={15} /> تعلیق حساب</AsyncButton>}
            {u.kyc !== "verified" && <AsyncButton className={BTN_G + BTN_MD} onClick={async () => { await api.admin.updateUser(u.id, { kyc: "verified" }); notify("احراز هویت تأیید شد"); await reload(); }}><Icon name="fingerprint" size={15} /> تأیید احراز</AsyncButton>}
            {u.twofa && <AsyncButton className={BTN_G + BTN_MD} confirmText={"ورود دومرحله‌ای " + u.name + " غیرفعال شود؟ پس از تأیید هویت مشتری این کار را انجام دهید."} onClick={async () => { await adminDetailApi.resetTwofa(u.id); notify("ورود دومرحله‌ای غیرفعال شد", "shield-check"); await reload(); }}><Icon name="shield-alert" size={15} /> بازنشانی ورود دومرحله‌ای</AsyncButton>}
            {u.role === "user" && <AsyncButton className={BTN_G + BTN_MD} confirmText={"با حساب " + u.name + " وارد پنل کاربری شوید؟ این کار در گزارش فعالیت ثبت می‌شود."} onClick={async () => { await api.admin.impersonate(u.id); notify("اکنون پنل " + u.name + " را می‌بینید", "user-round"); router.push("/panel"); }}><Icon name="eye" size={15} /> ورود به‌جای کاربر</AsyncButton>}
            <AsyncButton className={BTN_G + BTN_MD} onClick={async () => { await api.auth.forgot(u.email); notify("ایمیل بازیابی رمز ارسال شد", "mail"); }}><Icon name="mail" size={15} /> ارسال بازیابی رمز</AsyncButton>
          </div>
          <Field label="سطح حساب" className="mt-4"><Select value={s.levelId} label="سطح حساب"
            onChange={async (v) => { try { await billingApi.adminSetLevel(u.id, v); notify("سطح حساب تغییر کرد"); await reload(); } catch (e) { notify(errText(e), "circle-alert"); } }}
            options={[{ value: "developer", label: "توسعه‌دهنده" }, { value: "startup", label: "استارتاپ" }, { value: "enterprise", label: "سازمانی" }]} /></Field>
        </Card>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="تغییر موجودی" icon="wallet">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
            <input value={adj.amount} onChange={(e) => setAdj((x) => ({ ...x, amount: e.target.value }))} dir="ltr" inputMode="numeric" aria-label="مبلغ تغییر (منفی برای کسر)" placeholder="+500000 یا -200000" className={INPUT + " text-left tabular"} />
            <input value={adj.reason} onChange={(e) => setAdj((x) => ({ ...x, reason: e.target.value }))} aria-label="دلیل" placeholder="دلیل (در تراکنش و گزارش ثبت می‌شود)" className={INPUT} />
          </div>
          <div className="mt-3 flex justify-end"><AsyncButton confirmText={"موجودی " + u.name + " تغییر کند؟"} onClick={async () => {
            const n = parseInt(toEnDigits(adj.amount).replace(/[^\d-]/g, ""), 10);
            if (!n) throw new Error("مبلغ معتبر وارد کنید.");
            if (!adj.reason.trim()) throw new Error("دلیل را بنویسید.");
            await api.admin.adjustBalance(u.id, n, adj.reason.trim()); setAdj({ amount: "", reason: "" }); notify("موجودی به‌روز شد", "wallet"); await reload();
          }}>اعمال</AsyncButton></div>
          {s.wallets.length > 0 && <ul className="mt-4 text-sm divide-y divide-white/[0.06]">{s.wallets.map((w) => <li key={w.id} className="flex justify-between py-2"><span>کیف پول پروژه «{w.name}»</span><span className="tabular">{toman(w.balance)}</span></li>)}</ul>}
        </Card>
        <Card title="ارسال اعلان" icon="megaphone">
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} maxLength={300} aria-label="متن اعلان" placeholder="متن اعلان برای مشتری" className={TEXTAREA} />
          <div className="mt-3 flex justify-end"><AsyncButton onClick={async () => { await adminDetailApi.notifyUser(u.id, msg); setMsg(""); notify("اعلان ارسال شد", "megaphone"); }}><Icon name="send" size={15} /> ارسال</AsyncButton></div>
        </Card>
        <Card title="تیم" icon="users">
          {s.team.members.length === 0 && s.team.memberOf.length === 0 ? <p className="text-sm text-white/55">عضو تیمی ندارد.</p> : <ul className="text-sm space-y-2">
            {s.team.members.map((m) => <li key={m.id} className="flex justify-between gap-2"><Link href={userHref(m.id)} className="hover:underline truncate">{m.name} <span className="text-white/50 text-xs" dir="ltr">{m.email}</span></Link><Badge>{m.role}</Badge></li>)}
            {s.team.memberOf.map((m) => <li key={m.id} className="flex justify-between gap-2"><span className="truncate">عضو تیم <Link href={userHref(m.id)} className="hover:underline">{m.name}</Link></span><Badge tone="blue">{m.role}</Badge></li>)}
          </ul>}
        </Card>
      </div>
    </div>
  );
}

/* ---------- سفارش‌ها و فاکتورها ---------- */
function OrdersTab({ id }: { id: string }) {
  const [offset, setOffset] = useState(0);
  const t = useTab(useCallback(() => adminDetailApi.orders(id, offset), [id, offset]));
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ inv: string; index: number } | null>(null);
  const d: UserOrders | null = t.data;
  if (t.err) return <Failed text={t.err} />;
  if (!d) return <Loading />;
  if (!d.invoices.length) return <Card><Empty icon="receipt" title="صورتحسابی ندارد" /></Card>;
  return (
    <div className="space-y-3">
      {d.invoices.map((inv) => (
        <Card key={inv.id} pad="p-4">
          <button type="button" onClick={() => setOpen(open === inv.id ? null : inv.id)} aria-expanded={open === inv.id} className="w-full flex flex-wrap items-center justify-between gap-2 text-right">
            <span className="flex flex-wrap items-center gap-2 min-w-0"><Icon name={open === inv.id ? "chevron-down" : "chevron-left"} size={16} className="text-white/50" /><b className="mono text-sm">{inv.id}</b><StatusBadge s={inv.status} /><span className="text-xs text-white/50">{inv.created}</span>
              {inv.lines.filter((l) => l.state.state === "failed" || l.state.state === "pending").length > 0 && <Badge tone="red" dot>تحویل‌نشده</Badge>}</span>
            <span className="tabular font-bold text-sm">{toman(inv.total)}</span>
          </button>
          <ul className="mt-3 space-y-2">
            {(open === inv.id ? inv.lines : inv.lines.slice(0, 2)).map((l) => (
              <li key={l.index} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-sm">
                <div className="min-w-0"><div className="[overflow-wrap:anywhere]">{l.desc}</div>{l.decoded && <div className="text-[11px] text-white/50 mt-0.5 [overflow-wrap:anywhere]">{l.decoded}</div>}</div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className="tabular text-xs">{toman(l.amount)}</span>
                  <Badge tone={LINE_TONE[l.state.state]} dot>{l.state.label}</Badge>
                  {l.state.state === "delivered" && l.state.href && <Link href={l.state.href as never} className="text-xs acc hover:underline">سرویس</Link>}
                  {l.amount > 0 && l.state.state !== "renewal" && <button type="button" onClick={() => setDetail({ inv: inv.id, index: l.index })} className={BTN_G + BTN_SM}><Icon name="file-text" size={13} /> جزئیات</button>}
                </div>
              </li>
            ))}
            {open !== inv.id && inv.lines.length > 2 && <li className="text-xs text-white/50">و {fa(inv.lines.length - 2)} ردیف دیگر…</li>}
          </ul>
        </Card>
      ))}
      <Pager offset={offset} size={15} total={d.total} onChange={setOffset} />
      {detail && <OrderDetailModal invoiceId={detail.inv} index={detail.index} onClose={() => setDetail(null)} onChanged={t.load} />}
    </div>
  );
}
function Pager({ offset, size, total, onChange }: { offset: number; size: number; total: number; onChange: (n: number) => void }) {
  if (total <= size) return null;
  return (
    <div className="flex items-center justify-between text-xs text-white/50">
      <span>{fa(offset + 1)} تا {fa(Math.min(total, offset + size))} از {fa(total)}</span>
      <div className="flex gap-1.5">
        <button type="button" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - size))} className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/10 grid place-items-center disabled:opacity-30" aria-label="صفحه قبلی"><Icon name="chevron-right" size={16} /></button>
        <button type="button" disabled={offset + size >= total} onClick={() => onChange(offset + size)} className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/10 grid place-items-center disabled:opacity-30" aria-label="صفحه بعدی"><Icon name="chevron-left" size={16} /></button>
      </div>
    </div>
  );
}

/* ---------- سرویس‌ها ---------- */
const KINDS: Record<string, [string, string]> = {
  server: ["سرورهای ابری", "server"], hosting: ["هاست", "layers"], domain: ["دامنه‌ها", "globe"], app: ["اپ‌های گره اپ", "rocket"], db: ["دیتابیس‌های گره اپ", "database"],
  builder: ["پروژه‌های بافت", "sparkles"], bucket: ["باکت‌های ذخیره‌سازی", "hard-drive"], mail: ["دامنه‌های ایمیل", "mail"], aikey: ["کلیدهای API هوش مصنوعی", "bot"], geo: ["Geo DNS", "radar"], inquiry: ["API استعلام", "fingerprint"],
};
async function runAction(r: ServiceRow, a: ServiceRow["actions"][number]) {
  const on = a === "suspend";
  switch (r.kind) {
    case "server": return a === "delete" ? api.servers.remove(r.id) : api.servers.setStatus(r.id, on ? "suspended" : "running");
    case "hosting": return api.hosting.setStatus(r.id, on ? "suspended" : "active");
    case "app": case "db": return api.paas.adminSuspend(r.kind, r.id, on);
    case "bucket": return api.storage.adminSuspend(r.id, on);
    case "mail": return api.mail.adminDomain(r.id, { suspend: on });
    case "geo": return api.geo.adminZone(r.id, a === "extend" ? { extendDays: 30 } : { status: on ? "suspended" : "active" });
    case "inquiry": return api.inquiry.adminAccount(r.id, on ? "suspended" : "active");
  }
}
const ACTION: Record<ServiceRow["actions"][number], [string, string]> = { suspend: ["تعلیق", "pause"], unsuspend: ["رفع تعلیق", "play"], delete: ["حذف", "trash-2"], extend: ["تمدید ۳۰ روز", "calendar-clock"] };

function ServicesTab({ id }: { id: string }) {
  const { notify } = useApp();
  const t = useTab(useCallback(() => adminDetailApi.services(id), [id]));
  const d: UserServices | null = t.data;
  if (t.err) return <Failed text={t.err} />;
  if (!d) return <Loading />;
  if (!d.rows.length) return <Card><Empty icon="package-open" title="سرویسی ندارد" /></Card>;
  const groups = Object.keys(KINDS).map((k) => [k, d.rows.filter((r) => r.kind === k)] as const).filter(([, rows]) => rows.length);
  return (
    <div className="grid xl:grid-cols-2 gap-4">
      {groups.map(([k, rows]) => (
        <Card key={k} title={KINDS[k][0] + " (" + fa(rows.length) + ")"} icon={KINDS[k][1]} pad="p-3 sm:p-4">
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.kind + r.id} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex flex-wrap items-center gap-2"><b className="text-sm [overflow-wrap:anywhere]" dir="auto">{r.name}</b><StatusBadge s={r.status} /></span>
                  {r.href && <Link href={r.href as never} className="text-xs acc hover:underline shrink-0">نمای مدیریت</Link>}
                </div>
                <div className="text-[11px] text-white/55 mt-1 [overflow-wrap:anywhere]" dir="auto">{r.info}</div>
                {r.actions.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.actions.map((a) => <AsyncButton key={a} className={BTN_G + BTN_SM + (a === "delete" || a === "suspend" ? " text-rose-200" : "")} danger={a === "delete"}
                    confirmText={a === "delete" ? "«" + r.name + "» برای همیشه حذف شود؟" : a === "suspend" ? "«" + r.name + "» معلق شود؟" : undefined}
                    onClick={async () => { await runAction(r, a); notify(ACTION[a][0] + " انجام شد"); await t.load(); }}><Icon name={ACTION[a][1]} size={13} /> {ACTION[a][0]}</AsyncButton>)}
                </div>}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/* ---------- مصرف ---------- */
const TX_TYPES = [{ value: "", label: "همه انواع" }, { value: "topup", label: "شارژ" }, { value: "payment", label: "پرداخت" }, { value: "usage", label: "مصرف ساعتی" }, { value: "refund", label: "بازگشت وجه" }, { value: "commission", label: "پورسانت" }];
const PRODUCTS = [{ value: "", label: "همه محصولات" }, { value: "vps", label: "سرورهای ابری" }, { value: "apps", label: "گره اپ" }, { value: "storage", label: "فضای ذخیره‌سازی" }, { value: "mail", label: "سرویس ایمیل" }, { value: "ai", label: "API هوش مصنوعی" }, { value: "inquiry", label: "API استعلام" }, { value: "geo", label: "Geo DNS" }, { value: "other", label: "سایر" }];
const PRODUCT_LABEL = Object.fromEntries(PRODUCTS.map((p) => [p.value, p.label]));
const monthLabel = (m: string) => new Date(m + "-15T12:00:00Z").toLocaleDateString("fa-IR", { year: "numeric", month: "long", timeZone: "Asia/Tehran" });
const TX_PAGE = 25;

function Chart({ title, icon, s, unit, area }: { title: string; icon: string; s: Series; unit: string; area?: boolean }) {
  const has = s.data.some((v) => v > 0);
  return (
    <Card title={title} icon={icon} action={<span className="text-[11px] text-white/50">۳۰ روز · {unit}</span>}>
      {!has ? <p className="text-sm text-white/50 py-6 text-center">در ۳۰ روز گذشته داده‌ای نیست.</p>
        : area ? <AreaChart data={s.data} labels={s.labels} unit={unit} height={150} fmt={(v) => fa(Math.round(v * 100) / 100)} /> : <Bars data={s.data} labels={s.labels} height={150} fmt={(v) => fa(v) + " " + unit} />}
    </Card>
  );
}

function UsageTab({ id }: { id: string }) {
  const { notify } = useApp();
  const [f, setF] = useState<{ type: string; product: string; days: string; q: string }>({ type: "", product: "", days: "90", q: "" });
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const filter: TxFilter = { ...(f.type ? { type: f.type as TxFilter["type"] } : {}), ...(f.product ? { product: f.product } : {}), ...(f.days !== "0" ? { days: Number(f.days) } : {}), ...(f.q ? { q: f.q } : {}) };
  const key = JSON.stringify(filter);
  const t = useTab(useCallback(() => adminDetailApi.usage(id, { ...(JSON.parse(key) as TxFilter), offset, limit: TX_PAGE }), [id, key, offset]));
  const d: UserUsage | null = t.data;
  useEffect(() => { const h = setTimeout(() => { setF((c) => (c.q === q.trim() ? c : { ...c, q: q.trim() })); setOffset(0); }, 350); return () => clearTimeout(h); }, [q]);
  const set = (k: "type" | "product" | "days") => (v: string) => { setF((c) => ({ ...c, [k]: v })); setOffset(0); };
  const exportCsv = async () => {
    const csv = await adminDetailApi.txCsv(id, filter);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "transactions-" + id + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    notify("فایل CSV آماده شد", "download");
  };
  return (
    <div className="space-y-4">
      <Card title="تراکنش‌های کیف پول" icon="wallet" pad="p-3 sm:p-5" action={<AsyncButton className={BTN_G + BTN_SM} onClick={exportCsv}><Icon name="download" size={14} /> CSV</AsyncButton>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 mb-4">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو در شرح یا شناسه" aria-label="جست‌وجو در تراکنش‌ها" className={INPUT} />
          <Select value={f.type} onChange={set("type")} options={TX_TYPES} label="نوع تراکنش" />
          <Select value={f.product} onChange={set("product")} options={PRODUCTS} label="محصول" />
          <Select value={f.days} onChange={set("days")} options={[{ value: "7", label: "۷ روز اخیر" }, { value: "30", label: "۳۰ روز اخیر" }, { value: "90", label: "۹۰ روز اخیر" }, { value: "365", label: "یک سال اخیر" }, { value: "0", label: "همه" }]} label="بازه" />
        </div>
        {t.err ? <Failed text={t.err} /> : !d ? <div className="py-8 grid place-items-center"><Icon name="loader-circle" size={20} className="animate-spin text-white/50" /></div> : <>
          <DataTable rows={d.tx} pageSize={TX_PAGE} empty="تراکنشی با این فیلترها نیست."
            columns={[
              { key: "desc", label: "شرح", render: (r) => <span className="[overflow-wrap:anywhere]">{r.desc}</span> },
              { key: "type", label: "نوع", render: (r) => <StatusBadge s={r.type} /> },
              { key: "product", label: "محصول", render: (r) => <span className="text-xs text-white/60">{PRODUCT_LABEL[r.product] ?? r.product}</span> },
              { key: "amount", label: "مبلغ", render: (r) => <span className={"tabular font-bold " + (r.amount < 0 ? "text-rose-200" : "text-emerald-200")} dir="ltr">{fa(r.amount)}</span> },
              { key: "method", label: "روش", render: (r) => <span className="text-xs text-white/60">{r.method}</span> },
              { key: "at", label: "زمان", render: (r) => <span className="text-xs text-white/60">{r.at}</span> },
            ]} />
          <div className="mt-3"><Pager offset={offset} size={TX_PAGE} total={d.total} onChange={setOffset} /></div>
        </>}
      </Card>
      {d && <>
        <Card title="هزینه ماهانه به تفکیک محصول" icon="chart-column" pad="p-3 sm:p-5">
          {d.monthly.length === 0 ? <p className="text-sm text-white/50">در شش ماه گذشته هزینه‌ای ثبت نشده است.</p> : <div className="space-y-3">
            {d.monthly.map((p) => {
              const max = Math.max(...d.monthly.flatMap((x) => x.months.map((m) => m.amount)), 1);
              return (
                <div key={p.product}>
                  <div className="flex justify-between text-sm mb-1.5"><b>{p.label}</b><span className="tabular text-xs text-white/60">{toman(p.months.reduce((s, m) => s + m.amount, 0))}</span></div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                    {p.months.map((m) => <div key={m.month} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 min-w-0">
                      <div className="text-[10px] text-white/50 truncate">{monthLabel(m.month)}</div>
                      <div className="text-xs tabular mt-0.5 truncate">{m.amount ? fa(m.amount) : "—"}</div>
                      <div className="h-1 mt-1.5 rounded bg-white/[0.06]"><div className="h-1 rounded bg-[#9cc9ff]" style={{ width: Math.round((m.amount / max) * 100) + "%" }} /></div>
                    </div>)}
                  </div>
                </div>
              );
            })}
          </div>}
        </Card>
        <div className="grid lg:grid-cols-2 gap-4">
          <Chart title="هزینه ساعتی سرویس‌ها" icon="clock" s={d.hourly} unit="تومان" />
          <Chart title="هزینه API هوش مصنوعی" icon="bot" s={d.ai.daily} unit="تومان" area />
          <Chart title="ترافیک گره اپ" icon="rocket" s={d.paas.traffic} unit="مگابایت" area />
          <Chart title="حجم فضای ذخیره‌سازی" icon="hard-drive" s={d.storage} unit="گیگابایت" area />
          <Chart title="ارسال ایمیل" icon="mail" s={d.mail} unit="گیرنده" />
          <Chart title="فراخوانی API استعلام" icon="fingerprint" s={d.inquiry} unit="درخواست" />
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="مصرف هوش مصنوعی به تفکیک مدل (۳۰ روز)" icon="bot" pad="p-3 sm:p-5">
            {d.ai.byModel.length === 0 ? <p className="text-sm text-white/50">مصرفی نیست.</p> : <ul className="divide-y divide-white/[0.06] text-sm">
              {d.ai.byModel.map((m) => <li key={m.model} className="flex flex-wrap justify-between gap-2 py-2"><span className="mono text-xs [overflow-wrap:anywhere]" dir="ltr">{m.model}</span><span className="text-xs text-white/60">{fa(m.calls)} درخواست · {fa(m.tokens)} توکن · <b className="text-white tabular">{toman(m.charged)}</b></span></li>)}
            </ul>}
          </Card>
          <Card title="هزینه گره اپ به تفکیک ماه" icon="rocket" pad="p-3 sm:p-5">
            {d.paas.spend.length === 0 ? <p className="text-sm text-white/50">هزینه‌ای ثبت نشده است.</p> : <ul className="divide-y divide-white/[0.06] text-sm">
              {d.paas.spend.map((m) => <li key={m.month} className="flex justify-between py-2"><span>{monthLabel(m.month)}</span><span className="tabular">{toman(m.amount)}</span></li>)}
            </ul>}
          </Card>
        </div>
      </>}
    </div>
  );
}

/* ---------- تیکت‌ها و فعالیت ---------- */
function ActivityTab({ id }: { id: string }) {
  const t = useTab(useCallback(() => adminDetailApi.activity(id), [id]));
  const d: UserActivity | null = t.data;
  if (t.err) return <Failed text={t.err} />;
  if (!d) return <Loading />;
  const empty = (s: string) => <p className="text-sm text-white/50 p-2">{s}</p>;
  return (
    <div className="grid xl:grid-cols-2 gap-4">
      <Card title={"تیکت‌ها (" + fa(d.tickets.length) + ")"} icon="message-circle" pad="p-3 sm:p-4">
        {d.tickets.length === 0 ? empty("تیکتی ندارد.") : <ul className="space-y-1">{d.tickets.map((x) => (
          <li key={x.id}><Link href={("/admin/tickets/" + x.id) as never} className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl hover:bg-white/[0.04]">
            <span className="min-w-0"><span className="text-sm [overflow-wrap:anywhere]">{x.subject}</span><span className="block text-[11px] text-white/50">{x.id} · {x.updated}</span></span>
            <span className="flex gap-1.5"><StatusBadge s={x.priority} /><StatusBadge s={x.status} /></span>
          </Link></li>))}</ul>}
      </Card>
      <Card title="فعالیت حساب" icon="history" pad="p-3 sm:p-4">
        {d.activity.length === 0 ? empty("فعالیتی ثبت نشده است.") : <ul className="space-y-2 max-h-[28rem] overflow-auto">{d.activity.map((a, i) => (
          <li key={i} className="flex gap-2.5 text-sm"><Icon name={a.icon} size={15} className="mt-1 text-white/50 shrink-0" /><span className="min-w-0"><span className="[overflow-wrap:anywhere]">{a.text}</span><span className="block text-[11px] text-white/50">{a.at}{a.ip ? " · " : ""}<span dir="ltr">{a.ip}</span></span></span></li>))}</ul>}
      </Card>
      <Card title="گزارش اقدامات کارکنان" icon="scroll-text" pad="p-3 sm:p-4">
        {d.audit.length === 0 ? empty("اقدامی درباره این مشتری ثبت نشده است.") : <ul className="space-y-2 max-h-[28rem] overflow-auto">{d.audit.map((a, i) => (
          <li key={i} className="text-sm"><b>{a.actor}</b> — <span className="[overflow-wrap:anywhere]">{a.action}</span><span className="block text-[11px] text-white/50"><span className="mono" dir="ltr">{a.target}</span> · {a.at}</span></li>))}</ul>}
      </Card>
      <Card title="اعلان‌های ارسال‌شده" icon="bell" pad="p-3 sm:p-4">
        {d.notifications.length === 0 ? empty("اعلانی ارسال نشده است.") : <ul className="space-y-2 max-h-[28rem] overflow-auto">{d.notifications.map((n, i) => (
          <li key={i} className="flex gap-2.5 text-sm"><Icon name={n.icon} size={15} className="mt-1 text-white/50 shrink-0" /><span className="min-w-0"><span className="[overflow-wrap:anywhere]">{n.text}</span><span className="block text-[11px] text-white/50">{n.at} · {n.read ? "خوانده شد" : "خوانده نشده"}</span></span></li>))}</ul>}
      </Card>
    </div>
  );
}

/* ================= global admin search ================= */
const HIT_ICON: Record<SearchHit["kind"], string> = { user: "user-round", invoice: "receipt", server: "server", domain: "globe", hosting: "layers", mail: "mail", geo: "radar" };
function SearchPanel({ onPick, autoFocus }: { onPick: () => void; autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const term = q.trim();
    const h = setTimeout(async () => {
      if (term.length < 2) { setHits(null); return; }
      try { setHits(await adminDetailApi.search(term)); setActive(0); } catch { setHits([]); }
    }, 250);
    return () => clearTimeout(h);
  }, [q]);
  const go = (h: SearchHit) => { router.push(((userHref(h.userId) as string) + (h.kind === "invoice" ? "?tab=orders" : h.kind === "user" ? "" : "?tab=services")) as never); setQ(""); setHits(null); onPick(); };
  return (
    <div className="relative">
      <Icon name="search" size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" />
      <input type="search" value={q} autoFocus={autoFocus} onChange={(e) => setQ(e.target.value)} placeholder="ایمیل، موبایل، فاکتور، IP یا دامنه"
        aria-label="جست‌وجوی مشتری" role="combobox" aria-expanded={!!hits} aria-controls="admin-search-hits" aria-autocomplete="list"
        onKeyDown={(e) => {
          if (!hits?.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); go(hits[active]); }
        }}
        className={INPUT + " pr-9"} />
      {hits && <ul id="admin-search-hits" role="listbox" className="absolute z-50 top-full mt-1.5 inset-x-0 max-h-80 overflow-auto rounded-xl bg-[#0b0d16] border border-white/[0.14] shadow-2xl p-1">
        {hits.length === 0 ? <li className="p-3 text-sm text-white/55">نتیجه‌ای پیدا نشد.</li> : hits.map((h, i) => (
          <li key={h.kind + h.label + h.userId} role="option" aria-selected={i === active}>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} className={"w-full flex items-center gap-2.5 p-2.5 rounded-lg text-right " + (i === active ? "bg-white/[0.08]" : "hover:bg-white/[0.05]")}>
              <Icon name={HIT_ICON[h.kind]} size={15} className="text-white/55 shrink-0" />
              <span className="min-w-0"><span className="block text-sm truncate" dir="auto">{h.label}</span><span className="block text-[11px] text-white/50 truncate" dir="auto">{h.sub}</span></span>
            </button>
          </li>))}
      </ul>}
    </div>
  );
}

/** header search: inline from md up, a dialog on phones */
export function AdminSearch() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={wrap} className="hidden md:block w-72"><SearchPanel onPick={() => wrap.current?.querySelector("input")?.blur()} /></div>
      <button type="button" onClick={() => setOpen(true)} className="md:hidden w-10 h-10 grid place-items-center rounded-xl bg-white/[0.05] border border-white/10" aria-label="جست‌وجوی مشتری"><Icon name="search" size={18} /></button>
      <Modal open={open} onClose={() => setOpen(false)} title="جست‌وجوی مشتری" icon="search">
        <div className="min-h-64"><SearchPanel autoFocus onPick={() => setOpen(false)} /></div>
        <p className="text-xs text-white/50 mt-3 leading-6">با ایمیل، موبایل، شماره فاکتور، IP سرور یا دامنه، نمای کامل مشتری باز می‌شود.</p>
      </Modal>
    </>
  );
}

