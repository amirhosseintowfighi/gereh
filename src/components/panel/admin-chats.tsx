"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BTN_G, BTN_P, INPUT } from "@/lib/cls";
import { inline } from "@/lib/markdown";
import { api, refresh, useDB } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty } from "../ui";
import { PageTitle, Tabs } from "../ui-client";

/** staff inbox for site live chat; polls every 5s while open */
export function AdminChats() {
  const db = useDB();
  const { notify } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState("open");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const chats = db.chats.filter((c) => c.status === tab);
  const sel = db.chats.find((c) => c.id === params.get("id")) ?? null;

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (sel?.unread && sel.status === "open") void api.chat.read(sel.id).catch(() => {}); }, [sel?.id, sel?.unread, sel?.status]);
  useEffect(() => { list.current?.lastElementChild?.scrollIntoView({ block: "end" }); }, [sel?.messages.length]);

  const pick = (id: string) => router.replace(("/admin/chats?id=" + id) as never, { scroll: false });
  const reply = async () => {
    if (!sel || !text.trim()) return;
    setBusy(true);
    try { await api.chat.reply(sel.id, text); setText(""); } catch (e) { notify((e as Error).message, "circle-alert"); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle title="گفتگوی آنلاین" sub="پیام‌های ویجت گفتگوی سایت؛ هر ۵ ثانیه به‌روز می‌شود." />
      <div className="grid lg:grid-cols-[22rem_1fr] gap-4 items-start">
        <Card pad="p-3">
          <Tabs size="sm" full value={tab} onChange={setTab} label="وضعیت گفتگو" options={[{ id: "open", label: "باز (" + db.chats.filter((c) => c.status === "open").length.toLocaleString("fa-IR") + ")" }, { id: "closed", label: "بسته‌شده" }]} />
          <ul className="mt-3 space-y-1 max-h-[65vh] overflow-y-auto">
            {chats.length === 0 && <li><Empty icon="headset" title="گفتگویی نیست" /></li>}
            {chats.map((c) => {
              const lastMsg = [...c.messages].reverse().find((m) => m.from !== "system");
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => pick(c.id)} aria-current={sel?.id === c.id}
                    className={"w-full text-right p-3 rounded-xl transition " + (sel?.id === c.id ? "bg-white/[0.08]" : "hover:bg-white/[0.04]")}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm truncate">{c.name}</span>
                      <span className="flex items-center gap-1.5 shrink-0">{c.unread && c.status === "open" && <Badge tone="blue" dot>جدید</Badge>}<span className="text-[10px] text-white/50">{c.lastAt.split(" ").pop()}</span></span>
                    </span>
                    <span className="block text-xs text-white/55 truncate mt-1">{lastMsg ? (lastMsg.from === "staff" ? "شما: " : "") + lastMsg.text : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card pad="p-0">
          {!sel ? <div className="p-6"><Empty icon="message-circle" title="یک گفتگو را انتخاب کنید" /></div> : (
            <div className="flex flex-col h-[70vh]">
              <header className="p-4 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-extrabold">{sel.name} {sel.userId && <Badge tone="green">مشتری {sel.userId}</Badge>}</h2>
                  <p className="text-[11px] text-white/55 mt-1 flex flex-wrap gap-x-3">{sel.email && <span className="ltr">{sel.email}</span>}<span>شروع {sel.at}</span>{sel.page && <span className="ltr">{sel.page}</span>}</p>
                </div>
                {sel.status === "open" && <button type="button" onClick={async () => { await api.chat.close(sel.id); notify("گفتگو بسته شد"); }} className={BTN_G + " h-9 px-3 text-xs"}><Icon name="circle-check" size={14} />بستن گفتگو</button>}
              </header>
              <ol ref={list} aria-live="polite" className="flex-1 overflow-y-auto p-4 space-y-3">
                {sel.messages.map((m) => m.from === "system" ? (
                  <li key={m.id} className="text-center text-[11px] text-white/50 px-6 leading-6">{inline(m.text, "a" + m.id)}</li>
                ) : (
                  <li key={m.id} className={"max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm leading-7 whitespace-pre-wrap break-words " + (m.from === "staff" ? "mr-auto bg-sky-400/15 border border-sky-300/20" : "ml-auto bg-white/[0.07]")}>
                    <span className="block text-[11px] text-white/55 mb-0.5">{m.from === "staff" ? m.author : sel.name}</span>
                    {m.text}
                    <span className="block text-[10px] text-white/45 mt-1">{m.at}</span>
                  </li>
                ))}
              </ol>
              <form className="p-3 border-t border-white/[0.08] flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void reply(); }}>
                <label className="sr-only" htmlFor="chat-reply">پاسخ</label>
                <textarea id="chat-reply" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void reply(); } }}
                  placeholder="پاسخ خود را بنویسید… (Enter ارسال، Shift+Enter خط جدید)" className={INPUT + " h-auto py-2.5 resize-none leading-6"} />
                <button type="submit" disabled={busy || !text.trim()} className={BTN_P + " h-11 px-4 text-sm shrink-0"}><Icon name="send" size={15} />ارسال</button>
              </form>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
