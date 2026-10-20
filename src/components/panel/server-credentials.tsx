"use client";
/* One-time password card: a root (or rescue) password the site just generated or set is shown here once, besides the
   email (src/server/credentials.ts). The list carries no password; «نمایش» and «کپی» fetch it on request, and
   «ذخیره کردم» deletes it on the server. */
import { useState } from "react";
import { BTN_G, BTN_P, BTN_SM } from "@/lib/cls";
import { fa } from "@/lib/format";
import { api, useDB, useMyId, type PendingCredential } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card } from "../ui";
import { AsyncButton, CopyText, useCopy } from "../ui-client";
import { useRemote } from "./vps-extras";

const daysLeft = (iso: string) => Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000));

/** every pending credential of the account, or of one server */
export function PendingCredentials({ serverId }: { serverId?: string }) {
  const db = useDB(); const myId = useMyId();
  // re-read when a server action may have produced a password (reinstall, reset, rescue, delivery, rebuild)
  const key = (serverId ?? "all") + "|" + db.servers.filter((s) => s.userId === myId && (!serverId || s.id === serverId)).map((s) => s.id + s.status + s.os + s.rescue + s.tasks.length).join(",");
  const x = useRemote(key, () => (myId ? api.servers.pendingCredentials(serverId) : Promise.resolve([])));
  const [done, setDone] = useState<string[]>([]);
  const rows = (x.data ?? []).filter((c) => !done.includes(c.serverId + c.kind));
  if (!rows.length) return null;
  return <div className="space-y-3 mb-4">{rows.map((c) => <CredentialCard key={c.serverId + c.kind + c.createdAt} c={c} onDone={() => setDone((d) => [...d, c.serverId + c.kind])} />)}</div>;
}

function CredentialCard({ c, onDone }: { c: PendingCredential; onDone: () => void }) {
  const { notify } = useApp();
  const copy = useCopy();
  const [pass, setPass] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const get = async (): Promise<string> => {
    if (pass !== null) return pass;
    const p = await api.servers.revealCredential(c.serverId, c.kind);
    setPass(p);
    return p;
  };
  const title = (c.kind === "root" ? "رمز root جدید سرور " : "رمز حالت ریسکیو سرور ") + c.name;
  return (
    <Card title={title} icon="key-round" action={<Badge tone="amber">فقط یک بار نمایش داده می‌شود</Badge>} className="border-amber-300/30 bg-amber-400/[0.05]">
      <dl className="grid sm:grid-cols-3 gap-3 text-sm">
        <div><dt className="text-xs text-white/55 mb-1">آدرس IP</dt><dd>{c.ip ? <CopyText text={c.ip} className="mono" label="آدرس IP" /> : "—"}</dd></div>
        <div><dt className="text-xs text-white/55 mb-1">نام کاربری</dt><dd><CopyText text={c.username} className="mono" label="نام کاربری" /></dd></div>
        <div className="min-w-0"><dt className="text-xs text-white/55 mb-1">رمز</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className="mono tabular min-w-0 [overflow-wrap:anywhere]" aria-live="polite">{shown && pass ? pass : "••••••••••••••••"}</span>
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { if (shown) { setShown(false); return; } await get(); setShown(true); }}><Icon name={shown ? "eye-off" : "eye"} size={14} />{shown ? "پنهان کردن" : "نمایش"}</AsyncButton>
        <AsyncButton className={BTN_G + BTN_SM} onClick={async () => copy(await get(), "رمز کپی شد")}><Icon name="copy" size={14} />کپی</AsyncButton>
        <AsyncButton className={BTN_P + BTN_SM} confirmText="رمز را جایی امن ذخیره کرده‌اید؟ پس از این، رمز دیگر در پنل نمایش داده نمی‌شود."
          onClick={async () => { await api.servers.ackCredential(c.serverId, c.kind); setPass(null); notify("رمز از پنل حذف شد", "check"); onDone(); }}><Icon name="check" size={14} />ذخیره کردم</AsyncButton>
      </div>
      <p className="text-xs text-white/60 leading-6 mt-4">این رمز به ایمیل شما هم ارسال شده است. پس از «ذخیره کردم»، یا پس از {fa(daysLeft(c.expiresAt))} روز دیگر، دیگر در پنل نمایش داده نمی‌شود. پس از ورود، رمز را تغییر دهید.</p>
    </Card>
  );
}
