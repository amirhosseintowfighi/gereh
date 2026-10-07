import { JsonLd } from "@/components/json-ld";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/site/page-header";
import { GLASS } from "@/lib/cls";
import { faDateTime } from "@/lib/jalali";
import { breadcrumbLd, pageMeta } from "@/lib/seo";
import { INCIDENT_STATUS as STATUS_FA } from "@/lib/status";
import { db } from "@/server/ctx";
import { statusReport, type Health } from "@/server/status";

// rendered per request (cheap queries) so builds never need database access
export const dynamic = "force-dynamic";
export const metadata = pageMeta({ title: "وضعیت سرویس‌ها", description: "وضعیت لحظه‌ای سرور ابری، هاست، DNS، پنل و پرداخت گره در همه دیتاسنترها، همراه با تاریخچه رخدادها و آپتایم ۹۰ روز اخیر.", path: "/status" });

const LABEL: Record<Health, [string, string, string]> = {
  operational: ["همه سرویس‌ها عادی است", "عادی", "bg-emerald-400"],
  maintenance: ["نگهداری برنامه‌ریزی‌شده در جریان است", "نگهداری", "bg-sky-400"],
  degraded: ["بخشی از سرویس‌ها با اختلال روبه‌روست", "اختلال", "bg-amber-400"],
  outage: ["قطعی در بخشی از سرویس‌ها", "قطعی", "bg-rose-500"],
};

export default async function StatusPage() {
  const r = await statusReport(await db());
  const groups = [...new Set(r.components.map((c) => c.group))];
  return (
    <div className="fade-page pb-8">
      <JsonLd data={[breadcrumbLd([["وضعیت سرویس‌ها", "/status"]])]} />
      <PageHeader icon="activity" crumb="وضعیت سرویس‌ها" title="وضعیت سرویس‌ها" sub="به‌روزرسانی هر دقیقه؛ رخدادها هم به ایمیل مشترکان سرویس‌های درگیر ارسال می‌شود." />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-6">
        <div role="status" className={GLASS + " rounded-2xl p-5 flex items-center gap-4"}>
          <span className={"w-3.5 h-3.5 rounded-full " + LABEL[r.overall][2]} aria-hidden="true" />
          <span className="text-lg font-black">{LABEL[r.overall][0]}</span>
        </div>
        {groups.map((g) => (
          <section key={g} className={GLASS + " rounded-2xl p-2 sm:p-4"}>
            <h2 className="text-sm text-white/55 px-3 pt-2 pb-3">{g}</h2>
            <ul className="divide-y divide-white/[0.06]">
              {r.components.filter((c) => c.group === g).map((c) => (
                <li key={c.id} className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-sm">{c.label}</span>
                    <span className="flex items-center gap-2 text-xs"><span className={"w-2 h-2 rounded-full " + LABEL[c.health][2]} aria-hidden="true" />{LABEL[c.health][1]}<span className="text-white/60 tabular">{c.uptime.toLocaleString("fa-IR", { maximumFractionDigits: 3 })}٪</span></span>
                  </div>
                  <div className="mt-2 flex gap-[2px] h-6" role="img" aria-label={"آپتایم ۹۰ روز " + c.label + ": " + c.uptime.toFixed(3) + "٪"}>
                    {c.days.map((d, i) => <span key={i} className={"flex-1 rounded-[2px] " + (d === "operational" ? "bg-emerald-400/70" : LABEL[d][2])} />)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex justify-between text-[11px] text-white/60 px-3 pb-1"><span>۹۰ روز پیش</span><span>امروز</span></div>
          </section>
        ))}
        <section>
          <h2 className="text-xl font-black mb-4 flex items-center gap-2"><Icon name="scroll-text" size={20} className="acc" />تاریخچه رخدادها</h2>
          {r.incidents.length === 0 ? <p className="text-white/55 text-sm">در ۹۰ روز گذشته رخدادی ثبت نشده است.</p> : (
            <ol className="space-y-4">
              {r.incidents.map((i) => (
                <li key={i.id} className={GLASS + " rounded-2xl p-5"}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold">{i.title}</h3><span className="text-xs text-white/55">{faDateTime(i.createdAt)}</span></div>
                  <ol className="mt-3 space-y-2 border-r border-white/10 pr-4">
                    {i.updates.map((u) => <li key={u.id} className="text-sm leading-7"><b>{STATUS_FA[u.status] ?? u.status}</b> <span className="text-white/60 text-xs">— {faDateTime(u.createdAt)}</span><p className="text-white/70">{u.text}</p></li>)}
                  </ol>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
