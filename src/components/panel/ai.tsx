"use client";
import Link from "next/link";
import { useState } from "react";
import { AI_SNIPPETS } from "@/content/ai";
import { AI_DISCOUNT, AI_FORMAT_LABEL, AI_VENDORS, rulePrice } from "@/lib/ai";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { api, useDB, useMyId, type AiKeyInput } from "@/lib/store";
import type { AiKeyRow, AiModelRow } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, Bars, CopyText, Modal, PageTitle, Select, StatCard, Switch, Tabs } from "../ui-client";

const USAGE_STATUS: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]> = {
  success: ["موفق", "green"], error: ["خطا", "red"], denied: ["رد شده", "amber"], cancelled: ["لغو شده", "gray"],
};
const perM = (n: number) => fa(n) + " ت";
const ctx = (n: number) => (n >= 1_000_000 ? fa(Math.round(n / 100_000) / 10) + "M" : fa(Math.round(n / 1000)) + "K");
const num = (s: string) => Number(s.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/[^\d]/g, "")) || 0;

/* ================= customer ================= */

export function UserAi() {
  const db = useDB(); const myId = useMyId();
  const me = db.users.find((u) => u.id === myId);
  const a = db.ai;
  const [tab, setTab] = useState("start");
  return (
    <div>
      <div className="relative overflow-hidden rounded-[1.75rem] p-6 sm:p-8 mb-5 text-white" style={{ background: "linear-gradient(120deg, #3b1a78 0%, #6d28d9 50%, #0ea5e9 100%)" }}>
        <div aria-hidden="true" className="absolute -left-16 -top-24 w-72 h-72 rounded-full bg-white/10" />
        <div className="relative flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-5">
          <div className="min-w-0">
            <p className="text-xs text-white/75">Claude، GPT، Gemini و DeepSeek با یک کلید و پرداخت تومانی</p>
            <h1 className="text-2xl sm:text-3xl font-black mt-1">API هوش مصنوعی</h1>
            <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-black/25 px-3 py-2 max-w-full"><span className="text-[11px] text-white/70 shrink-0">آدرس API</span><CopyText text={a.endpoint} className="font-mono text-sm truncate" /></div>
          </div>
          <div className="sm:text-left">
            <p className="text-xs text-white/75">موجودی کیف پول</p>
            <p className="text-2xl sm:text-3xl font-black tabular mt-1">{fa(me?.balance ?? 0)} <span className="text-sm font-normal">تومان</span></p>
            <p className="text-[11px] text-white/70 mt-1">مصرف امروز: {toman(a.stats.todaySpend)} · {fa(a.stats.todayCount)} درخواست</p>
            <Link href="/panel/billing" className="inline-flex items-center gap-1 text-xs mt-2 text-white/90 underline underline-offset-4"><Icon name="wallet" size={13} />افزایش موجودی</Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard icon="activity" label="درخواست امروز" value={a.stats.todayCount} />
        <StatCard icon="wallet" label="هزینه امروز" value={a.stats.todaySpend} suffix="تومان" />
        <StatCard icon="chart-column" label="درخواست این ماه" value={a.stats.monthCount} />
        <StatCard icon="receipt" label="هزینه این ماه" value={a.stats.monthSpend} suffix="تومان" />
      </div>

      <div className="overflow-x-auto no-scrollbar mb-4"><Tabs size="sm" value={tab} onChange={setTab} label="بخش‌های API هوش مصنوعی" options={[
        { id: "start", label: "شروع سریع", icon: "rocket" }, { id: "keys", label: "کلیدها", icon: "key-round" }, { id: "models", label: "مدل‌ها و قیمت", icon: "tag" },
        { id: "usage", label: "مصرف", icon: "activity" }, { id: "play", label: "آزمایش", icon: "bot" },
      ]} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "start" && <QuickStart onKeys={() => setTab("keys")} />}
        {tab === "keys" && <Keys />}
        {tab === "models" && <ModelList models={a.models} />}
        {tab === "usage" && <Usage />}
        {tab === "play" && <Playground />}
      </div>
    </div>
  );
}

function QuickStart({ onKeys }: { onKeys: () => void }) {
  const a = useDB().ai;
  const [sid, setSid] = useState(AI_SNIPPETS[0].id);
  const s = AI_SNIPPETS.find((x) => x.id === sid)!;
  const active = a.keys.filter((k) => k.status === "active");
  const code = s.code(a.endpoint, active.length ? "gk-…(کلید خود را جایگزین کنید)" : "gk-YOUR-KEY");
  return (
    <div className="grid lg:grid-cols-[1fr_1.6fr] gap-4 items-start">
      <Card title="سه قدم تا اولین درخواست" icon="list-checks">
        <ol className="space-y-4 text-sm leading-7">
          <li className="flex gap-3"><span className="w-7 h-7 rounded-full bg-white/10 grid place-items-center shrink-0 text-xs font-bold">۱</span><span>کیف پول را شارژ کنید؛ هزینه فقط به ازای توکن مصرفی کم می‌شود.</span></li>
          <li className="flex gap-3"><span className="w-7 h-7 rounded-full bg-white/10 grid place-items-center shrink-0 text-xs font-bold">۲</span><span>یک کلید بسازید و برای امنیت، سقف هزینه روزانه بگذارید.<button type="button" onClick={onKeys} className="block acc text-xs mt-1">{active.length ? fa(active.length) + " کلید فعال دارید ←" : "ساخت اولین کلید ←"}</button></span></li>
          <li className="flex gap-3"><span className="w-7 h-7 rounded-full bg-white/10 grid place-items-center shrink-0 text-xs font-bold">۳</span><span>آدرس <code dir="ltr" className="text-xs">{a.endpoint}</code> را به‌جای آدرس OpenAI، Anthropic یا Gemini در برنامه‌تان بگذارید.</span></li>
        </ol>
        <Link href={"/docs/ai-api" as never} className={BTN_G + " w-full h-10 mt-5 text-sm"}><Icon name="book-open" size={15} />مستندات کامل</Link>
      </Card>
      <Card pad="p-3 sm:p-4" title="اتصال ابزارها" icon="plug">
        <div className="flex flex-wrap gap-1.5 mb-3">
          {AI_SNIPPETS.map((x) => <button key={x.id} type="button" aria-pressed={sid === x.id} onClick={() => setSid(x.id)} className={"h-8 px-3 rounded-lg text-xs inline-flex items-center gap-1.5 transition " + (sid === x.id ? "bg-white text-black font-bold" : "bg-white/[0.05] text-white/65 hover:text-white")}><Icon name={x.icon} size={13} />{x.label}</button>)}
        </div>
        <p className="text-xs text-white/60 leading-6 mb-2">{s.note}</p>
        <div className="relative">
          <pre dir="ltr" tabIndex={0} aria-label={"نمونه " + s.label} className="text-left text-[12px] leading-6 font-mono bg-black/40 rounded-xl p-4 overflow-x-auto">{code}</pre>
          <div className="absolute top-2 left-2"><CopyText text={code} className="text-[11px]" /></div>
        </div>
      </Card>
    </div>
  );
}

const EMPTY_KEY: AiKeyInput = { name: "", models: [], dailyCap: 0, monthlyCap: 0, rpm: 120, expiresDays: 0 };

function Keys() {
  const a = useDB().ai; const { notify } = useApp();
  const [form, setForm] = useState<{ edit: AiKeyRow | null } | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  return (
    <Card pad="p-3 sm:p-4" title={<span className="flex items-center gap-2">کلیدهای API <Badge>{fa(a.keys.filter((k) => k.status === "active").length)} فعال</Badge></span>}
      action={<button type="button" onClick={() => setForm({ edit: null })} className={BTN_P + " h-9 px-3 text-xs"}><Icon name="plus" size={14} />کلید جدید</button>}>
      {a.keys.length === 0 ? <Empty icon="key-round" title="هنوز کلیدی نساخته‌اید" text="برای استفاده از API یک کلید بسازید؛ کلید فقط یک بار نمایش داده می‌شود." /> : (
        <ul className="divide-y divide-white/[0.06]">
          {a.keys.map((k) => (
            <li key={k.id} className={"p-3 grid sm:grid-cols-[1fr_auto] gap-3 " + (k.status !== "active" ? "opacity-55" : "")}>
              <div className="min-w-0">
                <span className="flex flex-wrap items-center gap-2"><b className="text-sm">{k.name}</b><code dir="ltr" className="text-[11px] text-white/60">{k.prefix}…</code>{k.status === "active" ? <Badge tone="green" dot>فعال</Badge> : <Badge tone="red">باطل شده</Badge>}{k.models.length > 0 && <Badge tone="blue">{fa(k.models.length)} مدل مجاز</Badge>}</span>
                <span className="block text-[11px] text-white/55 mt-1.5 leading-6">
                  امروز {toman(k.spentToday)}{k.dailyCap ? " از سقف " + toman(k.dailyCap) : ""} · این ماه {toman(k.spentMonth)}{k.monthlyCap ? " از سقف " + toman(k.monthlyCap) : ""} · {fa(k.rpm)} درخواست در دقیقه
                </span>
                <span className="block text-[11px] text-white/40">ساخته {k.created}{k.lastUsed ? " · آخرین استفاده " + k.lastUsed : " · بدون استفاده"}{k.expires ? " · انقضا " + k.expires : ""}</span>
              </div>
              {k.status === "active" && <div className="flex gap-2 sm:self-center">
                <button type="button" onClick={() => setForm({ edit: k })} className={BTN_G + " h-9 px-3 text-xs"}><Icon name="settings-2" size={13} />محدودیت‌ها</button>
                <AsyncButton danger className="h-9 px-3 text-xs" confirmText={"کلید «" + k.name + "» بلافاصله از کار می‌افتد. ادامه؟"} onClick={async () => { await api.ai.revokeKey(k.id); notify("کلید باطل شد", "key-round"); }}>ابطال</AsyncButton>
              </div>}
            </li>
          ))}
        </ul>
      )}
      {form && <KeyForm edit={form.edit} models={a.models} onClose={() => setForm(null)} onCreated={(key) => { setForm(null); setShown(key); }} />}
      <Modal open={!!shown} onClose={() => setShown(null)} title="کلید ساخته شد" icon="key-round">
        <p className="text-sm text-amber-200/90 leading-7">این کلید فقط همین یک بار نمایش داده می‌شود. همین حالا کپی کنید و جای امنی نگه دارید؛ هرگز در کد سمت مرورگر یا مخزن عمومی قرار ندهید.</p>
        <div className="mt-4 rounded-xl bg-black/40 p-4"><CopyText text={shown ?? ""} className="font-mono text-sm break-all" /></div>
        <button type="button" onClick={() => setShown(null)} className={BTN_P + " w-full h-11 mt-4"}>کپی کردم</button>
      </Modal>
    </Card>
  );
}

function KeyForm({ edit, models, onClose, onCreated }: { edit: AiKeyRow | null; models: AiModelRow[]; onClose: () => void; onCreated: (key: string) => void }) {
  const { notify } = useApp();
  const [f, setF] = useState<AiKeyInput>(edit ? { name: edit.name, models: edit.models, dailyCap: edit.dailyCap, monthlyCap: edit.monthlyCap, rpm: edit.rpm, expiresDays: 0 } : EMPTY_KEY);
  const [limit, setLimit] = useState(!!edit?.models.length);
  const toggle = (id: string) => setF({ ...f, models: f.models.includes(id) ? f.models.filter((m) => m !== id) : [...f.models, id] });
  return (
    <Modal open onClose={onClose} title={edit ? "محدودیت‌های کلید «" + edit.name + "»" : "ساخت کلید جدید"} icon="key-round" size="max-w-xl">
      <div className="space-y-4">
        <Field label="نام کلید" hint="مثلاً «سرور تولید» یا «Claude Code لپ‌تاپ»"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={40} className={INPUT} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="سقف هزینه روزانه (تومان)" hint="۰ یعنی بدون سقف"><input inputMode="numeric" value={f.dailyCap ? fa(f.dailyCap) : ""} placeholder="۰" onChange={(e) => setF({ ...f, dailyCap: num(e.target.value) })} className={INPUT + " tabular"} /></Field>
          <Field label="سقف هزینه ماهانه (تومان)" hint="۰ یعنی بدون سقف"><input inputMode="numeric" value={f.monthlyCap ? fa(f.monthlyCap) : ""} placeholder="۰" onChange={(e) => setF({ ...f, monthlyCap: num(e.target.value) })} className={INPUT + " tabular"} /></Field>
          <Field label="درخواست در دقیقه"><input inputMode="numeric" value={fa(f.rpm)} onChange={(e) => setF({ ...f, rpm: Math.min(600, Math.max(1, num(e.target.value))) })} className={INPUT + " tabular"} /></Field>
          {!edit && <Field label="انقضا"><Select label="انقضا" value={String(f.expiresDays)} onChange={(v) => setF({ ...f, expiresDays: Number(v) })} options={[{ value: "0", label: "بدون انقضا" }, { value: "7", label: "۷ روز" }, { value: "30", label: "۳۰ روز" }, { value: "90", label: "۹۰ روز" }, { value: "365", label: "یک سال" }]} /></Field>}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3 text-sm">
          <span>محدود به مدل‌های خاص<span className="block text-[11px] text-white/50">خاموش یعنی همه مدل‌های فعال</span></span>
          <Switch on={limit} onChange={(v) => { setLimit(v); if (!v) setF({ ...f, models: [] }); }} label="محدود به مدل‌های خاص" />
        </div>
        {limit && <div className="max-h-48 overflow-y-auto rounded-xl border border-white/[0.08] p-2 grid sm:grid-cols-2 gap-1">
          {models.map((m) => <label key={m.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-white/[0.04] cursor-pointer"><input type="checkbox" checked={f.models.includes(m.id)} onChange={() => toggle(m.id)} />{m.name}</label>)}
        </div>}
        <AsyncButton disabled={f.name.trim().length < 2 || (limit && !f.models.length)} className={BTN_P + " w-full h-11"} onClick={async () => {
          if (edit) { await api.ai.updateKey(edit.id, { name: f.name.trim(), models: f.models, dailyCap: f.dailyCap, monthlyCap: f.monthlyCap, rpm: f.rpm }); notify("محدودیت‌ها ذخیره شد", "circle-check"); onClose(); }
          else onCreated(await api.ai.createKey({ ...f, name: f.name.trim() }));
        }}>{edit ? "ذخیره" : "ساخت کلید"}</AsyncButton>
      </div>
    </Modal>
  );
}

export function ModelList({ models, compact = false }: { models: AiModelRow[]; compact?: boolean }) {
  const [vendor, setVendor] = useState("all");
  const vendors = [...new Set(models.map((m) => m.vendor))];
  const list = models.filter((m) => m.active && (vendor === "all" || m.vendor === vendor));
  return (
    <Card pad="p-3 sm:p-4" title={compact ? undefined : <span className="flex items-center gap-2">مدل‌ها <Badge>{fa(list.length)}</Badge></span>}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {["all", ...vendors].map((v) => <button key={v} type="button" aria-pressed={vendor === v} onClick={() => setVendor(v)} className={"h-8 px-3 rounded-lg text-xs transition " + (vendor === v ? "bg-white text-black font-bold" : "bg-white/[0.05] text-white/65 hover:text-white")}>{v === "all" ? "همه" : AI_VENDORS[v] ?? v}</button>)}
      </div>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="قیمت مدل‌ها">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-white/55 text-xs text-right"><th className="p-3">مدل</th><th className="p-3">شناسه</th><th className="p-3">ورودی / ۱M توکن</th><th className="p-3">خروجی / ۱M توکن</th><th className="p-3">کانتکست</th></tr></thead>
          <tbody>{list.map((m) => (
            <tr key={m.id} className="border-t border-white/[0.06]">
              <td className="p-3 font-bold whitespace-nowrap">{m.name}<span className="block text-[11px] font-normal text-white/45">{AI_VENDORS[m.vendor] ?? m.vendor}{m.vision ? " · تصویر" : ""}</span></td>
              <td className="p-3"><CopyText text={m.id} className="font-mono text-xs" /></td>
              <td className="p-3 tabular whitespace-nowrap">{perM(m.inPrice)}</td>
              <td className="p-3 tabular whitespace-nowrap text-emerald-300">{perM(m.outPrice)}</td>
              <td className="p-3 tabular" dir="ltr">{ctx(m.context)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-[11px] text-white/45 mt-3 leading-6">قیمت‌ها به تومان و به ازای یک میلیون توکن است. هر ۱۰۰۰ توکن تقریباً ۷۵۰ کلمه انگلیسی یا ۴۰۰ تا ۵۰۰ کلمه فارسی است.</p>
    </Card>
  );
}

function UsageList({ admin = false }: { admin?: boolean }) {
  const a = useDB().ai;
  const [model, setModel] = useState("all");
  const rows = a.usage.filter((u) => model === "all" || u.model === model);
  const models = [...new Set(a.usage.map((u) => u.model))];
  return (
    <Card pad="p-3 sm:p-4" title="آخرین درخواست‌ها" icon="scroll-text" action={models.length > 1 ? <div className="w-44"><Select label="مدل" value={model} onChange={setModel} options={[{ value: "all", label: "همه مدل‌ها" }, ...models.map((m) => ({ value: m, label: m }))]} /></div> : undefined}>
      {rows.length === 0 ? <Empty icon="activity" title="درخواستی ثبت نشده است" text="پس از اولین فراخوانی، جزئیات هر درخواست اینجا دیده می‌شود." /> : (
        <ul className="divide-y divide-white/[0.06]">
          {rows.map((u) => { const [label, tone] = USAGE_STATUS[u.status] ?? [u.status, "gray"]; return (
            <li key={u.id} className="py-3 px-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
              <span className="text-sm font-bold truncate" dir="ltr" style={{ textAlign: "right" }}>{u.model}</span>
              <span className="text-sm tabular text-left">{u.charged ? toman(u.charged) : "رایگان"}</span>
              <span className="flex flex-wrap items-center gap-2 text-[11px] text-white/55"><Badge tone={tone}>{label}</Badge><Badge>{AI_FORMAT_LABEL[u.format] ?? u.format}</Badge>{u.stream && <Badge tone="blue">stream</Badge>}{u.keyName && <span>{u.keyName}</span>}{admin && <span dir="ltr">{u.userId}</span>}</span>
              <span className="text-[11px] text-white/50 text-left whitespace-nowrap">{u.at}</span>
              <span className="col-span-2 text-[11px] text-white/40">{fa(u.inTokens)} ورودی · {fa(u.outTokens)} خروجی{u.estimated ? " (تخمینی)" : ""} · {fa(u.latencyMs)}ms{u.error ? " · " + u.error : ""}</span>
            </li>
          ); })}
        </ul>
      )}
    </Card>
  );
}

function Usage() {
  const a = useDB().ai;
  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="هزینه روزانه (۳۰ روز)" icon="chart-column">
          {a.stats.daily.length > 1 ? <Bars data={a.stats.daily.map((d) => d.spend)} labels={a.stats.daily.map((d) => d.day.split("/").slice(-2).join("/"))} height={140} fmt={(v) => toman(v)} /> : <p className="text-sm text-white/55">پس از چند روز استفاده، نمودار اینجا نمایش داده می‌شود.</p>}
        </Card>
        <Card title="مصرف این ماه به تفکیک مدل" icon="layers">
          {a.stats.byModel.length === 0 ? <p className="text-sm text-white/55">هنوز مصرفی ندارید.</p> : <ul className="space-y-2.5">
            {a.stats.byModel.map((b) => { const max = a.stats.byModel[0].spend || 1; return (
              <li key={b.model}><div className="flex justify-between text-xs mb-1"><span dir="ltr" className="font-mono">{b.model}</span><span className="tabular text-white/70">{toman(b.spend)} · {fa(b.count)} درخواست</span></div>
                <div className="h-1.5 rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-violet-400/80" style={{ width: Math.max(2, (b.spend / max) * 100) + "%" }} /></div></li>
            ); })}
          </ul>}
        </Card>
      </div>
      <UsageList />
    </div>
  );
}

type Msg = { role: "user" | "assistant"; content: string };
function Playground() {
  const a = useDB().ai;
  const [model, setModel] = useState(a.models.find((m) => m.id === "gpt-4o-mini")?.id ?? a.models[0]?.id ?? "");
  const [system, setSystem] = useState("");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [spent, setSpent] = useState(0);
  const [max, setMax] = useState(1024);
  const m = a.models.find((x) => x.id === model);
  if (!a.models.length) return <Empty icon="bot" title="مدل فعالی وجود ندارد" />;
  const send = async () => {
    const next: Msg[] = [...msgs, { role: "user", content: input.trim() }];
    const r = await api.ai.playground(model, [...(system.trim() ? [{ role: "system" as const, content: system.trim() }] : []), ...next], max);
    setMsgs([...next, { role: "assistant", content: r.text }]); setInput(""); setSpent(spent + r.charged);
  };
  return (
    <div className="grid lg:grid-cols-[1fr_2fr] gap-4 items-start">
      <Card title="تنظیمات" icon="settings-2">
        <div className="space-y-4">
          <Field label="مدل"><Select label="مدل" value={model} onChange={setModel} options={a.models.map((x) => ({ value: x.id, label: x.name }))} /></Field>
          {m && <p className="text-[11px] text-white/50 -mt-2">ورودی {perM(m.inPrice)} · خروجی {perM(m.outPrice)} به ازای ۱M توکن</p>}
          <Field label="حداکثر توکن خروجی"><Select label="حداکثر توکن" value={String(max)} onChange={(v) => setMax(Number(v))} options={[256, 1024, 2048, 4096].map((n) => ({ value: String(n), label: fa(n) }))} /></Field>
          <Field label="دستور سیستمی (اختیاری)"><textarea rows={3} value={system} onChange={(e) => setSystem(e.target.value)} placeholder="مثلاً: کوتاه و به فارسی پاسخ بده." className={TEXTAREA} /></Field>
          <div className="flex items-center justify-between text-xs text-white/60"><span>هزینه این گفتگو: <b className="tabular text-white">{toman(spent)}</b></span>{msgs.length > 0 && <button type="button" className="acc" onClick={() => { setMsgs([]); setSpent(0); }}>گفتگوی جدید</button>}</div>
        </div>
      </Card>
      <Card title="گفتگو" icon="bot">
        <div className="space-y-3 max-h-[55vh] overflow-y-auto mb-4" aria-live="polite">
          {msgs.length === 0 ? <p className="text-sm text-white/55 leading-7">پیامی بنویسید تا مدل را آزمایش کنید. هزینه مانند API از کیف پول کم می‌شود و در گزارش مصرف با برچسب «پنل» ثبت می‌شود.</p>
            : msgs.map((x, i) => <div key={i} className={"rounded-2xl px-4 py-3 text-sm leading-7 whitespace-pre-wrap " + (x.role === "user" ? "bg-white/[0.07] ms-8" : "bg-violet-500/10 border border-violet-300/15 me-8")}>{x.content}</div>)}
        </div>
        <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} placeholder="پیام شما…" aria-label="پیام" className={TEXTAREA} />
        <AsyncButton disabled={!input.trim() || msgs.length >= 38} className="mt-3" onClick={send}><Icon name="send" size={15} />ارسال</AsyncButton>
      </Card>
    </div>
  );
}

/* ================= admin ================= */

export function AdminAi() {
  const a = useDB().ai;
  const [tab, setTab] = useState("models");
  const errors = a.usage.filter((u) => u.status === "error").length;
  return (
    <div>
      <PageTitle title="API هوش مصنوعی" sub={"مدل‌ها و قیمت‌ها، همگام‌سازی با سرویس‌دهنده و گزارش مصرف. سرویس‌دهنده: " + (a.upstream === "http" ? "متصل (" + "AI_UPSTREAM_URL" + ")" : "شبیه‌ساز — AI_UPSTREAM_KEY تنظیم نشده")} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <StatCard icon="activity" label="درخواست امروز" value={a.stats.todayCount} />
        <StatCard icon="wallet" label="درآمد امروز" value={a.stats.todaySpend} suffix="تومان" />
        <StatCard icon="chart-column" label="درآمد این ماه" value={Math.round(a.stats.monthSpend / 1e5) / 10} suffix="میلیون" />
        <StatCard icon="triangle-alert" label="خطا در آخرین درخواست‌ها" value={errors} tone={errors ? "down" : ""} sub={"از " + fa(a.usage.length) + " درخواست اخیر"} />
      </div>
      <div className="overflow-x-auto no-scrollbar mb-4"><Tabs size="sm" value={tab} onChange={setTab} label="بخش" options={[
        { id: "models", label: "مدل‌ها و قیمت", icon: "tag" }, { id: "usage", label: "آخرین درخواست‌ها", icon: "activity" },
      ]} /></div>
      {tab === "models" && <AdminModels />}
      {tab === "usage" && <div className="space-y-4">
        {a.stats.daily.length > 1 && <Card title="درآمد روزانه" icon="chart-column"><Bars data={a.stats.daily.map((d) => d.spend)} labels={a.stats.daily.map((d) => d.day.split("/").slice(-2).join("/"))} height={140} fmt={(v) => toman(v)} /></Card>}
        <UsageList admin />
      </div>}
    </div>
  );
}

function AdminModels() {
  const a = useDB().ai; const { notify } = useApp();
  const [discount, setDiscount] = useState(String(AI_DISCOUNT * 100));
  const [add, setAdd] = useState(false);
  const [q, setQ] = useState("");
  const list = a.models.filter((m) => !q || (m.id + m.name).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4">
      <Card title="قاعده قیمت‌گذاری" icon="scale">
        <p className="text-sm text-white/65 leading-7">قیمت هر مدل = میانگین قیمت سایت‌های ایرانی، حداکثر برابر قیمت مرجع (پاستا)، منهای درصد تخفیف. با «اعمال» قیمت همه مدل‌هایی که قیمت مرجع دارند بازنویسی می‌شود.</p>
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <Field label="درصد زیر قیمت مرجع"><input inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))} className={INPUT + " w-32 tabular"} /></Field>
          <AsyncButton className={BTN_G + " h-11 px-4 text-sm"} confirmText="قیمت همه مدل‌های دارای مرجع بازنویسی می‌شود. ادامه؟" onClick={async () => { const n = await api.ai.adminApplyRule(Math.min(50, Number(discount) || 0) / 100); notify(fa(n) + " مدل بازقیمت‌گذاری شد", "tag"); }}>اعمال</AsyncButton>
          <AsyncButton className={BTN_G + " h-11 px-4 text-sm"} onClick={async () => { const r = await api.ai.adminSync(); notify(fa(r.total) + " مدل در سرویس‌دهنده، " + fa(r.added) + " مدل جدید (غیرفعال) اضافه شد", "refresh-cw"); }}><Icon name="refresh-cw" size={14} />همگام‌سازی فهرست مدل‌ها</AsyncButton>
          <button type="button" onClick={() => setAdd(true)} className={BTN_G + " h-11 px-4 text-sm"}><Icon name="plus" size={14} />افزودن مدل</button>
        </div>
      </Card>
      <Card pad="p-3 sm:p-4" title={<span className="flex items-center gap-2">مدل‌ها <Badge>{fa(a.models.filter((m) => m.active).length)} فعال از {fa(a.models.length)}</Badge></span>}
        action={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو" aria-label="جست‌وجوی مدل" className={INPUT + " h-9 w-40"} />}>
        <div className="space-y-2">{list.map((m) => <AdminModelRow key={m.id + m.inPrice + m.outPrice + m.active} m={m} />)}</div>
      </Card>
      <AddModel open={add} onClose={() => setAdd(false)} />
    </div>
  );
}

function AdminModelRow({ m }: { m: AiModelRow }) {
  const { notify } = useApp();
  const [f, setF] = useState({ name: m.name, upstream: m.upstream, inPrice: String(m.inPrice), outPrice: String(m.outPrice), refIn: String(m.refIn), refOut: String(m.refOut) });
  const [test, setTest] = useState<{ ok: boolean; ms: number; detail: string } | null>(null);
  const dirty = f.name !== m.name || f.upstream !== m.upstream || num(f.inPrice) !== m.inPrice || num(f.outPrice) !== m.outPrice || num(f.refIn) !== m.refIn || num(f.refOut) !== m.refOut;
  const inp = (k: keyof typeof f, label: string, ltr = true) => <Field label={label}><input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} dir={ltr ? "ltr" : "rtl"} aria-label={label + " " + m.id} className={INPUT + " h-9 text-xs" + (ltr ? " text-left font-mono" : "")} /></Field>;
  return (
    <details className="rounded-2xl bg-white/[0.03] border border-white/[0.07] group">
      <summary className="p-3 flex flex-wrap items-center justify-between gap-2 cursor-pointer list-none">
        <span className="flex flex-wrap items-center gap-2 min-w-0"><b className="text-sm">{m.name}</b><code dir="ltr" className="text-[11px] text-white/55">{m.id}</code>{!m.active && <Badge tone="gray">غیرفعال</Badge>}</span>
        <span className="text-xs tabular text-white/70">{perM(m.inPrice)} / {perM(m.outPrice)}{m.refIn ? <span className="text-white/40"> (مرجع {perM(m.refIn)} / {perM(m.refOut)})</span> : null}</span>
      </summary>
      <div className="px-3 pb-3 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {inp("name", "نام نمایشی", false)}
          {inp("upstream", "شناسه نزد سرویس‌دهنده")}
          <div className="flex items-end gap-2 pb-1"><Switch on={m.active} onChange={async (v) => { try { await api.ai.adminModel(m.id, { active: v }); } catch (e) { notify((e as Error).message, "circle-alert"); } }} label={"فعال بودن " + m.id} /><span className="text-xs text-white/60">فعال</span></div>
          {inp("inPrice", "قیمت ورودی (ت/1M)")}
          {inp("outPrice", "قیمت خروجی (ت/1M)")}
          <div className="text-[11px] text-white/50 self-end pb-2">پیشنهاد قاعده: {m.refIn ? perM(rulePrice(num(f.refIn))) + " / " + perM(rulePrice(num(f.refOut))) : "—"}</div>
          {inp("refIn", "مرجع ورودی")}
          {inp("refOut", "مرجع خروجی")}
        </div>
        <div className="flex flex-wrap gap-2">
          <AsyncButton disabled={!dirty} className={BTN_P + " h-9 px-4 text-xs"} onClick={async () => { await api.ai.adminModel(m.id, { name: f.name.trim(), upstream: f.upstream.trim(), inPrice: num(f.inPrice), outPrice: num(f.outPrice), refIn: num(f.refIn), refOut: num(f.refOut) }); notify("مدل ذخیره شد", "circle-check"); }}>ذخیره</AsyncButton>
          <AsyncButton className={BTN_G + " h-9 px-4 text-xs"} onClick={async () => setTest(await api.ai.adminTest(m.id))}><Icon name="zap" size={13} />تست اتصال</AsyncButton>
        </div>
        {test && <p className={"text-xs leading-6 " + (test.ok ? "text-emerald-300" : "text-rose-300")} dir="auto">{test.ok ? "موفق" : "ناموفق"} · {fa(test.ms)}ms · {test.detail}</p>}
      </div>
    </details>
  );
}

function AddModel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notify } = useApp();
  const [f, setF] = useState({ id: "", name: "", vendor: "openai", upstream: "", inPrice: "", outPrice: "", context: "128000" });
  return (
    <Modal open={open} onClose={onClose} title="افزودن مدل" icon="plus">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="شناسه عمومی"><input dir="ltr" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.trim() })} placeholder="gpt-5.5" className={INPUT + " text-left font-mono"} /></Field>
        <Field label="نام نمایشی"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={INPUT} /></Field>
        <Field label="سازنده"><Select label="سازنده" value={f.vendor} onChange={(v) => setF({ ...f, vendor: v })} options={Object.entries(AI_VENDORS).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="شناسه نزد سرویس‌دهنده" hint="خالی = همان شناسه عمومی"><input dir="ltr" value={f.upstream} onChange={(e) => setF({ ...f, upstream: e.target.value.trim() })} className={INPUT + " text-left font-mono"} /></Field>
        <Field label="قیمت ورودی (ت/1M)"><input inputMode="numeric" value={f.inPrice} onChange={(e) => setF({ ...f, inPrice: e.target.value })} className={INPUT + " tabular"} /></Field>
        <Field label="قیمت خروجی (ت/1M)"><input inputMode="numeric" value={f.outPrice} onChange={(e) => setF({ ...f, outPrice: e.target.value })} className={INPUT + " tabular"} /></Field>
        <Field label="کانتکست (توکن)"><input inputMode="numeric" value={f.context} onChange={(e) => setF({ ...f, context: e.target.value })} className={INPUT + " tabular"} /></Field>
      </div>
      <AsyncButton className="mt-4" disabled={!f.id || f.name.trim().length < 2 || !num(f.inPrice) || !num(f.outPrice)} onClick={async () => {
        await api.ai.adminAddModel({ id: f.id, name: f.name.trim(), vendor: f.vendor, upstream: f.upstream, inPrice: num(f.inPrice), outPrice: num(f.outPrice), context: num(f.context) || 128000 });
        notify("مدل اضافه شد (غیرفعال؛ پس از تست فعال کنید)", "circle-check"); onClose();
      }}>افزودن</AsyncButton>
    </Modal>
  );
}
