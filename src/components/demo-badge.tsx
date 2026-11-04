"use client";
import { useDB } from "@/lib/store";
import { Icon } from "./icon";

/** shown in the panel and site headers whenever the install runs in demo mode (src/server/demo.ts),
    so a demo is never taken for production */
export function DemoBadge({ className = "" }: { className?: string }) {
  const db = useDB();
  if (!db.settings.demo) return null;
  return <span role="status" title="داده‌ها و سرویس‌ها نمایشی‌اند، نه واقعی" className={"inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-bold whitespace-nowrap bg-amber-400/15 text-amber-200 border border-amber-300/30 " + className}><Icon name="flask-conical" size={14} />حالت نمایشی</span>;
}
