"use client";
import { useEffect, useState } from "react";
import { BTN_G, BTN_P, INPUT } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { CRON_PRESETS, MAX_PROCESSES, PROC_NAME_RE, appMonthly, cronError } from "@/lib/paas";
import { api, useDB } from "@/lib/store";
import type { PaasApp } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, Modal, Select, Switch } from "../ui-client";

const JOB_TONE = { running: "blue", succeeded: "green", failed: "red" } as const;
const JOB_LABEL = { running: "در حال اجرا", succeeded: "موفق", failed: "ناموفق" } as const;

/** background processes, release command, cron jobs and a one-off command console */
export function AppJobs({ app }: { app: PaasApp }) {
  if (app.source === "compose") return <Card><Empty icon="layers" title="در اپ‌های Docker Compose" text="سرویس‌های پس‌زمینه و زمان‌بندی را در خود فایل docker-compose.yml تعریف کنید." /></Card>;
  return (
    <div className="space-y-4">
      <RunConsole app={app} />
      <div className="grid xl:grid-cols-2 gap-4 items-start">
        <ReleaseCommand app={app} />
        <Processes app={app} />
      </div>
      <Crons app={app} />
    </div>
  );
}

function ReleaseCommand({ app }: { app: PaasApp }) {
  const { notify } = useApp();
  const [cmd, setCmd] = useState(app.releaseCommand);
  return (
    <Card title="دستور انتشار (release)" icon="rocket">
      <p className="text-sm text-white/60 leading-7">پس از هر بیلد موفق و <b>پیش از</b> رسیدن ترافیک به نسخه جدید، یک بار در کانتینری جدا اجرا می‌شود؛ مناسب migration پایگاه داده. اگر خطا بدهد، استقرار متوقف می‌شود و نسخه قبلی سرویس می‌دهد.</p>
      <Field label="دستور" className="mt-3"><input dir="ltr" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="python manage.py migrate --noinput" className={INPUT + " font-mono text-left text-sm"} /></Field>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {["npx prisma migrate deploy", "python manage.py migrate --noinput", "php artisan migrate --force", "bundle exec rails db:migrate"].map((x) => <button key={x} type="button" onClick={() => setCmd(x)} className="h-7 px-2.5 rounded-lg text-[11px] bg-white/[0.05] text-white/60 hover:text-white font-mono" dir="ltr">{x}</button>)}
      </div>
      <AsyncButton disabled={cmd.trim() === app.releaseCommand} className="mt-4" onClick={async () => { await api.paas.updateApp(app.id, { releaseCommand: cmd.trim() }); notify(cmd.trim() ? "از استقرار بعدی اجرا می‌شود" : "دستور انتشار حذف شد", "circle-check"); }}>ذخیره</AsyncButton>
    </Card>
  );
}

function Processes({ app }: { app: PaasApp }) {
  const db = useDB(); const { notify } = useApp();
  const [rows, setRows] = useState(app.processes);
  const plan = db.paasPlans.find((p) => p.id === app.planId);
  const dirty = JSON.stringify(rows) !== JSON.stringify(app.processes);
  const workers = rows.reduce((s, r) => s + r.instances, 0);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const bad = rows.find((r) => !PROC_NAME_RE.test(r.name) || !r.command.trim());
  return (
    <Card title="پردازش‌های پس‌زمینه" icon="cpu" action={rows.length < MAX_PROCESSES ? <button type="button" onClick={() => setRows([...rows, { name: rows.length ? "worker-" + (rows.length + 1) : "worker", command: "", instances: 1 }])} className={BTN_G + " h-9 px-3 text-xs"}><Icon name="plus" size={14} />پردازش</button> : undefined}>
      <p className="text-sm text-white/60 leading-7">صف‌ها، ربات‌ها و هر کاری که پورت HTTP ندارد. با همان ایمیج و متغیرهای اپ اجرا می‌شوند و هر نمونه به اندازه پلن اپ ({plan?.name}) منابع دارد.</p>
      {rows.length === 0 ? <p className="text-xs text-white/45 mt-4">پردازشی تعریف نشده است. مثال: <code dir="ltr">celery -A app worker</code> یا <code dir="ltr">php artisan queue:work</code></p> : (
        <ul className="space-y-3 mt-4">
          {rows.map((r, i) => (
            <li key={i} className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3 grid sm:grid-cols-[8rem_1fr_6rem_auto] gap-2 items-end">
              <Field label="نام"><input dir="ltr" value={r.name} onChange={(e) => set(i, { name: e.target.value.toLowerCase() })} className={INPUT + " h-9 text-xs font-mono text-left"} /></Field>
              <Field label="دستور"><input dir="ltr" value={r.command} onChange={(e) => set(i, { command: e.target.value })} placeholder="node worker.js" className={INPUT + " h-9 text-xs font-mono text-left"} /></Field>
              <Field label="نمونه"><Select label={"تعداد نمونه " + r.name} value={String(r.instances)} onChange={(v) => set(i, { instances: Number(v) })} options={[0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: String(n), label: n ? fa(n) : "خاموش" }))} /></Field>
              <button type="button" aria-label={"حذف " + r.name} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="h-9 w-9 grid place-items-center rounded-lg text-white/50 hover:text-rose-300"><Icon name="trash-2" size={15} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <span className="text-xs text-white/55">{workers ? "هزینه اضافه: " + toman(plan ? appMonthly(plan, workers, 0) : 0) + " در ماه" : "بدون هزینه اضافه"}</span>
        <AsyncButton disabled={!dirty || !!bad} onClick={async () => { await api.paas.setProcesses(app.id, rows.map((r) => ({ ...r, command: r.command.trim() }))); notify("پردازش‌ها ذخیره شد؛ اپ با تنظیمات جدید بالا می‌آید", "cpu"); }}>ذخیره و اعمال</AsyncButton>
      </div>
      {bad && <p className="text-[11px] text-rose-300 mt-2">نام هر پردازش ۲ تا ۲۰ حرف کوچک انگلیسی/عدد/خط تیره و دستور آن الزامی است.</p>}
    </Card>
  );
}

type CronForm = { id?: string; name: string; schedule: string; command: string; enabled: boolean };
function Crons({ app }: { app: PaasApp }) {
  const { notify, confirm } = useApp();
  const [form, setForm] = useState<CronForm | null>(null);
  const err = form ? cronError(form.schedule) : null;
  return (
    <Card title="زمان‌بندی (Cron)" icon="clock" pad="p-3 sm:p-4" action={<button type="button" onClick={() => setForm({ name: "", schedule: "0 3 * * *", command: "", enabled: true })} className={BTN_G + " h-9 px-3 text-xs"}><Icon name="plus" size={14} />زمان‌بندی جدید</button>}>
      {app.crons.length === 0 ? <Empty icon="clock" title="زمان‌بندی ندارید" text="دستورهای دوره‌ای مثل پاک‌سازی، ارسال گزارش یا پشتیبان‌گیری را به وقت تهران اجرا کنید." /> : (
        <ul className="divide-y divide-white/[0.06]">
          {app.crons.map((c) => (
            <li key={c.id} className="p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="flex flex-wrap items-center gap-2"><b className="text-sm">{c.name}</b><code dir="ltr" className="text-xs text-sky-200">{c.schedule}</code>{!c.enabled && <Badge>غیرفعال</Badge>}</span>
                <code dir="ltr" className="block text-[11px] text-white/55 mt-1 text-right truncate">{c.command}</code>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setForm(c)} className={BTN_G + " h-8 px-3 text-xs"}><Icon name="pencil" size={13} />ویرایش</button>
                <button type="button" onClick={async () => { if (await confirm("زمان‌بندی «" + c.name + "» حذف شود؟", { danger: true, ok: "حذف" })) { await api.paas.deleteCron(c.id); notify("حذف شد"); } }} className={BTN_G + " h-8 px-3 text-xs"}><Icon name="trash-2" size={13} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-white/45 mt-3 leading-6">ساعت‌ها به وقت تهران است. هر اجرا در کانتینری جدا از نسخه فعال اپ با همان متغیرها انجام می‌شود، حداکثر یک ساعت طول می‌کشد و هم‌پوشانی ندارد.</p>
      {form && (
        <Modal open onClose={() => setForm(null)} title={form.id ? "ویرایش زمان‌بندی" : "زمان‌بندی جدید"} icon="clock">
          <div className="space-y-4">
            <Field label="نام"><input dir="ltr" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })} placeholder="cleanup" className={INPUT + " font-mono text-left"} /></Field>
            <Field label="زمان‌بندی (cron)" error={err ?? undefined}><input dir="ltr" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} className={INPUT + " font-mono text-left"} /></Field>
            <div className="flex flex-wrap gap-1.5 -mt-2">{CRON_PRESETS.map((p) => <button key={p.value} type="button" onClick={() => setForm({ ...form, schedule: p.value })} className="h-7 px-2.5 rounded-lg text-[11px] bg-white/[0.05] text-white/60 hover:text-white">{p.label}</button>)}</div>
            <Field label="دستور"><input dir="ltr" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="python manage.py clearsessions" className={INPUT + " font-mono text-left"} /></Field>
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3 text-sm"><span>فعال</span><Switch on={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="فعال بودن زمان‌بندی" /></div>
            <AsyncButton disabled={!!err || !PROC_NAME_RE.test(form.name) || !form.command.trim()} className={BTN_P + " w-full h-11"} onClick={async () => { await api.paas.saveCron(app.id, { ...form, command: form.command.trim() }); notify("زمان‌بندی ذخیره شد", "clock"); setForm(null); }}>ذخیره</AsyncButton>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function RunConsole({ app }: { app: PaasApp }) {
  const { notify } = useApp();
  const [cmd, setCmd] = useState("");
  const [open, setOpen] = useState<string | null>(app.jobs[0]?.id ?? null);
  const [live, setLive] = useState<{ id: string; status: string; output: string } | null>(null);
  const job = app.jobs.find((j) => j.id === open);
  // poll the open job while it runs
  useEffect(() => {
    if (!open || (job && job.status !== "running")) return;
    let alive = true;
    const tick = async () => { try { const r = await api.paas.job(open); if (alive) setLive(r); if (alive && r.status === "running") setTimeout(tick, 2000); } catch { /* gone */ } };
    void tick();
    return () => { alive = false; };
  }, [open, job]);
  const shown = live && live.id === open ? live : job;
  return (
    <Card title="اجرای دستور" icon="terminal">
      {!app.liveDeployment ? <p className="text-sm text-white/55">پس از اولین استقرار موفق می‌توانید دستور اجرا کنید.</p> : <>
        <p className="text-sm text-white/60 leading-7">یک دستور را یک بار در کانتینری جدا از نسخه فعال اجرا کنید (مثلاً ساخت کاربر ادمین یا اسکریپت یک‌باره). خروجی تا ۲۴ ساعت نگه داشته می‌شود.</p>
        <form className="flex gap-2 mt-3" onSubmit={(e) => e.preventDefault()}>
          <input dir="ltr" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="python manage.py createsuperuser --noinput" aria-label="دستور" className={INPUT + " font-mono text-left text-sm"} />
          <AsyncButton disabled={!cmd.trim()} className={BTN_P + " h-11 px-4 shrink-0"} onClick={async () => { const id = await api.paas.runJob(app.id, cmd.trim()); setOpen(id); setLive(null); setCmd(""); notify("دستور اجرا شد", "terminal"); }}><Icon name="play" size={15} />اجرا</AsyncButton>
        </form>
      </>}
      {app.jobs.length > 0 && (
        <div className="grid md:grid-cols-[14rem_1fr] gap-3 mt-4">
          <ul className="space-y-1 max-h-72 overflow-y-auto">
            {app.jobs.map((j) => (
              <li key={j.id}><button type="button" aria-pressed={open === j.id} onClick={() => { setOpen(j.id); setLive(null); }} className={"w-full text-right rounded-lg px-3 py-2 text-xs transition " + (open === j.id ? "bg-white/[0.08]" : "hover:bg-white/[0.04]")}>
                <span className="flex items-center justify-between gap-2"><Badge tone={JOB_TONE[j.status]}>{JOB_LABEL[j.status]}</Badge><span className="text-white/45">{j.kind === "release" ? "انتشار" : j.at.split(" ")[1]}</span></span>
                <code dir="ltr" className="block truncate mt-1 text-white/70 text-right">{j.command}</code>
              </button></li>
            ))}
          </ul>
          <pre dir="ltr" tabIndex={0} aria-label="خروجی دستور" className="text-left text-[12px] leading-6 font-mono bg-black/40 rounded-xl p-4 max-h-72 overflow-auto whitespace-pre-wrap break-all">{shown ? (shown.output || "…") + (shown.status === "running" ? "\n▍" : "") : ""}</pre>
        </div>
      )}
    </Card>
  );
}
