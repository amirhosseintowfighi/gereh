"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { BUILDER, BUILDER_DEFAULT_MODEL, BUILDER_IDEAS, INCIDENT_LABEL, BUILDER_STACKS, MAINTAIN_MODES, SCAN_EVERY, type MaintainMode, PROJECT_STATUS, RUN_KIND, type BuilderEvent, type BuilderProjectSummary, type BuilderProjectView, type BuilderRunView } from "@/lib/builder";
import { BTN_G, BTN_LG, BTN_MD, BTN_P, BTN_SM, INPUT, TEXTAREA } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { api, refresh, useDB, useMyId } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, CodeBlock, Menu, Modal, Select, Switch, Tabs, useMedia } from "../ui-client";

const StatusTag = ({ s }: { s: string }) => { const [l, t] = PROJECT_STATUS[s] ?? [s, "gray"]; return <Badge tone={t} dot>{l}</Badge>; };
const useChatModels = () => useDB().ai.models.filter((m) => m.kind === "chat" && m.active);

/* ================= projects + the idea box ================= */
export function BuildHome() {
  const router = useRouter();
  const { notify } = useApp();
  const models = useChatModels();
  const [prompt, setPrompt] = useState("");
  const [stack, setStack] = useState<"auto" | "static" | "node">("auto");
  const [model, setModel] = useState(BUILDER_DEFAULT_MODEL);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<BuilderProjectSummary[] | null>(null);
  useEffect(() => { api.builder.list().then(setList).catch(() => setList([])); }, []);
  const modelId = models.some((m) => m.id === model) ? model : models[0]?.id ?? model;

  const start = async () => {
    const text = prompt.trim();
    if (text.length < 3 || busy) { if (!busy) notify("ایده‌تان را در یک یا دو جمله بنویسید", "circle-alert"); return; }
    setBusy(true);
    try {
      const id = await api.builder.create({ prompt: text, stack, model: modelId });
      router.push(("/panel/build/" + id) as never);
    } catch (e) { notify((e as Error).message, "circle-alert"); setBusy(false); }
  };

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/[0.12] bg-gradient-to-b from-violet-500/[0.12] via-white/[0.03] to-transparent p-5 sm:p-10">
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[38rem] max-w-full h-56 rounded-full bg-violet-500/20 blur-3xl" aria-hidden="true" />
        <div className="relative max-w-3xl mx-auto text-center">
          <span className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/75"><Icon name="sparkles" size={14} className="text-violet-300" />{BUILDER.name} · {BUILDER.short}</span>
          <h1 className="mt-5 text-[1.7rem] sm:text-4xl font-black leading-[1.5] tracking-tight">ایده‌تان را بنویسید؛ AI می‌سازد و منتشر می‌کند</h1>
          <p className="mt-3 text-sm sm:text-base text-white/60 leading-8">بدون برنامه‌نویسی: توضیح دهید چه می‌خواهید، پیش‌نمایش را ببینید، با گفتگو تغییرش دهید و با یک کلیک روی گره منتشرش کنید.</p>
          <div className="mt-7 rounded-3xl bg-[#0b0d16]/80 border border-white/[0.14] p-3 sm:p-4 text-right shadow-2xl shadow-violet-950/40 focus-within:border-violet-300/40 transition">
            <label htmlFor="idea" className="sr-only">ایده شما</label>
            <textarea id="idea" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} maxLength={4000}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void start(); } }}
              placeholder="مثلاً: یک سایت نوبت‌دهی برای سالن آرایش با معرفی خدمات، قیمت‌ها و فرم رزرو آنلاین"
              className="w-full resize-none bg-transparent outline-none text-base leading-8 placeholder:text-white/30 p-1" />
            <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Tabs size="sm" label="نوع پروژه" value={stack} onChange={(v) => setStack(v as typeof stack)} options={[{ id: "auto", label: "خودکار" }, ...BUILDER_STACKS.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))]} />
                {models.length > 1 && <div className="w-44 max-w-full"><Select label="مدل" value={modelId} onChange={setModel} options={models.map((m) => ({ value: m.id, label: m.name }))} /></div>}
              </div>
              <button type="button" onClick={() => void start()} disabled={busy} className={BTN_P + BTN_MD}>
                <Icon name={busy ? "loader-circle" : "sparkles"} size={17} className={busy ? "animate-spin" : ""} />بساز
              </button>
            </div>
          </div>
          <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="ایده‌های نمونه">
            {BUILDER_IDEAS.map((i) => (
              <li key={i.label}><button type="button" onClick={() => setPrompt(i.prompt)} className="inline-flex items-center gap-1.5 text-xs sm:text-sm px-3.5 py-2 rounded-full bg-white/[0.05] border border-white/[0.12] text-white/75 hover:text-white hover:border-violet-300/40 hover:bg-violet-400/10 transition"><Icon name={i.icon} size={14} />{i.label}</button></li>
            ))}
          </ul>
        </div>
      </section>

      <ol className="grid sm:grid-cols-3 gap-3">
        {[["sparkles", "بساز", "AI کد کامل سایت یا اپ را می‌نویسد و پیش‌نمایش زنده می‌دهد."], ["rocket", "منتشر کن", "با یک کلیک روی گره اپ اجرا می‌شود؛ خطای بیلد را AI خودش رفع می‌کند."], ["heart-pulse", "نگه‌دار", "عامل نگهداری اپ را می‌پاید و مشکل‌ها را تشخیص و رفع می‌کند."]].map(([ic, t, d], i) => (
          <li key={t} className="rounded-2xl p-4 bg-white/[0.035] border border-white/[0.08] flex gap-3">
            <span className="w-10 h-10 rounded-xl tile grid place-items-center shrink-0"><Icon name={ic} size={18} /></span>
            <span><b className="text-sm">{fa(i + 1)}. {t}</b><span className="block text-xs text-white/55 leading-6 mt-1">{d}</span></span>
          </li>
        ))}
      </ol>

      <Card title="پروژه‌های شما" icon="folder" pad="p-4 sm:p-6">
        {list === null ? <div className="h-24 grid place-items-center"><Icon name="loader-circle" className="animate-spin text-white/50" /></div>
          : list.length === 0 ? <Empty icon="sparkles" title="هنوز پروژه‌ای نساخته‌اید" text="یکی از ایده‌های نمونه را انتخاب کنید یا ایده خودتان را بنویسید." />
          : (
            <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {list.map((p) => (
                <li key={p.id} className="relative">
                  <Link href={("/panel/build/" + p.id) as never} className="block h-full rounded-2xl p-4 bg-white/[0.04] border border-white/[0.1] hover:border-white/25 transition">
                    <span className="flex items-start justify-between gap-2"><b className="leading-7 line-clamp-2">{p.name}</b><StatusTag s={p.status} /></span>
                    <span className="block text-xs text-white/50 mt-1">{BUILDER_STACKS.find((s) => s.id === p.stack)?.label} · نسخه {fa(p.version)} · {fa(p.files)} فایل</span>
                    {p.liveUrl && <span dir="ltr" className="block text-xs acc mt-3 truncate text-right">{p.liveUrl.replace("https://", "")}</span>}
                    <span className="flex justify-between text-[11px] text-white/50 mt-3"><span>{p.updatedAt}</span><span className="tabular">هزینه AI: {toman(p.spent)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </Card>
    </div>
  );
}

/* ================= the studio: chat + preview / code ================= */
type Live = { runId: string; status: string; plan: string; files: string[]; prompt: string };
type Device = "mobile" | "tablet" | "desktop";
const DEVICE_W: Record<Device, string> = { mobile: "390px", tablet: "820px", desktop: "100%" };

export function BuildStudio({ id }: { id: string }) {
  const router = useRouter();
  const { notify } = useApp();
  const models = useChatModels();
  const wide = useMedia("(min-width: 1024px)");
  const [v, setV] = useState<BuilderProjectView | null>(null);
  const [missing, setMissing] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [input, setInput] = useState("");
  const [pane, setPane] = useState<"chat" | "preview" | "code">("chat");
  const [right, setRight] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [showLive, setShowLive] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [modal, setModal] = useState<"" | "deploy" | "versions" | "maintain" | "rename">("");
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { const x = await api.builder.get(id); setV(x); return x; }
    catch { setMissing(true); return null; }
  }, [id]);
  const polling = !!v && !live && (v.status === "deploying" || v.status === "fixing" || v.runs.some((r) => r.status === "running"));
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => { void load().then((x) => { if (x && x.status === "live") { setReloadKey((k) => k + 1); void refresh(); } }); }, 2000);
    return () => clearInterval(t);
  }, [polling, load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [v?.messages.length, live?.files.length, live?.plan, v?.status]);

  const send = useCallback(async (text: string) => {
    const prompt = text.trim();
    if (!prompt || abort.current) return;
    setInput("");
    setLive({ runId: "", status: "در حال ارسال…", plan: "", files: [], prompt });
    if (!wide) setPane("chat");
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await fetch("/api/build/run", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ projectId: id, prompt }), signal: ctrl.signal });
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
          const ev = JSON.parse(line.slice(6)) as BuilderEvent;
          if (ev.type === "run") setLive((l) => l && { ...l, runId: ev.runId });
          else if (ev.type === "status") setLive((l) => l && { ...l, status: ev.text });
          else if (ev.type === "plan") setLive((l) => l && { ...l, plan: ev.text, status: "در حال برنامه‌ریزی…" });
          else if (ev.type === "file") setLive((l) => l && { ...l, files: [...l.files, ev.path], status: "در حال نوشتن فایل‌ها…" });
          else if (ev.type === "error") notify(ev.message, "circle-alert");
          else if (ev.type === "done") { setReloadKey((k) => k + 1); if (!wide) setPane("preview"); }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") notify((e as Error).message, "circle-alert");
    } finally {
      abort.current = null;
      setLive(null);
      await load();
      void refresh();
    }
  }, [id, load, notify, wide]);
  const stop = () => { abort.current?.abort(); notify("ساخت متوقف شد", "square"); };

  // first load; a new project starts building its idea right away
  useEffect(() => {
    api.builder.get(id).then((x) => {
      setV(x);
      if (!started.current && x.version === 0 && x.runs.length === 0 && x.description) { started.current = true; void send(x.description); }
    }).catch(() => setMissing(true));
  }, [id, send]);

  if (missing) return <Card><Empty icon="search-x" title="پروژه پیدا نشد" action={<Link href={"/panel/build" as never} className={BTN_P + BTN_MD}>بازگشت به پروژه‌ها</Link>} /></Card>;
  if (!v) return <div className="h-[60vh] grid place-items-center" aria-busy="true"><Icon name="loader-circle" size={26} className="animate-spin text-white/50" /></div>;

  const busy = !!live || v.runs.some((r) => r.status === "running" && (r.kind === "generate" || r.kind === "edit"));
  const deploying = v.status === "deploying" || v.status === "fixing";
  const unpublished = v.version > 0 && v.deployedVersion !== v.version;
  const modelId = models.some((m) => m.id === v.model) ? v.model : models[0]?.id ?? v.model;
  const frameSrc = showLive && v.liveView ? v.liveView : v.previewUrl + "?r=" + reloadKey + "-" + v.version;

  const chat = (
    <div className="flex flex-col min-h-0 h-full rounded-[1.4rem] bg-white/[0.035] border border-white/[0.1] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4 space-y-3" aria-live="polite">
        {v.messages.length === 0 && !live && <p className="text-sm text-white/50 leading-7 p-2">درخواست‌تان را بنویسید تا AI پروژه را بسازد یا تغییر دهد.</p>}
        {v.messages.map((m) => <Message key={m.id} m={m} run={m.runId ? v.runs.find((r) => r.id === m.runId) : undefined} projectId={v.id} onChange={load} links={v.liveUrl && v.liveView ? { [v.liveUrl]: v.liveView } : {}} />)}
        {live && <LiveCard live={live} onStop={stop} />}
        <div ref={bottom} />
      </div>
      {v.deploy && (deploying || v.status === "failed") && <div className="px-3 pt-3 border-t border-white/[0.08]"><DeployCard v={v} /></div>}
      <form className="border-t border-white/[0.08] p-2.5 sm:p-3 bg-black/20" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <label htmlFor="ask" className="sr-only">درخواست تغییر</label>
        <div className="flex items-end gap-2">
          <textarea id="ask" value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={4000} disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}
            placeholder={v.version ? "چه چیزی تغییر کند؟ مثلاً «رنگ را سبز کن» یا «بخش سؤالات متداول اضافه کن»" : "ایده‌تان را بنویسید…"}
            className={TEXTAREA + " min-h-[52px] max-h-40 text-sm leading-7"} />
          {live
            ? <button type="button" onClick={stop} className={BTN_G + " h-[52px] w-[52px] shrink-0 text-rose-200"} aria-label="توقف ساخت" title="توقف"><Icon name="square" size={17} /></button>
            : <button type="submit" disabled={busy || !input.trim()} className={BTN_P + " h-[52px] w-[52px] shrink-0"} aria-label="ارسال"><Icon name="send" size={18} className="-scale-x-100" /></button>}
        </div>
        <p className="mt-1.5 text-[11px] text-white/50 px-1">Enter برای ارسال · هزینه هر درخواست از کیف پول کم می‌شود</p>
      </form>
    </div>
  );

  const preview = (
    <div className="flex flex-col min-h-0 h-full rounded-[1.4rem] bg-white/[0.035] border border-white/[0.1] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-white/[0.08]">
        <div className="hidden sm:flex items-center gap-1" role="group" aria-label="اندازه نمایش">
          {([["mobile", "smartphone", "موبایل"], ["tablet", "tablet", "تبلت"], ["desktop", "monitor", "دسکتاپ"]] as const).map(([d, ic, l]) => (
            <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d} title={l} aria-label={l}
              className={"w-9 h-9 rounded-xl grid place-items-center transition " + (device === d ? "bg-white/[0.12] text-white" : "text-white/50 hover:text-white hover:bg-white/[0.06]")}><Icon name={ic} size={16} /></button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {v.liveView && <Tabs size="sm" label="نسخه" value={showLive ? "live" : "draft"} onChange={(x) => setShowLive(x === "live")} options={[{ id: "draft", label: "پیش‌نمایش" }, { id: "live", label: "منتشرشده" }]} />}
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="w-9 h-9 rounded-xl grid place-items-center text-white/55 hover:text-white hover:bg-white/[0.06]" aria-label="بارگذاری دوباره" title="بارگذاری دوباره"><Icon name="refresh-cw" size={15} /></button>
          <a href={frameSrc} target="_blank" rel="noopener noreferrer" className="w-9 h-9 rounded-xl grid place-items-center text-white/55 hover:text-white hover:bg-white/[0.06]" aria-label="باز کردن در زبانه جدید" title="زبانه جدید"><Icon name="external-link" size={15} /></a>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,.06)_1px,transparent_0)] [background-size:18px_18px] p-2 sm:p-4 flex justify-center items-stretch">
        {v.version === 0 ? <BuildingPlaceholder live={live} /> : (
          <div className="h-full transition-[width] duration-300 max-w-full" style={{ width: DEVICE_W[device] }}>
            <iframe key={frameSrc} src={frameSrc} title={"پیش‌نمایش " + v.name} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer"
              className={"w-full h-full min-h-[520px] bg-white shadow-2xl " + (device === "desktop" ? "rounded-xl" : "rounded-[1.6rem] border-[6px] border-[#1b1e2b]")} />
          </div>
        )}
      </div>
      {v.stack === "node" && v.version > 0 && !showLive && <p className="px-3 py-2 text-[11px] text-white/50 border-t border-white/[0.06]">پیش‌نمایش فقط ظاهر اپ را نشان می‌دهد؛ ذخیره اطلاعات و API پس از انتشار کار می‌کند.</p>}
    </div>
  );

  const code = <CodeView v={v} onSaved={async () => { await load(); setReloadKey((k) => k + 1); }} locked={busy} />;

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-8.5rem)]">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Link href={"/panel/build" as never} className="w-9 h-9 shrink-0 rounded-xl grid place-items-center bg-white/[0.05] border border-white/10 hover:bg-white/10" aria-label="بازگشت به پروژه‌ها"><Icon name="chevron-right" size={17} /></Link>
          <button type="button" onClick={() => setModal("rename")} className="min-w-0 text-right group" title="تغییر نام">
            <h1 className="font-black text-base sm:text-lg truncate max-w-[52vw] sm:max-w-[28rem] group-hover:text-white/85">{v.name}</h1>
          </button>
          <StatusTag s={v.status} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="hidden xl:inline-flex items-center gap-1 text-xs text-white/55 px-2"><Icon name="wallet" size={14} />هزینه AI: <b className="text-white/80 tabular">{toman(v.spent)}</b></span>
          {models.length > 1 && <div className="w-40 hidden sm:block"><Select label="مدل" value={modelId} onChange={async (m) => { await api.builder.update(v.id, { model: m }); await load(); }} options={models.map((m) => ({ value: m.id, label: m.name }))} /></div>}
          <button type="button" onClick={() => setModal("versions")} className={BTN_G + BTN_MD} title="تاریخچه نسخه‌ها"><Icon name="history" size={15} />نسخه {fa(v.version)}</button>
          {v.liveUrl && <a href={v.liveView ?? v.liveUrl} target="_blank" rel="noopener noreferrer" className={BTN_G + BTN_MD + " max-w-[13rem]"} title={v.liveUrl} aria-label={"باز کردن " + v.liveUrl}><Icon name="globe" size={15} className="text-emerald-300" /><span dir="ltr" className="truncate max-sm:hidden">{v.liveUrl.replace("https://", "")}</span></a>}
          <Menu label="بیشتر" triggerClass={BTN_G + " h-10 w-10"} trigger={<Icon name="ellipsis-vertical" size={16} />} items={[
            { icon: "heart-pulse", label: "نگهداری و سلامت", run: () => setModal("maintain") },
            ...(v.version ? [{ icon: "download", label: "دانلود کد (نسخه فعلی)", run: () => { const a = document.createElement("a"); a.href = "/api/build/download/" + v.id; a.download = ""; a.click(); } }] : []),
            { icon: "pencil", label: "تغییر نام", run: () => setModal("rename") },
            v.appId ? { icon: "rocket", label: "مدیریت اپ در گره اپ", run: () => router.push(("/panel/apps/" + v.appId) as never) } : null,
            "-",
            { icon: "trash-2", label: "حذف پروژه", danger: true, run: async () => { await api.builder.remove(v.id); notify("پروژه حذف شد", "trash-2"); router.push("/panel/build" as never); } },
          ]} />
          <button type="button" onClick={() => setModal("deploy")} disabled={!v.version || deploying || busy} className={BTN_P + BTN_MD}>
            <Icon name={deploying ? "loader-circle" : "rocket"} size={16} className={deploying ? "animate-spin" : ""} />{deploying ? (v.status === "fixing" ? "رفع خطا…" : "در حال انتشار…") : v.deployedVersion ? (unpublished ? "انتشار تغییرات" : "انتشار دوباره") : "انتشار"}
          </button>
        </div>
      </div>

      {wide ? (
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(320px,400px)_1fr] gap-3">
          {chat}
          <div className="min-h-0 flex flex-col gap-2">
            <Tabs size="sm" label="نمای پروژه" value={right} onChange={(x) => setRight(x as typeof right)} options={[{ id: "preview", label: "پیش‌نمایش", icon: "eye" }, { id: "code", label: "کد", icon: "code-xml", badge: fa(v.tree.length) }]} />
            <div className="flex-1 min-h-0">{right === "preview" ? preview : code}</div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Tabs full size="sm" label="بخش‌ها" value={pane} onChange={(x) => setPane(x as typeof pane)} options={[{ id: "chat", label: "گفتگو", icon: "message-circle" }, { id: "preview", label: "پیش‌نمایش", icon: "eye" }, { id: "code", label: "کد", icon: "code-xml" }]} />
          <div className="h-[calc(100dvh-14rem)] min-h-[460px]">{pane === "chat" ? chat : pane === "preview" ? preview : code}</div>
        </div>
      )}

      <DeployModal open={modal === "deploy"} v={v} onClose={() => setModal("")} onDone={load} />
      <VersionsModal open={modal === "versions"} v={v} onClose={() => setModal("")} onDone={async () => { await load(); setReloadKey((k) => k + 1); }} />
      <MaintainModal key={"m" + v.maintainCap} open={modal === "maintain"} v={v} onClose={() => setModal("")} onDone={load} />
      <RenameModal key={"r" + v.name} open={modal === "rename"} v={v} onClose={() => setModal("")} onDone={load} />
    </div>
  );
}

function BuildingPlaceholder({ live }: { live: Live | null }) {
  return (
    <div className="w-full max-w-xl mt-10 text-center">
      <div className="mx-auto w-16 h-16 rounded-2xl grid place-items-center bg-violet-400/15 border border-violet-300/25"><Icon name="sparkles" size={28} className={"text-violet-200 " + (live ? "animate-pulse" : "")} /></div>
      <p className="mt-4 font-bold">{live ? "AI در حال ساخت پروژه است…" : "هنوز فایلی ساخته نشده است"}</p>
      <p className="mt-2 text-sm text-white/50">{live ? "پیش‌نمایش پس از پایان ساخت اینجا نمایش داده می‌شود." : "ایده را در گفتگو بنویسید."}</p>
      <div className="mt-8 space-y-3 opacity-60" aria-hidden="true">
        {[90, 70, 80, 55].map((w, i) => <div key={i} className="h-4 rounded-full bg-white/[0.07] mx-auto animate-pulse" style={{ width: w + "%" }} />)}
      </div>
    </div>
  );
}

function LiveCard({ live, onStop }: { live: Live; onStop: () => void }) {
  return (
    <>
      <div className="flex justify-end"><div className="max-w-[88%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-7 bg-violet-500/20 border border-violet-300/20 whitespace-pre-wrap">{live.prompt}</div></div>
      <div className="rounded-2xl p-3.5 bg-white/[0.05] border border-white/[0.1]">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-bold"><Icon name="loader-circle" size={16} className="animate-spin text-violet-300" />{live.status}</span>
          <button type="button" onClick={onStop} className="text-xs text-rose-200 hover:text-rose-100 inline-flex items-center gap-1"><Icon name="square" size={12} />توقف</button>
        </div>
        {live.plan && <p className="mt-2.5 text-xs text-white/65 leading-6 whitespace-pre-line">{live.plan}</p>}
        {live.files.length > 0 && (
          <ul className="mt-3 space-y-1.5" aria-label="فایل‌ها">
            {live.files.map((f, i) => (
              <li key={f} className="flex items-center gap-2 text-xs"><Icon name={i < live.files.length - 1 ? "circle-check" : "loader-circle"} size={14} className={i < live.files.length - 1 ? "text-emerald-300" : "animate-spin text-white/50"} /><span dir="ltr" className="font-mono text-white/75">{f}</span></li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** text with its URLs as left-to-right links (the live URL may point at its simulator preview) */
function Linked({ text, links }: { text: string; links: Record<string, string> }) {
  return <>{text.split(/(https?:\/\/[^\s،]+)/).map((part, i) => i % 2 ? <a key={i} href={links[part] ?? part} target="_blank" rel="noopener noreferrer" dir="ltr" className="acc underline underline-offset-4 [unicode-bidi:isolate]">{part.replace("https://", "")}</a> : part)}</>;
}

function Message({ m, run, projectId, onChange, links }: { m: BuilderProjectView["messages"][number]; run?: BuilderRunView; projectId: string; onChange: () => unknown; links: Record<string, string> }) {
  if (m.role === "user") return <div className="flex justify-end"><div className="max-w-[88%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-7 bg-violet-500/20 border border-violet-300/20 whitespace-pre-wrap [overflow-wrap:anywhere]">{m.content}</div></div>;
  const kind = run ? RUN_KIND[run.kind] : null;
  const changed = run ? [...run.diff.added, ...run.diff.changed] : [];
  return (
    <div className="rounded-2xl rounded-br-md p-3.5 bg-white/[0.05] border border-white/[0.1]">
      {run && kind && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <Badge tone={run.kind === "fix" ? "amber" : run.kind === "maintain" ? "violet" : "blue"}><Icon name={kind.icon} size={11} />{kind.label}{run.kind === "fix" && run.attempt ? " · تلاش " + fa(run.attempt) : ""}{run.kind === "maintain" && run.incident ? " · " + (INCIDENT_LABEL[run.incident] ?? run.incident) : ""}</Badge>
          {run.status === "failed" && <Badge tone="red">ناموفق</Badge>}
          {run.status === "cancelled" && <Badge tone="gray">متوقف شد</Badge>}
          {run.version && <Badge tone="gray">نسخه {fa(run.version)}</Badge>}
          {run.cost > 0 && <span className="text-[10px] text-white/50 tabular mr-auto">{toman(run.cost)}</span>}
        </div>
      )}
      <p className="text-sm leading-7 text-white/85 whitespace-pre-line [overflow-wrap:anywhere]"><Linked text={m.content} links={links} /></p>
      {changed.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="فایل‌های تغییرکرده">
          {changed.slice(0, 8).map((f) => <li key={f} dir="ltr" className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-black/30 border border-white/[0.08] text-white/65">{run!.diff.added.includes(f) ? "+ " : "~ "}{f}</li>)}
          {changed.length > 8 && <li className="text-[10px] text-white/50">و {fa(changed.length - 8)} فایل دیگر</li>}
        </ul>
      )}
      {run?.kind === "maintain" && run.hasPatch && !run.applied && (
        <AsyncButton className={BTN_P + BTN_SM + " mt-3"} confirmText="وصله پیشنهادی اعمال و نسخه جدید منتشر شود؟" onClick={async () => { await api.builder.applyPatch(projectId, run.id); await onChange(); }}><Icon name="hammer" size={14} />اعمال وصله و انتشار</AsyncButton>
      )}
      {run?.kind === "maintain" && run.applied && <p className="mt-2 text-[11px] text-emerald-300 flex items-center gap-1"><Icon name="circle-check" size={12} />وصله اعمال شد</p>}
      <p className="mt-2 text-[10px] text-white/50">{m.at}</p>
    </div>
  );
}

const STEPS = [["queued", "آماده‌سازی فایل‌ها"], ["building", "بیلد"], ["deploying", "اجرا و بررسی سلامت"], ["live", "فعال"]] as const;
function DeployCard({ v }: { v: BuilderProjectView }) {
  const d = v.deploy!;
  const fixing = v.status === "fixing";
  const failed = v.status === "failed";
  const at = fixing ? -1 : STEPS.findIndex(([k]) => k === d.status);
  return (
    <div className={"rounded-2xl p-3.5 border " + (failed ? "bg-rose-500/[0.07] border-rose-300/25" : fixing ? "bg-amber-400/[0.07] border-amber-300/25" : "bg-sky-400/[0.06] border-sky-300/20")}>
      <div className="flex items-center justify-between gap-2">
        <b className="text-sm flex items-center gap-2"><Icon name={failed ? "circle-x" : fixing ? "hammer" : "rocket"} size={16} className={fixing ? "animate-pulse" : ""} />{failed ? "انتشار ناموفق" : fixing ? "AI در حال رفع خطای بیلد…" : "در حال انتشار"}</b>
        {d.attempt > 1 && <span className="text-[11px] text-white/55">تلاش {fa(d.attempt)}</span>}
      </div>
      {!failed && !fixing && (
        <ol className="mt-3 grid grid-cols-4 gap-1.5">
          {STEPS.map(([k, l], i) => (
            <li key={k} className="text-center">
              <span className={"block h-1.5 rounded-full " + (i < at ? "bg-emerald-400" : i === at ? "bg-sky-300 animate-pulse" : "bg-white/10")} />
              <span className={"block mt-1.5 text-[10px] leading-4 " + (i <= at ? "text-white/80" : "text-white/50")}>{l}</span>
            </li>
          ))}
        </ol>
      )}
      {d.log && (
        <details className="mt-3 group">
          <summary className="text-[11px] text-white/55 cursor-pointer hover:text-white">لاگ بیلد</summary>
          <CodeBlock className="mt-2" code={d.log.split("\n").slice(-40).join("\n")} label="لاگ بیلد" title="build.log" maxH="max-h-60" wrap />
        </details>
      )}
    </div>
  );
}

function CodeView({ v, onSaved, locked }: { v: BuilderProjectView; onSaved: () => Promise<void>; locked: boolean }) {
  const { notify } = useApp();
  const [path, setPath] = useState<string>("");
  const [content, setContent] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const cur = v.tree.some((f) => f.path === path) ? path : v.tree.find((f) => /(^|\/)index\.html$/.test(f.path))?.path ?? v.tree[0]?.path ?? "";
  useEffect(() => {
    if (!cur) return;
    let alive = true;
    api.builder.file(v.id, cur).then((c) => { if (alive) { setContent(c); setDraft(null); } }).catch(() => { if (alive) setContent(""); });
    return () => { alive = false; };
  }, [v.id, cur, v.version]);
  if (!v.tree.length) return <Card className="h-full"><Empty icon="file-text" title="هنوز فایلی نیست" text="پس از ساخت، کد پروژه اینجا نمایش داده می‌شود." /></Card>;
  const save = async () => {
    if (draft === null) return;
    await api.builder.saveFile(v.id, cur, draft);
    notify("ذخیره شد؛ نسخه جدید ساخته شد", "check");
    setDraft(null);
    await onSaved();
  };
  return (
    <div className="h-full min-h-0 grid md:grid-cols-[200px_1fr] gap-2 rounded-[1.4rem] bg-white/[0.035] border border-white/[0.1] p-2 overflow-hidden">
      <nav aria-label="فایل‌ها" className="hidden md:block min-h-0 overflow-y-auto">
        <ul className="space-y-0.5">
          {v.tree.map((f) => {
            const depth = f.path.split("/").length - 1, name = f.path.split("/").pop()!, dir = f.path.split("/").slice(0, -1).join("/");
            const prev = v.tree[v.tree.indexOf(f) - 1]?.path.split("/").slice(0, -1).join("/");
            return (
              <Fragment key={f.path}>
                {dir && dir !== prev && <li className="px-2 pt-2 pb-0.5 text-[10px] text-white/50 flex items-center gap-1" dir="ltr"><Icon name="folder" size={11} />{dir}/</li>}
                <li><button type="button" onClick={() => setPath(f.path)} dir="ltr" aria-current={cur === f.path ? "true" : undefined}
                  className={"w-full flex items-center gap-1.5 rounded-lg py-1.5 text-[12px] font-mono text-left transition " + (cur === f.path ? "bg-white/[0.1] text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white")} style={{ paddingLeft: 8 + depth * 10 }}>
                  <Icon name="file" size={12} className="shrink-0 opacity-60" /><span className="truncate">{name}</span></button></li>
              </Fragment>
            );
          })}
        </ul>
      </nav>
      <div className="min-h-0 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="md:hidden flex-1 min-w-0"><Select label="فایل" ltr value={cur} onChange={setPath} options={v.tree.map((f) => f.path)} /></div>
          <span className="hidden md:block flex-1 min-w-0 text-xs font-mono text-white/55 truncate" dir="ltr">{cur}</span>
          {draft === null
            ? <button type="button" disabled={locked || content === null} onClick={() => setDraft(content ?? "")} className={BTN_G + BTN_SM}><Icon name="pencil" size={13} />ویرایش</button>
            : <><button type="button" onClick={() => setDraft(null)} className={BTN_G + BTN_SM}>انصراف</button><AsyncButton className={BTN_P + BTN_SM} onClick={save}><Icon name="check" size={13} />ذخیره</AsyncButton></>}
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {draft !== null
            ? <textarea value={draft} onChange={(e) => setDraft(e.target.value)} dir="ltr" spellCheck={false} aria-label={"ویرایش " + cur} className="w-full h-full min-h-[360px] rounded-xl bg-black/40 border border-white/[0.1] p-3 font-mono text-[12px] leading-6 outline-none focus:border-white/30 resize-none" />
            : content === null ? <div className="h-40 grid place-items-center"><Icon name="loader-circle" className="animate-spin text-white/50" /></div>
            : <CodeBlock code={content} label={cur} title={cur} className="h-full flex flex-col [&>pre]:flex-1" maxH="max-h-[calc(100dvh-16rem)]" />}
        </div>
      </div>
    </div>
  );
}

function DeployModal({ open, v, onClose, onDone }: { open: boolean; v: BuilderProjectView; onClose: () => void; onDone: () => unknown }) {
  const { notify } = useApp();
  const db = useDB(), myId = useMyId();
  const balance = db.users.find((u) => u.id === myId)?.balance;
  const p = v.plan;
  const go = async () => {
    const r = await api.builder.deploy(v.id);
    notify(r.fixing ? "AI در حال رفع یک خطا پیش از انتشار است" : "انتشار شروع شد", "rocket");
    onClose();
    await onDone();
  };
  return (
    <Modal open={open} onClose={onClose} title={v.appId ? "انتشار نسخه " + fa(v.version) : "انتشار روی گره اپ"} icon="rocket"
      footer={<><AsyncButton onClick={go}><Icon name="rocket" size={16} />{v.appId ? "انتشار" : "ساخت اپ و انتشار"}</AsyncButton><button type="button" onClick={onClose} className={BTN_G + BTN_MD}>انصراف</button></>}>
      <div className="space-y-4 text-sm leading-7">
        {v.appId ? <p className="text-white/70">نسخه {fa(v.version)} روی اپ <b dir="ltr">{v.appName}</b> منتشر می‌شود؛ تا آماده شدن نسخه جدید، نسخه فعلی در دسترس می‌ماند.</p>
          : <p className="text-white/70">یک اپ گره با ارزان‌ترین پلن ساخته می‌شود و پروژه روی آن اجرا می‌شود. اگر بیلد خطا بدهد، AI خودش لاگ را می‌خواند و تا سه بار خطا را رفع می‌کند.</p>}
        {p && (
          <dl className="rounded-2xl bg-white/[0.04] border border-white/[0.1] divide-y divide-white/[0.06]">
            <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-white/55">پلن</dt><dd className="font-bold">{p.name}</dd></div>
            <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-white/55">هزینه اپ</dt><dd className="tabular">{toman(p.hourly)} در ساعت <span className="text-white/50">(حدود {toman(p.monthly)} در ماه)</span></dd></div>
            {p.dbMonthly > 0 && <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-white/55">پایگاه داده PostgreSQL</dt><dd className="tabular">حدود {toman(p.dbMonthly)} در ماه</dd></div>}
          </dl>
        )}
        <p className="text-xs text-white/50 flex gap-1.5"><Icon name="info" size={14} className="shrink-0 mt-1" />پرداخت ساعتی از کیف پول است و هر وقت بخواهید اپ را از بخش اپ‌ها متوقف یا حذف می‌کنید.{balance !== undefined ? " موجودی فعلی: " + toman(balance) + "." : ""}</p>
      </div>
    </Modal>
  );
}

function VersionsModal({ open, v, onClose, onDone }: { open: boolean; v: BuilderProjectView; onClose: () => void; onDone: () => Promise<void> }) {
  const token = v.previewUrl.split("/")[4];
  return (
    <Modal open={open} onClose={onClose} title="تاریخچه نسخه‌ها" icon="history" size="max-w-xl">
      {v.versions.length === 0 ? <Empty icon="history" title="هنوز نسخه‌ای ساخته نشده" /> : (
        <ol className="space-y-2">
          {v.versions.map((x) => (
            <li key={x.version} className={"rounded-2xl p-3 border flex flex-wrap items-center gap-3 " + (x.version === v.version ? "bg-violet-400/[0.08] border-violet-300/25" : "bg-white/[0.035] border-white/[0.08]")}>
              <span className="w-10 h-10 rounded-xl tile grid place-items-center text-sm font-black shrink-0">{fa(x.version)}</span>
              <span className="flex-1 min-w-0"><span className="block text-sm leading-6 [overflow-wrap:anywhere]">{x.message || "نسخه " + fa(x.version)}</span><span className="block text-[11px] text-white/50">{x.at} · {fa(x.files)} فایل{x.version === v.deployedVersion ? " · منتشرشده" : ""}</span></span>
              <span className="flex gap-1.5">
                <a href={"/api/build/preview/" + token + ".v" + x.version + "/index.html"} target="_blank" rel="noopener noreferrer" className={BTN_G + BTN_SM}><Icon name="eye" size={13} />دیدن</a>
                <a href={"/api/build/download/" + v.id + "?v=" + x.version} download className={BTN_G + BTN_SM} aria-label={"دانلود نسخه " + fa(x.version)}><Icon name="download" size={13} />دانلود</a>
                {x.version === v.version ? <Badge tone="violet">فعلی</Badge>
                  : <AsyncButton className={BTN_G + BTN_SM} confirmText={"فایل‌های نسخه " + fa(x.version) + " به‌عنوان نسخه جدید بازگردانی شود؟"} onClick={async () => { await api.builder.restore(v.id, x.version); await onDone(); onClose(); }}><Icon name="rotate-ccw" size={13} />بازگردانی</AsyncButton>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

function MaintainModal({ open, v, onClose, onDone }: { open: boolean; v: BuilderProjectView; onClose: () => void; onDone: () => unknown }) {
  const [cap, setCap] = useState(String(v.maintainCap));
  const last = v.runs.find((r) => r.kind === "maintain");
  const setMode = async (maintainMode: MaintainMode) => { await api.builder.update(v.id, { maintainMode }); await onDone(); };
  return (
    <Modal open={open} onClose={onClose} title="نگهداری و سلامت" icon="heart-pulse" size="max-w-2xl">
      <div className="space-y-5 text-sm leading-7">
        <p className="text-white/65">عامل نگهداری اپ منتشرشده را زیر نظر دارد: لاگ‌ها را می‌خواند، علت مشکل را به فارسی توضیح می‌دهد و وصله پیشنهاد می‌کند. انتخاب کنید کِی بررسی کند:</p>
        <div role="radiogroup" aria-label="حالت پایش" className="grid gap-2.5">
          {MAINTAIN_MODES.map((m) => {
            const on = v.maintainMode === m.id;
            return (
              <button key={m.id} type="button" role="radio" aria-checked={on} onClick={() => !on && setMode(m.id)}
                className={"text-right rounded-2xl border p-4 transition-colors " + (on ? "border-[var(--acc)] bg-[var(--acc)]/[0.08]" : "border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06]")}>
                <span className="flex items-center gap-2.5">
                  <span className={"size-4 rounded-full border-2 shrink-0 " + (on ? "border-[var(--acc)] bg-[var(--acc)]" : "border-white/35")} aria-hidden />
                  <Icon name={m.icon} size={16} className={on ? "acc" : "text-white/55"} />
                  <b>{m.label}</b>
                  {m.id === "incident" && <Badge tone="green">پیشنهادی</Badge>}
                </span>
                <span className="block text-xs text-white/60 leading-6 mt-1.5 ps-[3.25rem]">{m.text}</span>
                <span className={"block text-[11px] mt-1 ps-[3.25rem] " + (m.id === "continuous" ? "text-amber-200/90" : "text-white/50")}>{m.cost}</span>
                {m.id === "continuous" && on && (
                  <span className="mt-3 ms-[3.25rem] flex flex-wrap items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                    <span className="text-white/60">هر</span>
                    {SCAN_EVERY.map((n) => (
                      <span key={n} role="button" tabIndex={0} aria-pressed={v.scanEvery === n}
                        onClick={async () => { await api.builder.update(v.id, { scanEvery: n }); await onDone(); }}
                        onKeyDown={async (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); await api.builder.update(v.id, { scanEvery: n }); await onDone(); } }}
                        className={"px-2.5 h-7 inline-flex items-center rounded-lg border cursor-pointer " + (v.scanEvery === n ? "border-[var(--acc)] acc" : "border-white/15 text-white/70")}>{fa(n)} دقیقه</span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {v.maintainMode === "continuous" && (
          <p role="status" className="rounded-2xl bg-amber-400/[0.08] border border-amber-300/25 p-3.5 text-xs text-amber-100/90 leading-6">
            <Icon name="triangle-alert" size={14} className="inline -mt-0.5 me-1" />
            پایش ۲۴ ساعته در هر بررسی توکن مصرف می‌کند: حدود {toman(v.scanCost)} برای هر بار، یعنی تقریباً <b>{toman(v.continuousMonthly)} در ماه</b> با بررسی هر {fa(v.scanEvery)} دقیقه. سقف هزینه پایین همیشه رعایت می‌شود.
          </p>
        )}
        <div className="rounded-2xl bg-white/[0.04] border border-white/[0.1] p-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <span><b>نگهداری خودکار</b><span className="block text-xs text-white/50 leading-6">وصله‌ها بدون پرسش اعمال و منتشر شوند؛ در هر سه حالت (بررسی‌های خودکار حداکثر ۳ بار در روز). خاموش باشد، وصله فقط پیشنهاد می‌شود.</span></span>
            <Switch label="نگهداری خودکار" on={v.autoMaintain} onChange={async (on) => { await api.builder.update(v.id, { autoMaintain: on }); await onDone(); }} />
          </div>
          <Field label="سقف هزینه AI نگهداری در ماه (تومان)" hint={"مصرف این ماه: " + toman(v.maintainSpent)}>
            <div className="flex gap-2"><input value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d۰-۹]/g, ""))} inputMode="numeric" dir="ltr" className={INPUT} />
              <AsyncButton className={BTN_G + BTN_MD + " shrink-0"} onClick={async () => { await api.builder.update(v.id, { maintainCap: Number(cap.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))) || 0 }); await onDone(); }}>ذخیره</AsyncButton></div>
          </Field>
          {v.checkedAt && v.maintainMode !== "manual" && <p className="text-[11px] text-white/50">آخرین بررسی خودکار: {v.checkedAt}</p>}
        </div>
        {last && <div className="rounded-2xl bg-white/[0.035] border border-white/[0.08] p-4"><b className="text-xs text-white/55">آخرین تشخیص ({last.at})</b><p className="mt-1.5 whitespace-pre-line">{last.summary || "—"}</p></div>}
        <AsyncButton className={BTN_P + BTN_LG + " w-full"} disabled={!v.appId} onClick={async () => { await api.builder.healthCheck(v.id); await onDone(); onClose(); }}><Icon name="sparkles" size={16} />بررسی سلامت با AI</AsyncButton>
        {!v.appId && <p className="text-xs text-white/50 text-center -mt-3">پس از اولین انتشار در دسترس است.</p>}
        {v.appId && <p className="text-[11px] text-white/50 text-center -mt-3">یک دور کامل: اگر مشکلی باشد{v.autoMaintain ? " رفع و منتشر می‌شود" : " وصله پیشنهاد می‌شود"}؛ اگر نباشد، می‌گوید اپ سالم است.</p>}
        {v.simulator && v.appId && (
          <div className="rounded-2xl border border-dashed border-amber-300/30 bg-amber-400/[0.05] p-4">
            <p className="text-xs text-amber-100/80 leading-6">محیط نمایشی: یک توقف ناگهانی اپ (قطع اتصال پایگاه داده) شبیه‌سازی می‌شود تا واکنش عامل نگهداری را ببینید.</p>
            <AsyncButton className={BTN_G + BTN_MD + " mt-3 w-full"} onClick={async () => { await api.builder.simulateIncident(v.id); await onDone(); onClose(); }}><Icon name="zap" size={14} />شبیه‌سازی خرابی</AsyncButton>
          </div>
        )}
      </div>
    </Modal>
  );
}

function RenameModal({ open, v, onClose, onDone }: { open: boolean; v: BuilderProjectView; onClose: () => void; onDone: () => unknown }) {
  const [name, setName] = useState(v.name);
  return (
    <Modal open={open} onClose={onClose} title="نام پروژه" icon="pencil"
      footer={<AsyncButton onClick={async () => { await api.builder.update(v.id, { name: name.trim() || v.name }); await onDone(); onClose(); }}>ذخیره</AsyncButton>}>
      <Field label="نام"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={INPUT} /></Field>
    </Modal>
  );
}

