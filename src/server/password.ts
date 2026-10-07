import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt N=2^15, r=8, p=1 (OWASP minimum), 32-byte key, 16-byte salt
const N = 1 << 15, R = 8, P = 1, KEYLEN = 32, MAXMEM = 64 * 1024 * 1024;

const derive = (pw: string, salt: Buffer, n = N, r = R, p = P) =>
  new Promise<Buffer>((res, rej) => scrypt(pw.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (e, k) => (e ? rej(e) : res(k))));

/** "scrypt$N$r$p$salt$hash" (base64url) */
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await derive(pw, salt);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(pw: string, stored: string | null | undefined) {
  if (!stored) { await derive(pw, randomBytes(16)); return false; } // same cost for unknown users
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64url");
  const got = await derive(pw, Buffer.from(salt, "base64url"), +n, +r, +p);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
