"use client";
import { useEffect, useState } from "react";
import { BTN_D, BTN_G, BTN_P, BTN_SM, INPUT, TEXTAREA } from "@/lib/cls";
import { fa, toEnDigits, toman } from "@/lib/format";
import { api } from "@/lib/store";
import { ALWAYS_ESCALATE, MAX_AI_REPLIES, SUPPORT_CATEGORIES, type SupportAiMetrics, type SupportAiRunView, type SupportAiSettings, type SupportCategory } from "@/lib/support-ai";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field, type Tone } from "../ui";
import { AsyncButton, Select, StatCard, Switch } from "../ui-client";

const RUN: Record<SupportAiRunView["status"], [Tone, string]> = {
  draft: ["amber", "پیش‌نویس در انتظار"], auto: ["violet", "ارسال خودکار"], sent: ["green", "ارسال توسط کارشناس"], rejected: ["red", "رد شد"],
  superseded: ["gray", "جایگزین شد"], skipped: ["gray", "اجرا نشد"], error: ["red", "خطا"],
};
const pct = (x: number) => fa(Math.round(x * 100)) + "٪";
const catLabel = (c: string) => SUPPORT_CATEGORIES[c as SupportCategory] ?? "—";
const dur = (m: number | null) => (m === null ? "—" : m >= 60 ? fa(Math.round(m / 6) / 10, 1) + " ساعت" : fa(m) + " دقیقه");

/** the AI draft of a ticket (or live chat) for staff: diagnosis, confidence and one-click send / edit and send / reject */
export function AiDraftPanel({ ticketId, chatId, version }: { ticketId?: string; chatId?: string; version: string }) {
  const { notify } = useApp();
  const [runs, setRuns] = useState<SupportAiRunView[] | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = () => api.supportAi.runs({ ticketId, chatId }).then((r) => { setRuns(r); setError(""); }, (e: Error) => setError(e.message));
  useEffect(() => {
    let live = true;
    api.supportAi.runs({ ticketId, chatId }).then((r) => { if (live) { setRuns(r); setError(""); } }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [ticketId, chatId, version]);
  if (error) return <Card title="پشتیبانی AI" icon="sparkles"><p className="text-sm text-white/60">{error}</p></Card>;
  if (!runs || !runs.length) return null;
  const draft = runs.find((r) => r.status === "draft");
  const history = runs.filter((r) => r !== draft);
  const done = async (msg: string) => { setEdit(null); await load(); notify(msg, "sparkles"); };
  return (
    <Card title="پشتیبانی AI" icon="sparkles" action={draft ? <Badge tone="amber" dot>پیش‌نویس در انتظار بررسی</Badge> : undefined}>
      {draft && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={ALWAYS_ESCALATE.includes(draft.category as SupportCategory) ? "red" : "blue"}>{catLabel(draft.category)}</Badge>
            <Badge tone={draft.confidence >= 0.8 ? "green" : draft.confidence >= 0.6 ? "amber" : "red"}>اطمینان {pct(draft.confidence)}</Badge>
            {draft.needsHuman && <Badge tone="red">نیاز به پشتیبان انسانی</Badge>}
            {draft.simulated && <Badge>قاعده‌محور</Badge>}
            <span className="text-white/50">{draft.at}</span>
          </div>
          {draft.escalation && <p className="text-xs text-amber-200/90 leading-6 flex gap-1.5"><Icon name="info" size={13} className="shrink-0 mt-1" />{draft.escalation}</p>}
          {draft.internalNote && (
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-3">
              <div className="text-[11px] font-bold text-white/60 mb-1">یادداشت داخلی (فقط کارشناسان)</div>
              <p className="text-sm text-white/75 leading-7 whitespace-pre-wrap break-words">{draft.internalNote}</p>
            </div>
          )}
          {draft.suggestedActions.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-white/60 mb-1">اقدام‌های پیشنهادی (خودکار اجرا نمی‌شوند)</div>
              <ul className="space-y-1 text-sm text-white/75 list-disc pr-5">{draft.suggestedActions.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}
          <div>
            <div className="text-[11px] font-bold text-white/60 mb-1">پاسخ پیشنهادی به مشتری</div>
            {edit === null
              ? <p className="text-sm text-white/85 leading-7 whitespace-pre-wrap break-words rounded-xl bg-violet-400/[0.06] border border-violet-300/20 p-3">{draft.reply}</p>
              : <textarea value={edit} onChange={(e) => setEdit(e.target.value)} rows={8} maxLength={5000} aria-label="ویرایش پاسخ" className={TEXTAREA} />}
          </div>
          <div className="flex flex-wrap gap-2">
            {edit === null ? <>
              <AsyncButton className={BTN_P + BTN_SM} onClick={async () => { await api.supportAi.send(draft.id); await done("پاسخ ارسال شد"); }}><Icon name="send" size={14} />ارسال</AsyncButton>
              <button type="button" className={BTN_G + BTN_SM} onClick={() => setEdit(draft.reply)}><Icon name="pencil" size={14} />ویرایش و ارسال</button>
              <AsyncButton className={BTN_D + BTN_SM} confirmText="پیش‌نویس رد شود؟" onClick={async () => { await api.supportAi.reject(draft.id); await done("پیش‌نویس رد شد"); }}><Icon name="x" size={14} />رد</AsyncButton>
            </> : <>
              <AsyncButton className={BTN_P + BTN_SM} onClick={async () => { if (edit.trim().length < 2) throw new Error("متن پاسخ خالی است."); await api.supportAi.send(draft.id, edit.trim()); await done("پاسخ ویرایش‌شده ارسال شد"); }}><Icon name="send" size={14} />ارسال</AsyncButton>
              <button type="button" className={BTN_G + BTN_SM} onClick={() => setEdit(null)}>انصراف</button>
            </>}
          </div>
        </div>
      )}
      {history.length > 0 && (
        <details className={draft ? "mt-5" : ""} open={!draft}>
          <summary className="text-xs text-white/60 cursor-pointer">سابقه اجراها ({fa(history.length)})</summary>
          <ul className="mt-2 space-y-2">
            {history.map((r) => (
              <li key={r.id} className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={RUN[r.status][0]}>{RUN[r.status][1]}</Badge>{r.category && <span>{catLabel(r.category)}</span>}{r.category && <span className="text-white/50">اطمینان {pct(r.confidence)}</span>}<span className="text-white/50">{r.at}</span>{r.decidedBy && <span className="text-white/50">{r.decidedBy}{r.edited ? " (ویرایش‌شده)" : ""}</span>}</div>
                {r.escalation && <p className="text-white/55 leading-6 mt-1">{r.escalation}</p>}
                {r.internalNote && <p className="text-white/65 leading-6 mt-1">{r.internalNote}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

/** the admin support page: what the AI handled and what it cost the platform */
export function SupportAiMetricsCard() {
  const [m, setM] = useState<SupportAiMetrics | null>(null);
  const [days, setDays] = useState("30");
  useEffect(() => {
    let live = true;
    api.supportAi.metrics(+days).then((r) => { if (live) setM(r); }, () => { if (live) setM(null); });
    return () => { live = false; };
  }, [days]);
  return (
    <Card title="پشتیبانی AI" icon="sparkles" className="mb-4" action={<Select className="w-32" label="بازه" value={days} onChange={setDays} options={[{ value: "7", label: "۷ روز" }, { value: "30", label: "۳۰ روز" }, { value: "90", label: "۹۰ روز" }]} />}>
      {!m ? <div aria-busy="true" className="grid place-items-center py-6"><Icon name="loader-circle" size={22} className="animate-spin text-white/50" /></div> : m.handled === 0 && m.spendMonth === 0 ? <Empty icon="sparkles" title="هنوز تیکتی به هوش مصنوعی نرسیده" text="حالت و قواعد را در «تنظیمات سیستم ← پشتیبانی AI» تعیین کنید." /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon="bot" label="رسیدگی AI" value={m.handled} sub={fa(m.tickets) + " تیکت"} />
          <StatCard icon="send" label="ارسال خودکار / پیش‌نویس ارسال‌شده" value={fa(m.autoSent) + " / " + fa(m.draftsSent)} sub={fa(m.rejected) + " رد، " + fa(m.pending) + " در انتظار"} />
          <StatCard icon="headset" label="ارجاع به انسان" value={fa(m.escalationRate, 1) + "٪"} sub={fa(m.escalated) + " تیکت"} />
          <StatCard icon="circle-check" label="«حل شد» پس از پاسخ AI" value={fa(m.resolvedRate, 1) + "٪"} sub={fa(m.resolved) + " تیکت"} tone={m.resolvedRate >= 50 ? "up" : ""} />
          <StatCard icon="timer" label="میانگین اولین پاسخ با AI" value={dur(m.avgFirstMinAi)} />
          <StatCard icon="clock" label="میانگین اولین پاسخ بدون AI" value={dur(m.avgFirstMinHuman)} />
          <StatCard icon="wallet" label="هزینه امروز" value={toman(m.spendToday)} sub={m.dailyCap ? "سقف روزانه " + toman(m.dailyCap) : "بدون سقف"} tone={m.dailyCap && m.spendToday >= m.dailyCap ? "down" : ""} />
          <StatCard icon="wallet" label="هزینه این ماه" value={toman(m.spendMonth)} sub="هزینه پلتفرم؛ از مشتری کسر نمی‌شود" />
        </div>
      )}
    </Card>
  );
}

const MODES: { value: SupportAiSettings["mode"]; label: string }[] = [{ value: "off", label: "خاموش" }, { value: "draft", label: "پیش‌نویس برای کارشناس" }, { value: "auto", label: "پاسخ خودکار (با قواعد)" }];
const ALLOWABLE = (Object.keys(SUPPORT_CATEGORIES) as SupportCategory[]).filter((c) => !ALWAYS_ESCALATE.includes(c));
const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
const chip = (on: boolean) => "h-8 px-3 rounded-lg text-xs border transition " + (on ? "bg-white/[0.1] border-white/30 text-white" : "bg-white/[0.02] border-white/[0.1] text-white/60 hover:text-white");

/** Admin › تنظیمات سیستم › پشتیبانی AI */
export function SupportAiSettingsCard() {
  const { notify } = useApp();
  const [s, setS] = useState<SupportAiSettings | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { api.supportAi.settings().then((r) => { setS(r.settings); setModels(r.models); }, (e: Error) => setError(e.message)); }, []);
  if (error) return <Card title="پشتیبانی AI" icon="sparkles"><Empty icon="circle-alert" title="در دسترس نیست" text={error} /></Card>;
  if (!s) return <Card title="پشتیبانی AI" icon="sparkles"><div aria-busy="true" className="grid place-items-center py-10"><Icon name="loader-circle" size={22} className="animate-spin text-white/50" /></div></Card>;
  const set = (p: Partial<SupportAiSettings>) => setS((x) => x && { ...x, ...p });
  return (
    <Card title="پشتیبانی AI" icon="sparkles">
      <p className="text-sm text-white/60 leading-7 max-w-3xl">پاسخ‌دهنده اول تیکت‌ها: وضعیت سرویس‌ها، خطاهای اخیر و راهنماهای مرتبط را (فقط خواندنی و با دسترسی خود مشتری) می‌خواند و پاسخ و یادداشت داخلی می‌نویسد. هیچ اقدامی روی حساب انجام نمی‌دهد. هزینه آن با پلتفرم است و از کیف پول مشتری کسر نمی‌شود.</p>
      <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mt-5">
        <Field label="حالت"><Select value={s.mode} label="حالت" onChange={(v) => set({ mode: v as SupportAiSettings["mode"] })} options={MODES} /></Field>
        <Field label="آستانه اطمینان پاسخ خودکار (٪)" hint="پیش‌فرض ۸۰٪"><input value={Math.round(s.threshold * 100)} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} onChange={(e) => set({ threshold: Math.min(100, Math.max(50, +toEnDigits(e.target.value).replace(/\D/g, "") || 50)) / 100 })} /></Field>
        <Field label="سقف هزینه روزانه (تومان)" hint={s.dailyCap ? toman(s.dailyCap) + " در روز؛ صفر یعنی بدون سقف" : "بدون سقف"}><input value={s.dailyCap} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} onChange={(e) => set({ dailyCap: +toEnDigits(e.target.value).replace(/\D/g, "").slice(0, 10) || 0 })} /></Field>
        <Field label="بالاتر از سقف"><Select value={s.overCap} label="بالاتر از سقف" onChange={(v) => set({ overCap: v as SupportAiSettings["overCap"] })} options={[{ value: "draft", label: "پیش‌نویس قاعده‌محور رایگان" }, { value: "skip", label: "اجرا نشود" }]} /></Field>
        <Field className="sm:col-span-2" label="مدل" hint="خالی: همان مدل‌های دستیار گره، با جایگزینی خودکار"><Select value={s.model} label="مدل" ltr onChange={(v) => set({ model: v })} options={[{ value: "", label: "پیش‌فرض دستیار" }, ...models.map((m) => ({ value: m.id, label: m.name }))]} /></Field>
      </div>
      <Field as="div" className="mt-5 max-w-3xl" label="دسته‌هایی که پاسخ خودکار می‌گیرند">
        <div className="flex flex-wrap gap-2">{ALLOWABLE.map((c) => <button key={c} type="button" aria-pressed={s.allow.includes(c)} className={chip(s.allow.includes(c))} onClick={() => set({ allow: toggle(s.allow, c) })}>{SUPPORT_CATEGORIES[c]}</button>)}</div>
      </Field>
      <p className="mt-3 text-xs text-white/55 leading-6 max-w-3xl">همیشه به پشتیبان انسانی می‌روند: {ALWAYS_ESCALATE.map((c) => SUPPORT_CATEGORIES[c]).join("، ")}. هر تیکت حداکثر {fa(MAX_AI_REPLIES)} پاسخ AI می‌گیرد.</p>
      <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mt-5">
        <Field as="div" label="واحدها (هیچ‌کدام = همه)"><div className="flex flex-wrap gap-2">{["فنی", "مالی", "فروش", "دواپس"].map((d) => <button key={d} type="button" aria-pressed={s.depts.includes(d)} className={chip(s.depts.includes(d))} onClick={() => set({ depts: toggle(s.depts, d) })}>{d}</button>)}</div></Field>
        <Field as="div" label="اولویت‌ها (هیچ‌کدام = همه)"><div className="flex flex-wrap gap-2">{([["low", "کم"], ["normal", "معمولی"], ["high", "فوری"]] as const).map(([p, l]) => <button key={p} type="button" aria-pressed={s.priorities.includes(p)} className={chip(s.priorities.includes(p))} onClick={() => set({ priorities: toggle(s.priorities, p) })}>{l}</button>)}</div></Field>
      </div>
      <div className="mt-5 max-w-3xl flex items-center justify-between gap-4 p-3 rounded-xl bg-white/[0.02]">
        <div><div className="text-sm font-bold">گفتگوی آنلاین</div><div className="text-xs text-white/55 mt-1">تا وقتی کارشناسی وارد گفتگو نشده، با همین حالت و قواعد و فقط بر اساس راهنماها پاسخ می‌دهد.</div></div>
        <Switch on={s.chat} label="گفتگوی آنلاین" onChange={(v) => set({ chat: v })} />
      </div>
      <div className="mt-6 flex justify-end max-w-3xl"><AsyncButton onClick={async () => { const r = await api.supportAi.saveSettings(s); setS(r); notify("تنظیمات پشتیبانی AI ذخیره شد"); }}>ذخیره</AsyncButton></div>
    </Card>
  );
}
