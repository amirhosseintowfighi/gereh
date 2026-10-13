"use client";
import { useEffect, useState } from "react";
import { BTN_G, INPUT } from "@/lib/cls";
import { fa, toEnDigits } from "@/lib/format";
import { MAIL_DOMAIN_STATUS, type MailAdminList, type MailPlan } from "@/lib/mail";
import { api } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty } from "../ui";
import { AsyncButton, PageTitle, StatCard, Switch, Tabs } from "../ui-client";

const num = (s: string) => Number(toEnDigits(s).replace(/[^\d]/g, "")) || 0;

export function AdminMail() {
  const [data, setData] = useState<MailAdminList | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState("domains");
  const [test, setTest] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    let live = true;
    api.mail.adminList().then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [tick]);
  const reload = () => setTick((t) => t + 1);
  if (!data) return error ? <Card><Empty icon="circle-alert" title="بارگذاری نشد" text={error} /></Card> : <div className="py-16 grid place-items-center"><Icon name="loader-circle" size={24} className="animate-spin text-white/50" /></div>;
  const mrr = data.domains.filter((d) => d.suspendReason !== "staff").reduce((s, d) => s + (data.plans.find((p) => p.id === d.planId)?.price ?? 0), 0);
  const shown = data.domains.filter((d) => !q || d.domain.includes(q.toLowerCase()) || d.owner.includes(q) || d.email.includes(q.toLowerCase()));
  return (
    <div>
      <PageTitle title="سرویس ایمیل" sub={"دامنه‌ها، تعلیق و پلن‌ها. درایور: " + (data.driver === "stalwart" ? "Stalwart" : "شبیه‌ساز (STALWART_URL تنظیم نشده)")}
        action={<AsyncButton className={BTN_G + " h-10 px-4 text-sm"} onClick={async () => { const r = await api.mail.adminTest(); setTest(r.driver + ": " + r.detail); }}><Icon name="activity" size={15} />تست اتصال</AsyncButton>} />
      {test && <p role="status" className="mb-4 text-sm text-white/75" dir="auto">{test}</p>}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <StatCard icon="mail" label="دامنه‌ها" value={data.domains.length} sub={fa(data.domains.filter((d) => d.mode === "live").length) + " در حالت LIVE"} />
        <StatCard icon="ban" label="معلق" value={data.domains.filter((d) => d.status === "suspended").length} />
        <StatCard icon="send" label="ارسال ۳۰ روز" value={data.domains.reduce((s, d) => s + d.sent30, 0)} />
        <StatCard icon="wallet" label="درآمد ماهانه" value={Math.round(mrr / 1e5) / 10} suffix="میلیون" />
      </div>
      <div className="mb-4"><Tabs size="sm" value={tab} onChange={setTab} label="بخش" options={[{ id: "domains", label: "دامنه‌ها", icon: "mail" }, { id: "plans", label: "پلن‌ها", icon: "tag" }]} /></div>
      {tab === "domains" && (
        <Card pad="p-3 sm:p-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجو" placeholder="جست‌وجوی دامنه یا مشتری" className={INPUT + " h-10 mb-3"} />
          {shown.length === 0 ? <Empty icon="mail" title="دامنه‌ای پیدا نشد" /> : (
            <ul className="divide-y divide-white/[0.06]">
              {shown.map((d) => { const [label, tone] = MAIL_DOMAIN_STATUS[d.status] ?? [d.status, "gray"]; return (
                <li key={d.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <b dir="ltr">{d.domain}</b> <span className="text-xs text-white/55">— {d.owner} · {data.plans.find((p) => p.id === d.planId)?.name ?? d.planId} · {fa(d.mailboxes)} صندوق · {fa(d.sent30)} ارسال در ۳۰ روز</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {d.mode === "live" ? <Badge tone="green">LIVE</Badge> : <Badge tone="amber">DEV</Badge>}
                    <Badge tone={tone} dot>{label}{d.suspendReason === "credit" ? " (موجودی)" : d.suspendReason === "staff" ? " (پشتیبانی)" : ""}</Badge>
                    {d.suspendReason === "staff"
                      ? <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} onClick={async () => { await api.mail.adminDomain(d.id, { suspend: false }); reload(); }}><Icon name="play" size={13} />رفع تعلیق</AsyncButton>
                      : <AsyncButton danger className={BTN_G + " h-9 px-3 text-xs"} confirmText={"ارسال ایمیل " + d.domain + " معلق شود؟"} onClick={async () => { await api.mail.adminDomain(d.id, { suspend: true }); reload(); }}><Icon name="pause" size={13} />تعلیق</AsyncButton>}
                  </span>
                </li>
              ); })}
            </ul>
          )}
        </Card>
      )}
      {tab === "plans" && (
        <Card pad="p-3 sm:p-4" title="پلن‌ها" icon="tag">
          <div className="hidden sm:grid grid-cols-[1fr_7rem_6rem_7rem_5rem_6rem_auto] gap-2 px-3 text-[11px] text-white/50"><span>نام</span><span>قیمت ماهانه</span><span>سقف روزانه</span><span>سقف ماهانه</span><span>صندوق</span><span>فضا (MB)</span><span /></div>
          <ul className="space-y-1">{data.plans.map((p) => <PlanRow key={p.id} p={p} reload={reload} />)}</ul>
          <p className="text-[11px] text-white/50 mt-3 px-3">قیمت ماهانه است و ساعتی از کیف پول کسر می‌شود؛ تغییر از ساعت بعد اعمال می‌شود.</p>
        </Card>
      )}
    </div>
  );
}

function PlanRow({ p, reload }: { p: MailPlan; reload: () => void }) {
  const { notify } = useApp();
  const [f, setF] = useState({ name: p.name, price: String(p.price), dailyLimit: String(p.dailyLimit), monthlyLimit: String(p.monthlyLimit), mailboxes: String(p.mailboxes), quotaMb: String(p.quotaMb) });
  const dirty = f.name !== p.name || num(f.price) !== p.price || num(f.dailyLimit) !== p.dailyLimit || num(f.monthlyLimit) !== p.monthlyLimit || num(f.mailboxes) !== p.mailboxes || num(f.quotaMb) !== p.quotaMb;
  const box = (k: Exclude<keyof typeof f, "name">, label: string) => <input aria-label={label + " " + p.id} value={f[k]} inputMode="numeric" onChange={(e) => setF({ ...f, [k]: e.target.value })} dir="ltr" className={INPUT + " h-10 text-left tabular"} />;
  return (
    <li className="p-3 rounded-xl hover:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2 mb-2"><span className="text-[11px] text-white/55">{p.id}</span><Switch on={p.active} onChange={async (v) => { await api.mail.adminPlan(p.id, { active: v }); notify("ذخیره شد", "check"); reload(); }} label={"فعال بودن " + p.name} /></div>
      <div className="grid grid-cols-2 sm:grid-cols-[1fr_7rem_6rem_7rem_5rem_6rem_auto] gap-2 items-center">
        <input aria-label={"نام " + p.id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={INPUT + " h-10"} />
        {box("price", "قیمت")}{box("dailyLimit", "سقف روزانه")}{box("monthlyLimit", "سقف ماهانه")}{box("mailboxes", "تعداد صندوق")}{box("quotaMb", "فضای صندوق")}
        <AsyncButton disabled={!dirty} className={BTN_G + " h-10 px-3 text-xs"} onClick={async () => {
          await api.mail.adminPlan(p.id, { name: f.name, price: num(f.price), dailyLimit: num(f.dailyLimit), monthlyLimit: num(f.monthlyLimit), mailboxes: num(f.mailboxes), quotaMb: num(f.quotaMb) });
          notify("ذخیره شد", "check"); reload();
        }}>ذخیره</AsyncButton>
      </div>
    </li>
  );
}
