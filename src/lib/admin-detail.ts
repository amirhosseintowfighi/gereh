/* Staff views of one order and one customer (Admin › سفارش‌ها and /admin/users/[id]).
   The server decodes everything into Persian label/value pairs, so the UI only lays them out. */

export type Pair = [label: string, value: string];
export type Check = { key: "conn" | "plan" | "loc" | "os" | "virtuser" | "account" | "hosting" | "tld" | "domain" | "irnic"; label: string; ok: boolean; warn?: boolean; detail: string; hint: string; href: string };
export type LineState = { state: "delivered" | "pending" | "failed" | "refunded" | "closed" | "renewal" | "none"; label: string; href: string; key: string };

export type OrderDetail = {
  key: string; invoiceId: string; index: number;
  customer: { id: string; name: string; email: string; phone: string; level: string; balance: number; kyc: string; status: string };
  invoice: {
    id: string; status: string; created: string; paid: string; coupon: string; taxRate: number; method: string; gateway: string; refId: string;
    lines: { desc: string; amount: number; mine: boolean }[]; subtotal: number; discount: number; tax: number; total: number; lineAmount: number;
  };
  item: { type: "server" | "hosting" | "domain" | "ip" | "renew" | "other"; title: string; spec: Pair[]; raw: unknown; editable: boolean; os: string; osid: number; loc: string; plid: number };
  job: { id: number; type: string; status: string; attempts: number; runAt: string; created: string; error: string; resolved: string } | null;
  server: { id: string; name: string; hostname: string; status: string; vpsid: number | null; error: string; ticket: string | null } | null;
  tasks: { action: string; status: string; progress: number; at: string }[];
  ticket: { id: string; subject: string; status: string; updated: string } | null;
  state: LineState;
  options: { oses: { id: string; label: string }[]; templates: { osid: number; name: string; on: boolean }[]; locs: { id: string; label: string; group: string }[] };
};

export type UserTab = "summary" | "orders" | "services" | "usage" | "activity";
export type ServiceRow = { kind: string; id: string; name: string; status: string; info: string; href: string; actions: ("suspend" | "unsuspend" | "delete" | "extend")[] };
export type Series = { labels: string[]; data: number[] };

export type UserSummary = {
  tab: "summary";
  user: { id: string; name: string; email: string; phone: string; company: string; role: string; status: string; kyc: string; balance: number; joined: string; twofa: boolean; autoPay: boolean; referralCode: string; virtUid: number | null };
  level: string; levelId: string; wallets: { id: string; name: string; balance: number }[];
  forecast: { burn: number; days: number | null; until: string; threshold: number };
  team: { members: { id: string; name: string; email: string; role: string }[]; memberOf: { id: string; name: string; role: string }[] };
  lastLogin: { at: string; ip: string; device: string } | null;
  counts: Record<string, number>; flags: string[];
};
export type UserOrders = {
  tab: "orders"; total: number;
  invoices: { id: string; status: string; created: string; paid: string; total: number; coupon: string; lines: { index: number; desc: string; amount: number; decoded: string; state: LineState }[] }[];
};
export type UserServices = { tab: "services"; rows: ServiceRow[] };
export type UserUsage = {
  tab: "usage"; total: number;
  tx: { id: string; type: string; amount: number; method: string; desc: string; at: string; product: string }[];
  monthly: { product: string; label: string; months: { month: string; amount: number }[] }[];
  months: string[];
  hourly: Series; ai: { byModel: { model: string; calls: number; charged: number; tokens: number }[]; daily: Series };
  paas: { spend: { month: string; amount: number }[]; traffic: Series }; storage: Series; mail: Series; inquiry: Series;
};
export type UserActivity = {
  tab: "activity";
  tickets: { id: string; subject: string; status: string; priority: string; updated: string }[];
  activity: { text: string; icon: string; ip: string; at: string }[];
  audit: { actor: string; action: string; target: string; at: string }[];
  notifications: { text: string; icon: string; read: boolean; at: string }[];
};
export type UserDetail = UserSummary | UserOrders | UserServices | UserUsage | UserActivity;
export type TxFilter = { type?: "topup" | "payment" | "refund" | "commission" | "usage"; product?: string; q?: string; days?: number; offset?: number; limit?: number };
export type SearchHit = { kind: "user" | "invoice" | "server" | "domain" | "hosting" | "mail" | "geo"; label: string; sub: string; userId: string };
