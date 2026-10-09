import { useId } from "react";

export const VIRGULE_URL = "https://virgule.studio";

/** Two interlocked links and a node. */
export function Logo({ size = 36, decorative = false }: { size?: number; decorative?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const A = "rotate(45 18 24)", B = "rotate(45 30 24)";
  const rectA = (extra: React.SVGProps<SVGRectElement>) => <rect x="9.5" y="15.5" width="17" height="17" rx="5.5" transform={A} {...extra} />;
  const rectB = (extra: React.SVGProps<SVGRectElement>) => <rect x="21.5" y="15.5" width="17" height="17" rx="5.5" transform={B} {...extra} />;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "نشان گره" })}>
      <defs>
        <linearGradient id={id + "g"} x1="4" y1="10" x2="44" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f8fafc" />
          <stop offset="0.55" stopColor="#c7d2fe" />
          <stop offset="1" stopColor="#7dd3fc" />
        </linearGradient>
        <clipPath id={id + "c1"}><circle cx="24" cy="18" r="5.2" /></clipPath>
        <clipPath id={id + "c2"}><circle cx="24" cy="30" r="5.2" /></clipPath>
        <mask id={id + "mB"} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <rect width="48" height="48" fill="#fff" />
          <g clipPath={`url(#${id}c1)`}>{rectA({ stroke: "#000", strokeWidth: 8, fill: "none" })}</g>
        </mask>
        <mask id={id + "mA"} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <rect width="48" height="48" fill="#fff" />
          <g clipPath={`url(#${id}c2)`}>{rectB({ stroke: "#000", strokeWidth: 8, fill: "none" })}</g>
        </mask>
      </defs>
      <g mask={`url(#${id}mA)`}>{rectA({ stroke: `url(#${id}g)`, strokeWidth: 3.6 })}</g>
      <g mask={`url(#${id}mB)`}>{rectB({ stroke: `url(#${id}g)`, strokeWidth: 3.6 })}</g>
      <line x1="21.2" y1="24" x2="26.8" y2="24" stroke={`url(#${id}g)`} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ size = 34, sub = true }: { size?: number; sub?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={size} decorative />
      <span className="text-right leading-none">
        <span className="block font-black text-[1.3rem] tracking-tight">گره</span>
        {sub && <span className="block text-[10px] text-white/50 mt-1 ltr text-right tracking-[0.18em]">gereh.net</span>}
      </span>
    </span>
  );
}

export function VirguleLink({ className = "" }: { className?: string }) {
  return (
    <a href={VIRGULE_URL} target="_blank" rel="noopener"
      className={"font-bold text-white/85 hover:text-white underline decoration-white/25 underline-offset-4 hover:decoration-white/70 transition " + className}>ویرگول</a>
  );
}

export function VirguleMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="7" stroke="rgba(255,255,255,.35)" />
      <path d="M13.2 8.6a2.1 2.1 0 1 1-2.6 2c0-.6.2-1 .6-1.4M13.2 8.6c.9 1.6.6 4.6-2.4 6.9" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function MeshBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="absolute inset-0 mesh-base" />
      <div className="blob" style={{ width: 620, height: 620, backgroundColor: "#5b21b6", top: "-18%", right: "-10%" }} />
      <div className="blob b2" style={{ width: 560, height: 560, backgroundColor: "#075985", top: "30%", left: "-16%" }} />
      <svg className="absolute inset-0 w-full h-full opacity-[0.035]">
        <defs><pattern id="bg-grid" width="56" height="56" patternUnits="userSpaceOnUse"><path d="M56 0H0V56" fill="none" stroke="#fff" strokeWidth="1" /></pattern></defs>
        <rect width="100%" height="100%" fill="url(#bg-grid)" />
      </svg>
      <div className="absolute inset-0 grain" />
    </div>
  );
}
