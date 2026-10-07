import { roundK } from "./format";

type Inv = { items: { amount: number }[]; tax?: number };
export const invTotal = (inv: Inv) => inv.items.reduce((s, i) => s + i.amount, 0);
/** amount payable incl. VAT; an invoice's own frozen rate wins over the current setting */
export const invGross = (inv: Inv, fallbackTax = 10) => roundK(invTotal(inv) * (1 + (inv.tax ?? fallbackTax) / 100));

export type CouponRule = { code: string; type: "percent" | "fixed"; value: number };
export const couponDiscount = (c: CouponRule, subtotal: number) => Math.max(0, Math.min(subtotal, c.type === "percent" ? Math.round((subtotal * c.value) / 100) : c.value));
