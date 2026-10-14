"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AI_FORMAT_LABEL } from "@/lib/ai";
import { chatCode, toCsv, type CodeLang } from "@/lib/ai-code";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { api, refresh, useDB } from "@/lib/store";
import type { AiChatFull, AiChatSummary, AiLogFilter, AiLogRow, AiReport } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, Bars, CodeBlock, CopyText, Modal, Select, Switch } from "../ui-client";

const num = (s: string) => Number(s.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/[^\d]/g, "")) || 0;
const STATUS: Record<string, [string, "green" | "amber" | "red" | "gray"]> = { success: ["موفق", "green"], error: ["خطا", "red"], denied: ["رد شده", "amber"], cancelled: ["لغو شده", "gray"] };

function downloadCsv(name: string, rows: (string | number | boolean | null)[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const readAs = (f: File, how: "text" | "dataUrl") => new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ko(r.error); if (how === "text") r.readAsText(f); else r.readAsDataURL(f); });

/* ================= web chat («چت») ================= */

type Msg = { id: number | string; role: "user" | "assistant"; content: string; attachments: { name: string; type: "image" | "text" }[]; charged?: number };
type Att = { name: string; type: "image" | "text"; data: string };

export function WebChat() {
  const a = useDB().ai; const { notify } = useApp();
  const chatModels = a.models.filter((m) => m.kind === "chat" && m.active);
  const [list, setList] = useState<AiChatSummary[]>([]);
  const [cur, setCur] = useState<AiChatFull | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [atts, setAtts] = useState<Att[]>([]);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<{ document: string; score: number }[]>([]);
  const [code, setCode] = useState<CodeLang | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => setList(await api.ai.chats()), []);
  useEffect(() => { api.ai.chats().then(setList).catch(() => {}); }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  const open = async (id: string) => {
    const c = await api.ai.chatGet(id);
    setCur(c); setMsgs(c.messages); setSources([]); setAtts([]);
  };
  const create = async () => {
    if (!chatModels.length) return;
    const id = await api.ai.chatCreate({ model: cur?.model && chatModels.some((m) => m.id === cur.model) ? cur.model : chatModels[0].id, system: "", temperature: 0.7, kbId: null });
    await load(); await open(id);
  };
  const patch = async (p: Partial<Pick<AiChatFull, "title" | "model" | "system" | "temperature" | "kbId">>) => {
    if (!cur) return;
    setCur({ ...cur, ...p });
    await api.ai.chatUpdate(cur.id, p);
    if (p.title || p.model) await load();
  };
  const model = chatModels.find((m) => m.id === cur?.model);

  const attach = async (files: FileList | null) => {
    for (const f of Array.from(files ?? []).slice(0, 4 - atts.length)) {
      if (f.type.startsWith("image/")) {
        if (!model?.vision) { notify("این مدل تصویر نمی‌پذیرد", "circle-alert"); continue; }
        if (f.size > 1_000_000) { notify("حداکثر حجم تصویر ۱ مگابایت است", "circle-alert"); continue; }
        const data = await readAs(f, "dataUrl");
        setAtts((x) => [...x, { name: f.name, type: "image", data }]);
      } else {
        if (f.size > 100_000) { notify("فایل متنی حداکثر ۱۰۰ کیلوبایت", "circle-alert"); continue; }
        const data = await readAs(f, "text");
        setAtts((x) => [...x, { name: f.name, type: "text", data }]);
      }
    }
  };

  const send = async () => {
    if (!cur || !input.trim() || busy) return;
    const content = input.trim();
    const user: Msg = { id: "u" + Date.now(), role: "user", content, attachments: atts.map(({ name, type }) => ({ name, type })) };
    const reply: Msg = { id: "a" + Date.now(), role: "assistant", content: "", attachments: [] };
    setMsgs((m) => [...m, user, reply]); setInput(""); setBusy(true); setSources([]);
    const sent = atts; setAtts([]);
    abort.current = new AbortController();
    try {
      const res = await fetch("/api/ai-chat", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ chatId: cur.id, content, attachments: sent }), signal: abort.current.signal });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "ارسال ناموفق بود.");
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "", text = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          const ev = JSON.parse(line.slice(6)) as { gereh?: { sources?: { document: string; score: number }[]; charged?: number }; choices?: { delta?: { content?: string } }[] };
          if (ev.gereh?.sources) setSources(ev.gereh.sources);
          if (ev.gereh?.charged !== undefined) { const charged = ev.gereh.charged; setMsgs((m) => m.map((x) => (x.id === reply.id ? { ...x, charged } : x))); }
          const d = ev.choices?.[0]?.delta?.content;
          if (d) { text += d; setMsgs((m) => m.map((x) => (x.id === reply.id ? { ...x, content: text } : x))); }
        }
      }
      await load(); void refresh();
    } catch (e) {
      if ((e as Error).name !== "AbortError") { notify((e as Error).message, "circle-alert"); setMsgs((m) => m.filter((x) => x.id !== reply.id || x.content)); }
    } finally { setBusy(false); abort.current = null; }
  };

  if (!chatModels.length) return <Empty icon="bot" title="مدل گفتگوی فعالی وجود ندارد" />;
  const codeReq = cur ? { model: cur.model, temperature: cur.temperature, stream: true, messages: [...(cur.system ? [{ role: "system" as const, content: cur.system }] : []), ...msgs.map((m) => ({ role: m.role, content: m.content })), ...(input.trim() ? [{ role: "user" as const, content: input.trim() }] : [])] } : null;

  return (
    <div className="grid lg:grid-cols-[240px_1fr] gap-4 items-start">
      <Card pad="p-3" title="گفتگوها" icon="bot" action={<button type="button" onClick={() => void create()} className={BTN_P + " h-8 px-2.5 text-xs"}><Icon name="plus" size={13} />جدید</button>}>
        {list.length === 0 ? <p className="text-xs text-white/55 leading-6">هنوز گفتگویی ندارید.</p> : (
          <ul className="space-y-1 max-h-[60vh] overflow-y-auto">
            {list.map((c) => (
              <li key={c.id} className={"group flex items-center gap-1 rounded-lg " + (cur?.id === c.id ? "bg-white/[0.08]" : "hover:bg-white/[0.04]")}>
                <button type="button" onClick={() => void open(c.id)} className="flex-1 min-w-0 text-right px-2.5 py-2"><span className="block text-xs font-bold truncate">{c.title}</span><span className="block text-[10px] text-white/45 truncate" dir="ltr" style={{ textAlign: "right" }}>{c.model}</span></button>
                <AsyncButton danger className="h-7 w-7 p-0 text-xs opacity-60 group-hover:opacity-100" title="حذف گفتگو" confirmText={"گفتگوی «" + c.title + "» حذف شود؟"} onClick={async () => { await api.ai.chatDelete(c.id); if (cur?.id === c.id) { setCur(null); setMsgs([]); } await load(); }}><Icon name="trash-2" size={12} /></AsyncButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!cur ? <Card><Empty icon="bot" title="یک گفتگو را باز کنید یا گفتگوی جدید بسازید" text="پاسخ‌ها به‌صورت زنده نمایش داده می‌شوند و هزینه مانند API از کیف پول کم می‌شود." /></Card> : (
        <div className="space-y-4 min-w-0">
          <Card pad="p-3 sm:p-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="عنوان"><input defaultValue={cur.title} key={cur.id + "t"} maxLength={80} onBlur={(e) => { const t = e.target.value.trim(); if (t && t !== cur.title) void patch({ title: t }); }} className={INPUT} /></Field>
              <Field label="مدل"><Select label="مدل" value={cur.model} onChange={(v) => void patch({ model: v })} options={chatModels.map((m) => ({ value: m.id, label: m.name + (m.vision ? " · تصویر" : "") }))} /></Field>
              <Field label={"دما (temperature): " + fa(cur.temperature)}><input type="range" min={0} max={2} step={0.1} value={cur.temperature} onChange={(e) => setCur({ ...cur, temperature: Number(e.target.value) })} onPointerUp={() => void patch({ temperature: cur.temperature })} onKeyUp={() => void patch({ temperature: cur.temperature })} className="w-full mt-3" aria-label="دما" /></Field>
              <Field label="پایگاه دانش"><Select label="پایگاه دانش" value={cur.kbId ?? ""} onChange={(v) => void patch({ kbId: v || null })} options={[{ value: "", label: "بدون پایگاه دانش" }, ...a.kbs.map((k) => ({ value: k.id, label: k.name }))]} /></Field>
            </div>
            <Field label="دستور سیستمی"><textarea key={cur.id + "s"} rows={2} defaultValue={cur.system} maxLength={8000} onBlur={(e) => { if (e.target.value !== cur.system) void patch({ system: e.target.value }); }} placeholder="مثلاً: کوتاه و به فارسی پاسخ بده." className={TEXTAREA} /></Field>
            <div className="flex items-center justify-between gap-3 mt-3 text-xs text-white/60">
              <span>هزینه این گفتگو: <b className="tabular text-white">{toman(msgs.reduce((n, m) => n + (m.charged ?? 0), 0))}</b></span>
              <span className="flex items-center gap-2">حالت Playground (نمایش کد معادل)<Switch on={!!code} onChange={(v) => setCode(v ? "curl" : null)} label="حالت Playground" /></span>
            </div>
          </Card>

          {code && codeReq && (
            <Card pad="p-3 sm:p-4" title="کد معادل این گفتگو" icon="code-xml">
              <div className="flex gap-1.5 mb-3">{(["curl", "js", "python"] as CodeLang[]).map((l) => <button key={l} type="button" aria-pressed={code === l} onClick={() => setCode(l)} className={"h-8 px-3 rounded-lg text-xs " + (code === l ? "bg-white text-black font-bold" : "bg-white/[0.05] text-white/65")}>{l === "js" ? "JavaScript" : l === "python" ? "Python" : "cURL"}</button>)}</div>
              <CodeBlock maxH="max-h-80" code={chatCode(code, a.endpoint, codeReq)} label="کد معادل این گفتگو" title={code === "js" ? "JavaScript" : code === "python" ? "Python" : "cURL"} />
              <p className="text-[11px] text-white/45 mt-2">کلید را با یک کلید API خود جایگزین کنید (متغیر GEREH_API_KEY).</p>
            </Card>
          )}

          <Card pad="p-3 sm:p-4">
            <div className="space-y-3 max-h-[55vh] overflow-y-auto mb-3" aria-live="polite">
              {msgs.length === 0 ? <p className="text-sm text-white/55 leading-7">پیامی بنویسید. {cur.kbId ? "پاسخ با کمک پایگاه دانش انتخاب‌شده ساخته می‌شود." : ""}</p>
                : msgs.map((m) => (
                  <div key={m.id} className={"rounded-2xl px-4 py-3 text-sm leading-7 whitespace-pre-wrap break-words " + (m.role === "user" ? "bg-white/[0.07] ms-8" : "bg-violet-500/10 border border-violet-300/15 me-8")}>
                    {m.content || (busy && m.role === "assistant" ? <span className="text-white/50">در حال نوشتن…</span> : "")}
                    {m.attachments.length > 0 && <span className="flex flex-wrap gap-1.5 mt-2">{m.attachments.map((x) => <Badge key={x.name} tone="blue">{x.type === "image" ? "تصویر" : "فایل"}: {x.name}</Badge>)}</span>}
                    {m.role === "assistant" && !!m.charged && <span className="block text-[10px] text-white/40 mt-1">{toman(m.charged)}</span>}
                  </div>
                ))}
              <div ref={bottom} />
            </div>
            {sources.length > 0 && <p className="text-[11px] text-white/55 mb-2">منابع: {sources.map((s) => s.document + " (" + fa(Math.round(s.score * 100)) + "٪)").join("، ")}</p>}
            {atts.length > 0 && <div className="flex flex-wrap gap-1.5 mb-2">{atts.map((x, i) => <button key={i} type="button" onClick={() => setAtts(atts.filter((_, j) => j !== i))} className="text-[11px] rounded-lg bg-white/[0.06] px-2 py-1 inline-flex items-center gap-1"><Icon name="x" size={11} />{x.name}</button>)}</div>}
            <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send(); }} placeholder="پیام شما… (Ctrl+Enter برای ارسال)" aria-label="پیام" className={TEXTAREA} />
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {busy ? <button type="button" onClick={() => abort.current?.abort()} className={BTN_G + " h-10 px-4 text-sm"}><Icon name="x" size={15} />توقف</button>
                : <button type="button" disabled={!input.trim()} onClick={() => void send()} className={BTN_P + " h-10 px-4 text-sm"}><Icon name="send" size={15} />ارسال</button>}
              <label className={BTN_G + " h-10 px-3 text-xs cursor-pointer"}><Icon name="paperclip" size={14} />پیوست<input type="file" multiple className="sr-only" accept={(model?.vision ? "image/png,image/jpeg,image/webp,image/gif," : "") + ".txt,.md,.csv,.json,.js,.ts,.py,.html,.css,.sql,.yaml,.yml"} onChange={(e) => { void attach(e.target.files); e.target.value = ""; }} /></label>
              <span className="text-[11px] text-white/45">{model?.vision ? "تصویر و فایل متنی" : "فایل متنی (این مدل تصویر نمی‌پذیرد)"}</span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ================= embedding playground ================= */

export function EmbedPlayground() {
  const models = useDB().ai.models.filter((m) => m.kind === "embedding" && m.active);
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [texts, setTexts] = useState("");
  const [query, setQuery] = useState("");
  const [res, setRes] = useState<{ ranked: { text: string; score: number }[]; dims: number; charged: number } | null>(null);
  if (!models.length) return <Empty icon="sparkles" title="مدل Embedding فعالی وجود ندارد" />;
  const list = texts.split(/\n\s*\n|\n/).map((t) => t.trim()).filter(Boolean);
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="مقایسه شباهت معنایی" icon="sparkles">
        <div className="space-y-3">
          <Field label="مدل"><Select label="مدل" value={model} onChange={setModel} options={models.map((m) => ({ value: m.id, label: m.name }))} /></Field>
          <Field label="متن‌ها" hint="هر خط یک متن (حداکثر ۵۰)"><textarea rows={7} value={texts} onChange={(e) => setTexts(e.target.value)} className={TEXTAREA} placeholder={"قیمت سرور ابری ماهانه\nطرز تهیه نان\nثبت دامنه ir"} /></Field>
          <Field label="پرسش"><input value={query} onChange={(e) => setQuery(e.target.value)} className={INPUT} placeholder="سرور ارزان" /></Field>
          <AsyncButton disabled={!list.length || list.length > 50 || !query.trim()} onClick={async () => setRes(await api.ai.embedCompare(model, list, query.trim()))}><Icon name="search" size={15} />رتبه‌بندی</AsyncButton>
        </div>
      </Card>
      <Card title="نتیجه (شباهت کسینوسی)" icon="list-checks">
        {!res ? <p className="text-sm text-white/55 leading-7">متن‌ها و پرسش را وارد کنید؛ هر متن با پرسش مقایسه و از بیشترین شباهت مرتب می‌شود.</p> : (
          <>
            <ol className="space-y-2.5">{res.ranked.map((r, i) => (
              <li key={i}><div className="flex justify-between gap-3 text-xs mb-1"><span className="truncate">{r.text}</span><span className="tabular text-white/70" dir="ltr">{r.score.toFixed(4)}</span></div>
                <div className="h-1.5 rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-violet-400/80" style={{ width: Math.max(2, Math.max(0, r.score) * 100) + "%" }} /></div></li>
            ))}</ol>
            <p className="text-[11px] text-white/45 mt-3">ابعاد بردار: {fa(res.dims)} · هزینه: {toman(res.charged)}</p>
          </>
        )}
      </Card>
    </div>
  );
}

/* ================= knowledge base («پایگاه دانش») ================= */

export function KnowledgeBases() {
  const a = useDB().ai; const { notify } = useApp();
  const models = a.models.filter((m) => m.kind === "embedding" && m.active);
  const [name, setName] = useState("");
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [search, setSearch] = useState<Record<string, string>>({});
  const [hits, setHits] = useState<Record<string, { document: string; score: number; text: string }[]>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const upload = async (kbId: string, files: FileList | null) => {
    setUploading(kbId);
    try {
      for (const f of Array.from(files ?? [])) {
        if (f.size > 5 * 1024 * 1024) { notify("«" + f.name + "» بیش از ۵ مگابایت است", "circle-alert"); continue; }
        const data = (await readAs(f, "dataUrl")).split(",")[1] ?? "";
        const r = await api.ai.kbUpload(kbId, { name: f.name, mime: f.type || "text/plain", data });
        notify("«" + f.name + "»: " + fa(r.chunks) + " قطعه، " + toman(r.charged), "circle-check");
      }
    } catch (e) { notify((e as Error).message, "circle-alert"); } finally { setUploading(null); }
  };
  return (
    <div className="space-y-4">
      <Card title="پایگاه دانش جدید" icon="book-open">
        <p className="text-xs text-white/60 leading-6 mb-3">فایل‌های txt، md، csv، json، html و pdf متنی را بارگذاری کنید؛ متن قطعه‌بندی و با مدل Embedding بردار می‌شود (هزینه مانند API). سپس در «چت» پایگاه را انتخاب کنید یا از <code dir="ltr">POST {a.endpoint}/kb/&#123;id&#125;/query</code> و ابزار MCP استفاده کنید.</p>
        {!models.length ? <p className="text-sm text-amber-200/80">مدل Embedding فعالی وجود ندارد.</p> : (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="نام"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={INPUT + " w-56"} /></Field>
            <Field label="مدل Embedding"><Select label="مدل" value={model} onChange={setModel} options={models.map((m) => ({ value: m.id, label: m.name }))} className="w-56" /></Field>
            <AsyncButton disabled={name.trim().length < 2} className={BTN_P + " h-11 px-4 text-sm"} onClick={async () => { await api.ai.kbCreate(name.trim(), model); setName(""); }}><Icon name="plus" size={14} />ساخت</AsyncButton>
          </div>
        )}
      </Card>
      {a.kbs.length === 0 ? <Empty icon="book-open" title="هنوز پایگاه دانشی نساخته‌اید" /> : a.kbs.map((kb) => (
        <Card key={kb.id} pad="p-3 sm:p-4" title={<span className="flex flex-wrap items-center gap-2">{kb.name}<Badge>{fa(kb.docs.length)} سند · {fa(kb.chunks)} قطعه</Badge><CopyText text={kb.id} className="text-[11px] font-mono text-white/50" /></span>}
          action={<AsyncButton danger className="h-8 px-3 text-xs" confirmText={"پایگاه «" + kb.name + "» و همه اسنادش حذف شود؟"} onClick={() => api.ai.kbDelete(kb.id)}><Icon name="trash-2" size={13} />حذف</AsyncButton>}>
          <ul className="divide-y divide-white/[0.06] mb-3">
            {kb.docs.map((d) => (
              <li key={d.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0"><b className="truncate block">{d.name}</b><span className="text-white/45">{d.mime} · {fa(d.chars)} نویسه · {fa(d.chunks)} قطعه · {toman(d.charged)} · {d.at}</span></span>
                <AsyncButton danger className="h-7 px-2 text-[11px]" onClick={() => api.ai.kbDocDelete(d.id)}>حذف</AsyncButton>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <label className={BTN_G + " h-9 px-3 text-xs cursor-pointer" + (uploading === kb.id ? " opacity-60 pointer-events-none" : "")}><Icon name="upload" size={13} />{uploading === kb.id ? "در حال پردازش…" : "بارگذاری فایل"}<input type="file" multiple className="sr-only" accept=".txt,.md,.csv,.json,.html,.htm,.pdf" onChange={(e) => { void upload(kb.id, e.target.files); e.target.value = ""; }} /></label>
            <input value={search[kb.id] ?? ""} onChange={(e) => setSearch({ ...search, [kb.id]: e.target.value })} placeholder="جست‌وجوی آزمایشی…" aria-label="جست‌وجو در پایگاه دانش" className={INPUT + " h-9 flex-1 min-w-40"} />
            <AsyncButton disabled={!search[kb.id]?.trim() || !kb.chunks} className={BTN_G + " h-9 px-3 text-xs"} onClick={async () => { const r = await api.ai.kbSearch(kb.id, search[kb.id].trim()); setHits({ ...hits, [kb.id]: r.hits }); }}><Icon name="search" size={13} />جست‌وجو</AsyncButton>
          </div>
          {hits[kb.id] && <ol className="mt-3 space-y-2">{hits[kb.id].map((h, i) => <li key={i} className="rounded-xl bg-white/[0.03] p-3 text-xs leading-6"><span className="flex justify-between text-white/55 mb-1"><span>{h.document}</span><span dir="ltr">{h.score.toFixed(3)}</span></span><span className="whitespace-pre-wrap line-clamp-4">{h.text}</span></li>)}</ol>}
        </Card>
      ))}
    </div>
  );
}

/* ================= request logs ================= */

export function RequestLogs() {
  const a = useDB().ai;
  const [f, setF] = useState<AiLogFilter>({ days: 7 });
  const [data, setData] = useState<{ total: number; rows: AiLogRow[] } | null>(null);
  const [body, setBody] = useState<{ id: string; request: string; response: string } | null>(null);
  useEffect(() => { api.ai.logs(f).then(setData).catch(() => {}); }, [f]);
  const models = [...new Set(a.usage.map((u) => u.model).concat(data?.rows.map((r) => r.model) ?? []))];
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] px-4 py-3 text-xs leading-6 text-emerald-100/90 flex gap-2"><Icon name="eye-off" size={15} className="shrink-0 mt-0.5" />
        <span>متن درخواست‌ها و پاسخ‌ها به‌طور پیش‌فرض ذخیره نمی‌شود؛ فقط مدل، توکن، هزینه، زمان پاسخ و دلیل پایان نگه داشته می‌شود. {a.settings.logBodies ? "ثبت متن را در «تنظیمات» روشن کرده‌اید." : "برای اشکال‌زدایی می‌توانید ثبت متن را در «تنظیمات» روشن کنید."} گزارش‌ها {fa(a.settings.retentionDays)} روز نگه داشته می‌شوند.</span></div>
      <Card pad="p-3 sm:p-4" title={<span className="flex items-center gap-2">گزارش درخواست‌ها {data && <Badge>{fa(data.total)}</Badge>}</span>} icon="scroll-text"
        action={data && data.rows.length > 0 ? <button type="button" className={BTN_G + " h-8 px-3 text-xs"} onClick={() => downloadCsv("gereh-ai-logs.csv", [["id", "time", "key", "model", "format", "status", "finish", "tokens_in", "tokens_out", "units", "cost_toman", "latency_ms", "error"], ...data.rows.map((r) => [r.id, r.iso, r.keyName, r.model, r.format, r.status, r.finish, r.inTokens, r.outTokens, r.units, r.charged, r.latencyMs, r.error])])}><Icon name="download" size={13} />CSV</button> : undefined}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <Select label="بازه" value={String(f.days)} onChange={(v) => setF({ ...f, days: Number(v), offset: 0 })} options={[{ value: "1", label: "۲۴ ساعت" }, { value: "7", label: "۷ روز" }, { value: "30", label: "۳۰ روز" }, { value: "60", label: "۶۰ روز" }]} />
          <Select label="کلید" value={f.keyId ?? ""} onChange={(v) => setF({ ...f, keyId: v || undefined, offset: 0 })} options={[{ value: "", label: "همه کلیدها" }, { value: "panel", label: "پنل" }, ...a.keys.map((k) => ({ value: k.id, label: k.name }))]} />
          <Select label="مدل" value={f.model ?? ""} onChange={(v) => setF({ ...f, model: v || undefined, offset: 0 })} options={[{ value: "", label: "همه مدل‌ها" }, ...models.map((m) => ({ value: m, label: m }))]} />
          <Select label="وضعیت" value={f.status ?? ""} onChange={(v) => setF({ ...f, status: (v || undefined) as AiLogFilter["status"], offset: 0 })} options={[{ value: "", label: "همه وضعیت‌ها" }, ...Object.entries(STATUS).map(([value, [label]]) => ({ value, label }))]} />
          <Select label="پروژه" value={f.projectId ?? ""} onChange={(v) => setF({ ...f, projectId: v || undefined, offset: 0 })} options={[{ value: "", label: "همه پروژه‌ها" }, ...a.projects.map((p) => ({ value: p.id, label: p.name }))]} />
        </div>
        {!data ? <p className="text-sm text-white/55">در حال بارگذاری…</p> : data.rows.length === 0 ? <Empty icon="activity" title="درخواستی با این فیلترها نیست" /> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="درخواست‌ها">
            <table className="w-full text-xs min-w-[760px]">
              <thead><tr className="text-white/55 text-right"><th className="p-2">زمان</th><th className="p-2">کلید</th><th className="p-2">مدل</th><th className="p-2">وضعیت</th><th className="p-2">توکن ورودی / خروجی</th><th className="p-2">هزینه</th><th className="p-2">تأخیر</th><th className="p-2">پایان</th><th className="p-2" /></tr></thead>
              <tbody>{data.rows.map((r) => { const [label, tone] = STATUS[r.status] ?? [r.status, "gray"]; return (
                <tr key={r.id} className="border-t border-white/[0.06]">
                  <td className="p-2 whitespace-nowrap">{r.at}</td><td className="p-2">{r.keyName}</td>
                  <td className="p-2"><span dir="ltr" className="font-mono">{r.model}</span><span className="block text-[10px] text-white/40">{AI_FORMAT_LABEL[r.format] ?? r.format}{r.stream ? " · stream" : ""}</span></td>
                  <td className="p-2"><Badge tone={tone}>{label}</Badge>{r.error && <span className="block text-[10px] text-rose-300/80 max-w-40 truncate" title={r.error}>{r.error}</span>}</td>
                  <td className="p-2 tabular">{fa(r.inTokens)} / {fa(r.outTokens)}{r.units ? " · " + fa(r.units) + " واحد" : ""}{r.estimated ? " (تخمینی)" : ""}</td>
                  <td className="p-2 tabular">{toman(r.charged)}</td><td className="p-2 tabular">{fa(r.latencyMs)}ms</td><td className="p-2" dir="ltr">{r.finish || "—"}</td>
                  <td className="p-2">{r.hasBody && <AsyncButton className={BTN_G + " h-7 px-2 text-[11px]"} onClick={async () => { const b = await api.ai.logBody(r.id); if (b) setBody({ id: r.id, ...b }); }}>متن</AsyncButton>}</td>
                </tr>
              ); })}</tbody>
            </table>
          </div>
        )}
        {data && data.total > 100 && <div className="flex justify-center gap-2 mt-3">
          <button type="button" disabled={!f.offset} onClick={() => setF({ ...f, offset: Math.max(0, (f.offset ?? 0) - 100) })} className={BTN_G + " h-8 px-3 text-xs"}>قبلی</button>
          <button type="button" disabled={(f.offset ?? 0) + 100 >= data.total} onClick={() => setF({ ...f, offset: (f.offset ?? 0) + 100 })} className={BTN_G + " h-8 px-3 text-xs"}>بعدی</button>
        </div>}
      </Card>
      <Modal open={!!body} onClose={() => setBody(null)} title="متن درخواست و پاسخ" icon="scroll-text" size="max-w-3xl">
        {body && <div className="space-y-3 text-xs"><p className="text-white/50" dir="ltr">{body.id}</p>
          <Field label="درخواست"><pre dir="auto" className="whitespace-pre-wrap break-words bg-black/40 rounded-xl p-3 max-h-64 overflow-y-auto">{body.request}</pre></Field>
          <Field label="پاسخ"><pre dir="auto" className="whitespace-pre-wrap break-words bg-black/40 rounded-xl p-3 max-h-64 overflow-y-auto">{body.response}</pre></Field></div>}
      </Modal>
    </div>
  );
}

/* ================= usage dashboards ================= */

export function UsageReport() {
  const [days, setDays] = useState<7 | 30 | 60>(30);
  const [r, setR] = useState<AiReport | null>(null);
  useEffect(() => { void api.ai.report(days).then(setR).catch(() => {}); }, [days]);
  const head = ["requests", "cost_toman", "tokens_in", "tokens_out", "errors"];
  const nums = (x: { count: number; spend: number; inTokens: number; outTokens: number; errors: number }) => [x.count, x.spend, x.inTokens, x.outTokens, x.errors];
  const table = (title: string, icon: string, rows: { label: string; count: number; spend: number; inTokens: number; outTokens: number; errors: number }[], csv: () => void) => (
    <Card pad="p-3 sm:p-4" title={title} icon={icon} action={rows.length ? <button type="button" onClick={csv} className={BTN_G + " h-8 px-3 text-xs"}><Icon name="download" size={13} />CSV</button> : undefined}>
      {rows.length === 0 ? <p className="text-sm text-white/55">مصرفی ثبت نشده است.</p> : <ul className="space-y-2.5">{rows.map((b) => { const max = Math.max(...rows.map((x) => x.spend)) || 1; return (
        <li key={b.label}><div className="flex justify-between gap-3 text-xs mb-1"><span dir="auto" className="truncate">{b.label}</span><span className="tabular text-white/70 whitespace-nowrap">{toman(b.spend)} · {fa(b.count)} درخواست{b.errors ? " · " + fa(b.errors) + " خطا" : ""}</span></div>
          <div className="h-1.5 rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-violet-400/80" style={{ width: Math.max(2, (b.spend / max) * 100) + "%" }} /></div></li>
      ); })}</ul>}
    </Card>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-40"><Select label="بازه" value={String(days)} onChange={(v) => setDays(Number(v) as 7 | 30 | 60)} options={[{ value: "7", label: "۷ روز اخیر" }, { value: "30", label: "۳۰ روز اخیر" }, { value: "60", label: "۶۰ روز اخیر" }]} /></div>
        {r && r.daily.length > 0 && <button type="button" className={BTN_G + " h-9 px-3 text-xs"} onClick={() => downloadCsv("gereh-ai-daily.csv", [["day", ...head], ...r.daily.map((d) => [d.day, ...nums(d)])])}><Icon name="download" size={13} />CSV روزانه</button>}
      </div>
      {!r ? <p className="text-sm text-white/55">در حال بارگذاری…</p> : (
        <>
          <Card title="هزینه روزانه" icon="chart-column">
            {r.daily.length > 1 ? <Bars data={r.daily.map((d) => d.spend)} labels={r.daily.map((d) => d.label.split("/").slice(-2).join("/"))} height={150} fmt={(v) => toman(v)} /> : <p className="text-sm text-white/55">پس از چند روز استفاده، نمودار اینجا نمایش داده می‌شود.</p>}
          </Card>
          <div className="grid lg:grid-cols-3 gap-4">
            {table("به تفکیک مدل", "layers", r.byModel.map((m) => ({ ...m, label: m.model })), () => downloadCsv("gereh-ai-models.csv", [["model", ...head], ...r.byModel.map((m) => [m.model, ...nums(m)])]))}
            {table("به تفکیک کلید", "key-round", r.byKey.map((k) => ({ ...k, label: k.keyName })), () => downloadCsv("gereh-ai-keys.csv", [["key_id", "key", ...head], ...r.byKey.map((k) => [k.keyId, k.keyName, ...nums(k)])]))}
            {table("به تفکیک پروژه", "folder-open", r.byProject.map((p) => ({ ...p, label: p.name })), () => downloadCsv("gereh-ai-projects.csv", [["project_id", "project", ...head], ...r.byProject.map((p) => [p.projectId, p.name, ...nums(p)])]))}
          </div>
        </>
      )}
    </div>
  );
}

/* ================= projects and settings ================= */

export function Projects() {
  const a = useDB().ai;
  const [edit, setEdit] = useState<{ id?: string; name: string; limit: string } | null>(null);
  return (
    <Card pad="p-3 sm:p-4" title="پروژه‌ها" icon="folder-open" action={<button type="button" onClick={() => setEdit({ name: "", limit: "" })} className={BTN_P + " h-9 px-3 text-xs"}><Icon name="plus" size={14} />پروژه جدید</button>}>
      <p className="text-xs text-white/55 leading-6 mb-3">کلیدها را در پروژه‌ها گروه‌بندی کنید و برای هر پروژه سقف هزینه ماهانه بگذارید؛ با رسیدن به سقف، درخواست همه کلیدهای پروژه با خطای project_budget_exceeded رد می‌شود.</p>
      {a.projects.length === 0 ? <Empty icon="folder-open" title="پروژه‌ای ندارید" /> : (
        <ul className="divide-y divide-white/[0.06]">{a.projects.map((p) => (
          <li key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0"><b className="text-sm">{p.name}</b><span className="block text-[11px] text-white/55 mt-1">{fa(p.keys)} کلید · این ماه {toman(p.spentMonth)}{p.monthlyLimit ? " از سقف " + toman(p.monthlyLimit) : " (بدون سقف)"}</span>
              {p.monthlyLimit > 0 && <span className="block h-1.5 w-48 rounded-full bg-white/[0.06] mt-1.5"><span className={"block h-full rounded-full " + (p.spentMonth >= p.monthlyLimit ? "bg-rose-400" : "bg-violet-400/80")} style={{ width: Math.min(100, (p.spentMonth / p.monthlyLimit) * 100) + "%" }} /></span>}</span>
            <span className="flex gap-2"><button type="button" onClick={() => setEdit({ id: p.id, name: p.name, limit: p.monthlyLimit ? String(p.monthlyLimit) : "" })} className={BTN_G + " h-8 px-3 text-xs"}><Icon name="pencil" size={12} />ویرایش</button>
              <AsyncButton danger className="h-8 px-3 text-xs" confirmText={"پروژه «" + p.name + "» حذف شود؟ کلیدهایش بدون پروژه می‌مانند."} onClick={() => api.ai.projectDelete(p.id)}>حذف</AsyncButton></span>
          </li>
        ))}</ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "ویرایش پروژه" : "پروژه جدید"} icon="folder-open">
        {edit && <div className="space-y-3">
          <Field label="نام"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={40} className={INPUT} /></Field>
          <Field label="سقف هزینه ماهانه (تومان)" hint="۰ یعنی بدون سقف"><input inputMode="numeric" value={edit.limit ? fa(num(edit.limit)) : ""} placeholder="۰" onChange={(e) => setEdit({ ...edit, limit: String(num(e.target.value)) })} className={INPUT + " tabular"} /></Field>
          <AsyncButton disabled={edit.name.trim().length < 2} className={BTN_P + " w-full h-11"} onClick={async () => { await api.ai.projectSave({ id: edit.id, name: edit.name.trim(), monthlyLimit: num(edit.limit) }); setEdit(null); }}>ذخیره</AsyncButton>
        </div>}
      </Modal>
    </Card>
  );
}

export function AiSettingsCard() {
  const s = useDB().ai.settings; const { notify } = useApp();
  const [f, setF] = useState(s);
  const [low, setLow] = useState(s.lowBalance ? String(s.lowBalance) : "");
  return (
    <Card title="تنظیمات API هوش مصنوعی" icon="settings-2">
      <div className="space-y-4 max-w-xl">
        <Field label="مدت نگهداری گزارش درخواست‌ها"><Select label="نگهداری" value={String(f.retentionDays)} onChange={(v) => setF({ ...f, retentionDays: Number(v) as 30 | 60 })} options={[{ value: "30", label: "۳۰ روز" }, { value: "60", label: "۶۰ روز" }]} /></Field>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3 text-sm">
          <span>ثبت متن درخواست و پاسخ<span className="block text-[11px] text-white/50 leading-5 mt-0.5">به‌طور پیش‌فرض خاموش است و متن پرامپت‌ها ذخیره نمی‌شود. با روشن کردن، متن درخواست‌های بعدی برای اشکال‌زدایی در گزارش نگه داشته و پس از مدت نگهداری پاک می‌شود.</span></span>
          <Switch on={f.logBodies} onChange={(v) => setF({ ...f, logBodies: v })} label="ثبت متن درخواست" />
        </div>
        <Field label="هشدار کم بودن موجودی (تومان)" hint="وقتی موجودی کیف پول کمتر از این مبلغ شود اعلان و پیام می‌گیرید؛ ۰ یعنی خاموش"><input inputMode="numeric" value={low ? fa(num(low)) : ""} placeholder="۰" onChange={(e) => setLow(String(num(e.target.value)))} className={INPUT + " tabular"} /></Field>
        <AsyncButton onClick={async () => { await api.ai.saveSettings({ ...f, lowBalance: num(low) }); notify("تنظیمات ذخیره شد", "circle-check"); }}>ذخیره</AsyncButton>
      </div>
    </Card>
  );
}
