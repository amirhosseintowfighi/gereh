"use client";
import { useState } from "react";
import { BTN_G, BTN_P, INPUT } from "@/lib/cls";
import { api, useDB } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Field } from "../ui";
import { AsyncButton, CopyText, Modal, Switch } from "../ui-client";

const KINDS: [string, string][] = [["billing", "صورتحساب"], ["service", "سرویس‌ها"], ["security", "امنیت"], ["news", "خبرنامه"]];
const NAME = { telegram: "تلگرام", bale: "بله", webhook: "وب‌هوک" } as const;

/** Telegram / Bale chats and signed webhooks that receive the account's notifications */
export function NotifyChannels() {
  const db = useDB(); const { notify, confirm } = useApp();
  const [hook, setHook] = useState(false);
  const [secret, setSecret] = useState("");
  const [w, setW] = useState({ url: "", label: "", events: ["billing", "service", "security"] });
  const link = async (kind: "telegram" | "bale") => { const url = await api.notify.botLink(kind); window.open(url, "_blank", "noopener"); notify("در " + NAME[kind] + " روی Start بزنید", "send"); };
  return (
    <Card title="تلگرام، بله و وب‌هوک" icon="send" pad="p-3 sm:p-4" className="mt-4">
      <p className="text-sm text-white/60 leading-7 px-1">اعلان‌های حساب (استقرار، قطعی، صورتحساب و…) را در پیام‌رسان یا سیستم خودتان بگیرید.</p>
      <div className="flex flex-wrap gap-2 mt-3 px-1">
        {db.bots.telegram && <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} onClick={() => link("telegram")}><Icon name="send" size={14} />اتصال تلگرام</AsyncButton>}
        {db.bots.bale && <AsyncButton className={BTN_G + " h-9 px-3 text-xs"} onClick={() => link("bale")}><Icon name="send" size={14} />اتصال بله</AsyncButton>}
        <button type="button" onClick={() => { setSecret(""); setHook(true); }} className={BTN_G + " h-9 px-3 text-xs"}><Icon name="plug" size={14} />افزودن وب‌هوک</button>
      </div>
      {db.channels.length > 0 && (
        <ul className="divide-y divide-white/[0.06] mt-3">
          {db.channels.map((c) => (
            <li key={c.id} className="p-3 grid sm:grid-cols-[1fr_auto] gap-3 items-center">
              <div className="min-w-0">
                <span className="flex flex-wrap items-center gap-2"><Badge tone={c.kind === "webhook" ? "gray" : "blue"}>{NAME[c.kind]}</Badge><b className="text-sm truncate">{c.label}</b>{c.lastStatus && c.lastStatus !== "ok" && <Badge tone="red">خطا</Badge>}</span>
                {c.target && <span className="block text-[11px] text-white/45 mt-1 truncate" dir="ltr" style={{ textAlign: "right" }}>{c.target}</span>}
                <span className="flex flex-wrap gap-1.5 mt-2">
                  {KINDS.map(([k, l]) => <button key={k} type="button" aria-pressed={c.events.includes(k)} onClick={async () => { const ev = c.events.includes(k) ? c.events.filter((x) => x !== k) : [...c.events, k]; if (ev.length) await api.notify.updateChannel(c.id, { events: ev }); }} className={"h-7 px-2.5 rounded-lg text-[11px] transition " + (c.events.includes(k) ? "bg-white/15 text-white" : "bg-white/[0.04] text-white/45")}>{l}</button>)}
                </span>
                {c.lastStatus && c.lastStatus !== "ok" && <span className="block text-[11px] text-rose-300/80 mt-1">{c.lastStatus}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Switch on={c.active} onChange={(v) => api.notify.updateChannel(c.id, { active: v })} label={"فعال بودن " + c.label} />
                <AsyncButton className={BTN_G + " h-8 px-3 text-xs"} onClick={async () => { await api.notify.testChannel(c.id); notify("پیام آزمایشی ارسال شد", "send"); }}>آزمایش</AsyncButton>
                <button type="button" aria-label={"حذف " + c.label} onClick={async () => { if (await confirm("کانال «" + c.label + "» حذف شود؟", { danger: true, ok: "حذف" })) await api.notify.removeChannel(c.id); }} className="h-8 w-8 grid place-items-center rounded-lg text-white/50 hover:text-rose-300"><Icon name="trash-2" size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal open={hook} onClose={() => setHook(false)} title="وب‌هوک اعلان" icon="plug">
        {secret ? <>
          <p className="text-sm text-white/70 leading-7">کلید امضا فقط همین یک بار نمایش داده می‌شود. هر درخواست هدر <code dir="ltr">X-Gereh-Signature: sha256=HMAC(body)</code> دارد؛ آن را با این کلید بررسی کنید.</p>
          <div className="rounded-xl bg-black/40 p-4 mt-3"><CopyText text={secret} className="font-mono text-sm break-all" /></div>
          <button type="button" onClick={() => setHook(false)} className={BTN_P + " w-full h-11 mt-4"}>ذخیره کردم</button>
        </> : <div className="space-y-4">
          <Field label="نشانی (https)"><input dir="ltr" value={w.url} onChange={(e) => setW({ ...w, url: e.target.value.trim() })} placeholder="https://example.com/hooks/gereh" className={INPUT + " text-left font-mono"} /></Field>
          <Field label="نام (اختیاری)"><input value={w.label} onChange={(e) => setW({ ...w, label: e.target.value })} className={INPUT} /></Field>
          <div className="flex flex-wrap gap-1.5">{KINDS.map(([k, l]) => <button key={k} type="button" aria-pressed={w.events.includes(k)} onClick={() => setW({ ...w, events: w.events.includes(k) ? w.events.filter((x) => x !== k) : [...w.events, k] })} className={"h-8 px-3 rounded-lg text-xs " + (w.events.includes(k) ? "bg-white text-black font-bold" : "bg-white/[0.05] text-white/65")}>{l}</button>)}</div>
          <AsyncButton disabled={!w.url.startsWith("https://") || !w.events.length} className={BTN_P + " w-full h-11"} onClick={async () => { setSecret(await api.notify.addWebhook(w)); }}>افزودن</AsyncButton>
        </div>}
      </Modal>
    </Card>
  );
}
