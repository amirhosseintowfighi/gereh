"use client";
/* «توضیح بده و درستش کن»: a button next to an error that asks the AI what happened, why, and how to fix it, with
   one-click fixes the server offered (src/server/ai/explain.ts). Also the «توضیح» link of the error toast. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { BTN_G, BTN_MD, BTN_P, BTN_SM } from "@/lib/cls";
import type { ExplainKind, Explanation, FixAction } from "@/lib/explain";
import { explainApi } from "@/lib/explain-api";
import { fa, toman } from "@/lib/format";
import { explainableError } from "@/lib/rpc-errors";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge } from "../ui";
import { AsyncButton, Modal } from "../ui-client";

type Target = { kind: ExplainKind; resourceId: string; errorRef: string };

export function ExplainButton({ kind, resourceId, errorRef, label = "توضیح بده و درستش کن", compact = false }: Target & { label?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        className={compact ? "inline-flex items-center gap-1.5 text-xs font-bold acc hover:underline underline-offset-4" : BTN_G + BTN_SM + " border-sky-300/25 bg-sky-400/[0.07] hover:bg-sky-400/[0.12]"}>
        <Icon name="sparkles" size={14} className="acc shrink-0" />{label}
      </button>
      {open && <ExplainModal target={{ kind, resourceId, errorRef }} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExplainModal({ target, onClose }: { target: Target; onClose: () => void }) {
  const [data, setData] = useState<Explanation | null>(null);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    explainApi.explain(target.kind, target.resourceId, target.errorRef)
      .then((d) => { if (live) setData(d); })
      .catch((e: Error) => { if (live) setError(e.message || "توضیح انجام نشد."); });
    return () => { live = false; };
  }, [target.kind, target.resourceId, target.errorRef, round]);
  const retry = () => { setError(""); setData(null); setRound((r) => r + 1); };
  return (
    <Modal open onClose={onClose} title="توضیح خطا با هوش مصنوعی" icon="sparkles" size="max-w-2xl"
      footer={<button type="button" onClick={onClose} className={BTN_G + BTN_MD}>بستن</button>}>
      {error ? (
        <div role="alert" className="rounded-xl border border-rose-300/30 bg-rose-400/[0.07] p-4 text-sm leading-7">
          <p className="text-rose-200">{error}</p>
          <button type="button" onClick={retry} className={BTN_G + BTN_SM + " mt-3"}><Icon name="refresh-cw" size={14} />تلاش دوباره</button>
        </div>
      ) : !data ? (
        <div role="status" aria-live="polite" className="py-10 grid place-items-center gap-3 text-sm text-white/70">
          <span className="w-12 h-12 rounded-2xl tile grid place-items-center"><Icon name="loader-circle" size={22} className="animate-spin acc" /></span>
          در حال بررسی خطا…
        </div>
      ) : <ExplainBody data={data} onChange={setData} />}
    </Modal>
  );
}

function ExplainBody({ data, onChange }: { data: Explanation; onChange: (d: Explanation) => void }) {
  const fixes = data.actions.filter((a) => a.id !== "ticket");
  const ticket = data.actions.find((a) => a.id === "ticket");
  return (
    <div className="space-y-5 text-sm leading-7">
      <section aria-label="چه اتفاقی افتاد">
        <p className="font-bold text-white/95 text-[15px] leading-8">{data.summary}</p>
      </section>
      {data.cause && (
        <section className="rounded-xl border border-amber-300/25 bg-amber-400/[0.06] p-4">
          <h3 className="flex items-center gap-2 font-bold text-amber-200 text-xs mb-1"><Icon name="lightbulb" size={15} />علت احتمالی</h3>
          <p className="text-white/75">{data.cause}</p>
        </section>
      )}
      {data.steps.length > 0 && (
        <section>
          <h3 className="font-bold text-xs text-white/60 mb-2">راه رفع</h3>
          <ol className="space-y-2.5">
            {data.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-6 h-6 shrink-0 rounded-lg acc-bg grid place-items-center text-[11px] font-black tabular mt-0.5" aria-hidden="true">{fa(i + 1)}</span>
                <span className="text-white/80 min-w-0 [overflow-wrap:anywhere]" dir="auto">{s}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {(fixes.length > 0 || ticket) && (
        <section className="rounded-xl border border-white/[0.1] bg-white/[0.03] p-4">
          <h3 className="flex items-center gap-2 font-bold text-xs mb-3"><Icon name="zap" size={15} className="acc" />{fixes.length ? "درستش کن" : "پیگیری"}</h3>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
            {fixes.map((a, i) => <FixButton key={a.id} data={data} a={a} primary={i === 0} onDone={onChange} />)}
            {ticket && <FixButton data={data} a={ticket} primary={false} onDone={onChange} />}
          </div>
        </section>
      )}
      <p className="flex flex-wrap items-center gap-2 text-[11px] text-white/50">
        <Icon name="wallet" size={13} />
        {data.cached ? "همین خطا در یک ساعت اخیر توضیح داده شده بود؛ هزینه دوباره‌ای کسر نشد." : data.charged > 0 ? "هزینه این توضیح: " + toman(data.charged) + " از کیف پول" : "برای این توضیح هزینه‌ای کسر نشد."}
        {data.simulated && <Badge tone="gray">تحلیل قاعده‌محور</Badge>}
      </p>
    </div>
  );
}

function FixButton({ data, a, primary, onDone }: { data: Explanation; a: FixAction; primary: boolean; onDone: (d: Explanation) => void }) {
  const { notify, confirm, prompt } = useApp();
  if (a.applied) return <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs text-emerald-200 bg-emerald-400/10 border border-emerald-300/20"><Icon name="circle-check" size={14} />{a.label} — انجام شد</span>;
  const run = async () => {
    let input: string | undefined;
    if (a.input) {
      const v = await prompt(a.input.label, { title: a.label, placeholder: a.input.placeholder, ltr: true, ok: "ذخیره و اعمال", hint: a.input.secret ? "به‌صورت متغیر مخفی ذخیره می‌شود و برای AI فرستاده نمی‌شود." : undefined });
      if (v === null) return;
      input = v;
    }
    if (a.costly && !(await confirm((a.priceNote ? "هزینه: " + a.priceNote + ". " : "") + "این تغییر روی صورتحساب ساعتی شما اثر دارد. ادامه می‌دهید؟", { title: a.label, ok: "تأیید و اجرا" }))) return;
    const r = await explainApi.applyFix(data.id, a.id, a.costly, input);
    notify(r.message, "circle-check");
    onDone({ ...data, actions: data.actions.map((x) => (x.id === a.id ? { ...x, applied: true } : x)) });
  };
  return (
    <AsyncButton onClick={run} className={(primary ? BTN_P : BTN_G) + BTN_SM + " max-sm:w-full"}>
      <Icon name={a.id === "ticket" ? "message-circle" : primary ? "sparkles" : "hammer"} size={14} />
      <span className="truncate">{a.label}</span>
      {a.costly && a.price ? <span className="text-[10px] font-normal opacity-80 tabular">(+{fa(a.price)} ت/ماه)</span> : null}
    </AsyncButton>
  );
}

/* ---------- the error toast's «توضیح» (explanation only, no fixes are offered for a bare RPC error) ---------- */
let pending: Target | null = null;
const subs = new Set<() => void>();
const setPending = (t: Target | null) => { pending = t; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** a «توضیح» link inside the toast when its message is a fresh RPC error */
export function ToastExplain({ msg }: { msg: string }) {
  const e = explainableError(msg);
  if (!e) return null;
  return <button type="button" onClick={() => setPending({ kind: "rpc", resourceId: e.method, errorRef: e.ref })} className="text-xs font-bold acc hover:underline underline-offset-4 shrink-0 ms-1">توضیح</button>;
}
export const toastExplainable = (msg: string) => !!explainableError(msg);

/** mounted once (AppProvider): the modal the toast link opens, kept after the toast is gone */
export function ExplainHost() {
  const t = useSyncExternalStore(subscribe, () => pending, () => null);
  return t ? <ExplainModal key={t.errorRef} target={t} onClose={() => setPending(null)} /> : null;
}
