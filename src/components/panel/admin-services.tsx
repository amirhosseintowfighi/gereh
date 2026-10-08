"use client";
import { useState } from "react";
import { BTN_G, INPUT, TEXTAREA } from "@/lib/cls";
import { fa, toEnDigits, toman } from "@/lib/format";
import { SYNC_LABEL, SYNC_STATUS, ZONE_STATUS } from "@/lib/geo";
import { inquiryDef } from "@/lib/inquiry";
import { api, useDB } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, CopyText, Modal, PageTitle, Select, StatCard, Switch, Tabs } from "../ui-client";
import { CALL_STATUS } from "./inquiry";

const num = (s: string) => Number(toEnDigits(s).replace(/[^\d]/g, "")) || 0;
const Pill = ({ map, s }: { map: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]>; s: string }) => { const [l, t] = map[s] ?? [s, "gray"]; return <Badge tone={t} dot>{l}</Badge>; };

/* ======================= inquiry ======================= */
export function AdminInquiry() {
  const db = useDB(); const q = db.inquiry;
  const [tab, setTab] = useState(q.grants.some((g) => g.status === "pending") ? "requests" : "services");
  const pending = q.grants.filter((g) => g.status === "pending");
  const errors = q.calls.filter((c) => c.status === "error").length;
  return (
    <div>
      <PageTitle title="API استعلام" sub={"سرویس‌ها و قیمت‌ها، درخواست‌های دسترسی و حساب‌های API. سرویس‌دهنده: " + (q.provider === "http" ? "متصل" : "شبیه‌ساز (INQUIRY_PROVIDER_URL تنظیم نشده)")} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <StatCard icon="activity" label="درخواست امروز" value={q.stats.todayCount} />
        <StatCard icon="wallet" label="درآمد امروز" value={q.stats.todaySpend} suffix="تومان" />
        <StatCard icon="chart-column" label="درآمد ۳۰ روز" value={Math.round(q.stats.monthSpend / 1e5) / 10} suffix="میلیون" />
        <StatCard icon="file-check" label="درخواست دسترسی باز" value={pending.length} tone={pending.length ? "down" : ""} sub={fa(errors) + " خطای سرویس‌دهنده در آخرین درخواست‌ها"} />
      </div>
      <div className="overflow-x-auto no-scrollbar mb-4"><Tabs size="sm" value={tab} onChange={setTab} label="بخش" options={[
        { id: "requests", label: "درخواست‌های دسترسی" + (pending.length ? " (" + fa(pending.length) + ")" : ""), icon: "file-check" }, { id: "services", label: "سرویس‌ها و قیمت", icon: "tag" },
        { id: "accounts", label: "حساب‌ها", icon: "users" }, { id: "calls", label: "آخرین درخواست‌ها", icon: "activity" },
      ]} /></div>
      {tab === "requests" && <Requests />}
      {tab === "services" && <ServiceList />}
      {tab === "accounts" && <Accounts />}
      {tab === "calls" && <Calls />}
    </div>
  );
}

function Requests() {
  const db = useDB(); const { notify } = useApp();
  const [reject, setReject] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const list = db.inquiry.grants;
  return (
    <Card pad="p-3 sm:p-4">
      {list.length === 0 ? <Empty icon="file-check" title="درخواستی نیست" /> : (
        <ul className="divide-y divide-white/[0.06]">
          {list.map((g) => (
            <li key={g.id} className="p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="flex flex-wrap items-center gap-2"><b className="text-sm">{g.userName}</b><Badge>{inquiryDef(g.serviceId)?.name ?? g.serviceId}</Badge><Badge tone={g.status === "approved" ? "green" : g.status === "rejected" ? "red" : "amber"}>{g.status === "approved" ? "تأیید شده" : g.status === "rejected" ? "رد شده" : "در انتظار"}</Badge></span>
                <p className="text-sm text-white/70 leading-7 mt-1">{g.useCase}</p>
                <span className="text-[11px] text-white/45">{g.at}{g.note ? " · " + g.note : ""}</span>
              </div>
              {g.status === "pending" && <div className="flex gap-2 shrink-0">
                <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} onClick={async () => { await api.inquiry.decide(g.id, true, ""); notify("دسترسی فعال شد", "circle-check"); }}><Icon name="check" size={13} />تأیید</AsyncButton>
                <button type="button" onClick={() => { setReject(g.id); setNote(""); }} className={BTN_G + " h-9 px-3 text-xs"}>رد</button>
              </div>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={reject !== null} onClose={() => setReject(null)} title="رد درخواست دسترسی" icon="circle-alert">
        <Field label="دلیل (برای مشتری نمایش داده می‌شود)"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={TEXTAREA} /></Field>
        <AsyncButton danger className="mt-3" disabled={note.trim().length < 5} onClick={async () => { await api.inquiry.decide(reject!, false, note.trim()); setReject(null); }}>رد درخواست</AsyncButton>
      </Modal>
    </Card>
  );
}

function ServiceRow({ s }: { s: ReturnType<typeof useDB>["inquiry"]["services"][number] }) {
  const { notify } = useApp();
  const [f, setF] = useState({ name: s.name, price: String(s.price), upstream: s.upstream });
  const dirty = f.name !== s.name || num(f.price) !== s.price || f.upstream !== s.upstream;
  return (
    <li className="p-3 rounded-xl hover:bg-white/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <code dir="ltr" className="text-xs text-white/60">{s.id}</code>
        <span className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-2">نیاز به تأیید<Switch on={s.approval} onChange={async (v) => { await api.inquiry.adminService(s.id, { approval: v }); notify("ذخیره شد", "check"); }} label={"نیاز به تأیید " + s.name} /></span>
          <span className="flex items-center gap-2">فعال<Switch on={s.active} onChange={async (v) => { await api.inquiry.adminService(s.id, { active: v }); notify(v ? "سرویس فعال شد" : "سرویس غیرفعال شد", "check"); }} label={"فعال بودن " + s.name} /></span>
        </span>
      </div>
      <div className="grid sm:grid-cols-[1fr_9rem_10rem_auto] gap-2 items-center">
        <input aria-label={"نام " + s.id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={INPUT + " h-10"} />
        <input aria-label={"قیمت " + s.id} value={f.price} inputMode="numeric" onChange={(e) => setF({ ...f, price: e.target.value })} dir="ltr" className={INPUT + " h-10 text-left tabular"} />
        <input aria-label={"مسیر سرویس‌دهنده " + s.id} value={f.upstream} placeholder={s.id} onChange={(e) => setF({ ...f, upstream: e.target.value.trim() })} dir="ltr" className={INPUT + " h-10 text-left font-mono text-xs"} />
        <AsyncButton disabled={!dirty} className={BTN_G + " h-10 px-3 text-xs"} onClick={async () => { await api.inquiry.adminService(s.id, { name: f.name, price: num(f.price), upstream: f.upstream }); notify("ذخیره شد · " + toman(num(f.price)), "check"); }}>ذخیره</AsyncButton>
      </div>
    </li>
  );
}
function ServiceList() {
  const db = useDB();
  return (
    <Card pad="p-3 sm:p-4" title="سرویس‌ها" icon="tag">
      <p className="text-[11px] text-white/50 px-3 mb-2">قیمت به تومان و برای هر درخواست با پاسخ قطعی (موفق یا یافت نشد). ستون سوم مسیر سرویس در سرویس‌دهنده بالادستی است؛ خالی یعنی همان شناسه.</p>
      <ul className="space-y-1">{db.inquiry.services.map((s) => <ServiceRow key={s.id} s={s} />)}</ul>
    </Card>
  );
}

function Accounts() {
  const db = useDB();
  return (
    <Card pad="p-3 sm:p-4">
      {db.inquiry.accounts.length === 0 ? <Empty icon="users" title="هنوز حساب API ساخته نشده است" /> : (
        <ul className="divide-y divide-white/[0.06]">
          {db.inquiry.accounts.map((a) => (
            <li key={a.userId} className="p-3 flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0"><b className="text-sm">{a.name}</b><span dir="ltr" className="block text-[11px] text-white/50 text-right">{a.email} · #{a.accountNo}</span></span>
              <span className="text-xs text-white/60 tabular">{fa(a.calls30)} درخواست · {toman(a.spend30)} در ۳۰ روز</span>
              {a.status === "active"
                ? <AsyncButton danger className={BTN_G + " h-8 px-3 text-xs"} confirmText={"دسترسی API " + a.name + " معلق شود؟"} onClick={() => api.inquiry.adminAccount(a.userId, "suspended")}><Icon name="pause" size={13} />تعلیق</AsyncButton>
                : <AsyncButton className={BTN_G + " h-8 px-3 text-xs"} onClick={() => api.inquiry.adminAccount(a.userId, "active")}><Icon name="play" size={13} />رفع تعلیق</AsyncButton>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Calls() {
  const db = useDB();
  const user = (id: string) => db.users.find((u) => u.id === id)?.name ?? id;
  return (
    <Card pad="p-3 sm:p-4">
      {db.inquiry.calls.length === 0 ? <Empty icon="activity" title="درخواستی ثبت نشده" /> : (
        <ul className="divide-y divide-white/[0.06]">
          {db.inquiry.calls.map((c) => { const [l, t] = CALL_STATUS[c.status] ?? [c.status, "gray"]; return (
            <li key={c.id} className="py-2.5 px-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0"><b>{user(c.userId)}</b> <span className="text-white/60">— {inquiryDef(c.serviceId)?.name ?? c.serviceId}</span><span dir="ltr" className="block text-[11px] text-white/40 text-right">{c.id} · {c.input}</span></span>
              <span className="flex items-center gap-2 text-xs"><Badge tone={t}>{l}</Badge>{c.sandbox && <Badge tone="blue">sandbox</Badge>}<span className="tabular">{c.charged ? toman(c.charged) : "—"}</span><span className="text-white/45">{c.at}</span></span>
            </li>
          ); })}
        </ul>
      )}
    </Card>
  );
}

/* ======================= geo dns ======================= */
export function AdminGeo() {
  const db = useDB(); const g = db.geo; const { notify } = useApp();
  const [tab, setTab] = useState("zones");
  const [test, setTest] = useState<string | null>(null);
  const owner = (id: string) => db.users.find((u) => u.id === id);
  const mrr = g.zones.filter((z) => z.status !== "suspended").reduce((s, z) => s + (g.plans.find((p) => p.id === z.planId)?.price ?? 0), 0);
  return (
    <div>
      <PageTitle title="Geo DNS" sub={"دامنه‌ها، همگام‌سازی مدیریت‌شده و پلن‌ها. درایور: " + (g.driver === "powerdns" ? "PowerDNS" : "شبیه‌ساز (GEO_PDNS تنظیم نشده)")}
        action={<AsyncButton className={BTN_G + " h-10 px-4 text-sm"} onClick={async () => { const r = await api.geo.adminTest(); setTest(r.driver + ": " + r.detail); }}><Icon name="activity" size={15} />تست نام‌سرورها</AsyncButton>} />
      {test && <p role="status" className="mb-4 text-sm text-white/75" dir="auto">{test}</p>}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <StatCard icon="globe" label="دامنه‌ها" value={g.zones.length} sub={fa(g.zones.filter((z) => z.status === "active").length) + " فعال"} />
        <StatCard icon="clock" label="در انتظار NS" value={g.zones.filter((z) => z.status === "pending").length} />
        <StatCard icon="refresh-cw" label="همگام‌سازی نیازمند رسیدگی" value={g.zones.filter((z) => ["setup", "failed", "lagging"].includes(z.syncStatus)).length} tone={g.zones.some((z) => z.syncStatus === "failed") ? "down" : ""} />
        <StatCard icon="wallet" label="درآمد ماهانه" value={Math.round(mrr / 1e5) / 10} suffix="میلیون" />
      </div>
      <div className="mb-4"><Tabs size="sm" value={tab} onChange={setTab} label="بخش" options={[{ id: "zones", label: "دامنه‌ها", icon: "globe" }, { id: "plans", label: "پلن‌ها", icon: "tag" }]} /></div>
      {tab === "zones" && (
        <Card pad="p-3 sm:p-4">
          {g.zones.length === 0 ? <Empty icon="globe" title="دامنه‌ای ثبت نشده" /> : (
            <ul className="divide-y divide-white/[0.06]">
              {g.zones.map((z) => { const plan = g.plans.find((p) => p.id === z.planId); return (
                <li key={z.id} className="p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0"><b dir="ltr">{z.domain}</b> <span className="text-xs text-white/55">— {owner(z.userId)?.name ?? z.userId} · {plan?.name} · تا {z.paidUntil}</span></span>
                    <span className="flex flex-wrap items-center gap-2"><Pill map={ZONE_STATUS} s={z.status} />{plan?.sync !== "none" && <Pill map={SYNC_STATUS} s={z.syncStatus} />}</span>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    {plan?.sync !== "none" && <div className="w-48"><Select label={"وضعیت همگام‌سازی " + z.domain} value={z.syncStatus} onChange={async (v) => { await api.geo.adminZone(z.id, { syncStatus: v as "ok" }); notify("ذخیره شد", "check"); }} options={Object.entries(SYNC_STATUS).map(([k, [l]]) => ({ value: k, label: l }))} /></div>}
                    <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} onClick={async () => { await api.geo.adminZone(z.id, { extendDays: 30 }); notify("۳۰ روز تمدید شد", "check"); }}>+۳۰ روز رایگان</AsyncButton>
                    {z.status === "suspended"
                      ? <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} onClick={() => api.geo.adminZone(z.id, { status: "active" })}><Icon name="play" size={13} />فعال‌سازی</AsyncButton>
                      : <AsyncButton danger className={BTN_G + " h-9 px-3 text-xs"} confirmText={"تفکیک جغرافیایی " + z.domain + " متوقف شود؟"} onClick={() => api.geo.adminZone(z.id, { status: "suspended" })}><Icon name="pause" size={13} />تعلیق</AsyncButton>}
                  </div>
                  {plan?.sync !== "none" && <div className="text-[11px] text-white/55 leading-6">توکن عامل همگام‌سازی (<span dir="ltr">POST /api/geo/sync/{z.id}</span>): <CopyText text={z.syncToken} className="font-mono" />{z.lastSync && <> · آخرین گزارش {z.lastSync}</>}</div>}
                </li>
              ); })}
            </ul>
          )}
        </Card>
      )}
      {tab === "plans" && (
        <Card pad="p-3 sm:p-4" title="پلن‌ها" icon="tag">
          <ul className="space-y-1">{g.plans.map((p) => <GeoPlanRow key={p.id} p={p} />)}</ul>
          <p className="text-[11px] text-white/50 mt-3 px-3">قیمت ماهانه؛ از تمدید بعدی هر دامنه اعمال می‌شود.</p>
        </Card>
      )}
    </div>
  );
}

function GeoPlanRow({ p }: { p: ReturnType<typeof useDB>["geo"]["plans"][number] }) {
  const { notify } = useApp();
  const [f, setF] = useState({ name: p.name, price: String(p.price), records: String(p.records) });
  const dirty = f.name !== p.name || num(f.price) !== p.price || num(f.records) !== p.records;
  return (
    <li className="p-3 rounded-xl hover:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2 mb-2"><span className="text-[11px] text-white/55">{p.id} · {p.healthChecks ? "با سوییچ خودکار" : "بدون سوییچ خودکار"} · {SYNC_LABEL[p.sync]}</span>
        <Switch on={p.active} onChange={async (v) => { await api.geo.adminPlan(p.id, { active: v }); notify("ذخیره شد", "check"); }} label={"فعال بودن " + p.name} /></div>
      <div className="grid grid-cols-2 sm:grid-cols-[1fr_8rem_5rem_auto] gap-2 items-center">
        <input aria-label={"نام " + p.id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={INPUT + " h-10"} />
        <input aria-label={"قیمت " + p.id} value={f.price} inputMode="numeric" onChange={(e) => setF({ ...f, price: e.target.value })} dir="ltr" className={INPUT + " h-10 text-left tabular"} />
        <input aria-label={"سقف رکورد " + p.id} value={f.records} inputMode="numeric" onChange={(e) => setF({ ...f, records: e.target.value })} dir="ltr" className={INPUT + " h-10 text-left"} />
        <AsyncButton disabled={!dirty} className={BTN_G + " h-10 px-3 text-xs"} onClick={async () => { await api.geo.adminPlan(p.id, { name: f.name, price: num(f.price), records: num(f.records) }); notify("ذخیره شد", "check"); }}>ذخیره</AsyncButton>
      </div>
    </li>
  );
}
