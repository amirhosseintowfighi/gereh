"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { TLDS, locLabel } from "@/lib/catalog";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { fa, hashStr, nowFa, toEnDigits, toman } from "@/lib/format";
import { api, byId, invGross, invTotal, useDB, useMyId, type DnsRecord, type Invoice, type Server, type Ticket } from "@/lib/store";
import { newSecret, otpauthUrl } from "@/lib/totp";
import { useApp } from "../app-context";
import { Wordmark } from "../brand";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field, Meter, StatusBadge } from "../ui";
import { AreaChart, AsyncButton, CopyText, DataTable, ICON_BTN, IconBtn, Menu, Modal, OtpInput, PageTitle, Select, StatCard, StrengthBar, Switch, Tabs } from "../ui-client";

const newBtn = (href: string, label: string) => <Link href={href as never} className={BTN_P + " px-4 h-10 text-sm"}><Icon name="plus" size={16} /> {label}</Link>;

/* ================= dashboard ================= */
export function UserDashboard() {
  const db = useDB(); const myId = useMyId();
  const me = byId(db.users, myId)!;
  const servers = db.servers.filter((s) => s.userId === myId);
  const unpaid = db.invoices.filter((i) => i.userId === myId && (i.status === "unpaid" || i.status === "overdue"));
  const openT = db.tickets.filter((t) => t.userId === myId && t.status !== "closed");
  const month = useMemo(() => new Date().toLocaleDateString("fa-IR", { month: "long" }), []);
  const traffic = useMemo(() => Array.from({ length: 30 }, (_, i) => 120 + Math.sin(i / 3) * 40 + (hashStr("t" + i) % 50)), []);
  const days = useMemo(() => Array.from({ length: 30 }, (_, i) => fa(i + 1) + " " + month), [month]);
  const services = servers.length + db.hosting.filter((h) => h.userId === myId).length + db.domains.filter((d) => d.userId === myId).length;
  const ann = db.announcements[0];
  return (
    <div>
      <PageTitle title={"سلام، " + me.name.split(" ")[0]} sub={"امروز " + nowFa() + "؛ همه سرویس‌های شما پایدار هستند."} action={newBtn("/vps", "سرویس جدید")} />
      {ann && (
        <div className={"mb-6 rounded-2xl border p-4 flex gap-3 text-sm " + (ann.level === "critical" ? "border-rose-300/25 bg-rose-400/[0.07]" : ann.level === "warning" ? "border-amber-300/25 bg-amber-400/[0.07]" : "border-sky-300/20 bg-sky-400/[0.07]")} role="note">
          <Icon name="megaphone" size={19} className="text-sky-200 mt-0.5" />
          <div><div className="font-bold text-sky-100">{ann.title}</div><div className="text-white/60 leading-7 mt-0.5">{ann.body}</div></div>
        </div>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon="server" label="سرویس‌های فعال" value={services} sub={fa(servers.filter((s) => s.status === "running").length) + " سرور روشن"} href="/panel/servers" />
        <StatCard icon="wallet" label="موجودی کیف پول" value={me.balance} suffix="تومان" href="/panel/billing?tab=wallet" />
        <StatCard icon="receipt" label="صورتحساب پرداخت‌نشده" value={unpaid.length} sub={unpaid.length ? toman(unpaid.reduce((s, i) => s + invGross(i, db.settings.tax), 0)) : "همه پرداخت شده"} tone={unpaid.length ? "down" : ""} href="/panel/billing" />
        <StatCard icon="message-circle" label="تیکت‌های باز" value={openT.length} href="/panel/tickets" />
      </div>
      <div className="grid xl:grid-cols-[1.6fr_1fr] gap-4 mt-4">
        <Card title="ترافیک خروجی ۳۰ روز اخیر" icon="activity" action={<span className="text-xs text-white/45">مجموع {fa(Math.round(traffic.reduce((a, b) => a + b, 0)))} گیگابایت</span>}>
          <AreaChart data={traffic} labels={days} unit="گیگابایت" height={210} />
        </Card>
        <Card title="اقدام سریع" icon="zap">
          <div className="grid grid-cols-2 gap-2.5">
            {[["server", "سرور جدید", "/vps"], ["globe", "ثبت دامنه", "/domains"], ["wallet", "شارژ کیف پول", "/panel/billing?tab=wallet"], ["message-circle", "تیکت جدید", "/panel/tickets?new=1"]].map(([ic, l, h]) => (
              <Link key={l} href={h as never} className="spot rounded-2xl p-4 text-right bg-white/[0.035] border border-white/[0.08] hover:border-white/20 transition">
                <Icon name={ic} size={20} className="acc" /><div className="text-sm font-bold mt-3">{l}</div>
              </Link>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid xl:grid-cols-[1.6fr_1fr] gap-4 mt-4">
        <Card title="سرورهای شما" icon="server" action={<Link href="/panel/servers" className="text-xs text-white/50 hover:text-white">همه</Link>} pad="p-2 sm:p-3">
          {servers.length === 0 ? <Empty icon="server" title="هنوز سروری ندارید" /> : servers.map((s) => (
            <Link key={s.id} href={("/panel/servers/" + s.id) as never} className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-white/[0.04] text-right">
              <span className={"w-2.5 h-2.5 rounded-full " + (s.status === "running" ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.7)]" : "bg-white/25")} aria-hidden="true" />
              <div className="flex-1 min-w-0"><div className="font-bold text-sm ltr text-right">{s.name}</div><div className="text-xs text-white/40 mt-0.5">{s.plan}، {locLabel(s.loc)}</div></div>
              <span className="mono text-xs text-white/50 hidden sm:block">{s.ip}</span>
              <StatusBadge s={s.status} />
            </Link>
          ))}
        </Card>
        <Card title="فعالیت‌های اخیر" icon="clock" pad="p-5">
          <ol className="space-y-4">
            {db.activity.slice(0, 6).map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] grid place-items-center shrink-0"><Icon name={a.icon} size={15} className="text-white/60" /></span>
                <div className="min-w-0"><div className="text-sm">{a.text}</div><div className="text-[11px] text-white/35 mt-0.5">{a.at}</div></div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

/* ================= servers list ================= */
export function PowerMenu({ s }: { s: Server }) {
  const { notify, confirm } = useApp();
  const act = async (a: "start" | "stop" | "reboot", msg: string) => {
    notify("در حال اجرا…", "loader-circle");
    try { await api.servers.power(s.id, a); notify(msg, "circle-check"); } catch (e) { notify(e instanceof Error ? e.message : "خطا", "circle-alert"); }
  };
  if (s.status === "suspended") return <span className="text-[11px] text-white/35">معلق</span>;
  return (
    <Menu label={"کنترل روشن و خاموش " + s.name} triggerClass={ICON_BTN} trigger={<Icon name="power" size={17} />} items={[
      s.status !== "running" && { icon: "play", label: "روشن کردن", run: () => act("start", s.name + " روشن شد") },
      s.status === "running" && { icon: "refresh-cw", label: "ری‌استارت", run: () => act("reboot", s.name + " ری‌استارت شد") },
      s.status === "running" && { icon: "pause", label: "خاموش کردن", danger: true, run: async () => { if (await confirm("سرور " + s.name + " خاموش شود؟ سرویس‌های در حال اجرا متوقف می‌شوند.", { danger: true, ok: "خاموش کن" })) act("stop", s.name + " خاموش شد"); } },
    ]} />
  );
}

export function UserServers() {
  const db = useDB(); const myId = useMyId(); const router = useRouter();
  const rows = db.servers.filter((s) => s.userId === myId);
  return (
    <div>
      <PageTitle title="سرورهای ابری" sub={fa(rows.length) + " سرور در حساب شما"} action={newBtn("/vps", "ساخت سرور")} />
      {rows.length === 0 ? <Card><Empty icon="server" title="هنوز سروری ندارید" text="اولین سرور ابری را در کمتر از یک دقیقه بسازید." action={<Link href="/vps" className={BTN_P + " px-5 h-10 text-sm"}>ساخت سرور</Link>} /></Card> : (
        <DataTable rows={rows} searchKeys={["name", "ip"]} filters={[{ key: "status", label: "وضعیت", options: ["running", "stopped", "suspended"] }]} onRowClick={(r) => router.push(("/panel/servers/" + r.id) as never)}
          columns={[
            { key: "name", label: "نام", sortable: true, render: (r) => <div className="flex items-center gap-3"><span className="w-9 h-9 rounded-xl tile grid place-items-center"><Icon name="server" size={16} /></span><div><div className="font-bold ltr text-right">{r.name}</div><div className="text-[11px] text-white/40">{r.os}</div></div></div> },
            { key: "ip", label: "آدرس IP", render: (r) => <CopyText text={r.ip} className="mono text-xs text-white/70" /> },
            { key: "plan", label: "مشخصات", render: (r) => <span className="text-white/70">{fa(r.cpu)} هسته، {fa(r.ram)} گیگ، {fa(r.disk)} گیگ</span> },
            { key: "loc", label: "موقعیت", render: (r) => locLabel(r.loc) },
            { key: "status", label: "وضعیت", render: (r) => <StatusBadge s={r.status} /> },
            { key: "act", label: "", className: "text-left", render: (r) => <PowerMenu s={r} /> },
          ]} />
      )}
    </div>
  );
}

/* ================= hosting ================= */
export function UserHosting({ id }: { id?: string }) {
  const db = useDB(); const myId = useMyId(); const router = useRouter();
  const { notify } = useApp();
  const rows = db.hosting.filter((h) => h.userId === myId);
  const h = id ? rows.find((x) => x.id === id) : undefined;
  const [pass, setPass] = useState("");
  if (id && !h) return <Card><Empty icon="layers" title="هاست پیدا نشد" action={<Link href="/panel/hosting" className={BTN_G + " px-4 h-10 text-sm"}>بازگشت به فهرست</Link>} /></Card>;
  if (h) return (
    <div>
      <PageTitle back={["/panel/hosting", "هاست‌ها"]} title={<span className="ltr inline-block">{h.domain}</span>} sub={<span className="flex gap-3 items-center"><StatusBadge s={h.status} />هاست {h.plan}، سرور {h.server}</span>}
        action={<AsyncButton onClick={async () => { notify("در حال ساخت لینک ورود یک‌بارمصرف…", "loader-circle"); /* POST /hosting/:id/sso → open returned URL */ await new Promise((r) => setTimeout(r, 600)); notify("لینک ورود به cPanel آماده است (نمایشی)", "external-link"); }}><Icon name="external-link" size={16} /> ورود به cPanel</AsyncButton>} />
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="مصرف" icon="gauge" className="lg:col-span-2">
          <div className="grid sm:grid-cols-2 gap-6">
            <Meter label="فضای دیسک" value={h.diskUsed} max={h.diskTotal} right={fa(h.diskUsed, 1) + " از " + fa(h.diskTotal) + " گیگ"} />
            <Meter label="ترافیک ماهانه" value={h.bwUsed} max={h.bwTotal} right={fa(h.bwUsed) + " از " + fa(h.bwTotal) + " گیگ"} />
            <Meter label="حساب‌های ایمیل" value={h.emails} max={25} right={fa(h.emails) + " از ۲۵"} />
            <Meter label="دیتابیس‌ها" value={h.dbs} max={10} right={fa(h.dbs) + " از ۱۰"} />
          </div>
        </Card>
        <Card title="اطلاعات" icon="file-text">
          <dl className="space-y-3 text-sm">{[["کنترل‌پنل", h.panel], ["سررسید", h.expires], ["هزینه", toman(h.price) + " / ماه"], ["نام‌سرورها", "ns1/ns2.gereh.cloud"]].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-white/45">{k}</dt><dd>{v}</dd></div>)}</dl>
        </Card>
        <Card title="رمز cPanel" icon="key-round">
          <p className="text-sm text-white/50 leading-7">رمز جدید فقط یک بار نمایش داده می‌شود.</p>
          {pass && <div className="mt-3 rounded-xl bg-black/30 border border-white/10 p-3 flex justify-between items-center"><CopyText text={pass} className="mono text-sm" /></div>}
          <div className="mt-4"><AsyncButton className={BTN_G + " px-4 h-10 text-sm"} confirmText="رمز فعلی cPanel باطل و رمز جدید ساخته شود؟" onClick={async () => setPass(await api.hosting.resetPassword(h.id))}><Icon name="refresh-cw" size={15} /> ساخت رمز جدید</AsyncButton></div>
        </Card>
        <Card title="تمدید و ارتقا" icon="trending-up" className="lg:col-span-2">
          <div className="flex flex-wrap gap-2">
            <Link href="/hosting" className={BTN_G + " px-4 h-10 text-sm"}><Icon name="trending-up" size={15} /> ارتقای پلن</Link>
            <AsyncButton onClick={async () => { const inv = await api.billing.checkout([{ title: "تمدید هاست " + h.domain, meta: "یک سال", base: h.price * 12 }]); notify("صورتحساب " + inv.id + " صادر شد"); router.push("/panel/billing"); }}>تمدید یک‌ساله ({toman(h.price * 12)})</AsyncButton>
          </div>
        </Card>
      </div>
    </div>
  );
  return (
    <div>
      <PageTitle title="هاست‌ها" sub={fa(rows.length) + " هاست"} action={newBtn("/hosting", "خرید هاست")} />
      <DataTable rows={rows} searchKeys={["domain"]} onRowClick={(r) => router.push(("/panel/hosting/" + r.id) as never)} empty="هاستی ندارید."
        columns={[
          { key: "domain", label: "دامنه", render: (r) => <span className="font-bold ltr">{r.domain}</span> },
          { key: "plan", label: "پلن" },
          { key: "disk", label: "دیسک", render: (r) => <div className="w-32"><Meter value={r.diskUsed} max={r.diskTotal} label="دیسک" /></div> },
          { key: "expires", label: "سررسید" },
          { key: "status", label: "وضعیت", render: (r) => <StatusBadge s={r.status} /> },
        ]} />
    </div>
  );
}

/* ================= domains ================= */
const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"];
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOST = /^(?=.{1,253}\.?$)([a-z0-9_](?:[a-z0-9-_]{0,61}[a-z0-9_])?\.)+[a-z]{2,63}\.?$/i;
function validateRecord(r: Omit<DnsRecord, "id"> & { id?: string }) {
  if (!r.name.trim()) return "نام را وارد کنید (برای خود دامنه @).";
  if (!/^(@|\*|[a-z0-9_*]([a-z0-9-_.]*[a-z0-9_])?)$/i.test(r.name.trim())) return "نام رکورد معتبر نیست.";
  const v = r.value.trim();
  if (!v) return "مقدار را وارد کنید.";
  if (r.type === "A" && !IPV4.test(v)) return "برای رکورد A یک آدرس IPv4 معتبر لازم است.";
  if (r.type === "AAAA" && !(/^[0-9a-f:]+$/i.test(v) && v.includes(":"))) return "برای رکورد AAAA یک آدرس IPv6 معتبر لازم است.";
  if ((r.type === "CNAME" || r.type === "MX" || r.type === "NS") && !HOST.test(v)) return "مقدار باید یک نام میزبان معتبر باشد؛ مثل mail.example.com";
  if (r.type === "MX" && !(Number(r.priority) >= 0 && Number(r.priority) <= 65535)) return "اولویت MX باید عددی بین ۰ تا ۶۵۵۳۵ باشد.";
  return "";
}

export function UserDomains({ id }: { id?: string }) {
  const db = useDB(); const myId = useMyId(); const router = useRouter();
  const { notify, confirm } = useApp();
  const rows = db.domains.filter((d) => d.userId === myId);
  const d = id ? rows.find((x) => x.id === id) : undefined;
  const [tab, setTab] = useState("dns");
  const [rec, setRec] = useState<(Omit<DnsRecord, "id"> & { id?: string }) | null>(null);
  const [ns, setNs] = useState<string[] | null>(null);
  const [years, setYears] = useState(1);
  const [showCode, setShowCode] = useState(false);
  if (id && !d) return <Card><Empty icon="globe" title="دامنه پیدا نشد" action={<Link href="/panel/domains" className={BTN_G + " px-4 h-10 text-sm"}>بازگشت به فهرست</Link>} /></Card>;
  if (!d) return (
    <div>
      <PageTitle title="دامنه‌ها" sub={fa(rows.length) + " دامنه"} action={newBtn("/domains", "ثبت دامنه")} />
      <DataTable rows={rows} searchKeys={["name"]} onRowClick={(r) => router.push(("/panel/domains/" + r.id) as never)} empty="دامنه‌ای ندارید."
        columns={[
          { key: "name", label: "دامنه", sortable: true, render: (r) => <span className="font-bold ltr">{r.name}</span> },
          { key: "expires", label: "سررسید", sortable: true },
          { key: "autoRenew", label: "تمدید خودکار", render: (r) => r.autoRenew ? <Badge tone="green">فعال</Badge> : <Badge>خاموش</Badge> },
          { key: "ns", label: "نام‌سرور", render: (r) => <span className="mono text-xs text-white/55">{r.ns[0]}</span> },
          { key: "status", label: "وضعیت", render: (r) => <StatusBadge s={r.status} /> },
        ]} />
    </div>
  );
  const t = TLDS.slice().sort((a, b) => b.tld.length - a.tld.length).find((x) => d.name.endsWith(x.tld)) || TLDS[0];
  const curNs = ns || d.ns;
  const [ey, ...rest] = d.expires.split("/");
  const newExpiry = fa(Number(toEnDigits(ey)) + years, 0).replace(/٬/g, "") + "/" + rest.join("/");
  return (
    <div>
      <PageTitle back={["/panel/domains", "دامنه‌ها"]} title={<span className="ltr inline-block">{d.name}</span>} sub={<span className="flex gap-3 items-center"><StatusBadge s={d.status} />سررسید {d.expires}</span>} />
      <div className="overflow-x-auto no-scrollbar mb-6"><Tabs size="sm" value={tab} onChange={setTab} label="بخش‌های دامنه" options={[{ id: "dns", label: "رکوردهای DNS", icon: "settings-2" }, { id: "ns", label: "نام‌سرورها", icon: "server" }, { id: "settings", label: "امنیت و انتقال", icon: "lock" }, { id: "renew", label: "تمدید", icon: "refresh-cw" }]} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "dns" && <>
          <Card title="رکوردها" icon="settings-2" pad="p-3 sm:p-4" action={d.ns[0].includes("gereh") && <button type="button" onClick={() => setRec({ type: "A", name: "", value: "", ttl: 3600 })} className={BTN_P + " px-3 h-9 text-xs"}><Icon name="plus" size={15} /> رکورد جدید</button>}>
            {!d.ns[0].includes("gereh") ? <Empty icon="server" title="DNS این دامنه جای دیگری مدیریت می‌شود" text={"نام‌سرورها روی " + d.ns[0] + " تنظیم شده‌اند. برای مدیریت رکوردها در گره، نام‌سرورها را به ns1.gereh.cloud تغییر دهید."} />
              : d.dns.length === 0 ? <Empty icon="settings-2" title="رکوردی ندارید" /> : (
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
                <thead><tr className="text-xs text-white/40"><th scope="col" className="text-right font-medium p-3">نوع</th><th scope="col" className="text-right font-medium p-3">نام</th><th scope="col" className="text-right font-medium p-3">مقدار</th><th scope="col" className="text-right font-medium p-3">TTL</th><th><span className="sr-only-focusable">اقدامات</span></th></tr></thead>
                <tbody>{d.dns.map((r) => (
                  <tr key={r.id} className="border-t border-white/[0.06] hover:bg-white/[0.02]">
                    <td className="p-3"><Badge tone="blue">{r.type}</Badge></td><td className="p-3 mono ltr text-right">{r.name}</td>
                    <td className="p-3 mono text-xs ltr text-right text-white/70 max-w-[280px] truncate">{r.priority !== undefined && r.type === "MX" ? r.priority + " " : ""}{r.value}</td><td className="p-3 tabular text-white/55">{fa(r.ttl)}</td>
                    <td className="p-3 text-left whitespace-nowrap">
                      <IconBtn icon="pencil" label={"ویرایش رکورد " + r.name} onClick={() => setRec({ ...r })} />
                      <IconBtn icon="trash-2" label={"حذف رکورد " + r.name} className="hover:text-rose-300" onClick={async () => { if (await confirm("رکورد " + r.type + " " + r.name + " حذف شود؟", { danger: true, ok: "حذف" })) { await api.domains.removeRecord(d.id, r.id); notify("رکورد حذف شد"); } }} />
                    </td>
                  </tr>
                ))}</tbody></table></div>
            )}
          </Card>
          <Modal open={!!rec} onClose={() => setRec(null)} title={rec?.id ? "ویرایش رکورد" : "رکورد جدید"} icon="settings-2"
            footer={<><button type="button" onClick={() => setRec(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => {
              if (!rec) return;
              const r = { ...rec, name: rec.name.trim(), value: rec.value.trim(), ...(rec.type === "MX" ? { priority: Number(rec.priority ?? 10) } : { priority: undefined }) };
              const err = validateRecord(r); if (err) throw new Error(err);
              if (r.id) await api.domains.updateRecord(d.id, r as DnsRecord); else await api.domains.addRecord(d.id, r);
              setRec(null); notify("رکورد ذخیره شد");
            }}>ذخیره</AsyncButton></>}>
            {rec && <div className="grid grid-cols-2 gap-4">
              <Field label="نوع"><Select value={rec.type} label="نوع رکورد" onChange={(v) => setRec((r) => r && { ...r, type: v })} options={DNS_TYPES} ltr /></Field>
              <Field label="TTL"><Select value={String(rec.ttl)} label="TTL" onChange={(v) => setRec((r) => r && { ...r, ttl: +v })} options={[{ value: "300", label: "۵ دقیقه" }, { value: "3600", label: "۱ ساعت" }, { value: "86400", label: "۱ روز" }]} /></Field>
              <Field label="نام" hint="@ برای خود دامنه"><input value={rec.name} onChange={(e) => setRec((r) => r && { ...r, name: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} /></Field>
              {rec.type === "MX" ? <Field label="اولویت"><input value={rec.priority ?? 10} inputMode="numeric" onChange={(e) => setRec((r) => r && { ...r, priority: +toEnDigits(e.target.value).replace(/\D/g, "") })} dir="ltr" className={INPUT + " text-left mono"} /></Field> : <div />}
              <Field className="col-span-2" label="مقدار"><input value={rec.value} onChange={(e) => setRec((r) => r && { ...r, value: e.target.value })} dir="ltr" className={INPUT + " text-left mono"} placeholder={rec.type === "A" ? "185.143.232.17" : rec.type === "CNAME" ? "target.example.com" : ""} /></Field>
            </div>}
          </Modal>
        </>}
        {tab === "ns" && (
          <Card title="نام‌سرورها" icon="server">
            <div className="space-y-3 max-w-lg">
              {curNs.map((n, i) => (
                <Field key={i} label={"نام‌سرور " + fa(i + 1)}>
                  <div className="flex gap-2">
                    <input value={n} onChange={(e) => { const a = curNs.slice(); a[i] = e.target.value; setNs(a); }} dir="ltr" className={INPUT + " text-left mono"} />
                    {curNs.length > 2 && <IconBtn icon="x" label={"حذف نام‌سرور " + fa(i + 1)} onClick={() => setNs(curNs.filter((_, k) => k !== i))} />}
                  </div>
                </Field>
              ))}
              {curNs.length < 4 && <button type="button" onClick={() => setNs([...curNs, ""])} className="text-xs text-white/55 hover:text-white flex items-center gap-1"><Icon name="plus" size={14} /> افزودن نام‌سرور</button>}
            </div>
            <div className="mt-6 flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={() => setNs(["ns1.gereh.cloud", "ns2.gereh.cloud"])} className={BTN_G + " px-4 h-10 text-sm"}>بازگشت به پیش‌فرض گره</button>
              <AsyncButton onClick={async () => {
                const list = curNs.map((x) => x.trim().toLowerCase()).filter(Boolean);
                if (list.length < 2) throw new Error("حداقل دو نام‌سرور لازم است.");
                if (list.some((x) => !HOST.test(x))) throw new Error("نام‌سرور معتبر نیست؛ مثل ns1.example.com");
                if (new Set(list).size !== list.length) throw new Error("نام‌سرور تکراری است.");
                await api.domains.setNs(d.id, list); setNs(null); notify("نام‌سرورها به‌روز شدند؛ اعمال تا ۲۴ ساعت");
              }}>ذخیره تغییرات</AsyncButton>
            </div>
          </Card>
        )}
        {tab === "settings" && (
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="تنظیمات" icon="lock" pad="p-2 sm:p-3">
              {([["autoRenew", "تمدید خودکار", "پیش از سررسید از کیف پول تمدید می‌شود."], ["privacy", "محافظت از اطلاعات مالک", "اطلاعات تماس در WHOIS نمایش داده نمی‌شود."], ["locked", "قفل انتقال", "از انتقال بدون اجازه دامنه جلوگیری می‌کند."]] as const).map(([k, l, hint]) => (
                <div key={k} className="flex items-center justify-between gap-4 p-3 rounded-xl">
                  <div><div className="text-sm font-bold">{l}</div><div className="text-xs text-white/45 mt-1">{hint}</div></div>
                  <Switch on={d[k]} label={l} onChange={async () => { await api.domains.toggle(d.id, k); notify(l + (d[k] ? " خاموش شد" : " فعال شد")); }} />
                </div>
              ))}
            </Card>
            <Card title="کد انتقال (EPP)" icon="key-round">
              {d.locked ? <p className="text-sm text-white/55 leading-7">برای دریافت کد انتقال، ابتدا قفل انتقال را خاموش کنید.</p>
                : !d.authCode ? <p className="text-sm text-white/55 leading-7">کد انتقال این دامنه از رجیستری دریافت نشده است؛ برای دریافت تیکت ثبت کنید.</p> : (
                <div className="rounded-xl bg-black/30 border border-white/10 p-3 flex justify-between items-center">
                  <span className="mono ltr">{showCode ? d.authCode : "••••••••••••"}</span>
                  <div className="flex gap-1 items-center"><IconBtn icon={showCode ? "eye-off" : "eye"} label={showCode ? "پنهان کردن کد" : "نمایش کد"} onClick={() => setShowCode((x) => !x)} />{showCode && <CopyText text={d.authCode} className="text-xs" />}</div>
                </div>
              )}
            </Card>
          </div>
        )}
        {tab === "renew" && (
          <Card title="تمدید دامنه" icon="refresh-cw">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 max-w-2xl" role="radiogroup" aria-label="مدت تمدید">
              {[1, 2, 3, 5, 10].map((y) => <button type="button" role="radio" aria-checked={years === y} key={y} onClick={() => setYears(y)} className={"rounded-xl p-4 border text-center transition " + (years === y ? "bg-white/[0.1] border-white/40" : "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]")}><div className="font-black">{fa(y)} سال</div><div className="text-[11px] text-white/45 mt-1 tabular">{toman(t.renew * y)}</div></button>)}
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 max-w-2xl">
              <div className="text-sm text-white/55">سررسید جدید پس از تمدید: <span className="text-white">{newExpiry}</span></div>
              <AsyncButton onClick={async () => { const inv = await api.domains.renew(d.id, years); notify("صورتحساب " + inv.id + " صادر شد"); router.push("/panel/billing"); }}>صدور صورتحساب</AsyncButton>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ================= billing ================= */
export function InvoiceModal({ inv, onClose, onPay }: { inv: Invoice | null; onClose: () => void; onPay?: (i: Invoice) => void }) {
  const db = useDB();
  if (!inv) return null;
  const sub = invTotal(inv), total = invGross(inv, db.settings.tax), tax = total - sub;
  return (
    <Modal open onClose={onClose} title={"صورتحساب " + inv.id} icon="receipt" size="max-w-2xl"
      footer={<><button type="button" onClick={() => window.print()} className={BTN_G + " px-4 h-10 text-sm"}><Icon name="printer" size={16} /> چاپ</button>{(inv.status === "unpaid" || inv.status === "overdue") && onPay && <button type="button" onClick={() => onPay(inv)} className={BTN_P + " px-5 h-10 text-sm"}>پرداخت</button>}</>}>
      <div className="print-area">
        <div className="flex justify-between items-start">
          <div><Wordmark size={30} /><div className="text-xs text-white/45 mt-3 leading-6">شرکت گره ابر پارس<br />زیرمجموعه ویرگول</div></div>
          <div className="text-left text-sm space-y-1"><StatusBadge s={inv.status} /><div className="text-white/50 mt-2">تاریخ: {inv.date}</div><div className="text-white/50">سررسید: {inv.due}</div></div>
        </div>
        <table className="w-full text-sm mt-8"><thead><tr className="text-xs text-white/40 border-b border-white/10"><th scope="col" className="text-right font-medium pb-3">شرح</th><th scope="col" className="text-left font-medium pb-3">مبلغ</th></tr></thead>
          <tbody>{inv.items.map((it, i) => <tr key={i} className="border-b border-white/[0.06]"><td className="py-3">{it.desc}</td><td className="py-3 text-left tabular">{toman(it.amount)}</td></tr>)}</tbody></table>
        <div className="mt-5 mr-auto max-w-xs space-y-2 text-sm">
          <div className="flex justify-between text-white/60"><span>جمع</span><span className="tabular">{toman(sub)}</span></div>
          <div className="flex justify-between text-white/60"><span>مالیات بر ارزش افزوده ({fa(db.settings.tax)}٪)</span><span className="tabular">{toman(tax)}</span></div>
          <div className="flex justify-between font-black text-base pt-2 border-t border-white/10"><span>مبلغ کل</span><span className="tabular">{toman(total)}</span></div>
        </div>
      </div>
    </Modal>
  );
}

export function UserBilling() {
  const db = useDB(); const myId = useMyId();
  const { notify } = useApp();
  const params = useSearchParams();
  const me = byId(db.users, myId)!;
  const [tab, setTab] = useState(params.get("tab") === "wallet" ? "wallet" : "invoices");
  const [view, setView] = useState<Invoice | null>(null);
  const [pay, setPay] = useState<Invoice | null>(null);
  const [method, setMethod] = useState<"wallet" | "gateway">("wallet");
  const [amount, setAmount] = useState(1000000);
  const tabParam = params.get("tab");
  const [seenTabParam, setSeenTabParam] = useState(tabParam);
  if (seenTabParam !== tabParam) { setSeenTabParam(tabParam); if (tabParam === "wallet") setTab("wallet"); }
  const invs = db.invoices.filter((i) => i.userId === myId);
  const txs = db.transactions.filter((t) => t.userId === myId);
  const total = (inv: Invoice) => invGross(inv, db.settings.tax);
  const openPay = (i: Invoice) => { setMethod(me.balance >= total(i) ? "wallet" : "gateway"); setPay(i); };
  return (
    <div>
      <PageTitle title="صورتحساب و کیف پول" sub="پرداخت‌ها، صورتحساب‌ها و تراکنش‌های حساب" />
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <StatCard icon="wallet" label="موجودی کیف پول" value={me.balance} suffix="تومان" />
        <StatCard icon="receipt" label="بدهی جاری" value={invs.filter((i) => i.status === "unpaid" || i.status === "overdue").reduce((s, i) => s + total(i), 0)} suffix="تومان" />
        <StatCard icon="trending-up" label="پرداختی امسال" value={invs.filter((i) => i.status === "paid").reduce((s, i) => s + total(i), 0)} suffix="تومان" />
      </div>
      <div className="mb-6"><Tabs size="sm" value={tab} onChange={setTab} label="بخش مالی" options={[{ id: "invoices", label: "صورتحساب‌ها", icon: "receipt" }, { id: "wallet", label: "شارژ کیف پول", icon: "wallet" }, { id: "tx", label: "تراکنش‌ها", icon: "arrow-down-up" }]} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "invoices" && (
          <DataTable rows={invs} searchKeys={["id"]} filters={[{ key: "status", label: "وضعیت", options: ["unpaid", "overdue", "paid", "refunded"] }]} onRowClick={setView} empty="صورتحسابی ندارید."
            columns={[
              { key: "id", label: "شماره", render: (r) => <span className="mono text-xs">{r.id}</span> },
              { key: "desc", label: "شرح", render: (r) => <span className="text-white/70">{r.items[0].desc}{r.items.length > 1 ? " و " + fa(r.items.length - 1) + " مورد دیگر" : ""}</span> },
              { key: "date", label: "تاریخ" },
              { key: "amount", label: "مبلغ", sortable: true, sortValue: total, render: (r) => <span className="tabular font-bold">{toman(total(r))}</span> },
              { key: "status", label: "وضعیت", render: (r) => <StatusBadge s={r.status} /> },
              { key: "act", label: "", className: "text-left", render: (r) => (r.status === "unpaid" || r.status === "overdue") ? <button type="button" onClick={(e) => { e.stopPropagation(); openPay(r); }} className={BTN_P + " px-3 h-8 text-xs"}>پرداخت</button> : <IconBtn icon="file-text" label={"مشاهده " + r.id} onClick={(e) => { e.stopPropagation(); setView(r); }} /> },
            ]} />
        )}
        {tab === "wallet" && (
          <Card title="افزایش موجودی" icon="wallet">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-2xl" role="radiogroup" aria-label="مبلغ پیشنهادی">
              {[500000, 1000000, 2000000, 5000000].map((a) => <button type="button" role="radio" aria-checked={amount === a} key={a} onClick={() => setAmount(a)} className={"rounded-xl p-4 border text-center transition tabular " + (amount === a ? "bg-white/[0.1] border-white/40 font-bold" : "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]")}>{toman(a)}</button>)}
            </div>
            <Field className="mt-5 max-w-sm" label="مبلغ دلخواه (تومان)" hint="حداقل ۱۰۰٬۰۰۰ و حداکثر ۵۰۰٬۰۰۰٬۰۰۰ تومان"><input value={amount ? amount.toLocaleString("en-US") : ""} onChange={(e) => setAmount(+toEnDigits(e.target.value).replace(/\D/g, "").slice(0, 10) || 0)} dir="ltr" inputMode="numeric" className={INPUT + " text-left tabular"} /></Field>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <AsyncButton onClick={async () => { if (amount < 100000) throw new Error("حداقل مبلغ شارژ ۱۰۰٬۰۰۰ تومان است."); if (amount > 500000000) throw new Error("حداکثر مبلغ شارژ ۵۰۰ میلیون تومان است."); await api.billing.topup(amount); notify("کیف پول " + toman(amount) + " شارژ شد", "wallet"); }} className={BTN_P + " px-6 h-11"}><Icon name="lock" size={16} /> پرداخت {toman(amount)} با درگاه</AsyncButton>
              <span className="text-xs text-white/40">پرداخت امن از طریق درگاه زرین‌پال (نمایشی)</span>
            </div>
          </Card>
        )}
        {tab === "tx" && (
          <DataTable rows={txs} searchKeys={["id", "desc"]} filters={[{ key: "type", label: "نوع", options: ["topup", "payment", "refund"] }]} empty="تراکنشی ثبت نشده است."
            columns={[
              { key: "id", label: "شناسه", render: (r) => <span className="mono text-xs">{r.id}</span> },
              { key: "desc", label: "شرح" }, { key: "method", label: "روش" }, { key: "date", label: "تاریخ" },
              { key: "amount", label: "مبلغ", render: (r) => <span className={"tabular font-bold " + (r.amount > 0 ? "text-emerald-300" : "")}><span className="ltr">{r.amount > 0 ? "+" : "−"}</span>{toman(Math.abs(r.amount))}</span> },
            ]} />
        )}
      </div>
      <InvoiceModal inv={view} onClose={() => setView(null)} onPay={(i) => { setView(null); openPay(i); }} />
      <Modal open={!!pay} onClose={() => setPay(null)} title={pay ? "پرداخت " + pay.id : ""} icon="lock"
        footer={<><button type="button" onClick={() => setPay(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => { if (!pay) return; await api.billing.pay(pay.id, method); setPay(null); notify("صورتحساب پرداخت شد", "circle-check"); }}>پرداخت {pay ? toman(total(pay)) : ""}</AsyncButton></>}>
        {pay && <>
          <div className="text-center mb-6"><div className="text-xs text-white/45">مبلغ قابل پرداخت</div><div className="text-3xl font-black silver mt-2 tabular">{toman(total(pay))}</div></div>
          <div className="space-y-2" role="radiogroup" aria-label="روش پرداخت">
            {([["wallet", "wallet", "کیف پول", "موجودی: " + toman(me.balance) + (me.balance < total(pay) ? " (کافی نیست)" : "")], ["gateway", "lock", "درگاه بانکی", "همه کارت‌های عضو شتاب"]] as const).map(([k, ic, l, hint]) => (
              <button type="button" role="radio" aria-checked={method === k} key={k} onClick={() => setMethod(k)} className={"w-full flex items-center gap-3 p-4 rounded-xl border text-right transition " + (method === k ? "bg-white/[0.08] border-white/35" : "bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.05]")}>
                <span className={"w-4 h-4 rounded-full border-2 " + (method === k ? "border-white bg-white shadow-[inset_0_0_0_3px_#0b0d16]" : "border-white/30")} />
                <Icon name={ic} size={18} className="acc" /><div className="flex-1"><div className="text-sm font-bold">{l}</div><div className="text-[11px] text-white/45">{hint}</div></div>
              </button>
            ))}
          </div>
        </>}
      </Modal>
    </div>
  );
}

/* ================= tickets ================= */
export function TicketThread({ t, as = "user" }: { t: Ticket; as?: "user" | "staff" }) {
  const { notify } = useApp();
  const [text, setText] = useState("");
  return (
    <div>
      <ol className="space-y-4">
        {t.messages.map((m, i) => (
          <li key={i} className={"flex gap-3 " + (m.from === "staff" ? "flex-row-reverse" : "")}>
            <span className={"w-9 h-9 rounded-xl grid place-items-center text-sm font-black shrink-0 " + (m.from === "staff" ? "acc-bg" : "tile")} aria-hidden="true">{m.name[0]}</span>
            <div className={"max-w-[85%] rounded-2xl p-4 " + (m.from === "staff" ? "bg-[#9cc9ff]/[0.08] border border-[#9cc9ff]/20" : "bg-white/[0.04] border border-white/[0.08]")}>
              <div className="flex flex-wrap items-center gap-3 text-xs"><span className="font-bold">{m.name}</span>{m.from === "staff" && <Badge tone="blue">پشتیبانی گره</Badge>}<span className="text-white/35">{m.at}</span></div>
              <p className="text-sm text-white/80 leading-7 mt-2 whitespace-pre-wrap break-words">{m.text}</p>
            </div>
          </li>
        ))}
      </ol>
      {t.status !== "closed" ? (
        <form className="mt-6 rounded-2xl bg-white/[0.03] border border-white/[0.1] p-3" onSubmit={(e) => e.preventDefault()}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="پاسخ خود را بنویسید…" aria-label="متن پاسخ" className="w-full bg-transparent outline-none text-sm p-2 resize-none placeholder:text-white/30" />
          <div className="flex items-center justify-end">
            <AsyncButton onClick={async () => { if (text.trim().length < 2) throw new Error("متن پاسخ خالی است."); await api.tickets.reply(t.id, text.trim(), as); setText(""); notify("پاسخ ارسال شد", "send"); }}><Icon name="send" size={15} /> ارسال</AsyncButton>
          </div>
        </form>
      ) : <div className="mt-6 text-center text-sm text-white/45">این تیکت بسته شده است.</div>}
    </div>
  );
}

const EMPTY_TICKET = { subject: "", dept: "فنی", priority: "normal", service: "", message: "" };
export function UserTickets({ id }: { id?: string }) {
  const db = useDB(); const myId = useMyId(); const router = useRouter();
  const params = useSearchParams();
  const { notify } = useApp();
  const rows = db.tickets.filter((t) => t.userId === myId);
  const t = id ? rows.find((x) => x.id === id) : undefined;
  const [open, setOpen] = useState(params.get("new") === "1");
  const [f, setF] = useState(EMPTY_TICKET);
  const myServices = [...db.servers.filter((s) => s.userId === myId).map((s) => ({ value: s.id, label: "سرور " + s.name })), ...db.domains.filter((d) => d.userId === myId).map((d) => ({ value: d.id, label: "دامنه " + d.name }))];
  if (id && !t) return <Card><Empty icon="message-circle" title="تیکت پیدا نشد" action={<Link href="/panel/tickets" className={BTN_G + " px-4 h-10 text-sm"}>بازگشت به فهرست</Link>} /></Card>;
  if (t) return (
    <div>
      <PageTitle back={["/panel/tickets", "تیکت‌ها"]} title={t.subject} sub={<span className="flex flex-wrap gap-3 items-center"><span className="mono text-xs">{t.id}</span><StatusBadge s={t.status} /><span>واحد {t.dept}</span><StatusBadge s={t.priority} /></span>}
        action={t.status !== "closed" && <AsyncButton className={BTN_G + " px-4 h-10 text-sm"} confirmText="تیکت بسته شود؟" onClick={async () => { await api.tickets.update(t.id, { status: "closed" }); notify("تیکت بسته شد"); }}><Icon name="circle-check" size={16} /> بستن تیکت</AsyncButton>} />
      <Card><TicketThread t={t} /></Card>
    </div>
  );
  return (
    <div>
      <PageTitle title="تیکت‌های پشتیبانی" sub="میانگین زمان پاسخ: ۹ دقیقه" action={<button type="button" onClick={() => setOpen(true)} className={BTN_P + " px-4 h-10 text-sm"}><Icon name="plus" size={16} /> تیکت جدید</button>} />
      <DataTable rows={rows} searchKeys={["subject", "id"]} filters={[{ key: "status", label: "وضعیت", options: ["open", "answered", "customer-reply", "closed"] }]} onRowClick={(r) => router.push(("/panel/tickets/" + r.id) as never)} empty="تیکتی ندارید."
        columns={[
          { key: "id", label: "شماره", render: (r) => <span className="mono text-xs">{r.id}</span> },
          { key: "subject", label: "موضوع", render: (r) => <span className="font-bold">{r.subject}</span> },
          { key: "dept", label: "واحد" }, { key: "priority", label: "اولویت", render: (r) => <StatusBadge s={r.priority} /> },
          { key: "updated", label: "آخرین به‌روزرسانی" }, { key: "status", label: "وضعیت", render: (r) => <StatusBadge s={r.status} /> },
        ]} />
      <Modal open={open} onClose={() => setOpen(false)} title="تیکت جدید" icon="message-circle" size="max-w-2xl"
        footer={<><button type="button" onClick={() => setOpen(false)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => {
          if (f.subject.trim().length < 3) throw new Error("موضوع را وارد کنید.");
          if (f.message.trim().length < 10) throw new Error("توضیح باید حداقل ۱۰ کاراکتر باشد.");
          const nid = await api.tickets.create({ ...f, subject: f.subject.trim(), message: f.message.trim() });
          setOpen(false); setF(EMPTY_TICKET); notify("تیکت " + nid + " ثبت شد", "send"); router.push(("/panel/tickets/" + nid) as never);
        }}><Icon name="send" size={15} /> ثبت تیکت</AsyncButton></>}>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="واحد"><Select value={f.dept} label="واحد" onChange={(v) => setF((s) => ({ ...s, dept: v }))} options={["فنی", "مالی", "فروش"]} /></Field>
          <Field label="اولویت"><Select value={f.priority} label="اولویت" onChange={(v) => setF((s) => ({ ...s, priority: v }))} options={[{ value: "low", label: "کم" }, { value: "normal", label: "معمولی" }, { value: "high", label: "فوری" }]} /></Field>
          <Field label="سرویس مرتبط"><Select value={f.service} label="سرویس مرتبط" onChange={(v) => setF((s) => ({ ...s, service: v }))} options={[{ value: "", label: "هیچ‌کدام" }, ...myServices]} /></Field>
          <Field className="sm:col-span-3" label="موضوع"><input value={f.subject} maxLength={120} onChange={(e) => setF((s) => ({ ...s, subject: e.target.value }))} className={INPUT} /></Field>
          <Field className="sm:col-span-3" label="توضیحات" hint="هرچه دقیق‌تر بنویسید، سریع‌تر حل می‌شود."><textarea value={f.message} maxLength={5000} onChange={(e) => setF((s) => ({ ...s, message: e.target.value }))} rows={6} className={TEXTAREA} /></Field>
        </div>
      </Modal>
    </div>
  );
}

/* ================= SSH & API ================= */
export function UserKeys() {
  const db = useDB();
  const { notify, confirm } = useApp();
  const [keyM, setKeyM] = useState(false);
  const [tokM, setTokM] = useState(false);
  const [k, setK] = useState({ name: "", pub: "" });
  const [tk, setTk] = useState({ name: "", scope: "read", expires: "۹۰ روز" });
  const [secret, setSecret] = useState("");
  return (
    <div>
      <PageTitle title="SSH و API" sub="کلیدهای دسترسی به سرورها و توکن‌های API" />
      <div className="grid xl:grid-cols-2 gap-4">
        <Card title="کلیدهای SSH" icon="key-round" pad="p-3 sm:p-4" action={<button type="button" onClick={() => setKeyM(true)} className={BTN_P + " px-3 h-9 text-xs"}><Icon name="plus" size={15} /> افزودن کلید</button>}>
          {db.sshKeys.length === 0 ? <Empty icon="key-round" title="کلیدی ندارید" text="با کلید SSH، بدون رمز و امن‌تر وارد سرورها شوید." /> : db.sshKeys.map((x) => (
            <div key={x.id} className="flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
              <div className="flex items-center gap-3 min-w-0"><span className="w-9 h-9 rounded-xl tile grid place-items-center"><Icon name="key-round" size={16} /></span><div className="min-w-0"><div className="text-sm font-bold truncate">{x.name}</div><div className="mono text-[11px] text-white/40 ltr text-right">{x.fingerprint}</div></div></div>
              <div className="flex items-center gap-3"><span className="text-[11px] text-white/35 hidden sm:block">{x.added}</span><IconBtn icon="trash-2" label={"حذف کلید " + x.name} className="hover:text-rose-300" onClick={async () => { if (await confirm("کلید " + x.name + " حذف شود؟", { danger: true, ok: "حذف" })) { await api.account.removeKey(x.id); notify("کلید حذف شد"); } }} /></div>
            </div>
          ))}
        </Card>
        <Card title="توکن‌های API" icon="code-xml" pad="p-3 sm:p-4" action={<button type="button" onClick={() => { setSecret(""); setTk({ name: "", scope: "read", expires: "۹۰ روز" }); setTokM(true); }} className={BTN_P + " px-3 h-9 text-xs"}><Icon name="plus" size={15} /> توکن جدید</button>}>
          {db.apiTokens.length === 0 ? <Empty icon="code-xml" title="توکنی ندارید" /> : db.apiTokens.map((x) => (
            <div key={x.id} className="flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
              <div><div className="text-sm font-bold ltr text-right">{x.name}</div><div className="text-[11px] text-white/40 mt-1 flex gap-3"><Badge tone={x.scope === "read" ? "gray" : "amber"}>{x.scope === "read" ? "فقط خواندن" : "خواندن و نوشتن"}</Badge><span>آخرین استفاده: {x.lastUsed}</span></div></div>
              <AsyncButton className="text-xs text-rose-300 hover:text-rose-200 px-2" danger confirmText="توکن باطل شود؟ برنامه‌هایی که از آن استفاده می‌کنند قطع می‌شوند." onClick={async () => { await api.account.revokeToken(x.id); notify("توکن باطل شد"); }}>ابطال</AsyncButton>
            </div>
          ))}
          <div className="mx-3 mt-3 mb-1 rounded-xl bg-black/30 border border-white/[0.08] p-3 mono text-[11px] text-white/55 ltr overflow-x-auto whitespace-nowrap">curl -H &quot;Authorization: Bearer $GEREH_TOKEN&quot; https://api.gereh.cloud/v1/servers</div>
        </Card>
      </div>
      <Modal open={keyM} onClose={() => setKeyM(false)} title="افزودن کلید SSH" icon="key-round"
        footer={<><button type="button" onClick={() => setKeyM(false)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => {
          if (!k.name.trim()) throw new Error("یک نام برای کلید بنویسید.");
          if (!/^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com) [A-Za-z0-9+/]{40,}={0,3}( .*)?$/.test(k.pub.trim())) throw new Error("کلید عمومی معتبر نیست؛ باید با ssh-ed25519 یا ssh-rsa شروع شود.");
          await api.account.addKey(k); setK({ name: "", pub: "" }); setKeyM(false); notify("کلید اضافه شد", "key-round");
        }}>افزودن</AsyncButton></>}>
        <div className="space-y-4">
          <Field label="نام کلید"><input value={k.name} maxLength={60} onChange={(e) => setK((s) => ({ ...s, name: e.target.value }))} placeholder="مثلا لپ‌تاپ کار" className={INPUT} /></Field>
          <Field label="کلید عمومی" hint="محتوای فایل ~/.ssh/id_ed25519.pub"><textarea value={k.pub} onChange={(e) => setK((s) => ({ ...s, pub: e.target.value }))} rows={4} dir="ltr" className={TEXTAREA + " mono text-xs text-left"} placeholder="ssh-ed25519 AAAA…" /></Field>
        </div>
      </Modal>
      <Modal open={tokM} onClose={() => setTokM(false)} title="توکن API جدید" icon="code-xml"
        footer={secret ? <button type="button" onClick={() => setTokM(false)} className={BTN_P + " px-5 h-10 text-sm"}>کپی کردم، بستن</button> : <><button type="button" onClick={() => setTokM(false)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => { if (!/^[a-z0-9][a-z0-9-_.]{1,40}$/i.test(tk.name.trim())) throw new Error("نام توکن فقط حروف انگلیسی، عدد و خط تیره."); setSecret(await api.account.createToken({ ...tk, name: tk.name.trim() })); }}>ساخت توکن</AsyncButton></>}>
        {secret ? <>
          <div role="alert" className="rounded-xl bg-amber-400/[0.08] border border-amber-300/25 p-4 text-sm text-amber-100 flex gap-3 mb-4"><Icon name="circle-alert" size={18} />این توکن فقط همین یک بار نمایش داده می‌شود. آن را در جای امنی نگه دارید.</div>
          <div className="rounded-xl bg-black/40 border border-white/10 p-4"><CopyText text={secret} className="mono text-xs break-all" /></div>
        </> : (
          <div className="space-y-4">
            <Field label="نام"><input value={tk.name} onChange={(e) => setTk((s) => ({ ...s, name: e.target.value }))} dir="ltr" placeholder="terraform-prod" className={INPUT + " text-left mono"} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="دسترسی"><Select value={tk.scope} label="دسترسی" onChange={(v) => setTk((s) => ({ ...s, scope: v }))} options={[{ value: "read", label: "فقط خواندن" }, { value: "read-write", label: "خواندن و نوشتن" }]} /></Field>
              <Field label="انقضا"><Select value={tk.expires} label="انقضا" onChange={(v) => setTk((s) => ({ ...s, expires: v }))} options={["۳۰ روز", "۹۰ روز", "یک سال", "بدون انقضا"]} /></Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ================= account ================= */
/** Mounted only while open, so every opening gets a fresh secret. */
function TwoFactorModal({ onClose, account }: { onClose: () => void; account: string }) {
  const { notify } = useApp();
  const [secret] = useState(newSecret);
  const [qr, setQr] = useState("");
  const [otp, setOtp] = useState("");
  useEffect(() => {
    let alive = true;
    import("qrcode").then((m) => m.toString(otpauthUrl(secret, account), { type: "svg", margin: 1, color: { dark: "#05070d", light: "#ffffff" } })).then((svg) => { if (alive) setQr(svg); });
    return () => { alive = false; };
  }, [secret, account]);
  return (
    <Modal open onClose={onClose} title="فعال‌سازی ورود دومرحله‌ای" icon="shield-check"
      footer={<><button type="button" onClick={onClose} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => { if (otp.length !== 6) throw new Error("کد ۶ رقمی را وارد کنید."); await api.account.setTwofa(true, secret, otp); onClose(); notify("ورود دومرحله‌ای فعال شد", "shield-check"); }}>تأیید و فعال‌سازی</AsyncButton></>}>
      <ol className="space-y-5 text-sm">
        <li><div className="font-bold">۱. اسکن کنید</div><p className="text-white/50 mt-1">با Google Authenticator، Microsoft Authenticator یا Authy این کد را اسکن کنید.</p>
          <div className="w-44 h-44 mx-auto mt-4 bg-white p-2 rounded-xl grid place-items-center" role="img" aria-label="کد QR ورود دومرحله‌ای">
            {qr ? <div className="w-full h-full [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: qr }} /> : <Icon name="loader-circle" size={24} className="animate-spin text-slate-500" />}
          </div>
          <div className="text-center mt-3 text-xs text-white/45">یا کد زیر را دستی وارد کنید:</div>
          <div className="text-center mt-1"><CopyText text={secret.replace(/(.{4})/g, "$1 ").trim()} className="mono text-xs text-white/70" /></div></li>
        <li><div className="font-bold mb-3">۲. کد شش‌رقمی را وارد کنید</div><OtpInput value={otp} onChange={setOtp} /></li>
      </ol>
    </Modal>
  );
}

export function UserAccount() {
  const db = useDB(); const myId = useMyId();
  const { notify } = useApp();
  const me = byId(db.users, myId)!;
  const [tab, setTab] = useState("profile");
  const [p, setP] = useState({ name: me.name, email: me.email, phone: me.phone, company: me.company });
  const [pw, setPw] = useState({ cur: "", next: "", rep: "" });
  const [twofaM, setTwofaM] = useState(false);
  const prefs = [["billing", "صورتحساب و پرداخت"], ["service", "وضعیت سرویس‌ها و قطعی"], ["security", "امنیت و ورود"], ["news", "خبرنامه و تخفیف‌ها"]];
  const kycSteps: [string, boolean][] = [["تأیید شماره موبایل", true], ["تأیید ایمیل", true], ["بارگذاری تصویر کارت ملی", me.kyc !== "none"], ["تأیید نهایی توسط کارشناس", me.kyc === "verified"]];
  return (
    <div>
      <PageTitle title="تنظیمات حساب" />
      <div className="overflow-x-auto no-scrollbar mb-6"><Tabs size="sm" value={tab} onChange={setTab} label="بخش‌های حساب" options={[{ id: "profile", label: "پروفایل", icon: "user-round" }, { id: "security", label: "امنیت", icon: "shield-check" }, { id: "notif", label: "اعلان‌ها", icon: "bell" }, { id: "kyc", label: "احراز هویت", icon: "fingerprint" }]} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "profile" && (
          <Card title="اطلاعات شخصی" icon="user-round">
            <div className="flex items-center gap-4 mb-6"><span className="w-16 h-16 rounded-2xl tile grid place-items-center text-2xl font-black" aria-hidden="true">{me.name[0]}</span><div><div className="font-bold">{me.name}</div><div className="text-xs text-white/45 mt-1">عضو از {me.joined}</div></div></div>
            <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
              <Field label="نام و نام خانوادگی"><input autoComplete="name" value={p.name} onChange={(e) => setP((s) => ({ ...s, name: e.target.value }))} className={INPUT} /></Field>
              <Field label="نام شرکت (اختیاری)"><input autoComplete="organization" value={p.company} onChange={(e) => setP((s) => ({ ...s, company: e.target.value }))} className={INPUT} /></Field>
              <Field label="ایمیل"><input type="email" autoComplete="email" value={p.email} onChange={(e) => setP((s) => ({ ...s, email: e.target.value }))} dir="ltr" className={INPUT + " text-left"} /></Field>
              <Field label="موبایل" hint="تغییر موبایل نیاز به تأیید پیامکی دارد."><input type="tel" autoComplete="tel" value={p.phone} onChange={(e) => setP((s) => ({ ...s, phone: e.target.value }))} dir="ltr" className={INPUT + " text-left tabular"} /></Field>
            </div>
            <div className="mt-6 flex justify-end max-w-3xl"><AsyncButton onClick={async () => { await api.account.updateProfile({ ...p, name: p.name.trim(), email: p.email.trim(), phone: toEnDigits(p.phone.trim()), company: p.company.trim() }); notify("پروفایل ذخیره شد"); }}>ذخیره تغییرات</AsyncButton></div>
          </Card>
        )}
        {tab === "security" && (
          <div className="grid xl:grid-cols-2 gap-4">
            <Card title="تغییر رمز عبور" icon="lock">
              <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                <input type="text" autoComplete="username" value={me.email} readOnly hidden />
                <Field label="رمز فعلی"><input type="password" autoComplete="current-password" value={pw.cur} onChange={(e) => setPw((s) => ({ ...s, cur: e.target.value }))} dir="ltr" className={INPUT + " text-left"} /></Field>
                <Field label="رمز جدید"><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((s) => ({ ...s, next: e.target.value }))} dir="ltr" className={INPUT + " text-left"} /><StrengthBar value={pw.next} /></Field>
                <Field label="تکرار رمز جدید" error={pw.rep && pw.rep !== pw.next ? "تکرار رمز یکسان نیست." : ""}><input type="password" autoComplete="new-password" value={pw.rep} onChange={(e) => setPw((s) => ({ ...s, rep: e.target.value }))} dir="ltr" className={INPUT + " text-left"} /></Field>
              </form>
              <div className="mt-5 flex justify-end"><AsyncButton disabled={!pw.next || pw.next !== pw.rep} onClick={async () => { await api.account.changePassword(pw.cur, pw.next); setPw({ cur: "", next: "", rep: "" }); notify("رمز عبور تغییر کرد", "lock"); }}>تغییر رمز</AsyncButton></div>
            </Card>
            <Card title="ورود دومرحله‌ای" icon="shield-check" action={<Badge tone={db.twofa ? "green" : "gray"}>{db.twofa ? "فعال" : "غیرفعال"}</Badge>}>
              <p className="text-sm text-white/55 leading-7">با فعال‌سازی، علاوه بر رمز، یک کد شش‌رقمی از اپلیکیشن Authenticator هم لازم است.</p>
              <div className="mt-5">{db.twofa
                ? <AsyncButton danger confirmText="ورود دومرحله‌ای غیرفعال شود؟ امنیت حساب کاهش می‌یابد." onClick={async () => { await api.account.setTwofa(false); notify("ورود دومرحله‌ای غیرفعال شد"); }}>غیرفعال‌سازی</AsyncButton>
                : <button type="button" onClick={() => setTwofaM(true)} className={BTN_P + " px-4 h-10 text-sm"}><Icon name="shield-check" size={16} /> فعال‌سازی</button>}</div>
            </Card>
            <Card title="نشست‌های فعال" icon="monitor-smartphone" className="xl:col-span-2" pad="p-3 sm:p-4">
              {db.sessions.map((se) => (
                <div key={se.id} className="flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
                  <div className="flex items-center gap-3"><span className="w-9 h-9 rounded-xl tile grid place-items-center"><Icon name={/iPhone|Android/.test(se.device) ? "smartphone" : "monitor-smartphone"} size={16} /></span>
                    <div><div className="text-sm font-bold flex flex-wrap items-center gap-2">{se.device} {se.current && <Badge tone="green">همین دستگاه</Badge>}</div><div className="text-[11px] text-white/40 mt-0.5"><span className="mono ltr">{se.ip}</span>، {se.place}، {se.last}</div></div></div>
                  {!se.current && <AsyncButton className="text-xs text-rose-300 hover:text-rose-200 px-2" danger confirmText={"نشست " + se.device + " خاتمه یابد؟"} onClick={async () => { await api.account.revokeSession(se.id); notify("نشست خاتمه یافت"); }}>خروج از دستگاه</AsyncButton>}
                </div>
              ))}
            </Card>
            {twofaM && <TwoFactorModal onClose={() => setTwofaM(false)} account={me.email} />}
          </div>
        )}
        {tab === "notif" && (
          <Card title="تنظیمات اعلان" icon="bell" pad="p-3 sm:p-4">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-8 items-center text-sm">
              <div className="text-xs text-white/40 p-3">موضوع</div><div className="text-xs text-white/40 text-center">ایمیل</div><div className="text-xs text-white/40 text-center">پیامک</div>
              {prefs.map(([k, l]) => (
                <Fragment key={k}>
                  <div className="p-3 border-t border-white/[0.06]">{l}</div>
                  <div className="border-t border-white/[0.06] py-3 flex justify-center"><Switch on={!!db.notifPrefs[k + "_email"]} label={l + "، ایمیل"} onChange={(v) => api.account.setNotif(k + "_email", v)} /></div>
                  <div className="border-t border-white/[0.06] py-3 flex justify-center"><Switch on={!!db.notifPrefs[k + "_sms"]} label={l + "، پیامک"} onChange={(v) => api.account.setNotif(k + "_sms", v)} /></div>
                </Fragment>
              ))}
            </div>
          </Card>
        )}
        {tab === "kyc" && (
          <Card title="احراز هویت" icon="fingerprint" action={<StatusBadge s={me.kyc} />}>
            <p className="text-sm text-white/55 leading-7 max-w-2xl">طبق مقررات، ثبت دامنه ملی و خرید سرور اختصاصی نیاز به احراز هویت دارد.</p>
            <ol className="mt-6 space-y-3 max-w-2xl">
              {kycSteps.map(([l, ok], i) => (
                <li key={l} className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07]">
                  <span className={"w-8 h-8 rounded-full grid place-items-center text-xs font-black " + (ok ? "acc-bg" : "bg-white/[0.06] text-white/50")}>{ok ? <Icon name="check" size={15} sw={2.5} /> : fa(i + 1)}</span>
                  <span className="flex-1 text-sm">{l}</span>
                  {ok ? <Badge tone="green">{i === 2 && me.kyc === "pending" ? "در انتظار بررسی" : "انجام شد"}</Badge>
                    : i === 2 ? <KycUpload /> : <Badge>در انتظار</Badge>}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </div>
  );
}

function KycUpload() {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <label className={BTN_G + " px-3 h-8 text-xs cursor-pointer " + (busy ? "opacity-60 pointer-events-none" : "")}>
      <Icon name={busy ? "loader-circle" : "upload"} size={14} className={busy ? "animate-spin" : ""} /> بارگذاری
      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only-focusable" onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = "";
        if (!file) return;
        setBusy(true);
        try { await api.account.submitKyc(file); notify("مدرک بارگذاری شد و در انتظار بررسی است", "upload"); } catch (err) { notify(err instanceof Error ? err.message : "خطا", "circle-alert"); } finally { setBusy(false); }
      }} />
    </label>
  );
}
