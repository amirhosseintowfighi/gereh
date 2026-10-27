/* «پشتیبانی AI»: the AI first responder for tickets and live chat (src/server/support-ai/*). Shared by the server
   and the panel: modes, categories, the always-escalate list and the views the admin UI renders. */

export type SupportAiMode = "off" | "draft" | "auto";
export type SupportCategory =
  | "how-to" | "status" | "dns" | "known-error" | "billing" | "sales" | "other"
  | "refund" | "account-access" | "abuse" | "data-loss" | "complaint" | "money-or-deletion";

export const SUPPORT_CATEGORIES: Record<SupportCategory, string> = {
  "how-to": "راهنمای استفاده",
  status: "پرسش درباره وضعیت سرویس",
  dns: "DNS و راه‌اندازی",
  "known-error": "خطای شناخته‌شده",
  billing: "پرسش مالی",
  sales: "فروش و پلن‌ها",
  other: "سایر",
  refund: "بازگشت وجه یا اختلاف مالی",
  "account-access": "دسترسی یا مالکیت حساب",
  abuse: "سوءاستفاده، حقوقی یا امنیتی",
  "data-loss": "از دست رفتن داده",
  complaint: "شکایت یا نارضایتی",
  "money-or-deletion": "درخواست جابه‌جایی پول یا حذف",
};
export const isCategory = (c: unknown): c is SupportCategory => typeof c === "string" && Object.hasOwn(SUPPORT_CATEGORIES, c);

/** never answered automatically, whatever the confidence or the allowlist */
export const ALWAYS_ESCALATE: SupportCategory[] = ["refund", "account-access", "abuse", "data-loss", "complaint", "money-or-deletion"];
/** what auto mode may answer by default */
export const DEFAULT_AUTO_ALLOW: SupportCategory[] = ["how-to", "status", "dns", "known-error"];
/** auto replies the AI may post on one ticket (or chat) before only humans answer */
export const MAX_AI_REPLIES = 3;
/** the author name of AI replies the customer sees; SLA reports list it as its own (AI) row */
export const AI_AGENT_NAME = "پاسخ هوش مصنوعی";
export const AI_DISCLAIMER = "این پاسخ را هوش مصنوعی گره بر اساس اطلاعات حساب شما نوشته است و ممکن است کامل یا دقیق نباشد. هیچ اقدامی روی سرویس‌های شما انجام نشده است.";

export type SupportAiSettings = {
  mode: SupportAiMode;
  /** auto mode: the least confidence (0..1) that may be posted without a human */
  threshold: number;
  /** auto mode: categories that may be posted without a human (never one of ALWAYS_ESCALATE) */
  allow: SupportCategory[];
  /** departments and priorities the AI looks at; empty = all */
  depts: string[];
  priorities: string[];
  /** Toman per Tehran day of platform AI spend on support; 0 = no cap */
  dailyCap: number;
  /** above the cap: a free rule-based draft for staff, or nothing */
  overCap: "draft" | "skip";
  /** a catalog model id; empty = the assistant's models with fallback */
  model: string;
  /** live chat: answer chats no staff member has joined yet, with the same mode and rules */
  chat: boolean;
};
export const SUPPORT_AI_DEFAULTS: SupportAiSettings = { mode: "draft", threshold: 0.8, allow: DEFAULT_AUTO_ALLOW, depts: [], priorities: [], dailyCap: 300_000, overCap: "draft", model: "", chat: false };

export type SupportAiRunStatus = "draft" | "auto" | "sent" | "rejected" | "superseded" | "skipped" | "error";
/** one AI run as staff see it on the ticket (or chat) page */
export type SupportAiRunView = {
  id: string; status: SupportAiRunStatus; category: SupportCategory | ""; confidence: number; needsHuman: boolean;
  reason: string; escalation: string; reply: string; internalNote: string; suggestedActions: string[];
  simulated: boolean; cost: number; at: string; decidedBy: string; edited: boolean;
};
/** per-ticket AI state on the ticket (customer and staff views) */
export type TicketAiState = { escalated: boolean; resolved: boolean; turns: number; pendingDraft: boolean; handled: boolean };

export type SupportAiMetrics = {
  days: number; handled: number; tickets: number; autoSent: number; draftsSent: number; rejected: number; pending: number;
  escalated: number; escalationRate: number; resolved: number; resolvedRate: number;
  avgFirstMinAi: number | null; avgFirstMinHuman: number | null; spendToday: number; spendMonth: number; dailyCap: number;
};
