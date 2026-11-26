"use client";
/* «نمای ساده»: the customer panel for people who are not technical — a few cards in plain words (my site, payments,
   support, renewals) and a short menu. The full panel stays one click away. The choice is saved per person
   (users.panel_view); with no choice yet, an account that runs no servers, apps or databases starts simple. */
import Link from "next/link";
import { BIZ_PACKAGES } from "@/lib/business";
import { BTN_G, BTN_MD, BTN_P } from "@/lib/cls";
import { fa, nowFa, toman } from "@/lib/format";
import { api, byId, invGross, useDB, useMyId, useSession } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card } from "../ui";
import { PageTitle } from "../ui-client";
import { UserDashboard } from "./user";

export type PanelView = "simple" | "full";

export function usePanelView(): PanelView {
  const session = useSession();
  const db = useDB();
  if (session?.panelView) return session.panelView;
  const myId = session?.userId;
  // until the account's records have loaded (right after signing in) nothing is known yet: keep the full view
  if (!db.users.some((u) => u.id === myId)) return "full";
  const technical = db.servers.some((s) => s.userId === myId) || db.paasApps.some((a) => a.userId === myId) || db.paasDbs.length > 0;
  return technical ? "full" : "simple";
}

/** the short menu of the simple view (same item shape as the full one) */
export const SIMPLE_NAV: { href: string; label: string; icon: string; group?: string; tag?: string }[] = [
  { href: "/panel", label: "خانه", icon: "house" },
  { href: "/panel/build", label: "ساخت سایت با هوش مصنوعی", icon: "sparkles" },
  { href: "/panel/devops", label: "پروژه‌های من", icon: "hammer" },
  { href: "/panel/domains", label: "دامنه‌ها", icon: "globe" },
  { href: "/panel/billing", label: "پرداخت‌ها", icon: "wallet" },
  { href: "/panel/tickets", label: "پشتیبانی", icon: "headset" },
  { href: "/panel/account", label: "تنظیمات حساب", icon: "settings-2" },
];

/** switches between the simple and the full panel (saved on the account) */
export function PanelViewToggle({ className = "" }: { className?: string }) {
  const view = usePanelView();
  const { notify } = useApp();
  const next: PanelView = view === "simple" ? "full" : "simple";
  return (
    <button type="button" className={className} onClick={async () => { await api.account.setPanelView(next); notify(next === "simple" ? "نمای ساده روشن شد" : "نمای کامل روشن شد", next === "simple" ? "eye" : "sliders-horizontal"); }}>
      <Icon name={next === "simple" ? "eye" : "sliders-horizontal"} size={16} />
      {next === "simple" ? "نمای ساده" : "نمای کامل (برای کاربران فنی)"}
    </button>
  );
}

/** /panel: the simple dashboard or the full one */
export function Dashboard() {
  const view = usePanelView();
  const db = useDB(); const myId = useMyId();
  if (!byId(db.users, myId)) return <div className="py-24 grid place-items-center" aria-busy="true"><Icon name="loader-circle" size={26} className="animate-spin text-white/50" /><span className="sr-only">در حال بارگذاری</span></div>;
  return view === "simple" ? <SimpleDashboard /> : <UserDashboard />;
}

const OFF = ["suspended", "expired", "terminated", "cancelled"];
const big = "spot rounded-[1.5rem] p-5 sm:p-6 flex flex-col gap-3 bg-white/[0.04] border border-white/[0.1] hover:border-white/25 transition min-h-44";

function SimpleDashboard() {
  const db = useDB(); const myId = useMyId();
  const me = byId(db.users, myId)!;
  const unpaid = db.invoices.filter((i) => i.userId === myId && (i.status === "unpaid" || i.status === "overdue"));
  const due = unpaid.reduce((s, i) => s + invGross(i, db.settings.tax), 0);
  const openT = db.tickets.filter((t) => t.userId === myId && t.status !== "closed");
  const answered = openT.filter((t) => t.status === "answered").length;
  const sites = [...db.hosting.filter((h) => h.userId === myId).map((h) => ({ id: h.id, name: h.domain, href: "/panel/hosting/" + h.id, on: !OFF.includes(h.status), expires: h.expires, auto: h.autoRenew })),
    ...db.domains.filter((d) => d.userId === myId).map((d) => ({ id: d.id, name: d.name, href: "/panel/domains/" + d.id, on: !OFF.includes(d.status), expires: d.expires, auto: d.autoRenew }))];
  // a hosted domain is listed once (hosting and domain rows share the name)
  const names = [...new Set(sites.map((s) => s.name))];
  const projects = db.devopsProjects.filter((p) => p.userId === myId && p.status !== "done");
  // Jalali dates as yyyy/mm/dd sort as strings: the nearest renewal first
  const renewals = sites.filter((s) => s.expires).sort((a, b) => a.expires.localeCompare(b.expires)).slice(0, 3);

  return (
    <div>
      <PageTitle title={"سلام، " + me.name.split(" ")[0]} sub={"امروز " + nowFa() + (unpaid.length ? "؛ یک پرداخت منتظر شماست." : "؛ همه چیز مرتب است.")} />

      {projects.length > 0 && (
        <Card title="در حال ساخت" icon="hammer" className="mb-4" action={<Link href="/panel/devops" className="text-xs text-white/50 hover:text-white">جزئیات</Link>}>
          <ul className="space-y-4">
            {projects.map((p) => {
              const done = p.milestones.filter((m) => m.done).length;
              const pct = p.milestones.length ? Math.round((done / p.milestones.length) * 100) : 0;
              return (
                <li key={p.id}>
                  <div className="flex items-center justify-between gap-3 text-sm"><span className="font-bold">{p.title}</span><span className="text-white/55 text-xs">{p.milestones.length ? fa(done) + " از " + fa(p.milestones.length) + " مرحله" : p.status === "planning" ? "در حال برنامه‌ریزی" : "در حال انجام"}</span></div>
                  <div className="mt-2 h-2 rounded-full bg-white/[0.08] overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={"پیشرفت " + p.title}><div className="h-full acc-bg" style={{ width: pct + "%" }} /></div>
                  {p.updates[0] && <p className="text-xs text-white/55 mt-2 leading-6">آخرین خبر: {p.updates[0].text}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <Link href={(sites.length ? sites[0].href : "/business") as never} className={big}>
          <span className="flex items-center justify-between"><Icon name="store" size={26} className="acc" />{sites.length > 0 && <Badge tone={sites.every((s) => s.on) ? "green" : "amber"} dot>{sites.every((s) => s.on) ? "فعال" : "نیاز به توجه"}</Badge>}</span>
          <span className="text-lg font-black">سایت من</span>
          <span className="text-sm text-white/60 leading-7 flex-1">{sites.length ? names.join("، ") : "هنوز سایتی ندارید. یک بسته انتخاب کنید تا برایتان بسازیم، یا خودتان با هوش مصنوعی بسازید."}</span>
          <span className="text-xs font-bold acc inline-flex items-center gap-1">{sites.length ? "مدیریت سایت" : "بسته‌ها، از ماهی " + toman(Math.min(...BIZ_PACKAGES.filter((p) => !p.quote).map((p) => p.monthly)))}<Icon name="chevron-left" size={14} /></span>
        </Link>
        <Link href="/panel/billing" className={big + (unpaid.length ? " !border-amber-300/40" : "")}>
          <Icon name="wallet" size={26} className="acc" />
          <span className="text-lg font-black">پرداخت‌ها</span>
          <span className="text-sm text-white/60 leading-7 flex-1">{unpaid.length ? fa(unpaid.length) + " صورتحساب پرداخت‌نشده به مبلغ " + toman(due) : "صورتحساب پرداخت‌نشده‌ای ندارید."}؛ موجودی کیف پول: {toman(me.balance)}</span>
          <span className="text-xs font-bold acc inline-flex items-center gap-1">{unpaid.length ? "پرداخت" : "دیدن صورتحساب‌ها"}<Icon name="chevron-left" size={14} /></span>
        </Link>
        <Link href={(openT.length ? "/panel/tickets" : "/panel/tickets?new=1") as never} className={big}>
          <span className="flex items-center justify-between"><Icon name="headset" size={26} className="acc" />{answered > 0 && <Badge tone="blue" dot>{fa(answered)} پاسخ تازه</Badge>}</span>
          <span className="text-lg font-black">پیام به پشتیبانی</span>
          <span className="text-sm text-white/60 leading-7 flex-1">{openT.length ? fa(openT.length) + " گفتگوی باز دارید." : "سؤال یا درخواستی دارید؟ بنویسید؛ یک نفر از تیم ما جواب می‌دهد."}</span>
          <span className="text-xs font-bold acc inline-flex items-center gap-1">{openT.length ? "دیدن گفتگوها" : "نوشتن پیام"}<Icon name="chevron-left" size={14} /></span>
        </Link>
        <div className={big + " hover:!border-white/[0.1]"}>
          <Icon name="calendar-check" size={26} className="acc" />
          <span className="text-lg font-black">تمدید</span>
          {renewals.length ? (
            <ul className="text-sm space-y-2 flex-1">
              {renewals.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3">
                  <Link href={s.href as never} className="ltr hover:underline underline-offset-4">{s.name}</Link>
                  <span className="text-xs text-white/55">{s.auto ? "تمدید خودکار در " : "تا "}{s.expires}</span>
                </li>
              ))}
            </ul>
          ) : <span className="text-sm text-white/60 leading-7 flex-1">چیزی برای تمدید ندارید. وقتی سایت یا دامنه داشته باشید، تاریخ تمدیدش این‌جا نمایش داده می‌شود.</span>}
        </div>
      </div>

      <div className="mt-8 rounded-2xl p-5 border border-dashed border-white/15 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-white/60 leading-7">سرور، هاست، اپ یا ابزارهای فنی دیگر را خودتان مدیریت می‌کنید؟</p>
        <span className="flex flex-wrap gap-2">
          <Link href="/business" className={BTN_P + BTN_MD}><Icon name="store" size={16} />بسته‌های کسب‌وکار</Link>
          <PanelViewToggle className={BTN_G + BTN_MD} />
        </span>
      </div>
    </div>
  );
}
