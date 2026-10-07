"use client";
import { useState } from "react";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { api, useDB, type ClientDB } from "@/lib/store";
import { COMPONENTS, INCIDENT_STATUS, SEVERITY } from "@/lib/status";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, IconBtn, Modal, PageTitle, Select } from "../ui-client";

type Inc = ClientDB["incidents"][number];
type Form = { id?: string; title: string; severity: string; status: string; components: string[]; text: string };

/* ================= status page / incidents ================= */
export function AdminStatus() {
  const db = useDB();
  const { notify, confirm } = useApp();
  const [f, setF] = useState<Form | null>(null);
  const open = db.incidents.filter((i) => i.status !== "resolved");
  const edit = (i: Inc) => setF({ id: i.id, title: i.title, severity: i.severity, status: i.status, components: i.components, text: "" });
  const tone = (s: string) => (s === "critical" ? "red" : s === "major" ? "amber" : s === "maintenance" ? "blue" : "gray");
  return (
    <div>
      <PageTitle title="وضعیت و رخدادها" sub="رخدادهای ثبت‌شده در صفحه عمومی /status نمایش داده می‌شوند."
        action={<div className="flex gap-2"><a href="/status" target="_blank" className={BTN_G + " px-4 h-10 text-sm"}><Icon name="external-link" size={16} /> صفحه عمومی</a>
          <button type="button" onClick={() => setF({ title: "", severity: "major", status: "investigating", components: [], text: "" })} className={BTN_P + " px-4 h-10 text-sm"}><Icon name="plus" size={16} /> رخداد جدید</button></div>} />
      <Card title={"رخدادهای باز (" + open.length.toLocaleString("fa-IR") + ")"} icon="activity" pad="p-3 sm:p-4">
        {db.incidents.length === 0 ? <Empty icon="circle-check" title="رخدادی ثبت نشده" /> : db.incidents.map((i) => (
          <div key={i.id} className="p-3 rounded-xl hover:bg-white/[0.03] flex flex-wrap gap-3 items-start justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className="font-bold">{i.title}</span><Badge tone={tone(i.severity)}>{SEVERITY[i.severity]}</Badge><Badge tone={i.status === "resolved" ? "green" : "amber"}>{INCIDENT_STATUS[i.status]}</Badge></div>
              <div className="text-[11px] text-white/55 mt-1">{i.at} — {i.components.map((c) => COMPONENTS.find((x) => x.id === c)?.label ?? c).join("، ")}</div>
              {i.updates[0] && <p className="text-sm text-white/65 mt-2 leading-7">{i.updates[0].text}</p>}
            </div>
            <div className="flex gap-1">
              {i.status !== "resolved" && <button type="button" onClick={() => edit(i)} className={BTN_G + " px-3 h-8 text-xs"}>به‌روزرسانی</button>}
              <IconBtn icon="trash-2" label={"حذف " + i.title} className="hover:text-rose-300" onClick={async () => { if (await confirm("رخداد «" + i.title + "» حذف شود؟", { danger: true, ok: "حذف" })) { await api.admin.deleteIncident(i.id); notify("حذف شد"); } }} />
            </div>
          </div>
        ))}
      </Card>
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? "به‌روزرسانی رخداد" : "رخداد جدید"} icon="activity" size="max-w-2xl"
        footer={<><button type="button" onClick={() => setF(null)} className={BTN_G + " px-4 h-10 text-sm"}>انصراف</button><AsyncButton onClick={async () => { if (!f) return; if (!f.components.length) throw new Error("حداقل یک بخش را انتخاب کنید."); await api.admin.saveIncident(f); setF(null); notify("منتشر شد", "activity"); }}>انتشار</AsyncButton></>}>
        {f && <div className="space-y-4">
          <Field label="عنوان"><input value={f.title} onChange={(e) => setF((x) => x && { ...x, title: e.target.value })} className={INPUT} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="شدت"><Select label="شدت" value={f.severity} onChange={(v) => setF((x) => x && { ...x, severity: v })} options={Object.entries(SEVERITY).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="وضعیت"><Select label="وضعیت" value={f.status} onChange={(v) => setF((x) => x && { ...x, status: v })} options={Object.entries(INCIDENT_STATUS).map(([value, label]) => ({ value, label }))} /></Field>
          </div>
          <fieldset><legend className="text-xs text-white/60 mb-2">بخش‌های درگیر</legend>
            <div className="grid sm:grid-cols-2 gap-2">{COMPONENTS.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm rounded-lg bg-white/[0.03] border border-white/[0.08] px-3 py-2 cursor-pointer">
                <input type="checkbox" className="accent-white" checked={f.components.includes(c.id)} onChange={(e) => setF((x) => x && { ...x, components: e.target.checked ? [...x.components, c.id] : x.components.filter((y) => y !== c.id) })} />{c.label}
              </label>
            ))}</div>
          </fieldset>
          <Field label="متن به‌روزرسانی" hint="این متن با زمان ثبت در صفحه وضعیت منتشر می‌شود."><textarea value={f.text} onChange={(e) => setF((x) => x && { ...x, text: e.target.value })} rows={4} className={TEXTAREA} /></Field>
        </div>}
      </Modal>
    </div>
  );
}
