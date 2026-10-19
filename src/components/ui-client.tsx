"use client";
import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { BTN_D, BTN_LG, BTN_MD, BTN_P, BTN_SM, GLASS, INPUT } from "@/lib/cls";
import { fa, strength, toEnDigits } from "@/lib/format";
import { useApp } from "./app-context";
import { Icon } from "./icon";
import { STATUS } from "./ui";

export const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const noopSubscribe = () => () => {};
/** false during SSR and hydration, true afterwards — without a setState-in-effect. */
export const useHydrated = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

/** a CSS media query as state; false on the server and during hydration */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useTween(value: number, dur = 600) {
  const [v, setV] = useState(value);
  const cur = useRef(value);
  useEffect(() => {
    const from = cur.current, to = value;
    if (from === to) return;
    const instant = prefersReducedMotion();
    let raf = 0, start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const k = instant ? 1 : Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - k, 3);
      cur.current = from + (to - from) * e; setV(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, dur]);
  return v;
}

export function useInView<T extends Element>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current || seen) return;
    const io = new IntersectionObserver(([en]) => { if (en.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

export function Num({ value, d = 0, className = "" }: { value: number; d?: number; className?: string }) {
  const v = useTween(value);
  return <span className={className}>{fa(d ? v : Math.round(v), d)}</span>;
}

export function Counter({ to, d = 0, suffix = "" }: { to: number; d?: number; suffix?: string }) {
  const [ref, seen] = useInView<HTMLSpanElement>();
  const v = useTween(seen ? to : 0, 1600);
  // SSR / no-JS shows the real number; the count-up starts once visible.
  const mounted = useHydrated();
  const shown = mounted ? v : to;
  return <span ref={ref}>{fa(d ? shown : Math.round(shown), d)}{suffix}</span>;
}

export type TabOpt = { id: string; label: React.ReactNode; icon?: string; badge?: string };
export function Tabs({ options, value, onChange, full = false, size = "md", label }: { options: TabOpt[]; value: string; onChange: (id: string) => void; full?: boolean; size?: "sm" | "md"; label?: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => { const el = refs.current[value]; if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth }); };
    measure();
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure);
    return () => window.removeEventListener("resize", measure);
  }, [value, options.length]);
  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const onKey = (e: React.KeyboardEvent) => {
    const i = options.findIndex((o) => o.id === value);
    // RTL: ArrowLeft moves forward
    const d = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[(i + d + options.length) % options.length];
    onChange(next.id); refs.current[next.id]?.focus(); refs.current[next.id]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  // the strip scrolls sideways when it is wider than the screen (phones) instead of widening the page;
  // a fade on the side that has more tabs shows that it scrolls
  const box = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: false, end: false, ltr: false });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const f = () => {
      const max = el.scrollWidth - el.clientWidth, x = Math.abs(el.scrollLeft); // RTL scrollLeft runs 0 → negative
      const n = { start: max > 2 && x > 2, end: max > 2 && max - x > 2, ltr: getComputedStyle(el).direction === "ltr" };
      setEdge((p) => (p.start === n.start && p.end === n.end && p.ltr === n.ltr ? p : n));
    };
    const ro = new ResizeObserver(f); // also fires once right away
    ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener("scroll", f, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", f); };
  }, [options.length]);
  const mask = edge.start || edge.end ? `linear-gradient(to ${edge.ltr ? "right" : "left"}, ${edge.start ? "transparent 0, #000 28px" : "#000 0"}, ${edge.end ? "#000 calc(100% - 28px), transparent 100%" : "#000 100%"})` : undefined;
  return (
    <div ref={box} style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined} className={"max-w-full overflow-x-auto no-scrollbar " + (full ? "w-full" : "inline-block align-top")}>
    <div role="tablist" aria-label={label} onKeyDown={onKey} className={"relative inline-flex p-1 rounded-2xl bg-white/[0.07] border border-white/15 " + (full ? "w-full" : "")}>
      {pill && <span className="tab-pill" style={{ left: pill.left, width: pill.width }} />}
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button key={o.id} type="button" ref={(el) => { refs.current[o.id] = el; }} role="tab" aria-selected={on} tabIndex={on ? 0 : -1} onClick={(e) => { onChange(o.id); e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" }); }}
            className={"relative z-10 " + (full ? "flex-1 " : "") + pad + " rounded-xl flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-300 " +
              (on ? "text-slate-900 font-bold" + (pill ? "" : " bg-[#f5f7fb]") : "text-white/70 hover:text-white")}>
            {o.icon && <Icon name={o.icon} size={16} />}
            {o.label}
            {o.badge && <span className={"text-[10px] px-1.5 py-0.5 rounded-md " + (on ? "bg-emerald-600 text-white" : "bg-emerald-400/20 text-emerald-300")}>{o.badge}</span>}
          </button>
        );
      })}
    </div>
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={"relative w-11 h-6 shrink-0 rounded-full transition-colors duration-300 border disabled:opacity-50 " + (on ? "acc-bg border-transparent" : "bg-white/15 border-white/20")}>
      <span className={"absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all duration-300 " + (on ? "right-[22px]" : "right-0.5")} />
    </button>
  );
}

export type Opt = string | { value: string; label: string };
export function Select({ value, onChange, options, className = "", ltr = false, label }: { value: string; onChange: (v: string) => void; options: Opt[]; className?: string; ltr?: boolean; label?: string }) {
  return (
    <div className={"relative max-w-full " + className}>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={INPUT + " appearance-none pl-9 " + (ltr ? "ltr text-left" : "")}>
        {options.map((o) => typeof o === "string"
          ? <option key={o} value={o} className="bg-[#0d1018]">{o}</option>
          : <option key={o.value} value={o.value} className="bg-[#0d1018]">{o.label}</option>)}
      </select>
      <Icon name="chevron-down" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/55 pointer-events-none" />
    </div>
  );
}

/* open dialogs, innermost last: only the top one answers Escape/Tab, and the page stays locked until the last closes */
const dialogStack: symbol[] = [];
let lockedOverflow: [string, string] | null = null;
function lockScroll() {
  if (lockedOverflow) return;
  const html = document.documentElement, body = document.body;
  lockedOverflow = [html.style.overflow, body.style.overflow];
  html.style.overflow = "hidden"; body.style.overflow = "hidden";
}
function unlockScroll() {
  if (!lockedOverflow || dialogStack.length) return;
  document.documentElement.style.overflow = lockedOverflow[0]; document.body.style.overflow = lockedOverflow[1];
  lockedOverflow = null;
}
const FOCUSABLE = "a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])";

/** Lock page scroll + Escape to close + focus trap + return focus, shared by Modal and drawers. */
export function useDialog<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const me = Symbol("dialog");
    dialogStack.push(me);
    const prev = document.activeElement as HTMLElement | null;
    lockScroll();
    const focusables = () => [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.getClientRects().length > 0);
    // a portalled dialog mounts in the same commit, but wait a frame so autofocus inside it wins
    const raf = requestAnimationFrame(() => {
      if (ref.current?.contains(document.activeElement)) return;
      const first = ref.current?.querySelector<HTMLElement>("[autofocus]") || focusables().find((el) => !el.hasAttribute("data-close") && el.tagName !== "A");
      (first || ref.current)?.focus({ preventScroll: true });
    });
    const k = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== me) return;
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close.current(); return; }
      if (e.key === "Tab" && ref.current) {
        const f = focusables();
        if (!f.length) { e.preventDefault(); ref.current.focus(); return; }
        const a = f[0], b = f[f.length - 1], cur = document.activeElement;
        if (!ref.current.contains(cur)) { e.preventDefault(); (e.shiftKey ? b : a).focus(); }
        else if (e.shiftKey && (cur === a || cur === ref.current)) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && cur === b) { e.preventDefault(); a.focus(); }
      }
    };
    window.addEventListener("keydown", k);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", k);
      dialogStack.splice(dialogStack.indexOf(me), 1);
      unlockScroll();
      if (prev?.isConnected) prev.focus?.({ preventScroll: true });
    };
  }, [open]);
  return ref;
}

/** Renders overlays at the end of <body>. A `position: fixed` overlay inside a card with
    backdrop-filter or transform is positioned and clipped by that card instead of the screen. */
export function Portal({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  return hydrated ? createPortal(children, document.body) : null;
}

export function Modal({ open, onClose, title, children, footer, size = "max-w-lg", icon }: { open: boolean; onClose: () => void; title: string; children?: React.ReactNode; footer?: React.ReactNode; size?: string; icon?: string }) {
  const ref = useDialog(open, onClose);
  const tid = useId();
  if (!open) return null;
  // phones: a full-width bottom sheet; from sm up: a centred dialog. Header and footer stay put, the body scrolls.
  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 fade-in" style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
        <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={tid}
          className={"dlg-max sheet-in relative w-full " + size + " flex flex-col rounded-t-3xl sm:rounded-3xl bg-[#0b0d16] border border-white/[0.12] border-b-0 sm:border-b shadow-2xl outline-none overflow-hidden"}>
          <div className="flex items-center justify-between gap-3 px-5 sm:px-6 min-h-16 py-3 border-b border-white/[0.08] shrink-0">
            <h2 id={tid} className="flex items-center gap-3 font-extrabold text-base leading-7 min-w-0">{icon && <Icon name={icon} size={19} className="acc shrink-0" />}<span className="min-w-0 [overflow-wrap:anywhere]">{title}</span></h2>
            <button type="button" data-close onClick={onClose} className="w-9 h-9 shrink-0 grid place-items-center rounded-xl hover:bg-white/10" aria-label="بستن"><Icon name="x" size={18} /></button>
          </div>
          <div className="p-5 sm:p-6 overflow-y-auto overflow-x-hidden overscroll-contain min-h-0 flex-1" style={footer ? undefined : { paddingBottom: "max(1.25rem, env(safe-area-inset-bottom, 0px))" }}>{children}</div>
          {footer && <div className="px-5 sm:px-6 py-4 border-t border-white/[0.08] flex flex-wrap items-center justify-end gap-2 shrink-0 max-sm:[&>*]:flex-1" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}>{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

export function SideDrawer({ open, onClose, title, children, width = "w-[520px]" }: { open: boolean; onClose: () => void; title: string; children?: React.ReactNode; width?: string }) {
  const ref = useDialog(open, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[95] fade-in">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
        <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={"drawer-in absolute left-0 top-0 bottom-0 " + width + " max-w-[94vw] bg-[#0b0d16] border-r border-white/[0.12] flex flex-col outline-none"}
          style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="flex items-center justify-between gap-3 px-5 sm:px-6 h-16 border-b border-white/[0.08] shrink-0">
            <h2 className="font-extrabold text-base truncate min-w-0">{title}</h2>
            <button type="button" data-close onClick={onClose} className="w-9 h-9 shrink-0 grid place-items-center rounded-xl hover:bg-white/10" aria-label="بستن"><Icon name="x" size={18} /></button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-5 sm:p-6">{children}</div>
        </aside>
      </div>
    </Portal>
  );
}

/** Shows a spinner while the promise runs, surfaces errors as a toast, optional in-app confirm. */
export function AsyncButton({ onClick, className, children, confirmText, danger = false, disabled = false, title, size = "md" }: {
  onClick: () => Promise<unknown> | unknown; className?: string; children: React.ReactNode; confirmText?: string; danger?: boolean; disabled?: boolean; title?: string; size?: "sm" | "md" | "lg";
}) {
  const [busy, setBusy] = useState(false);
  const { notify, confirm } = useApp();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = async () => {
    if (busy || disabled) return;
    if (confirmText && !(await confirm(confirmText, { danger }))) return;
    setBusy(true);
    try { await onClick(); } catch (e) { notify(e instanceof Error ? e.message : "خطایی رخ داد", "circle-alert"); } finally { if (alive.current) setBusy(false); }
  };
  return (
    <button type="button" onClick={run} disabled={busy || disabled} aria-busy={busy} title={title}
      className={className || (danger ? BTN_D : BTN_P) + (size === "sm" ? BTN_SM : size === "lg" ? BTN_LG : BTN_MD)}>
      {busy && <Icon name="loader-circle" size={size === "sm" ? 14 : 16} className="animate-spin shrink-0" />}{children}
    </button>
  );
}

export function useCopy() {
  const { notify } = useApp();
  return async (text: string, label = "کپی شد") => {
    try { await navigator.clipboard.writeText(text); notify(label, "check"); } catch { notify("کپی ممکن نشد؛ دستی انتخاب کنید", "circle-alert"); }
  };
}
/** A short value (IP, key, host…) shown as LTR text that copies itself on click. Long values wrap
    instead of widening their container; `label` names what is copied for screen readers. */
export function CopyText({ text, className = "", label }: { text: string; className?: string; label?: string }) {
  const copy = useCopy();
  return (
    <button type="button" dir="ltr" onClick={(e) => { e.stopPropagation(); copy(text); }} title="کپی" aria-label={"کپی " + (label ?? (text.length > 80 ? text.slice(0, 60) + "…" : text))}
      className={"group inline-flex max-w-full min-w-0 items-center gap-1.5 text-left align-middle hover:text-white transition " + className}>
      <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span><Icon name="copy" size={13} className="shrink-0 opacity-40 group-hover:opacity-100" />
    </button>
  );
}

/** An icon-and-word copy button, for code blocks and long secrets whose text is shown elsewhere. */
export function CopyButton({ text, label = "کپی", className = "" }: { text: string; label?: string; className?: string }) {
  const copy = useCopy();
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); copy(text); }} aria-label={label} title={label}
      className={"inline-flex shrink-0 items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] text-white/70 bg-white/[0.06] border border-white/10 hover:text-white hover:bg-white/[0.12] transition " + className}>
      <Icon name="copy" size={13} />کپی
    </button>
  );
}

const RTL_TEXT = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

/** A code sample: LTR and monospace, scrolls sideways inside itself, and lays out each line with its
    own direction so Persian comments read correctly. The copy button sits in a bar above the code. */
export function CodeBlock({ code, label, title, className = "", wrap = false, maxH = "" }: { code: string; label: string; title?: React.ReactNode; className?: string; wrap?: boolean; maxH?: string }) {
  return (
    <div className={"min-w-0 rounded-xl bg-black/40 border border-white/[0.06] overflow-hidden " + className}>
      {/* laid out LTR like the code: file name on the left, copy on the right */}
      <div dir="ltr" className="flex items-center justify-between gap-2 ps-3 pe-1.5 py-1.5 border-b border-white/[0.06]">
        <span className="min-w-0 truncate text-[11px] text-white/50 font-mono">{title}</span>
        <CopyButton text={code} label={"کپی " + label} />
      </div>
      <pre dir="ltr" tabIndex={0} aria-label={label} className={"code text-[12px] leading-6 p-4 overflow-auto " + maxH + (wrap ? " whitespace-pre-wrap [overflow-wrap:anywhere]" : "")}>
        {/* one block per line, each with its own direction; a Persian line wraps instead of overflowing
            to the left, where a left-to-right scroller cannot reach it */}
        {code.split("\n").map((line, i) => <span key={i} className={"block [unicode-bidi:plaintext]" + (RTL_TEXT.test(line) ? " whitespace-pre-wrap" : "")}>{line || " "}</span>)}
      </pre>
    </div>
  );
}

export function StatCard({ icon, label, value, suffix, sub, tone, href }: { icon: string; label: string; value: number | string; suffix?: string; sub?: string; tone?: "up" | "down" | ""; href?: string }) {
  // long amounts (۲۴,۵۰۰,۰۰۰) get a smaller size on phones instead of wrapping a single digit onto a second line
  const long = (typeof value === "number" ? fa(value) : String(value)).length > 7;
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <span className="block text-xs text-white/55 leading-5">{label}</span>
          <div className="mt-1 sm:mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 min-w-0"><span className={(long ? "text-base min-[420px]:text-lg sm:text-2xl xl:text-[1.75rem]" : "text-lg sm:text-[1.75rem]") + " leading-tight font-black tracking-tight silver tabular [overflow-wrap:anywhere]"}>{typeof value === "number" ? <Num value={value} /> : value}</span>{suffix && <span className="text-[11px] sm:text-xs text-white/55">{suffix}</span>}</div>
        </div>
        <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl tile grid place-items-center shrink-0" aria-hidden="true"><Icon name={icon} size={16} /></span>
      </div>
      {sub && <div className={"text-[11px] mt-1.5 leading-5 " + (tone === "up" ? "text-emerald-300" : tone === "down" ? "text-rose-300" : "text-white/55")}>{sub}</div>}
    </>
  );
  const cls = "spot block min-w-0 text-right rounded-2xl sm:rounded-[1.4rem] p-3.5 sm:p-5 " + GLASS;
  return href ? <Link href={href as never} className={cls + " hover:border-white/20 transition-colors"}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

export function AreaChart({ data, labels, height = 200, unit = "", fmt = (v: number) => fa(Math.round(v)) }: { data: number[]; labels?: string[]; height?: number; unit?: string; fmt?: (v: number) => string }) {
  const id = "ac" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const w = 600, h = height, pad = 8, n = Math.max(2, data.length);
  const max = Math.max(...data, 0) * 1.15 || 1;
  const X = (i: number) => pad + (i * (w - pad * 2)) / (n - 1);
  const Y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const line = data.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); const rel = (e.clientX - r.left) / r.width; setHover(Math.max(0, Math.min(data.length - 1, Math.round(rel * (data.length - 1))))); };
  if (!data.length) return null;
  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full block" style={{ height }} onMouseMove={onMove} role="img" aria-label={"نمودار " + unit}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9cc9ff" stopOpacity=".32" /><stop offset="1" stopColor="#9cc9ff" stopOpacity="0" /></linearGradient></defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="rgba(255,255,255,.06)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />)}
        <path d={`${line} L ${X(data.length - 1)} ${h} L ${X(0)} ${h} Z`} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke="#cfe0ff" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1="0" y2={h} stroke="rgba(255,255,255,.25)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover !== null && (
        <div className="absolute top-2 pointer-events-none px-3 py-2 rounded-xl bg-[#0b0d16]/95 border border-white/15 text-xs shadow-xl" style={{ left: Math.min(78, Math.max(2, (hover / Math.max(1, data.length - 1)) * 100 - 8)) + "%" }}>
          <div className="text-white/50">{labels ? labels[hover] : fa(hover + 1)}</div><div className="font-bold mt-0.5 tabular">{fmt(data[hover])} {unit}</div>
        </div>
      )}
      {labels && <div className="flex justify-between text-[10px] text-white/50 mt-2">{[0, Math.floor(labels.length / 2), labels.length - 1].map((i) => <span key={i}>{labels[i]}</span>)}</div>}
    </div>
  );
}

export function Bars({ data, labels, height = 160, fmt = (v: number) => fa(v) }: { data: number[]; labels: string[]; height?: number; fmt?: (v: number) => string }) {
  const max = Math.max(...data) || 1;
  // many bars (e.g. 30 days) → thinner gaps and only every n-th label, so the chart never outgrows a phone screen
  const dense = data.length > 12, every = dense ? Math.ceil(data.length / 6) : 1;
  return (
    <div className={"flex items-end min-w-0 " + (dense ? "gap-0.5 sm:gap-1 overflow-hidden px-4" : "gap-1.5 sm:gap-2")} style={{ height }}>
      {data.map((v, i) => (
        <div key={i} title={labels[i] + " — " + fmt(v)} className="group flex-1 min-w-0 flex flex-col items-center gap-2 h-full justify-end">
          <div className={"text-[10px] text-white/0 group-hover:text-white/70 transition tabular whitespace-nowrap" + (dense ? " hidden sm:block" : "")}>{dense ? "" : fmt(v)}</div>
          <div className={(dense ? "rounded-sm sm:rounded-md" : "rounded-lg") + " w-full bg-white/[0.1] group-hover:bg-[#9cc9ff] transition-colors"} style={{ height: Math.max(4, (v / max) * (height - 40)) }} />
          <div className="text-[10px] text-white/50 whitespace-nowrap h-4 overflow-visible">{(data.length - 1 - i) % every === 0 ? labels[i] : ""}</div>
        </div>
      ))}
    </div>
  );
}

export type Column<T> = { key: string; label: string; sortable?: boolean; sortValue?: (r: T) => number | string; render?: (r: T) => React.ReactNode; className?: string };
type Filter = { key: string; label: string; options: string[] };
/** sortable, searchable, paginated table */
export function DataTable<T extends { id: string | number }>({ columns, rows, searchKeys = [], filters, pageSize = 8, onRowClick, empty = "موردی پیدا نشد.", toolbar, searchPlaceholder = "جست‌وجو" }: {
  columns: Column<T>[]; rows: T[]; searchKeys?: (keyof T & string)[]; filters?: Filter[]; pageSize?: number; onRowClick?: (r: T) => void; empty?: string; toolbar?: React.ReactNode; searchPlaceholder?: string;
}) {
  const [q, setQ] = useState("");
  const narrow = useMedia("(max-width: 767.98px)");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [fv, setFv] = useState<Record<string, string>>(() => Object.fromEntries((filters || []).map((f) => [f.key, "all"])));
  const term = toEnDigits(q.trim().toLowerCase());
  const rec = (r: T) => r as unknown as Record<string, unknown>;
  let list = rows.filter((r) => (!term || searchKeys.some((k) => toEnDigits(String(rec(r)[k] ?? "")).toLowerCase().includes(term))) && (filters || []).every((f) => fv[f.key] === "all" || rec(r)[f.key] === fv[f.key]));
  if (sort) {
    const c = columns.find((x) => x.key === sort.key)!;
    const val = (r: T) => (c.sortValue ? c.sortValue(r) : (rec(r)[sort.key] as number | string));
    list = list.slice().sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "fa")) * sort.dir; });
  }
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const view = list.slice(cur * pageSize, cur * pageSize + pageSize);
  return (
    <div>
      {(searchKeys.length > 0 || filters || toolbar) && (
        <div className="flex flex-col md:flex-row gap-2 md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 flex-1 min-w-0">
            {searchKeys.length > 0 && (
              <div className="relative sm:w-72">
                <Icon name="search" size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" />
                <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className={INPUT + " pr-9"} />
              </div>
            )}
            {(filters || []).map((f) => (
              <Select key={f.key} className="sm:w-44" label={f.label} value={fv[f.key]} onChange={(v) => { setFv((s) => ({ ...s, [f.key]: v })); setPage(0); }}
                options={[{ value: "all", label: f.label + ": همه" }, ...f.options.map((o) => ({ value: o, label: (STATUS[o] || [0, o])[1] as string }))]} />
            ))}
          </div>
          {toolbar}
        </div>
      )}
      {/* below md: one card per row (first column as its title) instead of a table that scrolls sideways */}
      {narrow ? <ul className="space-y-2.5">
        {view.length === 0 && <li className={GLASS + " rounded-[1.4rem] p-8 text-center text-sm text-white/55 leading-7"}><Icon name="search-x" size={20} className="mx-auto mb-2 text-white/50" />{empty}</li>}
        {view.map((r) => {
          const [head, ...rest] = columns;
          return (
            <li key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined} tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(r); } : undefined}
              className={GLASS + " rounded-[1.4rem] p-4 text-sm " + (onRowClick ? "cursor-pointer hover:bg-white/[0.07]" : "")}>
              <div className="font-bold min-w-0 [overflow-wrap:anywhere]">{head.render ? head.render(r) : String(rec(r)[head.key] ?? "")}</div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
                {rest.map((c) => {
                  const v = c.render ? c.render(r) : String(rec(r)[c.key] ?? "");
                  return c.label
                    ? <div key={c.key} className="min-w-0"><dt className="text-[11px] text-white/50 mb-0.5">{c.label}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd></div>
                    : <div key={c.key} className="col-span-2 flex flex-wrap items-center gap-2 pt-1">{v}</div>;
                })}
              </dl>
            </li>
          );
        })}
      </ul> :
      <div className={GLASS + " rounded-[1.4rem] overflow-x-auto"}>
        <table className="w-full text-sm min-w-[720px]">
          <thead><tr className="border-b border-white/[0.08] text-white/55 text-xs">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={"font-medium px-4 py-3.5 text-right align-middle whitespace-nowrap " + (c.className || "")} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                {c.sortable ? (
                  <button type="button" onClick={() => setSort((s) => (s && s.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))} className="inline-flex items-center gap-1 hover:text-white">
                    {c.label}<Icon name="arrow-down-up" size={12} className={sort?.key === c.key ? "text-white" : "opacity-40"} />
                  </button>
                ) : c.label}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {view.length === 0 && <tr><td colSpan={columns.length} className="p-10 text-center text-white/55 leading-7"><Icon name="search-x" size={20} className="mx-auto mb-2 text-white/50" />{empty}</td></tr>}
            {view.map((r) => (
              <tr key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined} tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(r); } : undefined}
                className={"border-b border-white/[0.05] last:border-0 transition-colors " + (onRowClick ? "cursor-pointer hover:bg-white/[0.04] focus-visible:bg-white/[0.06]" : "")}>
                {columns.map((c) => <td key={c.key} className={"px-4 py-3.5 align-middle " + (c.className || "")}>{c.render ? c.render(r) : String(rec(r)[c.key] ?? "")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {pages > 1 && (
        <div className="flex items-center justify-between gap-3 mt-4 text-xs text-white/55">
          <span>{fa(list.length)} مورد، صفحه {fa(cur + 1)} از {fa(pages)}</span>
          <div className="flex gap-1.5">
            <button type="button" disabled={cur === 0} onClick={() => setPage(cur - 1)} className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/10 grid place-items-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/10" aria-label="صفحه قبلی"><Icon name="chevron-right" size={16} /></button>
            <button type="button" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/10 grid place-items-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/10" aria-label="صفحه بعدی"><Icon name="chevron-left" size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

export type MenuItem = { icon: string; label: string; run: () => unknown; danger?: boolean } | "-" | false | null | undefined;
/** click-away popover menu; the trigger is rendered as its own button */
export function Menu({ trigger, label, items, align = "left", triggerClass = "" }: { trigger: React.ReactNode; label: string; items: MenuItem[]; align?: "left" | "right"; triggerClass?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", f); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("pointerdown", f); document.removeEventListener("keydown", k); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={triggerClass}>{trigger}</button>
      {open && (
        <div role="menu" className={"pop-in absolute z-50 top-full mt-2 min-w-[220px] max-w-[85vw] rounded-2xl bg-[#0b0d16]/95 backdrop-blur-2xl border border-white/[0.12] shadow-2xl p-1.5 " + (align === "left" ? "left-0" : "right-0")}>
          {items.filter(Boolean).map((it, i) => it === "-" ? <div key={i} className="h-px bg-white/[0.08] my-1.5" /> : it && (
            <button type="button" role="menuitem" key={i} onClick={() => { setOpen(false); it.run(); }} className={"w-full flex items-center gap-2.5 px-3 min-h-10 py-2 rounded-xl text-sm leading-6 text-right hover:bg-white/[0.07] focus-visible:bg-white/[0.07] " + (it.danger ? "text-rose-300" : "text-white/85")}>
              <Icon name={it.icon} size={16} className={"shrink-0 " + (it.danger ? "" : "text-white/55")} /><span className="flex-1 min-w-0">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
/** square icon-only buttons: 36px (BTN_SM height) and 40px (BTN_MD height); icons 16-17px */
export const ICON_BTN = "w-9 h-9 shrink-0 rounded-xl inline-grid place-items-center align-middle text-white/65 hover:text-white hover:bg-white/[0.08] transition";
export const ICON_BTN_MD = "w-10 h-10 shrink-0 rounded-xl inline-grid place-items-center align-middle text-white/65 hover:text-white hover:bg-white/[0.08] transition";
export function IconBtn({ icon, label, onClick, className = "" }: { icon: string; label: string; onClick: (e: React.MouseEvent) => unknown; className?: string }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className={ICON_BTN + " " + className}><Icon name={icon} size={17} /></button>;
}

export function PageTitle({ title, sub, action, back }: { title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode; back?: [string, string] }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6 sm:mb-7">
      <div className="min-w-0">
        {back && <Link href={back[0] as never} className="text-xs text-white/55 hover:text-white inline-flex items-center gap-1 mb-2 rounded-md"><Icon name="chevron-right" size={14} />{back[1]}</Link>}
        <h1 className="text-2xl sm:text-[1.9rem] leading-snug font-black tracking-tight [overflow-wrap:anywhere]">{title}</h1>
        {sub && <div className="text-sm text-white/55 leading-6 mt-1.5">{sub}</div>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{action}</div>}
    </div>
  );
}

export function StrengthBar({ value }: { value: string }) {
  const s = strength(value);
  const labels = ["خیلی ضعیف", "ضعیف", "متوسط", "خوب", "قوی"];
  return (
    <div className="mt-2">
      <div className="flex gap-1" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i} className={"h-1 flex-1 rounded-full transition-colors " + (i < s ? (s < 2 ? "bg-rose-400" : s < 3 ? "bg-amber-300" : "bg-emerald-400") : "bg-white/10")} />)}</div>
      {value && <div className="text-[11px] text-white/55 mt-1.5" aria-live="polite">قدرت رمز: {labels[s]}</div>}
    </div>
  );
}

export function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const set = (i: number, raw: string) => {
    const digits = toEnDigits(raw).replace(/\D/g, "");
    if (digits.length > 1) { // paste / autofill of the whole code
      const next = (value.slice(0, i) + digits).slice(0, 6);
      onChange(next); refs.current[Math.min(5, next.length)]?.focus(); return;
    }
    const arr = value.padEnd(6, " ").split(""); arr[i] = digits || " ";
    onChange(arr.join("").replace(/\s+$/, "").replace(/ /g, ""));
    if (digits && i < 5) refs.current[i + 1]?.focus();
  };
  return (
    <div className="flex gap-2 justify-center" dir="ltr">
      {Array.from({ length: 6 }, (_, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} value={value[i] || ""} onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus(); }} aria-label={"رقم " + fa(i + 1)}
          className="w-11 h-12 sm:w-12 text-center text-xl font-black rounded-xl bg-white/[0.05] border border-white/15 focus:border-white/50 outline-none tabular" />
      ))}
    </div>
  );
}

export function PriceTag({ base, suffix = "تومان / ماه", big = true }: { base: number; suffix?: string; big?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1.5 min-w-0">
      <Num value={base} className={(big ? "text-[1.85rem] xl:text-[2.1rem] leading-tight" : "text-xl") + " font-black tracking-tight tabular silver"} />
      <span className="text-xs text-white/55">{suffix}</span>
    </div>
  );
}

