/* Upstream for inquiry services. Two implementations:
   - HttpProvider: POSTs the validated inputs as JSON to INQUIRY_PROVIDER_URL/<upstream path> with a
     bearer token; the provider's response is mapped to { status, result }. Adjust `map()` to the
     provider's actual format once its documentation is in hand.
   - SimProvider: deterministic fake answers for development, demos, tests and the sandbox. */
import "server-only";
import { createHash } from "node:crypto";
import { inquiryDef } from "@/lib/inquiry";

export type UpstreamResult = { status: "success" | "not_found"; result: Record<string, unknown> | null } | { status: "error"; message: string };
export interface InquiryProvider {
  readonly name: "http" | "simulator";
  call(serviceId: string, upstreamPath: string, input: Record<string, string>): Promise<UpstreamResult>;
}

const seed = (s: string) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16);
const FIRST = ["علی", "زهرا", "محمد", "فاطمه", "حسین", "مریم", "رضا", "سارا", "امیر", "نرگس"];
const LAST = ["محمدی", "حسینی", "رضایی", "کریمی", "احمدی", "موسوی", "جعفری", "صادقی", "رحیمی", "نوری"];
const FATHER = ["حسن", "مهدی", "عباس", "جواد", "مجید", "ناصر"];
const BANKS: [string, string][] = [["056", "بانک سامان"], ["017", "بانک ملی"], ["019", "بانک صادرات"], ["012", "بانک ملت"], ["054", "بانک پارسیان"], ["062", "بانک آینده"]];
const CARD_BIN: Record<string, string> = { "603799": "017", "603769": "019", "610433": "012", "621986": "056", "622106": "054", "636214": "062" };

export class SimProvider implements InquiryProvider {
  readonly name = "simulator" as const;
  async call(serviceId: string, _path: string, input: Record<string, string>): Promise<UpstreamResult> {
    const key = Object.values(input).join("|");
    // conventions for tests and demos: an input ending in 0000 is "not found", in 9999 an upstream failure
    if (/0000$/.test(key)) return { status: "not_found", result: null };
    if (/9999$/.test(key)) return { status: "error", message: "upstream timeout" };
    const h = seed(serviceId + key);
    const pick = <T,>(a: T[], k = 0) => a[(h >> k) % a.length];
    const person = () => ({ firstName: input.firstName || pick(FIRST), lastName: input.lastName || pick(LAST, 3) });
    const bank = () => { const b = BANKS.find(([c]) => c === (input.bankCode || CARD_BIN[input.card?.slice(0, 6) ?? ""] || input.iban?.slice(5, 7)?.padStart(3, "0"))) ?? pick(BANKS); return { code: b[0], name: b[1] }; };
    const iban = () => "IR" + String(10 + (h % 89)) + "0" + bank().code + String(h).padStart(19, "0").slice(0, 19);
    const deposit = () => String(h).padStart(16, "1").slice(0, 16);
    const p = person();
    const r: Record<string, () => Record<string, unknown>> = {
      identity_v2: () => ({ ...p, fatherName: pick(FATHER, 5), gender: h % 2 ? "male" : "female", alive: h % 50 !== 0, birthDate: input.birthDate }),
      identity_match: () => ({ firstNameMatch: h % 7 !== 0, lastNameMatch: h % 11 !== 0 }),
      shahkar_lite: () => ({ matched: h % 6 !== 0 }),
      mobile_operator: () => { const op = /^09(1|9[0-4])/.test(input.mobile) ? ["MCI", "همراه اول"] : /^09(0|3)/.test(input.mobile) ? ["MTN", "ایرانسل"] : /^092/.test(input.mobile) ? ["RTL", "رایتل"] : ["OTHER", "سایر"]; return { operator: op[0], operatorName: op[1], ported: h % 9 === 0 }; },
      ibans: () => ({ bank: bank().name, bankCode: bank().code, owners: [p.firstName + " " + p.lastName], depositStatus: h % 20 === 0 ? "blocked" : "active", deposit: deposit() }),
      cards: () => ({ bank: bank().name, owner: p.firstName + " " + p.lastName }),
      cards_iban: () => ({ iban: iban(), bank: bank().name, owner: p.firstName + " " + p.lastName }),
      cards_deposit: () => ({ deposit: deposit(), bank: bank().name, owner: p.firstName + " " + p.lastName }),
      deposit_iban: () => ({ iban: iban(), owner: p.firstName + " " + p.lastName }),
      iban_owner: () => ({ matched: h % 5 !== 0 }),
      card_owner: () => ({ matched: h % 5 !== 0 }),
      postal_code: () => ({ province: "تهران", city: "تهران", street: pick(["خیابان ولیعصر", "خیابان کارگر شمالی", "بلوار کشاورز", "خیابان شریعتی"]), plate: String(1 + (h % 120)), floor: String(h % 8), address: "تهران، " + pick(["خیابان ولیعصر", "خیابان کارگر شمالی", "بلوار کشاورز", "خیابان شریعتی"]) + "، پلاک " + (1 + (h % 120)) }),
      company: () => ({ name: "شرکت " + pick(["نوآوران", "فناوران", "پیشگامان", "داده‌پردازان"]) + " " + pick(["پارس", "آریا", "ایرانیان", "نوین"], 4), registrationNumber: String(100000 + (h % 800000)), registrationDate: "13" + (85 + (h % 15)) + "/0" + (1 + (h % 9)) + "/1" + (h % 9), type: pick(["سهامی خاص", "مسئولیت محدود", "سهامی عام"]), status: h % 25 === 0 ? "dissolved" : "active", address: "تهران" }),
      economic_code: () => ({ name: "شرکت " + pick(["نوآوران", "فناوران"]) + " " + pick(["پارس", "آریا"], 4), economicCode: "4" + String(h).padStart(11, "1").slice(0, 11), vatRegistered: h % 4 !== 0 }),
      sayad_cheque: () => { const c = [["white", "سفید"], ["white", "سفید"], ["white", "سفید"], ["yellow", "زرد"], ["orange", "نارنجی"], ["brown", "قهوه‌ای"], ["red", "قرمز"]][h % 7]; return { color: c[0], colorName: c[1], bouncedCount: h % 7 < 3 ? 0 : (h % 7) - 2 }; },
      national_card_ocr: () => ({ nationalCode: "0012345679", ...p, birthDate: "1370/05/12", expiry: "1410/05/12" }),
      face_match: () => { const s = Math.round((0.55 + (h % 45) / 100) * 100) / 100; return { matched: s >= 0.8, similarity: s, liveness: h % 13 !== 0 }; },
    };
    const make = r[serviceId] ?? (() => inquiryDef(serviceId)?.sample ?? {});
    return { status: "success", result: make() };
  }
}

export class HttpProvider implements InquiryProvider {
  readonly name = "http" as const;
  async call(serviceId: string, upstreamPath: string, input: Record<string, string>): Promise<UpstreamResult> {
    const base = process.env.INQUIRY_PROVIDER_URL!.replace(/\/$/, "");
    let res: Response;
    try {
      res = await fetch(base + "/" + (upstreamPath || serviceId).replace(/^\//, ""), {
        method: "POST", headers: { authorization: "Bearer " + process.env.INQUIRY_PROVIDER_TOKEN, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(input), signal: AbortSignal.timeout(Number(process.env.INQUIRY_TIMEOUT_MS ?? 15_000)),
      });
    } catch (e) { return { status: "error", message: (e as Error).name === "TimeoutError" ? "upstream timeout" : "upstream unreachable" }; }
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;
    return map(res.status, body);
  }
}
/** provider response → our contract; 404 or an explicit not-found flag is a (billable) "not found" */
function map(status: number, body: Record<string, unknown> | null): UpstreamResult {
  if (status === 404 || body?.status === "not_found" || body?.code === "NOT_FOUND") return { status: "not_found", result: null };
  if (status >= 200 && status < 300 && body) return { status: "success", result: (body.result ?? body.data ?? body) as Record<string, unknown> };
  return { status: "error", message: "upstream " + status };
}

let cached: InquiryProvider | null = null;
export function inquiryProvider(): InquiryProvider {
  return (cached ??= process.env.INQUIRY_PROVIDER_URL && process.env.INQUIRY_PROVIDER_TOKEN ? new HttpProvider() : new SimProvider());
}
export const resetInquiryProvider = () => { cached = null; };
export const simProvider = new SimProvider();
