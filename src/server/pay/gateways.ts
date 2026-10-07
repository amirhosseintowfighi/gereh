/* Iranian payment gateways: request → redirect → callback → verify.
   Amounts are stored in Toman and sent to gateways in Rial (×10).
   - Zarinpal v4: ZARINPAL_MERCHANT (ZARINPAL_SANDBOX=1 for sandbox.zarinpal.com)
   - IDPay v1.1:  IDPAY_API_KEY      (IDPAY_SANDBOX=1 adds X-SANDBOX)
   - Simulator:   used when neither is configured; /pay/sim plays the gateway's part. */
import "server-only";

export type GatewayId = "zarinpal" | "idpay" | "sim";
export type StartReq = { paymentId: string; amount: number; callback: string; description: string; mobile?: string; email?: string };
export type Started = { authority: string; redirect: string };
export type Verified = { ok: true; refId: string } | { ok: false; reason: string };

export interface Gateway {
  id: GatewayId;
  label: string;
  start(r: StartReq): Promise<Started>;
  /** amount is what we expect (Toman); must be compared by the gateway, never trusted from the callback */
  verify(authority: string, amount: number, callback: URLSearchParams): Promise<Verified>;
}

async function post<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
}

export class Zarinpal implements Gateway {
  id = "zarinpal" as const;
  label = "درگاه زرین‌پال";
  private base = process.env.ZARINPAL_SANDBOX === "1" ? "https://sandbox.zarinpal.com" : "https://payment.zarinpal.com";
  constructor(private merchant = process.env.ZARINPAL_MERCHANT!) {}
  async start(r: StartReq) {
    const { json } = await post<{ data?: { code?: number; authority?: string }; errors?: { message?: string } | unknown[] }>(this.base + "/pg/v4/payment/request.json", {
      merchant_id: this.merchant, amount: r.amount * 10, currency: "IRR", callback_url: r.callback, description: r.description,
      metadata: { mobile: r.mobile, email: r.email, order_id: r.paymentId },
    });
    if (json.data?.code !== 100 || !json.data.authority) throw new Error("Zarinpal request failed: " + JSON.stringify(json.errors ?? json).slice(0, 300));
    return { authority: json.data.authority, redirect: this.base + "/pg/StartPay/" + json.data.authority };
  }
  async verify(authority: string, amount: number, cb: URLSearchParams): Promise<Verified> {
    if (cb.get("Status") !== "OK") return { ok: false, reason: "پرداخت لغو شد." };
    const { json } = await post<{ data?: { code?: number; ref_id?: number } }>(this.base + "/pg/v4/payment/verify.json", { merchant_id: this.merchant, amount: amount * 10, authority });
    const code = json.data?.code;
    if ((code === 100 || code === 101) && json.data?.ref_id) return { ok: true, refId: String(json.data.ref_id) };
    return { ok: false, reason: "تأیید پرداخت ناموفق بود (کد " + (code ?? "?") + ")." };
  }
}

export class IdPay implements Gateway {
  id = "idpay" as const;
  label = "درگاه آیدی‌پی";
  private headers = { "X-API-KEY": process.env.IDPAY_API_KEY!, ...(process.env.IDPAY_SANDBOX === "1" ? { "X-SANDBOX": "1" } : {}) };
  async start(r: StartReq) {
    const { status, json } = await post<{ id?: string; link?: string; error_message?: string }>("https://api.idpay.ir/v1.1/payment", {
      order_id: r.paymentId, amount: r.amount * 10, callback: r.callback, desc: r.description, phone: r.mobile, mail: r.email,
    }, this.headers);
    if (status !== 201 || !json.id || !json.link) throw new Error("IDPay request failed: " + (json.error_message || status));
    return { authority: json.id, redirect: json.link };
  }
  async verify(authority: string, amount: number, cb: URLSearchParams): Promise<Verified> {
    // IDPay status 10 = awaiting verification; anything else means the customer did not pay
    if (cb.get("status") !== "10" && cb.get("status") !== "100" && cb.get("status") !== "101") return { ok: false, reason: "پرداخت لغو شد." };
    const { json } = await post<{ status?: number; track_id?: string; amount?: string | number; payment?: { track_id?: string } }>("https://api.idpay.ir/v1.1/payment/verify", { id: authority, order_id: cb.get("order_id") }, this.headers);
    if ((json.status === 100 || json.status === 101) && Number(json.amount) === amount * 10) return { ok: true, refId: String(json.payment?.track_id ?? json.track_id ?? authority) };
    return { ok: false, reason: "تأیید پرداخت ناموفق بود." };
  }
}

/** dev/CI stand-in: /pay/sim shows a fake bank page that calls back with ok=1|0 */
export class SimGateway implements Gateway {
  id = "sim" as const;
  label = "درگاه آزمایشی";
  async start(r: StartReq) {
    const authority = "SIM" + r.paymentId;
    return { authority, redirect: "/pay/sim?" + new URLSearchParams({ authority, amount: String(r.amount), cb: r.callback }) };
  }
  async verify(_authority: string, _amount: number, cb: URLSearchParams): Promise<Verified> {
    return cb.get("ok") === "1" ? { ok: true, refId: "SIM-" + Date.now().toString(36).toUpperCase() } : { ok: false, reason: "پرداخت لغو شد." };
  }
}

/** enabled gateways in priority order, filtered by admin settings */
export function gatewaysFor(settings: { gateways: Record<string, boolean> }): Gateway[] {
  const out: Gateway[] = [];
  if (settings.gateways.zarinpal && process.env.ZARINPAL_MERCHANT) out.push(new Zarinpal());
  if (settings.gateways.idpay && process.env.IDPAY_API_KEY) out.push(new IdPay());
  const anyReal = !!(process.env.ZARINPAL_MERCHANT || process.env.IDPAY_API_KEY);
  const simAllowed = process.env.NODE_ENV !== "production" || process.env.PAY_SIMULATOR === "1";
  if (!anyReal && simAllowed && (settings.gateways.zarinpal || settings.gateways.idpay)) out.push(new SimGateway());
  return out;
}
export function gatewayById(id: string): Gateway | null {
  if (id === "zarinpal" && process.env.ZARINPAL_MERCHANT) return new Zarinpal();
  if (id === "idpay" && process.env.IDPAY_API_KEY) return new IdPay();
  if (id === "sim" && (process.env.NODE_ENV !== "production" || process.env.PAY_SIMULATOR === "1")) return new SimGateway();
  return null;
}
