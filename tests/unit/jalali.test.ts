import { describe, expect, it } from "vitest";
import { faDate, isLeapJalali, jalaliToGregorian, parseJalali } from "@/lib/jalali";

describe("jalali", () => {
  it.each([
    [1403, 1, 1, 2024, 3, 20],
    [1404, 1, 1, 2025, 3, 21],
    [1405, 7, 15, 2026, 10, 7],
    [1399, 12, 30, 2021, 3, 20],
    [1, 1, 1, 622, 3, 22],
  ])("%i/%i/%i → %i-%i-%i", (jy, jm, jd, gy, gm, gd) => {
    expect(jalaliToGregorian(jy, jm, jd)).toEqual({ gy, gm, gd });
  });

  it("knows leap years", () => {
    expect(isLeapJalali(1403)).toBe(true);
    expect(isLeapJalali(1404)).toBe(false);
    expect(() => jalaliToGregorian(1404, 12, 30)).toThrow();
  });

  it("round-trips through Intl formatting", () => {
    for (const s of ["۱۴۰۵/۰۷/۱۵", "۱۴۰۴/۰۱/۰۱", "۱۴۰۳/۱۲/۳۰", "۱۴۱۰/۰۶/۳۱"]) expect(faDate(parseJalali(s))).toBe(s);
  });

  it("rejects malformed input", () => {
    for (const s of ["", "1405-07-15", "1405/13/01", "1405/07/32", "abc"]) expect(parseJalali(s)).toBeNull();
  });
});
