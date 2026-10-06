"use client";
import { useEffect, useId, useRef } from "react";

/* Gereh = girih (گره‌چینی): the brand pattern. A star-and-lattice tessellation
   drawn twice — once faint, once in ice-blue revealed around the pointer. */
function Defs({ id, stroke, w }: { id: string; stroke: string; w: number }) {
  return (
    <pattern id={id} width="88" height="88" patternUnits="userSpaceOnUse">
      <g fill="none" stroke={stroke} strokeWidth={w}>
        <path d="M44 0L88 44L44 88L0 44Z" />
        <rect x="12.9" y="12.9" width="62.2" height="62.2" />
        <path d="M0 0L12.9 12.9M88 0L75.1 12.9M0 88L12.9 75.1M88 88L75.1 75.1" />
        <path d="M44 31.5L52.8 35.2L56.5 44L52.8 52.8L44 56.5L35.2 52.8L31.5 44L35.2 35.2Z" />
      </g>
    </pattern>
  );
}

export function GirihField({ className = "", base = "rgba(255,255,255,.055)", fade = true }: { className?: string; base?: string; fade?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = "gp" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host || !matchMedia("(hover: hover)").matches) return;
    const on = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--gx", e.clientX - r.left + "px");
      el.style.setProperty("--gy", e.clientY - r.top + "px");
      el.style.setProperty("--go", "1");
    };
    const off = () => el.style.setProperty("--go", "0");
    host.addEventListener("pointermove", on, { passive: true });
    host.addEventListener("pointerleave", off);
    return () => { host.removeEventListener("pointermove", on); host.removeEventListener("pointerleave", off); };
  }, []);
  const m = "linear-gradient(180deg, transparent, #000 18%, #000 70%, transparent)";
  return (
    <div ref={ref} aria-hidden="true" className={"absolute inset-0 pointer-events-none " + className} style={fade ? { maskImage: m, WebkitMaskImage: m } : undefined}>
      <svg className="absolute inset-0 w-full h-full"><defs><Defs id={id} stroke={base} w={1} /></defs><rect width="100%" height="100%" fill={`url(#${id})`} /></svg>
      <svg className="absolute inset-0 w-full h-full girih-hi"><defs><Defs id={id + "h"} stroke="rgba(170,205,255,.85)" w={1.25} /></defs><rect width="100%" height="100%" fill={`url(#${id}h)`} /></svg>
    </div>
  );
}
