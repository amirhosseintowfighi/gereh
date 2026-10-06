import { describe, expect, it } from "vitest";
import { EMAIL_RE, PHONE_RE, fa, hashStr, roundK, strength, toEnDigits, toman } from "@/lib/format";

describe("format", () => {
  it("renders Persian digits and grouping", () => {
    expect(fa(1290000)).toBe("۱٬۲۹۰٬۰۰۰");
    expect(fa(99.99, 2)).toBe("۹۹٫۹۹");
    expect(toman(95000)).toBe("۹۵٬۰۰۰ تومان");
  });

  it("rounds to the nearest thousand", () => {
    expect(roundK(1_234_499)).toBe(1_234_000);
    expect(roundK(1_234_500)).toBe(1_235_000);
    expect(roundK(0)).toBe(0);
  });

  it("normalises Persian and Arabic-Indic digits", () => {
    expect(toEnDigits("۰۹۱۲۱۲۳۴۵۶۷")).toBe("09121234567");
    expect(toEnDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(toEnDigits("abc ۱۲3")).toBe("abc 123");
  });

  it("hashStr is deterministic and non-negative", () => {
    expect(hashStr("gereh")).toBe(hashStr("gereh"));
    expect(hashStr("gereh")).not.toBe(hashStr("gereh2"));
    for (const s of ["", "a", "x".repeat(1000), "سلام"]) expect(hashStr(s)).toBeGreaterThanOrEqual(0);
  });

  it("scores password strength 0–4", () => {
    expect(strength("")).toBe(0);
    expect(strength("abcdefgh")).toBe(1);
    expect(strength("Abcdefgh")).toBe(2);
    expect(strength("Abcdefg1")).toBe(3);
    expect(strength("Abcdef1!")).toBe(4);
  });

  it("validates email and Iranian mobile numbers", () => {
    expect(EMAIL_RE.test("name@example.com")).toBe(true);
    expect(EMAIL_RE.test("name@example")).toBe(false);
    expect(EMAIL_RE.test("a b@example.com")).toBe(false);
    expect(PHONE_RE.test("09121234567")).toBe(true);
    expect(PHONE_RE.test("9121234567")).toBe(false);
    expect(PHONE_RE.test("091212345678")).toBe(false);
  });
});
