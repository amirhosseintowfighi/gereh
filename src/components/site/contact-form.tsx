"use client";
import { useState } from "react";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { EMAIL_RE } from "@/lib/format";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { CheckDraw, Field } from "../ui";
import { Select } from "../ui-client";

const EMPTY = { name: "", email: "", dept: "فروش", subject: "", message: "" };

export function ContactForm() {
  const { notify } = useApp();
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof EMPTY) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (f.name.trim().length < 2) x.name = "نام را وارد کنید.";
    if (!EMAIL_RE.test(f.email.trim())) x.email = "ایمیل معتبر نیست.";
    if (f.message.trim().length < 10) x.message = "پیام باید حداقل ۱۰ کاراکتر باشد.";
    setErr(x);
    if (Object.keys(x).length) return;
    setBusy(true);
    // ponytail: no contact endpoint yet — POST /contact (or open a sales ticket) when the backend exists.
    await new Promise((r) => setTimeout(r, 700));
    setBusy(false); setSent(true); notify("پیام شما ارسال شد", "send");
  };
  if (sent) return (
    <div className="py-10 text-center" role="status">
      <div className="w-16 h-16 mx-auto rounded-full acc-bg grid place-items-center"><CheckDraw size={30} /></div>
      <div className="font-black text-lg mt-5">پیام شما رسید</div>
      <p className="text-white/55 text-sm mt-2">پاسخ را به <span className="ltr">{f.email}</span> می‌فرستیم.</p>
      <button type="button" onClick={() => { setSent(false); setF(EMPTY); }} className={BTN_G + " mt-6 px-5 h-10 text-sm"}>ارسال پیام دیگر</button>
    </div>
  );
  return (
    <form onSubmit={submit} noValidate>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="نام و نام خانوادگی" error={err.name}><input name="name" autoComplete="name" value={f.name} onChange={(e) => set("name")(e.target.value)} aria-invalid={!!err.name} className={INPUT} /></Field>
        <Field label="ایمیل" error={err.email}><input name="email" type="email" autoComplete="email" value={f.email} onChange={(e) => set("email")(e.target.value)} aria-invalid={!!err.email} dir="ltr" className={INPUT + " text-left"} placeholder="name@example.com" /></Field>
        <Field label="واحد"><Select value={f.dept} onChange={set("dept")} label="واحد" options={["فروش", "پشتیبانی فنی", "مالی", "همکاری و رسانه"]} /></Field>
        <Field label="موضوع"><input name="subject" value={f.subject} onChange={(e) => set("subject")(e.target.value)} className={INPUT} /></Field>
        <Field className="sm:col-span-2" label="پیام" error={err.message}><textarea name="message" value={f.message} onChange={(e) => set("message")(e.target.value)} aria-invalid={!!err.message} rows={5} className={TEXTAREA} /></Field>
      </div>
      <div className="mt-5 flex justify-end">
        <button type="submit" disabled={busy} className={BTN_P + " px-6 h-11"}>{busy ? <Icon name="loader-circle" size={16} className="animate-spin" /> : <Icon name="send" size={16} />} ارسال پیام</button>
      </div>
    </form>
  );
}
