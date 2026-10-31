/* «دستیار گره» in Telegram and Bale: what the panel and the server share. */
export type BotKind = "telegram" | "bale";
export const BOT_LABEL: Record<BotKind, string> = { telegram: "تلگرام", bale: "بله" };
export type BotChatView = { id: string; kind: BotKind; label: string; created: string; last: string; staffMode: boolean; notify: boolean };
export type BotAdminView = {
  kind: BotKind; tokenSet: boolean; source: "admin" | "env" | ""; username: string; enabled: boolean;
  setMode: "auto" | "webhook" | "poll"; mode: "webhook" | "poll";
  proxySource: string; proxyHost: string; publicHttps: boolean; lastPoll: string; lastError: string;
};
export type BotLinkView = { url: string; expiresAt: number; username: string; ttlMs: number };
export type BotTestResult = { ok: boolean; detail: string; username: string; mode: "webhook" | "poll" };
