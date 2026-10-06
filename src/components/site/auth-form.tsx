"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BTN_G, BTN_P, INPUT } from "@/lib/cls";
import { EMAIL_RE, PHONE_RE, fa, strength, toEnDigits } from "@/lib/format";
import { api, useSession, type Session } from "@/lib/store";
import { safeNext } from "@/lib/url";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Field } from "../ui";
import { AsyncButton, OtpInput, StrengthBar, Tabs } from "../ui-client";


export function AuthForm() {
  const { notify } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const session = useSession();
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ id: "", password: "", name: "", email: "", phone: "", agree: false });
  const [show, setShow] = useState(false);
  const [otpStep, setOtpStep] = useState(0);
  const [code, setCode] = useState("");
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState("");
  const [sentForgot, setSentForgot] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  useEffect(() => { if (!timer) return; const t = setTimeout(() => setTimer((x) => x - 1), 1000); return () => clearTimeout(t); }, [timer]);
  const dest = (s: Session) => next || (s.role === "admin" ? "/admin" : "/panel");
  // already signed in → go straight to the panel
  useEffect(() => { if (session) router.replace(dest(session) as never); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (s: Session) => { notify("خوش آمدید، " + s.name, "user-round"); router.replace(dest(s) as never); };
  const wrap = (fn: () => Promise<void>) => async () => { setError(""); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "خطایی رخ داد"); } };
  const switchMode = (m: string) => { setMode(m); setOtpStep(0); setError(""); };
  const phone = toEnDigits(f.phone.trim());
  const errorLine = error ? <div role="alert" className="text-xs text-rose-300 flex gap-1.5"><Icon name="circle-alert" size={14} />{error}</div> : null;

  if (mode === "forgot") return (
    <div className="fade-in">
      <button type="button" onClick={() => { switchMode("login"); setSentForgot(false); }} className="text-xs text-white/50 hover:text-white flex items-center gap-1 mb-6"><Icon name="chevron-right" size={14} />بازگشت به ورود</button>
      <h1 className="text-3xl font-black">بازیابی رمز عبور</h1>
      <p className="text-white/50 text-sm mt-2 leading-7">ایمیل حساب را وارد کنید تا لینک بازیابی را بفرستیم.</p>
      {sentForgot ? <div role="status" className="mt-8 rounded-2xl bg-emerald-400/10 border border-emerald-300/25 p-5 text-sm text-emerald-100 leading-7 flex gap-3"><Icon name="circle-check" size={20} />لینک بازیابی به {f.email} ارسال شد. پوشه اسپم را هم بررسی کنید.</div> : (
        <form className="mt-8 space-y-4" onSubmit={(e) => e.preventDefault()}>
          <Field label="ایمیل"><input type="email" autoComplete="email" value={f.email} onChange={set("email")} dir="ltr" className={INPUT + " text-left h-12"} placeholder="name@example.com" /></Field>
          {errorLine}
          <AsyncButton onClick={wrap(async () => { await api.auth.forgot(f.email.trim()); setSentForgot(true); })} className={BTN_P + " w-full h-12"}>ارسال لینک بازیابی</AsyncButton>
        </form>
      )}
    </div>
  );

  return (
    <div>
      <h1 className="text-3xl font-black">{mode === "register" ? "ساخت حساب گره" : "ورود به گره"}</h1>
      <p className="text-white/50 text-sm mt-2">{mode === "register" ? "ثبت‌نام رایگان است و کمتر از یک دقیقه طول می‌کشد." : "خوش برگشتید."}</p>
      <div className="mt-7"><Tabs full value={mode} onChange={switchMode} label="روش ورود" options={[{ id: "login", label: "ورود" }, { id: "otp", label: "ورود با کد" }, { id: "register", label: "ثبت‌نام" }]} /></div>
      <form key={mode + otpStep} className="fade-in mt-7 space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
        {mode === "login" && <>
          <Field label="ایمیل یا موبایل"><input name="username" value={f.id} onChange={set("id")} dir="ltr" autoComplete="username" className={INPUT + " text-left h-12"} placeholder="name@example.com" /></Field>
          <Field label="رمز عبور">
            <div className="relative">
              <input name="password" type={show ? "text" : "password"} value={f.password} onChange={set("password")} dir="ltr" autoComplete="current-password" className={INPUT + " text-left h-12 pl-11"} />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center text-white/55 hover:text-white" aria-label={show ? "پنهان کردن رمز" : "نمایش رمز"} aria-pressed={show}><Icon name={show ? "eye-off" : "eye"} size={17} /></button>
            </div>
          </Field>
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-2 text-white/60 cursor-pointer"><input type="checkbox" className="accent-white" defaultChecked /> مرا به خاطر بسپار</label>
            <button type="button" onClick={() => switchMode("forgot")} className="text-white/60 hover:text-white">فراموشی رمز</button>
          </div>
          {errorLine}
          <AsyncButton onClick={wrap(async () => done(await api.auth.login(toEnDigits(f.id.trim()), f.password)))} className={BTN_P + " w-full h-12"}><Icon name="log-in" size={17} /> ورود</AsyncButton>
        </>}
        {mode === "otp" && (otpStep === 0 ? <>
          <Field label="شماره موبایل" hint="کد یک‌بارمصرف پیامک می‌شود."><input name="tel" type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} dir="ltr" inputMode="tel" className={INPUT + " text-left h-12 tabular"} placeholder="09121234567" /></Field>
          {errorLine}
          <AsyncButton onClick={wrap(async () => { await api.auth.sendOtp(phone); setOtpStep(1); setTimer(90); setCode(""); })} className={BTN_P + " w-full h-12"}><Icon name="smartphone" size={17} /> دریافت کد</AsyncButton>
        </> : <>
          <p className="text-sm text-white/60 text-center">کد ارسال‌شده به <span className="ltr tabular text-white">{phone}</span> را وارد کنید.</p>
          <OtpInput value={code} onChange={setCode} />
          <div className="text-center text-xs text-white/55" aria-live="polite">{timer > 0 ? "ارسال دوباره تا " + fa(timer) + " ثانیه دیگر" : (
            <AsyncButton className="text-white/80 hover:text-white" onClick={wrap(async () => { await api.auth.sendOtp(phone); setTimer(90); notify("کد دوباره ارسال شد", "smartphone"); })}>ارسال دوباره کد</AsyncButton>
          )}</div>
          {errorLine}
          <AsyncButton onClick={wrap(async () => done(await api.auth.verifyOtp(phone, code)))} className={BTN_P + " w-full h-12"}>تأیید و ورود</AsyncButton>
          <button type="button" onClick={() => setOtpStep(0)} className="w-full text-xs text-white/50 hover:text-white">تغییر شماره</button>
        </>)}
        {mode === "register" && <>
          <Field label="نام و نام خانوادگی"><input name="name" autoComplete="name" value={f.name} onChange={set("name")} className={INPUT + " h-12"} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ایمیل"><input name="email" type="email" autoComplete="email" value={f.email} onChange={set("email")} dir="ltr" className={INPUT + " text-left h-12"} /></Field>
            <Field label="موبایل"><input name="tel" type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} dir="ltr" inputMode="tel" className={INPUT + " text-left h-12 tabular"} placeholder="0912…" /></Field>
          </div>
          <Field label="رمز عبور"><input name="new-password" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} dir="ltr" className={INPUT + " text-left h-12"} /><StrengthBar value={f.password} /></Field>
          <label className="flex items-start gap-2.5 text-xs text-white/60 cursor-pointer leading-6"><input type="checkbox" checked={f.agree} onChange={set("agree")} className="accent-white mt-1" /><span><Link href="/terms" target="_blank" className="underline underline-offset-4 hover:text-white">قوانین و حریم خصوصی</Link> گره را خوانده‌ام و می‌پذیرم.</span></label>
          {errorLine}
          <AsyncButton onClick={wrap(async () => {
            if (f.name.trim().length < 2) throw new Error("نام را وارد کنید.");
            if (!EMAIL_RE.test(f.email.trim())) throw new Error("ایمیل معتبر نیست.");
            if (!PHONE_RE.test(phone)) throw new Error("شماره موبایل معتبر نیست.");
            if (strength(f.password) < 2) throw new Error("رمز ضعیف است؛ حداقل ۸ کاراکتر با عدد یا حروف بزرگ.");
            if (!f.agree) throw new Error("برای ثبت‌نام، قوانین را بپذیرید.");
            done(await api.auth.register({ name: f.name.trim(), email: f.email.trim(), phone, password: f.password }));
          })} className={BTN_P + " w-full h-12"}><Icon name="user-plus" size={17} /> ساخت حساب</AsyncButton>
        </>}
      </form>
      <div className="mt-8 rounded-2xl border border-dashed border-white/15 p-4">
        <div className="text-[11px] text-white/55 mb-3 text-center">نسخه نمایشی: ورود سریع بدون رمز</div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => done(api.auth.demo("user"))} className={BTN_G + " h-10 text-xs"}><Icon name="user-round" size={15} /> پنل کاربر</button>
          <button type="button" onClick={() => done(api.auth.demo("admin"))} className={BTN_G + " h-10 text-xs"}><Icon name="shield-half" size={15} /> پنل مدیریت</button>
        </div>
      </div>
    </div>
  );
}
