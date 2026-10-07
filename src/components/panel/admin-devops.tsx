"use client";
import { useState } from "react";
import { DEVOPS_SERVICES, LEAD_STAGES } from "@/content/devops";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { PLAN_FA, PROJECT_STATUS } from "@/lib/devops-labels";
import { fa, toEnDigits, toman } from "@/lib/format";
import { api, useDB } from "@/lib/store";
import type { DevopsLead, DevopsProject } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, Modal, PageTitle, Select, SideDrawer, StatCard, Switch, Tabs } from "../ui-client";

const stage = (id: string) => LEAD_STAGES.find((s) => s.id === id) ?? LEAD_STAGES[0];
const svc = (slug: string) => DEVOPS_SERVICES.find((s) => s.slug === slug)?.title ?? slug;
const num = (s: string) => Number(toEnDigits(s).replace(/[^\d]/g, "")) || 0;

/** staff: DevOps sales pipeline and signed engagements */
export function AdminDevops() {
  const db = useDB();
  const [tab, setTab] = useState("leads");
  const [filter, setFilter] = useState("open");
  const [lead, setLead] = useState<string | null>(null);
  const [proj, setProj] = useState<string | null>(null);
  const [create, setCreate] = useState<{ leadId?: string; userId: string; title: string; services: string[] } | null>(null);
  const leads = db.devopsLeads.filter((l) => filter === "all" ? true : filter === "open" ? !["won", "lost"].includes(l.status) : l.status === filter);
  const open = db.devopsLeads.filter((l) => !["won", "lost"].includes(l.status));
  const pipeline = open.reduce((s, l) => s + l.value, 0);
  const mrr = db.devopsProjects.filter((p) => p.status === "active").reduce((s, p) => s + p.monthlyFee, 0);
  const closed = db.devopsLeads.filter((l) => l.status === "won" || l.status === "lost");
  const winRate = closed.length ? Math.round((closed.filter((l) => l.status === "won").length / closed.length) * 100) : 0;
  const L = db.devopsLeads.find((l) => l.id === lead) ?? null;
  const P = db.devopsProjects.find((p) => p.id === proj) ?? null;

  return (
    <div>
      <PageTitle title="خدمات دواپس" sub="درخواست‌های مشاوره از /devops و پروژه‌های در جریان."
        action={<button type="button" onClick={() => setCreate({ userId: "", title: "", services: [] })} className={BTN_P + " h-10 px-4 text-sm"}><Icon name="plus" size={16} />پروژه جدید</button>} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <StatCard icon="rocket" label="درخواست‌های باز" value={open.length} sub={fa(db.devopsLeads.filter((l) => l.status === "new").length) + " مورد بررسی‌نشده"} tone={db.devopsLeads.some((l) => l.status === "new") ? "down" : ""} />
        <StatCard icon="wallet" label="ارزش قیف فروش" value={fa(Math.round(pipeline / 1e6))} suffix="میلیون تومان" />
        <StatCard icon="refresh-cw" label="درآمد ماهانه تکرارشونده" value={fa(Math.round(mrr / 1e6))} suffix="میلیون تومان" sub={fa(db.devopsProjects.filter((p) => p.status === "active").length) + " پروژه فعال"} />
        <StatCard icon="trending-up" label="نرخ موفقیت" value={winRate + "٪"} sub={fa(closed.length) + " درخواست بسته‌شده"} />
      </div>
      <div className="mb-4"><Tabs size="sm" value={tab} onChange={setTab} label="بخش" options={[{ id: "leads", label: "درخواست‌ها", icon: "message-circle" }, { id: "projects", label: "پروژه‌ها", icon: "layers" }]} /></div>

      {tab === "leads" ? (
        <Card pad="p-3 sm:p-4" title={<div className="flex flex-wrap gap-1.5">{[["open", "باز"], ...LEAD_STAGES.map((s) => [s.id, s.label]), ["all", "همه"]].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={"h-8 px-3 rounded-lg text-xs transition " + (filter === id ? "bg-white text-black font-bold" : "bg-white/[0.05] text-white/65 hover:text-white")}>{label} ({fa(id === "all" ? db.devopsLeads.length : id === "open" ? open.length : db.devopsLeads.filter((l) => l.status === id).length)})</button>
        ))}</div>}>
          {leads.length === 0 ? <Empty icon="rocket" title="درخواستی در این مرحله نیست" /> : leads.map((l) => (
            <button key={l.id} type="button" onClick={() => setLead(l.id)} className="w-full text-right p-3 rounded-xl hover:bg-white/[0.04] flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="font-bold text-sm">{l.company}</span> <span className="text-white/55 text-xs">— {l.name}{l.role && "، " + l.role}</span>
                <span className="block text-[11px] text-white/50 mt-1">{l.id} · {l.at} · {l.services.map(svc).join("، ")}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {l.urgency.startsWith("فوری") && <Badge tone="red" dot>فوری</Badge>}
                {l.needsNda && <Badge>NDA</Badge>}
                <Badge tone={stage(l.status).tone}>{stage(l.status).label}</Badge>
              </span>
            </button>
          ))}
        </Card>
      ) : (
        <Card pad="p-3 sm:p-4">
          {db.devopsProjects.length === 0 ? <Empty icon="layers" title="هنوز پروژه‌ای ندارید" /> : db.devopsProjects.map((p) => {
            const u = db.users.find((x) => x.id === p.userId);
            const done = p.milestones.filter((m) => m.done).length;
            return (
              <button key={p.id} type="button" onClick={() => setProj(p.id)} className="w-full text-right p-3 rounded-xl hover:bg-white/[0.04] flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0"><span className="font-bold text-sm">{p.title}</span><span className="block text-[11px] text-white/50 mt-1">{u?.company || u?.name || p.userId} · {PLAN_FA[p.plan]}{p.monthlyFee ? " · " + toman(p.monthlyFee) + " ماهانه" : ""}{p.milestones.length ? " · " + fa(done) + "/" + fa(p.milestones.length) + " مرحله" : ""}</span></span>
                <Badge tone={PROJECT_STATUS[p.status][1]}>{PROJECT_STATUS[p.status][0]}</Badge>
              </button>
            );
          })}
        </Card>
      )}

      <SideDrawer open={!!L} onClose={() => setLead(null)} title={L ? L.company + " (" + L.id + ")" : ""} width="w-[600px]">
        {L && <LeadDetail l={L} onProject={() => { const u = db.users.find((x) => x.role === "user" && x.email.toLowerCase() === L.email); setCreate({ leadId: L.id, userId: L.userId || u?.id || "", title: "خدمات دواپس " + L.company, services: L.services }); setLead(null); }} />}
      </SideDrawer>
      <SideDrawer open={!!P} onClose={() => setProj(null)} title={P?.title ?? ""} width="w-[640px]">
        {P && <ProjectDetail key={P.id} p={P} />}
      </SideDrawer>
      {create && <CreateProject init={create} onClose={() => setCreate(null)} onCreated={(id) => { setCreate(null); setTab("projects"); setProj(id); }} />}
    </div>
  );
}

function LeadDetail({ l, onProject }: { l: DevopsLead; onProject: () => void }) {
  const db = useDB();
  const { notify } = useApp();
  const [note, setNote] = useState("");
  const [value, setValue] = useState(l.value ? String(l.value) : "");
  const rows: [string, React.ReactNode][] = [
    ["تماس", <span key="c" className="flex flex-col gap-1"><a href={"mailto:" + l.email} className="acc ltr text-right">{l.email}</a><a href={"tel:" + l.phone} className="acc ltr text-right">{l.phone}</a></span>],
    ["وب‌سایت", l.website ? <a key="w" href={(/^https?:/.test(l.website) ? "" : "https://") + l.website} target="_blank" rel="noopener noreferrer" className="acc ltr">{l.website}</a> : "—"],
    ["شرکت", l.size + "، " + l.stage], ["زیرساخت", l.infra.join("، ")], ["خدمات", l.services.map(svc).join("، ")],
    ["نوع همکاری", l.pkg || "—"], ["بودجه", l.budget], ["زمان شروع", l.urgency], ["NDA", l.needsNda ? "لازم است" : "خیر"], ["مبدأ", <span key="s" className="ltr">{l.source || "—"}</span>],
  ];
  return (
    <div className="p-5 space-y-6">
      <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2.5 text-sm">{rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-white/55">{k}</dt><dd>{v}</dd></div>)}</dl>
      <div><h3 className="text-sm text-white/55 mb-2">شرح درخواست</h3><p className="text-sm leading-7 whitespace-pre-wrap bg-white/[0.03] rounded-xl p-4">{l.message}</p></div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="مرحله"><Select label="مرحله" value={l.status} onChange={async (v) => { await api.devops.updateLead(l.id, { status: v }); notify("مرحله تغییر کرد"); }} options={LEAD_STAGES.map((s) => ({ value: s.id, label: s.label }))} /></Field>
        <Field label="مسئول"><Select label="مسئول" value={l.assignee} onChange={async (v) => { await api.devops.updateLead(l.id, { assignee: v }); }} options={[{ value: "", label: "—" }, ...db.staff.map((s) => ({ value: s.name, label: s.name }))]} /></Field>
        <Field label="ارزش ماهانه (تومان)"><input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} onBlur={async () => { if (num(value) !== l.value) await api.devops.updateLead(l.id, { value: num(value) }); }} dir="ltr" className={INPUT + " text-left"} /></Field>
      </div>
      <div>
        <h3 className="text-sm text-white/55 mb-2">یادداشت‌های داخلی</h3>
        <ol className="space-y-2 mb-3">{l.notes.map((n, i) => <li key={i} className="text-sm bg-white/[0.03] rounded-xl p-3"><span className="text-[11px] text-white/50 block mb-1">{n.by} · {n.at}</span>{n.text}</li>)}</ol>
        <div className="flex gap-2"><label className="sr-only" htmlFor="lead-note">یادداشت</label><input id="lead-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلا: جلسه برای سه‌شنبه هماهنگ شد" className={INPUT} />
          <AsyncButton className={BTN_G + " h-11 px-4 text-sm shrink-0"} onClick={async () => { await api.devops.noteLead(l.id, note); setNote(""); }}>ثبت</AsyncButton></div>
      </div>
      {l.status !== "lost" && <button type="button" onClick={onProject} className={BTN_P + " w-full h-11 text-sm"}><Icon name="rocket" size={16} />قرارداد بسته شد: ساخت پروژه</button>}
    </div>
  );
}

function CreateProject({ init, onClose, onCreated }: { init: { leadId?: string; userId: string; title: string; services: string[] }; onClose: () => void; onCreated: (id: string) => void }) {
  const db = useDB();
  const { notify } = useApp();
  const [f, setF] = useState({ ...init, plan: "growth", fee: "58000000", hours: "50", engineer: "", start: true });
  const customers = db.users.filter((u) => u.role === "user");
  return (
    <Modal open onClose={onClose} title="پروژه دواپس جدید" icon="rocket" size="max-w-xl"
      footer={<><button type="button" onClick={onClose} className={BTN_G + " h-10 px-4 text-sm"}>انصراف</button>
        <AsyncButton className={BTN_P + " h-10 px-5 text-sm"} onClick={async () => { const id = await api.devops.createProject({ userId: f.userId, leadId: f.leadId, title: f.title.trim(), plan: f.plan, services: f.services, monthlyFee: num(f.fee), hoursIncluded: num(f.hours), engineer: f.engineer, start: f.start }); notify("پروژه ساخته شد", "rocket"); onCreated(id); }}>ساخت پروژه</AsyncButton></>}>
      <div className="space-y-4">
        <Field label="مشتری" hint={customers.length ? "مشتری باید حساب کاربری گره داشته باشد؛ اگر ندارد، از بخش کاربران بسازید." : undefined}>
          <Select label="مشتری" value={f.userId} onChange={(v) => setF({ ...f, userId: v })} options={[{ value: "", label: "انتخاب کنید" }, ...customers.map((u) => ({ value: u.id, label: (u.company ? u.company + " — " : "") + u.name + " (" + u.email + ")" }))]} />
        </Field>
        <Field label="عنوان"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={INPUT} /></Field>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="نوع"><Select label="نوع" value={f.plan} onChange={(v) => setF({ ...f, plan: v, fee: v === "startup" ? "24000000" : v === "growth" ? "58000000" : v === "enterprise" ? f.fee : "0", hours: v === "startup" ? "20" : v === "growth" ? "50" : f.hours })} options={Object.entries(PLAN_FA).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="مبلغ ماهانه (تومان)"><input inputMode="numeric" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} dir="ltr" className={INPUT + " text-left"} /></Field>
          <Field label="ساعت ماهانه"><input inputMode="numeric" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} dir="ltr" className={INPUT + " text-left"} /></Field>
        </div>
        <Field label="مهندس مسئول"><Select label="مهندس مسئول" value={f.engineer} onChange={(v) => setF({ ...f, engineer: v })} options={[{ value: "", label: "—" }, ...db.staff.map((s) => ({ value: s.name, label: s.name }))]} /></Field>
        <fieldset><legend className="text-sm text-white/70 mb-2">خدمات</legend><div className="flex flex-wrap gap-1.5">{DEVOPS_SERVICES.map((s) => {
          const on = f.services.includes(s.slug);
          return <button key={s.slug} type="button" aria-pressed={on} onClick={() => setF({ ...f, services: on ? f.services.filter((x) => x !== s.slug) : [...f.services, s.slug] })} className={"h-8 px-3 rounded-lg text-xs border " + (on ? "bg-sky-400/15 border-sky-300/50" : "border-white/[0.12] text-white/65")}>{s.title}</button>;
        })}</div></fieldset>
        <div className="flex items-center justify-between gap-3 text-sm"><span>شروع فوری (صورتحساب ماه اول همین امروز صادر می‌شود)</span><Switch on={f.start} onChange={(v) => setF({ ...f, start: v })} label="شروع فوری" /></div>
      </div>
    </Modal>
  );
}

function ProjectDetail({ p }: { p: DevopsProject }) {
  const { notify } = useApp();
  const [ms, setMs] = useState(p.milestones);
  const [update, setUpdate] = useState("");
  const [inv, setInv] = useState({ desc: "", amount: "" });
  const [hours, setHours] = useState(String(p.hoursUsed));
  return (
    <div className="p-5 space-y-7">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="وضعیت"><Select label="وضعیت" value={p.status} onChange={async (v) => { await api.devops.updateProject(p.id, { status: v }); notify("وضعیت پروژه تغییر کرد"); }} options={Object.entries(PROJECT_STATUS).map(([value, [label]]) => ({ value, label }))} /></Field>
        <Field label={"ساعت مصرف‌شده از " + fa(p.hoursIncluded)}><input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} onBlur={async () => { const h = Number(toEnDigits(hours)) || 0; if (h !== p.hoursUsed) await api.devops.updateProject(p.id, { hoursUsed: h }); }} dir="ltr" className={INPUT + " text-left"} /></Field>
        <div className="text-sm"><div className="text-white/55 mb-2">صورتحساب بعدی</div>{p.nextBill || "—"}<div className="text-xs text-white/50 mt-1">{p.monthlyFee ? toman(p.monthlyFee) + " در ماه" : "بدون مبلغ ماهانه"}</div></div>
      </div>

      <section>
        <h3 className="font-extrabold mb-3">مراحل پروژه (برای مشتری قابل مشاهده)</h3>
        <ul className="space-y-2">{ms.map((m, i) => (
          <li key={m.id || i} className="flex items-center gap-2">
            <input type="checkbox" aria-label={"انجام شد: " + m.title} checked={m.done} onChange={(e) => setMs(ms.map((x, j) => j === i ? { ...x, done: e.target.checked } : x))} className="w-4 h-4 accent-sky-300 shrink-0" />
            <input aria-label="عنوان مرحله" value={m.title} onChange={(e) => setMs(ms.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} className={INPUT + " h-9"} />
            <input aria-label="موعد" value={m.due} onChange={(e) => setMs(ms.map((x, j) => j === i ? { ...x, due: e.target.value } : x))} placeholder="۱۴۰۵/۰۸/۱۵" className={INPUT + " h-9 w-32 shrink-0"} />
            <button type="button" aria-label={"حذف " + m.title} onClick={() => setMs(ms.filter((_, j) => j !== i))} className="w-9 h-9 grid place-items-center rounded-lg hover:bg-white/10 shrink-0"><Icon name="x" size={15} /></button>
          </li>
        ))}</ul>
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={() => setMs([...ms, { id: "", title: "", due: "", done: false }])} className={BTN_G + " h-9 px-3 text-xs"}><Icon name="plus" size={14} />مرحله</button>
          <AsyncButton className={BTN_P + " h-9 px-4 text-xs"} onClick={async () => { await api.devops.setMilestones(p.id, ms.filter((m) => m.title.trim()).map((m) => ({ ...m, id: m.id || undefined }))); notify("مراحل ذخیره شد"); }}>ذخیره مراحل</AsyncButton>
        </div>
      </section>

      <section>
        <h3 className="font-extrabold mb-3">گزارش پیشرفت برای مشتری</h3>
        <label className="sr-only" htmlFor="proj-update">متن گزارش</label>
        <textarea id="proj-update" rows={3} value={update} onChange={(e) => setUpdate(e.target.value)} placeholder="این گزارش در پنل مشتری نمایش داده و ایمیل می‌شود." className={TEXTAREA} />
        <AsyncButton className={BTN_P + " h-9 px-4 text-xs mt-2"} onClick={async () => { await api.devops.postUpdate(p.id, update); setUpdate(""); notify("گزارش برای مشتری ارسال شد", "send"); }}>ارسال گزارش</AsyncButton>
        <ol className="mt-4 space-y-2">{p.updates.map((u, i) => <li key={i} className="text-sm bg-white/[0.03] rounded-xl p-3"><span className="text-[11px] text-white/50 block mb-1">{u.by} · {u.at}</span><span className="whitespace-pre-wrap">{u.text}</span></li>)}</ol>
      </section>

      <section>
        <h3 className="font-extrabold mb-3">صورتحساب یک‌باره</h3>
        <div className="grid sm:grid-cols-[1fr_10rem_auto] gap-2">
          <label className="sr-only" htmlFor="inv-desc">شرح</label><input id="inv-desc" value={inv.desc} onChange={(e) => setInv({ ...inv, desc: e.target.value })} placeholder="مثلا: ۱۲ ساعت اضافه مهر" className={INPUT} />
          <label className="sr-only" htmlFor="inv-amount">مبلغ (تومان)</label><input id="inv-amount" inputMode="numeric" value={inv.amount} onChange={(e) => setInv({ ...inv, amount: e.target.value })} placeholder="مبلغ (تومان)" dir="ltr" className={INPUT + " text-left"} />
          <AsyncButton className={BTN_G + " h-11 px-4 text-sm"} onClick={async () => { const id = await api.devops.invoice(p.id, { desc: inv.desc, amount: num(inv.amount) }); setInv({ desc: "", amount: "" }); notify("صورتحساب " + id + " صادر شد", "receipt"); }}>صدور</AsyncButton>
        </div>
      </section>
    </div>
  );
}
