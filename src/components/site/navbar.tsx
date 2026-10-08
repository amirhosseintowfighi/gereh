"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BTN_P } from "@/lib/cls";
import { fa } from "@/lib/format";
import { api, useSession } from "@/lib/store";
import { useApp } from "../app-context";
import { Wordmark } from "../brand";
import { Icon } from "../icon";
import { PRODUCTS } from "../providers";
import { Menu } from "../ui-client";

/** links shown in the bar itself (the rest live in the products menu) */
const BAR = [
  { href: "/paas", label: "گره اپ" },
  { href: "/geo-dns", label: "Geo DNS" },
  { href: "/inquiry", label: "API استعلام" },
  { href: "/devops", label: "دواپس", wide: true },
];

export function Navbar() {
  const path = usePathname();
  const router = useRouter();
  const { cart, openCart, openPalette, notify } = useApp();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [mega, setMega] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const megaRef = useRef<HTMLDivElement>(null);
  const productActive = PRODUCTS.some((g) => g.items.some((i) => !BAR.some((b) => b.href === i.href) && path.startsWith(i.href.split("#")[0]) && i.href !== "/"));

  useEffect(() => {
    const onS = () => setScrolled(window.scrollY > 12);
    onS();
    window.addEventListener("scroll", onS, { passive: true });
    return () => window.removeEventListener("scroll", onS);
  }, []);
  useEffect(() => {
    if (!mega) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !megaRef.current?.contains(e.target as Node)) setMega(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [mega]);
  const [navPath, setNavPath] = useState(path);
  if (navPath !== path) { setNavPath(path); setOpen(false); setMega(false); }
  const linkCls = (on: boolean) => "relative px-3 xl:px-4 h-10 grid place-items-center rounded-xl text-sm transition-colors whitespace-nowrap " + (on ? "text-white font-bold bg-white/[0.08]" : "text-white/65 hover:text-white hover:bg-white/[0.05]");

  return (
    <header className="sticky z-40 px-3 sm:px-6 pt-3" style={{ top: "env(safe-area-inset-top, 0px)" }}>
      <nav aria-label="منوی اصلی" className={"relative mx-auto max-w-6xl rounded-2xl pl-2 pr-3 sm:pr-4 h-16 flex items-center justify-between gap-2 backdrop-blur-xl border transition-all duration-500 " +
        (scrolled ? "bg-[#05060d]/80 border-white/[0.12] shadow-2xl shadow-black/60" : "bg-white/[0.04] border-white/[0.1]")}>
        <Link href="/" aria-label="گره، صفحه اصلی" className="shrink-0"><Wordmark size={34} sub={false} /></Link>

        <div ref={megaRef} className="hidden lg:flex items-center gap-0.5">
          <button type="button" onClick={() => setMega((m) => !m)} aria-expanded={mega} aria-controls="products-menu" className={linkCls(productActive || mega) + " !flex items-center gap-1"}>
            محصولات <Icon name="chevron-down" size={14} className={"transition " + (mega ? "rotate-180" : "")} />
          </button>
          {BAR.map((b) => (
            <Link key={b.href} href={b.href as never} aria-current={path.startsWith(b.href) ? "page" : undefined} className={linkCls(path.startsWith(b.href)) + (b.wide ? " hidden xl:grid" : "")}>{b.label}</Link>
          ))}
          {mega && (
            <div id="products-menu" className="pop-in absolute top-[calc(100%+8px)] inset-x-0 rounded-2xl p-3 bg-[#070912]/95 backdrop-blur-2xl border border-white/[0.12] shadow-2xl shadow-black/60 grid grid-cols-3 gap-2">
              {PRODUCTS.map((g) => (
                <div key={g.group}>
                  <p className="px-3 pt-2 pb-1.5 text-[11px] font-bold text-white/45">{g.group}</p>
                  <ul>{g.items.map((i) => (
                    <li key={i.href}><Link href={i.href as never} className="flex gap-3 rounded-xl p-3 hover:bg-white/[0.06] transition">
                      <span className="w-10 h-10 rounded-xl grid place-items-center bg-white/[0.06] border border-white/[0.1] shrink-0"><Icon name={i.icon} size={18} className="acc" /></span>
                      <span className="min-w-0"><b className="text-sm flex items-center gap-2">{i.label}{i.badge && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-400/15 text-emerald-300 font-bold">{i.badge}</span>}</b><span className="block text-xs text-white/55 mt-0.5 leading-5">{i.desc}</span></span>
                    </Link></li>
                  ))}</ul>
                </div>
              ))}
              <div className="col-span-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] mt-1 pt-3 px-3 text-xs text-white/55">
                <span>همه سرویس‌ها با یک حساب، یک کیف پول و فاکتور رسمی</span>
                <span className="flex gap-4"><Link href="/docs/api" className="hover:text-white">مستندات API</Link><Link href="/status" className="hover:text-white">وضعیت سرویس‌ها</Link><Link href="/contact" className="hover:text-white">تماس با فروش</Link></span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <Link href="/en" hrefLang="en" lang="en" aria-label="English version" className="hidden xl:grid h-10 px-3 place-items-center rounded-xl bg-white/[0.07] border border-white/15 text-white/60 hover:text-white hover:bg-white/15 transition text-xs font-bold">EN</Link>
          <button type="button" onClick={openPalette} aria-keyshortcuts="Control+K"
            className="hidden xl:flex items-center gap-2 h-10 pr-3 pl-2 rounded-xl bg-white/[0.07] border border-white/15 text-white/60 hover:text-white hover:bg-white/15 transition text-sm">
            <Icon name="search" size={16} /> جست‌وجو
            <kbd className="ltr text-[10px] px-1.5 py-0.5 rounded-md bg-white/10 border border-white/15 text-white/70">Ctrl K</kbd>
          </button>
          <button type="button" onClick={openPalette} className="xl:hidden w-10 h-10 grid place-items-center rounded-xl bg-white/10 border border-white/20" aria-label="جست‌وجو"><Icon name="search" size={18} /></button>

          <button type="button" onClick={openCart} aria-label={"سبد خرید" + (cart.length ? "، " + fa(cart.length) + " مورد" : "")}
            className="relative w-10 h-10 grid place-items-center rounded-xl bg-white/10 border border-white/20 hover:bg-white/[0.18] transition">
            <Icon name="shopping-cart" size={18} />
            {cart.length > 0 && <span key={cart.length} className="pop-in absolute -top-1.5 -left-1.5 min-w-[20px] h-5 px-1 rounded-full acc-bg text-[11px] font-black grid place-items-center">{fa(cart.length)}</span>}
          </button>
          {session ? (
            <Menu label="حساب کاربری" triggerClass="hidden sm:flex items-center gap-2 h-10 pr-1 pl-3 rounded-xl bg-white/[0.06] border border-white/[0.12] hover:bg-white/[0.1]"
              trigger={<><span className="w-8 h-8 rounded-lg tile grid place-items-center text-sm font-black">{session.name[0]}</span><span className="text-sm max-w-[7rem] truncate">{session.name.split(" ")[0]}</span></>}
              items={[
                { icon: "layout-dashboard", label: "پنل کاربری", run: () => router.push("/panel") },
                session.role === "admin" && { icon: "shield-half", label: "پنل مدیریت", run: () => router.push("/admin") },
                "-",
                { icon: "log-out", label: "خروج", danger: true, run: async () => { await api.auth.logout(); notify("از حساب خارج شدید", "log-out"); } },
              ]} />
          ) : (
            <Link href="/auth" className={BTN_P + " max-sm:hidden px-4 h-10 text-sm"}><Icon name="log-in" size={16} /> ورود</Link>
          )}
          <button type="button" className="lg:hidden w-10 h-10 grid place-items-center rounded-xl bg-white/10 border border-white/20" onClick={() => setOpen((o) => !o)} aria-label="منو" aria-expanded={open} aria-controls="mobile-nav">
            <Icon name={open ? "x" : "menu"} size={20} />
          </button>
        </div>
      </nav>
      {open && (
        <div id="mobile-nav" className="pop-in lg:hidden mx-auto max-w-6xl mt-2 rounded-2xl p-2 bg-[#05060d]/95 backdrop-blur-xl border border-white/[0.12] max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain">
          {PRODUCTS.map((g) => (
            <div key={g.group} className="mb-1">
              <p className="px-4 pt-3 pb-1 text-[11px] font-bold text-white/45">{g.group}</p>
              {g.items.map((i) => (
                <Link key={i.href} href={i.href as never} aria-current={path === i.href ? "page" : undefined}
                  className={"w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-right " + (path === i.href ? "bg-white/15 font-bold" : "hover:bg-white/10 text-white/85")}>
                  <Icon name={i.icon} size={18} className="acc shrink-0" />
                  <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm">{i.label}{i.badge && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-400/15 text-emerald-300 font-bold">{i.badge}</span>}</span><span className="block text-[11px] text-white/50 truncate">{i.desc}</span></span>
                </Link>
              ))}
            </div>
          ))}
          <div className="h-px bg-white/10 my-2" />
          <div className="grid grid-cols-2 gap-1">
            {[["/blog", "بلاگ", "newspaper"], ["/kb", "راهنما", "book-open"], ["/about", "درباره ما", "building-2"], ["/contact", "تماس", "message-circle"]].map(([h, l, ic]) => (
              <Link key={h} href={h as never} className="flex items-center gap-2.5 px-4 py-3 rounded-xl hover:bg-white/10 text-sm text-white/80"><Icon name={ic} size={17} className="acc" />{l}</Link>
            ))}
          </div>
          <div className="h-px bg-white/10 my-2" />
          {session
            ? <Link href="/panel" className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10"><Icon name="layout-dashboard" size={18} className="acc" /> پنل کاربری</Link>
            : <Link href="/auth" className={BTN_P + " w-full h-11"}><Icon name="log-in" size={18} /> ورود / ثبت‌نام</Link>}
          <Link href="/en" hrefLang="en" lang="en" className="block text-center text-xs text-white/50 py-3 hover:text-white">English</Link>
        </div>
      )}
    </header>
  );
}

/** scroll progress + back-to-top */
export function ScrollChrome() {
  const bar = useRef<HTMLDivElement>(null);
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - innerHeight;
      if (bar.current) bar.current.style.transform = "scaleX(" + (h > 0 ? scrollY / h : 0) + ")";
      setShowTop(scrollY > 700);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <>
      <div aria-hidden="true" className="fixed inset-x-0 h-[2px] z-50 origin-right acc-bg" ref={bar} style={{ transform: "scaleX(0)", top: "env(safe-area-inset-top, 0px)" }} />
      {showTop && (
        <button type="button" onClick={() => window.scrollTo({ top: 0 })} aria-label="بازگشت به بالا"
          className="bg-white/[0.08] backdrop-blur-2xl border border-white/[0.14] pop-in fixed left-4 sm:left-6 z-40 w-12 h-12 rounded-2xl grid place-items-center hover:bg-white/20 shadow-xl"
          style={{ bottom: "calc(20px + env(safe-area-inset-bottom, 0px))" }}>
          <Icon name="chevron-down" size={20} className="rotate-180" />
        </button>
      )}
    </>
  );
}
