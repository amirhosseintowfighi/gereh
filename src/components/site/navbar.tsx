"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BTN_P } from "@/lib/cls";
import { fa } from "@/lib/format";
import { api, useSession } from "@/lib/store";
import { useApp } from "../app-context";
import { Wordmark } from "../brand";
import { Icon } from "../icon";
import { PAGES } from "../providers";
import { Menu } from "../ui-client";

export function Navbar() {
  const path = usePathname();
  const router = useRouter();
  const { cart, openCart, openPalette, notify } = useApp();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const active = PAGES.find((p) => (p.href === "/" ? path === "/" : path.startsWith(p.href)))?.href;

  useLayoutEffect(() => {
    const measure = () => { const el = active ? refs.current[active] : null; setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null); };
    measure();
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);
  useEffect(() => {
    const onS = () => setScrolled(window.scrollY > 12);
    onS();
    window.addEventListener("scroll", onS, { passive: true });
    return () => window.removeEventListener("scroll", onS);
  }, []);
  useEffect(() => setOpen(false), [path]);

  return (
    <header className="sticky z-40 px-3 sm:px-6 pt-3" style={{ top: "env(safe-area-inset-top, 0px)" }}>
      <nav aria-label="منوی اصلی" className={"mx-auto max-w-6xl rounded-2xl pl-2 pr-3 sm:pr-4 h-16 flex items-center justify-between backdrop-blur-xl border transition-all duration-500 " +
        (scrolled ? "bg-[#05060d]/75 border-white/[0.12] shadow-2xl shadow-black/60" : "bg-white/[0.04] border-white/[0.1]")}>
        <Link href="/" aria-label="صفحه اصلی گره"><Wordmark size={34} /></Link>

        <div className="hidden lg:flex items-center relative h-16">
          {pill && <span className="nav-pill" style={{ left: pill.left, width: pill.width }} />}
          {PAGES.map((p) => (
            <Link key={p.href} href={p.href} ref={(el) => { refs.current[p.href] = el; }} aria-current={active === p.href ? "page" : undefined}
              className={"relative z-10 px-4 h-10 grid place-items-center rounded-xl text-sm transition-colors " + (active === p.href ? "text-white font-bold" : "text-white/65 hover:text-white")}>{p.label}</Link>
          ))}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button type="button" onClick={openPalette} aria-label="جست‌وجو و دسترسی سریع (Ctrl+K)"
            className="hidden md:flex items-center gap-2 h-10 pr-3 pl-2 rounded-xl bg-white/[0.07] border border-white/15 text-white/60 hover:text-white hover:bg-white/15 transition text-sm">
            <Icon name="search" size={16} /> جست‌وجو
            <kbd className="ltr text-[10px] px-1.5 py-0.5 rounded-md bg-white/10 border border-white/15 text-white/70">Ctrl K</kbd>
          </button>
          <button type="button" onClick={openPalette} className="md:hidden w-10 h-10 grid place-items-center rounded-xl bg-white/10 border border-white/20" aria-label="جست‌وجو"><Icon name="search" size={18} /></button>

          <button type="button" onClick={openCart} aria-label={"سبد خرید" + (cart.length ? "، " + fa(cart.length) + " مورد" : "")}
            className="relative w-10 h-10 grid place-items-center rounded-xl bg-white/10 border border-white/20 hover:bg-white/[0.18] transition">
            <Icon name="shopping-cart" size={18} />
            {cart.length > 0 && <span key={cart.length} className="pop-in absolute -top-1.5 -left-1.5 min-w-[20px] h-5 px-1 rounded-full acc-bg text-[11px] font-black grid place-items-center">{fa(cart.length)}</span>}
          </button>
          {session ? (
            <Menu label="حساب کاربری" triggerClass="hidden sm:flex items-center gap-2 h-10 pr-1 pl-3 rounded-xl bg-white/[0.06] border border-white/[0.12] hover:bg-white/[0.1]"
              trigger={<><span className="w-8 h-8 rounded-lg tile grid place-items-center text-sm font-black">{session.name[0]}</span><span className="text-sm">{session.name.split(" ")[0]}</span></>}
              items={[
                { icon: "layout-dashboard", label: "پنل کاربری", run: () => router.push("/panel") },
                session.role === "admin" && { icon: "shield-half", label: "پنل مدیریت", run: () => router.push("/admin") },
                "-",
                { icon: "log-out", label: "خروج", danger: true, run: async () => { await api.auth.logout(); notify("از حساب خارج شدید", "log-out"); } },
              ]} />
          ) : (
            <Link href="/auth" className={BTN_P + " hidden sm:inline-flex px-4 h-10 text-sm"}><Icon name="log-in" size={16} /> ورود</Link>
          )}
          <button type="button" className="lg:hidden w-10 h-10 grid place-items-center rounded-xl bg-white/10 border border-white/20" onClick={() => setOpen((o) => !o)} aria-label="منو" aria-expanded={open} aria-controls="mobile-nav">
            <Icon name={open ? "x" : "menu"} size={20} />
          </button>
        </div>
      </nav>
      {open && (
        <div id="mobile-nav" className="pop-in lg:hidden mx-auto max-w-6xl mt-2 rounded-2xl p-2 bg-[#05060d]/90 backdrop-blur-xl border border-white/[0.12]">
          {PAGES.map((p) => (
            <Link key={p.href} href={p.href} aria-current={active === p.href ? "page" : undefined}
              className={"w-full flex items-center gap-3 px-4 py-3 rounded-xl text-right " + (active === p.href ? "bg-white/15 font-bold" : "hover:bg-white/10 text-white/80")}>
              <Icon name={p.icon} size={18} className="acc" /> {p.label}
            </Link>
          ))}
          <div className="h-px bg-white/10 my-2" />
          {session
            ? <Link href="/panel" className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10"><Icon name="layout-dashboard" size={18} className="acc" /> پنل کاربری</Link>
            : <Link href="/auth" className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10"><Icon name="log-in" size={18} className="acc" /> ورود / ثبت‌نام</Link>}
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
