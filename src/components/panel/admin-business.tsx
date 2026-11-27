"use client";
/* /admin/products › «بسته‌های کسب‌وکار»: prices, contents, order and visibility of the small-business packages.
   Every change saves the whole list at once (business.adminSave); the site shows it on the next load. */
import { useState } from "react";
import type { BizPackage } from "@/lib/business";
import { BTN_G, BTN_MD, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { fa, toEnDigits, toman } from "@/lib/format";
import { api, useDB } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Field } from "../ui";
import { AsyncButton, IconBtn, Modal, Switch } from "../ui-client";

const digits = (v: string) => toEnDigits(v).replace(/\D/g, "");
type Draft = { id: string; isNew: boolean; name: string; for: string; setup: string; monthly: string; quote: boolean; days: string; includes: string; popular: boolean; active: boolean };
const toDraft = (p: BizPackage, isNew = false): Draft => ({ id: p.id, isNew, name: p.name, for: p.for, setup: String(p.setup), monthly: String(p.monthly), quote: !!p.quote, days: p.days, includes: p.includes.join("\n"), popular: !!p.popular, active: p.active });
const fromDraft = (d: Draft): BizPackage => ({
  id: d.id, name: d.name.trim(), for: d.for.trim(), setup: d.quote ? 0 : +digits(d.setup), monthly: d.quote ? 0 : +digits(d.monthly), quote: d.quote || undefined,
  days: d.days.trim(), includes: d.includes.split("\n").map((x) => x.trim()).filter(Boolean), popular: d.popular || undefined, active: d.active,
});
const newId = () => "biz-" + crypto.randomUUID().slice(0, 8);

export function AdminBizPackages() {
  const list = useDB().bizPackages;
  const { notify } = useApp();
  const [edit, setEdit] = useState<Draft | null>(null);
  const save = async (next: BizPackage[], msg = "ذخیره شد") => { await api.business.adminSave(next); notify(msg); };
  const move = (i: number, by: -1 | 1) => { const n = [...list]; const [p] = n.splice(i, 1); n.splice(i + by, 0, p); return save(n, "ترتیب ذخیره شد"); };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-white/60 leading-7 max-w-2xl">بسته‌هایی که در صفحه اول و <span className="ltr">/business</span> نمایش داده می‌شوند. قیمت‌ها به تومان و بدون مالیات است. بسته‌ای که درخواست دارد حذف نمی‌شود؛ غیرفعالش کنید.</p>
        <span className="flex gap-2">
          <button type="button" className={BTN_P + BTN_MD} onClick={() => setEdit(toDraft({ id: newId(), name: "", for: "", setup: 0, monthly: 0, days: "", includes: [], active: true }, true))}><Icon name="plus" size={16} />بسته جدید</button>
          <AsyncButton className={BTN_G + BTN_MD} confirmText="همه بسته‌ها به قیمت‌ها و متن‌های پیش‌فرض برگردند؟" onClick={async () => { await api.business.adminReset(); notify("به پیش‌فرض برگشت"); }}>بازگرداندن پیش‌فرض</AsyncButton>
        </span>
      </div>
      <ul className="space-y-2.5">
        {list.map((p, i) => (
          <li key={p.id} className={"rounded-2xl p-4 border flex flex-wrap items-center gap-4 " + (p.active ? "bg-white/[0.035] border-white/[0.1]" : "border-dashed border-white/15 opacity-70")}>
            <span className="flex flex-col">
              <IconBtn icon="chevron-up" label={"بالاتر بردن " + p.name} onClick={() => i > 0 && move(i, -1)} className={i === 0 ? "invisible" : ""} />
              <IconBtn icon="chevron-down" label={"پایین‌تر بردن " + p.name} onClick={() => i < list.length - 1 && move(i, 1)} className={i === list.length - 1 ? "invisible" : ""} />
            </span>
            <span className="flex-1 min-w-48">
              <span className="font-bold flex items-center gap-2">بسته {p.name}{p.popular && <Badge tone="blue">بیشترین انتخاب</Badge>}{!p.active && <Badge>پنهان</Badge>}</span>
              <span className="block text-xs text-white/55 mt-1">{p.for}</span>
            </span>
            <span className="text-sm tabular text-end min-w-40">
              {p.quote ? <span className="text-white/70">قیمت بعد از جلسه</span> : <><b>{toman(p.monthly)}</b> <span className="text-white/50 text-xs">در ماه</span><span className="block text-xs text-white/55">راه‌اندازی {toman(p.setup)}</span></>}
            </span>
            <span className="text-xs text-white/55 min-w-20">{fa(p.includes.length)} مورد · {p.days}</span>
            <Switch on={p.active} label={"نمایش بسته " + p.name} onChange={(v) => save(list.map((x) => (x.id === p.id ? { ...x, active: v } : x)), v ? "بسته نمایش داده می‌شود" : "بسته پنهان شد")} />
            <IconBtn icon="pencil" label={"ویرایش بسته " + p.name} onClick={() => setEdit(toDraft(p))} />
          </li>
        ))}
      </ul>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? "بسته جدید" : "ویرایش بسته " + (edit?.name ?? "")} icon="store" size="max-w-2xl"
        footer={<><AsyncButton onClick={async () => {
          if (!edit) return;
          const p = fromDraft(edit);
          if (p.name.length < 2) throw new Error("نام بسته را بنویسید.");
          if (!p.quote && !p.monthly && !p.setup) throw new Error("قیمت بگذارید یا «قیمت بعد از جلسه» را روشن کنید.");
          // one package carries the «بیشترین انتخاب» badge
          const others = list.filter((x) => x.id !== p.id).map((x) => (p.popular ? { ...x, popular: undefined } : x));
          const next = edit.isNew ? [...others, p] : list.map((x) => (x.id === p.id ? p : others.find((o) => o.id === x.id)!));
          await save(next, "بسته ذخیره شد"); setEdit(null);
        }}>ذخیره</AsyncButton><button type="button" onClick={() => setEdit(null)} className={BTN_G + BTN_MD}>انصراف</button></>}>
        {edit && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="نام بسته" hint="بدون کلمه «بسته»؛ مثلا فروشگاه"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={INPUT} /></Field>
              <Field label="زمان آماده شدن"><input value={edit.days} onChange={(e) => setEdit({ ...edit, days: e.target.value })} placeholder="مثلا ۱ تا ۲ هفته" className={INPUT} /></Field>
            </div>
            <Field label="برای چه کسی"><input value={edit.for} onChange={(e) => setEdit({ ...edit, for: e.target.value })} className={INPUT} /></Field>
            <div className="flex items-center justify-between"><span className="text-sm">قیمت بعد از جلسه آشنایی (بدون قیمت ثابت)</span><Switch on={edit.quote} label="قیمت بعد از جلسه" onChange={(v) => setEdit({ ...edit, quote: v })} /></div>
            {!edit.quote && (
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="هزینه ماهانه (تومان)"><input value={edit.monthly} inputMode="numeric" onChange={(e) => setEdit({ ...edit, monthly: digits(e.target.value) })} dir="ltr" className={INPUT + " text-start tabular"} /></Field>
                <Field label="هزینه راه‌اندازی یک‌باره (تومان)"><input value={edit.setup} inputMode="numeric" onChange={(e) => setEdit({ ...edit, setup: digits(e.target.value) })} dir="ltr" className={INPUT + " text-start tabular"} /></Field>
              </div>
            )}
            <Field label="چه چیزهایی در بسته است" hint="هر مورد در یک خط؛ به زبان ساده و بدون اصطلاح فنی.">
              <textarea rows={7} value={edit.includes} onChange={(e) => setEdit({ ...edit, includes: e.target.value })} className={TEXTAREA} />
            </Field>
            <div className="flex items-center justify-between"><span className="text-sm">برچسب «بیشترین انتخاب»</span><Switch on={edit.popular} label="بیشترین انتخاب" onChange={(v) => setEdit({ ...edit, popular: v })} /></div>
            <div className="flex items-center justify-between"><span className="text-sm">نمایش در سایت</span><Switch on={edit.active} label="نمایش در سایت" onChange={(v) => setEdit({ ...edit, active: v })} /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
