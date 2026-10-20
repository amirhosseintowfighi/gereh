"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BTN_G, BTN_LG, BTN_MD, BTN_P, INPUT } from "@/lib/cls";
import { fa } from "@/lib/format";
import { appMonthly, engineOf, PAAS_NAME_RE } from "@/lib/paas";
import { PAAS_TEMPLATES, TEMPLATE_CATEGORIES, templateImage, templateTag, VPS_ONLY_APPS, type PaasTemplate, type VpsOnlyApp } from "@/lib/paas-templates";
import { api, useDB } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Field } from "../ui";
import { AsyncButton, CopyText, Modal, PageTitle } from "../ui-client";
import { Cost, PlanPicker, ramLabel } from "./paas-shared";

const match = (q: string, ...s: string[]) => !q || s.some((x) => x.toLowerCase().includes(q.toLowerCase()));

export function AppTemplates() {
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<PaasTemplate | null>(null);
  const [vps, setVps] = useState<VpsOnlyApp | null>(null);
  const list = PAAS_TEMPLATES.filter((t) => (cat === "all" || t.category === cat) && match(q, t.name, t.desc, t.id));
  const vpsList = VPS_ONLY_APPS.filter((t) => (cat === "all" || t.category === cat) && match(q, t.name, t.desc, t.id));
  return (
    <div>
      <PageTitle title="اپ‌های آماده" sub={fa(PAAS_TEMPLATES.length) + " نرم‌افزار متن‌باز محبوب با یک کلیک؛ دیسک، پایگاه داده و رمزها خودکار ساخته می‌شوند."} back={["/panel/apps", "اپ‌ها"]}
        action={<Link href={"/panel/apps/stack" as never} className={BTN_G + BTN_MD}><Icon name="layers" size={16} />قالب ترکیبی</Link>} />
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو: n8n، Nextcloud، Keycloak…" aria-label="جست‌وجوی اپ" className={INPUT + " sm:max-w-xs"} />
        <div className="flex flex-wrap gap-1.5">
          {["all", ...TEMPLATE_CATEGORIES].map((c) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)} className={"h-8 px-3 rounded-lg text-xs transition " + (cat === c ? "bg-white text-black font-bold" : "bg-white/[0.05] text-white/65 hover:text-white")}>{c === "all" ? "همه" : c}</button>)}
        </div>
      </div>
      <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setPick(t)} className="w-full h-full text-right rounded-2xl bg-white/[0.035] border border-white/[0.08] hover:border-white/25 p-5 transition flex flex-col">
              <span className="flex items-center gap-3"><span className="w-10 h-10 rounded-xl tile grid place-items-center"><Icon name={t.icon} size={18} /></span><b>{t.name}</b><span className="ms-auto"><Badge>{t.category}</Badge></span></span>
              <span className="text-xs text-white/60 leading-6 mt-3 flex-1">{t.desc}</span>
              <span className="flex flex-wrap gap-1.5 mt-3 text-[11px] text-white/50">
                <span dir="ltr">{templateTag(t)}</span>
                {(t.versions?.length ?? 0) > 1 && <span>· {fa(t.versions!.length)} نسخه</span>}
                {t.diskGb > 0 && <span>· دیسک {fa(t.diskGb)} گیگ</span>}
                {t.db && <span>· {engineOf(t.db.engine)?.label} مدیریت‌شده</span>}
              </span>
            </button>
          </li>
        ))}
        {vpsList.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setVps(t)} className="w-full h-full text-right rounded-2xl bg-white/[0.02] border border-dashed border-white/[0.12] hover:border-white/25 p-5 transition flex flex-col">
              <span className="flex items-center gap-3"><span className="w-10 h-10 rounded-xl tile grid place-items-center opacity-70"><Icon name={t.icon} size={18} /></span><b>{t.name}</b><span className="ms-auto"><Badge tone="amber">سرور ابری</Badge></span></span>
              <span className="text-xs text-white/55 leading-6 mt-3 flex-1">{t.desc}</span>
              <span className="text-[11px] text-white/50 mt-3">روی سرور ابری بهتر اجرا می‌شود</span>
            </button>
          </li>
        ))}
      </ul>
      {!list.length && !vpsList.length && <p className="text-sm text-white/55 text-center py-10">اپی با این نام پیدا نشد؛ با «قالب ترکیبی» یا ایمیج Docker دلخواه بسازید.</p>}
      {pick && <Create t={pick} onClose={() => setPick(null)} />}
      {vps && (
        <Modal open onClose={() => setVps(null)} title={vps.name + " روی سرور ابری"} icon={vps.icon}>
          <p className="text-sm text-white/70 leading-7">{vps.reason}</p>
          <div className="flex flex-col sm:flex-row gap-2 mt-5">
            <Link href={"/vps" as never} className={BTN_P + BTN_LG + " flex-1"}><Icon name="server" size={16} />سرور ابری{vps.vpsApp ? " با نصب یک‌کلیکی" : ""}</Link>
            <a href={vps.docs} target="_blank" rel="noopener noreferrer" className={BTN_G + BTN_LG + " flex-1"}><Icon name="book-open" size={16} />راهنمای نصب</a>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Create({ t, onClose }: { t: PaasTemplate; onClose: () => void }) {
  const db = useDB(); const router = useRouter(); const { notify } = useApp();
  const plans = db.paasPlans.filter((p) => p.kind === "app");
  const [name, setName] = useState(t.id.replace(/[^a-z0-9-]/g, "") + "-" + (db.paasApps.length + 1));
  const [planId, setPlanId] = useState(plans.some((p) => p.id === t.planId) ? t.planId : plans[0]?.id ?? "");
  const [version, setVersion] = useState(templateTag(t));
  const [done, setDone] = useState<{ appId: string; credentials: { label: string; value: string }[] } | null>(null);
  const plan = plans.find((p) => p.id === planId);
  const dbPlan = t.db ? db.paasPlans.find((p) => p.id === t.db!.planId) : undefined;
  const monthly = (plan ? appMonthly(plan, 1, t.diskGb) : 0) + (dbPlan?.price ?? 0);
  if (done) return (
    <Modal open onClose={() => router.push(("/panel/apps/" + done.appId) as never)} title={t.name + " در حال راه‌اندازی است"} icon="rocket">
      <p className="text-sm text-white/70 leading-7">{t.next}</p>
      {done.credentials.length > 0 && <>
        <p className="text-sm text-amber-200/90 leading-7 mt-3">این اطلاعات فقط یک بار نمایش داده می‌شود؛ همین حالا ذخیره کنید.</p>
        <ul className="space-y-2 mt-3">{done.credentials.map((c) => <li key={c.label} className="rounded-xl bg-black/40 p-3"><span className="block text-[11px] text-white/55 mb-1">{c.label}</span><CopyText text={c.value} className="font-mono text-sm break-all" /></li>)}</ul>
      </>}
      <Link href={("/panel/apps/" + done.appId) as never} className={BTN_P + BTN_LG + " w-full mt-4"}>رفتن به اپ</Link>
    </Modal>
  );
  return (
    <Modal open onClose={onClose} title={"راه‌اندازی " + t.name} icon={t.icon} size="max-w-xl">
      <div className="space-y-4">
        <p className="text-sm text-white/65 leading-7">{t.desc}. <a href={t.docs} target="_blank" rel="noopener noreferrer" className="acc">مستندات</a></p>
        <Field label="نام اپ" hint={"آدرس: " + name + ".gereh.dev"}><input dir="ltr" value={name} onChange={(e) => setName(e.target.value.toLowerCase().trim())} className={INPUT + " font-mono text-left"} /></Field>
        {(t.versions?.length ?? 0) > 1 && (
          <Field label="نسخه">
            <select value={version} onChange={(e) => setVersion(e.target.value)} dir="ltr" className={INPUT + " font-mono text-left"}>
              {t.versions!.map((v) => <option key={v} value={v}>{v}{v === templateTag(t) ? "  (پیشنهادی)" : ""}</option>)}
            </select>
          </Field>
        )}
        <Card pad="p-3" title="اندازه"><PlanPicker plans={plans} value={planId} onChange={setPlanId} label="پلن" /></Card>
        <ul className="text-xs text-white/60 space-y-1.5">
          <li className="flex gap-2"><Icon name="box" size={14} className="acc shrink-0 mt-0.5" />ایمیج رسمی <code dir="ltr">{templateImage(t, version)}</code></li>
          {t.diskGb > 0 && <li className="flex gap-2"><Icon name="hard-drive" size={14} className="acc shrink-0 mt-0.5" />دیسک دائمی {fa(t.diskGb)} گیگ روی <code dir="ltr">{t.diskMount}</code></li>}
          {t.db && dbPlan && <li className="flex gap-2"><Icon name="database" size={14} className="acc shrink-0 mt-0.5" />{engineOf(t.db.engine)?.label} {t.db.version} مدیریت‌شده ({ramLabel(dbPlan.ramMb)}) با پشتیبان روزانه</li>}
          {t.auth && <li className="flex gap-2"><Icon name="lock" size={14} className="acc shrink-0 mt-0.5" />این اپ ورود ندارد؛ پشت رمز عبور پلتفرم قرار می‌گیرد</li>}
        </ul>
        <Cost monthly={monthly} />
        <div className="flex gap-2">
          <AsyncButton disabled={!PAAS_NAME_RE.test(name) || !planId} className={BTN_P + BTN_LG + " flex-1"} onClick={async () => { const r = await api.paas.createFromTemplate(t.id, name, planId, version === templateTag(t) ? undefined : version); notify(t.name + " ساخته شد", "rocket"); setDone(r); }}><Icon name="rocket" size={16} />راه‌اندازی</AsyncButton>
          <button type="button" onClick={onClose} className={BTN_G + BTN_MD}>انصراف</button>
        </div>
      </div>
    </Modal>
  );
}
