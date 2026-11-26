"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { BIZ_GOALS, BIZ_PACKAGES, bizPackage, type BizGoal } from "@/lib/business";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { EMAIL_RE, toEnDigits, toman } from "@/lib/format";
import { api, useDB, useSession } from "@/lib/store";
import { Icon } from "../icon";
import { CheckDraw, Field } from "../ui";

type F = { name: string; business: string; phone: string; email: string; message: string; consent: boolean; hp: string };

/** what the visitor picked: ?pkg= from a package card, else the package a ?goal= points to, else «فروشگاه» */
function fromUrl(q: URLSearchParams) {
  const goal = BIZ_GOALS.find((g) => g.id === q.get("goal"));
  const pkg = bizPackage(q.get("pkg") || "")?.id ?? goal?.pkg ?? "biz-shop";
  return { pkg, goal: (goal?.id ?? "") as BizGoal | "" };
}

/** request for a done-for-you package; sales call back (src/server/rpc/business.ts) */
export function BusinessRequestForm({ source }: { source: string }) {
  const q = useSearchParams();
  const qs = q.toString();
  const url = fromUrl(q);
  // a choice made in the form holds until the visitor clicks another package card (the URL changes)
  const [picked, setPicked] = useState<{ v: string; under: string } | null>(null);
  const pkg = picked && picked.under === qs ? picked.v : url.pkg;
  const session = useSession();
  const me = useDB().users[0];
  const [f, setF] = useState<F>({ name: "", business: "", phone: "", email: "", message: "", consent: false, hp: "" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState("");
  const set = <K extends keyof F>(k: K, v: F[K]) => { setTouched((t) => (t[k] ? t : { ...t, [k]: true })); setF((s) => ({ ...s, [k]: v })); };
  // signed-in customers: prefill from the account (only fields they have not typed in yet)
  const acct = { name: "name", business: "company", phone: "phone", email: "email" } as const;
  const val = (k: keyof typeof acct) => (touched[k] || !session || !me ? f[k] : String(me[acct[k]] ?? ""));
  const goal = BIZ_GOALS.find((g) => g.id === url.goal);
  const chosen = bizPackage(pkg)!;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = { name: val("name").trim(), business: val("business").trim(), phone: toEnDigits(val("phone")).replace(/[\s-]/g, ""), email: val("email").trim() };
    const x: Record<string, string> = {};
    if (d.name.length < 2) x.name = "نام را وارد کنید.";
    if (d.business.length < 2) x.business = "نام کسب‌وکار را وارد کنید.";
    if (!/^(?:\+98|0)\d{10}$/.test(d.phone)) x.phone = "شماره تماس معتبر نیست؛ مثلا ۰۹۱۲۱۲۳۴۵۶۷.";
    if (d.email && !EMAIL_RE.test(d.email)) x.email = "ایمیل معتبر نیست.";
    if (!f.consent) x.consent = "برای ادامه، پذیرش سیاست حریم خصوصی لازم است.";
    setErr(x);
    if (Object.keys(x).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>("#request [aria-invalid=true]")?.focus());
      return;
    }
    setBusy(true);
    try {
      const r = await api.business.request({ ...d, pkg, goal: url.goal, message: f.message.trim(), consent: f.consent, source, hp: f.hp });
      setRef(r.ref);
    } catch (e2) {
      setErr({ form: e2 instanceof Error ? e2.message : "ارسال نشد؛ دوباره تلاش کنید." });
    } finally { setBusy(false); }
  };

  if (ref) return (
    <div className="py-8 text-center" role="status">
      <div className="w-16 h-16 mx-auto rounded-full acc-bg grid place-items-center"><CheckDraw size={30} /></div>
      <h3 className="font-black text-xl mt-5">درخواستتان رسید</h3>
      <p className="text-white/65 mt-2">شماره پیگیری: <b className="ltr inline-block tabular">{ref}</b></p>
      <ol className="mt-8 max-w-md mx-auto text-start space-y-3 text-sm">
        {[["phone-call", "امروز یا حداکثر یک روز کاری بعد با شما تماس می‌گیریم."], ["message-circle", "در تماس، کسب‌وکارتان و چیزی که لازم دارید را می‌پرسیم. رایگان است و تعهدی ندارد."], ["palette", "اگر عکس محصولات یا لوگو دارید، آماده نگه دارید؛ کار را سریع‌تر می‌کند."]].map(([ic, t]) => (
          <li key={t} className="flex gap-3 items-start"><Icon name={ic} size={18} className="acc shrink-0 mt-0.5" /><span className="text-white/75 leading-7">{t}</span></li>
        ))}
      </ol>
      <Link href="/" className={BTN_G + " mt-8 h-10 px-5 text-sm"}>بازگشت به صفحه اصلی</Link>
    </div>
  );

  return (
    <form onSubmit={submit} noValidate aria-label="درخواست بسته کسب‌وکار" className="space-y-6">
      <div aria-hidden="true" className="sr-only"><label>وب‌سایت شخصی<input tabIndex={-1} autoComplete="off" value={f.hp} onChange={(e) => set("hp", e.target.value)} /></label></div>

      <fieldset>
        <legend className="font-extrabold mb-3">کدام بسته؟</legend>
        {goal && goal.pkg && <p className="text-sm text-white/60 mb-3">برای «{goal.title}» بسته «{bizPackage(goal.pkg)!.name}» را پیشنهاد می‌کنیم؛ اگر مطمئن نیستید، در تماس با هم انتخاب می‌کنیم.</p>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" role="radiogroup" aria-label="بسته">
          {BIZ_PACKAGES.map((p) => {
            const on = p.id === pkg;
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setPicked({ v: p.id, under: qs })}
                className={"rounded-xl p-3 text-start border transition " + (on ? "bg-sky-400/15 border-sky-300/50" : "bg-white/[0.03] border-white/[0.12] hover:border-white/25")}>
                <span className="font-bold text-sm flex items-center gap-1.5">{on && <Icon name="check" size={14} className="acc" />}{p.name}</span>
                <span className="block text-[11px] text-white/55 mt-1">{p.quote ? "قیمت بعد از جلسه" : "ماهانه " + toman(p.monthly)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="نام شما" error={err.name}><input autoComplete="name" value={val("name")} onChange={(e) => set("name", e.target.value)} aria-invalid={!!err.name} className={INPUT} /></Field>
        <Field label="نام کسب‌وکار" error={err.business}><input autoComplete="organization" value={val("business")} onChange={(e) => set("business", e.target.value)} aria-invalid={!!err.business} placeholder="مثلا سوپرمارکت ستاره" className={INPUT} /></Field>
        <Field label="شماره موبایل" hint="با همین شماره تماس می‌گیریم." error={err.phone}><input type="tel" autoComplete="tel" inputMode="tel" value={val("phone")} onChange={(e) => set("phone", e.target.value)} aria-invalid={!!err.phone} dir="ltr" placeholder="0912 123 4567" className={INPUT + " text-start"} /></Field>
        <Field label="ایمیل (اختیاری)" error={err.email}><input type="email" autoComplete="email" value={val("email")} onChange={(e) => set("email", e.target.value)} aria-invalid={!!err.email} dir="ltr" className={INPUT + " text-start"} /></Field>
      </div>
      <Field label="چیزی که بخواهید بگویید (اختیاری)" hint="مثلا: چه می‌فروشید، صفحه اینستاگرام دارید یا نه، دامنه دارید یا نه.">
        <textarea rows={3} maxLength={2000} value={f.message} onChange={(e) => set("message", e.target.value)} className={TEXTAREA} />
      </Field>
      <label className="flex items-start gap-3 text-sm text-white/75 cursor-pointer">
        <input type="checkbox" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} aria-invalid={!!err.consent} aria-describedby={err.consent ? "e-biz-consent" : undefined} className="mt-1 w-4 h-4 accent-sky-300" />
        <span>با <Link href="/privacy" className="acc underline underline-offset-4">سیاست حریم خصوصی</Link> موافقم؛ اطلاعاتم فقط برای پاسخ به همین درخواست استفاده می‌شود.</span>
      </label>
      {err.consent && <p id="e-biz-consent" role="alert" className="text-xs text-rose-300">{err.consent}</p>}
      {err.form && <div role="alert" className="text-sm text-rose-300 flex gap-1.5"><Icon name="circle-alert" size={16} />{err.form}</div>}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs text-white/55 flex items-center gap-1.5"><Icon name="lock" size={14} />{chosen.quote ? "جلسه آشنایی رایگان است." : "تا وقتی در تماس تأیید نکنید، پولی پرداخت نمی‌کنید."}</p>
        <button type="submit" disabled={busy} className={BTN_P + " px-7 h-12"}>{busy ? <Icon name="loader-circle" size={17} className="animate-spin" /> : <Icon name="phone-call" size={17} />} با من تماس بگیرید</button>
      </div>
    </form>
  );
}
