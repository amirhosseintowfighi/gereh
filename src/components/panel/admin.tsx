"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LOCS, locLabel } from "@/lib/catalog";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { EMAIL_RE, PHONE_RE, fa, nowFa, toEnDigits, toman } from "@/lib/format";
import { api, byId, invGross, useDB, type Coupon, type Invoice } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field, Meter, STATUS, StatusBadge } from "../ui";
import { AreaChart, AsyncButton, Bars, CopyText, DataTable, ICON_BTN, IconBtn, Menu, Modal, PageTitle, Select, SideDrawer, StatCard, Switch, Tabs } from "../ui-client";
import { InvoiceModal, TicketThread } from "./user";

const MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const amountInput = (v: string) => toEnDigits(v).replace(/\D/g, "");

/* ================= dashboard ================= */
export function AdminDashboard() {
  const db = useDB();
  const revenue = [412, 448, 469, 501, 538, 562, 590, 624, 651, 688, 712, 754];
  const signups = [84, 96, 91, 120, 134, 128, 151];
  const openT = db.tickets.filter((t) => t.status === "open" || t.status === "customer-reply");
  const paid = db.invoices.filter((i) => i.status === "paid").reduce((s, i) => s + invGross(i, db.settings.tax), 0);
  return (
    <div>
      <PageTitle title="داشبورد مدیریت" sub={"گزارش لحظه‌ای، " + nowFa()} action={<Link href="/admin/announcements" className={BTN_G + " px-4 h-10 text-sm"}><Icon name="megaphone" size={16} /> اطلاعیه جدید</Link>} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon="trending-up" label="پرداخت‌های ثبت‌شده" value={paid} suffix="تومان" sub="مجموع صورتحساب‌های پرداخت‌شده" tone="up" href="/admin/billing" />
        <StatCard icon="users" label="کاربران فعال" value={db.users.filter((u) => u.status === "active").length} sub={fa(db.users.length) + " کاربر در مجموع"} href="/admin/users" />
        <StatCard icon="server" label="سرویس‌ها" value={db.servers.length + db.hosting.length + db.domains.length} sub={fa(db.servers.filter((s) => s.status === "running").length) + " سرور در حال اجرا"} href="/admin/services" />
        <StatCard icon="message-circle" label="تیکت‌های در انتظار" value={openT.length} sub="میانگین پاسخ ۹ دقیقه" tone={openT.length > 5 ? "down" : ""} href="/admin/tickets" />
      </div>
      <div className="grid xl:grid-cols-[1.7fr_1fr] gap-4 mt-4">
        <Card title="درآمد ۱۲ ماه اخیر" icon="trending-up" action={<span className="text-xs text-white/55">میلیون تومان</span>}>
          <AreaChart data={revenue} labels={MONTHS} unit="میلیون تومان" height={230} />
        </Card>
        <Card title="ثبت‌نام‌های هفته" icon="user-plus">
          <Bars data={signups} labels={["ش", "ی", "د", "س", "چ", "پ", "ج"]} height={230} />
        </Card>
      </div>
      <div className="grid xl:grid-cols-3 gap-4 mt-4">
        <Card title="سلامت نودها" icon="radio-tower" action={<Link href="/admin/infra" className="text-xs text-white/50 hover:text-white">جزئیات</Link>}>
          <div className="space-y-4">{db.nodes.map((n) => <div key={n.id}><div className="flex justify-between text-xs mb-1.5"><span className="mono">{n.id}</span>{n.status === "online" ? <span className="text-white/55 tabular">{fa(n.cpu)}٪</span> : <StatusBadge s={n.status} />}</div><Meter value={n.cpu} label={"بار CPU " + n.id} /></div>)}</div>
        </Card>
        <Card title="آخرین صورتحساب‌ها" icon="receipt" pad="p-3">
          {db.invoices.slice(0, 6).map((i) => <div key={i.id} className="flex items-center justify-between p-2.5 text-sm"><div><div className="mono text-xs">{i.id}</div><div className="text-[11px] text-white/55">{byId(db.users, i.userId)?.name || "—"}</div></div><div className="text-left"><div className="tabular text-xs font-bold">{toman(invGross(i, db.settings.tax))}</div><StatusBadge s={i.status} /></div></div>)}
        </Card>
        <Card title="صف تیکت" icon="message-circle" pad="p-3">
          {openT.length === 0 ? <Empty icon="circle-check" title="صف خالی است" /> : openT.slice(0, 6).map((t) => <Link key={t.id} href={("/admin/tickets/" + t.id) as never} className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-white/[0.04] text-right"><div className="min-w-0"><div className="text-sm truncate">{t.subject}</div><div className="text-[11px] text-white/55">{t.id}، {t.dept}</div></div><StatusBadge s={t.priority} /></Link>)}
        </Card>
      </div>
    </div>
  );
}

/* ================= users ================= */
export function AdminUsers() {
  const db = useDB(); const router = useRouter();
  const { notify } = useApp();
  const [sel, setSel] = useState<string | null>(null);
  const [adj, setAdj] = useState({ amount: "", reason: "" });
  const [newU, setNewU] = useState<{ name: string; email: string; phone: string } | null>(null);
  const u = sel ? byId(db.users, sel) : undefined;
  const customers = db.users.filter((x) => x.role === "user");
  return (
    <div>
      <PageTitle title="کاربران" sub={fa(customers.length) + " کاربر"} action={<button type="button" onClick={() => setNewU({ name: "", email: "", phone: "" })} className={BTN_P + " px-4 h-10 text-sm"}><Icon name="user-plus" size={16} /> کاربر جدید</button>} />
      <DataTable rows={customers} searchKeys={["name", "email", "phone"]} searchPlaceholder="نام، ایمیل یا موبایل" filters={[{ key: "status", label: "وضعیت", options: ["active", "pending", "suspended"] }, { key: "kyc", label: "احراز", options: ["verified", "pending", "none"] }]}
        onRowClick={(r) => { setSel(r.id); setAdj({ amount: "", reason: "" }); }} pageSize={10}
        columns={[
          { key: "name", label: "کاربر", sortable: true, render: (r) => <div className="flex items-center gap-3"><span className="w-9 h-9 rounded-xl tile grid place-items-center font-black text-sm" aria-hidden="true">{r.name[0]}</span><div><div className="font-bold">{r.name}</div><div className="text-[11px] text-white/55 ltr text-right">{r.email}</div></div></div> },
          { key: "phone", label: "موبایل", render: (r) => <span className="mono text-xs text-white/60">{r.phone}</span> },
          { key: "services", label: "سرویس", sortable: true, render: (r) => fa(r.services) },
          { key: "balance", label: "موجودی", sortable: true, render: (r) => <span className="tabular">{toman(r.balance)}</span> },
          { key: "kyc", label: "احراز", render: (r) => <StatusBadge s={r.kyc} /> },
          { key: "status", label: "وضعیت", render: (r) => <StatusBadge s={r.status} /> },
          { key: "joined", label: "عضویت", sortable: true },
        ]} />
      <SideDrawer open={!!u} onClose={() => setSel(null)} title="جزئیات کاربر">
        {u && <>
          <div className="flex items-center gap-4"><span className="w-14 h-14 rounded-2xl tile grid place-items-center text-xl font-black" aria-hidden="true">{u.name[0]}</span><div><div className="font-black text-lg">{u.name}</div><div className="text-xs text-white/55 ltr text-right">{u.email}</div></div></div>
          <div className="flex flex-wrap gap-2 mt-4"><StatusBadge s={u.status} /><StatusBadge s={u.kyc} />{u.company && <Badge>{u.company}</Badge>}</div>
          <dl className="grid grid-cols-2 gap-4 mt-6 text-sm">{[["موبایل", u.phone], ["عضویت", u.joined], ["سرویس‌ها", fa(u.services)], ["موجودی", toman(u.balance)]].map(([k, v]) => <div key={k} className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3"><dt className="text-[11px] text-white/55">{k}</dt><dd className="mt-1 font-bold tabular">{v}</dd></div>)}</dl>
          <div className="mt-6 space-y-2">
            <div className="text-xs text-white/55 mb-2">اقدامات</div>
            <div className="grid grid-cols-2 gap-2">
              {u.status === "suspended"
                ? <AsyncButton className={BTN_G + " h-10 text-sm"} onClick={async () => { await api.admin.updateUser(u.id, { status: "active" }); notify("حساب فعال شد"); }}><Icon name="circle-check" size={15} /> فعال‌سازی</AsyncButton>
                : <AsyncButton danger confirmText={"حساب " + u.name + " معلق شود؟ همه سرویس‌ها متوقف می‌شوند."} onClick={async () => { await api.admin.updateUser(u.id, { status: "suspended" }); notify("حساب معلق شد"); }}><Icon name="ban" size={15} /> تعلیق حساب</AsyncButton>}
              {u.kyc !== "verified" && <AsyncButton className={BTN_G + " h-10 text-sm"} onClick={async () => { await api.admin.updateUser(u.id, { kyc: "verified" }); notify("احراز هویت تأیید شد"); }}><Icon name="fingerprint" size={15} /> تأیید احراز</AsyncButton>}
              <AsyncButton className={BTN_G + " h-10 text-sm"} confirmText={"با حساب " + u.name + " وارد پنل کاربری شوید؟ این کار در گزارش فعالیت ثبت می‌شود."} onClick={async () => { await api.admin.impersonate(u.id); notify("اکنون پنل " + u.name + " را می‌بینید", "user-round"); router.push("/panel"); }}><Icon name="eye" size={15} /> ورود به‌جای کاربر</AsyncButton>
              <AsyncButton className={BTN_G + " h-10 text-sm"} onClick={async () => { await api.auth.forgot(u.email); notify("ایمیل بازیابی رمز ارسال شد", "mail"); }}><Icon name="mail" size={15} /> ارسال بازیابی رمز</AsyncButton>
            </div>
          </div>
          <form className="mt-6 rounded-2xl bg-white/[0.03] border border-white/[0.08] p-4" onSubmit={(e) => e.preventDefault()}>
            <div className="text-sm font-bold mb-3 flex items-center gap-2"><Icon name="wallet" size={16} className="acc" />تغییر موجودی</div>
            <div className="grid grid-cols-2 gap-2">
              <input value={adj.amount} onChange={(e) => setAdj((s) => ({ ...s, amount: e.target.value }))} dir="ltr" inputMode="numeric" aria-label="مبلغ تغییر (منفی برای کسر)" placeholder="+500000 یا -200000" className={INPUT + " text-left tabular"} />
              <input value={adj.reason} onChange={(e) => setAdj((s) => ({ ...s, reason: e.target.value }))} aria-label="دلیل" placeholder="دلیل" className={INPUT} />
            </div>
            <div className="mt-3 flex justify-end"><AsyncButton confirmText={"موجودی " + u.name + " تغییر کند؟"} onClick={async () => {
              const n = parseInt(toEnDigits(adj.amount).replace(/[^\d-]/g, ""), 10);
              if (!n) throw new Error("مبلغ معتبر وارد کنید.");
              if (!adj.reason.trim()) throw new Error("دلیل را بنویسید.");
              if (u.balance + n < 0) throw new Error("موجودی نمی‌تواند منفی شود.");
              await api.admin.adjustBalance(u.id, n, adj.reason.trim()); setAdj({ amount: "", reason: "" }); notify("موجودی به‌روز شد", "wallet");
            }}>اعمال</AsyncButton></div>
          </form>
          <div className="mt-6">
            <div className="text-xs text-white/55 mb-2">سرویس‌های کاربر</div>
            {(() => {
              const list = [...db.servers.filter((s) => s.userId === u.id).map((s) => ["server", s.name, s.status]), ...db.hosting.filter((h) => h.userId === u.id).map((h) => ["layers", h.domain, h.status]), ...db.domains.filter((d) => d.userId === u.id).map((d) => ["globe", d.name, d.status])];
              return list.length === 0 ? <div className="text-sm text-white/55 p-2.5">سرویسی ندارد.</div> : list.map(([ic, n, st], i) => (
                <div key={i} className="flex items-center justify-between p-2.5 text-sm"><span className="flex items-center gap-2"><Icon name={ic} size={15} className="text-white/55" /><span className="ltr">{n}</span></span><StatusBadge s={st} /></div>
              ));
            })()}
          </div>
        </>}
      </SideDrawer>
      <Modal open={!!newU} onClose={() => setNewU(null)} title="کاربر جدید" icon="user-plus"
        footer={<><button type="button" onClick={() => setNewU(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => {
          if (!newU) return;
          const v = { name: newU.name.trim(), email: newU.email.trim().toLowerCase(), phone: toEnDigits(newU.phone.trim()) };
          if (v.name.length < 2 || !EMAIL_RE.test(v.email)) throw new Error("نام و ایمیل معتبر لازم است.");
          if (v.phone && !PHONE_RE.test(v.phone)) throw new Error("شماره موبایل معتبر نیست.");
          await api.admin.createUser(v); setNewU(null); notify("کاربر ساخته شد", "user-plus");
        }}>ساخت کاربر</AsyncButton></>}>
        {newU && <div className="space-y-4">
          <Field label="نام"><input value={newU.name} onChange={(e) => setNewU((s) => s && { ...s, name: e.target.value })} className={INPUT} /></Field>
          <Field label="ایمیل"><input type="email" value={newU.email} onChange={(e) => setNewU((s) => s && { ...s, email: e.target.value })} dir="ltr" className={INPUT + " text-left"} /></Field>
          <Field label="موبایل (اختیاری)"><input type="tel" value={newU.phone} onChange={(e) => setNewU((s) => s && { ...s, phone: e.target.value })} dir="ltr" className={INPUT + " text-left"} /></Field>
        </div>}
      </Modal>
    </div>
  );
}

/* ================= services ================= */
export function AdminServices() {
  const db = useDB();
  const { notify, confirm } = useApp();
  const [tab, setTab] = useState("servers");
  const owner = (id: string) => byId(db.users, id)?.name || "—";
  const actions = (kind: "servers" | "hosting", r: { id: string; status: string; name?: string; domain?: string }) => (
    <Menu label="اقدامات" triggerClass={ICON_BTN} trigger={<Icon name="settings-2" size={17} />} items={[
      r.status !== "suspended" && { icon: "ban", label: "تعلیق", danger: true, run: async () => { if (!(await confirm("سرویس " + (r.name || r.domain) + " معلق شود؟", { danger: true, ok: "تعلیق" }))) return; if (kind === "servers") await api.servers.setStatus(r.id, "suspended"); else await api.hosting.setStatus(r.id, "suspended"); notify("سرویس معلق شد"); } },
      r.status === "suspended" && { icon: "circle-check", label: "رفع تعلیق", run: async () => { if (kind === "servers") await api.servers.setStatus(r.id, "running"); else await api.hosting.setStatus(r.id, "active"); notify("سرویس فعال شد"); } },
      kind === "servers" && r.status === "running" && { icon: "refresh-cw", label: "ری‌استارت اجباری", run: async () => { if (!(await confirm("سرور " + r.name + " ری‌استارت اجباری شود؟", { danger: true }))) return; await api.servers.power(r.id, "reboot"); notify("ری‌استارت شد"); } },
    ]} />
  );
  return (
    <div>
      <PageTitle title="سرویس‌ها" sub="همه سرویس‌های مشتریان" />
      <div className="mb-6"><Tabs size="sm" value={tab} onChange={setTab} label="نوع سرویس" options={[{ id: "servers", label: "سرورها", icon: "server" }, { id: "hosting", label: "هاست‌ها", icon: "layers" }, { id: "domains", label: "دامنه‌ها", icon: "globe" }]} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "servers" && <DataTable rows={db.servers} searchKeys={["name", "ip", "id"]} filters={[{ key: "status", label: "وضعیت", options: ["running", "stopped", "suspended"] }, { key: "loc", label: "موقعیت", options: LOCS.map((l) => l.id) }]} pageSize={10}
          columns={[
            { key: "id", label: "شناسه", render: (r) => <span className="mono text-xs">{r.id}</span> },
            { key: "name", label: "نام", render: (r) => <span className="font-bold ltr">{r.name}</span> },
            { key: "owner", label: "مالک", render: (r) => owner(r.userId) },
            { key: "ip", label: "IP", render: (r) => <CopyText text={r.ip} className="mono text-xs text-white/60" /> },
            { key: "spec", label: "منابع", render: (r) => <span className="text-white/60 text-xs ltr">{r.cpu}C / {r.ram}G / {r.disk}G</span> },
            { key: "loc", label: "موقعیت", render: (r) => locLabel(r.loc) },
            { key: "status", label: "وضعیت", render: (r) => <StatusBadge s={r.status} /> },
            { key: "a", label: "", className: "text-left", render: (r) => actions("servers", r) },
          ]} />}
        {tab === "hosting" && <DataTable rows={db.hosting} searchKeys={["domain"]} filters={[{ key: "status", label: "وضعیت", options: ["active", "suspended"] }]}
          columns={[
            { key: "domain", label: "دامنه", render: (r) => <span className="font-bold ltr">{r.domain}</span> }, { key: "owner", label: "مالک", render: (r) => owner(r.userId) },
            { key: "plan", label: "پلن" }, { key: "server", label: "سرور", render: (r) => <span className="mono text-xs">{r.server}</span> },
            { key: "disk", label: "دیسک", render: (r) => <div className="w-28"><Meter value={r.diskUsed} max={r.diskTotal} label="دیسک" /></div> },
            { key: "status", label: "وضعیت", render: (r) => <StatusBadge s={r.status} /> }, { key: "a", label: "", className: "text-left", render: (r) => actions("hosting", r) },
          ]} />}
        {tab === "domains" && <DataTable rows={db.domains} searchKeys={["name"]} filters={[{ key: "status", label: "وضعیت", options: ["active", "expiring", "expired"] }]}
          columns={[
            { key: "name", label: "دامنه", sortable: true, render: (r) => <span className="font-bold ltr">{r.name}</span> }, { key: "owner", label: "مالک", render: (r) => owner(r.userId) },
            { key: "expires", label: "سررسید", sortable: true }, { key: "autoRenew", label: "تمدید خودکار", render: (r) => r.autoRenew ? <Badge tone="green">بله</Badge> : <Badge>خیر</Badge> },
            { key: "status", label: "وضعیت", render: (r) => <StatusBadge s={r.status} /> },
          ]} />}
      </div>
    </div>
  );
}

/* ================= billing ================= */
export function AdminBilling() {
  const db = useDB();
  const { notify, confirm } = useApp();
  const [view, setView] = useState<Invoice | null>(null);
  const [create, setCreate] = useState<{ userId: string; desc: string; amount: string } | null>(null);
  const owner = (id: string) => byId(db.users, id)?.name || "—";
  const gross = (i: Invoice) => invGross(i, db.settings.tax);
  const sum = (st: string) => db.invoices.filter((i) => i.status === st).reduce((s, i) => s + gross(i), 0);
  return (
    <div>
      <PageTitle title="مالی" sub="صورتحساب‌ها، پرداخت‌ها و بازگشت وجه" action={<button type="button" onClick={() => setCreate({ userId: db.users.find((u) => u.role === "user")?.id || "", desc: "", amount: "" })} className={BTN_P + " px-4 h-10 text-sm"}><Icon name="plus" size={16} /> صورتحساب دستی</button>} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        <StatCard icon="circle-check" label="پرداخت‌شده" value={sum("paid")} suffix="تومان" />
        <StatCard icon="clock" label="در انتظار پرداخت" value={sum("unpaid")} suffix="تومان" />
        <StatCard icon="circle-alert" label="سررسید گذشته" value={sum("overdue")} suffix="تومان" tone="down" sub={fa(db.invoices.filter((i) => i.status === "overdue").length) + " صورتحساب"} />
        <StatCard icon="refresh-cw" label="مسترد شده" value={sum("refunded")} suffix="تومان" />
      </div>
      <DataTable rows={db.invoices} searchKeys={["id", "userId"]} filters={[{ key: "status", label: "وضعیت", options: ["paid", "unpaid", "overdue", "refunded"] }]} onRowClick={setView} pageSize={10}
        columns={[
          { key: "id", label: "شماره", render: (r) => <span className="mono text-xs">{r.id}</span> },
          { key: "owner", label: "مشتری", render: (r) => owner(r.userId) },
          { key: "desc", label: "شرح", render: (r) => <span className="text-white/60 text-xs">{r.items[0].desc}</span> },
          { key: "date", label: "تاریخ", sortable: true },
          { key: "amount", label: "مبلغ (با مالیات)", sortable: true, sortValue: gross, render: (r) => <span className="tabular font-bold">{toman(gross(r))}</span> },
          { key: "status", label: "وضعیت", render: (r) => <StatusBadge s={r.status} /> },
          { key: "a", label: "", className: "text-left", render: (r) => (
            <Menu label={"اقدامات " + r.id} triggerClass={ICON_BTN} trigger={<Icon name="settings-2" size={17} />} items={[
              { icon: "file-text", label: "مشاهده", run: () => setView(r) },
              r.status !== "paid" && r.status !== "refunded" && { icon: "circle-check", label: "علامت پرداخت‌شده", run: async () => { if (await confirm("صورتحساب " + r.id + " پرداخت‌شده علامت بخورد؟")) { await api.billing.markPaid(r.id); notify("علامت‌گذاری شد"); } } },
              r.status !== "paid" && r.status !== "refunded" && { icon: "mail", label: "ارسال یادآوری", run: () => notify("یادآوری پرداخت برای " + owner(r.userId) + " ارسال شد", "mail") },
              r.status === "paid" && { icon: "refresh-cw", label: "بازگشت وجه", danger: true, run: async () => { if (await confirm("مبلغ " + toman(invGross(r, db.settings.tax)) + " به کیف پول مشتری بازگردانده شود؟", { danger: true, ok: "بازگشت وجه" })) { await api.billing.refund(r.id); notify("بازگشت وجه انجام شد"); } } },
            ]} />
          ) },
        ]} />
      <InvoiceModal inv={view} onClose={() => setView(null)} />
      <Modal open={!!create} onClose={() => setCreate(null)} title="صدور صورتحساب دستی" icon="receipt"
        footer={<><button type="button" onClick={() => setCreate(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => {
          if (!create) return;
          const a = +amountInput(create.amount);
          if (!create.desc.trim() || !a) throw new Error("شرح و مبلغ لازم است.");
          await api.billing.createInvoice({ userId: create.userId, due: nowFa(), items: [{ desc: create.desc.trim(), amount: a }] }); setCreate(null); notify("صورتحساب صادر شد", "receipt");
        }}>صدور</AsyncButton></>}>
        {create && <div className="space-y-4">
          <Field label="مشتری"><Select value={create.userId} label="مشتری" onChange={(v) => setCreate((s) => s && { ...s, userId: v })} options={db.users.filter((u) => u.role === "user").map((u) => ({ value: u.id, label: u.name + " (" + u.email + ")" }))} /></Field>
          <Field label="شرح"><input value={create.desc} onChange={(e) => setCreate((s) => s && { ...s, desc: e.target.value })} className={INPUT} /></Field>
          <Field label="مبلغ (تومان)" hint={create.amount ? toman(+amountInput(create.amount) || 0) : undefined}><input value={create.amount} inputMode="numeric" onChange={(e) => setCreate((s) => s && { ...s, amount: e.target.value })} dir="ltr" className={INPUT + " text-left tabular"} /></Field>
        </div>}
      </Modal>
    </div>
  );
}

/* ================= tickets ================= */
const CANNED = ["بررسی شد و مشکل برطرف شد. لطفا دوباره امتحان کنید.", "برای بررسی بیشتر، دسترسی SSH موقت لازم داریم.", "درخواست شما به واحد فنی ارجاع شد."];
export function AdminTickets({ id }: { id?: string }) {
  const db = useDB(); const router = useRouter();
  const { notify } = useApp();
  const t = id ? byId(db.tickets, id) : undefined;
  const owner = (uid: string) => byId(db.users, uid)?.name || "—";
  if (id && !t) return <Card><Empty icon="message-circle" title="تیکت پیدا نشد" action={<Link href="/admin/tickets" className={BTN_G + " px-4 h-10 text-sm"}>بازگشت به فهرست</Link>} /></Card>;
  if (t) return (
    <div>
      <PageTitle back={["/admin/tickets", "تیکت‌ها"]} title={t.subject} sub={<span className="flex flex-wrap gap-3 items-center"><span className="mono text-xs">{t.id}</span><span>{owner(t.userId)}</span><StatusBadge s={t.status} /></span>} />
      <div className="grid xl:grid-cols-[1fr_300px] gap-4">
        <Card><TicketThread t={t} as="staff" /></Card>
        <div className="space-y-4">
          <Card title="مدیریت تیکت" icon="settings-2">
            <div className="space-y-4">
              <Field label="وضعیت"><Select value={t.status} label="وضعیت" onChange={async (v) => { await api.tickets.update(t.id, { status: v }); notify("وضعیت تغییر کرد"); }} options={["open", "answered", "customer-reply", "closed"].map((s) => ({ value: s, label: STATUS[s][1] }))} /></Field>
              <Field label="اولویت"><Select value={t.priority} label="اولویت" onChange={async (v) => { await api.tickets.update(t.id, { priority: v }); notify("اولویت تغییر کرد"); }} options={["low", "normal", "high"].map((s) => ({ value: s, label: STATUS[s][1] }))} /></Field>
              <Field label="واحد"><Select value={t.dept} label="واحد" onChange={async (v) => { await api.tickets.update(t.id, { dept: v }); notify("واحد تغییر کرد"); }} options={["فنی", "مالی", "فروش", "دواپس"]} /></Field>
              <Field label="کارشناس"><Select value={t.assignee} label="کارشناس" onChange={async (v) => { await api.tickets.update(t.id, { assignee: v }); notify("تیکت ارجاع شد"); }} options={[{ value: "", label: "تخصیص نیافته" }, ...db.staff.map((s) => ({ value: s.name, label: s.name }))]} /></Field>
            </div>
          </Card>
          {t.status !== "closed" && (
            <Card title="پاسخ‌های آماده" icon="file-text" pad="p-3">
              {CANNED.map((m) => <AsyncButton key={m} onClick={async () => { await api.tickets.reply(t.id, m, "staff"); notify("پاسخ ارسال شد", "send"); }} className="w-full text-right text-xs text-white/65 p-3 rounded-xl hover:bg-white/[0.05] leading-6">{m}</AsyncButton>)}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
  return (
    <div>
      <PageTitle title="تیکت‌ها" sub={fa(db.tickets.filter((x) => x.status !== "closed").length) + " تیکت باز"} />
      <DataTable rows={db.tickets} searchKeys={["subject", "id"]} filters={[{ key: "status", label: "وضعیت", options: ["open", "customer-reply", "answered", "closed"] }, { key: "priority", label: "اولویت", options: ["high", "normal", "low"] }]} onRowClick={(r) => router.push(("/admin/tickets/" + r.id) as never)} pageSize={10}
        columns={[
          { key: "id", label: "شماره", render: (r) => <span className="mono text-xs">{r.id}</span> },
          { key: "subject", label: "موضوع", render: (r) => <span className="font-bold">{r.subject}</span> },
          { key: "owner", label: "مشتری", render: (r) => owner(r.userId) },
          { key: "dept", label: "واحد" }, { key: "priority", label: "اولویت", render: (r) => <StatusBadge s={r.priority} /> },
          { key: "assignee", label: "کارشناس", render: (r) => r.assignee || <span className="text-white/50">—</span> },
          { key: "status", label: "وضعیت", render: (r) => <StatusBadge s={r.status} /> },
          { key: "updated", label: "به‌روزرسانی" },
        ]} />
    </div>
  );
}

/* ================= products ================= */
type Edit = { kind: "cloud" | "metal" | "hosting"; id: string; name: string; price: string; popular: boolean } | { kind: "tld"; id: string; name: string; reg: string; renew: string; transfer: string };
export function AdminProducts() {
  const db = useDB();
  const { notify } = useApp();
  const [tab, setTab] = useState("cloud");
  const [edit, setEdit] = useState<Edit | null>(null);
  return (
    <div>
      <PageTitle title="محصولات و قیمت‌گذاری" sub="قیمت‌ها پس از ذخیره در سایت اعمال می‌شوند." />
      <div className="overflow-x-auto no-scrollbar mb-6"><Tabs size="sm" value={tab} onChange={setTab} label="دسته محصول" options={[{ id: "cloud", label: "سرور ابری", icon: "cloud" }, { id: "metal", label: "سرور اختصاصی", icon: "server-cog" }, { id: "hosting", label: "هاست", icon: "layers" }, { id: "tld", label: "پسوند دامنه", icon: "globe" }]} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab !== "tld" ? (
          <DataTable rows={db.plans[tab as "cloud" | "metal" | "hosting"]}
            columns={[
              { key: "name", label: "نام پلن", render: (r) => <span className="font-bold">{r.name}{r.popular && <> <Badge tone="blue">پیشنهادی</Badge></>}</span> },
              { key: "spec", label: "مشخصات", render: (r) => <span className="text-xs text-white/55">{r.cpu ? r.cpu + "، " + r.ram + "، " + r.disk : r.disk + "، " + r.sites}</span> },
              { key: "price", label: "قیمت ماهانه", sortable: true, render: (r) => <span className="tabular font-bold">{toman(r.price)}</span> },
              { key: "active", label: "فعال", render: (r) => <Switch on={r.active !== false} label={"فعال بودن " + r.name} onChange={async (v) => { await api.admin.updatePlan(tab as "cloud", r.id, { active: v }); notify(v ? "پلن فعال شد" : "پلن غیرفعال شد"); }} /> },
              { key: "a", label: "", className: "text-left", render: (r) => <IconBtn icon="pencil" label={"ویرایش " + r.name} onClick={() => setEdit({ kind: tab as "cloud", id: r.id, name: r.name, price: String(r.price), popular: !!r.popular })} /> },
            ]} />
        ) : (
          <DataTable rows={db.tlds.map((t) => ({ ...t, id: t.tld }))} searchKeys={["tld"]}
            columns={[
              { key: "tld", label: "پسوند", render: (r) => <span className="font-black ltr">{r.tld}</span> },
              { key: "reg", label: "ثبت", sortable: true, render: (r) => <span className="tabular">{toman(r.reg)}</span> },
              { key: "renew", label: "تمدید", render: (r) => <span className="tabular">{toman(r.renew)}</span> },
              { key: "transfer", label: "انتقال", render: (r) => <span className="tabular">{r.transfer ? toman(r.transfer) : "رایگان"}</span> },
              { key: "promo", label: "تخفیف ویژه", render: (r) => <Switch on={!!r.promo} label={"تخفیف " + r.tld} onChange={async (v) => { await api.admin.updateTld(r.tld, { promo: v }); notify("ذخیره شد"); }} /> },
              { key: "a", label: "", className: "text-left", render: (r) => <IconBtn icon="pencil" label={"ویرایش " + r.tld} onClick={() => setEdit({ kind: "tld", id: r.tld, name: r.tld, reg: String(r.reg), renew: String(r.renew), transfer: String(r.transfer) })} /> },
            ]} />
        )}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? "ویرایش " + edit.name : ""} icon="pencil"
        footer={<><button type="button" onClick={() => setEdit(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => {
          if (!edit) return;
          if (edit.kind === "tld") {
            const [reg, renew, transfer] = [edit.reg, edit.renew, edit.transfer].map((x) => +amountInput(x));
            if (!reg || !renew) throw new Error("قیمت ثبت و تمدید لازم است.");
            await api.admin.updateTld(edit.id, { reg, renew, transfer });
          } else {
            const price = +amountInput(edit.price);
            if (!edit.name.trim() || !price) throw new Error("نام و قیمت لازم است.");
            await api.admin.updatePlan(edit.kind, edit.id, { name: edit.name.trim(), price, popular: edit.popular });
          }
          setEdit(null); notify("تغییرات ذخیره شد");
        }}>ذخیره</AsyncButton></>}>
        {edit && (edit.kind === "tld" ? (
          <div className="grid grid-cols-3 gap-3">
            {(["reg", "renew", "transfer"] as const).map((k) => <Field key={k} label={{ reg: "ثبت", renew: "تمدید", transfer: "انتقال" }[k]}><input value={edit[k]} inputMode="numeric" onChange={(e) => setEdit((s) => s && { ...s, [k]: amountInput(e.target.value) } as Edit)} dir="ltr" className={INPUT + " text-left tabular"} /></Field>)}
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="نام پلن"><input value={edit.name} onChange={(e) => setEdit((s) => s && { ...s, name: e.target.value })} className={INPUT} /></Field>
            <Field label="قیمت ماهانه (تومان)"><input value={edit.price} inputMode="numeric" onChange={(e) => setEdit((s) => s && { ...s, price: amountInput(e.target.value) } as Edit)} dir="ltr" className={INPUT + " text-left tabular"} /></Field>
            <div className="flex items-center justify-between"><span className="text-sm">نمایش به‌عنوان پیشنهادی</span><Switch on={edit.popular} label="پیشنهادی" onChange={(v) => setEdit((s) => s && { ...s, popular: v } as Edit)} /></div>
          </div>
        ))}
      </Modal>
    </div>
  );
}

/* ================= infrastructure ================= */
export function AdminInfra() {
  const db = useDB();
  const { notify, confirm } = useApp();
  const [add, setAdd] = useState<{ id: string; loc: string; model: string } | null>(null);
  return (
    <div>
      <PageTitle title="زیرساخت" sub="دیتاسنترها و نودهای مجازی‌سازی (همگام با Virtualizor)" action={<button type="button" onClick={() => setAdd({ id: "", loc: "thr", model: "" })} className={BTN_P + " px-4 h-10 text-sm"}><Icon name="plus" size={16} /> افزودن نود</button>} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {LOCS.map((l) => {
          const ns = db.nodes.filter((n) => n.loc === l.id && n.status === "online");
          const all = db.nodes.filter((n) => n.loc === l.id);
          const vms = all.reduce((s, n) => s + n.vms, 0);
          const avg = ns.length ? Math.round(ns.reduce((s, n) => s + n.cpu, 0) / ns.length) : 0;
          return (
            <div key={l.id} className="spot rounded-[1.4rem] p-5 bg-white/[0.055] backdrop-blur-xl border border-white/[0.11] hl">
              <div className="flex items-center justify-between"><span className="font-extrabold">{l.label}</span><span className={"w-2.5 h-2.5 rounded-full " + (ns.length ? "bg-emerald-400" : "bg-amber-300")} aria-label={ns.length ? "آنلاین" : "بدون نود فعال"} /></div>
              <div className="text-xs text-white/55 mt-1">{fa(all.length)} نود، {fa(vms)} ماشین مجازی</div>
              <div className="mt-4"><Meter label="میانگین بار CPU" value={avg} right={fa(avg) + "٪"} /></div>
            </div>
          );
        })}
      </div>
      <DataTable rows={db.nodes} searchKeys={["id", "model"]} filters={[{ key: "status", label: "وضعیت", options: ["online", "maintenance"] }]}
        columns={[
          { key: "id", label: "نود", render: (r) => <div><div className="mono font-bold">{r.id}</div><div className="text-[11px] text-white/55 ltr text-right">{r.model}</div></div> },
          { key: "loc", label: "موقعیت", render: (r) => locLabel(r.loc) },
          { key: "cpu", label: "CPU", sortable: true, render: (r) => <div className="w-28"><Meter value={r.cpu} right={fa(r.cpu) + "٪"} label="CPU" /></div> },
          { key: "ram", label: "RAM", sortable: true, render: (r) => <div className="w-28"><Meter value={r.ram} right={fa(r.ram) + "٪"} label="RAM" /></div> },
          { key: "disk", label: "دیسک", render: (r) => <div className="w-28"><Meter value={r.disk} right={fa(r.disk) + "٪"} label="دیسک" /></div> },
          { key: "vms", label: "VM", sortable: true, render: (r) => fa(r.vms) },
          { key: "status", label: "وضعیت", render: (r) => <StatusBadge s={r.status} /> },
          { key: "a", label: "حالت نگهداری", render: (r) => <Switch on={r.status === "maintenance"} label={"حالت نگهداری " + r.id} onChange={async () => { if (r.status === "online" && !(await confirm("نود " + r.id + " به حالت نگهداری برود؟ ماشین‌ها جابه‌جا می‌شوند.", { danger: true }))) return; await api.admin.toggleNode(r.id); notify("حالت نود تغییر کرد"); }} /> },
        ]} />
      <Modal open={!!add} onClose={() => setAdd(null)} title="افزودن نود" icon="radio-tower"
        footer={<><button type="button" onClick={() => setAdd(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => { if (!add) return; const v = { ...add, id: add.id.trim().toLowerCase(), model: add.model.trim() }; if (!/^[a-z0-9-]{3,}$/.test(v.id)) throw new Error("شناسه نود معتبر نیست."); await api.admin.addNode(v); setAdd(null); notify("نود اضافه شد"); }}>افزودن</AsyncButton></>}>
        {add && <div className="space-y-4">
          <Field label="شناسه" hint="مثال: thr-hv-04"><input value={add.id} onChange={(e) => setAdd((s) => s && { ...s, id: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} /></Field>
          <Field label="دیتاسنتر"><Select value={add.loc} label="دیتاسنتر" onChange={(v) => setAdd((s) => s && { ...s, loc: v })} options={LOCS.map((l) => ({ value: l.id, label: l.label }))} /></Field>
          <Field label="سخت‌افزار"><input value={add.model} onChange={(e) => setAdd((s) => s && { ...s, model: e.target.value })} dir="ltr" placeholder="EPYC 9354 / 768GB" className={INPUT + " text-left"} /></Field>
        </div>}
      </Modal>
    </div>
  );
}

/* ================= Virtualizor ================= */
const GROUPS = ["thr-cloud", "thr-metal", "isf-cloud", "fra-cloud", "ams-cloud"];
export function AdminVirtualizor() {
  const db = useDB();
  const { notify } = useApp();
  const [tab, setTab] = useState("connection");
  const [cfg, setCfg] = useState({ host: String(db.virt.host), port: Number(db.virt.port), key: String(db.virt.key), pass: "" });
  return (
    <div>
      <PageTitle title="اتصال Virtualizor" sub="سرورها مستقیم روی Virtualizor ساخته و مدیریت می‌شوند؛ این‌جا اتصال و نگاشت‌ها را تنظیم کنید."
        action={<Badge tone={db.virt.connected ? "green" : "red"} dot>{db.virt.connected ? "متصل به " + db.virt.host : "قطع"}</Badge>} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        <StatCard icon="radio-tower" label="سرورهای Virtualizor" value={db.nodes.length} />
        <StatCard icon="server" label="VPSهای همگام" value={db.servers.length} />
        <StatCard icon="tag" label="پلن‌های نگاشت‌شده" value={db.planMap.filter((p) => p.plid).length} />
        <StatCard icon="clock" label="آخرین همگام‌سازی" value={String(db.virt.lastSync)} />
      </div>
      <div className="overflow-x-auto no-scrollbar mb-6"><Tabs size="sm" value={tab} onChange={setTab} label="بخش Virtualizor" options={[{ id: "connection", label: "اتصال", icon: "network" }, { id: "plans", label: "نگاشت پلن‌ها", icon: "tag" }, { id: "templates", label: "قالب‌های سیستم‌عامل", icon: "terminal" }, { id: "policy", label: "سیاست‌ها", icon: "shield-check" }, { id: "log", label: "گزارش همگام‌سازی", icon: "scroll-text" }]} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "connection" && (
          <div className="grid xl:grid-cols-[1.2fr_1fr] gap-4">
            <Card title="Admin API" icon="key-round">
              <form className="grid sm:grid-cols-[1fr_120px] gap-4" onSubmit={(e) => e.preventDefault()}>
                <Field label="آدرس Master"><input value={cfg.host} onChange={(e) => setCfg((c) => ({ ...c, host: e.target.value }))} dir="ltr" className={INPUT + " text-left mono"} /></Field>
                <Field label="پورت"><input value={cfg.port} inputMode="numeric" onChange={(e) => setCfg((c) => ({ ...c, port: +amountInput(e.target.value).slice(0, 5) }))} dir="ltr" className={INPUT + " text-left mono"} /></Field>
                <Field label="API Key"><input value={cfg.key} autoComplete="off" onChange={(e) => setCfg((c) => ({ ...c, key: e.target.value }))} dir="ltr" className={INPUT + " text-left mono"} /></Field>
                <Field label="API Password" hint="فقط در سرور ذخیره می‌شود."><input type="password" autoComplete="new-password" value={cfg.pass} onChange={(e) => setCfg((c) => ({ ...c, pass: e.target.value }))} dir="ltr" placeholder={db.virt.passSet ? "ذخیره شده؛ برای تغییر وارد کنید" : "••••••••"} className={INPUT + " text-left mono"} /></Field>
              </form>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <AsyncButton className={BTN_G + " px-4 h-10 text-sm"} onClick={async () => { await api.admin.virtTest({ host: cfg.host.trim(), port: cfg.port, key: cfg.key.trim(), pass: cfg.pass }); setCfg((c) => ({ ...c, pass: "" })); notify("اتصال به Virtualizor برقرار است", "circle-check"); }}><Icon name="activity" size={15} /> تست اتصال</AsyncButton>
                <AsyncButton onClick={async () => { if (!cfg.host.trim() || !(cfg.port > 0 && cfg.port < 65536)) throw new Error("آدرس و پورت معتبر لازم است."); await api.admin.saveVirt({ host: cfg.host.trim(), port: cfg.port, key: cfg.key.trim() }); notify("تنظیمات ذخیره شد"); }}>ذخیره</AsyncButton>
              </div>
              <p className="text-[11px] text-white/55 mt-5 leading-6">کلید و رمز Admin API در Virtualizor: Configuration › Server Info (روی Master). IP سرور گره را در «Allowed IP list to restrict API operations» اضافه کنید.</p>
            </Card>
            <Card title="همگام‌سازی" icon="refresh-cw" pad="p-3 sm:p-4">
              {[["سرورها و نودها", "servers", "radio-tower"], ["پلن‌ها", "plans", "tag"], ["قالب‌های سیستم‌عامل", "templates", "terminal"], ["VPSها و وضعیت", "vps", "server"], ["آمار ترافیک", "bandwidth", "activity"]].map(([l, k, ic]) => (
                <div key={k} className="flex items-center justify-between gap-3 p-3 rounded-[12px] hover:bg-white/[0.03]">
                  <span className="flex items-center gap-3 text-sm"><Icon name={ic} size={17} className="acc" />{l}</span>
                  <AsyncButton className={BTN_G + " px-3 h-8 text-xs"} onClick={async () => { await api.admin.virtSync(l); notify(l + " همگام شد", "refresh-cw"); }}>همگام‌سازی</AsyncButton>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 p-3 mt-1 border-t border-white/[0.06]">
                <div><div className="text-sm font-bold">همگام‌سازی خودکار</div><div className="text-[11px] text-white/55 mt-0.5">وضعیت هر ۱ دقیقه، ترافیک هر ۵ دقیقه، تطبیق کامل شبانه</div></div>
                <Switch on={!!db.virt.autoSync} label="همگام‌سازی خودکار" onChange={(v) => api.admin.saveVirt({ autoSync: v })} />
              </div>
            </Card>
          </div>
        )}
        {tab === "plans" && <>
          <DataTable rows={db.planMap}
            columns={[
              { key: "name", label: "پلن گره", render: (r) => <span className="font-bold">{r.name}</span> },
              { key: "plid", label: "Plan ID در Virtualizor", render: (r) => <input defaultValue={r.plid || ""} inputMode="numeric" aria-label={"Plan ID برای " + r.name} onBlur={async (e) => { const v = +amountInput(e.target.value) || 0; if (v === r.plid) return; await api.admin.savePlanMap(r.id, { plid: v }); notify("نگاشت ذخیره شد"); }} dir="ltr" className={INPUT + " h-9 w-28 text-left mono"} /> },
              { key: "group", label: "گروه سرور (محل ساخت)", render: (r) => <Select className="w-44" label={"گروه سرور " + r.name} value={r.group} onChange={async (v) => { await api.admin.savePlanMap(r.id, { group: v }); notify("نگاشت ذخیره شد"); }} options={GROUPS} ltr /> },
              { key: "st", label: "وضعیت", render: (r) => r.plid ? <Badge tone="green">نگاشت شده</Badge> : <Badge tone="amber">بدون نگاشت</Badge> },
            ]} />
          <p className="text-[11px] text-white/55 mt-3 leading-6">هنگام سفارش، VPS با همین plid و روی کم‌بارترین سرورِ گروه انتخاب‌شده ساخته می‌شود. لوکیشن‌های سایت (تهران، اصفهان…) به گروه سرورها نگاشت می‌شوند.</p>
        </>}
        {tab === "templates" && (
          <DataTable rows={db.osTemplates.map((t) => ({ ...t, id: t.osid }))} searchKeys={["name", "distro"]}
            columns={[
              { key: "osid", label: "OSID", render: (r) => <span className="mono text-xs">{r.osid}</span> },
              { key: "name", label: "سیستم‌عامل", render: (r) => <span className="font-bold ltr">{r.name}</span> },
              { key: "distro", label: "توزیع", render: (r) => <span className="mono text-xs text-white/55">{r.distro}</span> },
              { key: "on", label: "نمایش به کاربر", render: (r) => <Switch on={r.on} label={"نمایش " + r.name} onChange={async () => { await api.admin.toggleTemplate(r.osid); notify("ذخیره شد"); }} /> },
            ]} />
        )}
        {tab === "policy" && (
          <Card title="سیاست‌های خودکار" icon="shield-check" pad="p-3 sm:p-4">
            {[
              ["bandSuspend", "تعلیق با اتمام ترافیک", "وقتی ترافیک ماهانه VPS تمام شود، شبکه‌اش معلق می‌شود (band_suspend)."],
              ["suspendUnpaid", "تعلیق خودکار بدهکاران", "۷ روز پس از سررسید صورتحساب، VPS در Virtualizor معلق می‌شود."],
              ["terminateUnpaid", "حذف خودکار پس از ۱۴ روز", "VPSهای معلق پس از ۱۴ روز بدون پرداخت حذف می‌شوند."],
              ["adminManaged", "غیرفعال کردن پنل Virtualizor برای کاربران", "کاربران فقط از پنل گره سرور را مدیریت می‌کنند (admin_managed)."],
            ].map(([k, l, h]) => (
              <div key={k} className="flex items-center justify-between gap-4 p-3 rounded-[12px]">
                <div><div className="text-sm font-bold">{l}</div><div className="text-xs text-white/55 mt-1 leading-6">{h}</div></div>
                <Switch on={!!db.virt[k]} label={l} onChange={async (v) => { await api.admin.saveVirt({ [k]: v }); notify("سیاست ذخیره شد"); }} />
              </div>
            ))}
          </Card>
        )}
        {tab === "log" && (
          <DataTable rows={db.virtLog} pageSize={10}
            columns={[
              { key: "at", label: "زمان" }, { key: "kind", label: "عملیات", render: (r) => <span className="font-medium">{r.kind}</span> },
              { key: "result", label: "نتیجه", render: (r) => <Badge tone={r.result === "ok" ? "green" : r.result === "warn" ? "amber" : "red"} dot>{r.result === "ok" ? "موفق" : r.result === "warn" ? "هشدار" : "خطا"}</Badge> },
              { key: "detail", label: "جزئیات", render: (r) => <span className="text-white/60 text-xs">{r.detail}</span> },
            ]} />
        )}
      </div>
    </div>
  );
}

/* ================= coupons ================= */
type CouponForm = Omit<Coupon, "value" | "limit" | "used" | "id" | "active"> & { id?: string; value: string; limit: string; active?: boolean; used?: number };
export function AdminCoupons() {
  const db = useDB();
  const { notify, confirm } = useApp();
  const [edit, setEdit] = useState<CouponForm | null>(null);
  return (
    <div>
      <PageTitle title="کدهای تخفیف" action={<button type="button" onClick={() => setEdit({ code: "", type: "percent", value: "", limit: "", expires: "" })} className={BTN_P + " px-4 h-10 text-sm"}><Icon name="plus" size={16} /> کد جدید</button>} />
      <DataTable rows={db.coupons} searchKeys={["code"]} empty="کد تخفیفی تعریف نشده است."
        columns={[
          { key: "code", label: "کد", render: (r) => <CopyText text={r.code} className="mono font-bold" /> },
          { key: "value", label: "مقدار", render: (r) => r.type === "percent" ? fa(r.value) + "٪" : toman(r.value) },
          { key: "used", label: "استفاده", render: (r) => <div className="w-32"><Meter value={r.used} max={r.limit || r.used || 1} right={fa(r.used) + (r.limit ? " / " + fa(r.limit) : "")} label="استفاده" /></div> },
          { key: "expires", label: "انقضا" },
          { key: "active", label: "فعال", render: (r) => <Switch on={r.active} label={"فعال بودن " + r.code} onChange={async (v) => { await api.admin.saveCoupon({ ...r, active: v }); notify(v ? "کد فعال شد" : "کد غیرفعال شد"); }} /> },
          { key: "a", label: "", className: "text-left whitespace-nowrap", render: (r) => <><IconBtn icon="pencil" label={"ویرایش " + r.code} onClick={() => setEdit({ ...r, value: String(r.value), limit: r.limit ? String(r.limit) : "" })} /><IconBtn icon="trash-2" label={"حذف " + r.code} className="hover:text-rose-300" onClick={async () => { if (await confirm("کد " + r.code + " حذف شود؟", { danger: true, ok: "حذف" })) { await api.admin.deleteCoupon(r.id); notify("کد حذف شد"); } }} /></> },
        ]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "ویرایش کد" : "کد تخفیف جدید"} icon="badge-percent"
        footer={<><button type="button" onClick={() => setEdit(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => {
          if (!edit) return;
          if (!/^[A-Z0-9]{3,20}$/.test(edit.code)) throw new Error("کد فقط حروف بزرگ انگلیسی و عدد، ۳ تا ۲۰ کاراکتر.");
          const value = +amountInput(edit.value);
          if (!value) throw new Error("مقدار تخفیف را وارد کنید.");
          if (edit.type === "percent" && value > 100) throw new Error("درصد تخفیف حداکثر ۱۰۰ است.");
          await api.admin.saveCoupon({ ...edit, value, limit: +amountInput(edit.limit) || 0, expires: edit.expires.trim() || "—" }); setEdit(null); notify("کد تخفیف ذخیره شد", "badge-percent");
        }}>ذخیره</AsyncButton></>}>
        {edit && <div className="grid grid-cols-2 gap-4">
          <Field className="col-span-2" label="کد"><div className="flex gap-2"><input value={edit.code} onChange={(e) => setEdit((s) => s && { ...s, code: e.target.value.toUpperCase().replace(/\s/g, "") })} dir="ltr" className={INPUT + " text-left mono"} /><button type="button" onClick={() => setEdit((s) => s && { ...s, code: "GRH" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("") })} className={BTN_G + " px-3 h-11 text-xs shrink-0"}>ساخت تصادفی</button></div></Field>
          <Field label="نوع"><Select value={edit.type} label="نوع تخفیف" onChange={(v) => setEdit((s) => s && { ...s, type: v as "percent" | "fixed" })} options={[{ value: "percent", label: "درصدی" }, { value: "fixed", label: "مبلغ ثابت" }]} /></Field>
          <Field label={edit.type === "percent" ? "درصد" : "مبلغ (تومان)"}><input value={edit.value} inputMode="numeric" onChange={(e) => setEdit((s) => s && { ...s, value: amountInput(e.target.value) })} dir="ltr" className={INPUT + " text-left tabular"} /></Field>
          <Field label="سقف استفاده" hint="خالی یعنی نامحدود"><input value={edit.limit} inputMode="numeric" onChange={(e) => setEdit((s) => s && { ...s, limit: amountInput(e.target.value) })} dir="ltr" className={INPUT + " text-left tabular"} /></Field>
          <Field label="تاریخ انقضا"><input value={edit.expires === "—" ? "" : edit.expires} onChange={(e) => setEdit((s) => s && { ...s, expires: e.target.value })} placeholder="۱۴۰۴/۱۰/۰۱" className={INPUT} /></Field>
        </div>}
      </Modal>
    </div>
  );
}

/* ================= announcements ================= */
export function AdminAnnouncements() {
  const db = useDB();
  const { notify, confirm } = useApp();
  const [f, setF] = useState<{ title: string; body: string; level: "info" | "warning" | "critical" }>({ title: "", body: "", level: "info" });
  return (
    <div>
      <PageTitle title="اطلاعیه‌ها" sub="اطلاعیه‌ها در داشبورد همه کاربران نمایش داده می‌شوند." />
      <div className="grid xl:grid-cols-[1fr_1.2fr] gap-4">
        <Card title="اطلاعیه جدید" icon="megaphone">
          <div className="space-y-4">
            <Field label="عنوان"><input value={f.title} maxLength={120} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} className={INPUT} /></Field>
            <Field label="متن"><textarea value={f.body} maxLength={1000} onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))} rows={5} className={TEXTAREA} /></Field>
            <Field label="سطح"><Select value={f.level} label="سطح" onChange={(v) => setF((s) => ({ ...s, level: v as "info" }))} options={[{ value: "info", label: "اطلاع‌رسانی" }, { value: "warning", label: "هشدار" }, { value: "critical", label: "بحرانی" }]} /></Field>
          </div>
          <div className="mt-5 flex justify-end"><AsyncButton onClick={async () => { if (f.title.trim().length < 3 || f.body.trim().length < 10) throw new Error("عنوان و متن کامل لازم است."); await api.admin.saveAnnouncement({ ...f, title: f.title.trim(), body: f.body.trim() }); setF({ title: "", body: "", level: "info" }); notify("اطلاعیه منتشر شد", "megaphone"); }}><Icon name="send" size={15} /> انتشار</AsyncButton></div>
        </Card>
        <Card title="منتشرشده" icon="scroll-text" pad="p-3 sm:p-4">
          {db.announcements.length === 0 ? <Empty icon="megaphone" title="اطلاعیه‌ای منتشر نشده" /> : db.announcements.map((a) => (
            <div key={a.id} className="p-4 rounded-xl hover:bg-white/[0.03] flex gap-4 justify-between">
              <div><div className="flex flex-wrap items-center gap-2"><span className="font-bold">{a.title}</span><Badge tone={a.level === "critical" ? "red" : a.level === "warning" ? "amber" : "blue"}>{{ info: "اطلاع‌رسانی", warning: "هشدار", critical: "بحرانی" }[a.level]}</Badge></div><p className="text-sm text-white/55 leading-7 mt-1.5">{a.body}</p><div className="text-[11px] text-white/50 mt-1">{a.at}</div></div>
              <IconBtn icon="trash-2" label={"حذف اطلاعیه " + a.title} className="hover:text-rose-300 shrink-0" onClick={async () => { if (await confirm("اطلاعیه «" + a.title + "» حذف شود؟", { danger: true, ok: "حذف" })) { await api.admin.deleteAnnouncement(a.id); notify("اطلاعیه حذف شد"); } }} />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

export function AdminAudit() {
  const db = useDB();
  return (
    <div>
      <PageTitle title="گزارش فعالیت" sub="همه تغییرات مدیران ثبت می‌شود." />
      <DataTable rows={db.audit} searchKeys={["actor", "action", "target"]} pageSize={12}
        columns={[
          { key: "at", label: "زمان" }, { key: "actor", label: "کاربر", render: (r) => <span className="font-bold">{r.actor}</span> },
          { key: "action", label: "اقدام" }, { key: "target", label: "هدف", render: (r) => <span className="mono text-xs text-white/60">{r.target}</span> },
          { key: "ip", label: "IP", render: (r) => <span className="mono text-xs text-white/55">{r.ip}</span> },
        ]} />
    </div>
  );
}

export function AdminSettings() {
  const db = useDB();
  const { notify, confirm } = useApp();
  const [tab, setTab] = useState("general");
  const [s, setS] = useState(db.settings);
  const [st, setSt] = useState<{ name: string; email: string; role: string } | null>(null);
  const [smsKey, setSmsKey] = useState("");
  const save = async (patch: Partial<typeof s> & { smsKey?: string }) => { await api.admin.saveSettings(patch); notify("تنظیمات ذخیره شد"); };
  return (
    <div>
      <PageTitle title="تنظیمات سیستم" />
      <div className="overflow-x-auto no-scrollbar mb-6"><Tabs size="sm" value={tab} onChange={setTab} label="بخش تنظیمات" options={[{ id: "general", label: "عمومی", icon: "settings-2" }, { id: "finance", label: "مالی و درگاه", icon: "wallet" }, { id: "notify", label: "پیامک و ایمیل", icon: "mail" }, { id: "staff", label: "مدیران و دسترسی", icon: "users" }]} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "general" && (
          <Card title="تنظیمات عمومی" icon="settings-2">
            <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
              <Field label="نام سایت"><input value={s.siteName} onChange={(e) => setS((x) => ({ ...x, siteName: e.target.value }))} className={INPUT} /></Field>
              <Field label="ایمیل پشتیبانی"><input type="email" value={s.supportEmail} onChange={(e) => setS((x) => ({ ...x, supportEmail: e.target.value }))} dir="ltr" className={INPUT + " text-left"} /></Field>
              <Field label="تلفن پشتیبانی"><input value={s.supportPhone} onChange={(e) => setS((x) => ({ ...x, supportPhone: e.target.value }))} className={INPUT} /></Field>
            </div>
            <h3 className="text-sm font-black mt-8 mb-3 flex items-center gap-2"><Icon name="file-check" size={16} className="acc" />مشخصات فروشنده روی فاکتور رسمی</h3>
            <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
              <Field className="sm:col-span-2" label="نام حقوقی"><input value={s.legalName} onChange={(e) => setS((x) => ({ ...x, legalName: e.target.value }))} className={INPUT} /></Field>
              <Field label="شناسه ملی (۱۱ رقم)"><input value={s.sellerNationalId} onChange={(e) => setS((x) => ({ ...x, sellerNationalId: amountInput(e.target.value).slice(0, 11) }))} dir="ltr" inputMode="numeric" className={INPUT + " text-left tabular"} /></Field>
              <Field label="کد اقتصادی (۱۲ یا ۱۴ رقم)"><input value={s.sellerEconomicCode} onChange={(e) => setS((x) => ({ ...x, sellerEconomicCode: amountInput(e.target.value).slice(0, 14) }))} dir="ltr" inputMode="numeric" className={INPUT + " text-left tabular"} /></Field>
              <Field label="کد پستی"><input value={s.sellerPostalCode} onChange={(e) => setS((x) => ({ ...x, sellerPostalCode: amountInput(e.target.value).slice(0, 10) }))} dir="ltr" inputMode="numeric" className={INPUT + " text-left tabular"} /></Field>
              <Field label="سهم معرف از هر پرداخت (٪)"><input value={s.affiliateRate} onChange={(e) => setS((x) => ({ ...x, affiliateRate: Math.min(50, +amountInput(e.target.value) || 0) }))} dir="ltr" inputMode="numeric" className={INPUT + " text-left tabular"} /></Field>
              <Field className="sm:col-span-2" label="نشانی"><input value={s.sellerAddress} onChange={(e) => setS((x) => ({ ...x, sellerAddress: e.target.value }))} className={INPUT} /></Field>
            </div>
            <div className="mt-6 space-y-1 max-w-3xl">
              {([["registration", "ثبت‌نام کاربران جدید", "با خاموش کردن، فقط کاربران فعلی وارد می‌شوند."], ["maintenance", "حالت تعمیر و نگهداری", "سایت عمومی برای بازدیدکنندگان پیام نگهداری نشان می‌دهد."]] as const).map(([k, l, h]) => (
                <div key={k} className="flex items-center justify-between gap-4 p-3 rounded-xl bg-white/[0.02]"><div><div className="text-sm font-bold">{l}</div><div className="text-xs text-white/55 mt-1">{h}</div></div><Switch on={s[k]} label={l} onChange={(v) => setS((x) => ({ ...x, [k]: v }))} /></div>
              ))}
            </div>
            <div className="mt-6 flex justify-end max-w-3xl"><AsyncButton onClick={async () => { if (!s.siteName.trim()) throw new Error("نام سایت لازم است."); if (!EMAIL_RE.test(s.supportEmail)) throw new Error("ایمیل پشتیبانی معتبر نیست."); await save({ siteName: s.siteName.trim(), supportEmail: s.supportEmail.trim(), supportPhone: s.supportPhone.trim(), registration: s.registration, maintenance: s.maintenance,
              legalName: s.legalName.trim(), sellerNationalId: s.sellerNationalId, sellerEconomicCode: s.sellerEconomicCode, sellerAddress: s.sellerAddress.trim(), sellerPostalCode: s.sellerPostalCode, affiliateRate: s.affiliateRate }); }}>ذخیره</AsyncButton></div>
          </Card>
        )}
        {tab === "finance" && (
          <Card title="مالی و درگاه پرداخت" icon="wallet">
            <Field className="max-w-xs" label="نرخ مالیات بر ارزش افزوده (٪)"><input value={s.tax} inputMode="numeric" onChange={(e) => setS((x) => ({ ...x, tax: Math.min(100, +amountInput(e.target.value) || 0) }))} dir="ltr" className={INPUT + " text-left tabular"} /></Field>
            <div className="mt-6 grid sm:grid-cols-2 gap-2 max-w-3xl">
              {[["zarinpal", "زرین‌پال"], ["idpay", "آیدی‌پی"], ["wallet", "کیف پول داخلی"], ["crypto", "پرداخت رمزارزی"]].map(([k, l]) => (
                <div key={k} className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.07]"><span className="text-sm font-bold flex items-center gap-2"><Icon name="lock" size={15} className="text-white/55" />{l}</span><Switch on={!!s.gateways[k]} label={l} onChange={(v) => setS((x) => ({ ...x, gateways: { ...x.gateways, [k]: v } }))} /></div>
              ))}
            </div>
            <div className="mt-6 flex justify-end max-w-3xl"><AsyncButton onClick={async () => { if (!Object.values(s.gateways).some(Boolean)) throw new Error("حداقل یک روش پرداخت باید فعال باشد."); await save({ tax: s.tax, gateways: s.gateways }); }}>ذخیره</AsyncButton></div>
          </Card>
        )}
        {tab === "notify" && (
          <Card title="پیامک و ایمیل" icon="mail">
            <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
              <Field label="سرویس پیامک"><Select value={s.smsProvider} label="سرویس پیامک" onChange={(v) => setS((x) => ({ ...x, smsProvider: v }))} options={["کاوه‌نگار", "ملی‌پیامک", "فراز اس‌ام‌اس"]} /></Field>
              <Field label="کلید API پیامک" hint="فقط در سرور ذخیره می‌شود."><input type="password" autoComplete="new-password" value={smsKey} onChange={(e) => setSmsKey(e.target.value)} placeholder={s.smsKeySet ? "ذخیره شده؛ برای تغییر وارد کنید" : "••••••••••"} dir="ltr" className={INPUT + " text-left"} /></Field>
              <Field label="سرور SMTP"><input value={s.smtpHost} onChange={(e) => setS((x) => ({ ...x, smtpHost: e.target.value }))} dir="ltr" className={INPUT + " text-left mono"} /></Field>
              <Field label="پورت SMTP"><input value={s.smtpPort || ""} inputMode="numeric" onChange={(e) => setS((x) => ({ ...x, smtpPort: +amountInput(e.target.value).slice(0, 5) }))} dir="ltr" className={INPUT + " text-left mono"} /></Field>
            </div>
            <div className="mt-6 flex justify-end gap-2 max-w-3xl"><AsyncButton className={BTN_G + " px-4 h-10 text-sm"} onClick={async () => { await new Promise((r) => setTimeout(r, 600)); notify("ایمیل آزمایشی به " + s.supportEmail + " ارسال شد", "mail"); }}>ارسال آزمایشی</AsyncButton><AsyncButton onClick={async () => {
                if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.smtpHost.trim())) throw new Error("آدرس SMTP معتبر نیست.");
                if (!(s.smtpPort > 0 && s.smtpPort < 65536)) throw new Error("پورت SMTP معتبر نیست.");
                // the key is encrypted server-side (AES-GCM) and never sent back to the browser
                await save({ smsProvider: s.smsProvider, smtpHost: s.smtpHost.trim(), smtpPort: s.smtpPort, ...(smsKey ? { smsKey } : {}) });
                setSmsKey(""); if (smsKey) setS((x) => ({ ...x, smsKeySet: true }));
              }}>ذخیره</AsyncButton></div>
          </Card>
        )}
        {tab === "notify" && (
          <Card title="ربات‌های تلگرام و بله" icon="send" className="mt-4">
            <p className="text-sm text-white/60 leading-7 max-w-3xl">با ربات‌ها مشتریان اعلان‌های حساب را در پیام‌رسان می‌گیرند. در سرور (<code dir="ltr">sudo gereh env</code>) مقادیر <code dir="ltr">BALE_BOT_TOKEN</code>، <code dir="ltr">BALE_BOT_USERNAME</code> و برای تلگرام <code dir="ltr">TELEGRAM_BOT_TOKEN</code>، <code dir="ltr">TELEGRAM_BOT_USERNAME</code> را تنظیم کنید (برای تلگرام از سرور ایران، <code dir="ltr">TELEGRAM_API_BASE</code> را روی یک relay خارج بگذارید)، سپس این دکمه را بزنید.</p>
            <AsyncButton className={BTN_G + " px-4 h-10 text-sm mt-4"} onClick={async () => { const r = await api.notify.adminBots(); notify(r.map((x) => (x.kind === "telegram" ? "تلگرام" : "بله") + ": " + (x.ok ? "متصل شد" : x.detail)).join(" — "), "send"); }}><Icon name="send" size={15} />اتصال وب‌هوک ربات‌ها</AsyncButton>
          </Card>
        )}
        {tab === "staff" && <>
          <Card title="مدیران" icon="users" pad="p-3 sm:p-4" action={<button type="button" onClick={() => setSt({ name: "", email: "", role: "پشتیبانی فنی" })} className={BTN_P + " px-3 h-9 text-xs"}><Icon name="plus" size={15} /> افزودن مدیر</button>}>
            {db.staff.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
                <div className="flex items-center gap-3"><span className="w-9 h-9 rounded-xl tile grid place-items-center font-black text-sm" aria-hidden="true">{m.name[0]}</span><div><div className="text-sm font-bold">{m.name}</div><div className="text-[11px] text-white/55 ltr text-right">{m.email}</div></div></div>
                <div className="flex items-center gap-2"><Badge tone={m.role === "مدیر کل" ? "violet" : "gray"}>{m.role}</Badge>{m.role !== "مدیر کل" && <IconBtn icon="trash-2" label={"حذف " + m.name} className="hover:text-rose-300" onClick={async () => { if (await confirm(m.name + " از مدیران حذف شود؟", { danger: true, ok: "حذف" })) { await api.admin.removeStaff(m.id); notify("مدیر حذف شد"); } }} />}</div>
              </div>
            ))}
          </Card>
          <Modal open={!!st} onClose={() => setSt(null)} title="افزودن مدیر" icon="user-plus"
            footer={<><button type="button" onClick={() => setSt(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => { if (!st) return; if (st.name.trim().length < 2 || !st.email.trim()) throw new Error("نام و ایمیل لازم است."); await api.admin.addStaff({ ...st, name: st.name.trim(), email: st.email.trim().toLowerCase() }); setSt(null); notify("مدیر اضافه شد"); }}>افزودن</AsyncButton></>}>
            {st && <div className="space-y-4">
              <Field label="نام"><input value={st.name} onChange={(e) => setSt((x) => x && { ...x, name: e.target.value })} className={INPUT} /></Field>
              <Field label="ایمیل"><input type="email" value={st.email} onChange={(e) => setSt((x) => x && { ...x, email: e.target.value })} dir="ltr" className={INPUT + " text-left"} /></Field>
              <Field label="نقش"><Select value={st.role} label="نقش" onChange={(v) => setSt((x) => x && { ...x, role: v })} options={["مدیر کل", "پشتیبانی فنی", "مالی", "فروش", "فقط مشاهده"]} /></Field>
            </div>}
          </Modal>
        </>}
      </div>
    </div>
  );
}
