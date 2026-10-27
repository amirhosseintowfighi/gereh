"use client";
import { BTN_G, BTN_P, BTN_SM } from "@/lib/cls";
import { api, type Ticket } from "@/lib/store";
import { AI_DISCLAIMER } from "@/lib/support-ai";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { AsyncButton } from "../ui-client";

/** under an automatic «پشتیبانی AI» reply: the disclaimer and, for the customer on the latest one, «مشکلم حل شد» /
    «با پشتیبان انسانی صحبت کنم» */
export function AiReplyNote({ t, latest, as }: { t: Ticket; latest: boolean; as: "user" | "staff" }) {
  const { notify } = useApp();
  const open = t.status !== "closed";
  return (
    <div className="mt-3 pt-3 border-t border-white/[0.08]">
      <p className="text-[11px] text-white/55 leading-6 flex gap-1.5"><Icon name="info" size={13} className="shrink-0 mt-1" />{AI_DISCLAIMER}</p>
      {as === "user" && latest && open && !t.ai?.escalated && (
        <div className="mt-3 flex flex-wrap gap-2">
          <AsyncButton className={BTN_P + BTN_SM} confirmText="تیکت بسته شود؟" onClick={async () => { await api.tickets.aiResolved(t.id); notify("خوشحالیم که مشکل حل شد؛ تیکت بسته شد", "circle-check"); }}><Icon name="circle-check" size={14} />مشکلم حل شد</AsyncButton>
          <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { await api.tickets.aiHuman(t.id); notify("درخواست شما به پشتیبان انسانی ارجاع شد", "headset"); }}><Icon name="headset" size={14} />با پشتیبان انسانی صحبت کنم</AsyncButton>
        </div>
      )}
      {latest && t.ai?.escalated && <p className="mt-2 text-xs text-amber-200/90 flex items-center gap-1.5"><Icon name="headset" size={13} />به پشتیبان انسانی ارجاع شد؛ پاسخ بعدی را همکاران ما می‌نویسند.</p>}
    </div>
  );
}
