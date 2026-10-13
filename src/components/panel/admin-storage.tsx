"use client";
import { useState } from "react";
import { BTN_G, INPUT } from "@/lib/cls";
import { fa, toEnDigits, toman } from "@/lib/format";
import { BUCKET_STATUS, bytes, GB } from "@/lib/storage";
import { api, useDB } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Meter } from "../ui";
import { AsyncButton, PageTitle, StatCard, Switch, Tabs } from "../ui-client";

const num = (s: string) => Number(toEnDigits(s).replace(/[^\d]/g, "")) || 0;

export function AdminStorage() {
  const db = useDB(); const s = db.storage;
  const [tab, setTab] = useState("buckets");
  const [q, setQ] = useState("");
  const [test, setTest] = useState<string | null>(null);
  const owner = (id: string) => db.users.find((u) => u.id === id);
  const planOf = (id: string) => s.plans.find((p) => p.id === id);
  const active = s.buckets.filter((b) => b.status === "active");
  const mrr = active.reduce((sum, b) => sum + (planOf(b.planId)?.price ?? 0), 0);
  const used = s.buckets.reduce((sum, b) => sum + b.usedBytes, 0);
  const list = s.buckets.filter((b) => !q || b.name.includes(q.toLowerCase()) || (owner(b.userId)?.name ?? "").includes(q) || (owner(b.userId)?.email ?? "").includes(q.toLowerCase()));
  return (
    <div>
      <PageTitle title="فضای ذخیره‌سازی ابری" sub={"باکت‌های مشتریان و پلن‌ها. درایور: " + (s.driver === "s3" ? "MinIO / S3" : "شبیه‌ساز (STORAGE_S3_* تنظیم نشده)")}
        action={<AsyncButton className={BTN_G + " h-10 px-4 text-sm"} onClick={async () => { const r = await api.storage.adminTest(); setTest(r.driver + ": " + r.version); }}><Icon name="activity" size={15} />تست اتصال</AsyncButton>} />
      {test && <p role="status" className="mb-4 text-sm text-white/75" dir="auto">{test}</p>}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <StatCard icon="hard-drive" label="باکت‌ها" value={s.buckets.length} sub={fa(active.length) + " فعال"} />
        <StatCard icon="database" label="حجم ذخیره‌شده" value={bytes(used)} />
        <StatCard icon="pause" label="معلق" value={s.buckets.length - active.length} tone={s.buckets.length > active.length ? "down" : ""} />
        <StatCard icon="wallet" label="درآمد ماهانه" value={Math.round(mrr / 1e5) / 10} suffix="میلیون" />
      </div>
      <div className="mb-4"><Tabs size="sm" value={tab} onChange={setTab} label="بخش" options={[{ id: "buckets", label: "باکت‌ها", icon: "hard-drive" }, { id: "plans", label: "پلن‌ها", icon: "tag" }]} /></div>
      {tab === "buckets" && (
        <Card pad="p-3 sm:p-4" action={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی باکت یا مشتری" aria-label="جست‌وجو" className={INPUT + " h-9 w-56"} />} title="باکت‌ها" icon="hard-drive">
          {list.length === 0 ? <Empty icon="hard-drive" title="باکتی پیدا نشد" /> : (
            <ul className="divide-y divide-white/[0.06]">
              {list.map((b) => { const plan = planOf(b.planId); const o = owner(b.userId); return (
                <li key={b.id} className="p-3 grid md:grid-cols-[1.4fr_1fr_auto] gap-3 items-center">
                  <span className="min-w-0"><b dir="ltr">{b.name}</b> {b.access === "public" && <Badge tone="blue">عمومی</Badge>}<span className="block text-xs text-white/55 mt-0.5">{o?.name ?? b.userId}{o?.email ? " · " + o.email : ""} · {b.at}</span></span>
                  <Meter value={b.usedBytes} max={(plan?.sizeGb ?? 1) * GB} label={fa(b.objects) + " فایل"} right={bytes(b.usedBytes) + " / " + (plan?.name ?? b.planId)} />
                  <span className="flex flex-wrap items-center gap-2 justify-end">
                    <Badge tone={BUCKET_STATUS[b.status]?.[1]} dot>{BUCKET_STATUS[b.status]?.[0]}{b.suspendReason === "billing" ? " (اعتبار)" : b.suspendReason === "staff" ? " (پشتیبانی)" : ""}</Badge>
                    {b.status === "suspended"
                      ? <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} onClick={() => api.storage.adminSuspend(b.id, false)}><Icon name="play" size={13} />فعال‌سازی</AsyncButton>
                      : <AsyncButton danger className={BTN_G + " h-9 px-3 text-xs"} confirmText={"دسترسی به باکت " + b.name + " متوقف شود؟"} onClick={() => api.storage.adminSuspend(b.id, true)}><Icon name="pause" size={13} />تعلیق</AsyncButton>}
                  </span>
                </li>
              ); })}
            </ul>
          )}
        </Card>
      )}
      {tab === "plans" && (
        <Card pad="p-3 sm:p-4" title="پلن‌ها" icon="tag">
          <ul className="space-y-1">{s.plans.map((p) => <PlanRow key={p.id} p={p} />)}</ul>
          <p className="text-[11px] text-white/50 mt-3 px-3">قیمت ماهانه؛ هزینه ساعتی (قیمت ÷ ۷۲۰) از ساعت بعد برای همه باکت‌های این پلن اعمال می‌شود. حجم پلن‌ها ثابت است.</p>
        </Card>
      )}
    </div>
  );
}

function PlanRow({ p }: { p: ReturnType<typeof useDB>["storage"]["plans"][number] }) {
  const { notify } = useApp();
  const [f, setF] = useState({ name: p.name, price: String(p.price) });
  const dirty = f.name !== p.name || num(f.price) !== p.price;
  return (
    <li className="p-3 rounded-xl hover:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2 mb-2"><span className="text-[11px] text-white/55">{p.id} · {fa(p.sizeGb)} گیگابایت · {toman(Math.ceil(p.price / 720))} در ساعت</span>
        <Switch on={p.active} onChange={async (v) => { await api.storage.adminPlan(p.id, { active: v }); notify("ذخیره شد", "check"); }} label={"فعال بودن " + p.name} /></div>
      <div className="grid grid-cols-2 sm:grid-cols-[1fr_9rem_auto] gap-2 items-center">
        <input aria-label={"نام " + p.id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={INPUT + " h-10"} />
        <input aria-label={"قیمت " + p.id} value={f.price} inputMode="numeric" onChange={(e) => setF({ ...f, price: e.target.value })} dir="ltr" className={INPUT + " h-10 text-left tabular"} />
        <AsyncButton disabled={!dirty} className={BTN_G + " h-10 px-3 text-xs"} onClick={async () => { await api.storage.adminPlan(p.id, { name: f.name, price: num(f.price) }); notify("ذخیره شد", "check"); }}>ذخیره</AsyncButton>
      </div>
    </li>
  );
}
