"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BTN_G, BTN_P } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { api, byId, setScope, useDB, useMyId, useSession } from "@/lib/store";
import { useApp } from "../app-context";
import { VirguleLink, VirguleMark, Wordmark } from "../brand";
import { Icon } from "../icon";
import { Badge, Empty } from "../ui";
import { Menu } from "../ui-client";

const USER_NAV = [
  { href: "/panel", label: "داشبورد", icon: "layout-dashboard" },
  { href: "/panel/servers", label: "سرورهای ابری", icon: "server" },
  { href: "/panel/hosting", label: "هاست‌ها", icon: "layers" },
  { href: "/panel/domains", label: "دامنه‌ها", icon: "globe" },
  { href: "/panel/billing", label: "صورتحساب و کیف پول", icon: "wallet" },
  { href: "/panel/tickets", label: "تیکت‌ها", icon: "message-circle" },
  { href: "/panel/keys", label: "SSH و API", icon: "key-round" },
  { href: "/panel/account", label: "تنظیمات حساب", icon: "settings-2" },
];
const ADMIN_NAV = [
  { href: "/admin", label: "داشبورد", icon: "layout-dashboard" },
  { href: "/admin/users", label: "کاربران", icon: "users" },
  { href: "/admin/services", label: "سرویس‌ها", icon: "server" },
  { href: "/admin/billing", label: "مالی", icon: "receipt" },
  { href: "/admin/tickets", label: "تیکت‌ها", icon: "message-circle" },
  { href: "/admin/products", label: "محصولات و قیمت", icon: "tag" },
  { href: "/admin/infra", label: "زیرساخت", icon: "radio-tower" },
  { href: "/admin/virtualizor", label: "اتصال Virtualizor", icon: "network" },
  { href: "/admin/coupons", label: "کدهای تخفیف", icon: "badge-percent" },
  { href: "/admin/announcements", label: "اطلاعیه‌ها", icon: "megaphone" },
  { href: "/admin/audit", label: "گزارش فعالیت", icon: "scroll-text" },
  { href: "/admin/settings", label: "تنظیمات سیستم", icon: "settings-2" },
];

/** Guards: /panel/* needs a session, /admin/* needs role=admin. */
export function PanelGate({ kind, children }: { kind: "user" | "admin"; children: React.ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => { if (session === null) router.replace(("/auth?next=" + encodeURIComponent(path)) as never); }, [session, path, router]);
  useEffect(() => setScope(kind === "admin" ? "admin" : "customer"), [kind]);
  if (!session) return <div className="min-h-screen grid place-items-center" aria-busy="true"><Icon name="loader-circle" size={28} className="animate-spin text-white/50" /><span className="sr-only-focusable">در حال بارگذاری</span></div>;
  if (kind === "admin" && session.role !== "admin") return (
    <main id="main" className="max-w-lg mx-auto px-4 py-28 text-center">
      <Empty icon="lock" title="دسترسی به پنل مدیریت ندارید" text="با حساب مدیر وارد شوید." action={<Link href="/panel" className={BTN_P + " px-5 h-10 text-sm"}>رفتن به پنل کاربری</Link>} />
    </main>
  );
  return <PanelShell kind={kind}>{children}</PanelShell>;
}

function PanelShell({ kind, children }: { kind: "user" | "admin"; children: React.ReactNode }) {
  const db = useDB();
  const myId = useMyId();
  const session = useSession();
  const path = usePathname();
  const router = useRouter();
  const { notify, openPalette } = useApp();
  const [mobile, setMobile] = useState(false);
  const nav = kind === "admin" ? ADMIN_NAV : USER_NAV;
  const active = nav.slice().sort((a, b) => b.href.length - a.href.length).find((n) => path === n.href || path.startsWith(n.href + "/")) || nav[0];
  const user = byId(db.users, myId)!;
  const me = kind === "admin" ? { name: session?.name || "مدیر سیستم" } : user;
  const unread = db.notifications.filter((n) => !n.read).length;
  const badges: Record<string, number> = kind === "admin"
    ? { "/admin/tickets": db.tickets.filter((t) => t.status === "open" || t.status === "customer-reply").length }
    : { "/panel/billing": db.invoices.filter((i) => i.userId === myId && (i.status === "unpaid" || i.status === "overdue")).length, "/panel/tickets": db.tickets.filter((t) => t.userId === myId && t.status === "answered").length };
  const logout = async () => { await api.auth.logout(); notify("از حساب خارج شدید", "log-out"); router.push("/"); };
  const [navPath, setNavPath] = useState(path);
  if (navPath !== path) { setNavPath(path); setMobile(false); }

  const Side = (
    <div className="flex flex-col h-full">
      <div className="h-16 px-5 flex items-center justify-between border-b border-white/[0.07]">
        <Link href="/" aria-label="گره، بازگشت به سایت"><Wordmark size={30} sub={false} /></Link>
        <Badge tone={kind === "admin" ? "violet" : "blue"}>{kind === "admin" ? "مدیریت" : "کاربری"}</Badge>
      </div>
      <nav aria-label={kind === "admin" ? "منوی مدیریت" : "منوی پنل"} className="flex-1 overflow-auto p-3 space-y-0.5">
        {nav.map((n) => (
          <Link key={n.href} href={n.href as never} aria-current={active.href === n.href ? "page" : undefined}
            className={"w-full flex items-center gap-3 px-3 h-11 rounded-xl text-sm text-right transition " + (active.href === n.href ? "bg-white/[0.09] text-white font-bold shadow-[inset_0_1px_0_rgba(255,255,255,.08)]" : "text-white/55 hover:text-white hover:bg-white/[0.04]")}>
            <Icon name={n.icon} size={18} className={active.href === n.href ? "acc" : ""} />
            <span className="flex-1">{n.label}</span>
            {badges[n.href] > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full acc-bg text-[10px] font-black grid place-items-center" aria-label={fa(badges[n.href]) + " مورد"}>{fa(badges[n.href])}</span>}
          </Link>
        ))}
      </nav>
      {kind === "user" && (
        <div className="mx-3 mb-3 rounded-2xl p-4 bg-white/[0.04] border border-white/[0.08]">
          <div className="text-[11px] text-white/55">موجودی کیف پول</div>
          <div className="font-black mt-1 tabular">{toman(user.balance)}</div>
          <Link href="/panel/billing?tab=wallet" className="text-xs acc mt-2 flex items-center gap-1 hover:gap-2 transition-all">شارژ کیف پول <Icon name="chevron-left" size={13} /></Link>
        </div>
      )}
      <div className="px-5 py-4 border-t border-white/[0.07] text-[11px] text-white/50 flex items-center gap-2">
        <VirguleMark size={16} /> قدرت‌گرفته از <VirguleLink className="text-white/60 text-[11px]" />
      </div>
    </div>
  );

  return (
    <div className="relative z-10 min-h-screen flex">
      <aside className="hidden lg:block w-[264px] shrink-0 fixed inset-y-0 right-0 bg-[#06070e]/70 backdrop-blur-2xl border-l border-white/[0.07]" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>{Side}</aside>
      {mobile && (
        <div className="lg:hidden fixed inset-0 z-[70] fade-in">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobile(false)} />
          <aside className="drawer-in-r absolute inset-y-0 right-0 w-[280px] bg-[#06070e]/95 backdrop-blur-2xl border-l border-white/10" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>{Side}</aside>
        </div>
      )}
      <div className="flex-1 lg:mr-[264px] min-w-0">
        <header className="sticky z-30 h-16 px-4 sm:px-8 flex items-center justify-between gap-3 bg-[#04050b]/70 backdrop-blur-2xl border-b border-white/[0.07]" style={{ top: "env(safe-area-inset-top, 0px)" }}>
          <div className="flex items-center gap-2">
            <button type="button" className="lg:hidden w-10 h-10 grid place-items-center rounded-xl bg-white/[0.05] border border-white/10" onClick={() => setMobile(true)} aria-label="منو" aria-expanded={mobile}><Icon name="menu" size={19} /></button>
            <button type="button" onClick={openPalette} className="hidden sm:flex items-center gap-2 h-10 px-3 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white/55 hover:text-white text-sm w-64">
              <Icon name="search" size={16} /> جست‌وجو در پنل <kbd className="mr-auto ltr text-[10px] px-1.5 py-0.5 rounded bg-white/10">Ctrl K</kbd>
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {session?.role === "admin" && <Link href={kind === "admin" ? "/panel" : "/admin"} className={BTN_G + " h-10 px-3 text-xs hidden sm:inline-flex"}><Icon name="arrow-left-right" size={15} />{kind === "admin" ? "نمای کاربر" : "نمای مدیریت"}</Link>}
            <Menu label={"اعلان‌ها" + (unread ? "، " + fa(unread) + " خوانده‌نشده" : "")} triggerClass="relative w-10 h-10 grid place-items-center rounded-xl hover:bg-white/[0.06]"
              trigger={<><Icon name="bell" size={19} />{unread > 0 && <span className="absolute top-2 left-2 w-2 h-2 rounded-full bg-[#9cc9ff]" />}</>}
              items={[...db.notifications.map((n) => ({ icon: n.icon, label: n.text + (n.read ? "" : "  •"), run: () => api.account.readOne(n.id) })), "-", { icon: "check", label: "علامت‌گذاری همه به‌عنوان خوانده‌شده", run: () => api.account.readAll() }]} />
            <Menu label="حساب" triggerClass="flex items-center gap-2.5 h-10 pr-1 pl-3 rounded-xl hover:bg-white/[0.06]"
              trigger={<><span className="w-8 h-8 rounded-lg tile grid place-items-center text-sm font-black">{me.name[0]}</span><span className="hidden sm:block text-sm">{me.name}</span><Icon name="chevron-down" size={14} className="text-white/55" /></>}
              items={[
                kind === "user" && { icon: "settings-2", label: "تنظیمات حساب", run: () => router.push("/panel/account") },
                { icon: "house", label: "بازگشت به سایت", run: () => router.push("/") },
                "-",
                { icon: "log-out", label: "خروج از حساب", danger: true, run: logout },
              ]} />
          </div>
        </header>
        {kind === "user" && session?.role === "admin" && session.actorId && session.userId !== session.actorId && (
          <div role="status" className="mx-4 sm:mx-8 mt-4 rounded-xl border border-amber-300/30 bg-amber-400/[0.08] px-4 py-3 text-sm text-amber-100 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2"><Icon name="eye" size={16} />در حال مشاهده پنل <b>{user.name}</b> به‌عنوان مدیر؛ همه اقدامات در گزارش فعالیت ثبت می‌شود.</span>
            <button type="button" onClick={async () => { await api.admin.stopImpersonate(); notify("به حساب مدیر برگشتید", "shield-half"); router.push("/admin/users"); }} className={BTN_G + " px-3 h-8 text-xs"}>پایان و بازگشت به مدیریت</button>
          </div>
        )}
        <main id="main" key={path} className="fade-page p-4 sm:p-8 max-w-[1400px]">{children}</main>
      </div>
    </div>
  );
}
