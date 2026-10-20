"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BTN_D, BTN_G, BTN_MD, BTN_P, BTN_SM, INPUT, TEXTAREA } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { DMARC_DEFAULT, MAIL_DOMAIN_STATUS, MAIL_EVENT_LABEL, MAIL_MSG_STATUS, MAIL_RECORD_LABEL, MAX_ATTACHMENTS_BYTES, type Dmarc, type MailDomainDetail, type MailMessageView, type MailMsgRow, type MailOverview, type MailStats, type Tone } from "@/lib/mail";
import { api } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field, Meter } from "../ui";
import { AreaChart, AsyncButton, CodeBlock, CopyText, FilePick, Modal, PageTitle, Select, SideDrawer, StatCard, Switch, Tabs } from "../ui-client";

/* ---------- small helpers ---------- */
const Pill = ({ map, s }: { map: Record<string, [string, Tone]>; s: string }) => { const [l, t] = map[s] ?? [s, "gray"]; return <Badge tone={t} dot>{l}</Badge>; };
const ModeBadge = ({ mode }: { mode: string }) => mode === "live" ? <Badge tone="green">LIVE</Badge> : <Badge tone="amber">DEV</Badge>;
const kb = (n: number) => (n < 1024 ? fa(n) + " بایت" : n < 1048576 ? fa(Math.round(n / 1024)) + " کیلوبایت" : fa(Math.round((n / 1048576) * 10) / 10) + " مگابایت");
const mb = (n: number) => (n >= 1024 ? fa(Math.round((n / 1024) * 10) / 10) + " گیگابایت" : fa(Math.round(n)) + " مگابایت");
const shortDate = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("fa-IR", { month: "short", day: "numeric", timeZone: "UTC" });

/** loads a read-only RPC; `key` decides when to load again, reload() forces it */
function useRemote<T>(key: string, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load().then((data) => { if (live) setState({ key, data, error: "" }); }, (e: Error) => { if (live) setState((s) => ({ ...s, key, error: e.message })); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return { data: state.data, error: state.error, loading: state.key !== key, reload: () => setTick((t) => t + 1) };
}
const Loading = () => <div className="py-16 grid place-items-center" aria-busy="true"><Icon name="loader-circle" size={24} className="animate-spin text-white/50" /></div>;

/** shows a secret once with a copy button */
function SecretBox({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-amber-300/30 bg-amber-400/[0.06] p-4">
      <span className="text-xs text-amber-200">{label}</span>
      <div className="mt-2 rounded-xl bg-black/30 px-3 py-2 break-all"><CopyText text={value} className="font-mono text-sm" /></div>
      {note && <p className="text-[11px] text-white/55 mt-2 leading-6">{note}</p>}
    </div>
  );
}

/* ================= list + order ================= */
export function UserMail({ create = false }: { create?: boolean }) {
  const r = useRemote("overview", () => api.mail.overview());
  const [open, setOpen] = useState(create);
  const o = r.data;
  return (
    <div>
      <PageTitle title="سرویس ایمیل" sub="ارسال ایمیل تراکنشی با API و SMTP، صندوق‌های ایمیل روی دامنه خودتان، گزارش تحویل و آمار ۹۰ روزه."
        action={<button type="button" onClick={() => setOpen(true)} className={BTN_P + BTN_MD}><Icon name="plus" size={16} />دامنه جدید</button>} />
      {!o ? (r.error ? <Card><Empty icon="circle-alert" title="بارگذاری نشد" text={r.error} /></Card> : <Loading />) : o.domains.length === 0 ? (
        <Card><Empty icon="mail" title="هنوز دامنه ایمیلی ندارید" text="دامنه یا زیردامنه‌ای مثل mail.example.ir اضافه کنید؛ رکوردهای DNS را برایتان می‌سازیم و تا تأیید آن‌ها، در حالت DEV آزمایش کنید."
          action={<div className="flex flex-wrap gap-2 justify-center"><button type="button" onClick={() => setOpen(true)} className={BTN_P + BTN_MD}>شروع</button><Link href={"/mail" as never} className={BTN_G + BTN_MD}>درباره سرویس ایمیل</Link></div>} /></Card>
      ) : (
        <ul className="grid md:grid-cols-2 gap-4">
          {o.domains.map((d) => { const plan = o.plans.find((p) => p.id === d.planId); return (
            <li key={d.id}>
              <Link href={("/panel/mail/" + d.id) as never} className="block rounded-[1.4rem] p-5 bg-white/[0.04] border border-white/[0.1] hover:border-white/25 transition">
                <span className="flex items-center justify-between gap-2"><b dir="ltr" className="truncate">{d.domain}</b><span className="flex items-center gap-1.5"><ModeBadge mode={d.mode} /><Pill map={MAIL_DOMAIN_STATUS} s={d.status} /></span></span>
                <span className="block text-xs text-white/55 mt-1">پلن {plan?.name ?? d.planId} · {fa(d.mailboxes)} صندوق · {fa(d.smtp)} کاربر SMTP</span>
                {plan && <span className="block mt-3"><Meter value={d.usage.today} max={plan.dailyLimit} label="ارسال امروز" right={fa(d.usage.today) + " از " + fa(plan.dailyLimit)} /></span>}
              </Link>
            </li>
          ); })}
        </ul>
      )}
      {o && <NewDomain open={open} onClose={() => setOpen(false)} plans={o.plans} />}
    </div>
  );
}

function NewDomain({ open, onClose, plans }: { open: boolean; onClose: () => void; plans: MailOverview["plans"] }) {
  const router = useRouter(); const { notify } = useApp();
  const [f, setF] = useState({ domain: "", planId: plans[0]?.id ?? "mail-start" });
  const [error, setError] = useState("");
  const [made, setMade] = useState<{ id: string; apiKey: string } | null>(null);
  const plan = plans.find((p) => p.id === f.planId);
  const close = () => { if (made) router.push(("/panel/mail/" + made.id) as never); setMade(null); onClose(); };
  return (
    <Modal open={open} onClose={close} title="دامنه ایمیل جدید" icon="mail" size="max-w-3xl">
      {made ? (
        <div className="space-y-4">
          <p className="text-sm leading-7">دامنه ثبت شد و در حالت <b>DEV</b> است: پیام‌ها پذیرفته و ثبت می‌شوند ولی ارسال نمی‌شوند. پس از ثبت رکوردهای DNS، حالت LIVE را روشن کنید.</p>
          <SecretBox label="کلید API (فقط همین یک بار نمایش داده می‌شود)" value={made.apiKey} note="در سربرگ Authorization: Bearer بفرستید. اگر گم شد، از تب «نمای کلی» کلید تازه بسازید." />
          <button type="button" onClick={close} className={BTN_P + BTN_MD}>رفتن به رکوردهای DNS</button>
        </div>
      ) : (
        <div className="space-y-5">
          <div role="radiogroup" aria-label="پلن" className="grid sm:grid-cols-3 gap-2">
            {plans.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={f.planId === p.id} onClick={() => setF({ ...f, planId: p.id })}
                className={"text-right rounded-2xl p-4 border transition " + (f.planId === p.id ? "bg-sky-400/10 border-sky-300/50" : "bg-white/[0.03] border-white/[0.1] hover:border-white/25")}>
                <b>{p.name}</b>
                <span className="block text-sm tabular mt-1">{toman(p.price)}<span className="text-[11px] text-white/50"> / ماه</span></span>
                <span className="block text-[11px] text-white/55 mt-2 leading-5">{fa(p.dailyLimit)} ارسال در روز · {fa(p.monthlyLimit)} در ماه<br />{fa(p.mailboxes)} صندوق تا {mb(p.quotaMb)}</span>
              </button>
            ))}
          </div>
          <Field label="دامنه یا زیردامنه" hint="برای ایمیل تراکنشی، زیردامنه‌ای مثل mail.example.ir پیشنهاد می‌شود تا اعتبار دامنه اصلی جدا بماند.">
            <input value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value.trim().toLowerCase() })} dir="ltr" placeholder="mail.example.ir" className={INPUT + " text-left"} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/[0.08]">
            <span className="text-sm">{plan && <>هزینه: <b className="tabular">{toman(plan.price)}</b> در ماه، ساعتی از کیف پول</>}</span>
            <div className="flex flex-col items-end gap-2">
              {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
              <AsyncButton disabled={!f.domain} onClick={async () => {
                setError("");
                try { setMade(await api.mail.create(f)); notify("دامنه ایمیل ثبت شد", "mail"); }
                catch (e) { setError((e as Error).message); }
              }}><Icon name="mail" size={16} />ثبت دامنه</AsyncButton>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ================= detail ================= */
type D = MailDomainDetail;
export function MailDetail({ id }: { id: string }) {
  const r = useRemote(id, () => api.mail.domain(id));
  const [tab, setTab] = useState("");
  const d = r.data;
  if (!d) return r.error ? <Card><Empty icon="mail" title="دامنه پیدا نشد" text={r.error} action={<Link href={"/panel/mail" as never} className={BTN_G + BTN_MD}>بازگشت</Link>} /></Card> : <Loading />;
  const current = tab || (d.status === "pending" ? "dns" : "overview");
  const unread = d.mailboxes.reduce((s, b) => s + b.unread, 0);
  const props = { d, reload: r.reload };
  return (
    <div>
      <PageTitle back={["/panel/mail", "سرویس ایمیل"]} title={<span dir="ltr" className="inline-block">{d.domain}</span>}
        sub={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><ModeBadge mode={d.mode} /><Pill map={MAIL_DOMAIN_STATUS} s={d.status} /><span className="text-xs">پلن {d.plan?.name}</span></span>} />
      {d.status === "suspended" && <div role="alert" className="mb-4 rounded-2xl border border-rose-300/30 bg-rose-400/[0.07] px-4 py-3 text-sm leading-7">{d.suspendReason === "credit" ? "موجودی کیف پول تمام شده و ارسال متوقف است. با شارژ کیف پول، ارسال ظرف یک ساعت خودکار از سر گرفته می‌شود." : "ارسال این دامنه توسط پشتیبانی معلق شده است؛ از طریق تیکت پیگیری کنید."}</div>}
      {d.status === "pending" && <div role="status" className="mb-4 rounded-2xl border border-amber-300/30 bg-amber-400/[0.06] px-4 py-3 text-sm leading-7">رکوردهای DKIM، SPF و Return-Path هنوز تأیید نشده‌اند. تا آن زمان در حالت DEV آزمایش کنید؛ پیام‌ها ثبت می‌شوند ولی ارسال نمی‌شوند.</div>}
      <div className="mb-5"><Tabs size="sm" value={current} onChange={setTab} label="بخش‌های دامنه ایمیل" options={[
        { id: "overview", label: "نمای کلی", icon: "gauge" }, { id: "dns", label: "رکوردهای DNS", icon: "globe" }, { id: "send", label: "ارسال", icon: "send" }, { id: "logs", label: "گزارش ارسال", icon: "scroll-text" },
        { id: "smtp", label: "SMTP و API", icon: "key-round" }, { id: "mailboxes", label: "صندوق‌ها", icon: "users" }, { id: "inbox", label: "صندوق ورودی", icon: "mail", badge: unread ? fa(unread) : undefined },
        { id: "inbound", label: "قوانین ورودی", icon: "shield" }, { id: "settings", label: "پلن و تنظیمات", icon: "settings-2" },
      ]} /></div>
      <div key={current} className="fade-in" role="tabpanel">
        {current === "overview" && <Overview {...props} />}
        {current === "dns" && <Dns {...props} />}
        {current === "send" && <SendConsole {...props} />}
        {current === "logs" && <Logs d={d} direction="out" />}
        {current === "smtp" && <Smtp {...props} />}
        {current === "mailboxes" && <Mailboxes {...props} />}
        {current === "inbox" && <Inbox {...props} />}
        {current === "inbound" && <InboundRules {...props} />}
        {current === "settings" && <Settings {...props} />}
      </div>
    </div>
  );
}

/* ---------- overview: mode, usage, stats, tags ---------- */
function Overview({ d, reload }: { d: D; reload: () => void }) {
  const { notify } = useApp();
  const s = useRemote("stats" + d.id, () => api.mail.stats(d.id));
  const [range, setRange] = useState("30");
  const [key, setKey] = useState("");
  const days = (s.data?.days ?? []).slice(-Number(range));
  const sum = (k: keyof MailStats["days"][number]) => days.reduce((t, x) => t + (x[k] as number), 0);
  const sent = sum("sent"), delivered = sum("delivered"), bounced = sum("bounced");
  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-[1fr_1.3fr] gap-4 items-start">
        <Card title="حالت ارسال" icon="zap">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span><b>{d.mode === "live" ? "LIVE: ارسال واقعی" : "DEV: فقط ثبت، بدون ارسال"}</b><span className="block text-[11px] text-white/55 mt-1 leading-5">{d.mode === "live" ? "پیام‌ها به گیرندگان تحویل داده می‌شوند." : "پیام‌ها پذیرفته و در گزارش ثبت می‌شوند ولی به کسی ارسال نمی‌شوند؛ برای آزمایش یکپارچه‌سازی."}</span></span>
            <Switch on={d.mode === "live"} label="حالت LIVE" disabled={d.mode === "dev" && d.status !== "active"} onChange={async (v) => { try { await api.mail.setMode(d.id, v ? "live" : "dev"); notify(v ? "حالت LIVE روشن شد" : "حالت DEV فعال شد", "zap"); reload(); } catch (e) { notify((e as Error).message, "circle-alert"); } }} />
          </div>
          {d.plan && <div className="mt-5 space-y-3">
            <Meter value={d.usage.today} max={d.plan.dailyLimit} label="سقف روزانه" right={fa(d.usage.today) + " از " + fa(d.plan.dailyLimit)} />
            <Meter value={d.usage.month} max={d.plan.monthlyLimit} label="سقف ماهانه" right={fa(d.usage.month) + " از " + fa(d.plan.monthlyLimit)} />
            <p className="text-[11px] text-white/50">هر گیرنده (to، cc و bcc) یک ارسال حساب می‌شود؛ روز به وقت تهران.</p>
          </div>}
        </Card>
        <Card title="کلید API ارسال" icon="key-round" action={<AsyncButton className={BTN_G + BTN_SM} confirmText="کلید فعلی بی‌درنگ از کار می‌افتد. ادامه می‌دهید؟" onClick={async () => { setKey(await api.mail.rotateKey(d.id)); reload(); }}><Icon name="refresh-cw" size={14} />کلید تازه</AsyncButton>}>
          {key ? <SecretBox label="کلید تازه (فقط همین یک بار)" value={key} /> : <p className="text-sm">کلید فعلی: <code dir="ltr" className="font-mono">{d.apiKeyPrefix}…</code></p>}
          <CodeBlock className="mt-4" label="نمونه ارسال با curl" title="curl" code={`curl -X POST ${d.apiUrl} \\
  -H "Authorization: Bearer ${key || d.apiKeyPrefix + "…"}" \\
  -H "Content-Type: application/json" \\
  -H "X-Gereh-Tag: welcome" \\
  -d '{"from":"App <no-reply@${d.domain}>","to":["user@example.com"],
       "subject":"Hello","html":"<b>Hi</b>","text":"Hi",
       "listUnsubscribe":"https://${d.domain}/unsubscribe?u=1",
       "attachments":[{"filename":"a.pdf","content":"<base64>"}]}'`} />
          <p className="text-[11px] text-white/50 mt-2 leading-6">پاسخ <span dir="ltr">202 {"{ id, status }"}</span>. پیوست‌ها تا ۱۰ مگابایت؛ حداکثر ۵۰ گیرنده در هر پیام. <Link href={"/mail#api" as never} className="underline">راهنمای کامل</Link></p>
        </Card>
      </div>
      <Card title="آمار ارسال" icon="chart-column" action={<Tabs size="sm" value={range} onChange={setRange} label="بازه" options={[{ id: "7", label: "۷ روز" }, { id: "30", label: "۳۰ روز" }, { id: "90", label: "۹۰ روز" }]} />}>
        {!s.data ? <Loading /> : <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
            <StatCard icon="send" label="ارسال‌شده" value={sent} />
            <StatCard icon="circle-check" label="تحویل‌شده" value={delivered} sub={sent ? fa(Math.round((delivered / sent) * 1000) / 10) + "٪" : ""} />
            <StatCard icon="circle-alert" label="برگشتی" value={bounced} sub={sent ? fa(Math.round((bounced / sent) * 1000) / 10) + "٪" : ""} tone={sent && bounced / sent > 0.05 ? "down" : ""} />
            <StatCard icon="mail" label="دریافتی" value={sum("received")} />
          </div>
          <AreaChart data={days.map((x) => x.sent)} labels={days.map((x) => shortDate(x.date))} unit="ارسال" height={180} />
        </>}
      </Card>
      <Card title="برچسب‌ها (۹۰ روز)" icon="tag" pad="p-3 sm:p-4">
        {!s.data ? <Loading /> : s.data.tags.length === 0 ? <Empty icon="tag" title="برچسبی ثبت نشده" text="با سربرگ X-Gereh-Tag یا فیلد tag، پیام‌ها را دسته‌بندی کنید." /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[520px]">
            <thead><tr className="text-white/50 text-xs text-right"><th className="p-2 font-normal">برچسب</th><th className="p-2 font-normal">ارسال</th><th className="p-2 font-normal">تحویل</th><th className="p-2 font-normal">برگشت</th><th className="p-2 font-normal">ناموفق</th><th className="p-2 font-normal">DEV</th></tr></thead>
            <tbody>{s.data.tags.map((t) => (
              <tr key={t.tag} className="border-t border-white/[0.06]"><td className="p-2" dir="ltr">{t.tag || <span className="text-white/50">(بدون برچسب)</span>}</td><td className="p-2 tabular">{fa(t.total)}</td><td className="p-2 tabular text-emerald-300">{fa(t.delivered)}</td><td className="p-2 tabular text-rose-300">{fa(t.bounced)}</td><td className="p-2 tabular">{fa(t.failed)}</td><td className="p-2 tabular text-white/50">{fa(t.dev)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

/* ---------- DNS ---------- */
function Dns({ d, reload }: { d: D; reload: () => void }) {
  const { notify } = useApp();
  return (
    <div className="space-y-4">
      <Card title="رکوردهای DNS" icon="globe" pad="p-3 sm:p-5" action={<div className="flex flex-wrap gap-2">
        {d.gerehZone && <AsyncButton className={BTN_P + BTN_SM} confirmText={"رکوردها در DNS دامنه " + d.gerehZone + " نوشته می‌شوند؛ SPF و DMARC و MX موجود در همین نام‌ها جایگزین می‌شوند. ادامه می‌دهید؟"} onClick={async () => { const r = await api.mail.autoDns(d.id); notify(r.added ? fa(r.added) + " رکورد در DNS گره ثبت شد" : "رکوردها از قبل ثبت بودند", "globe"); reload(); }}><Icon name="zap" size={14} />ثبت خودکار در DNS گره</AsyncButton>}
        <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { const r = await api.mail.checkDns(d.id); notify(r.verified ? "رکوردهای اصلی تأیید شد" : "هنوز همه رکوردها دیده نمی‌شوند", r.verified ? "circle-check" : "clock"); reload(); }}><Icon name="refresh-cw" size={14} />بررسی دوباره</AsyncButton>
      </div>}>
        <p className="text-sm text-white/65 leading-7 mb-4">این رکوردها را در سرویس DNS دامنه وارد کنید. DKIM، SPF و Return-Path برای ارسال لازم‌اند؛ MX فقط اگر می‌خواهید ایمیل‌ها را در صندوق‌های گره دریافت کنید. {d.gerehZone ? <>دامنه <b dir="ltr">{d.gerehZone}</b> در DNS گره است؛ با یک کلیک ثبت کنید.</> : ""}{d.dnsChecked && <span className="text-white/50"> آخرین بررسی: {d.dnsChecked}</span>}</p>
        <ul className="space-y-2">
          {d.records.map((r) => (
            <li key={r.key} className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2"><Badge>{r.type}</Badge><b className="text-sm">{MAIL_RECORD_LABEL[r.key]}</b>{!r.required && <span className="text-[11px] text-white/50">اختیاری</span>}</span>
                {r.ok ? <Badge tone="green" dot>تأیید شد</Badge> : <Badge tone={r.required ? "amber" : "gray"} dot>{r.seen.length ? "مقدار نادرست" : "یافت نشد"}</Badge>}
              </div>
              <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 mt-3 text-xs">
                <div className="rounded-xl bg-black/25 px-3 py-2 min-w-0"><span className="text-white/50 block mb-0.5">نام (Host)</span><CopyText text={r.name} className="font-mono break-all text-right" /></div>
                <div className="rounded-xl bg-black/25 px-3 py-2 min-w-0"><span className="text-white/50 block mb-0.5">مقدار{r.priority !== undefined ? " (اولویت " + fa(r.priority) + ")" : ""}</span><CopyText text={r.value} className="font-mono break-all text-right" /></div>
              </div>
              {!r.ok && r.seen.length > 0 && <p className="text-[11px] text-white/50 mt-2 break-all" dir="ltr">seen: {r.seen.join(" | ")}</p>}
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <DmarcEditor d={d} reload={reload} />
        <Card title="کلید DKIM" icon="key-round">
          <p className="text-sm text-white/65 leading-7">کلید RSA ۲۰۴۸ بیتی با انتخابگر <code dir="ltr" className="font-mono">{d.dkimSelector}</code>. کلید خصوصی رمزنگاری‌شده نگه‌داری می‌شود و هرگز نمایش داده نمی‌شود.</p>
          <AsyncButton danger className={BTN_G + BTN_SM + " mt-3"} confirmText="کلید تازه با انتخابگر جدید ساخته می‌شود و تا ثبت رکورد جدید، دامنه به حالت DEV برمی‌گردد. ادامه می‌دهید؟" onClick={async () => { await api.mail.rotateDkim(d.id); notify("کلید DKIM تازه ساخته شد؛ رکورد جدید را ثبت کنید", "key-round"); reload(); }}><Icon name="refresh-cw" size={14} />چرخش کلید DKIM</AsyncButton>
        </Card>
      </div>
    </div>
  );
}

function DmarcEditor({ d, reload }: { d: D; reload: () => void }) {
  const { notify } = useApp();
  const [m, setM] = useState<Dmarc>({ ...DMARC_DEFAULT, ...d.dmarc });
  const dirty = JSON.stringify(m) !== JSON.stringify({ ...DMARC_DEFAULT, ...d.dmarc });
  return (
    <Card title="سیاست DMARC" icon="shield-check">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="سیاست (p)" hint="با none شروع کنید، گزارش‌ها را ببینید، بعد سخت‌گیرانه کنید."><Select label="سیاست DMARC" value={m.p} onChange={(v) => setM({ ...m, p: v as Dmarc["p"] })} options={[{ value: "none", label: "none — فقط گزارش" }, { value: "quarantine", label: "quarantine — هرزنامه" }, { value: "reject", label: "reject — رد" }]} /></Field>
        <Field label="درصد اعمال (pct)"><input value={m.pct} inputMode="numeric" onChange={(e) => setM({ ...m, pct: Math.min(100, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)) })} dir="ltr" className={INPUT + " text-left"} /></Field>
        <Field label="نشانی گزارش (rua)" className="sm:col-span-2"><input value={m.rua} onChange={(e) => setM({ ...m, rua: e.target.value.trim().toLowerCase() })} dir="ltr" placeholder={"dmarc@" + d.domain} className={INPUT + " text-left"} /></Field>
        <Field label="تطابق DKIM (adkim)"><Select label="adkim" value={m.adkim} onChange={(v) => setM({ ...m, adkim: v as "r" | "s" })} options={[{ value: "r", label: "آزاد (r)" }, { value: "s", label: "سخت (s)" }]} /></Field>
        <Field label="تطابق SPF (aspf)"><Select label="aspf" value={m.aspf} onChange={(v) => setM({ ...m, aspf: v as "r" | "s" })} options={[{ value: "r", label: "آزاد (r)" }, { value: "s", label: "سخت (s)" }]} /></Field>
      </div>
      <AsyncButton disabled={!dirty} className={BTN_P + BTN_MD + " mt-4"} onClick={async () => { await api.mail.setDmarc(d.id, m); notify("رکورد DMARC به‌روز شد؛ مقدار جدید را در DNS ثبت کنید", "shield-check"); reload(); }}>ذخیره</AsyncButton>
    </Card>
  );
}

/* ---------- console send ---------- */
const toBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(new Error("خواندن فایل ممکن نشد.")); r.readAsDataURL(f); });
function SendConsole({ d }: { d: D; reload: () => void }) {
  const { notify } = useApp();
  const [f, setF] = useState({ from: "no-reply@" + d.domain, to: "", cc: "", bcc: "", subject: "", body: "", html: true, tag: "", unsub: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [last, setLast] = useState<{ id: string; status: string } | null>(null);
  const size = files.reduce((s, x) => s + x.size, 0);
  return (
    <div className="grid lg:grid-cols-[1.5fr_1fr] gap-4 items-start">
      <Card title="ارسال از پنل" icon="send">
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="از (from)"><input value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} dir="ltr" className={INPUT + " text-left"} /></Field>
            <Field label="به (to)" hint="چند نشانی را با کاما جدا کنید"><input value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} dir="ltr" placeholder="user@example.com" className={INPUT + " text-left"} /></Field>
            <Field label="رونوشت (cc)"><input value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} dir="ltr" className={INPUT + " text-left"} /></Field>
            <Field label="رونوشت مخفی (bcc)"><input value={f.bcc} onChange={(e) => setF({ ...f, bcc: e.target.value })} dir="ltr" className={INPUT + " text-left"} /></Field>
          </div>
          <Field label="موضوع"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} className={INPUT} /></Field>
          <div className="flex items-center justify-between gap-3"><span className="text-xs text-white/60">متن پیام</span><Tabs size="sm" value={f.html ? "html" : "text"} onChange={(v) => setF({ ...f, html: v === "html" })} label="قالب" options={[{ id: "html", label: "HTML" }, { id: "text", label: "متن ساده" }]} /></div>
          <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={8} dir="auto" aria-label="متن پیام" className={TEXTAREA + (f.html ? " font-mono text-xs" : "")} placeholder={f.html ? "<p>سلام</p>" : "سلام"} />
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="برچسب (اختیاری)"><input value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value.trim() })} dir="ltr" placeholder="welcome" className={INPUT + " text-left"} /></Field>
            <Field label="List-Unsubscribe (اختیاری)"><input value={f.unsub} onChange={(e) => setF({ ...f, unsub: e.target.value.trim() })} dir="ltr" placeholder="https://… یا mailto:…" className={INPUT + " text-left"} /></Field>
          </div>
          <Field as="div" label="پیوست‌ها" hint={"حداکثر ۱۰ مگابایت؛ فعلی " + kb(size)} error={size > MAX_ATTACHMENTS_BYTES ? "حجم پیوست‌ها بیش از ۱۰ مگابایت است" : undefined}>
            <FilePick label="افزودن پیوست" icon="paperclip" multiple onFiles={setFiles} />
          </Field>
          <AsyncButton disabled={!f.to || !f.body || size > MAX_ATTACHMENTS_BYTES} onClick={async () => {
            const attachments = await Promise.all(files.map(async (x) => ({ filename: x.name, content: await toBase64(x), contentType: x.type || undefined })));
            const r = await api.mail.send(d.id, { from: f.from, to: f.to, cc: f.cc || undefined, bcc: f.bcc || undefined, subject: f.subject, ...(f.html ? { html: f.body } : { text: f.body }), tag: f.tag || undefined, listUnsubscribe: f.unsub || undefined, attachments });
            setLast(r); notify(r.status === "dev" ? "در حالت DEV ثبت شد (ارسال نشد)" : "در صف ارسال قرار گرفت", "send");
          }}><Icon name="send" size={16} />ارسال</AsyncButton>
          {last && <p role="status" className="text-xs text-white/65">شناسه پیام: <code dir="ltr" className="font-mono">{last.id}</code> · <Pill map={MAIL_MSG_STATUS} s={last.status} /></p>}
        </div>
      </Card>
      <Card title="نکته‌ها" icon="info">
        <ul className="space-y-2 text-sm text-white/65 leading-7">
          <li>فرستنده باید از دامنه <b dir="ltr">{d.domain}</b> باشد.</li>
          <li>{d.mode === "dev" ? "دامنه در حالت DEV است: پیام فقط در گزارش ثبت می‌شود." : "دامنه در حالت LIVE است: پیام واقعاً ارسال می‌شود."}</li>
          <li>هر گیرنده از سقف روزانه و ماهانه پلن کم می‌شود.</li>
          {d.simulator && <li>محیط آزمایشی: گیرنده‌هایی که با bounce یا fail شروع می‌شوند، برگشت یا خطا شبیه‌سازی می‌کنند.</li>}
        </ul>
      </Card>
    </div>
  );
}

/* ---------- logs + message view ---------- */
function Logs({ d, direction, mailboxId }: { d: D; direction: "out" | "in"; mailboxId?: string }) {
  const [f, setF] = useState({ status: "", tag: "", q: "", offset: 0 });
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const key = [d.id, direction, mailboxId ?? "", f.status, f.tag, f.q, f.offset].join("|");
  const r = useRemote(key, () => api.mail.messages(d.id, { direction, status: f.status || undefined, tag: f.tag || undefined, q: f.q || undefined, mailboxId, offset: f.offset }));
  const statuses = direction === "out" ? ["queued", "dev", "sent", "delivered", "bounced", "failed"] : ["received", "spam", "dropped", "rejected"];
  return (
    <Card pad="p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <form className="flex-1 min-w-[12rem]" onSubmit={(e) => { e.preventDefault(); setF({ ...f, q, offset: 0 }); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجو" placeholder="جست‌وجو در موضوع، فرستنده یا گیرنده" className={INPUT} />
        </form>
        <div className="w-44"><Select label="وضعیت" value={f.status} onChange={(v) => setF({ ...f, status: v, offset: 0 })} options={[{ value: "", label: "همه وضعیت‌ها" }, ...statuses.map((s) => ({ value: s, label: MAIL_MSG_STATUS[s][0] }))]} /></div>
        {direction === "out" && <input value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value.trim(), offset: 0 })} aria-label="برچسب" placeholder="برچسب" dir="ltr" className={INPUT + " w-32 text-left"} />}
        <button type="button" onClick={r.reload} className={BTN_G + BTN_MD} aria-label="بارگذاری دوباره"><Icon name="refresh-cw" size={16} /></button>
      </div>
      {!r.data ? <Loading /> : r.data.rows.length === 0 ? <Empty icon="scroll-text" title="پیامی پیدا نشد" text="گزارش‌ها ۹۰ روز نگه‌داری می‌شوند." /> : (
        <>
          <ul className="divide-y divide-white/[0.06]">
            {r.data.rows.map((m: MailMsgRow) => (
              <li key={m.id}>
                <button type="button" onClick={() => setOpen(m.id)} className="w-full text-right p-3 rounded-xl hover:bg-white/[0.04] transition">
                  <span className="flex items-center justify-between gap-2">
                    <b className={"text-sm truncate " + (direction === "in" && !m.read ? "" : "font-normal")} dir="auto">{m.subject || "(بدون موضوع)"}</b>
                    <span className="flex items-center gap-1.5 shrink-0">{m.tag && <Badge>{m.tag}</Badge>}{m.attachments > 0 && <Icon name="paperclip" size={13} className="text-white/50" />}<Pill map={MAIL_MSG_STATUS} s={m.status} /></span>
                  </span>
                  <span className="flex flex-wrap justify-between gap-2 text-[11px] text-white/50 mt-1"><span dir="ltr" className="truncate">{direction === "out" ? "→ " + m.to.join(", ") : m.from}</span><span>{m.at}{m.source !== "inbound" ? " · " + (m.source === "api" ? "API" : m.source === "smtp" ? "SMTP" : "پنل") : ""}</span></span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 mt-3 text-xs text-white/55 px-2">
            <span>{fa(f.offset + 1)}–{fa(f.offset + r.data.rows.length)} از {fa(r.data.total)}</span>
            <span className="flex gap-2">
              <button type="button" disabled={f.offset === 0} onClick={() => setF({ ...f, offset: Math.max(0, f.offset - 50) })} className={BTN_G + BTN_SM}>قبلی</button>
              <button type="button" disabled={f.offset + 50 >= r.data.total} onClick={() => setF({ ...f, offset: f.offset + 50 })} className={BTN_G + BTN_SM}>بعدی</button>
            </span>
          </div>
        </>
      )}
      <MessageDrawer domainId={d.id} id={open} onClose={() => { setOpen(null); if (direction === "in") r.reload(); }} />
    </Card>
  );
}

function MessageDrawer({ domainId, id, onClose }: { domainId: string; id: string | null; onClose: () => void }) {
  const r = useRemote(id ?? "", () => (id ? api.mail.message(domainId, id) : Promise.resolve(null as MailMessageView | null)));
  const [view, setView] = useState("html");
  const m = id && !r.loading ? r.data : null;
  return (
    <SideDrawer open={!!id} onClose={onClose} title="جزئیات پیام" width="w-[680px]">
      {!m ? <Loading /> : (
        <div className="space-y-4">
          <div>
            <h3 className="font-bold leading-7" dir="auto">{m.subject || "(بدون موضوع)"}</h3>
            <dl className="mt-2 text-xs text-white/65 space-y-1">
              <div className="flex gap-2"><dt className="text-white/50 w-14 shrink-0">از</dt><dd dir="ltr" className="break-all">{m.from}</dd></div>
              <div className="flex gap-2"><dt className="text-white/50 w-14 shrink-0">به</dt><dd dir="ltr" className="break-all">{m.to.join(", ")}</dd></div>
              {m.cc.length > 0 && <div className="flex gap-2"><dt className="text-white/50 w-14 shrink-0">cc</dt><dd dir="ltr" className="break-all">{m.cc.join(", ")}</dd></div>}
              {m.bcc.length > 0 && <div className="flex gap-2"><dt className="text-white/50 w-14 shrink-0">bcc</dt><dd dir="ltr" className="break-all">{m.bcc.join(", ")}</dd></div>}
              <div className="flex gap-2"><dt className="text-white/50 w-14 shrink-0">زمان</dt><dd>{m.at} · {kb(m.size)}</dd></div>
            </dl>
            <div className="flex flex-wrap items-center gap-2 mt-2"><Pill map={MAIL_MSG_STATUS} s={m.status} />{m.tag && <Badge>{m.tag}</Badge>}{m.spamScore !== null && <Badge tone={m.status === "spam" ? "amber" : "gray"}>امتیاز هرزنامه {fa(m.spamScore)}</Badge>}</div>
            {m.error && <p className="text-xs text-rose-300 mt-2" dir="auto">{m.error}</p>}
          </div>
          {m.attachments.length > 0 && <ul className="flex flex-wrap gap-2">{m.attachments.map((a, i) => <li key={i} className="text-xs rounded-lg bg-white/[0.05] px-2.5 py-1.5 inline-flex items-center gap-1.5"><Icon name="paperclip" size={12} /><span dir="ltr">{a.name}</span><span className="text-white/50">{kb(a.size)}</span></li>)}</ul>}
          <Tabs size="sm" value={view} onChange={setView} label="نمایش" options={[{ id: "html", label: "HTML" }, { id: "text", label: "متن" }, { id: "source", label: "منبع" }, { id: "events", label: "رویدادها" }]} />
          {view === "html" && (m.html ? <iframe title="پیش‌نمایش HTML" sandbox="" srcDoc={m.html} className="w-full h-[420px] rounded-xl bg-white" /> : <p className="text-sm text-white/50">این پیام نسخه HTML ندارد.</p>)}
          {view === "text" && <pre dir="auto" className="whitespace-pre-wrap text-sm leading-7 rounded-xl bg-black/30 p-3">{m.text || "—"}</pre>}
          {view === "source" && <pre dir="ltr" className="text-[11px] leading-5 rounded-xl bg-black/35 p-3 overflow-auto max-h-[520px] text-left whitespace-pre-wrap break-all">{m.raw || "—"}</pre>}
          {view === "events" && (
            <ol className="space-y-2">
              {m.events.map((e) => (
                <li key={e.id} className="rounded-xl bg-white/[0.03] border border-white/[0.07] px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2"><b>{MAIL_EVENT_LABEL[e.type] ?? e.type}</b><span className="text-white/50">{e.at}</span></div>
                  {e.recipient && <div dir="ltr" className="text-white/65 mt-1 text-right">{e.recipient}</div>}
                  {e.detail && <div dir="auto" className="text-white/50 mt-1 break-all">{e.detail}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </SideDrawer>
  );
}

/* ---------- SMTP ---------- */
function Smtp({ d, reload }: { d: D; reload: () => void }) {
  const { notify } = useApp();
  const [shown, setShown] = useState<{ username: string; password: string } | null>(null);
  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
      <Card title="کاربران SMTP" icon="key-round" pad="p-3 sm:p-5" action={<AsyncButton className={BTN_P + BTN_SM} onClick={async () => { setShown(await api.mail.smtpCreate(d.id)); reload(); }}><Icon name="plus" size={14} />کاربر جدید</AsyncButton>}>
        {shown && <div className="mb-4"><SecretBox label={"رمز " + shown.username} value={shown.password} note="رمز رمزنگاری‌شده نگه‌داری می‌شود و بعداً هم از همین‌جا قابل مشاهده است." /></div>}
        {d.smtp.length === 0 ? <Empty icon="key-round" title="کاربر SMTP ندارید" text="برای ارسال از وردپرس، لاراول یا هر برنامه‌ای که SMTP پشتیبانی می‌کند، یک کاربر بسازید." /> : (
          <ul className="divide-y divide-white/[0.06]">
            {d.smtp.map((s) => (
              <li key={s.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0"><CopyText text={s.username} className="font-mono text-sm" /><span className="block text-[11px] text-white/50 mt-0.5">ساخته‌شده {s.created}</span></span>
                <span className="flex flex-wrap gap-1.5">
                  <AsyncButton className={BTN_G + BTN_SM} onClick={async () => setShown({ username: s.username, password: await api.mail.smtpReveal(d.id, s.id) })}><Icon name="eye" size={14} />نمایش رمز</AsyncButton>
                  <AsyncButton className={BTN_G + BTN_SM} confirmText="رمز فعلی بی‌درنگ از کار می‌افتد. ادامه می‌دهید؟" onClick={async () => { setShown({ username: s.username, password: await api.mail.smtpRegenerate(d.id, s.id) }); notify("رمز تازه ساخته شد", "key-round"); }}><Icon name="refresh-cw" size={14} />رمز تازه</AsyncButton>
                  <AsyncButton danger className={BTN_G + BTN_SM} confirmText={"کاربر " + s.username + " حذف شود؟"} onClick={async () => { await api.mail.smtpRemove(d.id, s.id); setShown(null); reload(); }}><Icon name="trash-2" size={14} /></AsyncButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="تنظیمات اتصال SMTP" icon="server">
        <dl className="text-sm space-y-2">
          {([["سرور", d.hosts.smtp], ["پورت", "587 (STARTTLS) یا 465 (SSL)"], ["احراز هویت", "نام کاربری و رمز بالا"], ["فرستنده", "هر نشانی @" + d.domain]] as const).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2"><dt className="text-white/55">{k}</dt><dd dir="ltr" className="font-mono text-xs text-left break-all">{k === "سرور" ? <CopyText text={v} /> : v}</dd></div>
          ))}
        </dl>
        <p className="text-[11px] text-white/50 mt-3 leading-6">پیام‌های SMTP هم در گزارش ثبت و از سقف پلن کم می‌شوند. سربرگ X-Gereh-Tag برچسب پیام را تعیین می‌کند.</p>
      </Card>
    </div>
  );
}

/* ---------- mailboxes, aliases, catch-all ---------- */
function Mailboxes({ d, reload }: { d: D; reload: () => void }) {
  const { notify } = useApp();
  const [box, setBox] = useState<{ id?: string; local: string; name: string; password: string; quotaMb: number; active: boolean } | null>(null);
  const [alias, setAlias] = useState({ local: "", dests: "" });
  const [catchAll, setCatchAll] = useState(d.catchAll);
  const quota = d.plan?.quotaMb ?? 2048;
  return (
    <div className="space-y-4">
      <Card title={<span className="flex items-center gap-2">صندوق‌های ایمیل <Badge>{fa(d.mailboxes.length)} از {fa(d.plan?.mailboxes ?? 0)}</Badge></span>} icon="users" pad="p-3 sm:p-5"
        action={<button type="button" onClick={() => setBox({ local: "", name: "", password: "", quotaMb: Math.min(1024, quota), active: true })} className={BTN_P + BTN_SM}><Icon name="plus" size={14} />صندوق جدید</button>}>
        {d.mailboxes.length === 0 ? <Empty icon="mail" title="صندوقی ندارید" text={"مثلاً info@" + d.domain + " بسازید و با هر برنامه ایمیلی (Outlook، Thunderbird، موبایل) استفاده کنید."} /> : (
          <ul className="grid sm:grid-cols-2 gap-3">
            {d.mailboxes.map((b) => (
              <li key={b.id} className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0"><b dir="ltr" className="text-sm block truncate text-right">{b.address}</b><span className="text-[11px] text-white/50">{b.name || "—"}</span></span>
                  <span className="flex gap-1 shrink-0">
                    {!b.active && <Badge tone="gray">غیرفعال</Badge>}
                    <button type="button" aria-label={"ویرایش " + b.address} onClick={() => setBox({ id: b.id, local: b.local, name: b.name, password: "", quotaMb: b.quotaMb, active: b.active })} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-white/10"><Icon name="pencil" size={14} /></button>
                    <AsyncButton danger className="w-9 h-9 grid place-items-center rounded-xl text-white/65 hover:bg-rose-400/10 hover:text-rose-300 transition" confirmText={"صندوق " + b.address + " و همه ایمیل‌هایش حذف شود؟"} onClick={async () => { await api.mail.mailboxRemove(d.id, b.id); reload(); }}><Icon name="trash-2" size={16} /></AsyncButton>
                  </span>
                </div>
                <div className="mt-3"><Meter value={b.usedMb} max={b.quotaMb} label="فضا" right={mb(b.usedMb) + " از " + mb(b.quotaMb)} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="نشانی مستعار و هدایت" icon="share-2" pad="p-3 sm:p-5">
          <p className="text-xs text-white/55 leading-6 mb-3">ایمیل‌های یک نشانی را به صندوق‌های همین دامنه (مستعار) یا نشانی‌های بیرونی (هدایت) بفرستید.</p>
          {d.aliases.length > 0 && <ul className="divide-y divide-white/[0.06] mb-3">{d.aliases.map((a) => (
            <li key={a.id} className="py-2 flex items-start justify-between gap-2 text-sm">
              <span className="min-w-0"><b dir="ltr" className="block text-right">{a.address}</b><span dir="ltr" className="block text-[11px] text-white/55 text-right break-all">→ {a.destinations.join(", ")}</span></span>
              <AsyncButton danger className="w-9 h-9 grid place-items-center rounded-xl text-white/65 hover:bg-rose-400/10 hover:text-rose-300 transition shrink-0" confirmText={a.address + " حذف شود؟"} onClick={async () => { await api.mail.aliasRemove(d.id, a.id); reload(); }}><Icon name="trash-2" size={16} /></AsyncButton>
            </li>
          ))}</ul>}
          <div className="grid sm:grid-cols-[9rem_1fr] gap-2">
            <div className="flex items-center gap-1" dir="ltr"><input value={alias.local} onChange={(e) => setAlias({ ...alias, local: e.target.value.trim().toLowerCase() })} aria-label="نام نشانی" placeholder="sales" className={INPUT + " text-left"} /><span className="text-xs text-white/50">@</span></div>
            <input value={alias.dests} onChange={(e) => setAlias({ ...alias, dests: e.target.value })} aria-label="مقصدها" placeholder="info@…, someone@gmail.com" dir="ltr" className={INPUT + " text-left"} />
          </div>
          <AsyncButton disabled={!alias.local || !alias.dests} className={BTN_G + BTN_SM + " mt-2"} onClick={async () => { await api.mail.aliasSave(d.id, { local: alias.local, destinations: alias.dests.split(/[,\s]+/) }); setAlias({ local: "", dests: "" }); notify("ذخیره شد", "check"); reload(); }}>افزودن</AsyncButton>
          <div className="mt-5 pt-4 border-t border-white/[0.08]">
            <Field label="Catch-all" hint="ایمیل‌هایی که به نشانی ناموجود این دامنه می‌رسند، به این نشانی فرستاده شوند (خالی = رد شوند)."><input value={catchAll} onChange={(e) => setCatchAll(e.target.value.trim().toLowerCase())} dir="ltr" placeholder={"info@" + d.domain} className={INPUT + " text-left"} /></Field>
            <AsyncButton disabled={catchAll === d.catchAll} className={BTN_G + BTN_SM + " mt-2"} onClick={async () => { await api.mail.setInbound(d.id, { catchAll }); notify("ذخیره شد", "check"); reload(); }}>ذخیره</AsyncButton>
          </div>
        </Card>
        <Card title="تنظیمات برنامه ایمیل" icon="monitor-smartphone">
          <dl className="text-sm space-y-2">
            {([["IMAP", d.hosts.imap, "993 (SSL/TLS)"], ["POP3", d.hosts.imap, "995 (SSL/TLS)"], ["SMTP", d.hosts.smtp, "465 (SSL) یا 587 (STARTTLS)"]] as const).map(([k, h, p]) => (
              <div key={k} className="rounded-xl bg-white/[0.03] px-3 py-2"><dt className="text-white/55 text-xs">{k}</dt><dd dir="ltr" className="font-mono text-xs flex flex-wrap justify-between gap-2 mt-1"><CopyText text={h} /><span>{p}</span></dd></div>
            ))}
          </dl>
          <p className="text-[11px] text-white/50 mt-3 leading-6">نام کاربری: نشانی کامل صندوق (مثل <span dir="ltr">info@{d.domain}</span>)؛ رمز: رمز همان صندوق. برای دریافت ایمیل، رکورد MX در تب «رکوردهای DNS» لازم است.</p>
        </Card>
      </div>
      <Modal open={!!box} onClose={() => setBox(null)} title={box?.id ? "ویرایش صندوق" : "صندوق جدید"} icon="mail">
        {box && <div className="space-y-4">
          {!box.id && <Field label="نشانی"><div className="flex items-center gap-1.5" dir="ltr"><input value={box.local} onChange={(e) => setBox({ ...box, local: e.target.value.trim().toLowerCase() })} placeholder="info" className={INPUT + " text-left"} /><span className="text-sm text-white/60 shrink-0">@{d.domain}</span></div></Field>}
          <Field label="نام نمایشی"><input value={box.name} onChange={(e) => setBox({ ...box, name: e.target.value })} className={INPUT} /></Field>
          <Field label={box.id ? "رمز تازه (خالی = بدون تغییر)" : "رمز"} hint="دست‌کم ۸ نویسه با حرف و عدد"><input type="password" autoComplete="new-password" value={box.password} onChange={(e) => setBox({ ...box, password: e.target.value })} dir="ltr" className={INPUT + " text-left"} /></Field>
          <Field label="فضا (مگابایت)" hint={"حداکثر در این پلن: " + mb(quota)}><input value={box.quotaMb} inputMode="numeric" onChange={(e) => setBox({ ...box, quotaMb: Number(e.target.value.replace(/\D/g, "")) || 0 })} dir="ltr" className={INPUT + " text-left"} /></Field>
          {box.id && <div className="flex items-center justify-between text-sm"><span>فعال</span><Switch on={box.active} onChange={(v) => setBox({ ...box, active: v })} label="فعال بودن صندوق" /></div>}
          <AsyncButton onClick={async () => {
            if (box.id) await api.mail.mailboxUpdate(d.id, box.id, { name: box.name, quotaMb: box.quotaMb, active: box.active, ...(box.password ? { password: box.password } : {}) });
            else await api.mail.mailboxCreate(d.id, { local: box.local, name: box.name, password: box.password, quotaMb: box.quotaMb });
            notify("ذخیره شد", "check"); setBox(null); reload();
          }}>ذخیره</AsyncButton>
        </div>}
      </Modal>
    </div>
  );
}

/* ---------- inbox ---------- */
function Inbox({ d, reload }: { d: D; reload: () => void }) {
  const { notify } = useApp();
  const [box, setBox] = useState("");
  const [test, setTest] = useState(false);
  const [t, setT] = useState({ from: "test@example.com", to: (d.mailboxes[0]?.local ?? "info") + "@" + d.domain, subject: "پیام آزمایشی", text: "سلام! این یک پیام آزمایشی است." });
  const [n, setN] = useState(0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-64 max-w-full"><Select label="صندوق" value={box} onChange={setBox} options={[{ value: "", label: "همه پیام‌های ورودی" }, ...d.mailboxes.map((b) => ({ value: b.id, label: b.address + (b.unread ? " (" + fa(b.unread) + ")" : "") }))]} /></div>
        {(d.simulator || d.mode === "dev") && <button type="button" onClick={() => setTest(true)} className={BTN_G + BTN_MD}><Icon name="mail" size={16} />پیام آزمایشی ورودی</button>}
      </div>
      <Logs key={box + n} d={d} direction="in" mailboxId={box || undefined} />
      <Modal open={test} onClose={() => setTest(false)} title="پیام آزمایشی ورودی" icon="mail">
        <div className="space-y-3">
          <Field label="از"><input value={t.from} onChange={(e) => setT({ ...t, from: e.target.value })} dir="ltr" className={INPUT + " text-left"} /></Field>
          <Field label="به"><input value={t.to} onChange={(e) => setT({ ...t, to: e.target.value })} dir="ltr" className={INPUT + " text-left"} /></Field>
          <Field label="موضوع"><input value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} className={INPUT} /></Field>
          <textarea value={t.text} onChange={(e) => setT({ ...t, text: e.target.value })} rows={4} aria-label="متن" className={TEXTAREA} />
          <AsyncButton onClick={async () => { const r = await api.mail.testInbound(d.id, t); notify(r.action === "accept" ? "پیام دریافت شد" : r.action === "quarantine" ? "به‌عنوان هرزنامه علامت خورد" : r.action === "discard" ? "طبق قوانین دور ریخته شد" : "رد شد (گیرنده وجود ندارد)", "mail"); setTest(false); setN((x) => x + 1); reload(); }}>ارسال آزمایشی</AsyncButton>
        </div>
      </Modal>
    </div>
  );
}

/* ---------- inbound rules, blocklist, spam ---------- */
const FIELD_LABEL = { from: "فرستنده", to: "گیرنده", subject: "موضوع" } as const;
const OP_LABEL = { contains: "شامل", equals: "برابر", ends: "پایان با" } as const;
function InboundRules({ d, reload }: { d: D; reload: () => void }) {
  const { notify } = useApp();
  const [r, setR] = useState({ field: "from" as "from" | "to" | "subject", op: "contains" as "contains" | "equals" | "ends", value: "", action: "drop" as "forward" | "drop", target: "" });
  const [block, setBlock] = useState("");
  const [spam, setSpam] = useState(String(d.spamThreshold));
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="قوانین ورودی" icon="list-checks" pad="p-3 sm:p-5" className="lg:col-span-2">
        <p className="text-xs text-white/55 leading-6 mb-3">پیش از تحویل به صندوق، قوانین به ترتیب بررسی می‌شوند و اولین قانون منطبق اجرا می‌شود.</p>
        {d.rules.length > 0 && <ul className="divide-y divide-white/[0.06] mb-4">{d.rules.map((x, i) => (
          <li key={x.id} className="py-2 flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0"><span className="text-white/50 tabular">{fa(i + 1)}. </span>اگر {FIELD_LABEL[x.field]} {OP_LABEL[x.op]} «<span dir="ltr">{x.value}</span>» ← {x.action === "drop" ? <Badge tone="red">دور ریختن</Badge> : <>هدایت به <b dir="ltr">{x.target}</b></>}</span>
            <AsyncButton danger className="w-9 h-9 grid place-items-center rounded-xl text-white/65 hover:bg-rose-400/10 hover:text-rose-300 transition shrink-0" onClick={async () => { await api.mail.ruleRemove(d.id, x.id); reload(); }}><Icon name="trash-2" size={16} /></AsyncButton>
          </li>
        ))}</ul>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-[8rem_8rem_1fr_9rem_1fr_auto] gap-2 items-end">
          <Select label="فیلد" value={r.field} onChange={(v) => setR({ ...r, field: v as typeof r.field })} options={Object.entries(FIELD_LABEL).map(([value, label]) => ({ value, label }))} />
          <Select label="شرط" value={r.op} onChange={(v) => setR({ ...r, op: v as typeof r.op })} options={Object.entries(OP_LABEL).map(([value, label]) => ({ value, label }))} />
          <input value={r.value} onChange={(e) => setR({ ...r, value: e.target.value })} aria-label="مقدار" placeholder="@example.com" dir="auto" className={INPUT} />
          <Select label="اقدام" value={r.action} onChange={(v) => setR({ ...r, action: v as typeof r.action })} options={[{ value: "drop", label: "دور ریختن" }, { value: "forward", label: "هدایت به…" }]} />
          <input value={r.target} disabled={r.action !== "forward"} onChange={(e) => setR({ ...r, target: e.target.value.trim().toLowerCase() })} aria-label="مقصد هدایت" placeholder="ops@example.com" dir="ltr" className={INPUT + " text-left disabled:opacity-40"} />
          <AsyncButton disabled={!r.value} className={BTN_G + BTN_MD} onClick={async () => { await api.mail.ruleAdd(d.id, r); setR({ ...r, value: "", target: "" }); notify("قانون افزوده شد", "check"); reload(); }}>افزودن</AsyncButton>
        </div>
      </Card>
      <Card title="فهرست مسدود" icon="ban" pad="p-3 sm:p-5">
        <p className="text-xs text-white/55 leading-6 mb-3">ایمیل این فرستنده‌ها بی‌صدا دور ریخته می‌شود. یک نشانی کامل یا یک دامنه (مثل <span dir="ltr">@spam.example</span>).</p>
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); try { await api.mail.blockAdd(d.id, block); setBlock(""); reload(); } catch (x) { notify((x as Error).message, "circle-alert"); } }}>
          <input value={block} onChange={(e) => setBlock(e.target.value.trim().toLowerCase())} aria-label="نشانی یا دامنه" dir="ltr" placeholder="@spam.example" className={INPUT + " text-left"} />
          <button type="submit" disabled={!block} className={BTN_G + BTN_MD + " shrink-0"}>افزودن</button>
        </form>
        {d.blocks.length > 0 && <ul className="flex flex-wrap gap-2 mt-3">{d.blocks.map((b) => (
          <li key={b.id} className="inline-flex items-center gap-1 rounded-lg bg-white/[0.05] ps-2.5 text-xs"><span dir="ltr">{b.pattern}</span><button type="button" aria-label={"حذف " + b.pattern} onClick={async () => { await api.mail.blockRemove(d.id, b.id); reload(); }} className="w-7 h-7 grid place-items-center hover:text-rose-300"><Icon name="x" size={12} /></button></li>
        ))}</ul>}
      </Card>
      <Card title="حساسیت هرزنامه" icon="shield-half">
        <p className="text-xs text-white/55 leading-6">پیام‌هایی که امتیاز هرزنامه‌شان به این عدد برسد، در بخش «هرزنامه» نگه‌داری می‌شوند و به صندوق نمی‌روند. عدد کمتر یعنی سخت‌گیری بیشتر (پیش‌فرض ۵).</p>
        <div className="flex items-center gap-3 mt-3">
          <input type="range" min={1} max={15} step={0.5} value={Number(spam)} onChange={(e) => setSpam(e.target.value)} aria-label="آستانه هرزنامه" className="flex-1 accent-sky-300" />
          <b className="tabular w-10 text-center">{fa(Number(spam))}</b>
        </div>
        <AsyncButton disabled={Number(spam) === d.spamThreshold} className={BTN_G + BTN_SM + " mt-3"} onClick={async () => { await api.mail.setInbound(d.id, { spamThreshold: Number(spam) }); notify("ذخیره شد", "check"); reload(); }}>ذخیره</AsyncButton>
      </Card>
    </div>
  );
}

/* ---------- plan + delete ---------- */
function Settings({ d, reload }: { d: D; reload: () => void }) {
  const router = useRouter(); const { notify } = useApp();
  const o = useRemote("overview", () => api.mail.overview());
  const [planId, setPlanId] = useState(d.planId);
  const [conf, setConf] = useState("");
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="پلن" icon="gauge">
        {!o.data ? <Loading /> : <>
          <Select label="پلن" value={planId} onChange={setPlanId} options={o.data.plans.map((p) => ({ value: p.id, label: p.name + " — " + toman(p.price) + " / ماه · " + fa(p.dailyLimit) + " در روز" }))} />
          <p className="text-[11px] text-white/50 mt-2 leading-6">هزینه ساعتی از کیف پول کسر می‌شود؛ تغییر پلن از ساعت بعد اعمال می‌شود. اگر موجودی تمام شود، ارسال متوقف می‌شود ولی صندوق‌ها و تنظیمات حفظ می‌شوند.</p>
          <AsyncButton disabled={planId === d.planId} className={BTN_P + BTN_MD + " mt-3"} onClick={async () => { await api.mail.setPlan(d.id, planId); notify("پلن تغییر کرد", "gauge"); reload(); }}>تغییر پلن</AsyncButton>
        </>}
      </Card>
      <Card title="حذف دامنه ایمیل" icon="trash-2">
        <p className="text-sm text-white/65 leading-7">همه صندوق‌ها، ایمیل‌ها، کاربران SMTP و گزارش‌ها برای همیشه حذف می‌شوند و کلید API از کار می‌افتد.</p>
        <label className="block text-xs text-white/60 mt-3" htmlFor="mail-del">برای تأیید، دامنه را بنویسید: <b dir="ltr">{d.domain}</b></label>
        <input id="mail-del" value={conf} onChange={(e) => setConf(e.target.value)} dir="ltr" className={INPUT + " text-left mt-1.5 max-w-sm"} />
        <AsyncButton danger disabled={conf.trim().toLowerCase() !== d.domain} className={BTN_D + BTN_MD + " mt-3"} onClick={async () => { await api.mail.remove(d.id, conf); notify("حذف شد", "trash-2"); router.push("/panel/mail" as never); }}>حذف همیشگی</AsyncButton>
      </Card>
    </div>
  );
}
