"use client";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { BTN_D, BTN_G, BTN_P } from "@/lib/cls";
import { setCart, useCart } from "@/lib/cart";
import { fa, roundK, toman } from "@/lib/format";
import { priceSku } from "@/lib/catalog";
import { couponDiscount, type CouponRule } from "@/lib/money";
import { api, useDB, useSession, type CartItem } from "@/lib/store";
import { AppCtx, type AppApi, type ConfirmOpts } from "./app-context";
import { Icon } from "./icon";
import { CheckDraw } from "./ui";
import { AsyncButton, Modal, Num, useDialog } from "./ui-client";

export const PAGES = [
  { href: "/", label: "خانه", icon: "house" },
  { href: "/vps", label: "سرور ابری", icon: "server" },
  { href: "/hosting", label: "هاست وب", icon: "layers" },
  { href: "/domains", label: "دامنه", icon: "globe" },
  { href: "/about", label: "درباره ما", icon: "building-2" },
  { href: "/contact", label: "تماس", icon: "message-circle" },
] as const;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const cart = useCart();
  const db = useDB();
  const [toast, setToast] = useState<{ msg: string; icon: string; k: number } | null>(null);
  const [palette, setPalette] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [ask, setAsk] = useState<{ text: string; opts: ConfirmOpts; resolve: (v: boolean) => void } | null>(null);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2800); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((o) => !o); } };
    // spotlight: one global listener drives every .spot card
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.(".spot") as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", e.clientX - r.left + "px");
      el.style.setProperty("--my", e.clientY - r.top + "px");
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("pointermove", onMove); };
  }, []);

  const notify = useCallback((msg: string, icon = "circle-check") => setToast({ msg, icon, k: Date.now() }), []);
  const ctx = useMemo<AppApi>(() => ({
    cart,
    notify,
    addToCart: (sku) => {
      const p = priceSku(sku, { plans: db.plans, tlds: db.tlds });
      if ("error" in p) { notify(p.error, "circle-alert"); return; }
      setCart((c) => [...c, { ...p, sku, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }]);
      notify(p.title + " به سبد اضافه شد", "shopping-cart");
    },
    searchDomain: (q) => router.push(("/domains?q=" + encodeURIComponent(q.trim())) as never),
    confirm: (text, opts = {}) => new Promise<boolean>((resolve) => setAsk({ text, opts, resolve })),
    openCart: () => setCartOpen(true),
    openPalette: () => setPalette(true),
  }), [cart, notify, router, db]);

  const answer = (v: boolean) => { ask?.resolve(v); setAsk(null); };

  return (
    <AppCtx.Provider value={ctx}>
      {children}
      {palette && <Palette onClose={() => setPalette(false)} onCart={() => setCartOpen(true)} />}
      {cartOpen && <CartDrawer cart={cart} onClose={() => setCartOpen(false)} />}
      <Modal open={!!ask} onClose={() => answer(false)} title={ask?.opts.title || "تأیید"} icon={ask?.opts.danger ? "circle-alert" : "circle-check"}
        footer={<>
          <button type="button" onClick={() => answer(false)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button>
          <button type="button" onClick={() => answer(true)} className={(ask?.opts.danger ? BTN_D : BTN_P) + " px-5 h-10 text-sm"}>{ask?.opts.ok || "تأیید"}</button>
        </>}>
        <p className="text-sm text-white/75 leading-7">{ask?.text}</p>
      </Modal>
      <div aria-live="polite" role="status" className="sr-only-focusable">{toast?.msg}</div>
      {toast && (
        <div key={toast.k} className="toast-in fixed left-1/2 z-[90] rounded-2xl px-5 py-3.5 text-sm flex items-center gap-3 shadow-2xl bg-[#0a0c14]/90 backdrop-blur-xl border border-white/[0.12] max-w-[92vw]"
          style={{ bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", transform: "translateX(-50%)" }}>
          <span className="w-8 h-8 rounded-xl acc-bg grid place-items-center shrink-0"><Icon name={toast.icon} size={16} className={toast.icon === "loader-circle" ? "animate-spin" : ""} /></span>{toast.msg}
        </div>
      )}
    </AppCtx.Provider>
  );
}

function Palette({ onClose, onCart }: { onClose: () => void; onCart: () => void }) {
  const router = useRouter();
  const session = useSession();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const ref = useDialog(true, onClose);
  type Item = { id: string; icon: string; label: string; group: string; run: () => void };
  const go = (h: string) => () => router.push(h as never);
  const base: Item[] = [
    ...PAGES.map((p) => ({ id: "p-" + p.href, icon: p.icon, label: "رفتن به " + p.label, group: "صفحات", run: go(p.href) })),
    { id: "a-build", icon: "sliders-horizontal", label: "ساخت سرور دلخواه", group: "اقدام سریع", run: go("/vps#builder") },
    { id: "a-net", icon: "activity", label: "وضعیت شبکه و تست سرعت", group: "اقدام سریع", run: go("/#network") },
    { id: "a-cart", icon: "shopping-cart", label: "باز کردن سبد خرید", group: "اقدام سریع", run: onCart },
    { id: "a-panel", icon: "layout-dashboard", label: "پنل کاربری", group: "حساب", run: go("/panel") },
    { id: "a-servers", icon: "server", label: "سرورهای من", group: "حساب", run: go("/panel/servers") },
    { id: "a-billing", icon: "wallet", label: "صورتحساب و کیف پول", group: "حساب", run: go("/panel/billing") },
    { id: "a-tickets", icon: "message-circle", label: "تیکت‌های پشتیبانی", group: "حساب", run: go("/panel/tickets") },
    ...(session?.role === "admin" ? [{ id: "a-admin", icon: "shield-half", label: "پنل مدیریت", group: "حساب", run: go("/admin") }] : []),
  ];
  const term = q.trim();
  let items = base.filter((i) => !term || i.label.includes(term));
  if (term && /^[a-z0-9.-]+$/i.test(term)) items = [{ id: "d", icon: "globe", label: "بررسی دامنه " + term, group: "دامنه", run: go("/domains?q=" + encodeURIComponent(term)) }, ...items];
  const cur = Math.min(idx, Math.max(0, items.length - 1));
  const run = (it?: Item) => { if (!it) return; onClose(); it.run(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(Math.min(items.length - 1, cur + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(Math.max(0, cur - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(items[cur]); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh] fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div ref={ref} tabIndex={-1} className="pop-in relative w-full max-w-xl rounded-3xl bg-[#0a0c14]/85 backdrop-blur-2xl border border-white/20 shadow-2xl overflow-hidden outline-none" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="دسترسی سریع">
        <div className="flex items-center gap-3 px-5 h-16 border-b border-white/10">
          <Icon name="search" size={20} className="text-white/50" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={onKey} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-label="جست‌وجو"
            placeholder="صفحه، اقدام یا نام دامنه را بنویسید" className="flex-1 bg-transparent outline-none text-base placeholder:text-white/35" />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/10 border border-white/15 text-white/60 ltr">Esc</kbd>
        </div>
        <div id="palette-list" role="listbox" className="max-h-[52vh] overflow-auto p-2">
          {items.length === 0 && <div className="p-8 text-center text-white/55 text-sm">موردی پیدا نشد. یک نام دامنه انگلیسی امتحان کنید.</div>}
          {items.map((it, i) => {
            const head = i === 0 || items[i - 1].group !== it.group ? <div className="px-3 pt-3 pb-1.5 text-[11px] text-white/55">{it.group}</div> : null;
            return (
              <Fragment key={it.id}>
                {head}
                <button type="button" role="option" aria-selected={i === cur} onMouseEnter={() => setIdx(i)} onClick={() => run(it)}
                  className={"w-full flex items-center gap-3 px-3 py-3 rounded-xl text-right transition " + (i === cur ? "bg-white/[0.12]" : "")}>
                  <span className={"w-9 h-9 rounded-xl grid place-items-center " + (i === cur ? "acc-bg" : "bg-white/[0.08] text-white/70")}><Icon name={it.icon} size={17} /></span>
                  <span className="flex-1 text-sm">{it.label}</span>
                  {i === cur && <Icon name="corner-down-left" size={16} className="text-white/55" />}
                </button>
              </Fragment>
            );
          })}
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/10 text-[11px] text-white/55">
          <span className="flex items-center gap-1.5"><Icon name="keyboard" size={14} /> با کلیدهای جهت حرکت کنید</span>
          <span className="flex items-center gap-1"><Icon name="command" size={13} /> دسترسی سریع گره</span>
        </div>
      </div>
    </div>
  );
}

function CartDrawer({ cart, onClose }: { cart: CartItem[]; onClose: () => void }) {
  const router = useRouter();
  const session = useSession();
  const db = useDB();
  const [done, setDone] = useState<string | false>(false);
  const ref = useDialog(true, onClose);
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<CouponRule | null>(null);
  const [codeErr, setCodeErr] = useState("");
  const [checking, setChecking] = useState(false);
  const subtotal = cart.reduce((s, i) => s + i.base, 0);
  // re-priced on every render so a percent code follows cart changes; an invalidated code simply drops out
  const discount = applied ? couponDiscount(applied, subtotal) : 0;
  const net = subtotal - discount;
  const total = roundK(net * (1 + db.settings.tax / 100)); // same rounding as invoices (invGross)
  const vat = total - net;
  const apply = async () => {
    setCodeErr(""); setChecking(true);
    try { const q = await api.billing.quote(code, subtotal); setApplied({ code: q.code, type: q.type, value: q.value }); setCode(""); }
    catch (e) { setCodeErr(e instanceof Error ? e.message : "کد معتبر نیست."); }
    finally { setChecking(false); }
  };
  const checkout = async () => {
    if (!session) { onClose(); router.push("/auth?next=/panel/billing" as never); return; }
    const inv = await api.billing.checkout(cart.map((i) => i.sku), applied?.code);
    setCart([]); setApplied(null); setDone(inv.id);
  };
  return (
    <div className="fixed inset-0 z-[55] fade-in">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} />
      <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="سبد خرید" className="drawer-in absolute left-0 top-0 bottom-0 w-[400px] max-w-[92vw] bg-[#0a0c14]/90 backdrop-blur-2xl border-r border-white/15 shadow-2xl flex flex-col outline-none"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="flex items-center justify-between px-6 h-16 border-b border-white/10">
          <h2 className="flex items-center gap-2 font-extrabold text-base"><Icon name="shopping-cart" size={19} className="acc" /> سبد خرید {cart.length > 0 && <span className="text-white/50 font-normal text-sm">({fa(cart.length)})</span>}</h2>
          <button type="button" data-close onClick={onClose} className="w-9 h-9 grid place-items-center rounded-xl hover:bg-white/10" aria-label="بستن"><Icon name="x" size={19} /></button>
        </div>
        {done ? (
          <div className="flex-1 grid place-items-center p-8 text-center">
            <div>
              <div className="w-20 h-20 mx-auto rounded-full acc-bg grid place-items-center"><CheckDraw /></div>
              <div className="text-xl font-black mt-6">سفارش ثبت شد</div>
              <p className="text-white/60 text-sm leading-7 mt-2">صورتحساب <span className="mono">{done}</span> صادر شد. پس از پرداخت، سرویس خودکار فعال می‌شود.</p>
              <button type="button" onClick={() => { onClose(); router.push("/panel/billing"); }} className={BTN_P + " mt-6 px-6 py-2.5 text-sm"}>پرداخت صورتحساب</button>
            </div>
          </div>
        ) : cart.length === 0 ? (
          <div className="flex-1 grid place-items-center p-8 text-center">
            <div>
              <div className="w-16 h-16 mx-auto rounded-2xl bg-white/[0.08] border border-white/15 grid place-items-center"><Icon name="package-open" size={30} className="text-white/60" /></div>
              <div className="font-bold mt-5">سبد خالی است</div>
              <p className="text-white/55 text-sm mt-2 leading-7">یک پلن سرور، هاست یا دامنه را اضافه کنید.</p>
            </div>
          </div>
        ) : (
          <>
            <ul className="flex-1 overflow-auto p-4 space-y-2.5">
              {cart.map((i) => (
                <li key={i.id} className="pop-in flex items-start gap-3 rounded-2xl bg-white/[0.06] border border-white/[0.12] p-3.5">
                  <span className="w-10 h-10 rounded-xl bg-white/[0.08] grid place-items-center acc"><Icon name={i.icon || "box"} size={19} /></span>
                  <div className="flex-1 min-w-0">
                    <div className={"text-sm font-bold truncate " + (i.ltr ? "ltr text-right" : "")}>{i.title}</div>
                    {i.meta && <div className="text-xs text-white/50 mt-1 leading-5">{i.meta}</div>}
                    <div className="text-xs mt-1.5 text-white/85">{toman(i.base)}</div>
                  </div>
                  <button type="button" onClick={() => setCart((c) => c.filter((x) => x.id !== i.id))} className="w-8 h-8 grid place-items-center rounded-lg text-white/55 hover:text-rose-300 hover:bg-rose-400/10" aria-label={"حذف " + i.title}><Icon name="trash-2" size={16} /></button>
                </li>
              ))}
            </ul>
            <div className="p-5 border-t border-white/10 space-y-2.5 text-sm">
              {applied ? (
                <div className="flex items-center justify-between rounded-xl bg-emerald-400/10 border border-emerald-300/25 px-3 py-2 text-emerald-100">
                  <span className="flex items-center gap-2"><Icon name="badge-percent" size={16} />کد <span className="mono ltr">{applied.code}</span></span>
                  <button type="button" onClick={() => setApplied(null)} className="text-xs text-white/60 hover:text-white">حذف</button>
                </div>
              ) : (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void apply(); }}>
                  <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} dir="ltr" aria-label="کد تخفیف" placeholder="کد تخفیف" aria-invalid={!!codeErr}
                    className="flex-1 min-w-0 h-10 rounded-xl bg-white/[0.06] border border-white/15 px-3 outline-none focus:border-white/40 mono text-left" />
                  <button type="submit" disabled={!code.trim() || checking} className={BTN_G + " px-4 h-10 text-xs"}>{checking ? <Icon name="loader-circle" size={14} className="animate-spin" /> : "اعمال"}</button>
                </form>
              )}
              {codeErr && <div role="alert" className="text-xs text-rose-300">{codeErr}</div>}
              <div className="flex justify-between text-white/65"><span>جمع سفارش</span><span>{toman(subtotal)}</span></div>
              {discount > 0 && <div className="flex justify-between text-emerald-300"><span>تخفیف</span><span>−{toman(discount)}</span></div>}
              <div className="flex justify-between text-white/65"><span>مالیات بر ارزش افزوده ({fa(db.settings.tax)}٪)</span><span>{toman(vat)}</span></div>
              <div className="flex justify-between font-black text-base pt-2 border-t border-white/10"><span>مبلغ قابل پرداخت</span><span><Num value={total} /> تومان</span></div>
              <AsyncButton onClick={checkout} className={BTN_P + " w-full py-3.5 mt-1"}><Icon name="lock" size={17} /> {session ? "ثبت سفارش" : "ورود و ثبت سفارش"}</AsyncButton>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
