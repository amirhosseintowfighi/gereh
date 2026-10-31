"use client";
import { useCallback, useEffect, useState } from "react";
import { BOT_LABEL, type BotAdminView, type BotChatView, type BotKind, type BotLinkView } from "@/lib/assistant-bots";
import { BTN_G, BTN_MD, BTN_P, BTN_SM, INPUT } from "@/lib/cls";
import { fa } from "@/lib/format";
import { api, useDB, useSession } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Field } from "../ui";
import { AsyncButton, CopyText, Modal, Select, Switch } from "../ui-client";

const KINDS: BotKind[] = ["telegram", "bale"];

/** the deep link and its QR; the code inside is single use and expires in 10 minutes */
function LinkModal({ link, onClose }: { link: { kind: BotKind; v: BotLinkView }; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const [left, setLeft] = useState(() => Math.max(0, link.v.expiresAt - Date.now()));
  useEffect(() => {
    let alive = true;
    import("qrcode").then((m) => m.toString(link.v.url, { type: "svg", margin: 1, color: { dark: "#05070d", light: "#ffffff" } })).then((svg) => { if (alive) setQr(svg); });
    const t = setInterval(() => setLeft(Math.max(0, link.v.expiresAt - Date.now())), 1000);
    return () => { alive = false; clearInterval(t); };
  }, [link]);
  const mins = Math.floor(left / 60_000), secs = Math.floor((left % 60_000) / 1000);
  return (
    <Modal open onClose={onClose} title={"اتصال به " + BOT_LABEL[link.kind]} icon="send">
      {left > 0 ? <div className="space-y-4 text-sm leading-7">
        <p className="text-white/70">این لینک را در {BOT_LABEL[link.kind]} باز کنید (یا QR را با گوشی بخوانید) و Start را بزنید. لینک یک‌بارمصرف است و {fa(mins)}:{fa(secs).padStart(2, "۰")} دیگر منقضی می‌شود.</p>
        <div className="mx-auto w-48 h-48 rounded-xl bg-white p-2 grid place-items-center">
          {qr ? <div className="w-full h-full [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: qr }} /> : <Icon name="loader-circle" size={24} className="animate-spin text-slate-500" />}
        </div>
        <div className="rounded-xl bg-black/30 p-3"><CopyText text={link.v.url} className="font-mono text-xs break-all" label="لینک اتصال" /></div>
        <a href={link.v.url} target="_blank" rel="noopener noreferrer" className={BTN_P + BTN_MD + " w-full justify-center"}><Icon name="send" size={15} />باز کردن {BOT_LABEL[link.kind]}</a>
        <p className="text-[11px] text-white/45">پس از اتصال، دستیار گره در این گفتگو با دسترسی‌های شما پاسخ می‌دهد و هزینه آن مثل پنل از کیف پول کم می‌شود. رمزها و کلیدها هرگز در پیام‌رسان فرستاده نمی‌شوند.</p>
      </div> : <p className="text-sm text-white/70">این لینک منقضی شد؛ دوباره روی «اتصال» بزنید.</p>}
    </Modal>
  );
}

/** «اتصال به تلگرام / بله» and the person's linked chats (unlink; staff: the operator console in the chat) */
export function BotLinks({ compact = false }: { compact?: boolean }) {
  const db = useDB(); const s = useSession(); const { notify, confirm } = useApp();
  const [chats, setChats] = useState<BotChatView[] | null>(null);
  const [link, setLink] = useState<{ kind: BotKind; v: BotLinkView } | null>(null);
  const load = useCallback(() => { api.assistantBots.chats().then(setChats).catch(() => setChats([])); }, []);
  useEffect(load, [load]);
  const staff = !!s && s.role === "admin" && s.userId === s.actorId;
  const kinds = KINDS.filter((k) => db.bots[k]);
  return (
    <div className="space-y-3">
      {!compact && <p className="text-sm text-white/60 leading-7">با «دستیار گره» در پیام‌رسان گفتگو کنید: وضعیت سرویس‌ها، موجودی، عیب‌یابی و کارهای روزمره. کارهای حساس با دکمه تأیید انجام می‌شوند و حذف، نصب مجدد و انتقال وجه فقط در پنل.</p>}
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => <AsyncButton key={k} className={BTN_G + BTN_SM} onClick={async () => { setLink({ kind: k, v: await api.assistantBots.link(k) }); }}><Icon name="send" size={14} />اتصال به {BOT_LABEL[k]}</AsyncButton>)}
        {!kinds.length && <span className="text-xs text-white/45">ربات تلگرام یا بله هنوز توسط مدیر سایت راه‌اندازی نشده است.</span>}
        {kinds.length > 0 && <button type="button" onClick={load} className={BTN_G + BTN_SM}><Icon name="refresh-cw" size={14} />به‌روزرسانی</button>}
      </div>
      {chats && chats.length > 0 && (
        <ul className="divide-y divide-white/[0.06] rounded-xl bg-white/[0.02] border border-white/[0.06]">
          {chats.map((c) => (
            <li key={c.id} className="p-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2"><Badge tone="blue">{BOT_LABEL[c.kind]}</Badge><b className="text-sm truncate">{c.label || "گفتگو"}</b>{c.notify && <Badge tone="gray">اعلان‌ها</Badge>}{c.staffMode && <Badge tone="violet">کارمندی</Badge>}</span>
                <span className="block text-[11px] text-white/45 mt-1">اتصال: {c.created}{c.last ? " — آخرین پیام: " + c.last : ""}</span>
              </div>
              {staff && <label className="flex items-center gap-2 text-[11px] text-white/60">حالت کارمندی<Switch on={c.staffMode} label={"حالت کارمندی " + c.label} onChange={async (v) => { await api.assistantBots.staffMode(c.id, v); load(); }} /></label>}
              <button type="button" className={BTN_G + BTN_SM} onClick={async () => { if (await confirm("اتصال این گفتگوی " + BOT_LABEL[c.kind] + " قطع شود؟", { danger: true, ok: "قطع اتصال" })) { await api.assistantBots.unlink(c.id); notify("اتصال قطع شد", "send"); load(); } }}><Icon name="x" size={14} />قطع اتصال</button>
            </li>
          ))}
        </ul>
      )}
      {link && <LinkModal link={link} onClose={() => { setLink(null); load(); }} />}
    </div>
  );
}

/** the assistant page's header button */
export function MessengerButton() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={BTN_G + BTN_SM} onClick={() => setOpen(true)}><Icon name="send" size={14} /><span className="max-sm:hidden">تلگرام و بله</span></button>
    <Modal open={open} onClose={() => setOpen(false)} title="دستیار گره در تلگرام و بله" icon="send" size="max-w-xl"><BotLinks /></Modal>
  </>;
}

const MODE_OPTS = [{ value: "auto", label: "خودکار" }, { value: "poll", label: "دریافت دوره‌ای (long polling)" }, { value: "webhook", label: "وب‌هوک" }];

function BotAdminRow({ b, reload }: { b: BotAdminView; reload: () => void }) {
  const { notify } = useApp();
  const [token, setToken] = useState("");
  const [proxy, setProxy] = useState("");
  const [mode, setMode] = useState(b.setMode);
  const [enabled, setEnabled] = useState(b.enabled);
  const tg = b.kind === "telegram";
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">ربات {BOT_LABEL[b.kind]}</b>
        {b.username ? <Badge tone="blue">@{b.username}</Badge> : <Badge tone="gray">بدون نام کاربری</Badge>}
        <Badge tone={b.tokenSet ? "green" : "gray"}>{b.tokenSet ? (b.source === "env" ? "توکن از متغیر محیطی" : "توکن ذخیره شده") : "بدون توکن"}</Badge>
        <Badge tone="gray">{b.mode === "webhook" ? "وب‌هوک" : "دریافت دوره‌ای"}</Badge>
        {b.lastError && <Badge tone="red">خطا</Badge>}
        <span className="flex-1" />
        <Switch on={enabled} onChange={setEnabled} label={"فعال بودن ربات " + BOT_LABEL[b.kind]} />
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Field label="توکن ربات" hint="رمزنگاری‌شده ذخیره می‌شود و دوباره نمایش داده نمی‌شود."><input type="password" autoComplete="new-password" value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder={b.tokenSet ? "ذخیره شده؛ برای تغییر وارد کنید" : "123456789:AA…"} dir="ltr" className={INPUT + " text-left font-mono"} /></Field>
        <Field label="نحوه دریافت پیام‌ها" hint={tg ? "پیش‌فرض: دریافت دوره‌ای از طریق پروکسی (تلگرام به سرور ایران به‌خوبی نمی‌رسد)." : b.publicHttps ? "خودکار: وب‌هوک (سایت با https در دسترس است)." : "خودکار: دریافت دوره‌ای (سایت https عمومی ندارد)."} as="div">
          <Select value={mode} onChange={(v) => setMode(v as typeof mode)} options={MODE_OPTS} label="نحوه دریافت" />
        </Field>
        {tg && <Field label="پروکسی خروجی تلگرام" hint={b.proxyHost ? "فعلی: " + b.proxyHost + (b.proxySource === "admin" ? "" : b.proxySource === "env" ? " (BOT_PROXY)" : " (پروکسی خروجی پلتفرم)") : "تنظیم نشده؛ BOT_PROXY یا پروکسی خروجی پلتفرم (PAAS_EGRESS_PROXY) به کار می‌رود."}>
          <input value={proxy} onChange={(e) => setProxy(e.target.value.trim())} placeholder="http://user:pass@1.2.3.4:3128 یا socks5://…" dir="ltr" className={INPUT + " text-left font-mono"} />
        </Field>}
      </div>
      {(b.lastPoll || b.lastError) && <p className="text-[11px] text-white/45 mt-2">{b.lastPoll && "آخرین دریافت: " + b.lastPoll}{b.lastError && <span className="block text-rose-300/80 ltr text-right">{b.lastError}</span>}</p>}
      <div className="flex flex-wrap justify-end gap-2 mt-3">
        {tg && b.proxySource === "admin" && <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { await api.assistantBots.save(b.kind, { proxy: "" }); notify("پروکسی حذف شد"); reload(); }}>حذف پروکسی</AsyncButton>}
        <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { const r = await api.assistantBots.test(b.kind); notify((r.ok ? "اتصال برقرار است: " : "ناموفق: ") + r.detail, r.ok ? "check" : "x"); reload(); }}><Icon name="activity" size={14} />تست اتصال</AsyncButton>
        <AsyncButton className={BTN_P + BTN_SM} onClick={async () => {
          await api.assistantBots.save(b.kind, { ...(token ? { token } : {}), ...(proxy ? { proxy } : {}), mode, enabled });
          setToken(""); setProxy(""); notify("تنظیمات ربات ذخیره شد؛ «تست اتصال» را بزنید", "check"); reload();
        }}>ذخیره</AsyncButton>
      </div>
    </div>
  );
}

/** staff settings: the Telegram and Bale bots of «دستیار گره» and the notifications */
export function BotAdminCard() {
  const [bots, setBots] = useState<BotAdminView[] | null>(null);
  const load = useCallback(() => { api.assistantBots.admin().then(setBots).catch(() => setBots(null)); }, []);
  useEffect(load, [load]);
  return (
    <Card title="ربات‌های تلگرام و بله" icon="send" className="mt-4">
      <p className="text-sm text-white/60 leading-7 max-w-3xl">مشتریان با این ربات‌ها اعلان‌های حساب را می‌گیرند و با «دستیار گره» گفتگو می‌کنند. ربات تلگرام را با ‎@BotFather در تلگرام و ربات بله را با ‎@botfather در بله بسازید، توکن را اینجا وارد و «تست اتصال» را بزنید. تلگرام از ایران فقط از طریق پروکسی خروجی در دسترس است؛ بله مستقیم وصل می‌شود.</p>
      <div className="space-y-3 mt-4 max-w-3xl">{bots ? bots.map((b) => <BotAdminRow key={b.kind + b.tokenSet + b.setMode + b.proxyHost + b.enabled} b={b} reload={load} />) : <p className="text-sm text-white/45">در حال بارگذاری…</p>}</div>
    </Card>
  );
}
