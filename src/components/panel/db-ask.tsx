"use client";
/* «پرسش از دیتابیس»: a question in plain words → a read-only query the person reviews, edits and runs; the result as a
   typed table, an automatic chart and CSV; the history with saved queries. The database tab «پرسش با هوش مصنوعی» and
   /panel/db-ask share it. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BTN_G, BTN_MD, BTN_P, BTN_SM, TEXTAREA } from "@/lib/cls";
import { DBQ, DBQ_LIMITS, dbqLang, dbqSupported, pickChart, toCsv, type ChartType, type DbqAnalysis, type DbqAnswer, type DbqChart, type DbqHistoryItem, type DbqOverview, type DbqResult } from "@/lib/dbquery";
import { dbqueryApi } from "@/lib/dbquery-api";
import { fa, toman } from "@/lib/format";
import { engineOf } from "@/lib/paas";
import { useDB, useMyId } from "@/lib/store";
import type { PaasDb } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty } from "../ui";
import { AreaChart, AsyncButton, Bars, CodeBlock, PageTitle, Select, Switch } from "../ui-client";

const PAGE = 25;
const TYPE_LABEL: Record<string, string> = { number: "عدد", text: "متن", date: "تاریخ", bool: "بله/خیر", json: "JSON" };
const CHARTS: { id: ChartType; label: string; icon: string }[] = [{ id: "bar", label: "میله‌ای", icon: "chart-column" }, { id: "line", label: "خطی", icon: "chart-line" }, { id: "pie", label: "دایره‌ای", icon: "gauge" }, { id: "table", label: "فقط جدول", icon: "table" }];
const placeholder = (engine: string) => engine === "redis" ? "مثلاً: کلیدهای session را نشان بده" : engine === "mongodb" ? "مثلاً: تعداد سفارش‌ها به تفکیک وضعیت" : "مثلاً: فروش هفته گذشته به تفکیک روز چقدر بود؟";

/* ---------------- the standalone page ---------------- */
export function DbAskPage({ initial }: { initial?: string }) {
  const db = useDB(); const myId = useMyId(); const router = useRouter();
  const dbs = db.paasDbs.filter((d) => d.userId === myId && dbqSupported(d.engine));
  const [id, setId] = useState(initial && dbs.some((d) => d.id === initial) ? initial : dbs.find((d) => d.status === "running")?.id ?? dbs[0]?.id ?? "");
  const d = dbs.find((x) => x.id === id);
  return (
    <div>
      <PageTitle title={DBQ.name} sub="پرسش‌تان را به فارسی یا هر زبانی بنویسید؛ کوئری فقط‌خواندنی ساخته می‌شود و پیش از اجرا آن را می‌بینید."
        action={dbs.length > 1 ? <div className="w-64 max-w-full"><Select label="پایگاه داده" ltr value={id} onChange={(v) => { setId(v); router.replace(("/panel/db-ask?db=" + v) as never); }} options={dbs.map((x) => ({ value: x.id, label: x.name + " · " + (engineOf(x.engine)?.label ?? x.engine) }))} /></div> : undefined} />
      {!d ? (
        <Card><Empty icon="database" title="پایگاه داده‌ای برای پرسش ندارید" text="پرسش از دیتابیس برای PostgreSQL، MySQL، MariaDB، MongoDB و Redis در دسترس است."
          action={<Link href="/panel/databases" className={BTN_P + BTN_MD}>ساخت پایگاه داده</Link>} /></Card>
      ) : <DbAsk key={d.id} d={d} />}
    </div>
  );
}

/* ---------------- one database ---------------- */
export function DbAsk({ d }: { d: PaasDb }) {
  const { notify } = useApp();
  const [ov, setOv] = useState<DbqOverview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [database, setDatabase] = useState(d.dbName);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<DbqAnswer | null>(null);
  const [historyId, setHistoryId] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<DbqResult | null>(null);
  const [chart, setChart] = useState<DbqChart>({ type: "table", x: "", y: "" });
  const [runError, setRunError] = useState("");
  const [analysis, setAnalysis] = useState<DbqAnalysis | null>(null);
  const ok = dbqSupported(d.engine) && d.status === "running";

  const load = useCallback(async (dbName?: string) => {
    setLoadError("");
    try { const o = await dbqueryApi.overview(d.id, dbName); setOv(o); setDatabase(o.database); } catch (e) { setLoadError((e as Error).message); }
  }, [d.id]);
  useEffect(() => {
    if (!ok) return;
    dbqueryApi.overview(d.id).then((o) => { setOv(o); setDatabase(o.database); }).catch((e: Error) => setLoadError(e.message));
  }, [ok, d.id]);

  if (!dbqSupported(d.engine)) return <Card><Empty icon="sparkles" title={DBQ.name + " برای این موتور در دسترس نیست"} text="PostgreSQL، MySQL، MariaDB، MongoDB و Redis پشتیبانی می‌شوند." /></Card>;
  if (d.status !== "running") return <Card><Empty icon="database" title="پایگاه داده روشن نیست" /></Card>;

  const show = (h: Pick<DbqHistoryItem, "id" | "query" | "chart">) => { setHistoryId(h.id); setQuery(h.query); setChart(h.chart); setResult(null); setAnalysis(null); setRunError(""); };
  const ask = async (q = question) => {
    if (!q.trim()) return;
    setQuestion(q);
    const a = await dbqueryApi.ask(d.id, database, q);
    setAnswer(a); show(a); setEditing(!!a.error);
    if (a.charged) notify("هزینه هوش مصنوعی: " + toman(a.charged), "sparkles");
    void load(database);
  };
  const run = async (q = query, hid = historyId) => {
    setRunError(""); setAnalysis(null);
    try {
      const r = await dbqueryApi.run(d.id, database, q, hid || undefined);
      setResult(r.result); setQuery(r.query); setHistoryId(r.historyId); setEditing(false);
      setChart(pickChart(r.result, r.chart));
      void load(database);
    } catch (e) { setRunError((e as Error).message); setResult(null); }
  };
  const lang = dbqLang(d.engine);

  return (
    <div className="grid xl:grid-cols-[1fr_20rem] gap-4 items-start">
      <div className="space-y-4 min-w-0">
        <Card title="پرسش" icon="sparkles" action={ov && ov.databases.length > 1 ? <div className="w-48"><Select label="پایگاه داده" ltr value={database} onChange={(v) => { setDatabase(v); void load(v); }} options={ov.databases.map((x) => ({ value: x, label: x }))} /></div> : undefined}>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={DBQ_LIMITS.questionChars} dir="auto" aria-label="پرسش" placeholder={placeholder(d.engine)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void ask().catch((x: Error) => notify(x.message, "circle-alert")); } }} className={TEXTAREA} />
          {ov?.suggestions.length ? (
            <div className="flex flex-wrap gap-1.5 mt-2" aria-label="پرسش‌های پیشنهادی">
              {ov.suggestions.map((s) => <button key={s} type="button" onClick={() => void ask(s).catch((x: Error) => notify(x.message, "circle-alert"))} className="text-[11px] rounded-full px-3 py-1 bg-white/[0.05] border border-white/[0.1] hover:border-white/25 transition">{s}</button>)}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
            <div className="flex items-center gap-2 text-xs text-white/70">
              <Switch on={!!ov?.samples} label="نمونه داده برای دقت بیشتر" onChange={async (v) => { try { await dbqueryApi.setSamples(d.id, v); await load(database); } catch (e) { notify((e as Error).message, "circle-alert"); } }} />
              <span>نمونه داده برای دقت بیشتر<span className="block text-[10px] text-white/45">چند مقدار از هر ستون هم برای هوش مصنوعی فرستاده می‌شود</span></span>
            </div>
            <AsyncButton disabled={question.trim().length < 3} onClick={() => ask()}><Icon name="sparkles" size={16} />ساخت کوئری</AsyncButton>
          </div>
          <p className="text-[11px] text-white/45 mt-3">هزینه هر پرسش (حدود چند صد تا چند هزار تومان) از کیف پول کم می‌شود. داده‌های جدول‌ها برای هوش مصنوعی فرستاده نمی‌شود؛ فقط ساختار{ov?.samples ? " و چند نمونه مقدار" : ""}.</p>
          {loadError && <p role="alert" className="text-sm text-rose-300 mt-2" dir="auto">{loadError}</p>}
        </Card>

        {(answer || query) && (
          <Card title="کوئری" icon="braces" action={answer?.simulated ? <Badge tone="gray">شبیه‌ساز</Badge> : answer?.charged ? <span className="text-[11px] text-white/50">{toman(answer.charged)}</span> : undefined}>
            {answer?.explanation && <p className="text-sm text-white/80 mb-3 leading-7" dir="auto">{answer.explanation}</p>}
            {answer?.error && <p role="alert" className="text-xs text-amber-200 mb-3" dir="auto">{answer.error}</p>}
            {editing ? (
              <textarea value={query} onChange={(e) => setQuery(e.target.value)} dir="ltr" rows={Math.min(14, Math.max(4, query.split("\n").length + 1))} aria-label="ویرایش کوئری" spellCheck={false} className={TEXTAREA + " font-mono text-xs text-left"} />
            ) : query ? <CodeBlock code={query} label="کوئری" title={lang === "sql" ? (engineOf(d.engine)?.label ?? "SQL") : lang === "mongo" ? "MongoDB aggregate" : "redis-cli"} wrap maxH="max-h-80" /> : null}
            <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
              <span className="text-[11px] text-white/50">فقط‌خواندنی · حداکثر {fa(DBQ_LIMITS.rows)} ردیف · {fa(DBQ_LIMITS.timeoutMs / 1000)} ثانیه</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => setEditing((v) => !v)} className={BTN_G + BTN_SM}><Icon name="pencil" size={14} />{editing ? "پیش‌نمایش" : "ویرایش"}</button>
                <AsyncButton size="sm" disabled={!query.trim()} onClick={() => run()}><Icon name="play" size={14} />اجرا</AsyncButton>
              </span>
            </div>
            {runError && <p role="alert" className="text-sm text-rose-300 mt-3 whitespace-pre-wrap" dir="auto">{runError}</p>}
          </Card>
        )}

        {result && <ResultView result={result} chart={chart} setChart={setChart} question={answer?.question ?? ""} historyId={historyId} analysis={analysis} setAnalysis={setAnalysis} />}
      </div>

      <History items={ov?.history ?? []} onOpen={(h) => { setAnswer(null); setQuestion(h.question); show(h); setEditing(false); }} onRun={(h) => { show(h); setAnswer(null); setQuestion(h.question); return run(h.query, h.id); }} reload={() => load(database)} tables={ov?.tables.length ?? 0} />
    </div>
  );
}

/* ---------------- results ---------------- */
function ResultView({ result, chart, setChart, question, historyId, analysis, setAnalysis }: { result: DbqResult; chart: DbqChart; setChart: (c: DbqChart) => void; question: string; historyId: string; analysis: DbqAnalysis | null; setAnalysis: (a: DbqAnalysis | null) => void }) {
  const { notify } = useApp();
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(result.rows.length / PAGE));
  const numeric = result.columns.filter((c) => c.type === "number").map((c) => c.name);
  const usable = (t: ChartType) => t === "table" || (numeric.length > 0 && result.columns.length > 1 && result.rows.length > 1);
  const pick = (t: ChartType) => {
    if (t === "table") return setChart({ type: "table", x: chart.x, y: chart.y });
    const auto = pickChart(result);
    const y = numeric.includes(chart.y) ? chart.y : auto.y || numeric.at(-1)!;
    const x = chart.x && chart.x !== y ? chart.x : auto.x || result.columns.find((c) => c.name !== y)!.name;
    setChart({ type: t, x, y });
  };
  const csv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(result)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = (question.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) || "result") + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Card title="نتیجه" icon="table" pad="p-0" action={<span className="text-[11px] text-white/50 tabular">{fa(result.rows.length)} ردیف{result.hasMore ? " (بیشتر هم هست)" : ""} · {fa(result.durationMs)} میلی‌ثانیه</span>}>
      <div className="px-4 sm:px-5 pt-1 pb-3 flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="نوع نمودار" className="flex flex-wrap gap-1.5">
          {CHARTS.map((c) => <button key={c.id} type="button" role="radio" aria-checked={chart.type === c.id} disabled={!usable(c.id)} onClick={() => pick(c.id)}
            className={"inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[11px] border transition disabled:opacity-40 " + (chart.type === c.id ? "bg-sky-400/10 border-sky-300/50" : "bg-white/[0.03] border-white/[0.1] hover:border-white/25")}><Icon name={c.icon} size={13} />{c.label}</button>)}
        </div>
        <span className="flex gap-2">
          <button type="button" onClick={csv} disabled={!result.rows.length} className={BTN_G + BTN_SM}><Icon name="download" size={14} />CSV</button>
          {historyId && <AsyncButton size="sm" className={BTN_G + BTN_SM} confirmText={"برای تحلیل، حداکثر " + fa(DBQ_LIMITS.analyzeRows) + " ردیف اول این نتیجه (کوتاه‌شده و با حذف رمزها و کلیدها) برای هوش مصنوعی فرستاده می‌شود و هزینه آن از کیف پول کم می‌شود. ادامه می‌دهید؟"}
            onClick={async () => { const a = await dbqueryApi.analyze(historyId); setAnalysis(a); if (a.charged) notify("هزینه تحلیل: " + toman(a.charged), "sparkles"); }}><Icon name="sparkles" size={14} />تحلیل نتیجه</AsyncButton>}
        </span>
      </div>
      {result.sizeCapped && <p className="px-5 pb-2 text-[11px] text-amber-200">نتیجه بیش از ۱ مگابایت بود؛ فقط بخش اول نمایش داده می‌شود.</p>}
      {result.note && <p className="px-5 pb-2 text-[11px] text-white/55" dir="auto">{result.note}</p>}
      {chart.type !== "table" && usable(chart.type) && <div className="px-4 sm:px-5 pb-4"><ChartView result={result} chart={chart} /></div>}
      {analysis && <div className="mx-4 sm:mx-5 mb-4 rounded-xl bg-white/[0.04] border border-white/[0.08] p-4 text-sm leading-7 whitespace-pre-wrap" dir="auto">
        <span className="flex items-center gap-2 text-xs text-white/55 mb-1"><Icon name="sparkles" size={13} />تحلیل ({fa(analysis.rowsSent)} ردیف فرستاده شد{analysis.simulated ? "، شبیه‌ساز" : ""})</span>{analysis.text}</div>}
      {result.rows.length ? <>
        <div className="overflow-x-auto max-h-[32rem] border-t border-white/[0.06]"><table dir="ltr" className="text-xs w-full">
          <thead className="sticky top-0 bg-[#10131c]"><tr>{result.columns.map((c) => <th key={c.name} scope="col" className="text-left p-2 border-b border-white/[0.08] whitespace-nowrap"><span className="font-mono">{c.name}</span> <span className="text-[10px] font-normal text-white/40">{TYPE_LABEL[c.type] ?? c.type}</span></th>)}</tr></thead>
          <tbody>{result.rows.slice(page * PAGE, page * PAGE + PAGE).map((r, i) => <tr key={i} className="odd:bg-white/[0.02]">{r.map((v, k) => <td key={k} dir="auto" className={"p-2 whitespace-nowrap max-w-[24rem] truncate " + (result.columns[k]?.type === "number" ? "tabular text-right" : "font-mono")}>{v === null ? <span className="text-white/35">NULL</span> : String(v)}</td>)}</tr>)}</tbody>
        </table></div>
        {pages > 1 && <div className="flex items-center justify-between gap-2 p-2 text-[11px] text-white/50">
          <span>صفحه {fa(page + 1)} از {fa(pages)}</span>
          <span className="flex gap-1.5"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className={BTN_G + BTN_SM}>قبلی</button><button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className={BTN_G + BTN_SM}>بعدی</button></span>
        </div>}
      </> : <p className="p-5 text-sm text-white/55">ردیفی برنگشت.</p>}
    </Card>
  );
}

function ChartView({ result, chart }: { result: DbqResult; chart: DbqChart }) {
  const xi = result.columns.findIndex((c) => c.name === chart.x), yi = result.columns.findIndex((c) => c.name === chart.y);
  const pts = useMemo(() => result.rows.slice(0, 120).map((r) => ({ label: r[xi] === null ? "—" : String(r[xi]).slice(0, 24), v: Number(r[yi]) || 0 })), [result, xi, yi]);
  if (xi < 0 || yi < 0) return null;
  if (chart.type === "line") return <AreaChart data={pts.map((p) => p.v)} labels={pts.map((p) => p.label)} unit={chart.y} height={220} />;
  if (chart.type === "pie") return <Pie data={pts.slice(0, 12)} />;
  return <div className="overflow-x-auto"><Bars data={pts.slice(0, 40).map((p) => p.v)} labels={pts.slice(0, 40).map((p) => p.label)} height={200} /></div>;
}

const PIE_COLORS = ["#9cc9ff", "#6ee7b7", "#fcd34d", "#f9a8d4", "#c4b5fd", "#fdba74", "#5eead4", "#fca5a5", "#a5b4fc", "#bef264", "#d8b4fe", "#7dd3fc"];
function Pie({ data }: { data: { label: string; v: number }[] }) {
  const total = data.reduce((s, d) => s + Math.max(0, d.v), 0) || 1;
  const starts = data.map((_, i) => data.slice(0, i).reduce((s, d) => s + Math.max(0, d.v), 0));
  const arcs = data.map((d, i) => {
    const a0 = (starts[i] / total) * Math.PI * 2, a1 = ((starts[i] + Math.max(0, d.v)) / total) * Math.PI * 2;
    const p = (a: number) => [50 + 45 * Math.sin(a), 50 - 45 * Math.cos(a)].map((n) => n.toFixed(2)).join(" ");
    const path = data.length === 1 ? "M 50 5 A 45 45 0 1 1 49.99 5 Z" : "M 50 50 L " + p(a0) + " A 45 45 0 " + (a1 - a0 > Math.PI ? 1 : 0) + " 1 " + p(a1) + " Z";
    return { path, color: PIE_COLORS[i % PIE_COLORS.length], ...d };
  });
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 100 100" className="w-40 h-40 shrink-0" role="img" aria-label="نمودار دایره‌ای">{arcs.map((a) => <path key={a.label} d={a.path} fill={a.color} stroke="#0b0d16" strokeWidth="0.8"><title>{a.label + ": " + fa(a.v)}</title></path>)}</svg>
      <ul className="text-xs space-y-1.5 min-w-0">{arcs.map((a) => <li key={a.label} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: a.color }} /><span dir="auto" className="truncate">{a.label}</span><span className="text-white/50 tabular">{fa(a.v)} ({fa(Math.round((a.v / total) * 100))}٪)</span></li>)}</ul>
    </div>
  );
}

/* ---------------- history ---------------- */
function History({ items, onOpen, onRun, reload, tables }: { items: DbqHistoryItem[]; onOpen: (h: DbqHistoryItem) => void; onRun: (h: DbqHistoryItem) => Promise<void>; reload: () => Promise<void>; tables: number }) {
  const { notify } = useApp();
  const act = (f: () => Promise<unknown>) => async () => { try { await f(); await reload(); } catch (e) { notify((e as Error).message, "circle-alert"); } };
  return (
    <Card title="تاریخچه و ذخیره‌شده‌ها" icon="history" pad="p-3" className="xl:sticky xl:top-4">
      {!items.length ? <p className="text-[11px] text-white/50 p-2">هنوز پرسشی ثبت نشده است.{tables ? " " + fa(tables) + " جدول/مجموعه در دسترس است." : ""}</p> : (
        <ul className="space-y-1 max-h-[36rem] overflow-y-auto">
          {items.map((h) => (
            <li key={h.id} className="rounded-xl hover:bg-white/[0.04] p-2">
              <button type="button" onClick={() => onOpen(h)} className="block w-full text-right">
                <span className="flex items-center gap-1.5 text-xs">{h.saved && <Icon name="star" size={12} className="text-amber-200 shrink-0" />}<span dir="auto" className="truncate">{h.title || h.question || "کوئری دستی"}</span></span>
                <span dir="ltr" className="block text-[10px] font-mono text-white/40 truncate text-left mt-0.5">{h.query.replace(/\s+/g, " ").slice(0, 80)}</span>
                <span className="block text-[10px] text-white/40 mt-0.5">{h.at}{h.runs ? " · " + fa(h.runs) + " اجرا" : ""}{h.lastRowCount !== null ? " · " + fa(h.lastRowCount) + " ردیف" : ""}{h.edited ? " · ویرایش‌شده" : ""}</span>
              </button>
              <span className="flex gap-1 mt-1">
                <AsyncButton size="sm" className={BTN_G + " h-7 px-2 text-[11px]"} label="اجرای دوباره" onClick={() => onRun(h)}><Icon name="refresh-cw" size={12} /></AsyncButton>
                <AsyncButton size="sm" className={BTN_G + " h-7 px-2 text-[11px]"} label={h.saved ? "حذف از ذخیره‌شده‌ها" : "ذخیره"} onClick={act(() => dbqueryApi.save(h.id, !h.saved, h.title || h.question.slice(0, 80)))}><Icon name="star" size={12} /></AsyncButton>
                <AsyncButton size="sm" className={BTN_G + " h-7 px-2 text-[11px]"} label="حذف" confirmText="این مورد از تاریخچه حذف شود؟" onClick={act(() => dbqueryApi.remove(h.id))}><Icon name="trash-2" size={12} /></AsyncButton>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
