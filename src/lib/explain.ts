/* «توضیح بده و درستش کن»: what the error explainer returns and the client shows (src/server/ai/explain.ts). */

/** paas: a Gereh App; vps: a cloud server; dbaas: a managed database; rpc: an error toast of any panel call */
export type ExplainKind = "paas" | "vps" | "dbaas" | "rpc";
export const EXPLAIN_KINDS: ExplainKind[] = ["paas", "vps", "dbaas", "rpc"];

/** the one-click fixes the server may offer, per kind; the model can only pick from what the server offered */
export type FixId =
  | "set_port" | "set_health_path" | "raise_plan" | "set_env" | "redeploy" | "rollback" | "enable_proxy" | "builder_fix"
  | "retry_power" | "start_server" | "sync_server"
  | "db_restart"
  | "ticket";

export type FixAction = {
  id: FixId; label: string;
  /** the RPC (group.name) that runs it, for transparency */
  rpc: string;
  /** costly: changes what the customer pays; needs confirm=true and shows `price` first */
  costly: boolean;
  /** Toman per month the change adds (costly actions) */
  price?: number;
  priceNote?: string;
  /** the customer types a value (e.g. a missing environment variable) */
  input?: { label: string; placeholder?: string; secret?: boolean };
  applied?: boolean;
};

export type Explanation = {
  id: string; kind: ExplainKind; resourceId: string;
  summary: string; cause: string; steps: string[]; actions: FixAction[];
  /** Toman charged for this explanation (0 when it came from the cache or a fallback) */
  charged: number;
  /** answered from the last hour's explanation of the same error: nothing charged again */
  cached: boolean;
  /** the offline rule-based explainer answered (no model service configured) */
  simulated: boolean;
  at: string;
};

export type FixResult = { ok: true; message: string; actionId: FixId };

/** the smallest charge for one explanation (Toman); the model's token cost when that is higher */
export const EXPLAIN_MIN_FEE = 500;
/** a repeat of the same error within this window is answered from the cache, free */
export const EXPLAIN_CACHE_MS = 60 * 60_000;
