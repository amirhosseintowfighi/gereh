"use client";
import { useState } from "react";
import { MCP_CLIENTS } from "@/content/mcp";
import { SITE_URL } from "@/lib/seo";
import { Icon } from "../icon";
import { Card } from "../ui";
import { CopyText } from "../ui-client";

/** "connect your coding agent" card: MCP setup for Claude Code, Cursor, VS Code and Codex */
export function AgentConnect() {
  const [id, setId] = useState(MCP_CLIENTS[0].id);
  const c = MCP_CLIENTS.find((x) => x.id === id)!;
  const code = c.code(SITE_URL, "grh_YOUR_TOKEN");
  return (
    <Card title="اتصال ایجنت‌های هوش مصنوعی (MCP)" icon="bot" className="mt-4" pad="p-3 sm:p-4"
      action={<a href="/docs/mcp" className="text-xs acc inline-flex items-center gap-1"><Icon name="book-open" size={13} />راهنما</a>}>
      <p className="text-sm text-white/65 leading-7 mb-3">Claude Code، Cursor، Codex یا Copilot را به حساب گره وصل کنید تا با زبان طبیعی دیپلوی کنند، لاگ و خطای بیلد را بخوانند، متغیرها را تنظیم و DNS را ویرایش کنند. برای ایجنت یک توکن جدا بسازید؛ توکن «فقط خواندن» برای شروع امن‌تر است.</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {MCP_CLIENTS.map((x) => <button key={x.id} type="button" aria-pressed={id === x.id} onClick={() => setId(x.id)} className={"h-8 px-3 rounded-lg text-xs transition " + (id === x.id ? "bg-white text-black font-bold" : "bg-white/[0.05] text-white/65 hover:text-white")}>{x.label}</button>)}
      </div>
      <p className="text-xs text-white/55 leading-6 mb-2">{c.note}{c.file !== "ترمینال" && <> فایل: <code dir="ltr">{c.file}</code></>}</p>
      <div className="relative">
        <pre dir="ltr" tabIndex={0} aria-label={"تنظیمات " + c.label} className="text-left text-[12px] leading-6 font-mono bg-black/40 rounded-xl p-4 overflow-x-auto">{code}</pre>
        <div className="absolute top-2 left-2"><CopyText text={code} className="text-[11px]" /></div>
      </div>
    </Card>
  );
}
