"use client";
/* Managed database extras in the database page: users and databases, admin panels, tuning and
   extensions, the data inspector, firewall, imports and the event timeline. */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BTN_G, BTN_MD, BTN_P, BTN_SM, INPUT, TEXTAREA } from "@/lib/cls";
import {
  canManage, dbNoun, IMPORT_FORMATS, IMPORT_LABEL, INSPECT_ENGINES, PANEL_HOURS_DEFAULT, PANEL_HOURS_MAX, paramDefault, paramMax, paramsFor, PG_EXTENSIONS, poolingFor,
  publicAllowed, QUERY_ENGINES, toolsFor, type DbAccess,
} from "@/lib/dbaas";
import { fa } from "@/lib/format";
import { engineOf, PAAS_NAME_RE } from "@/lib/paas";
import { api, useDB } from "@/lib/store";
import type { PaasDb } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { ExplainButton } from "./explain";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, CopyText, Select, Switch } from "../ui-client";

const ACCESS: { value: DbAccess | ""; label: string }[] = [{ value: "", label: "بدون دسترسی" }, { value: "ro", label: "فقط خواندن" }, { value: "rw", label: "خواندن و نوشتن" }];
const Secret = ({ title, url, password, username }: { title: string; url?: string; password: string; username?: string }) => (
  <div className="rounded-xl bg-emerald-400/[0.07] border border-emerald-300/20 p-3 mt-3 space-y-2 text-xs">
    <p className="text-emerald-200">{title}</p>
    {username && <div className="flex justify-between gap-2"><span className="text-white/55">نام کاربری</span><CopyText text={username} className="font-mono" /></div>}
    <div className="flex justify-between gap-2"><span className="text-white/55">رمز</span><CopyText text={password} className="font-mono" /></div>
    {url && <CopyText text={url} className="font-mono text-[11px] break-all" />}
  </div>
);

/* ================= users and databases ================= */
export function DbUsers({ d }: { d: PaasDb }) {
  const { notify } = useApp();
  const all = [d.dbName, ...d.databases.map((x) => x.name)];
  const noun = dbNoun(d.engine);
  const [newDb, setNewDb] = useState("");
  const [user, setUser] = useState("");
  const [grants, setGrants] = useState<Record<string, DbAccess | "">>({ [d.dbName]: "rw" });
  const [shown, setShown] = useState<{ title: string; url: string; password: string } | null>(null);
  if (!canManage(d.engine)) return <Card><Empty icon="users" title="مدیریت کاربران برای این موتور در دسترس نیست" text="از کاربر اصلی (تب اتصال) استفاده کنید." /></Card>;
  const list = (g: Record<string, DbAccess | "">) => Object.entries(g).filter(([, v]) => v).map(([db, access]) => ({ db, access: access as DbAccess }));
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title={noun === "vhost" ? "vhostها" : "پایگاه‌های داده"} icon="database">
        <ul className="divide-y divide-white/[0.06] text-sm">
          <li className="py-2.5 flex justify-between"><span dir="ltr" className="font-mono">{d.dbName}</span><Badge tone="blue">اصلی</Badge></li>
          {d.databases.map((x) => (
            <li key={x.id} className="py-2.5 flex justify-between items-center gap-2"><span dir="ltr" className="font-mono">{x.name}</span>
              <AsyncButton danger className={BTN_G + BTN_SM} confirmText={"«" + x.name + "» و همه داده‌هایش برای همیشه حذف شود؟"} onClick={async () => { await api.dbaas.dropDatabase(d.id, x.name, x.name); notify("حذف شد", "trash-2"); }}><Icon name="trash-2" size={14} /></AsyncButton></li>
          ))}
        </ul>
        <div className="flex gap-2 mt-3">
          <input value={newDb} onChange={(e) => setNewDb(e.target.value.toLowerCase().trim())} dir="ltr" placeholder="analytics" aria-label={"نام " + noun + " جدید"} className={INPUT + " text-left font-mono"} />
          <AsyncButton disabled={!newDb} className={BTN_P + BTN_MD + " shrink-0"} onClick={async () => { await api.dbaas.createDatabase(d.id, newDb); setNewDb(""); notify("ساخته شد", "database"); }}><Icon name="plus" size={16} />ساخت</AsyncButton>
        </div>
      </Card>
      <Card title="کاربران" icon="users">
        {d.users.length === 0 ? <p className="text-sm text-white/60">جز کاربر اصلی (<span dir="ltr" className="font-mono">{d.username}</span>) کاربری نیست. برای هر اپ یا همکار کاربر جدا با کمترین دسترسی لازم بسازید.</p> : (
          <ul className="divide-y divide-white/[0.06]">
            {d.users.map((u) => <UserRow key={u.id} d={d} u={u} all={all} onSecret={setShown} />)}
          </ul>
        )}
        <div className="mt-4 pt-4 border-t border-white/[0.08] space-y-3">
          <Field label="کاربر جدید"><input value={user} onChange={(e) => setUser(e.target.value.toLowerCase().trim())} dir="ltr" placeholder="reporter" className={INPUT + " text-left font-mono"} /></Field>
          {all.map((db) => (
            <div key={db} className="flex items-center justify-between gap-3 text-sm"><span dir="ltr" className="font-mono text-xs">{db}</span>
              <Select label={"دسترسی به " + db} value={grants[db] ?? ""} onChange={(v) => setGrants((g) => ({ ...g, [db]: v as DbAccess | "" }))} options={ACCESS} className="w-44" /></div>
          ))}
          <AsyncButton disabled={!user} onClick={async () => { const r = await api.dbaas.createUser(d.id, { username: user, grants: list(grants) }); setShown({ title: "کاربر " + user + " ساخته شد؛ رمز را الان ذخیره کنید.", url: r.url, password: r.password }); setUser(""); }}><Icon name="user-plus" size={16} />ساخت کاربر</AsyncButton>
        </div>
        {shown && <Secret {...shown} />}
      </Card>
    </div>
  );
}

function UserRow({ d, u, all, onSecret }: { d: PaasDb; u: PaasDb["users"][number]; all: string[]; onSecret: (s: { title: string; url: string; password: string }) => void }) {
  const { notify } = useApp();
  const [edit, setEdit] = useState(false);
  const [g, setG] = useState<Record<string, DbAccess | "">>(Object.fromEntries(u.grants.map((x) => [x.db, x.access])));
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span><b dir="ltr" className="font-mono text-sm">{u.username}</b>
          <span className="block text-[11px] text-white/50 mt-0.5">{u.grants.length ? u.grants.map((x) => x.db + (x.access === "ro" ? " (خواندنی)" : " (کامل)")).join("، ") : "بدون دسترسی"}</span></span>
        <span className="flex gap-1.5">
          <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { const r = await api.dbaas.userCredentials(d.id, u.id); onSecret({ title: "رمز " + u.username, ...r }); }}><Icon name="eye" size={14} /></AsyncButton>
          <button type="button" onClick={() => setEdit((x) => !x)} className={BTN_G + BTN_SM} aria-label="دسترسی‌ها"><Icon name="shield" size={14} /></button>
          <AsyncButton className={BTN_G + BTN_SM} confirmText="رمز جدید ساخته شود؟ اتصال‌های فعلی این کاربر قطع می‌شود." onClick={async () => { const r = await api.dbaas.resetUserPassword(d.id, u.id); onSecret({ title: "رمز جدید " + u.username, ...r }); }}><Icon name="key-round" size={14} /></AsyncButton>
          <AsyncButton danger className={BTN_G + BTN_SM} confirmText={"کاربر " + u.username + " حذف شود؟"} onClick={async () => { await api.dbaas.dropUser(d.id, u.id); notify("کاربر حذف شد", "trash-2"); }}><Icon name="trash-2" size={14} /></AsyncButton>
        </span>
      </div>
      {edit && <div className="mt-3 space-y-2">
        {all.map((db) => <div key={db} className="flex items-center justify-between gap-3"><span dir="ltr" className="font-mono text-xs">{db}</span><Select label={"دسترسی به " + db} value={g[db] ?? ""} onChange={(v) => setG((x) => ({ ...x, [db]: v as DbAccess | "" }))} options={ACCESS} className="w-44" /></div>)}
        <AsyncButton className={BTN_P + BTN_SM} onClick={async () => { await api.dbaas.setGrants(d.id, u.id, Object.entries(g).filter(([, v]) => v).map(([db, access]) => ({ db, access: access as DbAccess }))); setEdit(false); notify("دسترسی‌ها ذخیره شد", "shield"); }}>ذخیره دسترسی</AsyncButton>
      </div>}
    </li>
  );
}

/* ================= temporary admin panels ================= */
export function DbPanels({ d }: { d: PaasDb }) {
  const tools = toolsFor(d.engine);
  const [hours, setHours] = useState(PANEL_HOURS_DEFAULT);
  const [shown, setShown] = useState<{ title: string; url: string; username: string; password: string } | null>(null);
  if (!tools.length) return <Card><Empty icon="layout-dashboard" title="پنل وب برای این موتور در دسترس نیست" /></Card>;
  return (
    <Card title="پنل مدیریت تحت وب" icon="layout-dashboard">
      <p className="text-sm text-white/60 leading-7">پنل روی یک زیردامنه تصادفی با رمز جدا باز می‌شود و پس از زمان انتخابی خودکار حذف می‌شود. وقتی کارتان تمام شد آن را ببندید.</p>
      <div className="flex flex-wrap items-end gap-3 mt-4">
        <Field label="مدت (ساعت)"><input type="number" min={1} max={PANEL_HOURS_MAX} value={hours} onChange={(e) => setHours(Math.max(1, Math.min(PANEL_HOURS_MAX, Number(e.target.value) || 1)))} className={INPUT + " w-28 text-center"} /></Field>
        {tools.map((t) => (
          <AsyncButton key={t.id} disabled={d.status !== "running"} className={BTN_P + BTN_MD} onClick={async () => { const r = await api.dbaas.openPanel(d.id, t.id, hours); setShown({ title: t.label + " آماده است (ورود با این مشخصات):", ...r }); }}>
            <Icon name="external-link" size={16} />{t.label}</AsyncButton>
        ))}
      </div>
      {shown && <><Secret {...shown} /><a href={shown.url} target="_blank" rel="noreferrer" className={BTN_G + BTN_SM + " mt-2"}><Icon name="external-link" size={14} />باز کردن</a></>}
      {d.panels.length > 0 && <ul className="divide-y divide-white/[0.06] mt-5">
        {d.panels.map((p) => (
          <li key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span><b>{tools.find((t) => t.id === p.tool)?.label ?? p.tool}</b> <a href={p.url} target="_blank" rel="noreferrer" dir="ltr" className="font-mono text-xs acc hover:underline">{p.url}</a>
              <span className="block text-[11px] text-white/50">تا {p.expiresAt} ({fa(Math.ceil(p.minutesLeft / 60))} ساعت دیگر)</span></span>
            <span className="flex gap-1.5">
              <AsyncButton className={BTN_G + " h-9 w-9"} label="مشخصات ورود" onClick={async () => setShown({ title: "مشخصات ورود", ...(await api.dbaas.panelCredentials(p.id)) })}><Icon name="key-round" size={14} /></AsyncButton>
              <AsyncButton danger className={BTN_G + BTN_SM} onClick={() => api.dbaas.closePanel(p.id)}>بستن</AsyncButton>
            </span>
          </li>
        ))}
      </ul>}
    </Card>
  );
}

/* ================= tuning, extensions, replica set ================= */
export function DbTuning({ d }: { d: PaasDb }) {
  const { notify } = useApp();
  const db = useDB();
  const ram = db.paasPlans.find((p) => p.id === d.planId)?.ramMb ?? 512;
  const defs = paramsFor(d.engine);
  const [vals, setVals] = useState<Record<string, string>>(d.config.params);
  const [ext, setExt] = useState<string[]>(d.config.extensions);
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="پارامترها" icon="sliders-horizontal">
        {!defs.length ? <p className="text-sm text-white/60">برای این موتور پارامتر قابل تنظیمی نیست.</p> : <>
          <div className="space-y-3">
            {defs.map((p) => (
              <Field key={p.key} label={p.label} hint={p.options ? undefined : "پیش‌فرض " + paramDefault(p, ram) + " · بازه " + p.min + " تا " + paramMax(p, ram) + (p.unit ? " " + p.unit : "")}>
                {p.options ? <Select label={p.label} ltr value={vals[p.key] ?? p.options[0]} onChange={(v) => setVals((x) => ({ ...x, [p.key]: v }))} options={p.options} />
                  : <input dir="ltr" inputMode="numeric" value={vals[p.key] ?? ""} placeholder={paramDefault(p, ram)} onChange={(e) => setVals((x) => { const n = { ...x }; if (e.target.value.trim()) n[p.key] = e.target.value.trim(); else delete n[p.key]; return n; })} className={INPUT + " text-left font-mono"} />}
              </Field>
            ))}
          </div>
          <AsyncButton className={BTN_P + BTN_MD + " mt-4"} confirmText="برای اعمال پارامترها پایگاه داده چند ثانیه ری‌استارت می‌شود. ادامه؟" onClick={async () => { await api.dbaas.setParams(d.id, vals); notify("پارامترها اعمال شد", "sliders-horizontal"); }}>اعمال و ری‌استارت</AsyncButton>
        </>}
      </Card>
      {d.engine === "postgres" && <Card title="افزونه‌های PostgreSQL" icon="layers">
        {!d.config.extImage && <p className="text-[11px] text-amber-200/80 mb-3">این پایگاه داده با ایمیج قدیمی ساخته شده و PostGIS/pgvector ندارد؛ برای آن‌ها پشتیبان را در پایگاه داده جدید بازگردانی کنید.</p>}
        <ul className="grid sm:grid-cols-2 gap-2">
          {PG_EXTENSIONS.map((x) => {
            const off = (x.image && !d.config.extImage) || (!!x.minVersion && Number(d.version) < x.minVersion);
            return (
              <li key={x.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2">
                <span className="min-w-0"><b dir="ltr" className="text-xs font-mono">{x.label}</b><span className="block text-[11px] text-white/50 truncate">{x.hint}</span></span>
                <Switch on={ext.includes(x.id)} disabled={off} onChange={(v) => setExt((l) => (v ? [...l, x.id] : l.filter((e) => e !== x.id)))} label={x.label} />
              </li>
            );
          })}
        </ul>
        <AsyncButton className={BTN_P + BTN_MD + " mt-4"} disabled={d.status !== "running"} onClick={async () => { await api.dbaas.setExtensions(d.id, ext); notify("افزونه‌ها ذخیره شد", "layers"); }}>ذخیره افزونه‌ها</AsyncButton>
      </Card>}
      {d.engine === "mongodb" && <Card title="Replica Set" icon="database" action={<Switch on={d.config.replicaSet} disabled={d.status !== "running"} onChange={async (v) => { await api.dbaas.setReplicaSet(d.id, v); notify(v ? "Replica Set روشن شد" : "Replica Set خاموش شد", "database"); }} label="Replica Set" />}>
        <p className="text-sm text-white/60 leading-7">یک Replica Set تک‌عضوی؛ برای تراکنش‌های چندسندی و change stream لازم است. پس از روشن کردن، <span dir="ltr" className="font-mono">replicaSet=rs0</span> را به آدرس اتصال اضافه کنید. تغییر آن پایگاه داده را ری‌استارت می‌کند.</p>
      </Card>}
    </div>
  );
}

/* ================= data inspector ================= */
type Grid = { columns: string[]; rows: (string | null)[][]; hasMore: boolean };
export function DbInspector({ d }: { d: PaasDb }) {
  const mongo = d.engine === "mongodb";
  const [dbs, setDbs] = useState<string[]>([]);
  const [db, setDb] = useState(d.dbName);
  const [tables, setTables] = useState<{ name: string; rows: number }[]>([]);
  const [table, setTable] = useState("");
  const [page, setPage] = useState(0);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [docs, setDocs] = useState<{ list: string[]; hasMore: boolean } | null>(null);
  const [sql, setSql] = useState("SELECT * FROM ");
  const [filter, setFilter] = useState("{}");
  const [error, setError] = useState("");
  const run = async (f: () => Promise<void>) => { setError(""); try { await f(); } catch (e) { setError((e as Error).message); } };
  useEffect(() => {
    if (!INSPECT_ENGINES.includes(d.engine) || d.status !== "running") return;
    void api.dbaas.inspect(d.id, { op: "databases" }).then((r) => setDbs(r.databases ?? [])).catch((e: Error) => setError(e.message));
  }, [d.id, d.engine, d.status]);
  useEffect(() => {
    if (!INSPECT_ENGINES.includes(d.engine) || d.status !== "running") return;
    void api.dbaas.inspect(d.id, { op: "tables", db }).then((r) => { setTables(r.tables ?? []); setTable(""); setGrid(null); setDocs(null); }).catch((e: Error) => setError(e.message));
  }, [d.id, d.engine, d.status, db]);
  if (!INSPECT_ENGINES.includes(d.engine)) return <Card><Empty icon="table" title="مرورگر داده برای این موتور در دسترس نیست" /></Card>;
  if (d.status !== "running") return <Card><Empty icon="table" title="پایگاه داده روشن نیست" /></Card>;
  const open = (t: string, p = 0) => run(async () => {
    setTable(t); setPage(p);
    if (mongo) { const r = await api.dbaas.inspect(d.id, { op: "find", db, collection: t, filter, page: p }); setDocs({ list: r.docs ?? [], hasMore: !!r.hasMore }); }
    else setGrid((await api.dbaas.inspect(d.id, { op: "rows", db, table: t, page: p })).grid ?? null);
  });
  return (
    <div className="grid xl:grid-cols-[16rem_1fr] gap-4 items-start">
      <Card title={mongo ? "مجموعه‌ها" : "جدول‌ها"} icon="table" pad="p-3">
        <Select label="پایگاه داده" ltr value={db} onChange={setDb} options={(dbs.length ? dbs : [d.dbName]).map((x) => ({ value: x, label: x }))} />
        <ul className="mt-2 max-h-[28rem] overflow-y-auto">
          {tables.map((t) => <li key={t.name}><button type="button" onClick={() => open(t.name)} className={"w-full flex justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs " + (t.name === table ? "bg-sky-400/10 text-sky-100" : "hover:bg-white/[0.05]")}><span dir="ltr" className="font-mono truncate">{t.name}</span><span className="text-white/50 tabular">{fa(t.rows)}</span></button></li>)}
          {!tables.length && <li className="text-[11px] text-white/50 p-2">خالی است.</li>}
        </ul>
      </Card>
      <div className="space-y-4 min-w-0">
        {QUERY_ENGINES.includes(d.engine) && <Card title="کوئری فقط‌خواندنی" icon="terminal">
          <textarea value={sql} onChange={(e) => setSql(e.target.value)} dir="ltr" rows={3} aria-label="کوئری" className={TEXTAREA + " font-mono text-xs"} />
          <div className="flex items-center justify-between gap-3 mt-2"><span className="text-[11px] text-white/50">در تراکنش فقط‌خواندنی، حداکثر ۵ ثانیه و ۵۰۰ ردیف.</span>
            <AsyncButton className={BTN_P + BTN_SM} onClick={() => run(async () => { setTable(""); setGrid((await api.dbaas.inspect(d.id, { op: "query", db, sql })).grid ?? null); })}><Icon name="play" size={14} />اجرا</AsyncButton></div>
        </Card>}
        {mongo && table && <Card pad="p-3">
          <div className="flex gap-2"><input value={filter} onChange={(e) => setFilter(e.target.value)} dir="ltr" aria-label="فیلتر JSON" className={INPUT + " text-left font-mono text-xs"} />
            <AsyncButton className={BTN_P + BTN_MD + " shrink-0"} onClick={() => open(table)}>جست‌وجو</AsyncButton></div>
        </Card>}
        {error && <p role="alert" className="text-sm text-rose-300 whitespace-pre-wrap" dir="auto">{error}</p>}
        {grid && <Card pad="p-0">
          <div className="overflow-x-auto max-h-[32rem]"><table dir="ltr" className="text-xs w-full">
            <thead className="sticky top-0 bg-[#10131c]"><tr>{grid.columns.map((c) => <th key={c} className="text-left font-mono p-2 border-b border-white/[0.08]">{c}</th>)}</tr></thead>
            <tbody>{grid.rows.map((r, i) => <tr key={i} className="odd:bg-white/[0.02]">{r.map((v, k) => <td key={k} className="p-2 font-mono whitespace-nowrap max-w-[24rem] truncate">{v === null ? <span className="text-white/35">NULL</span> : v}</td>)}</tr>)}</tbody>
          </table></div>
          <Pager page={page} hasMore={grid.hasMore} onPage={table ? (p) => open(table, p) : undefined} count={grid.rows.length} />
        </Card>}
        {docs && <Card pad="p-3">
          {docs.list.length ? docs.list.map((x, i) => <pre key={i} dir="ltr" className="text-[11px] font-mono bg-white/[0.03] rounded-lg p-2 mb-2 overflow-x-auto">{JSON.stringify(JSON.parse(x), null, 2)}</pre>) : <p className="text-sm text-white/55">سندی پیدا نشد.</p>}
          <Pager page={page} hasMore={docs.hasMore} onPage={(p) => open(table, p)} count={docs.list.length} />
        </Card>}
      </div>
    </div>
  );
}
function Pager({ page, hasMore, onPage, count }: { page: number; hasMore: boolean; onPage?: (p: number) => void; count: number }) {
  return (
    <div className="flex items-center justify-between gap-2 p-2 text-[11px] text-white/50">
      <span>{fa(count)} ردیف{hasMore ? " (بیشتر هست)" : ""}</span>
      {onPage && <span className="flex gap-1.5">
        <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} className={BTN_G + BTN_SM}>قبلی</button>
        <button type="button" disabled={!hasMore} onClick={() => onPage(page + 1)} className={BTN_G + BTN_SM}>بعدی</button>
      </span>}
    </div>
  );
}

/* ================= firewall ================= */
export function DbFirewall({ d }: { d: PaasDb }) {
  const { notify } = useApp();
  const [text, setText] = useState(d.config.allowlist.join("\n"));
  if (!publicAllowed(d.engine)) return null;
  return (
    <Card title="فایروال دسترسی عمومی" icon="shield">
      <p className="text-sm text-white/60 leading-7">فقط این نشانی‌ها (هر خط یک IPv4 یا CIDR) به پورت عمومی دسترسی دارند. خالی یعنی همه. اپ‌های خودتان در گره همیشه دسترسی دارند.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} dir="ltr" rows={4} placeholder={"5.160.10.20\n185.120.0.0/16"} aria-label="نشانی‌های مجاز" className={TEXTAREA + " font-mono text-xs mt-3"} />
      {!d.publicAccess && <p className="text-[11px] text-white/50 mt-2">دسترسی عمومی خاموش است؛ فهرست وقتی روشنش کنید اعمال می‌شود.</p>}
      <AsyncButton className={BTN_P + BTN_MD + " mt-3"} onClick={async () => { const r = await api.dbaas.setAllowlist(d.id, text.split(/[\s,]+/).filter(Boolean)); setText(r.join("\n")); notify("فایروال ذخیره شد", "shield"); }}>ذخیره</AsyncButton>
    </Card>
  );
}

/* ================= backups: extra actions and import ================= */
export function BackupActions({ d, backupId }: { d: PaasDb; backupId: string }) {
  const router = useRouter();
  const { notify, prompt } = useApp();
  if (!engineOf(d.engine)?.backups) return null;
  return <>
    <AsyncButton className={BTN_G + BTN_SM} title="دانلود" onClick={async () => { window.open(await api.dbaas.backupLink(backupId), "_blank", "noopener"); }}><Icon name="download" size={14} /></AsyncButton>
    <AsyncButton className={BTN_G + BTN_SM} title="بازگردانی در پایگاه داده جدید" onClick={async () => {
      const name = (await prompt("نام پایگاه داده جدید", { title: "بازگردانی در پایگاه داده جدید", ok: "بازگردانی", ltr: true, value: (d.name + "-copy").slice(0, 30) }))?.toLowerCase();
      if (!name) return;
      if (!PAAS_NAME_RE.test(name)) throw new Error("نام معتبر نیست.");
      const id = await api.dbaas.restoreToNew(backupId, name);
      notify("پایگاه داده جدید در حال ساخت است", "database-backup");
      router.push(("/panel/databases/" + id) as never);
    }}><Icon name="copy" size={14} />جدید</AsyncButton>
  </>;
}

export function DbImport({ d }: { d: PaasDb }) {
  const { notify } = useApp();
  const formats = IMPORT_FORMATS[d.engine];
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState("");
  if (!formats) return null;
  return (
    <Card title="ورود داده از فایل" icon="upload" className="mt-4">
      <p className="text-sm text-white/60 leading-7">قالب‌های پذیرفته: {formats.map((f) => IMPORT_LABEL[f]).join("، ")} (تا ۲ گیگابایت). داده‌ها به پایگاه داده اصلی <span dir="ltr" className="font-mono">{d.dbName}</span> اضافه می‌شوند{d.engine === "mssql" ? " و جایگزین آن می‌شوند" : ""}.</p>
      <label className={BTN_G + BTN_MD + " mt-3 cursor-pointer" + (pct !== null || d.status !== "running" ? " opacity-60 pointer-events-none" : "")}>
        <Icon name="upload" size={16} />{pct !== null ? "بارگذاری " + fa(pct) + "٪" : "انتخاب فایل"}
        <input type="file" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setError("");
          try { setPct(0); const r = await api.dbaas.upload(f, setPct); await api.dbaas.importDump(d.id, r.uploadId); notify("ورود داده شروع شد", "upload"); }
          catch (err) { setError((err as Error).message); } finally { setPct(null); }
        }} />
      </label>
      {error && <p role="alert" className="text-sm text-rose-300 mt-2">{error}</p>}
      {d.imports.length > 0 && <ul className="divide-y divide-white/[0.06] mt-4">
        {d.imports.map((x) => (
          <li key={x.id} className="py-2.5 text-xs"><span className="flex items-center gap-2"><Badge tone={x.status === "succeeded" ? "green" : x.status === "failed" ? "red" : "blue"} dot>{({ queued: "در صف", running: "در حال ورود", succeeded: "انجام شد", failed: "ناموفق" } as Record<string, string>)[x.status] ?? x.status}</Badge>{x.at} · {IMPORT_LABEL[x.format as keyof typeof IMPORT_LABEL] ?? x.format} · {fa(x.sizeMb, 1)} مگابایت</span>
            {x.output && x.status !== "running" && <pre dir="ltr" className="mt-2 text-[11px] text-white/55 whitespace-pre-wrap max-h-32 overflow-y-auto">{x.output}</pre>}
            {x.status === "failed" && <div className="mt-2"><ExplainButton compact kind="dbaas" resourceId={d.id} errorRef={"imp-" + x.id} /></div>}</li>
        ))}
      </ul>}
    </Card>
  );
}

/* ================= live stats, events, guidance ================= */
export function DbActivity({ d }: { d: PaasDb }) {
  const [s, setS] = useState<{ connections: number | null; sizeMb: number | null; uptime: number | null } | null>(null);
  useEffect(() => { if (d.status === "running") void api.dbaas.stats(d.id).then(setS).catch(() => setS(null)); }, [d.id, d.status]);
  const pool = poolingFor(d.engine);
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start mt-4">
      <Card title="وضعیت لحظه‌ای" icon="gauge">
        <dl className="grid grid-cols-3 gap-3 text-center">
          {([["اتصال فعال", s?.connections, ""], ["حجم داده", s?.sizeMb, "MB"], ["زمان روشن بودن", s?.uptime != null ? Math.round(s.uptime / 3600) : null, "ساعت"]] as [string, number | null | undefined, string][]).map(([k, v, u]) => (
            <div key={k} className="rounded-xl bg-white/[0.03] p-3"><dt className="text-[11px] text-white/50">{k}</dt><dd className="font-black tabular mt-1">{v == null ? "—" : fa(v, u === "MB" ? 1 : 0)} <span className="text-[10px] font-normal text-white/50">{u}</span></dd></div>
          ))}
        </dl>
        {pool && <p className="text-[11px] text-white/55 leading-6 mt-4"><b className="text-white/75">مدیریت اتصال‌ها: </b>{pool}</p>}
      </Card>
      <Card title="رویدادها" icon="scroll-text">
        {d.events.length === 0 ? <p className="text-sm text-white/55">هنوز رویدادی ثبت نشده است.</p> : (
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {d.events.map((e) => <li key={e.id} className="text-xs flex gap-2"><span className={"mt-1 w-1.5 h-1.5 rounded-full shrink-0 " + (e.level === "error" ? "bg-rose-400" : e.level === "warn" ? "bg-amber-300" : "bg-sky-300")} /><span className="min-w-0"><span className="text-white/80">{e.message}</span><span className="block text-[10px] text-white/50">{e.at}</span>{e.level === "error" && <span className="block mt-1"><ExplainButton compact kind="dbaas" resourceId={d.id} errorRef={"ev-" + e.id} label="توضیح" /></span>}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
