/* «دستیار گره»: what the panel and the server share (events of the chat stream, views, starter prompts). */

export const ASSISTANT = { name: "دستیار گره", newTitle: "گفتگوی جدید" };

/** read: only looks; safe: a reversible change, runs right away; danger: costs money, deletes or replaces
    something, or deploys: proposed first and runs only after the person confirms it */
export type ToolRisk = "read" | "safe" | "danger";

/** the page the assistant was opened from, so «این سرور» means that server */
export type AssistantContext = { kind: "server" | "app" | "db"; id: string };

export type ConfirmCard = {
  /** action id; the token travels only in the stream event and is never stored in clear */
  id: string; token: string; tool: string; args: Record<string, unknown>;
  title: string; summary: string; resource: string;
  /** Toman, from the real pricing functions; null when the action itself costs nothing */
  cost: number | null; costNote: string; expiresAt: number;
};

export type AssistantEvent =
  | { type: "thread"; id: string; title: string }
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; name: string; label: string; risk: ToolRisk }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string }
  | { type: "confirm"; card: ConfirmCard }
  | { type: "decided"; id: string; status: "done" | "failed" | "cancelled"; summary: string }
  | { type: "done"; charged: number; messageId: number | null; pending: boolean }
  | { type: "error"; message: string; code?: string };

export type AssistantThreadView = { id: string; title: string; spent: number; updated: string; updatedTs: number };
export type AssistantToolActivity = { id: string; name: string; label: string; risk: ToolRisk; status: "running" | "ok" | "error" | "pending" | "cancelled"; summary: string };
export type AssistantMessageView = {
  id: number; role: "user" | "assistant"; content: string; cost: number; at: string;
  tools: AssistantToolActivity[];
  /** a proposal still waiting for the person (its token is not kept, so it is shown as expired after a reload) */
  confirm: (Omit<ConfirmCard, "token"> & { status: "pending" | "done" | "failed" | "cancelled" }) | null;
};

export const STARTERS = [
  "وضعیت همه سرویس‌هایم چطور است؟",
  "یک سرور ابری ۴ گیگ در تهران پیشنهاد بده",
  "چرا اپ n8n من خطا می‌دهد؟",
  "این ماه چقدر هزینه کردم؟",
  "یک سایت با بافت برایم بساز",
];

export const RISK_LABEL: Record<ToolRisk, string> = { read: "خواندن", safe: "تغییر", danger: "نیازمند تأیید" };

/** the resource of a panel path: /panel/servers/<id>, /panel/apps/<id>, /panel/databases/<id> */
export function contextOf(path: string): AssistantContext | null {
  const m = /^\/panel\/(servers|apps|databases)\/([\w.-]{1,40})(?:\/|$)/.exec(path);
  if (!m || m[2] === "new" || m[2] === "templates" || m[2] === "stack") return null;
  return { kind: m[1] === "servers" ? "server" : m[1] === "apps" ? "app" : "db", id: m[2] };
}
