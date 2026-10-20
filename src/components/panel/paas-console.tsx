"use client";
/* Gereh Apps operator tools, part 1: the web console (interactive shell and one-off commands) and
   persistent disks with their file manager, SFTP accounts and backups. */
import { useCallback, useEffect, useRef, useState } from "react";
import { BTN_G, BTN_MD, BTN_P, BTN_SM, INPUT, INPUT_BASE, TEXTAREA } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { DISK_SIZES, fileName, mountError, parentOf } from "@/lib/paas-tools";
import { api, type PaasConsoleRecord, type PaasDisksView, type PaasFsEntry } from "@/lib/store";
import { feed, keyInput, newTerm } from "@/lib/term";
import type { PaasApp } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, CopyText, Modal, Select, Switch } from "../ui-client";

const Loading = ({ error }: { error?: string }) => <Card>{error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : <p className="text-sm text-white/55 flex items-center gap-2"><Icon name="loader-circle" size={15} className="animate-spin" />در حال بارگذاری…</p>}</Card>;
const size = (n: number) => n >= 1024 ** 3 ? fa(Math.round((n / 1024 ** 3) * 10) / 10, 1) + " گیگ" : n >= 1024 ** 2 ? fa(Math.round((n / 1024 ** 2) * 10) / 10, 1) + " مگ" : n >= 1024 ? fa(Math.round(n / 1024)) + " کیلوبایت" : fa(n) + " بایت";
const notRunning = (app: PaasApp) => !app.liveDeployment || app.status !== "running";

/* ================= console ================= */
export function AppConsole({ app }: { app: PaasApp }) {
  const [instances, setInstances] = useState<{ name: string; ready: boolean }[] | null>(null);
  const [instance, setInstance] = useState("");
  const [open, setOpen] = useState(0);
  const [history, setHistory] = useState<PaasConsoleRecord[]>([]);
  const loadHistory = useCallback(() => { api.paas.consoleHistory(app.id).then(setHistory, () => undefined); }, [app.id]);
  useEffect(() => {
    let live = true;
    api.paas.instances(app.id).then((l) => { if (live) { setInstances(l); setInstance((x) => x || l[0]?.name || ""); } }, () => { if (live) setInstances([]); });
    loadHistory();
    return () => { live = false; };
  }, [app.id, loadHistory]);
  if (notRunning(app)) return <Card><Empty icon="terminal" title="اپ در حال اجرا نیست" text="کنسول و اجرای دستور فقط روی نمونه‌های روشن اپ کار می‌کند." /></Card>;
  if (app.source === "compose") return <Card><Empty icon="terminal" title="کنسول برای اپ‌های Docker Compose در دسترس نیست" /></Card>;
  if (!instances) return <Loading />;
  return (
    <div className="space-y-4">
      <Card title="کنسول وب" icon="terminal" action={
        <div className="flex items-center gap-2">
          {instances.length > 1 && <Select label="نمونه" ltr value={instance} onChange={setInstance} options={instances.map((i) => ({ value: i.name, label: i.name }))} />}
          {open ? <button type="button" onClick={() => { setOpen(0); loadHistory(); }} className={BTN_G + BTN_SM}><Icon name="x" size={14} />بستن</button>
            : <button type="button" disabled={!instance} onClick={() => setOpen(Date.now())} className={BTN_P + BTN_SM}><Icon name="play" size={14} />اتصال</button>}
        </div>}>
        {open ? <Terminal key={open} appId={app.id} instance={instance} onExit={loadHistory} />
          : <p className="text-sm text-white/60 leading-7">یک ترمینال روی نمونه در حال اجرای اپ باز می‌شود (مثل <code dir="ltr">docker exec</code>). تغییر فایل‌ها بیرون از دیسک‌های دائمی با استقرار یا ری‌استارت بعدی از بین می‌رود. هر جلسه ثبت می‌شود؛ پس از ۱۵ دقیقه بی‌کاری یا ۲ ساعت بسته می‌شود.</p>}
      </Card>
      <RunCommand app={app} instance={instance} onDone={loadHistory} />
      <Card title="سابقه کنسول" icon="history" pad="p-3 sm:p-4">
        {history.length === 0 ? <Empty icon="history" title="هنوز جلسه‌ای ثبت نشده" /> : (
          <ul className="divide-y divide-white/[0.06] text-sm">
            {history.map((h) => (
              <li key={h.id} className="py-2.5 px-2 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex items-center gap-2"><Badge tone={h.kind === "shell" ? "blue" : "gray"}>{h.kind === "shell" ? "کنسول" : "دستور"}</Badge>
                  <span dir="ltr" className="font-mono text-xs truncate max-w-[22rem]">{h.kind === "run" ? h.command : h.instance}</span>
                  {h.exitCode !== null && h.exitCode !== 0 && <Badge tone="red">کد {fa(h.exitCode)}</Badge>}</span>
                <span className="text-[11px] text-white/50">{h.at}{h.minutes !== null && h.kind === "shell" ? " · " + fa(h.minutes) + " دقیقه" : !h.ended ? " · باز" : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** a light terminal: output arrives over SSE, key presses are batched to paas.consoleInput */
function Terminal({ appId, instance, onExit }: { appId: string; instance: string; onExit: () => void }) {
  const [t, setT] = useState(newTerm);
  const [state, setState] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const sid = useRef<string | null>(null);
  const pending = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    timer.current = null;
    const d = pending.current;
    pending.current = "";
    if (d && sid.current) api.paas.consoleInput(sid.current, d).catch((e: Error) => { setError(e.message); setState("closed"); });
  }, []);
  const send = useCallback((d: string) => { pending.current += d; if (!timer.current) timer.current = setTimeout(flush, 25); }, [flush]);
  useEffect(() => {
    let es: EventSource | null = null, live = true;
    const el = box.current;
    const cols = Math.max(40, Math.floor(((el?.clientWidth ?? 800) - 24) / 7.8)), rows = Math.max(10, Math.floor(((el?.clientHeight ?? 420) - 24) / 20));
    api.paas.consoleOpen(appId, { instance, cols, rows }).then(({ sessionId }) => {
      if (!live) { void api.paas.consoleClose(sessionId); return; }
      sid.current = sessionId;
      setState("open");
      es = new EventSource("/api/paas/console/" + sessionId);
      es.onmessage = (e) => {
        const c = JSON.parse(e.data) as { data: string };
        setT((cur) => feed(cur, c.data));
        requestAnimationFrame(() => box.current?.scrollTo({ top: box.current.scrollHeight }));
      };
      es.addEventListener("exit", () => { es?.close(); setState("closed"); onExit(); });
      box.current?.focus();
    }, (e: Error) => { if (live) { setError(e.message); setState("error"); } });
    return () => { live = false; es?.close(); if (sid.current) void api.paas.consoleClose(sid.current); };
  }, [appId, instance, onExit]);
  return (
    <div>
      <div ref={box} tabIndex={0} role="textbox" aria-label="ترمینال" aria-multiline="true" dir="ltr"
        onKeyDown={(e) => { if (state !== "open") return; const k = keyInput(e); if (k !== null) { e.preventDefault(); send(k); } }}
        onPaste={(e) => { if (state !== "open") return; e.preventDefault(); send(e.clipboardData.getData("text").replace(/\r?\n/g, "\r")); }}
        className="text-left font-mono text-[13px] leading-5 bg-black/70 rounded-xl p-3 h-[60vh] overflow-auto whitespace-pre-wrap break-all outline-none focus:ring-1 focus:ring-white/25 cursor-text">
        {t.lines.map((l, i) => i === t.lines.length - 1
          ? <div key={i}>{l.slice(0, t.col)}<span className={state === "open" ? "bg-white/80 text-black animate-pulse" : ""}>{l[t.col] ?? " "}</span>{l.slice(t.col + 1)}</div>
          : <div key={i}>{l || " "}</div>)}
      </div>
      <p className="mt-2 text-[11px] text-white/50 flex items-center gap-2">
        {state === "connecting" ? <><Icon name="loader-circle" size={13} className="animate-spin" />در حال اتصال…</> : state === "open" ? <><span className="w-2 h-2 rounded-full bg-emerald-400" />متصل به <span dir="ltr">{instance}</span> · برای تایپ روی ترمینال کلیک کنید؛ Ctrl+C، Tab و کلیدهای جهت کار می‌کنند.</> : error ? <span role="alert" className="text-rose-300">{error}</span> : "جلسه بسته شد."}
      </p>
    </div>
  );
}

function RunCommand({ app, instance, onDone }: { app: PaasApp; instance: string; onDone: () => void }) {
  const [cmd, setCmd] = useState("");
  const [out, setOut] = useState<{ code: number; output: string; command: string } | null>(null);
  return (
    <Card title="اجرای یک دستور" icon="square-terminal">
      <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
        <label className="sr-only" htmlFor="run-cmd">دستور</label>
        <input id="run-cmd" value={cmd} onChange={(e) => setCmd(e.target.value)} dir="ltr" placeholder="php artisan cache:clear" className={INPUT + " font-mono text-left text-xs"} />
        <AsyncButton disabled={!cmd.trim()} className={BTN_P + BTN_MD + " shrink-0"} onClick={async () => { const r = await api.paas.consoleRun(app.id, cmd, instance || undefined); setOut({ ...r, command: cmd }); onDone(); }}><Icon name="play" size={16} />اجرا</AsyncButton>
      </form>
      <p className="text-[11px] text-white/50 mt-2 leading-6">روی نمونه در حال اجرا با همان متغیرها و دیسک‌ها اجرا می‌شود؛ حداکثر ۶۰ ثانیه. برای کارهای طولانی (مایگریشن، اسکریپت) از «اجرای دستور» در بخش پردازش و زمان‌بندی استفاده کنید که در کانتینر جدا اجرا می‌شود.</p>
      {out && (
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-2 text-xs"><Badge tone={out.code === 0 ? "green" : "red"}>{out.code === 0 ? "موفق" : out.code === -1 ? "خطا" : "کد خروج " + fa(out.code)}</Badge><span dir="ltr" className="font-mono truncate">{out.command}</span></div>
          <pre dir="ltr" tabIndex={0} aria-label="خروجی دستور" className="text-left text-[12px] leading-6 font-mono bg-black/50 rounded-xl p-4 max-h-[45vh] overflow-auto whitespace-pre-wrap">{out.output || "(بدون خروجی)"}</pre>
        </div>
      )}
    </Card>
  );
}

/* ================= disks ================= */
export function AppDisks({ app }: { app: PaasApp }) {
  const { notify } = useApp();
  const [view, setView] = useState<PaasDisksView | null>(null);
  const [error, setError] = useState("");
  const [browse, setBrowse] = useState<string | null>(null);
  const reload = useCallback(async () => { try { setView(await api.paas.disks(app.id)); setError(""); } catch (e) { setError((e as Error).message); } }, [app.id]);
  useEffect(() => {
    let live = true;
    api.paas.disks(app.id).then((v) => { if (live) setView(v); }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [app.id]);
  useEffect(() => {
    if (!view?.disks.some((d) => d.backupList.some((b) => b.status === "running" || b.status === "restoring"))) return;
    const t = setTimeout(reload, 4000);
    return () => clearTimeout(t);
  }, [view, reload]);
  if (!view) return <Loading error={error} />;
  const disk = view.disks.find((d) => d.id === browse);
  return (
    <div className="space-y-4">
      {view.disks.length === 0 && <Card><Empty icon="hard-drive" title="اپ دیسک دائمی ندارد" text="فایل‌های بیرون از دیسک دائمی با هر استقرار یا ری‌استارت از بین می‌روند. برای آپلودها، فایل‌های کاربران و پایگاه‌های داده فایلی (SQLite) دیسک بسازید." /></Card>}
      {view.disks.map((d) => <DiskCard key={d.id + d.sizeGb + d.mount} app={app} view={view} d={d} reload={reload} onBrowse={() => setBrowse(d.id)} />)}
      {view.disks.length < view.maxDisks && <AddDisk app={app} price={view.diskPrice} onAdded={async () => { await reload(); notify("دیسک اضافه شد؛ اپ با دیسک جدید دوباره اجرا می‌شود", "hard-drive"); }} />}
      <Modal open={!!disk} onClose={() => setBrowse(null)} title={"فایل‌های دیسک " + (disk?.name ?? "")} icon="folder-open" size="max-w-5xl">
        {disk && <FileManager diskId={disk.id} running={view.running} />}
      </Modal>
    </div>
  );
}

function AddDisk({ app, price, onAdded }: { app: PaasApp; price: number; onAdded: () => Promise<void> }) {
  const [f, setF] = useState({ name: "", mount: "/", sizeGb: 5 });
  const err = f.mount.length > 1 ? mountError(f.mount) : null;
  return (
    <Card title="دیسک جدید" icon="plus">
      <div className="grid sm:grid-cols-[1fr_1.4fr_9rem_auto] gap-3 items-end">
        <Field label="نام"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} dir="ltr" placeholder="uploads" className={INPUT + " text-left font-mono"} /></Field>
        <Field label="مسیر اتصال" error={err ?? undefined}><input value={f.mount} onChange={(e) => setF({ ...f, mount: e.target.value.trim() })} dir="ltr" placeholder="/app/storage" className={INPUT + " text-left font-mono"} /></Field>
        <Field label="حجم"><Select label="حجم" value={String(f.sizeGb)} onChange={(v) => setF({ ...f, sizeGb: Number(v) })} options={DISK_SIZES.map((n) => ({ value: String(n), label: fa(n) + " گیگ" }))} /></Field>
        <AsyncButton disabled={!f.name || !!err || f.mount.length < 2} onClick={async () => { await api.paas.addDisk(app.id, f); setF({ name: "", mount: "/", sizeGb: 5 }); await onAdded(); }}>افزودن</AsyncButton>
      </div>
      <p className="text-[11px] text-white/50 mt-3 leading-6">{toman(f.sizeGb * price)} در ماه (ساعتی از کیف پول). حجم دیسک فقط قابل افزایش است. اپ دارای دیسک با یک نمونه اجرا می‌شود. مسیر <span dir="ltr">/</span> و پوشه‌های سیستم (مثل <span dir="ltr">/etc</span>، <span dir="ltr">/usr</span>) مجاز نیستند.</p>
    </Card>
  );
}

function DiskCard({ app, view, d, reload, onBrowse }: { app: PaasApp; view: PaasDisksView; d: PaasDisksView["disks"][number]; reload: () => Promise<void>; onBrowse: () => void }) {
  const { notify, confirm } = useApp();
  const [grow, setGrow] = useState(d.sizeGb);
  const [mount, setMount] = useState(d.mount);
  const [del, setDel] = useState("");
  const [newUser, setNewUser] = useState({ username: "", access: "rw" as "ro" | "rw" });
  const [shown, setShown] = useState<{ user: string; password: string } | null>(null);
  const pct = d.usedBytes !== null ? Math.min(100, Math.round((d.usedBytes / (d.sizeGb * 1024 ** 3)) * 100)) : null;
  const busy = d.backupList.some((b) => b.status === "running" || b.status === "restoring");
  return (
    <Card title={<span className="flex items-center gap-2"><span dir="ltr" className="font-mono">{d.name}</span><span dir="ltr" className="text-xs text-white/55 font-mono">{d.mount}</span></span>} icon="hard-drive"
      action={<button type="button" onClick={onBrowse} disabled={!view.running} className={BTN_G + BTN_SM}><Icon name="folder-open" size={14} />مدیریت فایل‌ها</button>}>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-white/60 mb-1.5"><span>مصرف</span><span className="tabular">{d.usedBytes === null ? "—" : size(d.usedBytes)} از {fa(d.sizeGb)} گیگ</span></div>
            <div className="h-2 rounded-full bg-white/[0.08] overflow-hidden"><div className={"h-full rounded-full " + ((pct ?? 0) > 85 ? "bg-rose-400" : "bg-emerald-400")} style={{ width: (pct ?? 0) + "%" }} /></div>
          </div>
          <Field label="افزایش حجم" hint={toman((grow - d.sizeGb) * view.diskPrice) + " در ماه اضافه"}>
            <div className="flex gap-2"><Select label="حجم جدید" value={String(grow)} onChange={(v) => setGrow(Number(v))} options={[d.sizeGb, ...DISK_SIZES.filter((n) => n > d.sizeGb)].map((n) => ({ value: String(n), label: fa(n) + " گیگ" }))} />
              <AsyncButton disabled={grow <= d.sizeGb} className={BTN_G + BTN_MD + " shrink-0"} onClick={async () => { await api.paas.updateDisk(d.id, { sizeGb: grow }); await reload(); notify("حجم دیسک افزایش یافت", "hard-drive"); }}>اعمال</AsyncButton></div>
          </Field>
          <Field label="مسیر اتصال" error={mount !== d.mount ? mountError(mount) ?? undefined : undefined}>
            <div className="flex gap-2"><input value={mount} onChange={(e) => setMount(e.target.value.trim())} dir="ltr" className={INPUT + " text-left font-mono"} />
              <AsyncButton disabled={mount === d.mount || !!mountError(mount)} className={BTN_G + BTN_MD + " shrink-0"} confirmText="اپ با مسیر جدید دوباره اجرا می‌شود. ادامه؟" onClick={async () => { await api.paas.updateDisk(d.id, { mount }); await reload(); notify("مسیر دیسک تغییر کرد", "hard-drive"); }}>ذخیره</AsyncButton></div>
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2"><b className="text-sm">پشتیبان‌ها</b>
            <span className="flex items-center gap-2 text-[11px] text-white/60">روزانه (۳ نسخه آخر)<Switch on={d.backups} label="پشتیبان روزانه" onChange={async (v) => { await api.paas.updateDisk(d.id, { backups: v }); await reload(); }} /></span></div>
          <AsyncButton disabled={busy || !view.running} className={BTN_G + BTN_SM + " mb-2"} onClick={async () => { await api.paas.diskBackup(d.id); await reload(); notify("پشتیبان‌گیری شروع شد", "archive"); }}><Icon name="archive" size={14} />پشتیبان‌گیری الان</AsyncButton>
          {d.backupList.length === 0 ? <p className="text-[11px] text-white/50">هنوز پشتیبانی نیست.</p> : (
            <ul className="space-y-1 max-h-56 overflow-auto">
              {d.backupList.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 text-xs rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
                  <span className="min-w-0"><span className="block">{b.at}</span><span className="text-[11px] text-white/50">{b.kind === "auto" ? "خودکار" : "دستی"} · {b.status === "done" ? fa(b.sizeMb, 1) + " مگ" : b.status === "running" ? "در حال انجام…" : b.status === "restoring" ? "در حال بازگردانی…" : "ناموفق"}{b.error ? " · " + b.error.slice(0, 60) : ""}</span></span>
                  {b.status === "done" && <span className="flex gap-1 shrink-0">
                    <button type="button" aria-label="دانلود پشتیبان" title="دانلود" onClick={async () => { try { window.location.assign(await api.paas.diskBackupLink(b.id)); } catch (e) { notify((e as Error).message, "circle-alert"); } }} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10"><Icon name="download" size={13} /></button>
                    <button type="button" aria-label="بازگردانی" title="بازگردانی" onClick={async () => { if (await confirm("همه فایل‌های فعلی دیسک " + d.name + " با این پشتیبان جایگزین شوند؟", { danger: true, ok: "بازگردانی" })) { try { await api.paas.diskRestore(b.id); await reload(); notify("بازگردانی شروع شد", "archive-restore"); } catch (e) { notify((e as Error).message, "circle-alert"); } } }} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10"><Icon name="archive-restore" size={13} /></button>
                    <button type="button" aria-label="حذف پشتیبان" title="حذف" onClick={async () => { if (await confirm("این پشتیبان حذف شود؟", { danger: true, ok: "حذف" })) { await api.paas.diskBackupDelete(b.id); await reload(); } }} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10 hover:text-rose-300"><Icon name="trash-2" size={13} /></button>
                  </span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <b className="text-sm block mb-2">دسترسی SFTP</b>
          {d.sftpUsers.length > 0 && (
            <div className="text-[11px] text-white/60 space-y-1 mb-2" dir="ltr">
              <div className="flex justify-between gap-2"><span>Host</span><CopyText text={view.sftp.host} className="font-mono" /></div>
              <div className="flex justify-between gap-2"><span>Port</span>{view.sftp.port ? <CopyText text={String(view.sftp.port)} className="font-mono" /> : <span>پس از استقرار بعدی</span>}</div>
            </div>
          )}
          <ul className="space-y-1 mb-2">
            {d.sftpUsers.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 text-xs rounded-lg px-2 py-1.5 bg-white/[0.03]">
                <span><span dir="ltr" className="font-mono">{u.username}</span> <Badge tone={u.access === "rw" ? "amber" : "gray"}>{u.access === "rw" ? "خواندن و نوشتن" : "فقط خواندن"}</Badge></span>
                <span className="flex gap-1">
                  <button type="button" aria-label="نمایش رمز" title="نمایش رمز" onClick={async () => setShown({ user: u.username, password: await api.paas.sftpReveal(u.id) })} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10"><Icon name="key-round" size={13} /></button>
                  <button type="button" aria-label="تغییر دسترسی" title="تغییر دسترسی" onClick={async () => { await api.paas.sftpUpdate(u.id, { access: u.access === "rw" ? "ro" : "rw" }); await reload(); }} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10"><Icon name="shield" size={13} /></button>
                  <button type="button" aria-label="رمز جدید" title="رمز جدید" onClick={async () => { const r = await api.paas.sftpUpdate(u.id, { resetPassword: true }); if (r.password) setShown({ user: u.username, password: r.password }); }} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10"><Icon name="refresh-cw" size={13} /></button>
                  <button type="button" aria-label="حذف حساب" title="حذف" onClick={async () => { if (await confirm("حساب SFTP " + u.username + " حذف شود؟", { danger: true, ok: "حذف" })) { await api.paas.sftpDelete(u.id); await reload(); } }} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10 hover:text-rose-300"><Icon name="trash-2" size={13} /></button>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={"sftp-u-" + d.id}>نام کاربری SFTP</label>
            <input id={"sftp-u-" + d.id} value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} dir="ltr" placeholder="username" className={INPUT_BASE + " h-9 text-left font-mono text-xs"} />
            <Select label="دسترسی" value={newUser.access} onChange={(v) => setNewUser({ ...newUser, access: v as "ro" | "rw" })} options={[{ value: "rw", label: "نوشتن" }, { value: "ro", label: "خواندن" }]} />
            <AsyncButton disabled={newUser.username.length < 3} className={BTN_G + BTN_SM + " shrink-0"} onClick={async () => { const r = await api.paas.sftpCreate(d.id, newUser); setShown({ user: newUser.username, password: r.password }); setNewUser({ username: "", access: "rw" }); await reload(); }}>افزودن</AsyncButton>
          </div>
          <p className="text-[11px] text-white/50 mt-2 leading-5">با FileZilla یا WinSCP (پروتکل SFTP) وصل شوید؛ دیسک در پوشه <span dir="ltr">/{d.name}</span> است. افزودن حساب، اپ را یک بار دوباره اجرا می‌کند.</p>
        </div>
      </div>
      <details className="mt-5 border-t border-white/[0.08] pt-3">
        <summary className="text-xs text-rose-300/80 cursor-pointer">حذف دیسک</summary>
        <p className="text-xs text-white/60 mt-2">همه فایل‌ها و پشتیبان‌های این دیسک برای همیشه حذف می‌شوند. برای تأیید نام دیسک را بنویسید: <b dir="ltr">{d.name}</b></p>
        <div className="flex gap-2 mt-2"><input aria-label="نام دیسک برای تأیید" value={del} onChange={(e) => setDel(e.target.value)} dir="ltr" className={INPUT_BASE + " h-9 text-left max-w-xs"} />
          <AsyncButton danger disabled={del !== d.name} size="sm" onClick={async () => { await api.paas.deleteDisk(d.id, del); await reload(); notify("دیسک حذف شد", "trash-2"); }}>حذف همیشگی</AsyncButton></div>
      </details>
      <Modal open={!!shown} onClose={() => setShown(null)} title="اطلاعات اتصال SFTP" icon="key-round">
        {shown && <dl className="text-sm space-y-2" dir="ltr">
          <div className="flex justify-between gap-3"><dt className="text-white/55">Host</dt><dd><CopyText text={view.sftp.host} className="font-mono" /></dd></div>
          <div className="flex justify-between gap-3"><dt className="text-white/55">Port</dt><dd>{view.sftp.port ? <CopyText text={String(view.sftp.port)} className="font-mono" /> : "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-white/55">Username</dt><dd><CopyText text={shown.user} className="font-mono" /></dd></div>
          <div className="flex justify-between gap-3"><dt className="text-white/55">Password</dt><dd><CopyText text={shown.password} className="font-mono" /></dd></div>
          <div className="text-[11px] text-white/50 pt-2" dir="rtl">رمز رمزنگاری‌شده نگه داشته می‌شود و هر بار نمایش آن ثبت می‌شود.{app.status !== "running" ? " اپ باید روشن باشد." : ""}</div>
        </dl>}
      </Modal>
    </Card>
  );
}

/* ================= file manager ================= */
function FileManager({ diskId, running }: { diskId: string; running: boolean }) {
  const { notify, confirm } = useApp();
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<PaasFsEntry[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ path: string; dir: boolean }[] | null>(null);
  const [edit, setEdit] = useState<{ path: string; text: string; isNew?: boolean } | null>(null);
  const [rename, setRename] = useState<{ from: string; to: string } | null>(null);
  const [progress, setProgress] = useState<string>("");
  const upload = useRef<HTMLInputElement>(null);
  const load = useCallback(async (p: string) => {
    try { const r = await api.paas.fsList(diskId, p); setError(""); setEntries(r.entries); setPath(r.path); setFound(null); } catch (e) { setError((e as Error).message); }
  }, [diskId]);
  useEffect(() => {
    let on = true;
    if (running) api.paas.fsList(diskId, "").then((r) => { if (on) { setEntries(r.entries); setPath(r.path); } }, (e: Error) => { if (on) setError(e.message); });
    return () => { on = false; };
  }, [diskId, running]);
  if (!running) return <Empty icon="folder-open" title="اپ باید روشن باشد" text="فایل‌ها از طریق نمونه در حال اجرای اپ خوانده و نوشته می‌شوند." />;
  const join = (n: string) => (path ? path + "/" + n : n);
  const crumbs = path ? path.split("/") : [];
  const dl = (p: string) => "/api/paas/files/" + encodeURIComponent(diskId) + "?path=" + encodeURIComponent(p);
  const act = async (f: () => Promise<unknown>, msg?: string) => { try { await f(); if (msg) notify(msg, "check"); await load(path); } catch (e) { notify((e as Error).message, "circle-alert"); } };
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      try { await api.paas.fsUpload(diskId, join(f.name), f, (p) => setProgress(f.name + " " + fa(p) + "٪")); }
      catch (e) { notify(f.name + ": " + (e as Error).message, "circle-alert"); }
    }
    setProgress("");
    await load(path);
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <nav aria-label="مسیر" dir="ltr" className="flex items-center gap-1 text-xs font-mono min-w-0 flex-1 flex-wrap">
          <button type="button" onClick={() => load("")} className="px-1.5 py-1 rounded hover:bg-white/10">/</button>
          {crumbs.map((c, i) => <span key={i} className="flex items-center gap-1"><span className="text-white/30">/</span><button type="button" onClick={() => load(crumbs.slice(0, i + 1).join("/"))} className="px-1.5 py-1 rounded hover:bg-white/10">{c}</button></span>)}
        </nav>
        <input ref={upload} type="file" multiple className="sr-only" aria-label="بارگذاری فایل" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
        <button type="button" onClick={() => upload.current?.click()} className={BTN_G + BTN_SM}><Icon name="upload" size={14} />بارگذاری</button>
        <button type="button" onClick={async () => { const n = window.prompt("نام پوشه جدید"); if (n) await act(() => api.paas.fsMkdir(diskId, join(n))); }} className={BTN_G + BTN_SM}><Icon name="folder-plus" size={14} />پوشه</button>
        <button type="button" onClick={() => { const n = window.prompt("نام فایل جدید"); if (n) setEdit({ path: join(n), text: "", isNew: true }); }} className={BTN_G + BTN_SM}><Icon name="file-plus" size={14} />فایل</button>
        <form className="flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (!q.trim()) { setFound(null); return; } try { setFound(await api.paas.fsSearch(diskId, path, q)); } catch (er) { notify((er as Error).message, "circle-alert"); } }}>
          <label className="sr-only" htmlFor="fs-q">جست‌وجوی نام فایل</label>
          <input id="fs-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی نام…" className={INPUT_BASE + " h-9 w-40 text-xs"} />
          <button type="submit" aria-label="جست‌وجو" className={BTN_G + " h-9 w-9"}><Icon name="search" size={14} /></button>
        </form>
      </div>
      {progress && <p className="text-xs text-white/60 mb-2" dir="ltr">{progress}</p>}
      {error && <p role="alert" className="text-sm text-rose-300 mb-2">{error}</p>}
      {found ? (
        <div>
          <div className="flex justify-between text-xs mb-2"><span>{fa(found.length)} نتیجه برای «{q}»</span><button type="button" onClick={() => setFound(null)} className="acc">بازگشت</button></div>
          <ul className="text-xs font-mono space-y-0.5" dir="ltr">{found.map((f) => (
            <li key={f.path}><button type="button" onClick={() => load(f.dir ? f.path : parentOf(f.path))} className="hover:underline flex items-center gap-1.5"><Icon name={f.dir ? "folder" : "file"} size={13} />{f.path}</button></li>
          ))}</ul>
        </div>
      ) : entries === null ? <p className="text-sm text-white/55">…</p> : (
        <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/[0.08]">
          <table className="w-full text-xs">
            <thead className="text-white/50 bg-white/[0.03]"><tr><th className="text-right p-2 font-normal">نام</th><th className="text-right p-2 font-normal w-24">حجم</th><th className="text-right p-2 font-normal w-40 hidden sm:table-cell">تغییر</th><th className="w-40" /></tr></thead>
            <tbody>
              {path && <tr className="border-t border-white/[0.06]"><td colSpan={4} className="p-2"><button type="button" onClick={() => load(parentOf(path))} className="flex items-center gap-1.5 hover:underline"><Icon name="corner-left-up" size={13} />..</button></td></tr>}
              {entries.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-white/50">پوشه خالی است.</td></tr>}
              {entries.map((e) => (
                <tr key={e.name} className="border-t border-white/[0.06] hover:bg-white/[0.03]">
                  <td className="p-2" dir="ltr">
                    {e.dir ? <button type="button" onClick={() => load(join(e.name))} className="flex items-center gap-1.5 hover:underline font-mono"><Icon name="folder" size={14} className="text-amber-300" />{e.name}</button>
                      : <span className="flex items-center gap-1.5 font-mono"><Icon name="file" size={14} className="text-white/50" />{e.name}</span>}
                  </td>
                  <td className="p-2 tabular text-white/60">{e.dir ? "—" : size(e.size)}</td>
                  <td className="p-2 text-white/50 hidden sm:table-cell">{e.mtime ? new Date(e.mtime).toLocaleString("fa-IR") : ""}</td>
                  <td className="p-1">
                    <span className="flex justify-end gap-0.5">
                      {e.editable && <button type="button" title="ویرایش" aria-label={"ویرایش " + e.name} onClick={async () => { try { setEdit({ path: join(e.name), text: await api.paas.fsRead(diskId, join(e.name)) }); } catch (er) { notify((er as Error).message, "circle-alert"); } }} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10"><Icon name="file-pen" size={13} /></button>}
                      {!e.dir && /\.zip$/i.test(e.name) && <button type="button" title="باز کردن ZIP" aria-label={"باز کردن " + e.name} onClick={async () => { const dest = window.prompt("پوشه مقصد (خالی: همین پوشه)", e.name.replace(/\.zip$/i, "")); if (dest !== null) await act(async () => { const n = await api.paas.fsExtract(diskId, join(e.name), dest ? join(dest) : path); notify(fa(n) + " فایل باز شد", "file-archive"); }); }} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10"><Icon name="file-archive" size={13} /></button>}
                      {!e.dir && <a title="دانلود" aria-label={"دانلود " + e.name} href={dl(join(e.name))} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10"><Icon name="download" size={13} /></a>}
                      <button type="button" title="تغییر نام یا انتقال" aria-label={"تغییر نام " + e.name} onClick={() => setRename({ from: join(e.name), to: join(e.name) })} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10"><Icon name="pencil" size={13} /></button>
                      <button type="button" title="حذف" aria-label={"حذف " + e.name} onClick={async () => { if (await confirm((e.dir ? "پوشه «" + e.name + "» و همه محتوایش" : "فایل «" + e.name + "»") + " حذف شود؟", { danger: true, ok: "حذف" })) await act(() => api.paas.fsDelete(diskId, [join(e.name)])); }} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10 hover:text-rose-300"><Icon name="trash-2" size={13} /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? fileName(edit.path) : ""} icon="file-pen" size="max-w-4xl"
        footer={<AsyncButton onClick={async () => { await api.paas.fsWrite(diskId, edit!.path, edit!.text); setEdit(null); notify("ذخیره شد", "check"); await load(path); }}>ذخیره</AsyncButton>}>
        {edit && <><label className="sr-only" htmlFor="fs-edit">محتوای فایل</label><textarea id="fs-edit" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} dir="ltr" spellCheck={false} className={TEXTAREA + " h-[60vh] font-mono text-xs leading-5 text-left resize-y"} /></>}
      </Modal>
      <Modal open={!!rename} onClose={() => setRename(null)} title="تغییر نام یا انتقال" icon="pencil"
        footer={<AsyncButton onClick={async () => { await api.paas.fsRename(diskId, rename!.from, rename!.to); setRename(null); await load(path); }}>اعمال</AsyncButton>}>
        {rename && <Field label="مسیر جدید (نسبت به ریشه دیسک)"><input value={rename.to} onChange={(e) => setRename({ ...rename, to: e.target.value })} dir="ltr" className={INPUT + " text-left font-mono"} /></Field>}
      </Modal>
    </div>
  );
}
