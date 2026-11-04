"use client";
/* Panel pieces that show only real figures (src/server/dashboard.ts) with an honest empty state, the
   «داده‌های نمونه» admin card (src/server/demo-seed.ts). */
import { useState } from "react";
import { BTN_MD, INPUT } from "@/lib/cls";
import { dashboardApi, NO_DATA, type AdminDashboardStats } from "@/lib/dashboard";
import { fa } from "@/lib/format";
import { useDB } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AreaChart, AsyncButton, Bars } from "../ui-client";
import { Loading, useRemote } from "./vps-extras";

const mil = (n: number) => Math.round(n / 100_000) / 10;

export function useAdminStats() {
  const db = useDB();
  // reloads when invoices, users or tickets change in the shared state
  return useRemote("admin-stats:" + db.users.length + ":" + db.invoices.length + ":" + db.tickets.length, () => dashboardApi.admin());
}

export function AdminCharts({ x }: { x: ReturnType<typeof useAdminStats> }) {
  const s: AdminDashboardStats | null = x.data;
  const anyRevenue = !!s && s.revenue.gross.some((v) => v > 0);
  return (
    <div className="grid xl:grid-cols-[1.7fr_1fr] gap-4 mt-4">
      <Card title="درآمد ماهانه (با مالیات)" icon="trending-up" action={<span className="text-xs text-white/55">{s ? s.revenue.period + "، میلیون تومان" : "میلیون تومان"}</span>}>
        {x.error ? <Empty icon="circle-alert" title="بارگذاری نشد" text={x.error} />
          : !s ? <Loading />
          : !anyRevenue ? <Empty icon="trending-up" title={NO_DATA} text="هنوز صورتحساب پرداخت‌شده‌ای در این بازه نیست؛ با اولین پرداخت، درآمد هر ماه از صورتحساب‌های پرداخت‌شده این‌جا رسم می‌شود." />
          : <AreaChart data={s.revenue.gross.map(mil)} labels={s.revenue.labels} unit="میلیون تومان" height={230} fmt={(v) => fa(v, 1)} />}
      </Card>
      <Card title="ثبت‌نام مشتریان" icon="user-plus" action={s && <span className="text-xs text-white/55">{s.signups.period}</span>}>
        {x.error ? <Empty icon="circle-alert" title="بارگذاری نشد" text={x.error} />
          : !s ? <Loading />
          : s.signups.total === 0 ? <Empty icon="user-plus" title={NO_DATA} text="در این ۷ روز مشتری تازه‌ای ثبت‌نام نکرده است؛ هر ثبت‌نام (بدون حساب‌های کارکنان و حذف‌شده) در روز خودش شمرده می‌شود." />
          : <><Bars data={s.signups.counts} labels={s.signups.labels} height={200} /><p className="text-[11px] text-white/55 mt-3">مجموع {fa(s.signups.total)} ثبت‌نام؛ فقط حساب‌های مشتری، بدون کارکنان و حساب‌های حذف‌شده.</p></>}
      </Card>
    </div>
  );
}

/** the customer's own traffic, all servers together, as Virtualizor reported it */
export function UserTrafficCard() {
  const db = useDB();
  const x = useRemote("traffic:" + db.servers.length, () => dashboardApi.traffic());
  const t = x.data;
  return (
    <Card title="ترافیک ۳۰ روز اخیر (ورودی + خروجی)" icon="activity" action={t && t.days.length > 0 && <span className="text-xs text-white/55">مجموع {fa(t.totalGb, 1)} گیگابایت</span>}>
      {x.error ? <Empty icon="circle-alert" title="بارگذاری نشد" text={x.error} />
        : !t ? <Loading />
        : t.days.length === 0 ? <Empty icon="activity" title={NO_DATA} text={t.empty} />
        : <AreaChart data={t.days.map((d) => d.inGb + d.outGb)} labels={t.days.map((d) => new Date(d.day + "T12:00:00Z").toLocaleDateString("fa-IR", { month: "short", day: "numeric" }))} unit="گیگابایت" height={210} fmt={(v) => fa(v, 1)} />}
    </Card>
  );
}

/** owner: rows an old demo seed left in this database, and their removal (typed confirmation, audited) */
export function SeedDataCard() {
  const { notify } = useApp();
  const x = useRemote("seed-rows", () => dashboardApi.seedRows());
  const [typed, setTyped] = useState("");
  const r = x.data;
  if (x.error) return null;
  return (
    <Card title="داده‌های نمونه" icon="flask-conical" action={r && <Badge tone={r.total ? "amber" : "green"} dot>{r.total ? fa(r.total) + " ردیف نمونه" : "پاک"}</Badge>}>
      {!r ? <Loading /> : <div className="space-y-4">
        <p className="text-sm text-white/60 leading-7">ردیف‌هایی که داده نمونه (seed) نسخه نمایشی در این پایگاه داده گذاشته، با شناسه‌های ثابتشان. مشتریان واقعی هرگز در این فهرست نیستند؛ حساب نمونه‌ای که رکورد واقعی داشته باشد هم نگه داشته می‌شود.</p>
        {r.warnings.map((w) => <p key={w} role="alert" className="text-sm rounded-xl border border-rose-300/30 bg-rose-400/[0.08] text-rose-100 px-4 py-3 flex gap-2"><Icon name="triangle-alert" size={16} className="shrink-0 mt-1" />{w}</p>)}
        {r.total === 0 ? <p className="text-sm text-emerald-200 flex items-center gap-2"><Icon name="circle-check" size={16} />هیچ داده نمونه‌ای در پایگاه داده نیست.</p> : <>
          <ul className="divide-y divide-white/[0.06] text-sm">
            {r.items.map((i) => <li key={i.key} className="py-2.5 flex items-center justify-between gap-3"><span>{i.label}<span className="block text-[11px] text-white/50 ltr text-right mono truncate">{i.sample.join("، ")}{i.count > i.sample.length ? "…" : ""}</span></span><span className="tabular font-bold shrink-0">{fa(i.count)}</span></li>)}
            {r.fakeVirt && <li className="py-2.5">وضعیت ساختگی «متصل به Virtualizor 3.1.x» (بدون رمز ذخیره‌شده)</li>}
          </ul>
          <Field label={"برای حذف، بنویسید: حذف داده‌های نمونه"}><input value={typed} onChange={(e) => setTyped(e.target.value)} className={INPUT} aria-label="عبارت تأیید حذف داده‌های نمونه" /></Field>
          <AsyncButton className={"bg-rose-500/80 hover:bg-rose-500 text-white rounded-xl font-bold inline-flex items-center gap-2 " + BTN_MD} onClick={async () => {
            const out = await dashboardApi.removeSeedRows(typed);
            setTyped(""); x.reload();
            notify(fa(out.total) + " ردیف نمونه حذف شد" + (out.keptUsers.length ? "؛ " + fa(out.keptUsers.length) + " حساب نگه داشته شد" : ""));
          }}><Icon name="trash-2" size={16} />حذف فقط داده‌های نمونه</AsyncButton>
        </>}
        {r.posts > 0 && <p className="text-[11px] text-white/50 leading-6">{fa(r.posts)} مقاله وبلاگ نمونه هم هست؛ محتواست، نه آمار، پس خودکار حذف نمی‌شود. اگر نمی‌خواهیدشان، از بخش وبلاگ حذف کنید.</p>}
      </div>}
    </Card>
  );
}
