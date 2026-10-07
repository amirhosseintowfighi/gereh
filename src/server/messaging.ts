/* Outbound SMS (Kavenegar) and email (SMTP).
   Without credentials (dev, CI, e2e) messages land in an in-memory outbox that tests can read;
   nothing is ever sent to real recipients from a non-configured environment. */
import "server-only";

export type Outgoing = { channel: "sms" | "email"; to: string; subject?: string; text: string; at: number };
const g = globalThis as typeof globalThis & { __gerehOutbox?: Outgoing[] };
export const outbox = (g.__gerehOutbox ??= []);
const keep = (m: Outgoing) => { outbox.unshift(m); outbox.length = Math.min(outbox.length, 200); };

const KAVENEGAR = "https://api.kavenegar.com/v1/";

/** env wins; otherwise the key the admin saved (encrypted) in settings — production only */
async function smsKey(): Promise<string | null> {
  if (process.env.KAVENEGAR_API_KEY) return process.env.KAVENEGAR_API_KEY;
  if (process.env.NODE_ENV !== "production") return null;
  const [{ getDb }, { getSmsKeySealed }, { open }] = await Promise.all([import("./db/client"), import("./state"), import("./secrets")]);
  return open(await getSmsKeySealed(await getDb()));
}

async function kavenegar(key: string, path: string, params: Record<string, string>) {
  const res = await fetch(KAVENEGAR + encodeURIComponent(key) + "/" + path + "?" + new URLSearchParams(params), { method: "POST", signal: AbortSignal.timeout(10_000) });
  const body = (await res.json().catch(() => null)) as { return?: { status: number; message: string } } | null;
  if (!res.ok || body?.return?.status !== 200) throw new Error("Kavenegar: " + (body?.return?.message || res.status));
}

export async function sendSms(to: string, text: string) {
  const key = await smsKey();
  if (!key) return keep({ channel: "sms", to, text, at: Date.now() });
  await kavenegar(key, "sms/send.json", { receptor: to, message: text, ...(process.env.KAVENEGAR_SENDER ? { sender: process.env.KAVENEGAR_SENDER } : {}) });
}

/** OTP via Kavenegar's verify/lookup template (fast lane, works on DND numbers) */
export async function sendOtpSms(to: string, code: string) {
  const key = await smsKey();
  if (!key) return keep({ channel: "sms", to, text: "کد ورود گره: " + code, at: Date.now() });
  await kavenegar(key, "verify/lookup.json", { receptor: to, token: code, template: process.env.KAVENEGAR_OTP_TEMPLATE || "gereh-otp" });
}

type Transport = { sendMail: (m: { from: string; to: string; subject: string; text: string }) => Promise<unknown> };
let transport: Promise<Transport> | null = null;

export async function sendEmail(to: string, subject: string, text: string) {
  if (!process.env.SMTP_HOST) return keep({ channel: "email", to, subject, text, at: Date.now() });
  transport ??= import("nodemailer").then((m) => m.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  }));
  await (await transport).sendMail({ from: process.env.SMTP_FROM || "گره <no-reply@gereh.net>", to, subject, text });
}
