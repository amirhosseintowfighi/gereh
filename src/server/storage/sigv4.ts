/* AWS Signature Version 4 (header and presigned-URL forms) and the two MinIO admin extras the
   S3 driver needs (encrypted admin payloads, Prometheus bearer tokens), with node:crypto only. */
import "server-only";
import { createCipheriv, createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

export type Creds = { accessKey: string; secretKey: string; region: string; service?: string };

/** RFC 3986 encoding as SigV4 wants it (unreserved: A-Z a-z 0-9 - _ . ~) */
export const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
export const encPath = (p: string) => p.split("/").map(enc).join("/");
export const sha256hex = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const hmac = (key: string | Buffer, s: string) => createHmac("sha256", key).update(s, "utf8").digest();
export const amzDate = (d: Date) => d.toISOString().replace(/[:-]|\.\d{3}/g, "");
export const EMPTY_SHA = sha256hex("");

const canonicalQuery = (q: Record<string, string>) =>
  Object.entries(q).map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => k + "=" + v).join("&");

function signature(c: Creds, date: string, method: string, path: string, query: Record<string, string>, headers: Record<string, string>, payloadHash: string) {
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")]));
  const canonical = [method, encPath(path), canonicalQuery(query), names.map((h) => h + ":" + lower[h] + "\n").join(""), names.join(";"), payloadHash].join("\n");
  const scope = date.slice(0, 8) + "/" + c.region + "/" + (c.service ?? "s3") + "/aws4_request";
  const toSign = ["AWS4-HMAC-SHA256", date, scope, sha256hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + c.secretKey, date.slice(0, 8)), c.region), c.service ?? "s3"), "aws4_request");
  return { sig: createHmac("sha256", key).update(toSign, "utf8").digest("hex"), scope, signed: names.join(";") };
}

const hostOf = (origin: string) => new URL(origin).host;
const urlOf = (origin: string, path: string, query: Record<string, string>) => {
  const q = canonicalQuery(query);
  return origin.replace(/\/$/, "") + encPath(path) + (q ? "?" + q : "");
};

/** signs a request in the Authorization header; `path` is the raw (unencoded) path */
export function signRequest(c: Creds, r: { method: string; origin: string; path: string; query?: Record<string, string>; headers?: Record<string, string>; body?: Buffer | string; now?: Date }) {
  const date = amzDate(r.now ?? new Date());
  const payloadHash = sha256hex(r.body ?? "");
  const headers: Record<string, string> = { ...(r.headers ?? {}), host: hostOf(r.origin), "x-amz-date": date, "x-amz-content-sha256": payloadHash };
  const s = signature(c, date, r.method, r.path, r.query ?? {}, headers, payloadHash);
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${s.scope}, SignedHeaders=${s.signed}, Signature=${s.sig}`;
  delete headers.host; // fetch sets it
  return { url: urlOf(r.origin, r.path, r.query ?? {}), headers };
}

/** a presigned URL (query-string auth, host as the only signed header, unsigned payload) */
export function presign(c: Creds, r: { method: string; origin: string; path: string; expires: number; query?: Record<string, string>; now?: Date }) {
  const date = amzDate(r.now ?? new Date());
  const scope = date.slice(0, 8) + "/" + c.region + "/" + (c.service ?? "s3") + "/aws4_request";
  const query = { ...(r.query ?? {}), "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": c.accessKey + "/" + scope, "X-Amz-Date": date, "X-Amz-Expires": String(r.expires), "X-Amz-SignedHeaders": "host" };
  const s = signature(c, date, r.method, r.path, query, { host: hostOf(r.origin) }, "UNSIGNED-PAYLOAD");
  return urlOf(r.origin, r.path, { ...query, "X-Amz-Signature": s.sig });
}

/* MinIO admin payloads (add-user) are encrypted like madmin.EncryptData: salt(32) | id | nonce(8) |
   a sio-go AES-256-GCM stream. We use the PBKDF2 key derivation (id 0x02, MinIO's FIPS mode) which
   every MinIO server decrypts; Argon2id is not in node:crypto. Payloads are far below sio's 16 KiB
   fragment size, so the stream is a single final fragment. */
export function encryptAdmin(password: string, data: Buffer | string): Buffer {
  const salt = randomBytes(32), nonce = randomBytes(8);
  const key = pbkdf2Sync(Buffer.from(password, "utf8"), salt, 8192, 32, "sha256");
  const iv = (seq: number) => { const b = Buffer.alloc(12); nonce.copy(b, 0); b.writeUInt32LE(seq, 8); return b; };
  // sio-go binds the stream's associated data with an empty seal under sequence number 0
  const c0 = createCipheriv("aes-256-gcm", key, iv(0));
  c0.final();
  const ad = Buffer.concat([Buffer.from([0x80]), c0.getAuthTag()]);
  const c1 = createCipheriv("aes-256-gcm", key, iv(1));
  c1.setAAD(ad);
  const body = Buffer.concat([c1.update(Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8")), c1.final(), c1.getAuthTag()]);
  return Buffer.concat([salt, Buffer.from([0x02]), nonce, body]);
}

/** bearer token for MinIO's Prometheus endpoints (what `mc admin prometheus generate` makes) */
export function prometheusToken(accessKey: string, secretKey: string, ttlSec = 3600) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS512", typ: "JWT" }) + "." + b64({ exp: Math.floor(Date.now() / 1000) + ttlSec, sub: accessKey, iss: "prometheus" });
  return head + "." + createHmac("sha512", secretKey).update(head).digest("base64url");
}
