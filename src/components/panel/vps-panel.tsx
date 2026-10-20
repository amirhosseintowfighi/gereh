"use client";
/* Cloud-server panel, Virtualizor tools: confirmed power controls, usage charts, disk layout editor, one log
   timeline, Virtualizor backups, process/service managers, SSH keys on the VPS and IPv6 PTR. */
import { useEffect, useState } from "react";
import { BTN_G, BTN_MD, BTN_P, BTN_SM, INPUT, INPUT_BASE } from "@/lib/cls";
import { fa } from "@/lib/format";
import { api, refresh, useDB, type Server } from "@/lib/store";
import { panelApi, type LogSource, type StatsRange } from "@/lib/vps-panel-api";
import { useApp } from "../app-context";
import { DiskLayoutEditor } from "../disk-split";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AreaChart, AsyncButton, IconBtn, Select, Tabs } from "../ui-client";
import { Loading, useRemote } from "./vps-extras";

const TRANSITION: Record<string, string> = { start: "در حال روشن شدن…", restart: "در حال ری‌استارت…", stop: "در حال خاموش شدن…", poweroff: "در حال قطع برق…" };

/* ---------- power: the transition stays on screen until a live status read confirms it ---------- */
export function PowerControls({ s }: { s: Server }) {
  const { notify } = useApp();
  const pending = s.power;
  // while an action is being confirmed the panel state is re-read every few seconds
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(t);
  }, [pending]);
  const run = async (a: "start" | "stop" | "reboot" | "poweroff", done: string) => {
    const r = await api.servers.power(s.id, a);
    notify(r === "done" ? done : "دستور ارسال شد؛ وضعیت پس از تأیید Virtualizor به‌روز می‌شود", r === "done" ? "circle-check" : "loader-circle");
  };
  if (pending) return <span role="status" className="inline-flex items-center gap-2 text-sm text-white/75"><Icon name="loader-circle" size={16} className="animate-spin" />{TRANSITION[pending.action] ?? "در حال انجام…"}</span>;
  return <>
    {s.status !== "running" && <AsyncButton onClick={() => run("start", "سرور روشن شد")}><Icon name="play" size={16} /> روشن کردن</AsyncButton>}
    {s.status === "running" && <AsyncButton className={BTN_G + BTN_MD} confirmText="سرور ری‌استارت شود؟" onClick={() => run("reboot", "سرور ری‌استارت شد")}><Icon name="refresh-cw" size={16} /> ری‌استارت</AsyncButton>}
    {s.status === "running" && <AsyncButton danger confirmText="سرور خاموش شود؟ سرویس‌های در حال اجرا متوقف می‌شوند." onClick={() => run("stop", "سرور خاموش شد")}><Icon name="pause" size={16} /> خاموش</AsyncButton>}
    {s.status === "running" && <AsyncButton className={BTN_G + BTN_MD} danger confirmText="برق سرور فوراً قطع شود؟ مثل کشیدن دوشاخه است و داده‌های ذخیره‌نشده از بین می‌روند." onClick={() => run("poweroff", "برق سرور قطع شد")}><Icon name="power" size={16} /> قطع برق</AsyncButton>}
  </>;
}

/* ---------- usage charts ---------- */
const RANGES: { id: StatsRange; label: string }[] = [{ id: "1h", label: "۱ ساعت" }, { id: "24h", label: "۲۴ ساعت" }, { id: "7d", label: "۷ روز" }, { id: "30d", label: "۳۰ روز" }];
const tFmt = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" });
const dFmt = new Intl.DateTimeFormat("fa-IR", { month: "short", day: "numeric", hour: "2-digit" });
export function UsageCharts({ s }: { s: Server }) {
  const [range, setRange] = useState<StatsRange>("24h");
  const x = useRemote(s.id + ":" + range, () => panelApi.stats(s.id, range));
  const pts = x.data?.points ?? [];
  const labels = pts.map((p) => (range === "1h" || range === "24h" ? tFmt : dFmt).format(new Date(p.t)));
  const charts: [string, string, number[], string, number][] = [
    ["پردازنده", "cpu", pts.map((p) => p.cpu), "٪", 0], ["حافظه", "memory-stick", pts.map((p) => p.ram), "٪", 0],
    ["ورودی شبکه", "arrow-down", pts.map((p) => p.netIn), "Mb/s", 1], ["خروجی شبکه", "upload", pts.map((p) => p.netOut), "Mb/s", 1],
    ["خواندن دیسک", "download", pts.map((p) => p.ioRead), "KB/s", 0], ["نوشتن دیسک", "upload", pts.map((p) => p.ioWrite), "KB/s", 0],
  ];
  return (
    <Card title="نمودار مصرف" icon="chart-line" action={<Tabs size="sm" value={range} onChange={(v) => setRange(v as StatsRange)} label="بازه نمودار" options={RANGES} />}>
      {x.error ? <Empty icon="circle-alert" title="نمودار بارگذاری نشد" text={x.error} />
        : !x.data ? <Loading />
        : pts.length < 2 ? <Empty icon="chart-line" title="هنوز داده‌ای برای این بازه نیست" text="مصرف هر ۵ دقیقه از Virtualizor خوانده می‌شود؛ نمودار به‌زودی پر می‌شود." />
        : <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-5">
            {charts.map(([label, icon, data, unit, d]) => (
              <div key={label} className="min-w-0">
                <div className="flex items-center justify-between mb-2 text-xs"><span className="text-white/55 flex items-center gap-2"><Icon name={icon} size={14} className="acc" />{label}</span><span className="font-bold tabular">{fa(data.at(-1) ?? 0, d)} <span className="font-normal text-white/50">{unit}</span></span></div>
                <AreaChart data={data} labels={labels} height={110} unit={unit} fmt={(v) => fa(v, d)} />
              </div>
            ))}
          </div>
          {x.data.source === "virtualizor" && <p className="text-[11px] text-white/50 mt-4">این بازه از گزارش وضعیت خود Virtualizor خوانده شد.</p>}
        </>}
    </Card>
  );
}

/* ---------- disk layout ---------- */
export function LayoutCard({ s }: { s: Server }) {
  const db = useDB();
  const { notify } = useApp();
  const x = useRemote(s.id + ":layout:" + s.disk, () => panelApi.layout(s.id));
  const [sizes, setSizes] = useState<number[] | null>(null);
  const [os, setOs] = useState("");
  const [confirm, setConfirm] = useState("");
  if (x.error) return <Card title="چیدمان دیسک" icon="layers"><Empty icon="circle-alert" title="بارگذاری نشد" text={x.error} /></Card>;
  if (!x.data) return <Card title="چیدمان دیسک" icon="layers"><Loading /></Card>;
  const v = x.data;
  const cur = v.disks.map((d) => d.sizeGb);
  const val = sizes ?? cur;
  const append = val.length > cur.length && cur.every((g, i) => val[i] === g);
  const same = val.length === cur.length && val.every((g, i) => g === cur[i]);
  const sum = val.reduce((a, b) => a + b, 0);
  const oses = db.osTemplates.filter((t) => t.on);
  return (
    <Card title="چیدمان دیسک" icon="layers" className="mb-4">
      <p className="text-xs text-white/55 leading-6 mb-4">{fa(v.allowanceGb)} گیگابایت دیسک پلن را می‌توانید به چند دیسک تقسیم کنید، مثلاً {fa(Math.round(v.allowanceGb * 0.4))} + {fa(v.allowanceGb - Math.round(v.allowanceGb * 0.4))}. هزینه ماهانه تغییر نمی‌کند. افزودن دیسک از فضای تقسیم‌نشده داده‌ای را پاک نمی‌کند؛ هر تغییر دیگری همه دیسک‌ها را از نو می‌سازد و سیستم‌عامل دوباره نصب می‌شود.</p>
      <DiskLayoutEditor allowance={v.allowanceGb} sizes={val} onChange={setSizes} max={v.maxDisks} />
      {v.billed.length > 0 && <p className="text-[11px] text-white/50 mt-3">دیسک‌های خریداری‌شده جدا ({v.billed.map((d) => d.name + " " + fa(d.sizeGb) + " گیگ").join("، ")}) جزو این سهم نیستند.</p>}
      {!same && !append && <div className="mt-5 space-y-4">
        <div role="alert" className="rounded-xl bg-rose-500/[0.08] border border-rose-400/20 p-4 text-sm text-rose-100 flex gap-3"><Icon name="circle-alert" size={18} />همه داده‌های همه دیسک‌ها پاک می‌شود و سیستم‌عامل انتخابی نصب می‌شود. پیش از ادامه بکاپ بگیرید.</div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="سیستم‌عامل پس از تغییر"><Select value={os} onChange={setOs} label="سیستم‌عامل" ltr options={[{ value: "", label: "انتخاب کنید" }, ...oses.map((o) => ({ value: o.name, label: o.name }))]} /></Field>
          <Field label={"برای تأیید، hostname را بنویسید: " + s.hostname}><input value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" autoComplete="off" className={INPUT + " text-left mono"} /></Field>
        </div>
      </div>}
      <div className="mt-5 flex justify-end gap-2">
        {sizes && !same && <button type="button" onClick={() => { setSizes(null); setConfirm(""); }} className={BTN_G + BTN_MD}>بازگشت</button>}
        <AsyncButton danger={!append} disabled={same || sum !== v.allowanceGb || (!append && (!os || confirm.trim().toLowerCase() !== s.hostname.toLowerCase()))}
          onClick={async () => { const r = await panelApi.setLayout(s.id, append ? { sizes: val } : { sizes: val, os, confirm }); setSizes(null); setConfirm(""); x.reload(); notify(r.mode === "append" ? "دیسک جدید اضافه شد" : "چیدمان دیسک تغییر کرد و سیستم‌عامل در حال نصب است", "hard-drive"); }}>
          {append ? "افزودن دیسک" : "اعمال چیدمان و نصب مجدد"}
        </AsyncButton>
      </div>
    </Card>
  );
}

/* ---------- one log timeline ---------- */
const SRC: { value: LogSource; label: string }[] = [{ value: "all", label: "همه" }, { value: "virtualizor", label: "Virtualizor" }, { value: "site", label: "عملیات پنل" }, { value: "sync", label: "تغییرات همگام‌سازی" }];
const SRC_BADGE = { virtualizor: ["blue", "Virtualizor"], site: ["gray", "پنل"], sync: ["amber", "همگام‌سازی"] } as const;
export function LogsTimeline({ s }: { s: Server }) {
  const [page, setPage] = useState(1);
  const [source, setSource] = useState<LogSource>("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const x = useRemote([s.id, page, source, query, s.tasks.length].join(":"), () => panelApi.logs(s.id, { page, source, q: query }));
  return (
    <Card title="لاگ‌ها" icon="scroll-text" pad="p-3 sm:p-4">
      <form className="flex flex-col sm:flex-row gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(q); }}>
        <Select className="sm:w-56" value={source} onChange={(v) => { setSource(v as LogSource); setPage(1); }} label="منبع لاگ" options={SRC} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو در لاگ‌ها" aria-label="جست‌وجو در لاگ‌ها" className={INPUT + " flex-1"} />
        <button type="submit" className={BTN_G + BTN_MD}><Icon name="search" size={15} /> جست‌وجو</button>
      </form>
      {x.data?.vzError && <p role="alert" className="text-xs text-amber-200 px-2 mb-2">{x.data.vzError}</p>}
      {x.error ? <Empty icon="circle-alert" title="بارگذاری نشد" text={x.error} /> : !x.data ? <Loading /> : x.data.items.length === 0 ? <Empty icon="scroll-text" title="لاگی پیدا نشد" /> : <>
        <ol className="divide-y divide-white/[0.06]">
          {x.data.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3">
              <div className="min-w-0 flex items-start gap-2.5">
                <Icon name={i.status === "failed" ? "circle-x" : i.status === "running" ? "loader-circle" : "circle-check"} size={16} className={"mt-0.5 shrink-0 " + (i.status === "failed" ? "text-rose-300" : i.status === "running" ? "text-sky-300 animate-spin" : "text-emerald-300")} />
                <span className="text-sm [overflow-wrap:anywhere]">{i.text}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-white/50 shrink-0"><Badge tone={SRC_BADGE[i.source][0]}>{SRC_BADGE[i.source][1]}</Badge><span className="tabular">{i.at}</span></div>
            </li>
          ))}
        </ol>
        <div className="flex items-center justify-between mt-3 px-2 text-xs text-white/55">
          <span>{fa(x.data.total)} مورد</span>
          <div className="flex items-center gap-1">
            <IconBtn icon="chevron-right" label="صفحه قبل" onClick={() => setPage((p) => Math.max(1, p - 1))} />
            <span className="tabular">{fa(x.data.page)} / {fa(x.data.pages)}</span>
            <IconBtn icon="chevron-left" label="صفحه بعد" onClick={() => setPage((p) => Math.min(x.data!.pages, p + 1))} />
          </div>
        </div>
      </>}
    </Card>
  );
}

/* ---------- Virtualizor backups ---------- */
export function VzBackupsCard({ s }: { s: Server }) {
  const { notify } = useApp();
  const x = useRemote(s.id + ":vzb", () => panelApi.vzBackups(s.id));
  const [restore, setRestore] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  return (
    <Card title="بکاپ‌های Virtualizor" icon="archive" className="lg:col-span-2" pad="p-3 sm:p-4" action={x.data?.enabled ? <AsyncButton className={BTN_P + BTN_SM} confirmText="یک بکاپ کامل از دیسک سرور در Virtualizor گرفته شود؟" onClick={async () => { await panelApi.vzBackup(s.id); notify("ساخت بکاپ شروع شد", "archive"); x.reload(); }}><Icon name="plus" size={14} /> بکاپ جدید</AsyncButton> : null}>
      {x.error ? <Empty icon="circle-alert" title="بارگذاری نشد" text={x.error} /> : !x.data ? <Loading />
        : !x.data.enabled ? <Empty icon="archive" title="بکاپ Virtualizor برای این سرور فعال نیست" text="برای فعال‌سازی پلن بکاپ با پشتیبانی تماس بگیرید." />
        : x.data.list.length === 0 ? <Empty icon="archive" title="بکاپی ساخته نشده" />
        : x.data.list.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
            <div><div className="text-sm mono ltr text-right">{b.file}</div><div className="text-[11px] text-white/55">{b.date}{b.sizeMb ? "، " + fa(b.sizeMb) + " مگابایت" : ""}</div></div>
            {restore === b.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" placeholder={s.hostname} aria-label={"برای تأیید بازیابی، hostname را بنویسید: " + s.hostname} className={INPUT_BASE + " h-9 text-left text-xs mono w-48"} />
                <AsyncButton className={BTN_G + BTN_SM} danger disabled={confirm.trim().toLowerCase() !== s.hostname.toLowerCase()} onClick={async () => { await panelApi.vzRestore(s.id, b.id, confirm); setRestore(null); setConfirm(""); notify("بازیابی شروع شد", "refresh-cw"); }}>بازیابی</AsyncButton>
                <button type="button" onClick={() => setRestore(null)} className={BTN_G + BTN_SM}>انصراف</button>
              </div>
            ) : <button type="button" onClick={() => { setRestore(b.id); setConfirm(""); }} className={BTN_G + BTN_SM}>بازیابی…</button>}
          </div>
        ))}
    </Card>
  );
}

/* ---------- processes and services ---------- */
export function ProcessManager({ s }: { s: Server }) {
  const { notify, confirm } = useApp();
  const on = s.status === "running";
  const x = useRemote(s.id + ":proc:" + on, () => (on ? panelApi.processes(s.id) : Promise.resolve([])));
  return (
    <Card title="پردازه‌ها" icon="square-terminal" pad="p-3 sm:p-4" action={on ? <IconBtn icon="refresh-cw" label="به‌روزرسانی پردازه‌ها" onClick={() => x.reload()} /> : null}>
      {!on ? <Empty icon="power" title="سرور خاموش است" /> : x.error ? <Empty icon="circle-alert" title="بارگذاری نشد" text={x.error} /> : !x.data ? <Loading /> : x.data.length === 0 ? <Empty icon="square-terminal" title="پردازه‌ای گزارش نشد" /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[520px]">
          <thead><tr className="text-xs text-white/55"><th scope="col" className="text-right font-medium p-2">PID</th><th scope="col" className="text-right font-medium p-2">کاربر</th><th scope="col" className="text-right font-medium p-2">CPU ٪</th><th scope="col" className="text-right font-medium p-2">حافظه ٪</th><th scope="col" className="text-right font-medium p-2">فرمان</th><th><span className="sr-only-focusable">پایان</span></th></tr></thead>
          <tbody>{x.data.map((p) => (
            <tr key={p.pid} className="border-t border-white/[0.06]">
              <td className="p-2 mono">{p.pid}</td><td className="p-2 mono text-white/70">{p.user}</td><td className="p-2 tabular">{fa(p.cpu, 1)}</td><td className="p-2 tabular">{fa(p.mem, 1)}</td>
              <td className="p-2 mono text-xs ltr text-right text-white/70 max-w-[260px] truncate" title={p.command}>{p.command}</td>
              <td className="p-2 text-left">{p.pid > 1 && <IconBtn icon="ban" label={"پایان دادن به " + p.pid} className="hover:text-rose-300" onClick={async () => { if (await confirm("پردازه " + p.pid + " (" + p.command.slice(0, 40) + ") پایان یابد؟", { danger: true, ok: "پایان" })) { await panelApi.killProcesses(s.id, [p.pid]); notify("پردازه پایان یافت"); x.reload(); } }} />}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

export function ServiceManager({ s }: { s: Server }) {
  const { notify } = useApp();
  const on = s.status === "running";
  const x = useRemote(s.id + ":svc:" + on, () => (on ? panelApi.services(s.id) : Promise.resolve([])));
  const act = async (name: string, a: "start" | "stop" | "restart") => { await panelApi.serviceAction(s.id, [name], a); notify("سرویس " + name + ": " + { start: "شروع شد", stop: "متوقف شد", restart: "دوباره راه‌اندازی شد" }[a]); x.reload(); };
  return (
    <Card title="سرویس‌ها" icon="settings-2" pad="p-3 sm:p-4" action={on ? <IconBtn icon="refresh-cw" label="به‌روزرسانی سرویس‌ها" onClick={() => x.reload()} /> : null}>
      {!on ? <Empty icon="power" title="سرور خاموش است" /> : x.error ? <Empty icon="circle-alert" title="بارگذاری نشد" text={x.error} /> : !x.data ? <Loading /> : x.data.length === 0 ? <Empty icon="settings-2" title="سرویسی گزارش نشد" /> : x.data.map((v) => (
        <div key={v.name} className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl hover:bg-white/[0.03]">
          <span className="flex items-center gap-2 text-sm"><span className="mono ltr">{v.name}</span><Badge tone={v.running ? "green" : "gray"} dot>{v.running ? "در حال اجرا" : "متوقف"}</Badge></span>
          <div className="flex gap-1">
            {!v.running && <AsyncButton className={BTN_G + BTN_SM} onClick={() => act(v.name, "start")}>شروع</AsyncButton>}
            {v.running && <AsyncButton className={BTN_G + BTN_SM} onClick={() => act(v.name, "restart")}>راه‌اندازی دوباره</AsyncButton>}
            {v.running && <AsyncButton className={BTN_G + BTN_SM} danger confirmText={"سرویس " + v.name + " متوقف شود؟"} onClick={() => act(v.name, "stop")}>توقف</AsyncButton>}
          </div>
        </div>
      ))}
    </Card>
  );
}

/* ---------- SSH keys and IPv6 ---------- */
export function SshKeysCard({ s }: { s: Server }) {
  const db = useDB();
  const { notify } = useApp();
  const [pick, setPick] = useState<string[]>([]);
  return (
    <Card title="کلیدهای SSH روی سرور" icon="key-round">
      {db.sshKeys.length === 0 ? <Empty icon="key-round" title="کلید SSH ندارید" text="ابتدا در «حساب کاربری › کلیدهای SSH» یک کلید اضافه کنید." /> : <>
        <p className="text-xs text-white/55 leading-6 mb-3">کلیدهای انتخابی به authorized_keys کاربر root اضافه می‌شوند؛ رمز root تغییری نمی‌کند.</p>
        <div className="space-y-1.5">
          {db.sshKeys.map((k) => (
            <label key={k.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.03] text-sm cursor-pointer">
              <input type="checkbox" checked={pick.includes(k.id)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, k.id] : p.filter((x) => x !== k.id)))} />
              <span className="font-medium">{k.name}</span><span className="mono text-[11px] text-white/50 ltr truncate">{k.fingerprint}</span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end"><AsyncButton disabled={!pick.length} onClick={async () => { await panelApi.applySshKeys(s.id, pick); setPick([]); notify("کلیدها روی سرور نصب شد", "key-round"); }}>نصب روی سرور</AsyncButton></div>
      </>}
    </Card>
  );
}

export function Ipv6Card({ s }: { s: Server }) {
  const { notify } = useApp();
  const x = useRemote(s.id + ":v6:" + s.ipv6, () => panelApi.ipv6(s.id));
  const [ptr, setPtr] = useState<Record<string, string>>({});
  return (
    <Card title="IPv6" icon="globe" pad="p-3 sm:p-4">
      {x.error ? <Empty icon="circle-alert" title="بارگذاری نشد" text={x.error} /> : !x.data ? <Loading /> : x.data.length === 0 ? <Empty icon="globe" title="IPv6 ندارید" text="برای دریافت IPv6 تیکت ثبت کنید." /> : x.data.map((a) => (
        <div key={a} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-center p-2.5">
          <span className="mono text-xs ltr text-right break-all">{a}</span>
          <input value={ptr[a] ?? ""} onChange={(e) => setPtr((p) => ({ ...p, [a]: e.target.value }))} dir="ltr" placeholder="PTR، مثلاً mail.example.com" aria-label={"PTR برای " + a} className={INPUT_BASE + " h-9 text-left text-xs"} />
          <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { await panelApi.setPtr6(s.id, a, (ptr[a] ?? "").trim().toLowerCase()); notify("PTR ذخیره شد"); }}>ذخیره PTR</AsyncButton>
        </div>
      ))}
    </Card>
  );
}
