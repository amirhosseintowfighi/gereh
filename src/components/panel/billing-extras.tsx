"use client";
/* Account billing tools (forecast, low-credit alert, budgets, project wallets, invoice profiles),
   notification matrix with Web Push, 2FA recovery codes, custom team roles and the staff settings. */
import { Fragment, useState } from "react";
import { BTN_G, BTN_MD, BTN_P, BTN_SM, INPUT } from "@/lib/cls";
import { fa, toEnDigits, toman } from "@/lib/format";
import { useDB, useMyId } from "@/lib/store";
import { PERM_LABEL, PERM_LEVELS, TEAM_SERVICES, type InvoiceProfile, type PermLevel } from "@/lib/vps-billing";
import { accountApi, billingApi, teamApi } from "@/lib/vps-billing-api";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field, Meter } from "../ui";
import { AsyncButton, IconBtn, Modal, Select, Switch } from "../ui-client";
import { Loading, useRemote } from "./vps-extras";

const num = (v: string) => +toEnDigits(v).replace(/\D/g, "") || 0;

/* ---------- billing page ---------- */
export function BillingExtras() {
  const x = useRemote("billing", () => billingApi.extras());
  const db = useDB(); const myId = useMyId();
  const { notify, confirm } = useApp();
  const [low, setLow] = useState<{ auto: boolean; amount: string } | null>(null);
  const [bud, setBud] = useState({ service: "all", cap: "", pct: "80", block: false });
  const [tr, setTr] = useState({ from: "", to: "", amount: "" });
  const [prof, setProf] = useState<(Omit<InvoiceProfile, "id"> & { id?: string }) | null>(null);
  const [apply, setApply] = useState({ inv: "", profile: "" });
  if (x.error) return <Card className="mt-6"><Empty icon="circle-alert" title="بارگذاری نشد" text={x.error} /></Card>;
  if (!x.data) return <Card className="mt-6"><Loading /></Card>;
  const v = x.data;
  const lowForm = low ?? { auto: v.forecast.auto, amount: String(v.forecast.manual || "") };
  const done = (m: string) => { notify(m, "wallet"); x.reload(); };
  const walletOpts = [{ value: "", label: "کیف پول اصلی" }, ...v.wallets.map((w) => ({ value: w.id, label: w.name }))];
  const myInvoices = db.invoices.filter((i) => i.userId === myId);
  return (
    <div className="mt-6 space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="پیش‌بینی موجودی" icon="gauge" action={<Badge tone="blue">سطح حساب: {v.level.label}</Badge>}>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-xs text-white/55">مصرف روزانه (میانگین ۷ روز)</dt><dd className="mt-1 font-bold">{toman(v.forecast.burn)}</dd></div>
            <div><dt className="text-xs text-white/55">موجودی کافی است تا</dt><dd className="mt-1 font-bold">{v.forecast.days === null ? "مصرفی ثبت نشده" : v.forecast.until + " (" + fa(v.forecast.days) + " روز)"}</dd></div>
            <div><dt className="text-xs text-white/55">آستانه هشدار کم‌بودن موجودی</dt><dd className="mt-1 font-bold">{toman(v.forecast.threshold)} {v.forecast.auto && <span className="text-[11px] text-white/55 font-normal">(خودکار: ۳ روز مصرف)</span>}</dd></div>
            <div><dt className="text-xs text-white/55">سقف بدهی مجاز پیش از تعلیق</dt><dd className="mt-1 font-bold">{toman(v.policy.negativeGrace)}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-white/55">پشتیبانی و SLA</dt><dd className="mt-1">{v.level.support}، دسترس‌پذیری {v.level.sla}</dd></div>
          </dl>
        </Card>
        <Card title="هشدار کم‌بودن موجودی" icon="bell-ring">
          <div className="flex items-center justify-between mb-4"><span className="text-sm">آستانه خودکار (۳ روز مصرف فعلی)</span><Switch on={lowForm.auto} label="آستانه خودکار" onChange={(on) => setLow({ ...lowForm, auto: on })} /></div>
          <Field label="آستانه دستی (تومان)"><input disabled={lowForm.auto} value={lowForm.amount} onChange={(e) => setLow({ ...lowForm, amount: e.target.value })} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} /></Field>
          <div className="mt-4 flex justify-end"><AsyncButton onClick={async () => { await billingApi.setLowCredit({ auto: lowForm.auto, amount: num(lowForm.amount) }); setLow(null); done("آستانه هشدار ذخیره شد"); }}>ذخیره</AsyncButton></div>
        </Card>
      </div>

      <Card title="سقف بودجه ماهانه" icon="chart-line" pad="p-3 sm:p-4">
        <p className="text-xs text-white/55 leading-6 px-2 mb-3">با رسیدن هزینه ماه به درصد هشدار و به سقف، اعلان می‌گیرید. با «توقف خرید»، خریدهای جدید (IPv4، دیسک، بسته ترافیک و…) پس از سقف رد می‌شوند. بودجه هر اپ گره اپ جداگانه در تنظیمات همان اپ است.</p>
        {v.budgets.map((b) => (
          <div key={b.service} className="flex flex-wrap items-center gap-4 p-3 rounded-xl hover:bg-white/[0.03]">
            <div className="w-40 text-sm font-bold">{b.label}</div>
            <div className="flex-1 min-w-48"><Meter value={b.spent} max={b.monthlyCap} right={toman(b.spent) + " از " + toman(b.monthlyCap)} /></div>
            <Badge tone={b.block ? "red" : "gray"}>{b.block ? "توقف خرید" : "فقط هشدار"} — {fa(b.alertPct)}٪</Badge>
            <IconBtn icon="trash-2" label={"حذف بودجه " + b.label} className="hover:text-rose-300" onClick={async () => { await billingApi.removeBudget(b.service); done("بودجه حذف شد"); }} />
          </div>
        ))}
        <div className="grid sm:grid-cols-[1fr_1fr_100px_auto_auto] gap-2 items-end p-2 mt-2">
          <Field label="سرویس"><Select label="سرویس" value={bud.service} onChange={(s) => setBud({ ...bud, service: s })} options={v.services.map((s) => ({ value: s.id, label: s.label }))} /></Field>
          <Field label="سقف ماهانه (تومان)"><input value={bud.cap} onChange={(e) => setBud({ ...bud, cap: e.target.value })} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} /></Field>
          <Field label="هشدار (٪)"><input value={bud.pct} onChange={(e) => setBud({ ...bud, pct: e.target.value })} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} /></Field>
          <label className="flex items-center gap-2 h-11 text-xs"><Switch on={bud.block} label="توقف خرید" onChange={(b) => setBud({ ...bud, block: b })} />توقف خرید</label>
          <AsyncButton onClick={async () => { await billingApi.setBudget({ service: bud.service, monthlyCap: num(bud.cap), alertPct: num(bud.pct) || 80, block: bud.block }); setBud({ ...bud, cap: "" }); done("بودجه ذخیره شد"); }}>ذخیره</AsyncButton>
        </div>
      </Card>

      <Card title="کیف پول‌های پروژه" icon="wallet" pad="p-3 sm:p-4" action={<AsyncButton className={BTN_P + BTN_SM} onClick={async () => { const n = window.prompt("نام پروژه"); if (n) { await billingApi.createWallet(n); done("کیف پول پروژه ساخته شد"); } }}><Icon name="plus" size={14} /> کیف پول جدید</AsyncButton>}>
        <p className="text-xs text-white/55 leading-6 px-2 mb-3">پول را برای هر پروژه جدا کنید و سرورهای پروژه را در تنظیمات سرور به آن وصل کنید؛ هزینه ساعتی آن‌ها اول از کیف پول پروژه کسر می‌شود.</p>
        {v.wallets.length === 0 ? <Empty icon="wallet" title="کیف پول پروژه‌ای ندارید" /> : v.wallets.map((w) => (
          <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
            <div><div className="text-sm font-bold">{w.name}</div><div className="text-[11px] text-white/55">{w.servers.length ? w.servers.map((s) => s.name).join("، ") : "بدون سرور"}</div></div>
            <div className="flex items-center gap-2"><span className="font-black tabular">{toman(w.balance)}</span>
              <IconBtn icon="trash-2" label={"بستن " + w.name} className="hover:text-rose-300" onClick={async () => { if (await confirm("کیف پول " + w.name + " بسته و موجودی به کیف پول اصلی برگردد؟", { danger: true, ok: "بستن" })) { await billingApi.deleteWallet(w.id); done("کیف پول بسته شد"); } }} /></div>
          </div>
        ))}
        {v.wallets.length > 0 && <div className="grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-2 mt-2">
          <Field label="از"><Select label="مبدأ" value={tr.from} onChange={(f) => setTr({ ...tr, from: f })} options={walletOpts} /></Field>
          <Field label="به"><Select label="مقصد" value={tr.to} onChange={(t) => setTr({ ...tr, to: t })} options={walletOpts} /></Field>
          <Field label="مبلغ (تومان)"><input value={tr.amount} onChange={(e) => setTr({ ...tr, amount: e.target.value })} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} /></Field>
          <AsyncButton onClick={async () => { await billingApi.transfer(tr.from, tr.to, num(tr.amount)); setTr({ ...tr, amount: "" }); done("انتقال انجام شد"); }}>انتقال</AsyncButton>
        </div>}
        {v.transfers.length > 0 && <div className="mt-3 px-2 space-y-1 text-xs text-white/60">{v.transfers.slice(0, 8).map((t) => <div key={t.id}>{t.at}: {t.from} ← {t.to}، {toman(t.amount)}{t.note && " — " + t.note}</div>)}</div>}
      </Card>

      <Card title="پروفایل‌های صورتحساب رسمی" icon="file-text" pad="p-3 sm:p-4" action={<button type="button" onClick={() => setProf({ label: "", name: "", nationalId: "", economicCode: "", address: "", postalCode: "", isDefault: v.profiles.length === 0 })} className={BTN_P + BTN_SM}><Icon name="plus" size={14} /> پروفایل جدید</button>}>
        {v.profiles.length === 0 ? <Empty icon="file-text" title="پروفایلی ندارید" text="مشخصات شخص حقیقی یا حقوقی را یک بار ذخیره کنید و برای هر صورتحساب انتخاب کنید." /> : v.profiles.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
            <div><div className="text-sm font-bold">{p.label} {p.isDefault && <Badge tone="green">پیش‌فرض</Badge>}</div><div className="text-[11px] text-white/55">{p.name}، شناسه {p.nationalId}{p.economicCode && "، کد اقتصادی " + p.economicCode}</div></div>
            <div className="flex gap-1"><IconBtn icon="pencil" label={"ویرایش " + p.label} onClick={() => setProf(p)} /><IconBtn icon="trash-2" label={"حذف " + p.label} className="hover:text-rose-300" onClick={async () => { await billingApi.deleteProfile(p.id); done("پروفایل حذف شد"); }} /></div>
          </div>
        ))}
        {v.profiles.length > 0 && myInvoices.length > 0 && <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end p-2 mt-2">
          <Field label="صورتحساب"><Select label="صورتحساب" value={apply.inv} onChange={(i) => setApply({ ...apply, inv: i })} options={[{ value: "", label: "انتخاب کنید" }, ...myInvoices.map((i) => ({ value: i.id, label: i.id + " — " + i.date }))]} /></Field>
          <Field label="پروفایل خریدار"><Select label="پروفایل" value={apply.profile || v.profiles.find((p) => p.isDefault)?.id || ""} onChange={(p) => setApply({ ...apply, profile: p })} options={v.profiles.map((p) => ({ value: p.id, label: p.label }))} /></Field>
          <AsyncButton disabled={!apply.inv} onClick={async () => { await billingApi.useProfile(apply.inv, apply.profile || v.profiles.find((p) => p.isDefault)?.id || v.profiles[0].id); done("مشخصات خریدار روی صورتحساب ثبت شد"); }}>ثبت روی صورتحساب</AsyncButton>
        </div>}
      </Card>
      <Modal open={!!prof} onClose={() => setProf(null)} title="پروفایل صورتحساب" icon="file-text" footer={<><AsyncButton onClick={async () => { if (!prof) return; await billingApi.saveProfile(prof); setProf(null); done("پروفایل ذخیره شد"); }}>ذخیره</AsyncButton><button type="button" onClick={() => setProf(null)} className={BTN_G + BTN_MD}>انصراف</button></>}>
        {prof && <div className="grid sm:grid-cols-2 gap-4">
          <Field label="عنوان"><input value={prof.label} onChange={(e) => setProf({ ...prof, label: e.target.value })} className={INPUT} placeholder="مثلا شرکت" /></Field>
          <Field label="نام شخص یا شرکت"><input value={prof.name} onChange={(e) => setProf({ ...prof, name: e.target.value })} className={INPUT} /></Field>
          <Field label="کد ملی / شناسه ملی"><input value={prof.nationalId} onChange={(e) => setProf({ ...prof, nationalId: e.target.value })} dir="ltr" className={INPUT + " text-left tabular"} /></Field>
          <Field label="کد اقتصادی (اختیاری)"><input value={prof.economicCode} onChange={(e) => setProf({ ...prof, economicCode: e.target.value })} dir="ltr" className={INPUT + " text-left tabular"} /></Field>
          <Field label="کد پستی"><input value={prof.postalCode} onChange={(e) => setProf({ ...prof, postalCode: e.target.value })} dir="ltr" className={INPUT + " text-left tabular"} /></Field>
          <label className="flex items-center gap-2 text-sm mt-6"><Switch on={prof.isDefault} label="پیش‌فرض" onChange={(d) => setProf({ ...prof, isDefault: d })} />پیش‌فرض</label>
          <Field className="sm:col-span-2" label="نشانی"><input value={prof.address} onChange={(e) => setProf({ ...prof, address: e.target.value })} className={INPUT} /></Field>
        </div>}
      </Modal>
    </div>
  );
}

/* ---------- account: notification matrix ---------- */
const KINDS = [["billing", "صورتحساب و پرداخت"], ["service", "وضعیت سرویس‌ها و قطعی"], ["security", "امنیت و ورود"], ["news", "خبرنامه و تخفیف‌ها"]];
const COLS: [string, string][] = [["email", "ایمیل"], ["sms", "پیامک"], ["push", "اعلان مرورگر"], ["telegram", "تلگرام و بله"]];
/** telegram defaults on (linked chats get every kind they subscribe to); push is opt-in */
const prefOn = (prefs: Record<string, boolean>, k: string, c: string) => (c === "telegram" ? prefs[k + "_telegram"] !== false : !!prefs[k + "_" + c]);

export function NotifMatrix() {
  const db = useDB();
  const x = useRemote("account", () => accountApi.extras());
  const { notify } = useApp();
  const subscribe = async () => {
    const key = x.data?.pushKey;
    if (!key) throw new Error("اعلان مرورگر هنوز روی سرور راه‌اندازی نشده است.");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("این مرورگر از اعلان پشتیبانی نمی‌کند.");
    if ((await Notification.requestPermission()) !== "granted") throw new Error("اجازه نمایش اعلان داده نشد.");
    const reg = await navigator.serviceWorker.register("/sw.js");
    const pad = "=".repeat((4 - (key.length % 4)) % 4);
    const raw = Uint8Array.from(atob((key + pad).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const sub = (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw })).toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await accountApi.pushSubscribe({ endpoint: sub.endpoint, keys: sub.keys });
    notify("این مرورگر برای اعلان ثبت شد", "bell");
    x.reload();
  };
  return (
    <Card title="تنظیمات اعلان" icon="bell" pad="p-3 sm:p-4">
      <div className="overflow-x-auto"><div className="grid grid-cols-[minmax(160px,1fr)_repeat(4,auto)] gap-x-6 items-center text-sm min-w-[520px]">
        <div className="text-xs text-white/55 p-3">موضوع</div>{COLS.map(([, l]) => <div key={l} className="text-xs text-white/55 text-center">{l}</div>)}
        {KINDS.map(([k, l]) => (
          <Fragment key={k}>
            <div className="p-3 border-t border-white/[0.06]">{l}</div>
            {COLS.map(([c, cl]) => <div key={c} className="border-t border-white/[0.06] py-3 flex justify-center"><Switch on={prefOn(db.notifPrefs, k, c)} label={l + "، " + cl} onChange={(v) => accountApi.setNotif(k + "_" + c, v)} /></div>)}
          </Fragment>
        ))}
      </div></div>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.07]">
        <div className="text-xs text-white/60 leading-6">مرورگرهای ثبت‌شده: {x.data?.pushDevices.length ? x.data.pushDevices.map((d) => d.device + " (" + d.at + ")").join("، ") : "هیچ"}</div>
        <div className="flex gap-2">
          {x.data?.pushDevices.map((d) => <IconBtn key={d.id} icon="x" label={"حذف " + d.device} onClick={async () => { await accountApi.pushRemove(d.id); x.reload(); }} />)}
          <AsyncButton className={BTN_G + BTN_SM} onClick={subscribe}><Icon name="bell-ring" size={14} /> فعال‌سازی در این مرورگر</AsyncButton>
        </div>
      </div>
    </Card>
  );
}

/* ---------- account: recovery codes and level ---------- */
export function SecurityExtras() {
  const x = useRemote("account", () => accountApi.extras());
  const { notify } = useApp();
  const [codes, setCodes] = useState<string[] | null>(null);
  if (!x.data) return null;
  return (
    <>
      <Card title="کدهای بازیابی ورود دومرحله‌ای" icon="key-round" action={x.data.twofa && <Badge>{fa(x.data.recoveryLeft)} کد باقی مانده</Badge>}>
        <p className="text-sm text-white/55 leading-7">اگر به اپلیکیشن Authenticator دسترسی نداشتید، با یکی از این کدها وارد شوید. هر کد یک بار مصرف می‌شود؛ ساخت کدهای جدید، کدهای قبلی را باطل می‌کند.</p>
        {codes ? <div className="mt-4 grid grid-cols-2 gap-2 mono text-sm ltr">{codes.map((c) => <span key={c} className="rounded-lg bg-white/[0.05] px-3 py-2 text-center">{c}</span>)}</div> : null}
        <div className="mt-4 flex justify-end"><AsyncButton disabled={!x.data.twofa} confirmText={x.data.recoveryLeft ? "کدهای قبلی باطل و ۱۰ کد جدید ساخته شود؟" : undefined} onClick={async () => { setCodes(await accountApi.recoveryCodes()); notify("کدهای بازیابی ساخته شد؛ آن‌ها را جای امنی نگه دارید", "key-round"); x.reload(); }}>ساخت کدهای جدید</AsyncButton></div>
      </Card>
      <Card title="سطح حساب" icon="badge-check" action={<Badge tone="blue">{x.data.level.label}</Badge>}>
        <dl className="space-y-3 text-sm"><div className="flex justify-between"><dt className="text-white/55">SLA دسترس‌پذیری</dt><dd>{x.data.level.sla}</dd></div><div className="flex justify-between gap-4"><dt className="text-white/55">اولویت پشتیبانی</dt><dd className="text-left">{x.data.level.support}</dd></div></dl>
        <p className="text-[11px] text-white/50 mt-4">ارتقای سطح (توسعه‌دهنده، استارتاپ، سازمانی) با درخواست از پشتیبانی انجام می‌شود.</p>
      </Card>
    </>
  );
}

/* ---------- team: custom roles and transfers ---------- */
export function TeamExtras() {
  const db = useDB();
  const x = useRemote("roles", () => teamApi.roles());
  const { notify, confirm } = useApp();
  const [edit, setEdit] = useState<{ id?: string; name: string; perms: Record<string, PermLevel> } | null>(null);
  const [move, setMove] = useState<{ member: string; servers: string[]; confirm: string } | null>(null);
  const members = db.team.members;
  if (!x.data) return null;
  const roles = x.data;
  return (
    <div className="mt-4 space-y-4">
      <Card title="نقش‌های سفارشی" icon="users-round" pad="p-3 sm:p-4" action={<button type="button" onClick={() => setEdit({ name: "", perms: {} })} className={BTN_P + BTN_SM}><Icon name="plus" size={14} /> نقش جدید</button>}>
        <p className="text-xs text-white/55 leading-6 px-2 mb-3">برای هر سرویس سطح دسترسی تعیین کنید: مشاهده، استقرار، بهره‌برداری (روشن/خاموش، کنسول، بکاپ) یا مدیریت کامل. نقش سفارشی روی نقش پایه عضو اعمال و آن را محدودتر می‌کند.</p>
        {roles.length === 0 ? <Empty icon="users-round" title="نقش سفارشی ندارید" /> : roles.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
            <div><div className="text-sm font-bold">{r.name}</div><div className="text-[11px] text-white/55">{Object.entries(r.perms).map(([k, v]) => TEAM_SERVICES[k] + ": " + PERM_LABEL[v]).join("، ")}</div></div>
            <div className="flex gap-1"><IconBtn icon="pencil" label={"ویرایش " + r.name} onClick={() => setEdit({ id: r.id, name: r.name, perms: r.perms })} />
              <IconBtn icon="trash-2" label={"حذف " + r.name} className="hover:text-rose-300" onClick={async () => { if (await confirm("نقش " + r.name + " حذف شود؟ اعضای آن به نقش پایه برمی‌گردند.", { danger: true, ok: "حذف" })) { await teamApi.deleteRole(r.id); x.reload(); } }} /></div>
          </div>
        ))}
        {members.length > 0 && roles.length > 0 && <div className="mt-3 space-y-2 px-2">{members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{m.name} <span className="text-white/50 text-xs ltr">{m.email}</span></span>
            <Select className="w-56" label={"نقش " + m.name} value={roles.find((r) => r.members.includes(m.id))?.id ?? ""} onChange={async (rid) => { await teamApi.assignRole(m.id, rid || null); notify("نقش عضو تغییر کرد"); x.reload(); }} options={[{ value: "", label: "فقط نقش پایه" }, ...roles.map((r) => ({ value: r.id, label: r.name }))]} /></div>
        ))}</div>}
      </Card>
      {members.length > 0 && <Card title="انتقال مالکیت سرور" icon="arrow-up-down">
        <p className="text-sm text-white/55 leading-7">سرورها همراه IPv4 و دیسک‌های اضافه‌شان به حساب یکی از اعضای تیم منتقل می‌شوند و هزینه از آن پس با او است.</p>
        <div className="mt-4 flex justify-end"><button type="button" onClick={() => setMove({ member: members[0].id, servers: [], confirm: "" })} className={BTN_G + BTN_MD}>انتقال سرور</button></div>
      </Card>}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="نقش سفارشی" icon="users-round" footer={<><AsyncButton onClick={async () => { if (!edit) return; await teamApi.saveRole(edit); setEdit(null); notify("نقش ذخیره شد"); x.reload(); }}>ذخیره</AsyncButton><button type="button" onClick={() => setEdit(null)} className={BTN_G + BTN_MD}>انصراف</button></>}>
        {edit && <div className="space-y-3">
          <Field label="نام نقش"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={INPUT} /></Field>
          {Object.entries(TEAM_SERVICES).map(([k, l]) => (
            <div key={k} className="flex items-center justify-between gap-3"><span className="text-sm">{l}</span>
              <Select className="w-44" label={"دسترسی " + l} value={edit.perms[k] ?? "none"} onChange={(p) => setEdit({ ...edit, perms: { ...edit.perms, [k]: p as PermLevel } })} options={PERM_LEVELS.map((p) => ({ value: p, label: PERM_LABEL[p] }))} /></div>
          ))}
        </div>}
      </Modal>
      <Modal open={!!move} onClose={() => setMove(null)} title="انتقال مالکیت سرور" icon="arrow-up-down" footer={<><AsyncButton danger disabled={!move?.servers.length} onClick={async () => { if (!move) return; await teamApi.transferServers(move.servers, move.member, move.confirm); setMove(null); notify("مالکیت منتقل شد"); }}>انتقال</AsyncButton><button type="button" onClick={() => setMove(null)} className={BTN_G + BTN_MD}>انصراف</button></>}>
        {move && <div className="space-y-3">
          <Field label="عضو مقصد"><Select label="عضو" value={move.member} onChange={(m) => setMove({ ...move, member: m })} options={members.map((m) => ({ value: m.id, label: m.name }))} /></Field>
          <div className="space-y-1">{db.servers.filter((s) => s.status !== "suspended").map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={move.servers.includes(s.id)} onChange={(e) => setMove({ ...move, servers: e.target.checked ? [...move.servers, s.id] : move.servers.filter((y) => y !== s.id) })} /> <span className="ltr">{s.name}</span></label>
          ))}</div>
          <Field label={"برای تأیید، ایمیل عضو را بنویسید: " + (members.find((m) => m.id === move.member)?.email ?? "")}><input value={move.confirm} onChange={(e) => setMove({ ...move, confirm: e.target.value })} dir="ltr" className={INPUT + " text-left"} /></Field>
        </div>}
      </Modal>
    </div>
  );
}

/* ---------- staff ---------- */
export function AdminVpsBilling() {
  const x = useRemote("adminPrices", () => billingApi.adminPrices());
  const db = useDB();
  const { notify } = useApp();
  const [p, setP] = useState<Record<string, string> | null>(null);
  const [grace, setGrace] = useState<string | null>(null);
  const [lv, setLv] = useState({ user: "", level: "startup" });
  if (!x.data) return <Card><Loading /></Card>;
  const form = p ?? Object.fromEntries(Object.entries(x.data.prices).map(([k, v]) => [k, String(v)]));
  const LABELS: Record<string, string> = { ip: "IPv4 اضافه (تومان/ماه)", diskGb: "هر گیگ دیسک اضافه (تومان/ماه)", snapshotGb: "هر گیگ اسنپ‌شات (تومان/ماه)", packGb: "حجم بسته ترافیک (گیگ)", packPrice: "قیمت بسته ترافیک (تومان)", maxIps: "حداکثر IPv4 اضافه", maxDisks: "حداکثر دیسک اضافه", maxDiskGb: "حداکثر اندازه دیسک (گیگ)" };
  return (
    <div className="space-y-4">
      <Card title="قیمت افزونه‌های سرور ابری" icon="tag">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{Object.keys(LABELS).map((k) => <Field key={k} label={LABELS[k]}><input value={form[k] ?? ""} onChange={(e) => setP({ ...form, [k]: e.target.value })} inputMode="numeric" dir="ltr" className={INPUT + " text-left tabular"} /></Field>)}</div>
        <div className="mt-4 flex justify-end"><AsyncButton onClick={async () => { await billingApi.adminSavePrices(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, num(v)])) as never); setP(null); notify("قیمت‌ها ذخیره شد"); x.reload(); }}>ذخیره</AsyncButton></div>
      </Card>
      <Card title="سقف بدهی مجاز کیف پول" icon="wallet">
        <p className="text-sm text-white/55 leading-7 mb-3">سرویس‌های ساعتی تا این مبلغ منفی شدن کیف پول ادامه می‌دهند و بعد معلق می‌شوند. صفر یعنی تعلیق به محض اتمام موجودی.</p>
        <div className="flex gap-2"><input value={grace ?? String(x.data.policy.negativeGrace)} onChange={(e) => setGrace(e.target.value)} inputMode="numeric" dir="ltr" aria-label="سقف بدهی" className={INPUT + " text-left tabular"} />
          <AsyncButton onClick={async () => { await billingApi.adminSavePolicy({ negativeGrace: num(grace ?? "0") }); setGrace(null); notify("ذخیره شد"); x.reload(); }}>ذخیره</AsyncButton></div>
      </Card>
      <Card title="سطح حساب مشتری" icon="badge-check">
        <div className="grid sm:grid-cols-[1fr_200px_auto] gap-2 items-end">
          <Field label="مشتری"><Select label="مشتری" value={lv.user} onChange={(u) => setLv({ ...lv, user: u })} options={[{ value: "", label: "انتخاب کنید" }, ...db.users.filter((u) => u.role !== "admin").map((u) => ({ value: u.id, label: u.name + " — " + u.email }))]} /></Field>
          <Field label="سطح"><Select label="سطح" value={lv.level} onChange={(l) => setLv({ ...lv, level: l })} options={[{ value: "developer", label: "توسعه‌دهنده" }, { value: "startup", label: "استارتاپ" }, { value: "enterprise", label: "سازمانی" }]} /></Field>
          <AsyncButton disabled={!lv.user} onClick={async () => { await billingApi.adminSetLevel(lv.user, lv.level); notify("سطح حساب تغییر کرد"); }}>اعمال</AsyncButton>
        </div>
      </Card>
    </div>
  );
}
