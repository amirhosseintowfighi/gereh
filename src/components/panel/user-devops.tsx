"use client";
import Link from "next/link";
import { DEVOPS_SERVICES } from "@/content/devops";
import { BTN_G, BTN_P, GLASS_SOFT } from "@/lib/cls";
import { PLAN_FA, PROJECT_STATUS } from "@/lib/devops-labels";
import { fa, toman } from "@/lib/format";
import { useDB, useMyId } from "@/lib/store";
import { Icon } from "../icon";
import { Badge, Card, Meter } from "../ui";
import { PageTitle } from "../ui-client";

const svc = (slug: string) => DEVOPS_SERVICES.find((s) => s.slug === slug)?.title ?? slug;

/** customer: DevOps engagements with milestones, hours and progress reports */
export function UserDevops() {
  const db = useDB();
  const myId = useMyId();
  const projects = db.devopsProjects.filter((p) => p.userId === myId);
  if (!projects.length) return (
    <div>
      <PageTitle title="خدمات دواپس" sub="زیرساختتان را به تیم دواپس گره بسپارید." />
      <Card>
        <div className="py-6 text-center max-w-xl mx-auto">
          <span className="mx-auto w-14 h-14 rounded-2xl grid place-items-center bg-white/[0.08] border border-white/15 acc"><Icon name="rocket" size={26} /></span>
          <h2 className="text-xl font-black mt-5">تیم دواپس شما، بدون استخدام</h2>
          <p className="text-white/65 mt-3 leading-8">CI/CD، کوبرنتیز، مانیتورینگ، امنیت و پشتیبانی شبانه‌روزی؛ با قرارداد ماهانه بدون حداقل مدت یا پروژه با قیمت ثابت. مشتریان سرورهای گره ۱۰ درصد تخفیف می‌گیرند.</p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/devops#request" className={BTN_P + " h-11 px-5 text-sm"}><Icon name="message-circle" size={16} />جلسه آشنایی رایگان</Link>
            <Link href="/devops" className={BTN_G + " h-11 px-5 text-sm"}>خدمات و قیمت‌ها</Link>
          </div>
        </div>
      </Card>
    </div>
  );
  return (
    <div>
      <PageTitle title="خدمات دواپس" sub="پیشرفت پروژه‌ها، ساعت‌های مصرف‌شده و گزارش‌های تیم دواپس."
        action={<Link href="/panel/tickets" className={BTN_G + " h-10 px-4 text-sm"}><Icon name="message-circle" size={16} />تیکت به تیم دواپس</Link>} />
      <div className="space-y-4">
        {projects.map((p) => {
          const done = p.milestones.filter((m) => m.done).length;
          return (
            <Card key={p.id} title={<span className="flex flex-wrap items-center gap-2">{p.title}<Badge tone={PROJECT_STATUS[p.status][1]}>{PROJECT_STATUS[p.status][0]}</Badge></span>} icon="rocket">
              <div className="grid lg:grid-cols-[1fr_1.3fr] gap-6">
                <div className="space-y-5">
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {[["نوع همکاری", PLAN_FA[p.plan]], ["مهندس مسئول", p.engineer || "—"], ["شروع", p.started || "—"], ["صورتحساب بعدی", p.nextBill ? p.nextBill + " — " + toman(p.monthlyFee) : "—"]].map(([k, v]) => (
                      <div key={k} className={GLASS_SOFT + " rounded-xl p-3"}><dt className="text-[11px] text-white/55">{k}</dt><dd className="mt-1 font-bold">{v}</dd></div>
                    ))}
                  </dl>
                  {p.hoursIncluded > 0 && <Meter label="ساعت مهندسی این ماه" value={p.hoursUsed} max={p.hoursIncluded} right={fa(p.hoursUsed, 1) + " از " + fa(p.hoursIncluded) + " ساعت"} />}
                  {p.services.length > 0 && <div className="flex flex-wrap gap-1.5">{p.services.map((s) => <span key={s} className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.06]">{svc(s)}</span>)}</div>}
                  {p.milestones.length > 0 && (
                    <section aria-label="مراحل پروژه">
                      <div className="flex justify-between text-xs mb-2"><span className="text-white/55">پیشرفت مراحل</span><span className="text-white/80 tabular">{fa(done) + " از " + fa(p.milestones.length)}</span></div>
                      <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden" role="progressbar" aria-label="پیشرفت مراحل" aria-valuenow={done} aria-valuemin={0} aria-valuemax={p.milestones.length}><div className="h-full rounded-full bg-emerald-400/80" style={{ width: (done / p.milestones.length) * 100 + "%" }} /></div>
                      <ol className="mt-4 space-y-2">{p.milestones.map((m) => (
                        <li key={m.id} className="flex items-center gap-3 text-sm">
                          <Icon name={m.done ? "circle-check" : "clock"} size={17} className={m.done ? "text-emerald-300" : "text-white/40"} />
                          <span className={m.done ? "text-white/60 line-through decoration-white/30" : ""}>{m.title}</span>
                          {m.due && <span className="text-[11px] text-white/50 mr-auto">{m.due}</span>}
                          <span className="sr-only">{m.done ? "انجام شد" : "در جریان"}</span>
                        </li>
                      ))}</ol>
                    </section>
                  )}
                </div>
                <section aria-label="گزارش‌های پیشرفت">
                  <h3 className="font-extrabold mb-3 text-sm">گزارش‌های تیم</h3>
                  {p.updates.length === 0 ? <p className="text-sm text-white/55">هنوز گزارشی ثبت نشده است.</p> : (
                    <ol className="space-y-3 border-r border-white/10 pr-4">{p.updates.map((u, i) => (
                      <li key={i} className="text-sm leading-7"><span className="text-[11px] text-white/50 block">{u.by} · {u.at}</span><p className="whitespace-pre-wrap text-white/80">{u.text}</p></li>
                    ))}</ol>
                  )}
                </section>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
