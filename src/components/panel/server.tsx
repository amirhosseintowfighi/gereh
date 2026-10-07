"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PLAN_NUMS, VPS, locLabel } from "@/lib/catalog";
import { BTN_G, BTN_P, INPUT } from "@/lib/cls";
import { fa, hashStr, toEnDigits, toman } from "@/lib/format";
import { api, genPassword, useDB, useMyId, type FwRule, type Server } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field, Meter, StatusBadge } from "../ui";
import { AreaChart, AsyncButton, CopyText, DataTable, IconBtn, Modal, PageTitle, Select, StatCard, StrengthBar, Switch, Tabs } from "../ui-client";

const TABS = [
  { id: "overview", label: "نمای کلی", icon: "gauge" }, { id: "traffic", label: "ترافیک", icon: "activity" }, { id: "console", label: "کنسول VNC", icon: "monitor-smartphone" },
  { id: "access", label: "دسترسی و اپلیکیشن", icon: "key-round" }, { id: "network", label: "شبکه", icon: "network" }, { id: "firewall", label: "فایروال", icon: "shield-check" },
  { id: "backups", label: "بکاپ و اسنپ‌شات", icon: "database-backup" }, { id: "boot", label: "بوت، ISO و ریسکیو", icon: "hard-drive" }, { id: "rebuild", label: "نصب مجدد", icon: "refresh-cw" },
  { id: "resize", label: "ارتقا", icon: "trending-up" }, { id: "tasks", label: "لاگ عملیات", icon: "scroll-text" }, { id: "settings", label: "تنظیمات", icon: "settings-2" },
];
const SNAP_LIMIT = 5;
/** a suspended server can only be inspected until the account is settled */
const READONLY_TABS = new Set(["overview", "traffic", "tasks"]);

export function ServerDetail({ id }: { id: string }) {
  const db = useDB(); const myId = useMyId();
  const { notify } = useApp();
  const s = db.servers.find((x) => x.id === id && x.userId === myId);
  const [tab, setTab] = useState("overview");
  if (!s) return <Card><Empty icon="server" title="سرور پیدا نشد" text="ممکن است حذف شده باشد یا به حساب دیگری تعلق داشته باشد." action={<Link href="/panel/servers" className={BTN_G + " px-4 h-10 text-sm"}>بازگشت به فهرست</Link>} /></Card>;
  const suspended = s.status === "suspended";
  const tabs = suspended ? TABS.filter((t) => READONLY_TABS.has(t.id)) : TABS;
  const cur = tabs.some((t) => t.id === tab) ? tab : "overview";
  const power = async (a: "start" | "stop" | "reboot", m: string) => { await api.servers.power(s.id, a); notify(m, "circle-check"); };
  return (
    <div>
      <PageTitle back={["/panel/servers", "سرورهای ابری"]} title={<span className="ltr inline-block">{s.name}</span>}
        sub={<span className="flex flex-wrap items-center gap-x-4 gap-y-1"><StatusBadge s={s.status} /><CopyText text={s.ip} className="mono text-xs text-white/60" /><span>{locLabel(s.loc)}</span><span>{s.os}</span></span>}
        action={suspended ? <Badge tone="red">این سرور معلق است؛ برای رفع تعلیق صورتحساب‌ها را پرداخت کنید.</Badge> : <>
          {s.status !== "running" && <AsyncButton onClick={() => power("start", "سرور روشن شد")}><Icon name="play" size={16} /> روشن کردن</AsyncButton>}
          {s.status === "running" && <AsyncButton className={BTN_G + " px-4 h-10 text-sm"} confirmText="سرور ری‌استارت شود؟" onClick={() => power("reboot", "سرور ری‌استارت شد")}><Icon name="refresh-cw" size={16} /> ری‌استارت</AsyncButton>}
          {s.status === "running" && <AsyncButton danger confirmText="سرور خاموش شود؟ سرویس‌های در حال اجرا متوقف می‌شوند." onClick={() => power("stop", "سرور خاموش شد")}><Icon name="pause" size={16} /> خاموش</AsyncButton>}
        </>} />
      <div className="overflow-x-auto no-scrollbar mb-6"><Tabs size="sm" value={cur} onChange={setTab} label="بخش‌های سرور" options={tabs} /></div>
      <div key={cur} className="fade-in" role="tabpanel">
        {cur === "overview" && <Overview s={s} />}
        {cur === "traffic" && <ServerTraffic s={s} />}
        {cur === "console" && <VncPanel s={s} />}
        {cur === "access" && <ServerAccess s={s} />}
        {cur === "network" && <ServerNetwork s={s} />}
        {cur === "firewall" && <ServerFirewall s={s} />}
        {cur === "backups" && <ServerBackups s={s} />}
        {cur === "boot" && <ServerBoot s={s} />}
        {cur === "rebuild" && <ServerRebuild s={s} />}
        {cur === "resize" && <ServerResize s={s} />}
        {cur === "tasks" && <ServerTasks s={s} />}
        {cur === "settings" && <ServerSettings s={s} />}
      </div>
    </div>
  );
}

/** real hypervisor samples (5-minute resolution, last 4 hours) collected by the worker */
function Metric({ label, icon, values, unit }: { label: string; icon: string; values: number[]; unit: string }) {
  const cur = values.at(-1);
  return (
    <Card pad="p-5">
      <div className="flex items-center justify-between mb-3"><span className="text-xs text-white/50 flex items-center gap-2"><Icon name={icon} size={15} className="acc" />{label}</span><span className="font-black tabular">{cur === undefined ? "—" : fa(Math.round(cur))} <span className="text-[11px] font-normal text-white/55">{unit}</span></span></div>
      {values.length > 1 ? <AreaChart data={values} height={90} unit={unit} /> : <div className="h-[90px] grid place-items-center text-[11px] text-white/45 text-center leading-6">نمونه‌برداری هر ۵ دقیقه انجام می‌شود؛<br />نمودار به‌زودی پر می‌شود.</div>}
    </Card>
  );
}

function AlertsCard({ s }: { s: Server }) {
  const { notify } = useApp();
  const [cpu, setCpu] = useState(String(s.alerts.cpu || ""));
  const [bw, setBw] = useState(String(s.alerts.bw || ""));
  const num = (v: string) => Math.min(100, Math.max(0, +toEnDigits(v).replace(/\D/g, "") || 0));
  return (
    <Card title="هشدار مصرف" icon="bell-ring">
      <p className="text-xs text-white/55 leading-6 mb-4">با عبور از این آستانه‌ها، اعلان و طبق تنظیمات حساب، ایمیل یا پیامک می‌گیرید. خالی یعنی خاموش.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CPU بالای (٪) به مدت ۱۵ دقیقه"><input value={cpu} onChange={(e) => setCpu(e.target.value)} inputMode="numeric" dir="ltr" placeholder="مثلا 90" className={INPUT + " text-left tabular"} /></Field>
        <Field label="ترافیک ماهانه بالای (٪ سهمیه)"><input value={bw} onChange={(e) => setBw(e.target.value)} inputMode="numeric" dir="ltr" placeholder="مثلا 80" className={INPUT + " text-left tabular"} /></Field>
      </div>
      <div className="mt-4 flex justify-end"><AsyncButton onClick={async () => { await api.servers.setAlerts(s.id, { cpu: num(cpu), bw: num(bw) }); notify("هشدارها ذخیره شد", "bell-ring"); }}>ذخیره</AsyncButton></div>
    </Card>
  );
}

function Overview({ s }: { s: Server }) {
  const u = s.usage;
  const last = u.at(-1);
  return <>
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <Metric label="پردازنده" icon="cpu" values={u.map((x) => x.cpu)} unit="٪" />
      <Metric label="حافظه" icon="memory-stick" values={u.map((x) => x.ram)} unit="٪" />
      <Metric label="ورودی شبکه" icon="arrow-down-up" values={u.map((x) => x.netIn)} unit="Mb/s" />
      <Metric label="خروجی شبکه" icon="arrow-down-up" values={u.map((x) => x.netOut)} unit="Mb/s" />
    </div>
    <div className="grid lg:grid-cols-2 gap-4 mt-4">
      <Card title="مشخصات" icon="cpu">
        <dl className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
          {([["شناسه VPS", <span key="v" className="mono">{s.vpsid}</span>], ["Hostname", <span key="h" className="mono text-xs ltr break-all">{s.hostname}</span>], ["پلن", s.plan], ["پردازنده", fa(s.cpu) + " هسته"], ["حافظه", fa(s.ram) + " گیگابایت"], ["دیسک", fa(s.disk) + " گیگ NVMe"], ["سیستم‌عامل", s.os], ["موقعیت", locLabel(s.loc)], ["تاریخ ساخت", s.created], ["هزینه ماهانه", toman(s.price)]] as [string, React.ReactNode][]).map(([k, v]) => <div key={k}><dt className="text-white/55 text-xs">{k}</dt><dd className="mt-1 font-medium">{v}</dd></div>)}
        </dl>
      </Card>
      <Card title="مصرف منابع" icon="gauge">
        <div className="space-y-5">
          {last ? <Meter label="فضای دیسک" value={last.disk} right={fa(Math.round(last.disk)) + "٪ از " + fa(s.disk) + " گیگ"} /> : <Meter label="فضای دیسک" value={0} right={"— از " + fa(s.disk) + " گیگ"} />}
          <Meter label="ترافیک ماهانه" value={last?.bwUsed ?? 0} max={s.bwLimit} right={fa(Math.round(last?.bwUsed ?? 0)) + " از " + fa(s.bwLimit) + " گیگ"} />
          <Meter label="اسنپ‌شات‌ها" value={s.snapshots.length} max={SNAP_LIMIT} right={fa(s.snapshots.length) + " از " + fa(SNAP_LIMIT)} />
        </div>
      </Card>
    </div>
    <div className="mt-4"><AlertsCard s={s} /></div>
  </>;
}

function ServerTraffic({ s }: { s: Server }) {
  const [month, setMonth] = useState(0);
  const months = useMemo(() => [0, 1, 2].map((k) => { const d = new Date(); d.setDate(15); d.setMonth(d.getMonth() - k); return d.toLocaleDateString("fa-IR", { month: "long", year: "numeric" }); }), []);
  const days = month === 0 ? Math.max(1, Number(new Date().toLocaleDateString("fa-IR-u-nu-latn", { day: "numeric" }))) : 30;
  const data = useMemo(() => {
    const rnd = (x: number) => { const v = Math.sin(x * 12.9898 + (hashStr(s.id) % 97) + month * 7.1) * 43758.5453; return v - Math.floor(v); };
    return Array.from({ length: days }, (_, i) => { const wk = i % 7 === 4 || i % 7 === 5 ? 0.6 : 1; return { in: Math.round((10 + rnd(i) * 30) * wk), out: Math.round((30 + rnd(i + 100) * 80) * wk) }; });
  }, [s.id, month, days]);
  const totIn = data.reduce((a, b) => a + b.in, 0), totOut = data.reduce((a, b) => a + b.out, 0), used = totIn + totOut;
  const peak = Math.max(...data.map((d) => d.in + d.out), 1);
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard icon="arrow-down-up" label={"مصرف " + months[month]} value={used} suffix="گیگابایت" />
        <StatCard icon="trending-up" label="خروجی (out)" value={totOut} suffix="گیگابایت" />
        <StatCard icon="activity" label="ورودی (in)" value={totIn} suffix="گیگابایت" />
      </div>
      <Card title="ترافیک روزانه" icon="activity" action={<Select className="w-44" label="ماه" value={String(month)} onChange={(v) => setMonth(+v)} options={months.map((m, i) => ({ value: String(i), label: m }))} />}>
        <div className="mb-6"><Meter label="سهمیه ماهانه" value={used} max={s.bwLimit} right={fa(used) + " از " + fa(s.bwLimit) + " گیگابایت"} /></div>
        <div className="flex items-end gap-[3px] h-48" role="img" aria-label={"ترافیک روزانه " + months[month] + "، مجموع " + fa(used) + " گیگابایت"}>
          {data.map((d, i) => (
            <div key={i} className="group relative flex-1 h-full flex flex-col justify-end gap-[2px]" title={fa(i + 1) + ": ورودی " + fa(d.in) + "، خروجی " + fa(d.out) + " گیگ"}>
              <div className="rounded-t-[3px] bg-[#9cc9ff]/80 group-hover:bg-[#9cc9ff]" style={{ height: (d.out / peak) * 100 + "%" }} />
              <div className="rounded-b-[3px] bg-white/25 group-hover:bg-white/40" style={{ height: (d.in / peak) * 100 + "%" }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-white/50 mt-2"><span>۱</span><span>{fa(days)}</span></div>
        <div className="flex gap-5 mt-4 text-xs text-white/55"><span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-[#9cc9ff]/80" />خروجی</span><span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-white/25" />ورودی</span></div>
        <p className="text-[11px] text-white/55 mt-4 leading-6">با رسیدن به سقف، طبق تنظیم مدیر یا سرعت شبکه محدود می‌شود یا سرور معلق می‌شود. ترافیک اضافه را از بخش صورتحساب بخرید.</p>
      </Card>
    </div>
  );
}

/* ponytail: demo console. Real one = noVNC over a websockify proxy with a short-lived token (WS /servers/:id/console). */
function DemoConsole({ s }: { s: Server }) {
  const [hist, setHist] = useState([{ t: "out", v: s.os + " " + s.name + " tty1" }, { t: "out", v: 'Welcome to Gereh Cloud. Type "help" for commands.' }]);
  const [cmd, setCmd] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [hist]);
  const RESP: Record<string, string> = {
    help: "available: help, uptime, df -h, free -m, uname -a, ip a, clear, neofetch",
    uptime: " 12:41:07 up 37 days,  4:12,  1 user,  load average: 0.21, 0.18, 0.15",
    "df -h": "Filesystem  Size  Used Avail Use% Mounted on\n/dev/vda1   " + s.disk + "G   " + Math.round(s.disk * 0.24) + "G  " + (s.disk - Math.round(s.disk * 0.24)) + "G  24% /",
    "free -m": "        total   used   free\nMem:    " + s.ram * 1024 + "   " + Math.round(s.ram * 1024 * 0.42) + "   " + Math.round(s.ram * 1024 * 0.58),
    "uname -a": "Linux " + s.name + " 6.8.0-45-generic #45-Ubuntu SMP x86_64 GNU/Linux",
    "ip a": "2: eth0: <BROADCAST,UP> mtu 1500\n    inet " + s.ip + "/24\n    inet6 " + (s.ipv6 || "::1") + "/64",
    neofetch: "OS: " + s.os + "\nHost: Gereh Cloud KVM\nCPU: AMD EPYC (" + s.cpu + ") @ 3.7GHz\nMemory: " + s.ram + " GiB\nRegion: " + s.loc,
  };
  const run = () => {
    const c = cmd.trim(); if (!c) return;
    if (c === "clear") { setHist([]); setCmd(""); return; }
    setHist((h) => [...h, { t: "in", v: c }, { t: "out", v: RESP[c] || c.split(" ")[0] + ": command not found" }]); setCmd("");
  };
  const on = s.status === "running";
  return (
    <div className="rounded-b-[14px] bg-[#020306] overflow-hidden" dir="ltr">
      <div className="flex items-center justify-between px-4 h-10 border-b border-white/[0.07] text-[11px] text-white/55 mono"><span>root@{s.name} — VNC console</span><span className={on ? "text-emerald-300" : "text-rose-300"}>{on ? "● connected" : "● offline"}</span></div>
      <div ref={ref} className="mono text-[12.5px] leading-6 p-4 h-80 overflow-auto whitespace-pre-wrap" onClick={() => input.current?.focus()}>
        {hist.map((h, i) => <div key={i} className={h.t === "in" ? "text-white" : "text-white/60"}>{h.t === "in" && <span className="text-[#9cc9ff]">root@{s.name}:~# </span>}{h.v}</div>)}
        {on ? <div className="flex"><span className="text-[#9cc9ff]">root@{s.name}:~#&nbsp;</span><input ref={input} value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} className="flex-1 bg-transparent outline-none text-white mono" aria-label="فرمان کنسول" autoComplete="off" spellCheck={false} /></div>
          : <div className="text-rose-300">Server is powered off. Start it to use the console.</div>}
      </div>
    </div>
  );
}

function VncPanel({ s }: { s: Server }) {
  const { notify } = useApp();
  const [show, setShow] = useState(false);
  const [pass, setPass] = useState("");
  const box = useRef<HTMLDivElement>(null);
  return (
    <div className="grid xl:grid-cols-[1fr_320px] gap-4">
      <div ref={box} className="rounded-[14px] overflow-hidden border border-white/[0.1] bg-[#020306]">
        <div className="flex items-center justify-between px-4 h-10 bg-white/[0.04] border-b border-white/[0.08] text-xs">
          <span className="flex items-center gap-2 text-white/60"><Icon name="monitor-smartphone" size={15} />کنسول VNC (noVNC)</span>
          <div className="flex gap-1">
            <button type="button" disabled={s.status !== "running"} onClick={() => notify("Ctrl+Alt+Del ارسال شد", "keyboard")} className="px-2.5 h-7 rounded-md hover:bg-white/10 text-white/60 ltr disabled:opacity-40">Ctrl+Alt+Del</button>
            <button type="button" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen())?.catch(() => notify("تمام‌صفحه پشتیبانی نمی‌شود", "circle-alert"))} className="px-2.5 h-7 rounded-md hover:bg-white/10 text-white/60 flex items-center gap-1"><Icon name="external-link" size={13} />تمام‌صفحه</button>
          </div>
        </div>
        <DemoConsole s={s} />
      </div>
      <div className="space-y-4">
        <Card title="اتصال مستقیم VNC" icon="key-round">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between items-center"><dt className="text-white/55">آدرس</dt><dd><CopyText text={s.vnc.host} className="mono text-xs" /></dd></div>
            <div className="flex justify-between items-center"><dt className="text-white/55">پورت</dt><dd className="mono">{s.vnc.port}</dd></div>
            <div className="flex justify-between items-center"><dt className="text-white/55">رمز</dt><dd className="flex items-center gap-1"><span className="mono text-xs">{show ? s.vnc.password : "••••••••"}</span><IconBtn icon={show ? "eye-off" : "eye"} label={show ? "پنهان کردن رمز" : "نمایش رمز"} onClick={() => setShow((x) => !x)} /></dd></div>
          </dl>
        </Card>
        <Card title="تغییر رمز VNC" icon="lock">
          <form onSubmit={(e) => e.preventDefault()}>
            <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} dir="ltr" placeholder="حداقل ۶ کاراکتر" aria-label="رمز جدید VNC" className={INPUT + " text-left"} />
            <div className="mt-3 flex justify-end"><AsyncButton onClick={async () => { await api.servers.setVncPass(s.id, pass); setPass(""); notify("رمز VNC تغییر کرد"); }}>ذخیره</AsyncButton></div>
          </form>
        </Card>
      </div>
    </div>
  );
}

function ServerAccess({ s }: { s: Server }) {
  const { notify } = useApp();
  const [host, setHost] = useState(s.hostname);
  const [pw, setPw] = useState("");
  const [panel, setPanel] = useState("");
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Hostname" icon="globe">
        <Field label="نام میزبان کامل (FQDN)" hint="بعد از ری‌استارت در سیستم‌عامل اعمال می‌شود."><input value={host} onChange={(e) => setHost(e.target.value)} dir="ltr" className={INPUT + " text-left mono"} /></Field>
        <div className="mt-4 flex justify-end"><AsyncButton onClick={async () => { const h = host.trim().toLowerCase(); if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(h)) throw new Error("hostname معتبر نیست."); await api.servers.setHostname(s.id, h); setHost(h); notify("hostname تغییر کرد"); }}>ذخیره</AsyncButton></div>
      </Card>
      <Card title="رمز root" icon="key-round">
        <Field label="رمز جدید" hint="سرور برای اعمال رمز ری‌استارت می‌شود.">
          <div className="flex gap-2"><input value={pw} onChange={(e) => setPw(e.target.value)} dir="ltr" autoComplete="new-password" className={INPUT + " text-left mono"} /><button type="button" onClick={() => setPw(genPassword())} className={BTN_G + " px-3 h-11 text-xs shrink-0"}>ساخت تصادفی</button></div>
          <StrengthBar value={pw} />
        </Field>
        <div className="mt-4 flex justify-end"><AsyncButton confirmText="سرور برای تغییر رمز ری‌استارت می‌شود. ادامه می‌دهید؟" onClick={async () => { await api.servers.resetRootPassword(s.id, pw); setPw(""); notify("رمز root تغییر کرد", "key-round"); }}>تغییر رمز</AsyncButton></div>
      </Card>
      <Card title="نصب کنترل‌پنل و اپلیکیشن" icon="layout-dashboard" className="lg:col-span-2">
        <p className="text-sm text-white/50 mb-4">نصب خودکار روی سیستم‌عامل فعلی. داده‌های موجود حفظ می‌شود، ولی بهتر است روی سرور تازه نصب شود.</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" role="radiogroup" aria-label="کنترل‌پنل">
          {["cPanel", "Plesk", "DirectAdmin", "Webuzo", "Virtualmin"].map((p) => <button type="button" role="radio" aria-checked={panel === p} key={p} onClick={() => setPanel(p)} className={"rounded-[12px] p-4 border text-sm transition " + (panel === p ? "bg-white/[0.1] border-white/40 font-bold" : "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]")}>{p}</button>)}
        </div>
        <div className="mt-4 flex justify-end"><AsyncButton disabled={!panel || s.status !== "running"} confirmText={"نصب " + panel + " روی " + s.name + " شروع شود؟"} onClick={async () => { await api.servers.installPanel(s.id, panel); setPanel(""); notify("نصب " + panel + " شروع شد", "layout-dashboard"); }}>نصب</AsyncButton></div>
      </Card>
    </div>
  );
}

function ServerNetwork({ s }: { s: Server }) {
  const { notify, addToCart } = useApp();
  const [rdns, setRdns] = useState(s.rdns);
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="آدرس‌ها" icon="network">
        <dl className="space-y-4 text-sm">
          <div className="flex justify-between items-center"><dt className="text-white/50">IPv4 اصلی</dt><dd><CopyText text={s.ip} className="mono" /></dd></div>
          <div className="flex justify-between items-center"><dt className="text-white/50">IPv6</dt><dd>{s.ipv6 ? <CopyText text={s.ipv6} className="mono text-xs" /> : <span className="text-white/55">—</span>}</dd></div>
          <div className="flex justify-between items-center"><dt className="text-white/50">دروازه</dt><dd className="mono ltr">{s.ip.split(".").slice(0, 3).join(".")}.1</dd></div>
          <div className="flex justify-between items-center"><dt className="text-white/50">پهنای باند</dt><dd>۱ گیگابیت بر ثانیه</dd></div>
        </dl>
        <button type="button" onClick={() => addToCart({ t: "ip", serverId: s.id, serverName: s.name })} className={BTN_G + " mt-6 px-4 h-10 text-sm"}><Icon name="plus" size={16} /> خرید IPv4 اضافه ({toman(120000)})</button>
      </Card>
      <Card title="Reverse DNS" icon="globe">
        <p className="text-sm text-white/50 leading-7 mb-4">برای ارسال ایمیل از سرور، PTR را روی دامنه خودتان تنظیم کنید.</p>
        <Field label={"PTR برای " + s.ip}><input value={rdns} onChange={(e) => setRdns(e.target.value)} dir="ltr" placeholder="mail.example.com" className={INPUT + " text-left"} /></Field>
        <div className="mt-4 flex justify-end"><AsyncButton onClick={async () => { const v = rdns.trim().toLowerCase(); if (v && !/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v)) throw new Error("نام دامنه معتبر نیست."); await api.servers.setRdns(s.id, v); setRdns(v); notify("Reverse DNS ذخیره شد"); }}>ذخیره</AsyncButton></div>
      </Card>
    </div>
  );
}

const PORT_RE = /^(\d{1,5}(-\d{1,5})?)(,\d{1,5}(-\d{1,5})?)*$/;
const CIDR_RE = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)(\/(3[0-2]|[12]?\d))?$|^[0-9a-f:]+(\/\d{1,3})?$/i;
function ServerFirewall({ s }: { s: Server }) {
  const { notify, confirm } = useApp();
  const [form, setForm] = useState<Omit<FwRule, "id"> | null>(null);
  return <>
    <Card title="قوانین ورودی" icon="shield-check" action={<button type="button" onClick={() => setForm({ proto: "TCP", port: "", source: "0.0.0.0/0", action: "allow", note: "" })} className={BTN_P + " px-3 h-9 text-xs"}><Icon name="plus" size={15} /> قانون جدید</button>} pad="p-3 sm:p-4">
      {s.firewall.length === 0 ? <Empty icon="shield" title="قانونی تعریف نشده" text="همه ترافیک ورودی مجاز است. برای امنیت بیشتر، فقط پورت‌های لازم را باز کنید." /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-xs text-white/55"><th scope="col" className="text-right font-medium p-3">پروتکل</th><th scope="col" className="text-right font-medium p-3">پورت</th><th scope="col" className="text-right font-medium p-3">مبدأ</th><th scope="col" className="text-right font-medium p-3">عملکرد</th><th scope="col" className="text-right font-medium p-3">توضیح</th><th><span className="sr-only-focusable">حذف</span></th></tr></thead>
          <tbody>{s.firewall.map((r) => (
            <tr key={r.id} className="border-t border-white/[0.06]">
              <td className="p-3 mono">{r.proto}</td><td className="p-3 mono ltr text-right">{r.port}</td><td className="p-3 mono ltr text-right text-white/60">{r.source}</td>
              <td className="p-3"><Badge tone={r.action === "allow" ? "green" : "red"}>{r.action === "allow" ? "اجازه" : "مسدود"}</Badge></td><td className="p-3 text-white/60">{r.note}</td>
              <td className="p-3 text-left"><IconBtn icon="trash-2" label={"حذف قانون " + r.port} className="hover:text-rose-300" onClick={async () => { if (await confirm("قانون " + r.proto + " " + r.port + " حذف شود؟", { danger: true, ok: "حذف" })) { await api.servers.removeRule(s.id, r.id); notify("قانون حذف شد"); } }} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
    <Modal open={!!form} onClose={() => setForm(null)} title="قانون فایروال جدید" icon="shield-check"
      footer={<><button type="button" onClick={() => setForm(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => {
        if (!form) return;
        const port = form.proto === "ICMP" ? "—" : form.port.replace(/\s/g, "");
        if (form.proto !== "ICMP" && (!PORT_RE.test(port) || port.split(/[,-]/).some((p) => +p < 1 || +p > 65535) || port.split(",").some((r) => { const [a, b] = r.split("-").map(Number); return b !== undefined && b < a; }))) throw new Error("پورت معتبر نیست؛ مثال: 22 یا 8000-8100 یا 80,443");
        if (!CIDR_RE.test(form.source.trim())) throw new Error("مبدأ باید IP یا CIDR معتبر باشد؛ مثل 0.0.0.0/0");
        await api.servers.addRule(s.id, { ...form, port, source: form.source.trim(), note: form.note.trim() }); setForm(null); notify("قانون اضافه شد");
      }}>افزودن قانون</AsyncButton></>}>
      {form && <div className="grid grid-cols-2 gap-4">
        <Field label="پروتکل"><Select value={form.proto} label="پروتکل" onChange={(v) => setForm((f) => f && { ...f, proto: v })} options={["TCP", "UDP", "ICMP"]} ltr /></Field>
        <Field label="عملکرد"><Select value={form.action} label="عملکرد" onChange={(v) => setForm((f) => f && { ...f, action: v as "allow" | "deny" })} options={[{ value: "allow", label: "اجازه" }, { value: "deny", label: "مسدود" }]} /></Field>
        <Field label="پورت" hint="مثال: 22 یا 8000-8100"><input value={form.proto === "ICMP" ? "—" : form.port} disabled={form.proto === "ICMP"} onChange={(e) => setForm((f) => f && { ...f, port: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} /></Field>
        <Field label="مبدأ"><input value={form.source} onChange={(e) => setForm((f) => f && { ...f, source: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} /></Field>
        <Field className="col-span-2" label="توضیح"><input value={form.note} maxLength={60} onChange={(e) => setForm((f) => f && { ...f, note: e.target.value })} className={INPUT} /></Field>
      </div>}
    </Modal>
  </>;
}

function ServerBackups({ s }: { s: Server }) {
  const { notify, confirm } = useApp();
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="بکاپ خودکار روزانه" icon="database-backup" action={<Switch on={s.backups} label="بکاپ خودکار" onChange={async () => { await api.servers.toggleBackups(s.id); notify(s.backups ? "بکاپ خودکار غیرفعال شد" : "بکاپ خودکار فعال شد"); }} />} pad="p-3 sm:p-4">
        {!s.backups ? <Empty icon="database-backup" title="بکاپ خودکار خاموش است" text="با ۲۰٪ هزینه ماهانه، هر شب یک نسخه کامل در دیتاسنتر دوم نگه می‌داریم." />
          : s.backupsList.length === 0 ? <Empty icon="clock" title="اولین بکاپ امشب ساخته می‌شود" />
          : s.backupsList.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
              <div className="flex items-center gap-3"><Icon name="database-backup" size={17} className="text-white/55" /><div><div className="text-sm">{b.at}</div><div className="text-[11px] text-white/55">{fa(b.size, 1)} گیگابایت</div></div></div>
              <AsyncButton className={BTN_G + " px-3 h-8 text-xs"} danger confirmText="سرور به این نسخه بازگردانده شود؟ اطلاعات فعلی جایگزین می‌شود." onClick={async () => { await api.servers.restore(s.id, "بکاپ " + b.at); notify("بازیابی انجام شد"); }}>بازیابی</AsyncButton>
            </div>
          ))}
      </Card>
      <Card title="اسنپ‌شات‌ها" icon="camera" action={<AsyncButton className={BTN_P + " px-3 h-9 text-xs"} disabled={s.snapshots.length >= SNAP_LIMIT} title={s.snapshots.length >= SNAP_LIMIT ? "به سقف " + fa(SNAP_LIMIT) + " اسنپ‌شات رسیده‌اید" : undefined} onClick={async () => { await api.servers.snapshot(s.id); notify("اسنپ‌شات ساخته شد", "camera"); }}><Icon name="plus" size={15} /> ساخت اسنپ‌شات</AsyncButton>} pad="p-3 sm:p-4">
        {s.snapshots.length === 0 ? <Empty icon="camera" title="اسنپ‌شاتی ندارید" text="پیش از تغییرات بزرگ، یک نسخه لحظه‌ای بگیرید." />
          : s.snapshots.map((sn) => (
            <div key={sn.id} className="flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
              <div><div className="text-sm font-bold ltr text-right">{sn.name}</div><div className="text-[11px] text-white/55">{sn.at}، {fa(sn.size, 1)} گیگابایت</div></div>
              <div className="flex gap-1 items-center">
                <AsyncButton className={BTN_G + " px-3 h-8 text-xs"} danger confirmText="سرور به این اسنپ‌شات بازگردانده شود؟" onClick={async () => { await api.servers.restore(s.id, "اسنپ‌شات " + sn.name); notify("بازیابی انجام شد"); }}>بازیابی</AsyncButton>
                <IconBtn icon="trash-2" label={"حذف اسنپ‌شات " + sn.name} className="hover:text-rose-300" onClick={async () => { if (await confirm("اسنپ‌شات " + sn.name + " حذف شود؟", { danger: true, ok: "حذف" })) { await api.servers.deleteSnapshot(s.id, sn.id); notify("اسنپ‌شات حذف شد"); } }} />
              </div>
            </div>
          ))}
      </Card>
    </div>
  );
}

function ServerBoot({ s }: { s: Server }) {
  const db = useDB();
  const { notify } = useApp();
  const [rp, setRp] = useState("");
  const [iso, setIso] = useState(s.iso || db.isos[0]);
  const BOOT = [{ value: "cda", label: "دیسک، سپس CD-ROM" }, { value: "dca", label: "CD-ROM، سپس دیسک" }, { value: "n", label: "شبکه (PXE)" }];
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="حالت ریسکیو" icon="shield-half" action={<Badge tone={s.rescue ? "amber" : "gray"}>{s.rescue ? "فعال" : "غیرفعال"}</Badge>}>
        <p className="text-sm text-white/55 leading-7">سرور با یک سیستم نجات بوت می‌شود تا بتوانید دیسک اصلی را mount و تعمیر کنید یا اطلاعات را نجات دهید.</p>
        {s.rescue ? <div className="mt-4"><AsyncButton danger confirmText="سرور از حالت ریسکیو خارج و ری‌استارت شود؟" onClick={async () => { await api.servers.setRescue(s.id, false); notify("حالت ریسکیو غیرفعال شد"); }}>خروج از ریسکیو</AsyncButton></div> : (
          <form className="mt-4 flex gap-2" onSubmit={(e) => e.preventDefault()}>
            <input type="password" autoComplete="new-password" value={rp} onChange={(e) => setRp(e.target.value)} dir="ltr" placeholder="رمز ورود ریسکیو" aria-label="رمز ورود ریسکیو" className={INPUT + " text-left"} />
            <AsyncButton className={BTN_P + " px-4 h-11 text-sm shrink-0"} confirmText="سرور ری‌استارت و وارد حالت ریسکیو می‌شود." onClick={async () => { await api.servers.setRescue(s.id, true, rp); setRp(""); notify("حالت ریسکیو فعال شد", "shield-half"); }}>فعال‌سازی</AsyncButton>
          </form>
        )}
      </Card>
      <Card title="ترتیب بوت" icon="refresh-cw">
        <div className="space-y-2">
          {BOOT.map((b) => (
            <AsyncButton key={b.value} disabled={s.boot === b.value} onClick={async () => { await api.servers.setBoot(s.id, b.value); notify("ترتیب بوت ذخیره شد"); }}
              className={"w-full flex items-center gap-3 p-3.5 rounded-[12px] border text-right text-sm transition disabled:cursor-default " + (s.boot === b.value ? "bg-white/[0.08] border-white/35" : "bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.05]")}>
              <span aria-hidden="true" className={"w-4 h-4 rounded-full border-2 " + (s.boot === b.value ? "border-white bg-white shadow-[inset_0_0_0_3px_#0b0d16]" : "border-white/30")} />{b.label}
            </AsyncButton>
          ))}
        </div>
      </Card>
      <Card title="ISO" icon="hard-drive" className="lg:col-span-2">
        <p className="text-sm text-white/50 mb-4">ISO را به درایو مجازی وصل کنید و با کنسول VNC نصب دلخواه انجام دهید. برای بوت از ISO، ترتیب بوت را روی CD-ROM بگذارید.</p>
        {s.iso ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-white/[0.04] border border-white/[0.1] p-4">
            <span className="flex items-center gap-2 text-sm"><Icon name="hard-drive" size={16} className="acc" /><span className="mono ltr text-xs">{s.iso}</span><Badge tone="green">متصل</Badge></span>
            <AsyncButton className={BTN_G + " px-4 h-9 text-xs"} onClick={async () => { await api.servers.mountIso(s.id, ""); notify("ISO جدا شد"); }}>جدا کردن</AsyncButton>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <Select className="flex-1" label="فایل ISO" value={iso} onChange={setIso} options={db.isos} ltr />
            <AsyncButton className={BTN_P + " px-5 h-11 text-sm"} onClick={async () => { await api.servers.mountIso(s.id, iso); notify("ISO متصل شد"); }}>اتصال ISO</AsyncButton>
          </div>
        )}
      </Card>
    </div>
  );
}

function ServerRebuild({ s }: { s: Server }) {
  const db = useDB();
  const { notify } = useApp();
  const [os, setOs] = useState("");
  const [confirmName, setConfirmName] = useState("");
  return (
    <Card title="نصب مجدد سیستم‌عامل" icon="refresh-cw">
      <div role="alert" className="rounded-xl bg-rose-500/[0.08] border border-rose-400/20 p-4 text-sm text-rose-100 flex gap-3 mb-5"><Icon name="circle-alert" size={18} />همه اطلاعات روی دیسک پاک می‌شود. پیش از ادامه، یک اسنپ‌شات بگیرید.</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="سیستم‌عامل">
        {db.osTemplates.filter((t) => t.on).map((o) => <button type="button" role="radio" aria-checked={os === o.name} key={o.osid} onClick={() => setOs(o.name)} className={"rounded-xl p-4 border text-sm ltr transition " + (os === o.name ? "bg-white/[0.1] border-white/40" : "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]")}>{o.name}</button>)}
      </div>
      <Field className="mt-5" label={"برای تأیید، نام سرور را بنویسید: " + s.name}><input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} dir="ltr" autoComplete="off" className={INPUT + " text-left mono"} /></Field>
      <div className="mt-5 flex justify-end"><AsyncButton danger disabled={!os || confirmName.trim() !== s.name} onClick={async () => { await api.servers.reinstall(s.id, os); setOs(""); setConfirmName(""); notify("سیستم‌عامل نصب شد", "terminal"); }}>نصب مجدد</AsyncButton></div>
    </Card>
  );
}

function ServerResize({ s }: { s: Server }) {
  const { notify } = useApp();
  const [plan, setPlan] = useState("");
  const cur = VPS.cloud.find((p) => p.name === s.plan);
  const curDisk = s.disk;
  return (
    <Card title="ارتقای منابع" icon="trending-up">
      <p className="text-sm text-white/50 mb-5 leading-7">ارتقا با یک ری‌استارت کوتاه اعمال می‌شود. مابه‌التفاوت روزهای باقی‌مانده از کیف پول کسر می‌شود. کاهش فضای دیسک ممکن نیست.</p>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3" role="radiogroup" aria-label="پلن جدید">
        {VPS.cloud.map((p) => {
          const isCur = p.id === cur?.id;
          const [c, r, d] = PLAN_NUMS[p.id];
          const smaller = d < curDisk;
          return (
            <button type="button" role="radio" aria-checked={plan === p.id} key={p.id} disabled={isCur || smaller} onClick={() => setPlan(p.id)}
              className={"rounded-2xl p-4 text-right border transition " + (isCur || smaller ? "opacity-50 cursor-not-allowed border-white/10" : plan === p.id ? "bg-white/[0.1] border-white/40" : "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]")}>
              <div className="flex justify-between"><span className="font-bold">{p.name}</span>{isCur && <Badge>فعلی</Badge>}{smaller && !isCur && <Badge>دیسک کوچک‌تر</Badge>}</div>
              <div className="text-xs text-white/50 mt-2">{fa(c)} هسته، {fa(r)} گیگ رم، {fa(d)} گیگ</div>
              <div className="font-black mt-3 tabular">{toman(p.price)}</div>
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex justify-end"><AsyncButton disabled={!plan} confirmText="سرور برای اعمال تغییرات ری‌استارت می‌شود. ادامه می‌دهید؟" onClick={async () => { const p = VPS.cloud.find((x) => x.id === plan)!; await api.servers.resize(s.id, p.id); setPlan(""); notify("سرور به پلن " + p.name + " ارتقا یافت", "trending-up"); }}>اعمال ارتقا</AsyncButton></div>
    </Card>
  );
}

function ServerTasks({ s }: { s: Server }) {
  return (
    <DataTable rows={s.tasks} pageSize={10} empty="عملیاتی ثبت نشده است."
      columns={[
        { key: "action", label: "عملیات", render: (r) => <span className="font-medium">{r.action}</span> },
        { key: "at", label: "زمان" },
        { key: "progress", label: "پیشرفت", render: (r) => <div className="w-28"><Meter value={r.progress} label="پیشرفت" /></div> },
        { key: "status", label: "وضعیت", render: (r) => <Badge tone={r.status === "done" ? "green" : r.status === "failed" ? "red" : "blue"} dot>{r.status === "done" ? "انجام شد" : r.status === "failed" ? "ناموفق" : "در حال اجرا"}</Badge> },
      ]} />
  );
}

function ServerSettings({ s }: { s: Server }) {
  const { notify } = useApp();
  const router = useRouter();
  const [name, setName] = useState(s.name);
  const [del, setDel] = useState("");
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="تغییر نام" icon="pencil">
        <Field label="نام سرور" hint="فقط حروف انگلیسی، عدد و خط تیره"><input value={name} onChange={(e) => setName(e.target.value)} dir="ltr" className={INPUT + " text-left mono"} /></Field>
        <div className="mt-4 flex justify-end"><AsyncButton onClick={async () => { const n = name.trim(); if (!/^[a-z0-9-]{2,40}$/i.test(n)) throw new Error("نام معتبر نیست؛ ۲ تا ۴۰ کاراکتر از حروف انگلیسی، عدد و خط تیره."); await api.servers.rename(s.id, n); notify("نام سرور تغییر کرد"); }}>ذخیره</AsyncButton></div>
      </Card>
      <Card title="حذف سرور" icon="trash-2">
        <p className="text-sm text-white/55 leading-7">سرور و همه بکاپ‌ها و اسنپ‌شات‌هایش برای همیشه حذف می‌شوند و هزینه از همین لحظه متوقف می‌شود.</p>
        <Field className="mt-4" label={"نام سرور را بنویسید: " + s.name}><input value={del} onChange={(e) => setDel(e.target.value)} dir="ltr" autoComplete="off" className={INPUT + " text-left mono"} /></Field>
        <div className="mt-4 flex justify-end"><AsyncButton danger disabled={del.trim() !== s.name} onClick={async () => { await api.servers.remove(s.id); notify("سرور حذف شد", "trash-2"); router.push("/panel/servers"); }}>حذف همیشگی</AsyncButton></div>
      </Card>
    </div>
  );
}
