"use client";
import Link from "next/link";
import { useState } from "react";
import { BTN_G, BTN_P, INPUT } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { PAAS_NAME_RE } from "@/lib/paas";
import { api, useDB } from "@/lib/store";
import type { PaasApp } from "@/lib/types";
import { WP_PLANS, wpMonthly, wpPlanOf, type WpPlan } from "@/lib/wordpress";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Field } from "../ui";
import { AsyncButton, Modal, PageTitle, Switch } from "../ui-client";
import { StatusPill } from "./paas-shared";

const IMPORT_TONE = { running: "blue", succeeded: "green", failed: "red" } as const;
const IMPORT_LABEL = { running: "در حال انتقال", succeeded: "منتقل شد", failed: "انتقال ناموفق" } as const;

export function UserWordpress() {
  const db = useDB();
  const sites = db.paasApps.filter((a) => a.product === "wordpress");
  const [create, setCreate] = useState<WpPlan | null>(null);
  return (
    <div>
      <PageTitle title="وردپرس مدیریت‌شده" sub="وردپرس روی زیرساخت ابری گره با پایگاه داده جدا، پشتیبان روزانه و انتقال رایگان از cPanel."
        action={<button type="button" onClick={() => setCreate(WP_PLANS[0])} className={BTN_P + " h-10 px-4 text-sm"}><Icon name="plus" size={16} />سایت جدید</button>} />
      {sites.length === 0 ? (
        <div className="grid md:grid-cols-2 gap-4">{WP_PLANS.map((p) => <PlanCard key={p.id} p={p} onPick={() => setCreate(p)} />)}</div>
      ) : (
        <div className="space-y-3">{sites.map((s) => <SiteRow key={s.id} s={s} />)}</div>
      )}
      {create && <CreateSite initial={create} onClose={() => setCreate(null)} />}
    </div>
  );
}

function PlanCard({ p, onPick }: { p: WpPlan; onPick: () => void }) {
  const db = useDB();
  return (
    <Card>
      <div className="flex items-center justify-between"><h2 className="text-xl font-black">{p.name}</h2>{p.cdn && <Badge tone="blue">با CDN</Badge>}</div>
      <p className="text-sm text-white/60 mt-1">{p.for}</p>
      <p className="text-2xl font-black tabular mt-4">{fa(wpMonthly(p, db.paasPlans))} <span className="text-sm font-normal text-white/60">تومان در ماه، ساعتی</span></p>
      <ul className="space-y-2 mt-4 text-sm text-white/75">{p.features.map((f) => <li key={f} className="flex gap-2"><Icon name="check" size={16} className="acc shrink-0 mt-0.5" />{f}</li>)}</ul>
      <button type="button" onClick={onPick} className={BTN_P + " w-full h-11 mt-5"}>شروع با {p.name}</button>
    </Card>
  );
}

function SiteRow({ s }: { s: PaasApp }) {
  const { notify } = useApp();
  const [imp, setImp] = useState(false);
  const plan = wpPlanOf(s.wpPlan);
  const job = s.jobs.find((j) => j.kind === "import");
  const host = s.domains.find((d) => d.status === "active")?.host;
  const url = host ? "https://" + host : s.url;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="flex flex-wrap items-center gap-2"><b className="text-lg">{s.name}</b><StatusPill s={s.status} />{plan && <Badge>{plan.name}</Badge>}{job && <Badge tone={IMPORT_TONE[job.status]}>{IMPORT_LABEL[job.status]}</Badge>}</span>
          <a href={url} target="_blank" rel="noopener noreferrer" dir="ltr" className="block text-sm acc mt-1 truncate">{url.replace("https://", "")}</a>
          <span className="block text-[11px] text-white/50 mt-1">{toman(s.hourly)} در ساعت</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={url + "/wp-admin/"} target="_blank" rel="noopener noreferrer" className={BTN_P + " h-9 px-3 text-xs"}><Icon name="layout-dashboard" size={14} />پیشخوان وردپرس</a>
          <Link href={("/panel/apps/" + s.id) as never} className={BTN_G + " h-9 px-3 text-xs"}><Icon name="settings-2" size={14} />دامنه، لاگ و منابع</Link>
          <button type="button" onClick={() => setImp(true)} className={BTN_G + " h-9 px-3 text-xs"}><Icon name="upload" size={14} />انتقال از cPanel</button>
          {plan && <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} confirmText={"بسته به " + (plan.id === "eco" ? "توربو" : "اکو") + " تغییر کند؟ سایت چند ثانیه راه‌اندازی مجدد می‌شود."} onClick={async () => { await api.wp.changePlan(s.id, plan.id === "eco" ? "turbo" : "eco"); notify("بسته تغییر کرد", "gauge"); }}>{plan.id === "eco" ? "ارتقا به توربو" : "تغییر به اکو"}</AsyncButton>}
        </div>
      </div>
      {job?.status === "failed" && <pre dir="ltr" className="mt-3 text-left text-[11px] leading-5 font-mono bg-black/40 rounded-xl p-3 max-h-40 overflow-auto whitespace-pre-wrap">{job.output.split("\n").slice(-8).join("\n")}</pre>}
      {imp && <ImportModal site={s} onClose={() => setImp(false)} />}
    </Card>
  );
}

function BackupPicker({ onUploaded }: { onUploaded: (id: string | null) => void }) {
  const [pct, setPct] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  return (
    <div className="rounded-xl border border-dashed border-white/20 p-4">
      <input type="file" accept=".gz,.tgz,.zip,application/gzip,application/zip" aria-label="فایل پشتیبان" className="block w-full text-xs text-white/70 file:me-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-white/10 file:text-white"
        onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          setErr(""); setName(f.name); setPct(0); onUploaded(null);
          try { const r = await api.wp.upload(f, setPct); onUploaded(r.uploadId); setPct(100); } catch (x) { setErr((x as Error).message); setPct(null); }
        }} />
      {pct !== null && <div className="mt-3"><div className="flex justify-between text-[11px] text-white/60 mb-1"><span className="truncate" dir="ltr">{name}</span><span>{fa(pct)}٪</span></div><div className="h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: pct + "%" }} /></div></div>}
      {err && <p className="text-xs text-rose-300 mt-2">{err}</p>}
      <p className="text-[11px] text-white/50 leading-6 mt-2">در cPanel: Backup › Download a Full Account Backup (فایل ‎backup-…tar.gz). یا یک ZIP از پوشه سایت به‌همراه فایل ‎.sql‎ پایگاه داده. حداکثر ۴ گیگ.</p>
    </div>
  );
}

function CreateSite({ initial, onClose }: { initial: WpPlan; onClose: () => void }) {
  const db = useDB(); const { notify } = useApp();
  const [plan, setPlan] = useState(initial);
  const [name, setName] = useState("");
  const [migrate, setMigrate] = useState(false);
  const [upload, setUpload] = useState<string | null>(null);
  const [keepUrl, setKeepUrl] = useState(true);
  return (
    <Modal open onClose={onClose} title="سایت وردپرس جدید" icon="layers" size="max-w-xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {WP_PLANS.map((p) => <button key={p.id} type="button" aria-pressed={plan.id === p.id} onClick={() => setPlan(p)} className={"rounded-xl p-3 text-right border transition " + (plan.id === p.id ? "border-sky-300/60 bg-sky-400/10" : "border-white/10 hover:border-white/25")}><b>{p.name}</b><span className="block text-xs text-white/60 mt-1 tabular">{toman(wpMonthly(p, db.paasPlans))} در ماه</span></button>)}
        </div>
        <Field label="نام سایت" hint={(name || "mysite") + ".gereh.dev — بعداً دامنه خودتان را وصل کنید"}><input dir="ltr" value={name} onChange={(e) => setName(e.target.value.toLowerCase().trim())} placeholder="mysite" className={INPUT + " font-mono text-left"} /></Field>
        <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3 text-sm"><span>انتقال سایت موجود از cPanel</span><Switch on={migrate} onChange={setMigrate} label="انتقال از cPanel" /></div>
        {migrate && <>
          <BackupPicker onUploaded={setUpload} />
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3 text-sm"><span>آدرس سایت را تغییر نده<span className="block text-[11px] text-white/50">اگر دامنه فعلی را به این سایت وصل می‌کنید روشن بگذارید؛ خاموش: آدرس به ‎{name || "mysite"}.gereh.dev‎ تغییر می‌کند</span></span><Switch on={keepUrl} onChange={setKeepUrl} label="حفظ آدرس" /></div>
        </>}
        <AsyncButton disabled={!PAAS_NAME_RE.test(name) || (migrate && !upload)} className={BTN_P + " w-full h-11"} onClick={async () => {
          await api.wp.create({ name, plan: plan.id, uploadId: migrate ? upload! : undefined, keepUrl });
          notify(migrate ? "سایت ساخته شد؛ انتقال پس از آماده شدن شروع می‌شود" : "سایت ساخته شد؛ تا دو دقیقه دیگر آماده است", "rocket"); onClose();
        }}><Icon name="rocket" size={16} />ساخت سایت</AsyncButton>
      </div>
    </Modal>
  );
}

function ImportModal({ site, onClose }: { site: PaasApp; onClose: () => void }) {
  const { notify } = useApp();
  const [upload, setUpload] = useState<string | null>(null);
  const [keepUrl, setKeepUrl] = useState(site.domains.some((d) => d.status === "active"));
  return (
    <Modal open onClose={onClose} title={"انتقال به " + site.name} icon="upload">
      <p className="text-sm text-amber-200/90 leading-7 mb-3">فایل‌ها و پایگاه داده فعلی این سایت با محتوای پشتیبان جایگزین می‌شوند. سایت در طول انتقال (معمولاً چند دقیقه) در دسترس نیست.</p>
      <BackupPicker onUploaded={setUpload} />
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3 text-sm mt-3"><span>آدرس سایت را تغییر نده</span><Switch on={keepUrl} onChange={setKeepUrl} label="حفظ آدرس" /></div>
      <AsyncButton danger disabled={!upload} className="w-full h-11 mt-4" onClick={async () => { await api.wp.import(site.id, upload!, keepUrl); notify("انتقال شروع شد", "upload"); onClose(); }}>شروع انتقال</AsyncButton>
    </Modal>
  );
}
