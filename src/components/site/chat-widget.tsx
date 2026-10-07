"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BTN_P, INPUT } from "@/lib/cls";
import { inline } from "@/lib/markdown";
import { useSession, useDB } from "@/lib/store";
import type { ChatMsg } from "@/lib/types";
import { Icon } from "../icon";

const KEY = "gereh_chat";
/* the visitor's chat token lives in localStorage (memory fallback in private mode), read via useSyncExternalStore */
let mem = "";
const listeners = new Set<() => void>();
const load = () => { try { return localStorage.getItem(KEY) || mem; } catch { return mem; } };
const save = (v: string) => {
  mem = v;
  try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* memory only */ }
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

async function call<T>(method: "GET" | "POST", token: string, body?: object, after = 0): Promise<T> {
  const res = await fetch("/api/chat" + (method === "GET" ? "?after=" + after : ""), {
    method, cache: "no-store", credentials: "same-origin",
    headers: { ...(token ? { "x-chat-token": token } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok) throw Object.assign(new Error(j.error || "ارتباط برقرار نشد."), { status: res.status });
  return j.result as T;
}
type View = { status: "open" | "closed"; agent: string | null; messages: ChatMsg[] };

/** floating "chat with support" button + panel on public pages; polls every 4s while open */
export function ChatWidget() {
  const session = useSession();
  const me = useDB().users[0];
  const [open, setOpen] = useState(false);
  const token = useSyncExternalStore(subscribe, load, () => "");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [status, setStatus] = useState<"open" | "closed">("open");
  const [agent, setAgent] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(0);
  const [form, setForm] = useState({ name: "", email: "", text: "" });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const last = useRef(0);
  const list = useRef<HTMLOListElement>(null);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  const apply = useCallback((v: View) => {
    setStatus(v.status); setAgent(v.agent);
    if (!v.messages.length) return;
    const seenBefore = last.current > 0; // the first load after a page refresh is history, not news
    last.current = v.messages[v.messages.length - 1].id;
    setMsgs((m) => [...m, ...v.messages.filter((x) => !m.some((y) => y.id === x.id))]);
    if (!openRef.current && seenBefore) setUnseen((n) => n + v.messages.filter((x) => x.from !== "visitor").length);
  }, []);

  const poll = useCallback(async () => {
    if (!token) return;
    try { apply(await call<View>("GET", token, undefined, last.current)); }
    catch (e) { if ((e as { status?: number }).status === 404) { save(""); setMsgs([]); last.current = 0; } }
  }, [token, apply]);

  // fast polling while the panel is open, slow in the background (for the unread badge)
  useEffect(() => {
    if (!token) return;
    void poll();
    const t = setInterval(() => { if (document.visibilityState === "visible") void poll(); }, open ? 4000 : 30000);
    return () => clearInterval(t);
  }, [token, open, poll]);

  useEffect(() => { list.current?.lastElementChild?.scrollIntoView({ block: "end" }); }, [msgs, open]);

  const start = async () => {
    setBusy(true); setError("");
    try {
      const r = await call<View & { token: string }>("POST", "", { action: "start", name: form.name || me?.name || "", email: form.email, text: form.text, page: location.pathname });
      save(r.token); setUnseen(0); apply(r);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const send = async () => {
    const t = text.trim(); if (!t) return;
    setBusy(true); setError("");
    try { await call("POST", token, { action: "send", text: t }); setText(""); await poll(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const end = async () => {
    try { await call("POST", token, { action: "close" }); } catch { /* already gone */ }
    save(""); setMsgs([]); last.current = 0; setForm({ name: "", email: "", text: "" });
  };

  return (
    <>
      {open && (
        <section role="dialog" aria-label="گفتگو با پشتیبانی" className="fixed z-40 right-3 sm:right-6 w-[min(380px,calc(100vw-1.5rem))] h-[min(560px,calc(100dvh-7rem))] rounded-3xl bg-[#0b0d16]/95 backdrop-blur-2xl border border-white/[0.14] shadow-2xl flex flex-col pop-in"
          style={{ bottom: "calc(88px + env(safe-area-inset-bottom, 0px))" }}>
          <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.08]">
            <div>
              <h2 className="font-extrabold text-sm">پشتیبانی گره</h2>
              <p className="text-[11px] text-white/55 mt-0.5">{agent ? agent + " پاسخ می‌دهد" : "معمولاً در چند دقیقه پاسخ می‌دهیم"}</p>
            </div>
            <div className="flex items-center gap-1">
              {token && <button type="button" onClick={end} className="text-[11px] text-white/55 hover:text-white px-2 h-8 rounded-lg">پایان گفتگو</button>}
              <button type="button" aria-label="بستن پنجره گفتگو" onClick={() => setOpen(false)} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-white/10"><Icon name="x" size={16} /></button>
            </div>
          </header>
          {!token ? (
            <form className="p-4 space-y-3 overflow-y-auto" onSubmit={(e) => { e.preventDefault(); void start(); }}>
              <p className="text-sm text-white/65 leading-7">سؤالتان را بنویسید؛ کارشناسان ما همین‌جا جواب می‌دهند.</p>
              {!session && <>
                <label className="block text-xs text-white/70">نام<input required minLength={2} maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT + " mt-1.5"} autoComplete="name" /></label>
                <label className="block text-xs text-white/70">ایمیل (اختیاری، برای دریافت متن گفتگو)<input type="email" maxLength={120} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" className={INPUT + " mt-1.5 text-left"} autoComplete="email" /></label>
              </>}
              <label className="block text-xs text-white/70">پیام<textarea required maxLength={2000} rows={4} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} className={INPUT + " mt-1.5 h-auto py-2.5 resize-none leading-7"} /></label>
              {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
              <button type="submit" disabled={busy} className={BTN_P + " w-full h-11 text-sm"}><Icon name="send" size={15} />شروع گفتگو</button>
            </form>
          ) : (
            <>
              <ol ref={list} aria-live="polite" className="flex-1 overflow-y-auto p-4 space-y-3">
                {msgs.map((m) => m.from === "system" ? (
                  <li key={m.id} className="text-center text-[11px] text-white/55 leading-6 px-4">{inline(m.text, "m" + m.id)}</li>
                ) : (
                  <li key={m.id} className={"max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-7 whitespace-pre-wrap break-words " + (m.from === "visitor" ? "mr-auto bg-white/[0.07] rounded-br-md" : "ml-auto bg-sky-400/15 border border-sky-300/20 rounded-bl-md")}>
                    {m.from === "staff" && <span className="block text-[11px] text-sky-200/80 mb-0.5">{m.author}</span>}
                    {m.from === "staff" ? inline(m.text, "m" + m.id) : m.text}
                    <span className="block text-[10px] text-white/45 mt-1">{m.at.split(" ").pop()}</span>
                  </li>
                ))}
              </ol>
              {status === "closed" && <p className="text-center text-[11px] text-white/55 pb-2">این گفتگو بسته شده است؛ با ارسال پیام دوباره باز می‌شود.</p>}
              <form className="p-3 border-t border-white/[0.08] flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
                <label className="sr-only" htmlFor="chat-input">پیام شما</label>
                <textarea id="chat-input" rows={1} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder="پیام خود را بنویسید…" className={INPUT + " h-auto min-h-11 max-h-32 py-2.5 resize-none leading-6"} />
                <button type="submit" disabled={busy || !text.trim()} aria-label="ارسال پیام" className={BTN_P + " w-11 h-11 shrink-0"}><Icon name="send" size={16} /></button>
              </form>
              {error && <p role="alert" className="text-xs text-rose-300 px-4 pb-3">{error}</p>}
            </>
          )}
        </section>
      )}
      <button type="button" onClick={() => { setOpen((o) => !o); setUnseen(0); }} aria-expanded={open} aria-label={open ? "بستن گفتگو با پشتیبانی" : "گفتگو با پشتیبانی" + (unseen ? "، " + unseen.toLocaleString("fa-IR") + " پیام جدید" : "")}
        className="fixed z-40 right-3 sm:right-6 w-14 h-14 rounded-2xl acc-bg grid place-items-center shadow-xl hover:scale-105 active:scale-95 transition"
        style={{ bottom: "calc(20px + env(safe-area-inset-bottom, 0px))" }}>
        <Icon name={open ? "x" : "message-circle"} size={24} />
        {unseen > 0 && !open && <span aria-hidden="true" className="absolute -top-1 -left-1 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[11px] font-bold grid place-items-center">{unseen.toLocaleString("fa-IR")}</span>}
      </button>
    </>
  );
}
