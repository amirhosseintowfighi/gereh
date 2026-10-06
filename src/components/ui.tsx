/* Server-safe UI primitives (no hooks). */
import { GLASS } from "@/lib/cls";
import { Icon } from "./icon";

const TONES = {
  green: "bg-emerald-400/10 text-emerald-300 border-emerald-300/20", amber: "bg-amber-400/10 text-amber-200 border-amber-300/20",
  red: "bg-rose-400/10 text-rose-300 border-rose-300/20", blue: "bg-sky-400/10 text-sky-200 border-sky-300/20",
  gray: "bg-white/[0.06] text-white/60 border-white/10", violet: "bg-violet-400/10 text-violet-200 border-violet-300/20",
};
export type Tone = keyof typeof TONES;
export function Badge({ tone = "gray", children, dot = false }: { tone?: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={"inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md border whitespace-nowrap " + TONES[tone]}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}{children}
    </span>
  );
}
export const STATUS: Record<string, [Tone, string]> = {
  running: ["green", "روشن"], stopped: ["gray", "خاموش"], suspended: ["red", "معلق"], active: ["green", "فعال"], pending: ["amber", "در انتظار"],
  expiring: ["amber", "رو به انقضا"], expired: ["red", "منقضی"], paid: ["green", "پرداخت‌شده"], unpaid: ["amber", "پرداخت‌نشده"], overdue: ["red", "سررسید گذشته"],
  refunded: ["gray", "مسترد"], open: ["blue", "باز"], answered: ["green", "پاسخ داده شد"], "customer-reply": ["amber", "پاسخ مشتری"], closed: ["gray", "بسته"],
  online: ["green", "آنلاین"], maintenance: ["amber", "در حال نگهداری"], verified: ["green", "تأییدشده"], none: ["gray", "انجام نشده"],
  high: ["red", "فوری"], normal: ["blue", "معمولی"], low: ["gray", "کم"],
  topup: ["green", "شارژ"], payment: ["gray", "پرداخت"], refund: ["blue", "بازگشت وجه"],
};
export const statusLabel = (s: string) => (STATUS[s] || ["gray", s])[1];
export function StatusBadge({ s }: { s: string }) {
  const [t, l] = STATUS[s] || ["gray", s];
  return <Badge tone={t} dot>{l}</Badge>;
}

export function Card({ title, icon, action, children, className = "", pad = "p-5 sm:p-6" }: { title?: React.ReactNode; icon?: string; action?: React.ReactNode; children?: React.ReactNode; className?: string; pad?: string }) {
  return (
    <section className={GLASS + " rounded-[1.4rem] " + className}>
      {title && (
        <header className="flex items-center justify-between gap-3 px-5 sm:px-6 pt-5">
          <h2 className="font-extrabold flex items-center gap-2 text-base">{icon && <Icon name={icon} size={18} className="acc" />}{title}</h2>{action}
        </header>
      )}
      <div className={pad}>{children}</div>
    </section>
  );
}

export function Empty({ icon = "package-open", title, text, action }: { icon?: string; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="py-14 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl tile grid place-items-center"><Icon name={icon} size={24} /></div>
      <div className="font-bold mt-5">{title}</div>
      {text && <p className="text-white/50 text-sm mt-2 leading-7 max-w-sm mx-auto">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Meter({ value, max = 100, label, right }: { value: number; max?: number; label?: string; right?: string }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const tone = pct > 85 ? "bg-rose-400" : pct > 65 ? "bg-amber-300" : "acc-bg";
  return (
    <div>
      {(label || right) && <div className="flex justify-between text-xs mb-2"><span className="text-white/55">{label}</span><span className="text-white/80 tabular">{right}</span></div>}
      <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={"h-full rounded-full transition-all duration-700 " + tone} style={{ width: pct + "%" }} />
      </div>
    </div>
  );
}

export function SectionHead({ title, sub, center = true, id, as: H = "h2" }: { title: string; sub?: string; center?: boolean; id?: string; as?: "h2" | "h3" }) {
  return (
    <div id={id} className={"mb-10 " + (center ? "text-center mx-auto max-w-2xl" : "max-w-2xl")}>
      <H className="text-[1.7rem] sm:text-[2.6rem] font-black leading-[1.4] tracking-tight">{title}</H>
      {sub && <p className="mt-3 text-white/65 leading-8 text-[15px] sm:text-base">{sub}</p>}
    </div>
  );
}

export function IconTile({ name, size = 22, cls = "w-12 h-12 rounded-2xl" }: { name: string; size?: number; cls?: string }) {
  return <div className={cls + " grid place-items-center tile shrink-0"}><Icon name={name} size={size} sw={1.6} /></div>;
}

export function Field({ label, hint, error, children, className = "" }: { label?: string; hint?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={"block " + className}>
      {label && <span className="block text-xs text-white/60 mb-2">{label}</span>}
      {children}
      {error ? <span className="block text-[11px] text-rose-300 mt-1.5" role="alert">{error}</span> : hint ? <span className="block text-[11px] text-white/50 mt-1.5">{hint}</span> : null}
    </label>
  );
}

export function CheckDraw({ size = 38 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
