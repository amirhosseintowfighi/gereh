"use client";
import Link from "next/link";
import { useState } from "react";
import { BUDGETS, COMPANY_SIZES, COMPANY_STAGES, DEVOPS_PACKAGES, DEVOPS_SERVICES, INFRA_OPTIONS, URGENCIES } from "@/content/devops";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { EMAIL_RE, toEnDigits } from "@/lib/format";
import { api, useDB, useSession } from "@/lib/store";
import { Icon } from "../icon";
import { CheckDraw, Field } from "../ui";
import { Select } from "../ui-client";

type F = {
  name: string; company: string; role: string; email: string; phone: string; website: string;
  size: string; stage: string; infra: string[]; services: string[]; pkg: string; budget: string; urgency: string;
  needsNda: boolean; message: string; consent: boolean; hp: string;
};
const PKG_OPTIONS = [{ value: "", label: "هنوز نمی‌دانم؛ پیشنهاد بدهید" }, ...DEVOPS_PACKAGES.map((p) => ({ value: p.id, label: "بسته " + p.name })), { value: "audit", label: "ممیزی زیرساخت" }, { value: "project", label: "پروژه با دامنه مشخص" }, { value: "hours", label: "ساعت مشاوره" }];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick}
      className={"min-h-10 px-3.5 py-2 rounded-xl text-sm text-right inline-flex items-center gap-2 border transition " + (on ? "bg-sky-400/15 border-sky-300/50 text-white" : "bg-white/[0.03] border-white/[0.12] text-white/70 hover:text-white hover:border-white/25")}>
      <span aria-hidden="true" className={"w-4 h-4 rounded-[5px] border grid place-items-center shrink-0 " + (on ? "bg-sky-300 border-sky-300 text-slate-900" : "border-white/30")}>{on && <Icon name="check" size={11} sw={3} />}</span>
      {children}
    </button>
  );
}

/** consultation request: qualifies the lead (company, infra, services, budget, urgency) in one pass */
export function DevopsRequestForm({ preset, source }: { preset?: string; source: string }) {
  const session = useSession();
  const me = useDB().users[0];
  const [f, setF] = useState<F>({ name: "", company: "", role: "", email: "", phone: "", website: "", size: "", stage: "", infra: [], services: preset ? [preset] : [], pkg: "", budget: "", urgency: "", needsNda: false, message: "", consent: false, hp: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const set = <K extends keyof F>(k: K, v: F[K]) => { setTouched((t) => (t[k] ? t : { ...t, [k]: true })); setF((s) => ({ ...s, [k]: v })); };
  const toggle = (k: "infra" | "services", v: string) => setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));
  // signed-in customers: prefill from the account (only fields they have not typed in yet)
  const val = (k: "name" | "email" | "phone" | "company") => (touched[k] || !session || !me ? f[k] : String(me[k] ?? ""));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = { ...f, name: val("name").trim(), email: val("email").trim(), phone: toEnDigits(val("phone")).replace(/[\s-]/g, ""), company: val("company").trim() };
    const x: Record<string, string> = {};
    if (d.name.length < 2) x.name = "نام را وارد کنید.";
    if (d.company.length < 2) x.company = "نام شرکت یا محصول را وارد کنید.";
    if (!EMAIL_RE.test(d.email)) x.email = "ایمیل معتبر نیست.";
    if (!/^(?:\+98|0)\d{10}$/.test(d.phone)) x.phone = "شماره تماس معتبر نیست.";
    if (!d.size) x.size = "اندازه تیم را انتخاب کنید.";
    if (!d.stage) x.stage = "مرحله کسب‌وکار را انتخاب کنید.";
    if (!d.infra.length) x.infra = "حداقل یک گزینه را انتخاب کنید.";
    if (!d.services.length) x.services = "حداقل یک خدمت را انتخاب کنید.";
    if (!d.budget) x.budget = "بازه بودجه را انتخاب کنید.";
    if (!d.urgency) x.urgency = "زمان شروع را انتخاب کنید.";
    if (d.message.trim().length < 20) x.message = "کمی بیشتر توضیح دهید (حداقل ۲۰ نویسه).";
    if (!d.consent) x.consent = "برای ادامه، پذیرش سیاست حریم خصوصی لازم است.";
    setErr(x);
    if (Object.keys(x).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid=true], [data-invalid=true]")?.focus());
      return;
    }
    setBusy(true);
    try {
      const r = await api.devops.request({ ...d, message: d.message.trim(), source });
      setRef(r.ref);
    } catch (e2) {
      setErr({ form: e2 instanceof Error ? e2.message : "ارسال نشد؛ دوباره تلاش کنید." });
    } finally { setBusy(false); }
  };

  if (ref) return (
    <div className="py-8 text-center" role="status">
      <div className="w-16 h-16 mx-auto rounded-full acc-bg grid place-items-center"><CheckDraw size={30} /></div>
      <h3 className="font-black text-xl mt-5">درخواست شما ثبت شد</h3>
      <p className="text-white/65 mt-2">شماره پیگیری: <b className="ltr inline-block tabular">{ref}</b></p>
      <ol className="mt-8 max-w-md mx-auto text-right space-y-3 text-sm">
        {[["mail", "خلاصه درخواست به ایمیل شما فرستاده شد."], ["phone", f.urgency.startsWith("فوری") ? "به‌خاطر فوریت، همین امروز تماس می‌گیریم." : "ظرف یک روز کاری برای هماهنگی جلسه تماس می‌گیریم."], ["file-check", f.needsNda ? "پیش از جلسه، قرارداد محرمانگی برایتان ارسال می‌شود." : "جلسه آشنایی ۴۵ دقیقه و رایگان است."]].map(([ic, t]) => (
          <li key={t} className="flex gap-3 items-start"><Icon name={ic} size={18} className="acc shrink-0 mt-0.5" /><span className="text-white/75 leading-7">{t}</span></li>
        ))}
      </ol>
      <Link href="/kb" className={BTN_G + " mt-8 h-10 px-5 text-sm"}>تا آن موقع: راهنماها</Link>
    </div>
  );

  const label = (t: string, opt = false) => t + (opt ? " (اختیاری)" : "");
  return (
    <form onSubmit={submit} noValidate aria-label="درخواست مشاوره دواپس" className="space-y-8">
      {/* honeypot: hidden from people and assistive tech */}
      <div aria-hidden="true" className="sr-only"><label>وب‌سایت شخصی<input tabIndex={-1} autoComplete="off" value={f.hp} onChange={(e) => set("hp", e.target.value)} /></label></div>

      <fieldset className="space-y-4">
        <legend className="font-extrabold mb-4 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-white/10 grid place-items-center text-xs">۱</span>شما و شرکتتان</legend>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="نام و نام خانوادگی" error={err.name}><input autoComplete="name" value={val("name")} onChange={(e) => set("name", e.target.value)} aria-invalid={!!err.name} className={INPUT} /></Field>
          <Field label={label("سمت", true)}><input autoComplete="organization-title" value={f.role} onChange={(e) => set("role", e.target.value)} placeholder="مثلا CTO یا مدیر فنی" className={INPUT} /></Field>
          <Field label="نام شرکت یا محصول" error={err.company}><input autoComplete="organization" value={val("company")} onChange={(e) => set("company", e.target.value)} aria-invalid={!!err.company} className={INPUT} /></Field>
          <Field label={label("وب‌سایت", true)}><input inputMode="url" value={f.website} onChange={(e) => set("website", e.target.value)} dir="ltr" placeholder="example.com" className={INPUT + " text-left"} /></Field>
          <Field label="ایمیل کاری" error={err.email}><input type="email" autoComplete="email" value={val("email")} onChange={(e) => set("email", e.target.value)} aria-invalid={!!err.email} dir="ltr" className={INPUT + " text-left"} /></Field>
          <Field label="شماره تماس" error={err.phone}><input type="tel" autoComplete="tel" value={val("phone")} onChange={(e) => set("phone", e.target.value)} aria-invalid={!!err.phone} dir="ltr" placeholder="0912 123 4567" className={INPUT + " text-left"} /></Field>
          <Field label="اندازه تیم" error={err.size}><div data-invalid={!!err.size} tabIndex={-1}><Select label="اندازه تیم" value={f.size} onChange={(v) => set("size", v)} options={[{ value: "", label: "انتخاب کنید" }, ...COMPANY_SIZES.map((v) => ({ value: v, label: v }))]} /></div></Field>
          <Field label="مرحله کسب‌وکار" error={err.stage}><div data-invalid={!!err.stage} tabIndex={-1}><Select label="مرحله کسب‌وکار" value={f.stage} onChange={(v) => set("stage", v)} options={[{ value: "", label: "انتخاب کنید" }, ...COMPANY_STAGES.map((v) => ({ value: v, label: v }))]} /></div></Field>
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-extrabold mb-4 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-white/10 grid place-items-center text-xs">۲</span>به چه کمکی نیاز دارید؟</legend>
        <div className="flex flex-wrap gap-2" data-invalid={!!err.services} tabIndex={-1} aria-describedby={err.services ? "e-services" : undefined}>
          {DEVOPS_SERVICES.map((s) => <Chip key={s.slug} on={f.services.includes(s.slug)} onClick={() => toggle("services", s.slug)}>{s.title}</Chip>)}
        </div>
        {err.services && <p id="e-services" role="alert" className="text-xs text-rose-300 mt-2">{err.services}</p>}
        <h3 className="text-sm text-white/70 mt-6 mb-3">زیرساخت فعلی شما کجاست؟</h3>
        <div className="flex flex-wrap gap-2" data-invalid={!!err.infra} tabIndex={-1} aria-describedby={err.infra ? "e-infra" : undefined}>
          {INFRA_OPTIONS.map((o) => <Chip key={o} on={f.infra.includes(o)} onClick={() => toggle("infra", o)}>{o}</Chip>)}
        </div>
        {err.infra && <p id="e-infra" role="alert" className="text-xs text-rose-300 mt-2">{err.infra}</p>}
        <div className="grid sm:grid-cols-3 gap-4 mt-6">
          <Field label="نوع همکاری"><Select label="نوع همکاری" value={f.pkg} onChange={(v) => set("pkg", v)} options={PKG_OPTIONS} /></Field>
          <Field label="بودجه تقریبی" error={err.budget}><div data-invalid={!!err.budget} tabIndex={-1}><Select label="بودجه تقریبی" value={f.budget} onChange={(v) => set("budget", v)} options={[{ value: "", label: "انتخاب کنید" }, ...BUDGETS.map((v) => ({ value: v, label: v }))]} /></div></Field>
          <Field label="زمان شروع" error={err.urgency}><div data-invalid={!!err.urgency} tabIndex={-1}><Select label="زمان شروع" value={f.urgency} onChange={(v) => set("urgency", v)} options={[{ value: "", label: "انتخاب کنید" }, ...URGENCIES.map((v) => ({ value: v, label: v }))]} /></div></Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-extrabold mb-4 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-white/10 grid place-items-center text-xs">۳</span>جزئیات</legend>
        <Field label="وضعیت فعلی و هدفتان" hint="مثلا: پشته فنی، تعداد سرورها، مشکل‌های پرتکرار، هدف سه ماه آینده. لطفاً رمز یا اطلاعات محرمانه ننویسید." error={err.message}>
          <textarea rows={5} maxLength={4000} value={f.message} onChange={(e) => set("message", e.target.value)} aria-invalid={!!err.message} className={TEXTAREA} />
        </Field>
        <label className="flex items-start gap-3 text-sm text-white/75 cursor-pointer">
          <input type="checkbox" checked={f.needsNda} onChange={(e) => set("needsNda", e.target.checked)} className="mt-1 w-4 h-4 accent-sky-300" />
          پیش از جلسه، قرارداد محرمانگی (NDA) امضا شود.
        </label>
        <label className="flex items-start gap-3 text-sm text-white/75 cursor-pointer">
          <input type="checkbox" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} aria-invalid={!!err.consent} aria-describedby={err.consent ? "e-consent" : undefined} className="mt-1 w-4 h-4 accent-sky-300" />
          <span>با <Link href="/privacy" className="acc underline underline-offset-4">سیاست حریم خصوصی</Link> موافقم؛ اطلاعات فقط برای پاسخ به همین درخواست استفاده می‌شود.</span>
        </label>
        {err.consent && <p id="e-consent" role="alert" className="text-xs text-rose-300">{err.consent}</p>}
      </fieldset>

      {err.form && <div role="alert" className="text-sm text-rose-300 flex gap-1.5"><Icon name="circle-alert" size={16} />{err.form}</div>}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs text-white/55 flex items-center gap-1.5"><Icon name="lock" size={14} />جلسه آشنایی رایگان است و تعهدی ایجاد نمی‌کند.</p>
        <button type="submit" disabled={busy} className={BTN_P + " px-7 h-12"}>{busy ? <Icon name="loader-circle" size={17} className="animate-spin" /> : <Icon name="send" size={17} />} ارسال درخواست</button>
      </div>
    </form>
  );
}
