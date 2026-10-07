"use client";
import { useEffect, useState } from "react";
import { BTN_P } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { Icon } from "../icon";
import { Badge, Card, Empty } from "../ui";
import { AreaChart, Bars, PageTitle, Select, StatCard } from "../ui-client";

type Month = { month: string; key: string; invoices: number; net: number; vat: number; gross: number; refunds: number; commissions: number; topups: number; online: number; newCustomers: number };
type Report = {
  finance: { months: Month[]; totals: Omit<Month, "month" | "key">; categories: { name: string; amount: number }[]; topCustomers: { id: string; name: string; email: string; amount: number }[]; gateways: { name: string; amount: number; count: number }[]; outstanding: { count: number; amount: number } };
  sla: { days: number; tickets: number; answered: number; slaRate: number; overdueNow: string[]; agents: { agent: string; replies: number; tickets: number; firstResponses: number; avgFirstMin: number; withinSla: number }[] };
};
const mil = (n: number) => fa(Math.round(n / 100_000) / 10, 1);
const dur = (m: number) => (m >= 60 ? fa(Math.round(m / 6) / 10, 1) + " ساعت" : fa(m) + " دقیقه");

/** finance by Jalali month + support SLA; data from /api/admin/reports, Excel from /export */
export function AdminReports() {
  const [months, setMonths] = useState("12");
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/admin/reports?months=" + months, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "خطا در دریافت گزارش"); return j.result as Report; })
      .then((d) => { if (live) { setData(d); setError(""); } }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [months]);

  const f = data?.finance; const s = data?.sla;
  return (
    <div>
      <PageTitle title="گزارش‌ها" sub="درآمد به تفکیک ماه شمسی (به وقت تهران) و عملکرد پشتیبانی."
        action={<div className="flex gap-2 items-center">
          <Select className="w-36" label="بازه گزارش" value={months} onChange={setMonths} options={[{ value: "3", label: "۳ ماه اخیر" }, { value: "6", label: "۶ ماه اخیر" }, { value: "12", label: "۱۲ ماه اخیر" }, { value: "24", label: "۲۴ ماه اخیر" }]} />
          <a href={"/api/admin/reports/export?months=" + months} download className={BTN_P + " h-10 px-4 text-sm"}><Icon name="download" size={16} />خروجی اکسل</a>
        </div>} />
      {error ? <Card><Empty icon="circle-alert" title="گزارش در دسترس نیست" text={error} /></Card> : !f || !s ? (
        <div aria-busy="true" className="grid place-items-center py-20"><Icon name="loader-circle" size={28} className="animate-spin text-white/50" /></div>
      ) : (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard icon="wallet" label="فروش با مالیات" value={mil(f.totals.gross)} suffix="میلیون تومان" sub={fa(f.totals.invoices) + " صورتحساب پرداخت‌شده"} />
            <StatCard icon="receipt" label="مالیات بر ارزش افزوده" value={mil(f.totals.vat)} suffix="میلیون تومان" sub={"فروش خالص " + mil(f.totals.net) + " میلیون"} />
            <StatCard icon="clock" label="مطالبات معوق" value={mil(f.outstanding.amount)} suffix="میلیون تومان" sub={fa(f.outstanding.count) + " صورتحساب پرداخت‌نشده"} tone={f.outstanding.count ? "down" : ""} />
            <StatCard icon="user-plus" label="مشتری جدید" value={f.totals.newCustomers} sub={"بازگشت وجه " + mil(f.totals.refunds) + " میلیون"} />
          </div>
          <Card title="فروش ماهانه (میلیون تومان، با مالیات)" icon="chart-column">
            {f.months.length > 6 ? <AreaChart data={f.months.map((m) => m.gross / 1e6)} labels={f.months.map((m) => m.month)} fmt={(v) => fa(Math.round(v * 10) / 10, 1)} unit="میلیون تومان" />
              : <Bars data={f.months.map((m) => Math.round(m.gross / 1e5) / 10)} labels={f.months.map((m) => m.month)} fmt={(v) => fa(v, 1)} />}
          </Card>
          <Card title="جزئیات ماهانه" icon="scroll-text" pad="p-0">
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="جدول جزئیات ماهانه">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="text-white/55 text-xs"><tr>{["ماه", "صورتحساب", "فروش خالص", "مالیات", "جمع", "بازگشت وجه", "پورسانت", "شارژ کیف پول", "پرداخت آنلاین", "مشتری جدید"].map((h) => <th key={h} scope="col" className="text-right font-medium p-3">{h}</th>)}</tr></thead>
                <tbody className="tabular">
                  {[...f.months].reverse().map((m) => (
                    <tr key={m.key} className="border-t border-white/[0.06]">
                      <th scope="row" className="text-right p-3 font-bold">{m.month}</th><td className="p-3">{fa(m.invoices)}</td><td className="p-3">{fa(m.net)}</td><td className="p-3">{fa(m.vat)}</td><td className="p-3 font-bold">{fa(m.gross)}</td>
                      <td className="p-3">{fa(m.refunds)}</td><td className="p-3">{fa(m.commissions)}</td><td className="p-3">{fa(m.topups)}</td><td className="p-3">{fa(m.online)}</td><td className="p-3">{fa(m.newCustomers)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="grid xl:grid-cols-3 gap-4">
            <Card title="ترکیب فروش" icon="layers">
              {f.categories.length === 0 ? <Empty icon="chart-column" title="فروشی در این بازه نیست" /> : (
                <ul className="space-y-3">{f.categories.map((c) => {
                  const max = Math.max(...f.categories.map((x) => Math.abs(x.amount))) || 1;
                  return <li key={c.name}><div className="flex justify-between text-sm"><span>{c.name}</span><span className="tabular text-white/70">{toman(c.amount)}</span></div>
                    <div className="h-1.5 rounded-full bg-white/[0.06] mt-1.5"><div className={"h-full rounded-full " + (c.amount < 0 ? "bg-rose-400/70" : "bg-sky-300/70")} style={{ width: (Math.abs(c.amount) / max) * 100 + "%" }} /></div></li>;
                })}</ul>
              )}
            </Card>
            <Card title="مشتریان برتر" icon="star" pad="p-3 sm:p-4">
              {f.topCustomers.length === 0 ? <Empty icon="users" title="—" /> : <ol className="space-y-1">{f.topCustomers.map((c, i) => (
                <li key={c.id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-white/[0.03]"><span className="min-w-0 text-sm"><span className="text-white/45 ml-2 tabular">{fa(i + 1)}</span>{c.name}</span><span className="text-xs tabular text-white/70 shrink-0">{mil(c.amount)} م</span></li>
              ))}</ol>}
            </Card>
            <Card title="درگاه‌های پرداخت" icon="wallet" pad="p-3 sm:p-4">
              {f.gateways.length === 0 ? <Empty icon="wallet" title="پرداخت آنلاینی ثبت نشده" /> : <ul className="space-y-1">{f.gateways.map((g) => (
                <li key={g.name} className="flex items-center justify-between p-2 text-sm"><span>{g.name} <span className="text-white/45 text-xs">({fa(g.count)})</span></span><span className="tabular">{toman(g.amount)}</span></li>
              ))}</ul>}
            </Card>
          </div>
          <Card title={"پشتیبانی در " + fa(s.days) + " روز اخیر"} icon="headset" pad="p-0"
            action={<div className="flex gap-2"><Badge tone={s.slaRate >= 90 ? "green" : s.slaRate >= 75 ? "amber" : "red"}>{fa(s.slaRate, 1)}٪ در زمان هدف</Badge>{s.overdueNow.length > 0 && <Badge tone="red">{fa(s.overdueNow.length)} تیکت عقب‌افتاده</Badge>}</div>}>
            {s.agents.length === 0 ? <div className="p-6"><Empty icon="message-circle" title="پاسخی در این بازه ثبت نشده" /></div> : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="جدول عملکرد کارشناسان">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="text-white/55 text-xs"><tr>{["کارشناس", "پاسخ‌ها", "تیکت‌ها", "اولین پاسخ", "میانگین اولین پاسخ", "در زمان هدف"].map((h) => <th key={h} scope="col" className="text-right font-medium p-3">{h}</th>)}</tr></thead>
                  <tbody className="tabular">{s.agents.map((a) => (
                    <tr key={a.agent} className="border-t border-white/[0.06]">
                      <th scope="row" className="text-right p-3 font-bold">{a.agent}</th><td className="p-3">{fa(a.replies)}</td><td className="p-3">{fa(a.tickets)}</td><td className="p-3">{fa(a.firstResponses)}</td>
                      <td className="p-3">{a.firstResponses ? dur(a.avgFirstMin) : "—"}</td><td className="p-3">{a.firstResponses ? fa(Math.round((a.withinSla / a.firstResponses) * 100)) + "٪" : "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
