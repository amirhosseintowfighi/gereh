"use client";
import { useState } from "react";
import { BTN_G, INPUT } from "@/lib/cls";
import { fa, toEnDigits, toman } from "@/lib/format";
import { DISK_PRICE_GB, engineOf, stackOf } from "@/lib/paas";
import { api, useDB } from "@/lib/store";
import type { PaasPlanRow } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, PageTitle, StatCard, Switch, Tabs } from "../ui-client";
import { cpuLabel, ramLabel, StatusPill } from "./paas-shared";

const num = (s: string) => Number(toEnDigits(s).replace(/[^\d]/g, "")) || 0;

/** staff: every customer app and database, plans and the platform connection */
export function AdminPaas() {
  const db = useDB();
  const [tab, setTab] = useState("apps");
  const [q, setQ] = useState("");
  const owner = (uid: string) => db.users.find((u) => u.id === uid);
  const match = (name: string, uid: string) => !q || (name + " " + (owner(uid)?.name ?? "") + " " + (owner(uid)?.email ?? "")).toLowerCase().includes(q.toLowerCase());
  const apps = db.paasApps.filter((a) => match(a.name, a.userId));
  const dbs = db.paasDbs.filter((d) => match(d.name, d.userId));
  const runRate = [...db.paasApps, ...db.paasDbs].filter((x) => x.status !== "stopped" && x.status !== "suspended").reduce((s, x) => s + x.hourly * 720, 0);
  const failing = db.paasApps.filter((a) => a.status === "failed").length;

  return (
    <div>
      <PageTitle title="گره اپ (PaaS)" sub="اپ‌ها و پایگاه‌های داده مشتریان، پلن‌ها و اتصال به کلاستر." />
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <StatCard icon="rocket" label="اپ‌ها" value={db.paasApps.length} sub={fa(db.paasApps.filter((a) => a.status === "running").length) + " در حال اجرا"} />
        <StatCard icon="database" label="پایگاه‌های داده" value={db.paasDbs.length} sub={fa(db.paasDbs.filter((d) => d.status === "running").length) + " در حال اجرا"} />
        <StatCard icon="wallet" label="درآمد ماهانه جاری" value={fa(Math.round(runRate / 1e6 * 10) / 10, 1)} suffix="میلیون تومان" sub="بر اساس مصرف ساعتی فعلی" />
        <StatCard icon="circle-alert" label="اپ‌های ناموفق" value={failing} tone={failing ? "down" : ""} sub={fa(db.paasApps.filter((a) => a.status === "suspended").length + db.paasDbs.filter((d) => d.status === "suspended").length) + " سرویس معلق"} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Tabs size="sm" value={tab} onChange={setTab} label="بخش" options={[{ id: "apps", label: "اپ‌ها", icon: "rocket" }, { id: "dbs", label: "پایگاه داده", icon: "database" }, { id: "plans", label: "پلن‌ها", icon: "tag" }, { id: "platform", label: "زیرساخت", icon: "radio-tower" }]} />
        {(tab === "apps" || tab === "dbs") && <><label className="sr-only" htmlFor="paas-q">جستجو</label><input id="paas-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام، مشتری یا ایمیل" className={INPUT + " h-10 max-w-xs"} /></>}
      </div>

      {tab === "apps" && (
        <Card pad="p-0">
          {apps.length === 0 ? <div className="p-6"><Empty icon="rocket" title="اپی پیدا نشد" /></div> : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="اپ‌ها">
              <table className="w-full text-sm">
                <thead><tr className="text-white/55 text-xs text-right"><th className="p-3">اپ</th><th className="p-3">مشتری</th><th className="p-3">پشته / منبع</th><th className="p-3">منابع</th><th className="p-3">وضعیت</th><th className="p-3">هزینه</th><th className="p-3"><span className="sr-only">عملیات</span></th></tr></thead>
                <tbody>{apps.map((a) => {
                  const plan = db.paasPlans.find((p) => p.id === a.planId);
                  const last = a.deployments[0];
                  return (
                    <tr key={a.id} className="border-t border-white/[0.06] align-top">
                      <td className="p-3"><a href={a.url} target="_blank" rel="noopener" dir="ltr" className="font-bold hover:underline">{a.name}</a><span className="block text-[11px] text-white/45">{a.id} · {a.at}</span></td>
                      <td className="p-3">{owner(a.userId)?.name ?? a.userId}<span dir="ltr" className="block text-[11px] text-white/45 text-right">{owner(a.userId)?.email}</span></td>
                      <td className="p-3">{stackOf(a.stack)?.label ?? a.stack}<span className="block text-[11px] text-white/45" dir="ltr">{a.source === "git" ? a.gitUrl.replace(/^https:\/\/[^@]*@/, "https://") : a.source === "image" ? a.image : a.source}</span></td>
                      <td className="p-3 text-xs">{plan?.name ?? a.planId} × {fa(a.instances)}{a.autoscale ? " (تا " + fa(a.maxInstances) + ")" : ""}{a.diskGb ? " · " + fa(a.diskGb) + " گیگ" : ""}<span className="block text-white/45">{fa(a.domains.length)} دامنه · {fa(a.links.length)} پایگاه داده</span></td>
                      <td className="p-3"><StatusPill s={a.status} />{last && last.status === "failed" && <span className="block text-[11px] text-rose-300 mt-1">آخرین بیلد ناموفق</span>}</td>
                      <td className="p-3 tabular text-xs">{fa(a.hourly)} / ساعت</td>
                      <td className="p-3"><SuspendButton kind="app" id={a.id} suspended={a.status === "suspended"} name={a.name} /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "dbs" && (
        <Card pad="p-0">
          {dbs.length === 0 ? <div className="p-6"><Empty icon="database" title="پایگاه داده‌ای پیدا نشد" /></div> : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="پایگاه‌های داده">
              <table className="w-full text-sm">
                <thead><tr className="text-white/55 text-xs text-right"><th className="p-3">نام</th><th className="p-3">مشتری</th><th className="p-3">موتور</th><th className="p-3">پلن</th><th className="p-3">پشتیبان</th><th className="p-3">وضعیت</th><th className="p-3">هزینه</th><th className="p-3"><span className="sr-only">عملیات</span></th></tr></thead>
                <tbody>{dbs.map((d) => {
                  const plan = db.paasPlans.find((p) => p.id === d.planId);
                  const lastBk = d.backupList[0];
                  return (
                    <tr key={d.id} className="border-t border-white/[0.06] align-top">
                      <td className="p-3"><b dir="ltr">{d.name}</b><span className="block text-[11px] text-white/45">{d.id} · {d.links.length ? "← " + d.links.map((l) => l.appName).join("، ") : "بدون اتصال"}</span></td>
                      <td className="p-3">{owner(d.userId)?.name ?? d.userId}</td>
                      <td className="p-3">{engineOf(d.engine)?.label ?? d.engine} {d.version}{d.publicAccess && <Badge tone="amber">عمومی</Badge>}</td>
                      <td className="p-3 text-xs">{plan ? plan.name + " · " + fa(plan.diskGb) + " گیگ" : d.planId}</td>
                      <td className="p-3 text-xs">{d.backups ? "روزانه" : "خاموش"}<span className="block text-white/45">{lastBk ? "آخرین: " + lastBk.at : "هنوز ندارد"}</span></td>
                      <td className="p-3"><StatusPill s={d.status} /></td>
                      <td className="p-3 tabular text-xs">{fa(d.hourly)} / ساعت</td>
                      <td className="p-3"><SuspendButton kind="db" id={d.id} suspended={d.status === "suspended"} name={d.name} /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "plans" && (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          {(["app", "db"] as const).map((kind) => (
            <Card key={kind} title={kind === "app" ? "پلن‌های اپ (هر نمونه)" : "پلن‌های پایگاه داده"} icon={kind === "app" ? "rocket" : "database"} pad="p-3 sm:p-4">
              <ul className="space-y-1">{db.paasPlans.filter((p) => p.kind === kind).map((p) => <PlanRow key={p.id} p={p} />)}</ul>
            </Card>
          ))}
          <p className="text-[11px] text-white/50 lg:col-span-2">قیمت‌ها ماهانه است؛ کسر ساعتی = قیمت ÷ ۷۲۰ (رو به بالا). تغییر قیمت از ساعت بعد روی همه سرویس‌های همان پلن اعمال می‌شود. دیسک دائمی اپ‌ها ماهانه {toman(DISK_PRICE_GB)} هر گیگ.</p>
        </div>
      )}

      {tab === "platform" && <Platform />}
    </div>
  );
}

function SuspendButton({ kind, id, suspended, name }: { kind: "app" | "db"; id: string; suspended: boolean; name: string }) {
  const { notify } = useApp();
  return suspended
    ? <AsyncButton className={BTN_G + " h-8 px-3 text-xs"} confirmText={"«" + name + "» دوباره روشن شود؟"} onClick={async () => { await api.paas.adminSuspend(kind, id, false); notify("رفع تعلیق شد", "play"); }}><Icon name="play" size={13} />رفع تعلیق</AsyncButton>
    : <AsyncButton danger className={BTN_G + " h-8 px-3 text-xs"} confirmText={"«" + name + "» معلق و خاموش شود؟ مشتری تا رفع تعلیق نمی‌تواند روشنش کند."} onClick={async () => { await api.paas.adminSuspend(kind, id, true); notify("معلق شد", "pause"); }}><Icon name="pause" size={13} />تعلیق</AsyncButton>;
}

function PlanRow({ p }: { p: PaasPlanRow }) {
  const { notify } = useApp();
  const [name, setName] = useState(p.name);
  const [price, setPrice] = useState(String(p.price));
  const dirty = name !== p.name || num(price) !== p.price;
  return (
    <li className="p-3 rounded-xl hover:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] text-white/55">{p.id} · {cpuLabel(p.cpu)} · {ramLabel(p.ramMb)}{p.diskGb ? " · " + fa(p.diskGb) + " گیگ" : ""}</span>
        <Switch on={p.active} onChange={async (v) => { await api.paas.adminPlan(p.id, { active: v }); notify(v ? "پلن فعال شد" : "پلن برای سفارش جدید غیرفعال شد", "tag"); }} label={"فعال بودن " + p.name} />
      </div>
      <div className="grid grid-cols-[1fr_9rem_auto] gap-2 items-center">
        <label className="sr-only" htmlFor={"pn-" + p.id}>نام {p.id}</label>
        <input id={"pn-" + p.id} value={name} onChange={(e) => setName(e.target.value)} className={INPUT + " h-10"} />
        <label className="sr-only" htmlFor={"pp-" + p.id}>قیمت ماهانه {p.id}</label>
        <input id={"pp-" + p.id} value={price} inputMode="numeric" onChange={(e) => setPrice(e.target.value)} dir="ltr" className={INPUT + " h-10 text-left tabular"} />
        <AsyncButton disabled={!dirty} className={BTN_G + " h-10 px-3 text-xs"} onClick={async () => { await api.paas.adminPlan(p.id, { name, price: num(price) }); notify("ذخیره شد · " + toman(num(price)), "check"); }}>ذخیره</AsyncButton>
      </div>
    </li>
  );
}

function Platform() {
  const db = useDB();
  const { notify } = useApp();
  const [domain, setDomain] = useState(db.settings.paasDomain);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const sim = db.paasDriver !== "kubernetes";
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="اتصال به کلاستر" icon="radio-tower">
        <div className="flex items-center gap-2 mb-3"><span className="text-sm">درایور فعلی:</span>{sim ? <Badge tone="amber" dot>شبیه‌ساز</Badge> : <Badge tone="green" dot>Kubernetes</Badge>}</div>
        <p className="text-sm text-white/65 leading-7">
          {sim ? "هنوز به کلاستر وصل نیست؛ اپ‌ها شبیه‌سازی می‌شوند (برای توسعه و دمو). برای اتصال واقعی، متغیرهای PAAS_K8S_API و PAAS_K8S_TOKEN را در فایل env سرور بگذارید و سرویس را ری‌استارت کنید (راهنما: deploy/paas/README.md)."
            : "اپ‌ها روی کلاستر Kubernetes بیلد و اجرا می‌شوند. هر مشتری یک namespace جدا دارد."}
        </p>
        <AsyncButton className={BTN_G + " h-9 px-3 text-xs mt-4"} onClick={async () => {
          try { const r = await api.paas.adminTest(); setTest({ ok: true, text: r.driver + " · " + r.version }); }
          catch (e) { setTest({ ok: false, text: (e as Error).message }); }
        }}><Icon name="activity" size={13} />تست اتصال</AsyncButton>
        {test && <p role="status" className={"text-sm mt-3 " + (test.ok ? "text-emerald-300" : "text-rose-300")}>{test.ok ? "اتصال برقرار است: " : "خطا: "}<span dir="ltr">{test.text}</span></p>}
      </Card>
      <Card title="دامنه اپ‌ها" icon="globe">
        <Field label="دامنه" hint="آدرس پیش‌فرض اپ‌ها <نام>.<این دامنه> می‌شود. باید دامنه‌ای جدا از سایت اصلی باشد (برای جدا ماندن کوکی‌ها) و رکورد wildcard آن به ingress کلاستر اشاره کند.">
          <input value={domain} onChange={(e) => setDomain(e.target.value.trim().toLowerCase())} dir="ltr" placeholder="gereh.dev" className={INPUT + " text-left"} />
        </Field>
        <AsyncButton disabled={!domain || domain === db.settings.paasDomain} className="mt-3" confirmText="آدرس پیش‌فرض همه اپ‌ها عوض می‌شود. ادامه؟" onClick={async () => { await api.admin.saveSettings({ paasDomain: domain }); notify("دامنه اپ‌ها ذخیره شد", "globe"); }}>ذخیره</AsyncButton>
        <div className="mt-4 text-[11px] text-white/55 leading-6" dir="ltr">*.{domain || "gereh.dev"} → A → INGRESS_IP</div>
      </Card>
    </div>
  );
}
