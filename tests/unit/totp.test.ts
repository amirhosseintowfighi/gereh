import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, newSecret, otpauthUrl, totp, verifyTotp } from "@/lib/totp";

// RFC 6238 Appendix B test secret ("12345678901234567890") and SHA-1 vectors (last 6 digits).
const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));
const VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

describe("totp", () => {
  it("base32 round-trips arbitrary bytes", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
  });

  it("base32 decode ignores spaces/padding and rejects junk", () => {
    expect(base32Decode("mzxw 6ytb oi==")).toEqual(new TextEncoder().encode("foobar"));
    expect(() => base32Decode("MZXW1")).toThrow("invalid base32");
  });

  it.each(VECTORS)("matches RFC 6238 vector at t=%i", async (t, code) => {
    expect(await totp(RFC_SECRET, t * 1000)).toBe(code);
  });

  it("verifies the current code and ±1 step of drift only", async () => {
    const secret = newSecret();
    const now = 1_700_000_000_000;
    expect(await verifyTotp(secret, await totp(secret, now), now)).toBe(true);
    expect(await verifyTotp(secret, await totp(secret, now - 30_000), now)).toBe(true);
    expect(await verifyTotp(secret, await totp(secret, now + 30_000), now)).toBe(true);
    expect(await verifyTotp(secret, await totp(secret, now - 90_000), now)).toBe(false);
  });

  it("generates 160-bit secrets", () => {
    const s = newSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(newSecret()).not.toBe(s);
  });

  it("builds an otpauth URL authenticator apps accept", () => {
    const u = new URL(otpauthUrl("ABC", "demo@gereh.cloud"));
    expect(u.protocol).toBe("otpauth:");
    expect(decodeURIComponent(u.pathname)).toContain("Gereh:demo@gereh.cloud");
    expect(u.searchParams.get("secret")).toBe("ABC");
    expect(u.searchParams.get("issuer")).toBe("Gereh");
    expect(u.searchParams.get("digits")).toBe("6");
  });
});
