"use client";
import Link from "next/link";
import { locLabel } from "@/lib/catalog";
import { BTN_G } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import type { Server } from "@/lib/store";
import { Icon } from "../icon";
import { Badge, Card, StatusBadge } from "../ui";
import { PageTitle } from "../ui-client";

/** a paid server that has no VPS yet (or whose build is late) */
export const isPending = (s: Server) => !s.vpsid || !!s.delayed;

export function ServerStateBadge({ s }: { s: Server }) {
  if (s.delayed) return <Badge tone="amber" dot>تحویل با تأخیر</Badge>;
  if (!s.vpsid) return <Badge tone="blue" dot>در حال آماده‌سازی</Badge>;
  return <StatusBadge s={s.status} />;
}

/** the server page while nothing can be operated yet: what was ordered and what happens next */
export function ServerPending({ s }: { s: Server }) {
  const late = !!s.delayed;
  return (
    <div>
      <PageTitle back={["/panel/servers", "سرورهای ابری"]} title={<span className="ltr inline-block">{s.name}</span>}
        sub={<span className="flex flex-wrap items-center gap-x-4 gap-y-1"><ServerStateBadge s={s} /><span>{locLabel(s.loc)}</span><span>{s.os}</span></span>} />
      <Card>
        <div className="flex items-start gap-4">
          <span className={"w-11 h-11 shrink-0 rounded-xl grid place-items-center " + (late ? "bg-amber-400/15 text-amber-200" : "tile")}>
            <Icon name={late ? "clock" : "loader-circle"} size={20} className={late ? "" : "animate-spin"} />
          </span>
          <div className="min-w-0">
            <h2 className="font-extrabold">{late ? "تحویل با تأخیر — تیم فنی در حال بررسی است" : "در حال آماده‌سازی"}</h2>
            <p className="text-sm text-white/65 leading-7 mt-1">
              {late
                ? "پرداخت شما ثبت شده و سرور برایتان رزرو است، اما ساخت آن با مشکل روبه‌رو شد. تیم فنی مطلع شده و به‌محض آماده شدن، مشخصات ورود برایتان ایمیل می‌شود. نیازی به پرداخت دوباره نیست."
                : "پرداخت ثبت شد و سرور در حال ساخت است. معمولا چند دقیقه طول می‌کشد؛ پس از آماده شدن، مشخصات ورود ایمیل می‌شود."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/panel/tickets" className={BTN_G + " px-4 h-9 text-xs"}><Icon name="message-circle" size={14} /> پیگیری با پشتیبانی</Link>
            </div>
          </div>
        </div>
      </Card>
      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Card title="سفارش" icon="server">
          <dl className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
            {([["پلن", s.plan], ["منابع", fa(s.cpu) + " هسته، " + fa(s.ram) + " گیگ رم، " + fa(s.disk) + " گیگ"], ["سیستم‌عامل", s.os], ["موقعیت", locLabel(s.loc)], ["تاریخ سفارش", s.created], ["هزینه ماهانه", toman(s.price)]] as [string, string][])
              .map(([k, v]) => <div key={k}><dt className="text-white/55 text-xs">{k}</dt><dd className="mt-1 font-medium">{v}</dd></div>)}
          </dl>
        </Card>
        <Card title="مراحل" icon="list-checks">
          <ul className="space-y-3 text-sm">
            {s.tasks.length === 0 ? <li className="text-white/55">در صف ساخت…</li> : s.tasks.slice(0, 6).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2"><Icon name={t.status === "failed" ? "circle-alert" : t.status === "running" ? "loader-circle" : "circle-check"} size={15} className={t.status === "running" ? "animate-spin acc" : t.status === "failed" ? "text-amber-300" : "text-emerald-300"} />{t.action}</span>
                <span className="text-[11px] text-white/45">{t.at}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/** a delivered server whose build ran late */
export function DelayBanner({ s }: { s: Server }) {
  if (!s.delayed || !s.vpsid) return null;
  return <p role="status" className="mb-4 p-3 rounded-[12px] bg-amber-400/10 text-amber-200 text-xs leading-6">آماده شدن این سرور بیش از حد معمول طول کشیده است؛ تیم فنی در حال بررسی است و تا آن زمان برخی عملیات ممکن است کار نکنند.</p>;
}
