"use client";
/* Cloud-server extra tabs: extra IPv4 + PTR, network reset, extra disks, snapshot schedule, real
   traffic metering, noVNC console, plan change while stopped, firewall groups, project wallet. */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PLAN_NUMS, VPS } from "@/lib/catalog";
import { BTN_G, BTN_MD, BTN_P, BTN_SM, INPUT, INPUT_BASE } from "@/lib/cls";
import { fa, toEnDigits, toman } from "@/lib/format";
import { useDB, type Server } from "@/lib/store";
import { WEEKDAYS, type FwRuleIn, type VpsExtrasView } from "@/lib/vps-billing";
import { billingApi, vpsApi } from "@/lib/vps-billing-api";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field, Meter } from "../ui";
import { AsyncButton, IconBtn, Modal, Select, StatCard, Switch } from "../ui-client";

/** loads a read-only view; `key` decides when to load again, reload() forces it */
export function useRemote<T>(key: string, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load().then((data) => { if (live) setState({ key, data, error: "" }); }, (e: Error) => { if (live) setState((s) => ({ ...s, key, error: e.message })); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return { data: state.data, error: state.error, reload: () => setTick((t) => t + 1) };
}
export const Loading = () => <div className="py-10 grid place-items-center" aria-busy="true"><Icon name="loader-circle" size={22} className="animate-spin text-white/50" /></div>;
const useExtras = (sid: string) => useRemote(sid, () => vpsApi.extras(sid));
const num = (v: string) => +toEnDigits(v).replace(/\D/g, "") || 0;
const FQDN_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function Wrap({ x, children }: { x: ReturnType<typeof useExtras>; children: (v: VpsExtrasView) => React.ReactNode }) {
  if (x.error) return <Card><Empty icon="circle-alert" title="بارگذاری نشد" text={x.error} /></Card>;
  if (!x.data) return <Card><Loading /></Card>;
  return <>{children(x.data)}</>;
}

/* ---------- network: IPs, PTR, reset ---------- */
export function NetworkExtras({ s }: { s: Server }) {
  const x = useExtras(s.id);
  const { notify } = useApp();
  return <Wrap x={x}>{(v) => (
    <Card title="آدرس‌های IPv4 و Reverse DNS" icon="hash" className="lg:col-span-2" action={
      <AsyncButton className={BTN_P + BTN_SM} disabled={v.ips.length - 1 >= v.prices.maxIps} confirmText={"یک IPv4 اضافه با هزینه " + toman(v.prices.ip) + " در ماه (ساعتی از کیف پول) اضافه شود؟"}
        onClick={async () => { const ip = await vpsApi.addIp(s.id); notify("IPv4 " + ip + " اضافه شد", "hash"); x.reload(); }}><Icon name="plus" size={15} /> IPv4 اضافه</AsyncButton>} pad="p-3 sm:p-4">
      <div className="space-y-2">{v.ips.map((ip) => <PtrRow key={ip.id} sid={s.id} ip={ip} onDone={x.reload} />)}</div>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.07]">
        <p className="text-xs text-white/55 leading-6">بازنشانی شبکه، پیکربندی کارت شبکه را از روی آدرس‌های بالا بازسازی می‌کند (برای وقتی که دسترسی شبکه با تغییر تنظیمات از دست رفته است).</p>
        <AsyncButton className={BTN_G + BTN_SM} confirmText="تنظیمات شبکه سرور بازنشانی و سرور ری‌استارت شود؟" onClick={async () => { await vpsApi.networkReset(s.id); notify("بازنشانی شبکه انجام شد", "network"); }}><Icon name="refresh-cw" size={14} /> بازنشانی شبکه</AsyncButton>
      </div>
    </Card>
  )}</Wrap>;
}

function PtrRow({ sid, ip, onDone }: { sid: string; ip: VpsExtrasView["ips"][number]; onDone: () => void }) {
  const { notify, confirm } = useApp();
  const [ptr, setPtr] = useState(ip.rdns);
  return (
    <div className="grid sm:grid-cols-[180px_1fr_auto] gap-2 items-center p-3 rounded-xl hover:bg-white/[0.03]">
      <div className="flex items-center gap-2"><span className="mono text-sm ltr">{ip.ip}</span>{ip.primary ? <Badge>اصلی</Badge> : <Badge tone="blue">{toman(ip.price)}/ماه</Badge>}</div>
      <input value={ptr} onChange={(e) => setPtr(e.target.value)} dir="ltr" placeholder="PTR، مثلا mail.example.com" aria-label={"PTR برای " + ip.ip} className={INPUT_BASE + " h-9 text-left text-xs"} />
      <div className="flex gap-1 justify-end">
        <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { const h = ptr.trim().toLowerCase().replace(/\.$/, ""); if (h && !FQDN_RE.test(h)) throw new Error("نام دامنه معتبر نیست."); await vpsApi.setPtr(sid, ip.id, h); notify("PTR ذخیره شد"); onDone(); }}>ذخیره</AsyncButton>
        {!ip.primary && <IconBtn icon="trash-2" label={"حذف " + ip.ip} className="hover:text-rose-300" onClick={async () => { if (await confirm("آدرس " + ip.ip + " حذف و به استخر برگردانده شود؟", { danger: true, ok: "حذف" })) { await vpsApi.removeIp(sid, ip.id); notify("آدرس حذف شد"); onDone(); } }} />}
      </div>
    </div>
  );
}

/* ---------- disks ---------- */
export function DisksPanel({ s }: { s: Server }) {
  const x = useExtras(s.id);
  const { notify, confirm } = useApp();
  const [add, setAdd] = useState<{ name: string; size: string } | null>(null);
  const [grow, setGrow] = useState<{ id: string; name: string; size: string; min: number } | null>(null);
  return <Wrap x={x}>{(v) => <>
    <Card title="دیسک‌های اضافه" icon="hard-drive" action={<button type="button" disabled={v.disks.length >= v.prices.maxDisks} onClick={() => setAdd({ name: "data", size: "50" })} className={BTN_P + BTN_SM}><Icon name="plus" size={15} /> دیسک جدید</button>} pad="p-3 sm:p-4">
      <p className="text-xs text-white/55 leading-6 px-2 mb-3">هر گیگابایت {toman(v.prices.diskGb)} در ماه، ساعتی از کیف پول. اندازه دیسک فقط افزایش می‌یابد؛ پس از افزایش، پارتیشن را در سیستم‌عامل بزرگ کنید. دیسک جداشده داده‌هایش را نگه می‌دارد و به سرورهای همین موقعیت وصل می‌شود.</p>
      {v.disks.length === 0 ? <Empty icon="hard-drive" title="دیسک اضافه‌ای ندارید" text="برای داده، لاگ یا بکاپ، یک دیسک جدا بسازید." /> : v.disks.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
          <div className="flex items-center gap-3"><Icon name="hard-drive" size={17} className="text-white/55" /><div><div className="text-sm font-bold ltr text-right">{d.name}</div><div className="text-[11px] text-white/55">{fa(d.sizeGb)} گیگابایت، اسلات {fa(d.slot ?? 0)}، {d.at}</div></div></div>
          <div className="flex gap-1">
            <button type="button" onClick={() => setGrow({ id: d.id, name: d.name, size: String(d.sizeGb + 10), min: d.sizeGb + 1 })} className={BTN_G + BTN_SM}>افزایش اندازه</button>
            <AsyncButton className={BTN_G + BTN_SM} confirmText={"دیسک " + d.name + " از سرور جدا شود؟ پیش از آن، آن را در سیستم‌عامل unmount کنید."} onClick={async () => { await vpsApi.detachDisk(d.id); notify("دیسک جدا شد"); x.reload(); }}>جدا کردن</AsyncButton>
          </div>
        </div>
      ))}
    </Card>
    {v.spareDisks.length > 0 && <Card className="mt-4" title="دیسک‌های جداشده در این موقعیت" icon="unplug" pad="p-3 sm:p-4">
      {v.spareDisks.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
          <div className="text-sm"><span className="font-bold ltr">{d.name}</span> <span className="text-white/55 text-xs">{fa(d.sizeGb)} گیگابایت</span></div>
          <div className="flex gap-1">
            <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { await vpsApi.attachDisk(d.id, s.id); notify("دیسک وصل شد"); x.reload(); }}>اتصال به این سرور</AsyncButton>
            <IconBtn icon="trash-2" label={"حذف دیسک " + d.name} className="hover:text-rose-300" onClick={async () => { if (await confirm("دیسک " + d.name + " و همه داده‌هایش برای همیشه حذف شود؟", { danger: true, ok: "حذف" })) { await vpsApi.deleteDisk(d.id, d.name); notify("دیسک حذف شد"); x.reload(); } }} />
          </div>
        </div>
      ))}
    </Card>}
    <Modal open={!!add} onClose={() => setAdd(null)} title="دیسک جدید" icon="hard-drive" footer={<><button type="button" onClick={() => setAdd(null)} className={BTN_G + BTN_MD}>انصراف</button>
      <AsyncButton onClick={async () => { if (!add) return; await vpsApi.addDisk(s.id, { name: add.name.trim().toLowerCase(), sizeGb: num(add.size) }); setAdd(null); notify("دیسک ساخته و وصل شد", "hard-drive"); x.reload(); }}>ساخت</AsyncButton></>}>
      {add && <div className="grid grid-cols-2 gap-4">
        <Field label="نام" hint="حروف کوچک انگلیسی، عدد و خط تیره"><input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} /></Field>
        <Field label="اندازه (گیگابایت)" hint={"حداکثر " + fa(v.prices.maxDiskGb)}><input value={add.size} onChange={(e) => setAdd({ ...add, size: e.target.value })} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} /></Field>
        <p className="col-span-2 text-xs text-white/55">هزینه ماهانه: {toman(num(add.size) * v.prices.diskGb)}</p>
      </div>}
    </Modal>
    <Modal open={!!grow} onClose={() => setGrow(null)} title={"افزایش دیسک " + (grow?.name ?? "")} icon="hard-drive" footer={<><button type="button" onClick={() => setGrow(null)} className={BTN_G + BTN_MD}>انصراف</button>
      <AsyncButton onClick={async () => { if (!grow) return; await vpsApi.resizeDisk(grow.id, num(grow.size)); setGrow(null); notify("اندازه دیسک افزایش یافت"); x.reload(); }}>اعمال</AsyncButton></>}>
      {grow && <Field label="اندازه جدید (گیگابایت)" hint={"دست‌کم " + fa(grow.min)}><input value={grow.size} onChange={(e) => setGrow({ ...grow, size: e.target.value })} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} /></Field>}
    </Modal>
  </>}</Wrap>;
}

/* ---------- snapshot schedule ---------- */
export function SnapSchedule({ s }: { s: Server }) {
  const x = useExtras(s.id);
  return <Wrap x={x}>{(v) => <SnapForm key={JSON.stringify(v.schedule)} s={s} v={v} reload={x.reload} />}</Wrap>;
}
function SnapForm({ s, v, reload }: { s: Server; v: VpsExtrasView; reload: () => void }) {
  const { notify } = useApp();
  const [f, setF] = useState({ frequency: v.schedule?.frequency ?? "daily", retention: String(v.schedule?.retention ?? 3), hour: String(v.schedule?.hour ?? 3), weekday: String(v.schedule?.weekday ?? 5) });
  return (
    <Card title="اسنپ‌شات زمان‌بندی‌شده" icon="calendar-clock" className="lg:col-span-2" action={<Badge tone={v.schedule ? "green" : "gray"}>{v.schedule ? "فعال" : "خاموش"}</Badge>}>
      <p className="text-xs text-white/55 leading-6 mb-4">اسنپ‌شات‌های خودکار با پیشوند auto- ساخته می‌شوند و فقط تعداد تعیین‌شده از جدیدترین‌ها نگه داشته می‌شود. فضای اسنپ‌شات‌ها بیش از ۱۰٪ دیسک، هر گیگابایت {toman(v.prices.snapshotGb)} در ماه هزینه دارد (اکنون {fa(v.snapshotGb, 1)} گیگابایت).</p>
      <div className="grid sm:grid-cols-4 gap-3">
        <Field label="تکرار"><Select label="تکرار" value={f.frequency} onChange={(x) => setF({ ...f, frequency: x as "daily" | "weekly" })} options={[{ value: "daily", label: "روزانه" }, { value: "weekly", label: "هفتگی" }]} /></Field>
        {f.frequency === "weekly" && <Field label="روز"><Select label="روز هفته" value={f.weekday} onChange={(x) => setF({ ...f, weekday: x })} options={WEEKDAYS.map((w, i) => ({ value: String(i), label: w }))} /></Field>}
        <Field label="ساعت (تهران)"><Select label="ساعت" value={f.hour} onChange={(x) => setF({ ...f, hour: x })} options={Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: fa(i) + ":۰۰" }))} /></Field>
        <Field label="نگهداری (تعداد)"><Select label="تعداد نگهداری" value={f.retention} onChange={(x) => setF({ ...f, retention: x })} options={Array.from({ length: 14 }, (_, i) => ({ value: String(i + 1), label: fa(i + 1) }))} /></Field>
      </div>
      {v.schedule && <p className="text-[11px] text-white/55 mt-3">اجرای بعدی: {v.schedule.next}{v.schedule.last ? "، آخرین اجرا: " + v.schedule.last : ""}</p>}
      <div className="mt-4 flex justify-end gap-2">
        {v.schedule && <AsyncButton className={BTN_G + BTN_MD} onClick={async () => { await vpsApi.setSnapSchedule(s.id, null); notify("زمان‌بندی حذف شد"); reload(); }}>خاموش کردن</AsyncButton>}
        <AsyncButton onClick={async () => { await vpsApi.setSnapSchedule(s.id, { frequency: f.frequency, retention: +f.retention, hour: +f.hour, weekday: +f.weekday }); notify("زمان‌بندی ذخیره شد", "calendar-clock"); reload(); }}>ذخیره</AsyncButton>
      </div>
    </Card>
  );
}

/* ---------- traffic ---------- */
export function TrafficPanel({ s }: { s: Server }) {
  const x = useExtras(s.id);
  const { notify } = useApp();
  return <Wrap x={x}>{(v) => {
    const t = v.traffic;
    const totIn = t.days.reduce((a, d) => a + d.inGb, 0), totOut = t.days.reduce((a, d) => a + d.outGb, 0);
    const peak = Math.max(...t.days.map((d) => d.inGb + d.outGb), 1);
    const pct = t.quotaGb ? Math.round((t.usedGb / t.quotaGb) * 100) : 0;
    return (
      <div className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-4">
          <StatCard icon="arrow-down-up" label="مصرف این ماه" value={Math.round(t.usedGb)} suffix="گیگابایت" sub={fa(pct) + "٪ سهمیه"} />
          <StatCard icon="trending-up" label="خروجی (out)" value={Math.round(totOut)} suffix="گیگابایت" />
          <StatCard icon="activity" label="ورودی (in)" value={Math.round(totIn)} suffix="گیگابایت" />
        </div>
        <Card title="ترافیک روزانه" icon="activity">
          <div className="mb-6"><Meter label="سهمیه ماهانه" value={t.usedGb} max={t.quotaGb} right={fa(Math.round(t.usedGb)) + " از " + fa(t.quotaGb) + " گیگابایت" + (t.extraGb ? " (" + fa(t.planGb) + " پلن + " + fa(t.extraGb) + " بسته)" : "")} /></div>
          {t.days.length === 0 ? <Empty icon="activity" title="هنوز داده‌ای ثبت نشده" text="مصرف هر ساعت از Virtualizor خوانده می‌شود." /> : <>
            <div className="flex items-end gap-[3px] h-48" role="img" aria-label={"ترافیک روزانه، مجموع " + fa(Math.round(t.usedGb)) + " گیگابایت"}>
              {t.days.map((d) => (
                <div key={d.day} className="group relative flex-1 h-full flex flex-col justify-end gap-[2px]" title={d.day + ": ورودی " + fa(d.inGb, 1) + "، خروجی " + fa(d.outGb, 1) + " گیگ"}>
                  <div className="rounded-t-[3px] bg-[#9cc9ff]/80 group-hover:bg-[#9cc9ff]" style={{ height: (d.outGb / peak) * 100 + "%" }} />
                  <div className="rounded-b-[3px] bg-white/25 group-hover:bg-white/40" style={{ height: (d.inGb / peak) * 100 + "%" }} />
                </div>
              ))}
            </div>
            <div className="flex gap-5 mt-4 text-xs text-white/55"><span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-[#9cc9ff]/80" />خروجی</span><span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-white/25" />ورودی</span></div>
          </>}
        </Card>
        <Card title="بسته ترافیک" icon="package-plus" action={<Switch on={t.autoBuy} label="خرید خودکار بسته" onChange={async (on) => { await vpsApi.setTrafficAutoBuy(s.id, on); notify(on ? "خرید خودکار روشن شد" : "خرید خودکار خاموش شد"); x.reload(); }} />}>
          <p className="text-sm text-white/55 leading-7">در ۸۰٪ و ۱۰۰٪ سهمیه اعلان می‌گیرید. با خرید خودکار، هنگام اتمام سهمیه یک بسته {fa(v.prices.packGb)} گیگابایتی به قیمت {toman(v.prices.packPrice)} از کیف پول خریده می‌شود. این ماه {fa(t.packs)} بسته خریده‌اید.</p>
          <div className="mt-4 flex justify-end"><AsyncButton confirmText={"یک بسته " + fa(v.prices.packGb) + " گیگابایتی به قیمت " + toman(v.prices.packPrice) + " از کیف پول خریده شود؟"} onClick={async () => { await vpsApi.buyTraffic(s.id); notify("بسته ترافیک اضافه شد", "package-plus"); x.reload(); }}>خرید بسته</AsyncButton></div>
        </Card>
      </div>
    );
  }}</Wrap>;
}

/* ---------- console (noVNC) ---------- */
const NOVNC = "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.5.0/core/rfb.js";
type Rfb = { scaleViewport: boolean; disconnect(): void; sendCtrlAltDel(): void; addEventListener(t: string, f: (e: { detail?: { clean?: boolean } }) => void): void };
/** the real console when the hypervisor exposes a websocket; otherwise the fallback (simulator) */
export function VncScreen({ s, fallback }: { s: Server; fallback: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const rfb = useRef<Rfb | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "connected" | "fallback" | "error">(s.status === "running" ? "connecting" : "fallback");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (s.status !== "running") return;
    let live = true;
    (async () => {
      try {
        const v = await vpsApi.vnc(s.id);
        if (!live) return;
        if (!v.ws) { setState("fallback"); return; }
        const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ NOVNC)) as { default: new (el: HTMLElement, url: string, o: object) => Rfb };
        if (!live || !box.current) return;
        const r = new mod.default(box.current, v.ws, { credentials: { password: v.password } });
        r.scaleViewport = true;
        r.addEventListener("connect", () => setState("connected"));
        r.addEventListener("disconnect", (e) => { setState(e.detail?.clean ? "idle" : "error"); setMsg(e.detail?.clean ? "" : "اتصال کنسول قطع شد."); });
        rfb.current = r;
      } catch (e) { if (live) { setState("error"); setMsg((e as Error).message); } }
    })();
    return () => { live = false; rfb.current?.disconnect(); rfb.current = null; };
  }, [s.id, s.status]);
  if (state === "fallback") return <>{fallback}</>;
  return (
    <div className="bg-[#020306]">
      <div className="flex items-center justify-between px-4 h-9 text-[11px] text-white/55 border-b border-white/[0.07]" dir="ltr">
        <span className="mono">noVNC — {s.name}</span>
        <span className="flex items-center gap-2">
          {state === "connected" && <button type="button" onClick={() => rfb.current?.sendCtrlAltDel()} className="px-2 h-6 rounded hover:bg-white/10">Ctrl+Alt+Del</button>}
          <span className={state === "connected" ? "text-emerald-300" : state === "error" ? "text-rose-300" : "text-white/50"}>● {state}</span>
        </span>
      </div>
      <div ref={box} className="h-[420px] w-full" />
      {msg && <p className="text-xs text-rose-200 p-3" role="alert">{msg}</p>}
    </div>
  );
}
export function VncFullPage({ id }: { id: string }) {
  const db = useDB();
  const s = db.servers.find((x) => x.id === id);
  if (!s) return <Card><Empty icon="server" title="سرور پیدا نشد" /></Card>;
  if (!s.vpsid) return <Card><Empty icon="loader-circle" title="سرور هنوز در حال آماده‌سازی است" text="کنسول پس از تحویل سرور در دسترس است." action={<Link href={`/panel/servers/${s.id}`} className={BTN_G + BTN_SM}>بازگشت به سرور</Link>} /></Card>;
  return (
    <div>
      <div className="flex items-center justify-between mb-4"><h1 className="text-xl font-black">کنسول <span className="ltr inline-block">{s.name}</span></h1><Link href={`/panel/servers/${s.id}`} className={BTN_G + BTN_SM}>بازگشت به سرور</Link></div>
      <div className="rounded-[14px] overflow-hidden border border-white/[0.1]"><VncScreen s={s} fallback={<Empty icon="monitor-smartphone" title={s.status === "running" ? "کنسول وب در این محیط در دسترس نیست" : "سرور خاموش است"} text="در محیط آزمایشی، کنسول شبیه‌سازی‌شده در صفحه سرور نمایش داده می‌شود." />} /></div>
    </div>
  );
}

/* ---------- plan change while stopped ---------- */
export function PlanChange({ s }: { s: Server }) {
  const { notify } = useApp();
  const db = useDB();
  const [plan, setPlan] = useState("");
  const list = db.plans.cloud.length ? db.plans.cloud : VPS.cloud;
  const stopped = s.status === "stopped";
  return (
    <Card title="تغییر پلن (افزایش یا کاهش)" icon="arrow-up-down" className="mt-4">
      <p className="text-sm text-white/50 mb-5 leading-7">برای کاهش منابع، سرور باید خاموش باشد. فضای دیسک هیچ‌وقت کم نمی‌شود: در پلن کوچک‌تر، دیسک فعلی ({fa(s.disk)} گیگ) حفظ و مازاد آن جداگانه حساب می‌شود. مابه‌التفاوت روزهای باقی‌مانده به کیف پول برمی‌گردد یا صورتحساب می‌شود.</p>
      {!stopped && <div role="status" className="rounded-xl bg-amber-500/[0.08] border border-amber-300/20 p-3 text-xs text-amber-100 mb-4">سرور روشن است؛ ابتدا آن را خاموش کنید.</div>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3" role="radiogroup" aria-label="پلن مقصد">
        {list.filter((p) => PLAN_NUMS[p.id] && p.active !== false).map((p) => {
          const [c, r, d] = PLAN_NUMS[p.id];
          const cur = p.name === s.plan;
          return (
            <button type="button" role="radio" aria-checked={plan === p.id} key={p.id} disabled={cur || !stopped} onClick={() => setPlan(p.id)}
              className={"rounded-2xl p-4 text-right border transition " + (cur || !stopped ? "opacity-50 cursor-not-allowed border-white/10" : plan === p.id ? "bg-white/[0.1] border-white/40" : "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]")}>
              <div className="flex justify-between"><span className="font-bold">{p.name}</span>{cur && <Badge>فعلی</Badge>}</div>
              <div className="text-xs text-white/50 mt-2">{fa(c)} هسته، {fa(r)} گیگ رم، {fa(Math.max(d, s.disk))} گیگ</div>
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex justify-end"><AsyncButton disabled={!plan || !stopped} onClick={async () => { await vpsApi.changePlan(s.id, plan); setPlan(""); notify("پلن سرور تغییر کرد", "arrow-up-down"); }}>اعمال پلن</AsyncButton></div>
    </Card>
  );
}

/* ---------- firewall groups ---------- */
export function FirewallGroups({ s }: { s: Server }) {
  const x = useExtras(s.id);
  const { notify, confirm } = useApp();
  const [edit, setEdit] = useState<{ id?: string; name: string; rules: FwRuleIn[] } | null>(null);
  const blank: FwRuleIn = { proto: "TCP", port: "", source: "0.0.0.0/0", action: "allow", note: "" };
  return <Wrap x={x}>{(v) => <>
    <Card className="mt-4" title="گروه‌های فایروال ابری" icon="shield-plus" action={<button type="button" onClick={() => setEdit({ name: "", rules: [{ ...blank, port: "22", note: "SSH" }] })} className={BTN_P + BTN_SM}><Icon name="plus" size={15} /> گروه جدید</button>} pad="p-3 sm:p-4">
      <p className="text-xs text-white/55 leading-6 px-2 mb-3">یک مجموعه قانون بسازید و روی چند سرور اعمال کنید؛ تغییر گروه روی همه سرورهای متصل اعمال می‌شود. قوانین گروه در کنار قوانین اختصاصی همین سرور اجرا می‌شوند.</p>
      {v.groups.length === 0 ? <Empty icon="shield" title="گروهی ندارید" /> : v.groups.map((g) => (
        <div key={g.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
          <div><div className="text-sm font-bold">{g.name}</div><div className="text-[11px] text-white/55">{fa(g.rules.length)} قانون، روی {fa(g.servers)} سرور</div></div>
          <div className="flex items-center gap-2">
            <Switch on={g.attached} label={"اعمال " + g.name + " روی این سرور"} onChange={async (on) => { await vpsApi.fwGroupAttach(g.id, s.id, on); notify(on ? "گروه اعمال شد" : "گروه برداشته شد"); x.reload(); }} />
            <IconBtn icon="pencil" label={"ویرایش " + g.name} onClick={() => setEdit({ id: g.id, name: g.name, rules: g.rules })} />
            <IconBtn icon="trash-2" label={"حذف " + g.name} className="hover:text-rose-300" onClick={async () => { if (await confirm("گروه " + g.name + " از همه سرورها برداشته و حذف شود؟", { danger: true, ok: "حذف" })) { await vpsApi.fwGroupDelete(g.id); x.reload(); } }} />
          </div>
        </div>
      ))}
    </Card>
    <Modal open={!!edit} onClose={() => setEdit(null)} size="max-w-3xl" title={edit?.id ? "ویرایش گروه فایروال" : "گروه فایروال جدید"} icon="shield-plus" footer={<><button type="button" onClick={() => setEdit(null)} className={BTN_G + BTN_MD}>انصراف</button>
      <AsyncButton onClick={async () => { if (!edit) return; await vpsApi.fwGroupSave(edit); setEdit(null); notify("گروه ذخیره شد"); x.reload(); }}>ذخیره</AsyncButton></>}>
      {edit && <div className="space-y-3">
        <Field label="نام گروه"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={INPUT} /></Field>
        {edit.rules.map((r, i) => {
          const set = (p: Partial<FwRuleIn>) => setEdit({ ...edit, rules: edit.rules.map((y, j) => (j === i ? { ...y, ...p } : y)) });
          return (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-[90px_1fr_1fr_100px_1fr_auto] gap-2 items-center">
              <Select label="پروتکل" value={r.proto} onChange={(p) => set({ proto: p })} options={["TCP", "UDP", "ICMP"]} ltr />
              <input value={r.proto === "ICMP" ? "—" : r.port} disabled={r.proto === "ICMP"} onChange={(e) => set({ port: e.target.value })} dir="ltr" placeholder="پورت" aria-label="پورت" className={INPUT + " text-left mono text-xs"} />
              <input value={r.source} onChange={(e) => set({ source: e.target.value })} dir="ltr" aria-label="مبدأ" className={INPUT + " text-left mono text-xs"} />
              <Select label="عملکرد" value={r.action} onChange={(a) => set({ action: a as "allow" | "deny" })} options={[{ value: "allow", label: "اجازه" }, { value: "deny", label: "مسدود" }]} />
              <input value={r.note} maxLength={60} onChange={(e) => set({ note: e.target.value })} placeholder="توضیح" aria-label="توضیح" className={INPUT + " text-xs"} />
              <IconBtn icon="x" label="حذف قانون" onClick={() => setEdit({ ...edit, rules: edit.rules.filter((_, j) => j !== i) })} />
            </div>
          );
        })}
        <button type="button" onClick={() => setEdit({ ...edit, rules: [...edit.rules, { ...blank }] })} className={BTN_G + BTN_SM}><Icon name="plus" size={14} /> قانون</button>
      </div>}
    </Modal>
  </>}</Wrap>;
}

/* ---------- project wallet ---------- */
export function WalletLink({ s }: { s: Server }) {
  const x = useExtras(s.id);
  const w = useRemote("wallets", () => billingApi.extras());
  const { notify } = useApp();
  if (!x.data || !w.data) return null;
  const wallets = w.data.wallets;
  return (
    <Card title="کیف پول پروژه" icon="wallet">
      <p className="text-sm text-white/55 leading-7 mb-4">هزینه‌های ساعتی این سرور و افزونه‌هایش ابتدا از کیف پول پروژه کسر می‌شود و اگر کافی نباشد از کیف پول اصلی. هزینه ماهانه افزونه‌ها اکنون {toman(x.data.addonsMonthly)} است.</p>
      {wallets.length === 0 ? <p className="text-xs text-white/55">کیف پول پروژه‌ای ندارید؛ از بخش <Link href="/panel/billing" className="underline">صورتحساب</Link> بسازید.</p>
        : <Select label="کیف پول" value={x.data.wallet?.id ?? ""} onChange={async (id) => { await billingApi.linkServer(s.id, id || null); notify("کیف پول سرور تغییر کرد", "wallet"); x.reload(); }} options={[{ value: "", label: "کیف پول اصلی" }, ...wallets.map((y) => ({ value: y.id, label: y.name + " (" + toman(y.balance) + ")" }))]} />}
    </Card>
  );
}
