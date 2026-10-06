/* RFC 6238 TOTP (SHA-1, 6 digits, 30 s) on WebCrypto — runs in browsers, Node ≥ 20 and edge runtimes. */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array) {
  let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("invalid base32");
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export const newSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

export async function totp(secret: string, time = Date.now(), step = 30) {
  const counter = Math.floor(time / 1000 / step);
  const msg = new ArrayBuffer(8);
  new DataView(msg).setUint32(4, counter >>> 0);
  new DataView(msg).setUint32(0, Math.floor(counter / 2 ** 32));
  const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

/** accepts the current code and one step either side for clock drift */
export async function verifyTotp(secret: string, code: string, time = Date.now()) {
  for (const d of [-1, 0, 1]) if ((await totp(secret, time + d * 30_000)) === code) return true;
  return false;
}

export const otpauthUrl = (secret: string, account: string, issuer = "Gereh") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
