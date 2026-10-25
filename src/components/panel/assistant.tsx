"use client";
/* «دستیار گره» in the panel: the chat (streamed answers, tool chips, confirmation cards, threads), a floating
   launcher on every /panel page that opens it in a drawer (a full-screen sheet on phones), and the full page.
   On /admin the same drawer is the staff console (mode "staff": its own threads and tools, by staff role). */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ASSISTANT, contextOf, STAFF_STARTERS, STARTERS, type AssistantContext, type AssistantMode, type AssistantEvent, type AssistantMessageView, type AssistantThreadView, type AssistantToolActivity } from "@/lib/assistant";
import { BTN_D, BTN_G, BTN_P, BTN_SM } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { Markdown } from "@/lib/markdown";
import { api, byId, refresh, useDB } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card } from "../ui";
import { AsyncButton, ICON_BTN, Portal, Select, useDialog } from "../ui-client";

type Msg = AssistantMessageView & { error?: string; live?: boolean };
type Confirm = NonNullable<AssistantMessageView["confirm"]>;

/* ---------- state: one conversation and its stream ---------- */
function useAssistant(context: AssistantContext | null, mode: AssistantMode = "customer") {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [threads, setThreads] = useState<AssistantThreadView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const tokens = useRef(new Map<string, string>());
  const abort = useRef<AbortController | null>(null);
  const tid = useRef<string | null>(null);
  const { notify } = useApp();

  const loadThreads = useCallback(async () => { try { setThreads(await api.assistant.threads(mode === "staff" ? "staff" : undefined)); } catch { setThreads([]); } }, [mode]);
  const open = useCallback(async (id: string) => {
    if (abort.current) return;
    try { const v = await api.assistant.thread(id); tid.current = id; setThreadId(id); setMessages(v.messages); } catch (e) { notify((e as Error).message, "circle-alert"); }
  }, [notify]);
  const reset = useCallback(() => { if (abort.current) return; tid.current = null; setThreadId(null); setMessages([]); }, []);
  const remove = useCallback(async (id: string) => {
    await api.assistant.deleteThread(id);
    if (tid.current === id) { tid.current = null; setThreadId(null); setMessages([]); }
    await loadThreads();
  }, [loadThreads]);

  const stream = useCallback(async (body: Record<string, unknown>, userText?: string) => {
    if (abort.current) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    const liveId = -Date.now();
    const fresh: Msg[] = [...(userText ? [{ id: liveId - 1, role: "user" as const, content: userText, cost: 0, at: "", tools: [], confirm: null }] : []), { id: liveId, role: "assistant", content: "", cost: 0, at: "", tools: [], confirm: null, live: true }];
    setMessages((m) => [...m, ...fresh]);
    const patch = (f: (m: Msg) => Msg) => setMessages((ms) => ms.map((m) => (m.id === liveId ? f(m) : m)));
    const tool = (id: string, f: (t: AssistantToolActivity) => AssistantToolActivity) => patch((m) => ({ ...m, tools: m.tools.map((t) => (t.id === id ? f(t) : t)) }));
    let error = "";
    try {
      const res = await fetch("/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ threadId: tid.current, context, ...(mode === "staff" ? { mode } : {}), ...body }), signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "ارسال ناموفق بود.");
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
          if (!line.startsWith("data: ")) continue;
          const ev = JSON.parse(line.slice(6)) as AssistantEvent;
          if (ev.type === "thread") { tid.current = ev.id; setThreadId(ev.id); }
          else if (ev.type === "text") patch((m) => ({ ...m, content: m.content + ev.delta }));
          else if (ev.type === "tool") patch((m) => ({ ...m, tools: [...m.tools, { id: ev.id, name: ev.name, label: ev.label, risk: ev.risk, status: "running", summary: "" }] }));
          else if (ev.type === "tool_result") {
            patch((m) => (m.tools.some((t) => t.id === ev.id) ? m : { ...m, tools: [...m.tools, { id: ev.id, name: ev.name, label: ev.name, risk: "read", status: "running", summary: "" }] }));
            tool(ev.id, (t) => ({ ...t, status: ev.ok ? "ok" : "error", summary: ev.summary }));
          } else if (ev.type === "confirm") {
            tokens.current.set(ev.card.id, ev.card.token);
            const { token: _t, ...card } = ev.card;
            void _t;
            patch((m) => ({ ...m, confirm: { ...card, status: "pending" }, tools: m.tools.map((t) => (t.status === "running" && t.name === card.tool ? { ...t, status: "pending", summary: "در انتظار تأیید شما" } : t)) }));
          } else if (ev.type === "decided") {
            setMessages((ms) => ms.map((m) => (m.confirm?.id === ev.id ? { ...m, confirm: { ...m.confirm, status: ev.status } } : m)));
            tokens.current.delete(ev.id);
          } else if (ev.type === "error") { error = ev.message; patch((m) => ({ ...m, error: ev.message })); }
          else if (ev.type === "done") patch((m) => ({ ...m, cost: ev.charged }));
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") { error = (e as Error).message; patch((m) => ({ ...m, error })); }
    } finally {
      abort.current = null;
      setBusy(false);
      if (tid.current) {
        // the stored view is the truth (merged bubbles, costs); keep an error the server did not store
        try {
          const v = await api.assistant.thread(tid.current);
          setMessages(error ? [...v.messages, { id: liveId, role: "assistant", content: "", cost: 0, at: "", tools: [], confirm: null, error }] : v.messages);
        } catch { /* keep the live view */ }
      }
      void loadThreads();
      void refresh();
    }
  }, [context, mode, loadThreads]);

  const send = useCallback((text: string) => { const t = text.trim(); if (t) void stream({ message: t }, t); }, [stream]);
  const decide = useCallback((c: Confirm, yes: boolean) => {
    const token = tokens.current.get(c.id);
    if (!token) return notify("این درخواست منقضی شده است؛ دوباره از دستیار بخواهید.", "clock");
    void stream(yes ? { confirm: { token, args: c.args } } : { cancel: { token } });
  }, [stream, notify]);
  const stop = useCallback(() => abort.current?.abort(), []);
  return { mode, threadId, messages, threads, busy, tokens, loadThreads, open, reset, remove, send, decide, stop };
}
type Assistant = ReturnType<typeof useAssistant>;

/* ---------- pieces ---------- */
const TOOL_ICON: Record<AssistantToolActivity["status"], string> = { running: "loader-circle", ok: "circle-check", error: "circle-x", pending: "shield-alert", cancelled: "ban" };
const TOOL_TONE: Record<AssistantToolActivity["status"], string> = { running: "text-sky-200", ok: "text-emerald-300", error: "text-rose-300", pending: "text-amber-200", cancelled: "text-white/45" };

function ToolChip({ t }: { t: AssistantToolActivity }) {
  return (
    <li className="flex items-start gap-2 text-xs leading-6 min-w-0">
      <Icon name={TOOL_ICON[t.status]} size={14} className={"shrink-0 mt-[5px] " + TOOL_TONE[t.status] + (t.status === "running" ? " animate-spin" : "")} />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="text-white/70">{t.status === "running" ? t.label : t.label.replace(/^در حال /, "").replace(/…$/, "")}</span>
        {t.summary && t.status !== "running" && <span className="text-white/45"> — {t.summary}</span>}
      </span>
    </li>
  );
}

function ConfirmCardView({ c, canAct, busy, onDecide }: { c: Confirm; canAct: boolean; busy: boolean; onDecide: (yes: boolean) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (c.status !== "pending") return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [c.status]);
  const expired = c.status === "pending" && (now > c.expiresAt || !canAct);
  const left = Math.max(0, Math.ceil((c.expiresAt - now) / 1000));
  const tone = c.status === "done" ? "border-emerald-300/30 bg-emerald-400/[0.06]" : c.status === "pending" && !expired ? "border-amber-300/35 bg-amber-400/[0.07]" : "border-white/10 bg-white/[0.03]";
  return (
    <div className={"mt-3 rounded-2xl border p-4 " + tone} role="group" aria-label={"تأیید: " + c.title}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-bold text-sm flex items-center gap-2"><Icon name="shield-alert" size={16} className="text-amber-200 shrink-0" />{c.title}</div>
        {c.status === "done" ? <Badge tone="green" dot>انجام شد</Badge> : c.status === "failed" ? <Badge tone="red" dot>ناموفق</Badge> : c.status === "cancelled" ? <Badge tone="gray">لغو شد</Badge> : expired ? <Badge tone="gray">منقضی شد</Badge> : <Badge tone="amber">در انتظار تأیید</Badge>}
      </div>
      <p className="text-[13px] leading-7 text-white/75 mt-2 [overflow-wrap:anywhere]">{c.summary}</p>
      {c.resource && <div className="text-[11px] text-white/50 mt-1">روی: <span className="text-white/75" dir="auto">{c.resource}</span></div>}
      <div className="mt-3 rounded-xl bg-black/20 border border-white/[0.06] px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[11px] text-white/55">هزینه</span>
        <span className="font-black tabular text-sm">{c.cost === null ? "بدون هزینه مستقیم" : toman(c.cost)}</span>
        {c.costNote && <span className="basis-full text-[11px] leading-5 text-white/45">{c.costNote}</span>}
      </div>
      {c.status === "pending" && !expired && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button type="button" disabled={busy} onClick={() => onDecide(true)} className={BTN_D + BTN_SM + " flex-1 sm:flex-none"}><Icon name="check" size={14} />تأیید و اجرا</button>
          <button type="button" disabled={busy} onClick={() => onDecide(false)} className={BTN_G + BTN_SM + " flex-1 sm:flex-none"}>لغو</button>
          <span className="text-[11px] text-white/40 tabular mr-auto" aria-live="off">{fa(Math.floor(left / 60))}:{fa(String(left % 60).padStart(2, "0"))}</span>
        </div>
      )}
    </div>
  );
}

function Bubble({ m, a }: { m: Msg; a: Assistant }) {
  if (m.role === "user") return (
    <div className="flex justify-start"><div className="max-w-[88%] rounded-2xl rounded-tr-md px-4 py-2.5 text-[14px] leading-7 bg-[#9cc9ff]/[0.12] border border-[#9cc9ff]/20 whitespace-pre-wrap [overflow-wrap:anywhere]" dir="auto">{m.content}</div></div>
  );
  const thinking = m.live && !m.content && !m.tools.length && !m.error;
  return (
    <div className="flex gap-2.5 items-start">
      <span className="w-8 h-8 shrink-0 rounded-xl grid place-items-center bg-gradient-to-br from-violet-400/30 to-sky-400/20 border border-white/10" aria-hidden="true"><Icon name="sparkles" size={15} /></span>
      <div className="min-w-0 flex-1">
        {m.tools.length > 0 && <ul className="mb-2 space-y-0.5 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2" aria-label="کارهای دستیار">{m.tools.map((t) => <ToolChip key={t.id} t={t} />)}</ul>}
        {thinking && <div className="flex items-center gap-2 text-xs text-white/50 py-2"><Icon name="loader-circle" size={14} className="animate-spin" />در حال فکر کردن…</div>}
        {m.content && <Markdown src={m.content} className="!space-y-3 !leading-7 text-[14px] !text-white/85 [&_h2]:!text-base [&_h2]:!pt-1 [&_h3]:!text-[15px] [&_pre]:text-xs" />}
        {m.live && m.content && a.busy && <span className="inline-block w-1.5 h-4 bg-white/60 align-middle animate-pulse" aria-hidden="true" />}
        {m.confirm && <ConfirmCardView c={m.confirm} canAct={a.tokens.current.has(m.confirm.id)} busy={a.busy} onDecide={(yes) => a.decide(m.confirm!, yes)} />}
        {m.error && <div role="alert" className="mt-2 rounded-xl border border-rose-300/25 bg-rose-400/[0.07] px-3 py-2 text-[13px] leading-6 text-rose-100 flex gap-2"><Icon name="circle-alert" size={15} className="shrink-0 mt-1" />{m.error}{/موجودی/.test(m.error) && <Link href="/panel/billing?tab=wallet" className="acc mr-auto whitespace-nowrap text-xs self-center">شارژ کیف پول</Link>}</div>}
        {m.cost > 0 && !m.live && <div className="text-[10px] text-white/35 mt-1.5 tabular" title="هزینه هوش مصنوعی این پاسخ">هزینه: {toman(m.cost)}</div>}
      </div>
    </div>
  );
}

function Starters({ onPick, staff }: { onPick: (s: string) => void; staff?: boolean }) {
  return (
    <div className="py-6 text-center">
      <span className="w-14 h-14 mx-auto rounded-2xl grid place-items-center bg-gradient-to-br from-violet-400/30 to-sky-400/20 border border-white/10" aria-hidden="true"><Icon name="sparkles" size={24} /></span>
      <h2 className="font-black text-lg mt-4">{ASSISTANT.name}</h2>
      <p className="text-white/55 text-[13px] leading-7 mt-1 max-w-sm mx-auto">{staff ? "کنسول پشتیبانی: جست‌وجوی مشتری، سفارش‌های تحویل‌نشده، کارهای ناموفق، تیکت‌ها و گزارش‌ها به اندازه نقش شما. هر اقدام فقط پس از تأیید شما انجام و در گزارش ممیزی ثبت می‌شود." : "حساب گره‌تان را با گفتگو مدیریت کنید. کارهای حساس مثل خرید یا حذف فقط بعد از تأیید شما انجام می‌شود."}</p>
      <div className="mt-5 flex flex-col gap-2 max-w-sm mx-auto">
        {(staff ? STAFF_STARTERS : STARTERS).map((s) => <button key={s} type="button" onClick={() => onPick(s)} className="text-right text-[13px] leading-6 rounded-xl px-3.5 py-2.5 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/20 transition flex items-center gap-2"><Icon name="chevron-left" size={14} className="text-white/40 shrink-0" />{s}</button>)}
      </div>
    </div>
  );
}

function ThreadList({ a, onPicked }: { a: Assistant; onPicked?: () => void }) {
  const { confirm } = useApp();
  const { threads, loadThreads } = a;
  useEffect(() => { if (threads === null) void loadThreads(); }, [threads, loadThreads]);
  return (
    <div className="flex flex-col min-h-0 h-full">
      <button type="button" onClick={() => { a.reset(); onPicked?.(); }} disabled={a.busy} className={BTN_G + BTN_SM + " w-full justify-center"}><Icon name="plus" size={14} />گفتگوی جدید</button>
      <div className="mt-3 flex-1 min-h-0 overflow-y-auto -mx-1 px-1 space-y-1" role="list" aria-label="گفتگوهای قبلی">
        {a.threads === null ? <div className="py-6 grid place-items-center"><Icon name="loader-circle" size={18} className="animate-spin text-white/40" /></div>
          : !a.threads.length ? <p className="text-xs text-white/45 text-center py-6">هنوز گفتگویی ندارید.</p>
          : a.threads.map((t) => (
            <div key={t.id} role="listitem" className={"group flex items-center gap-1 rounded-xl transition " + (t.id === a.threadId ? "bg-white/[0.08]" : "hover:bg-white/[0.04]")}>
              <button type="button" disabled={a.busy} onClick={() => { void a.open(t.id); onPicked?.(); }} className="flex-1 min-w-0 text-right px-3 py-2">
                <div className="text-[13px] truncate" dir="auto">{t.title}</div>
                <div className="text-[10px] text-white/40 tabular">{t.updated}{t.spent > 0 ? " · " + toman(t.spent) : ""}</div>
              </button>
              <button type="button" aria-label={"حذف گفتگوی " + t.title} disabled={a.busy} className={ICON_BTN + " opacity-60 group-hover:opacity-100 focus:opacity-100"} onClick={async () => { if (await confirm("این گفتگو حذف شود؟", { danger: true })) await a.remove(t.id); }}><Icon name="trash-2" size={14} /></button>
            </div>
          ))}
      </div>
    </div>
  );
}

function ContextChip({ context, onClear }: { context: AssistantContext; onClear: () => void }) {
  const db = useDB();
  const label = context.kind === "server" ? "سرور " + (byId(db.servers, context.id)?.name ?? context.id) : context.kind === "app" ? "اپ " + (db.paasApps?.find((x) => x.id === context.id)?.name ?? context.id) : "پایگاه داده " + context.id;
  return (
    <span className="inline-flex items-center gap-1.5 h-7 pr-2.5 pl-1 rounded-lg bg-white/[0.06] border border-white/10 text-[11px] text-white/70 max-w-full">
      <Icon name={context.kind === "server" ? "server" : context.kind === "app" ? "rocket" : "database"} size={12} className="shrink-0" />
      <span className="truncate" dir="auto">درباره {label}</span>
      <button type="button" onClick={onClear} aria-label="حذف زمینه" className="w-5 h-5 grid place-items-center rounded hover:bg-white/10 shrink-0"><Icon name="x" size={11} /></button>
    </span>
  );
}

function Composer({ a, context, onClearContext, autoFocus }: { a: Assistant; context: AssistantContext | null; onClearContext: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }, [text]);
  const submit = () => { if (a.busy || !text.trim()) return; a.send(text); setText(""); };
  return (
    <div className="border-t border-white/[0.08] p-3 shrink-0" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>
      {context && <div className="mb-2"><ContextChip context={context} onClear={onClearContext} /></div>}
      <div className="flex items-end gap-2 rounded-2xl bg-white/[0.05] border border-white/[0.1] focus-within:border-[#9cc9ff]/60 transition p-1.5">
        <label className="sr-only" htmlFor="assistant-input">پیام به دستیار</label>
        <textarea id="assistant-input" ref={ref} rows={1} value={text} style={{ outline: "none" }} autoFocus={autoFocus} dir="auto" maxLength={8000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          placeholder={a.mode === "staff" ? "بپرسید یا بخواهید… (مثلاً «سفارش‌های تحویل‌نشده»)" : "بپرسید یا بخواهید… (مثلاً «وضعیت سرورهایم»)"} className="flex-1 min-w-0 resize-none bg-transparent outline-none focus-visible:outline-none px-2.5 py-2 text-[14px] leading-6 placeholder:text-white/35 max-h-40" />
        {a.busy
          ? <button type="button" onClick={a.stop} className="w-10 h-10 shrink-0 rounded-xl grid place-items-center bg-white/10 hover:bg-white/15" aria-label="توقف"><Icon name="square" size={15} /></button>
          : <button type="button" onClick={submit} disabled={!text.trim()} className="w-10 h-10 shrink-0 rounded-xl grid place-items-center btn-p disabled:opacity-40" aria-label="ارسال"><Icon name="send" size={16} className="-scale-x-100" /></button>}
      </div>
      <p className="text-[10px] text-white/35 mt-1.5 px-1">{a.mode === "staff" ? "هزینه هر پاسخ از کیف پول شخصی شما کم می‌شود. هر اقدام پس از تأیید شما در گزارش ممیزی ثبت می‌شود." : "هزینه هر پاسخ از کیف پول کم می‌شود. دستیار ممکن است اشتباه کند؛ اقدامات حساس همیشه تأیید شما را لازم دارند."}</p>
    </div>
  );
}

function Conversation({ a, context, onClearContext, autoFocus }: { a: Assistant; context: AssistantContext | null; onClearContext: () => void; autoFocus?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const last = a.messages.at(-1);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [a.messages.length, last?.content.length, last?.tools.length, last?.confirm?.status]);
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-5" aria-live="polite" aria-busy={a.busy}>
        {a.messages.length === 0 ? <Starters onPick={a.send} staff={a.mode === "staff"} /> : a.messages.map((m) => <Bubble key={m.id} m={m} a={a} />)}
        <div ref={end} />
      </div>
      <Composer a={a} context={context} onClearContext={onClearContext} autoFocus={autoFocus} />
    </div>
  );
}

/* ---------- the drawer and its launcher ---------- */
const HIDE_ON = [/^\/panel\/assistant/, /^\/panel\/build\/[^/]+/, /\/console$/];

export function AssistantLauncher({ staff = false }: { staff?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [dropped, setDropped] = useState<string | null>(null);
  const ctx = staff ? null : contextOf(path);
  const context = ctx && dropped !== ctx.kind + ":" + ctx.id ? ctx : null;
  const a = useAssistant(context, staff ? "staff" : "customer");
  const [list, setList] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDialog<HTMLElement>(open, close);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  if (!staff && HIDE_ON.some((re) => re.test(path)) && !open) return null;
  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label={ASSISTANT.name + " (Ctrl+J)"} title={ASSISTANT.name + " (Ctrl+J)"}
          className="pop-in fixed z-40 left-4 sm:left-6 h-12 pl-4 pr-3 rounded-2xl flex items-center gap-2 text-sm font-bold shadow-2xl bg-gradient-to-l from-violet-500/80 to-sky-500/70 hover:from-violet-500 hover:to-sky-500 border border-white/20 backdrop-blur-xl transition"
          style={{ bottom: "max(1rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))" }}>
          <Icon name="sparkles" size={18} /><span className="max-sm:hidden">{ASSISTANT.name}</span>
          {a.busy && <span className="w-2 h-2 rounded-full bg-white animate-pulse" aria-hidden="true" />}
        </button>
      )}
      {open && (
        <Portal>
          <div className="fixed inset-0 z-[96] fade-in">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] max-sm:hidden" onClick={close} aria-hidden="true" />
            <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={ASSISTANT.name}
              className="drawer-in absolute inset-0 sm:inset-y-0 sm:left-0 sm:right-auto sm:w-[460px] sm:max-w-[94vw] bg-[#0b0d16] sm:border-r border-white/[0.12] flex flex-col outline-none"
              style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
              <header className="h-14 px-3 flex items-center gap-1 border-b border-white/[0.08] shrink-0">
                <span className="w-8 h-8 rounded-xl grid place-items-center bg-gradient-to-br from-violet-400/30 to-sky-400/20 border border-white/10 mr-1" aria-hidden="true"><Icon name="sparkles" size={15} /></span>
                <h2 className="font-extrabold text-[15px] flex-1 min-w-0 truncate px-1.5">{list ? "گفتگوها" : ASSISTANT.name}{staff && !list && <span className="text-[11px] font-bold text-white/50 mr-1.5">· کنسول کارمندان</span>}</h2>
                <button type="button" className={ICON_BTN} aria-label="گفتگوهای قبلی" aria-pressed={list} onClick={() => setList((l) => !l)}><Icon name="history" size={17} /></button>
                <button type="button" className={ICON_BTN} aria-label="گفتگوی جدید" disabled={a.busy} onClick={() => { a.reset(); setList(false); }}><Icon name="plus" size={17} /></button>
                {!staff && <Link href="/panel/assistant" className={ICON_BTN} aria-label="باز کردن در صفحه کامل" onClick={close}><Icon name="external-link" size={16} /></Link>}
                <button type="button" data-close className={ICON_BTN} aria-label="بستن" onClick={close}><Icon name="x" size={18} /></button>
              </header>
              {list ? <div className="flex-1 min-h-0 p-3"><ThreadList a={a} onPicked={() => setList(false)} /></div>
                : <Conversation a={a} context={context} onClearContext={() => ctx && setDropped(ctx.kind + ":" + ctx.id)} autoFocus />}
            </aside>
          </div>
        </Portal>
      )}
    </>
  );
}

/* ---------- the full page ---------- */
export function AssistantPage() {
  const a = useAssistant(null);
  const [list, setList] = useState(false);
  return (
    <div className="grid lg:grid-cols-[260px_minmax(0,1fr)] gap-4 h-[calc(100dvh-8rem)] sm:h-[calc(100dvh-10rem)] min-h-[440px]">
      <aside className={"rounded-[1.4rem] bg-white/[0.03] border border-white/[0.08] p-3 min-h-0 " + (list ? "max-lg:fixed max-lg:inset-x-4 max-lg:top-20 max-lg:bottom-4 max-lg:z-50 max-lg:bg-[#0b0d16] max-lg:shadow-2xl" : "max-lg:hidden")} aria-label="گفتگوها">
        <ThreadList a={a} onPicked={() => setList(false)} />
      </aside>
      <section className="rounded-[1.4rem] bg-white/[0.03] border border-white/[0.08] flex flex-col min-h-0 overflow-hidden">
        <header className="h-14 px-4 flex items-center gap-2 border-b border-white/[0.08] shrink-0">
          <Icon name="sparkles" size={17} className="acc" />
          <h1 className="font-extrabold text-[15px] flex-1 min-w-0 truncate">{a.threadId ? a.threads?.find((t) => t.id === a.threadId)?.title ?? ASSISTANT.name : ASSISTANT.name}</h1>
          <button type="button" className={BTN_G + BTN_SM + " lg:hidden"} onClick={() => setList((l) => !l)} aria-expanded={list}><Icon name="history" size={14} />گفتگوها</button>
          <button type="button" className={BTN_P + BTN_SM} onClick={a.reset} disabled={a.busy}><Icon name="plus" size={14} />جدید</button>
        </header>
        <Conversation a={a} context={null} onClearContext={() => {}} />
      </section>
    </div>
  );
}

/* ---------- staff: the assistant's model ---------- */
export function AssistantModelCard() {
  const { notify } = useApp();
  const [s, setS] = useState<Awaited<ReturnType<typeof api.assistant.adminSettings>> | null>(null);
  const [pick, setPick] = useState("");
  useEffect(() => { api.assistant.adminSettings().then((x) => { setS(x); setPick(x.model); }).catch(() => setS(null)); }, []);
  if (!s) return null;
  return (
    <Card title={"مدل " + ASSISTANT.name} icon="sparkles">
      <p className="text-sm text-white/65 leading-7">مدلی که دستیار پنل مشتریان با آن کار می‌کند؛ فقط مدل‌های گفتگوی فعال و قیمت‌گذاری‌شده با پشتیبانی فراخوانی ابزار. هزینه هر پاسخ با قیمت همین مدل از کیف پول مشتری کم می‌شود.</p>
      <div className="flex flex-wrap items-end gap-3 mt-3">
        <Select label="مدل دستیار" value={pick} onChange={setPick} ltr className="w-72" options={[{ value: "", label: "پیش‌فرض (" + (s.effective || "—") + ")" }, ...s.models.map((m) => ({ value: m.id, label: m.name + " — " + m.id }))]} />
        <AsyncButton className={BTN_G + " h-10 px-4 text-sm"} disabled={pick === s.model} onClick={async () => { await api.assistant.adminSetModel(pick); setS(await api.assistant.adminSettings()); notify("مدل دستیار ذخیره شد", "check"); }}>ذخیره</AsyncButton>
      </div>
      <p className="text-[11px] text-white/45 mt-2">مدل فعلی: <span className="ltr font-mono">{s.effective || "—"}</span>{s.env ? " (متغیر ASSISTANT_MODEL بر این تنظیم مقدم است)" : ""}</p>
    </Card>
  );
}

