/* MinIO / S3 driver. Data path and bucket configuration use the plain S3 API (SigV4); access keys,
   per-key policies, bucket quotas and usage use the MinIO admin API (/minio/admin/v3) and its
   Prometheus endpoint. Env: STORAGE_S3_ENDPOINT (in-cluster URL), STORAGE_S3_ACCESS_KEY,
   STORAGE_S3_SECRET_KEY (MinIO root or an admin user), STORAGE_PUBLIC_ENDPOINT (the URL customers
   and presigned links use), STORAGE_REGION. See deploy/storage/README.md. */
import "server-only";
import { createHash } from "node:crypto";
import { connect } from "node:tls";
import type { StorageCorsRule, StorageLifecycle } from "../db/schema";
import type { BucketConfig, BucketUsage, CertState, KeySpec, Listing, ObjInfo, StorageDriver } from "./driver";
import { storageEndpoint, storageRegion } from "./driver";
import { encPath, encryptAdmin, presign, prometheusToken, signRequest, type Creds } from "./sigv4";

export class S3Error extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const xmlUnesc = (s: string) => s.replace(/&#(x?)([0-9a-fA-F]+);/g, (_, x, n) => String.fromCodePoint(parseInt(n, x ? 16 : 10)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => { const m = new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">").exec(xml); return m ? xmlUnesc(m[1]) : ""; };
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">", "g"))].map((m) => m[1]);
const md5b64 = (b: string) => createHash("md5").update(b).digest("base64");

/* ---------- policies and XML documents (exported for tests) ---------- */
export function keyPolicy(grants: KeySpec["grants"]) {
  if (!grants.length) return { Version: "2012-10-17", Statement: [{ Effect: "Deny", Action: ["s3:*"], Resource: ["arn:aws:s3:::*"] }] };
  const arn = (b: string) => "arn:aws:s3:::" + b;
  const read = grants.map((g) => g.bucket), write = grants.filter((g) => g.perm === "write").map((g) => g.bucket);
  const st: object[] = [
    { Effect: "Allow", Action: ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads", "s3:ListBucketVersions"], Resource: read.map(arn) },
    { Effect: "Allow", Action: ["s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging"], Resource: read.map((b) => arn(b) + "/*") },
  ];
  if (write.length) st.push({ Effect: "Allow", Action: ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts", "s3:PutObjectTagging"], Resource: write.map((b) => arn(b) + "/*") });
  return { Version: "2012-10-17", Statement: st };
}
export function bucketPolicy(name: string, access: "private" | "public", suspended: boolean) {
  if (suspended) return { Version: "2012-10-17", Statement: [{ Effect: "Deny", Principal: { AWS: ["*"] }, Action: ["s3:*"], Resource: ["arn:aws:s3:::" + name, "arn:aws:s3:::" + name + "/*"] }] };
  if (access === "public") return { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { AWS: ["*"] }, Action: ["s3:GetObject"], Resource: ["arn:aws:s3:::" + name + "/*"] }] };
  return null;
}
export function lifecycleXml(l: StorageLifecycle, versioning: boolean) {
  return "<LifecycleConfiguration><Rule><ID>gereh-expire</ID><Status>Enabled</Status><Filter><Prefix>" + xmlEsc(l.prefix) + "</Prefix></Filter>"
    + "<Expiration><Days>" + l.days + "</Days></Expiration>"
    + (versioning ? "<NoncurrentVersionExpiration><NoncurrentDays>" + l.days + "</NoncurrentDays></NoncurrentVersionExpiration>" : "")
    + "</Rule></LifecycleConfiguration>";
}
export function corsXml(rules: StorageCorsRule[]) {
  return "<CORSConfiguration>" + rules.map((r) => "<CORSRule>"
    + r.origins.map((o) => "<AllowedOrigin>" + xmlEsc(o) + "</AllowedOrigin>").join("")
    + r.methods.map((m) => "<AllowedMethod>" + m + "</AllowedMethod>").join("")
    + r.headers.map((h) => "<AllowedHeader>" + xmlEsc(h) + "</AllowedHeader>").join("")
    + "<ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>" + r.maxAge + "</MaxAgeSeconds></CORSRule>").join("") + "</CORSConfiguration>";
}
export function parseList(xml: string): Listing {
  const objects: ObjInfo[] = tags(xml, "Contents").map((c) => ({ key: tag(c, "Key"), size: Number(tag(c, "Size")) || 0, modified: tag(c, "LastModified"), etag: tag(c, "ETag").replace(/"/g, "") }));
  const folders = tags(xml, "CommonPrefixes").map((c) => tag(c, "Prefix"));
  return { folders, objects, next: tag(xml, "IsTruncated") === "true" ? tag(xml, "NextContinuationToken") || null : null };
}
/** sums per-bucket series of MinIO's /minio/v2/metrics/bucket (Prometheus text format) */
export function parseBucketMetrics(text: string) {
  const out = new Map<string, { requests: number; bytesIn: number; bytesOut: number }>();
  const want: Record<string, "requests" | "bytesIn" | "bytesOut"> = { minio_bucket_requests_total: "requests", minio_bucket_traffic_received_bytes: "bytesIn", minio_bucket_traffic_sent_bytes: "bytesOut" };
  for (const line of text.split("\n")) {
    const m = /^(\w+)\{([^}]*)\}\s+([0-9.eE+-]+)/.exec(line);
    if (!m || !want[m[1]]) continue;
    const bucket = /(?:^|,)bucket="([^"]*)"/.exec(m[2])?.[1];
    if (!bucket) continue;
    const row = out.get(bucket) ?? { requests: 0, bytesIn: 0, bytesOut: 0 };
    row[want[m[1]]] += Number(m[3]) || 0;
    out.set(bucket, row);
  }
  return out;
}

const policyName = (accessKey: string) => "gereh-key-" + accessKey.toLowerCase();

export class S3Driver implements StorageDriver {
  readonly name = "s3" as const;
  private origin = (process.env.STORAGE_S3_ENDPOINT || "").replace(/\/$/, "");
  private creds: Creds = { accessKey: process.env.STORAGE_S3_ACCESS_KEY || "", secretKey: process.env.STORAGE_S3_SECRET_KEY || "", region: storageRegion() };

  private async req(method: string, path: string, o: { query?: Record<string, string>; headers?: Record<string, string>; body?: string | Buffer; ok404?: boolean } = {}) {
    const { url, headers } = signRequest(this.creds, { method, origin: this.origin, path, query: o.query, headers: o.headers, body: o.body });
    const res = await fetch(url, { method, headers, body: o.body ? new Uint8Array(o.body instanceof Buffer ? o.body : Buffer.from(o.body)) : undefined, cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!res.ok && !(o.ok404 && res.status === 404)) {
      const text = await res.text().catch(() => "");
      const code = tag(text, "Code") || (/"Code"\s*:\s*"(\w+)"/.exec(text)?.[1] ?? "HTTP" + res.status);
      throw new S3Error(res.status, code, method + " " + path + ": " + code + " " + (tag(text, "Message") || text.slice(0, 200)));
    }
    return res;
  }
  private admin = (method: string, op: string, query: Record<string, string> = {}, body?: string | Buffer) => this.req(method, "/minio/admin/v3/" + op, { query, body });

  async test() {
    const r = await (await this.admin("GET", "info")).json() as { servers?: { version?: string }[] };
    return { version: "MinIO " + (r.servers?.[0]?.version ?? "?") };
  }

  async createBucket(cfg: BucketConfig) {
    await this.req("PUT", "/" + cfg.name, { body: this.creds.region === "us-east-1" ? undefined : `<CreateBucketConfiguration><LocationConstraint>${this.creds.region}</LocationConstraint></CreateBucketConfiguration>` });
    return this.applyBucket(cfg);
  }

  async applyBucket(cfg: BucketConfig) {
    const b = "/" + cfg.name;
    await this.admin("PUT", "set-bucket-quota", { bucket: cfg.name }, JSON.stringify({ quota: cfg.quotaBytes, size: cfg.quotaBytes, quotatype: "hard" }));
    const pol = bucketPolicy(cfg.name, cfg.access, cfg.suspended);
    if (pol) await this.req("PUT", b, { query: { policy: "" }, body: JSON.stringify(pol) });
    else await this.req("DELETE", b, { query: { policy: "" }, ok404: true });
    await this.req("PUT", b, { query: { versioning: "" }, body: `<VersioningConfiguration><Status>${cfg.versioning ? "Enabled" : "Suspended"}</Status></VersioningConfiguration>` });
    if (cfg.lifecycle) { const x = lifecycleXml(cfg.lifecycle, cfg.versioning); await this.req("PUT", b, { query: { lifecycle: "" }, body: x, headers: { "content-md5": md5b64(x) } }); }
    else await this.req("DELETE", b, { query: { lifecycle: "" }, ok404: true });
    // MinIO has no per-bucket CORS (it answers CORS globally, MINIO_API_CORS_ALLOW_ORIGIN); S3 does
    let corsApplied = true;
    try {
      if (cfg.cors.length) { const x = corsXml(cfg.cors); await this.req("PUT", b, { query: { cors: "" }, body: x, headers: { "content-md5": md5b64(x) } }); }
      else await this.req("DELETE", b, { query: { cors: "" }, ok404: true });
    } catch (e) {
      if (e instanceof S3Error && (e.code === "NotImplemented" || e.status === 501)) corsApplied = false;
      else throw e;
    }
    return { corsApplied };
  }

  async deleteBucket(name: string) {
    // MinIO extension: removes the bucket with all objects and versions
    await this.req("DELETE", "/" + name, { headers: { "x-minio-force-delete": "true" }, ok404: true });
  }

  async list(bucket: string, prefix: string, cursor?: string | null, limit = 1000) {
    const q: Record<string, string> = { "list-type": "2", prefix, delimiter: "/", "max-keys": String(limit) };
    if (cursor) q["continuation-token"] = cursor;
    const l = parseList(await (await this.req("GET", "/" + bucket, { query: q })).text());
    return { ...l, objects: l.objects.filter((o) => o.key !== prefix) };
  }

  async listKeys(bucket: string, prefix: string, max = 10_000) {
    const out: ObjInfo[] = [];
    let token: string | null = null;
    do {
      const q: Record<string, string> = { "list-type": "2", prefix, "max-keys": "1000" };
      if (token) q["continuation-token"] = token;
      const l = parseList(await (await this.req("GET", "/" + bucket, { query: q })).text());
      out.push(...l.objects);
      token = l.next;
    } while (token && out.length < max);
    return out.slice(0, max);
  }

  async putObject(bucket: string, key: string, body: Buffer, contentType = "application/octet-stream") {
    await this.req("PUT", "/" + bucket + "/" + key, { body, headers: { "content-type": contentType } });
  }
  async copyObject(bucket: string, from: string, to: string) {
    await this.req("PUT", "/" + bucket + "/" + to, { headers: { "x-amz-copy-source": "/" + bucket + "/" + encPath(from) } });
  }
  async deleteObjects(bucket: string, keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      const x = "<Delete><Quiet>true</Quiet>" + keys.slice(i, i + 1000).map((k) => "<Object><Key>" + xmlEsc(k) + "</Key></Object>").join("") + "</Delete>";
      const res = await this.req("POST", "/" + bucket, { query: { delete: "" }, body: x, headers: { "content-md5": md5b64(x), "content-type": "application/xml" } });
      const err = tags(await res.text(), "Error")[0];
      if (err) throw new S3Error(500, tag(err, "Code"), "delete " + tag(err, "Key") + ": " + tag(err, "Message"));
    }
  }

  presign(method: "GET" | "PUT", bucket: string, key: string, ttlSec: number, o: { download?: string; contentType?: string } = {}) {
    const query: Record<string, string> = {};
    if (o.download) query["response-content-disposition"] = "attachment; filename*=UTF-8''" + encodeURIComponent(o.download);
    return presign(this.creds, { method, origin: storageEndpoint(), path: "/" + bucket + "/" + key, expires: ttlSec, query });
  }
  publicUrl(bucket: string, key: string) { return storageEndpoint() + "/" + bucket + "/" + encPath(key); }

  async upsertKey(k: KeySpec) {
    // add-user creates or updates (new secret); the canned policy is replaced and attached
    await this.admin("PUT", "add-user", { accessKey: k.accessKey }, encryptAdmin(this.creds.secretKey, JSON.stringify({ secretKey: k.secretKey, status: "enabled" })));
    await this.admin("PUT", "add-canned-policy", { name: policyName(k.accessKey) }, JSON.stringify(keyPolicy(k.grants)));
    await this.admin("PUT", "set-user-or-group-policy", { policyName: policyName(k.accessKey), userOrGroup: k.accessKey, isGroup: "false" });
  }
  async removeKey(accessKey: string) {
    await this.req("DELETE", "/minio/admin/v3/remove-user", { query: { accessKey }, ok404: true });
    await this.req("DELETE", "/minio/admin/v3/remove-canned-policy", { query: { name: policyName(accessKey) }, ok404: true });
  }

  async usage(buckets: string[]): Promise<BucketUsage[]> {
    const du = await (await this.admin("GET", "datausageinfo")).json() as { bucketsUsageInfo?: Record<string, { size?: number; objectsCount?: number }> };
    let traffic = new Map<string, { requests: number; bytesIn: number; bytesOut: number }>();
    try {
      const res = await fetch(this.origin + "/minio/v2/metrics/bucket", { headers: { authorization: "Bearer " + prometheusToken(this.creds.accessKey, this.creds.secretKey) }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (res.ok) traffic = parseBucketMetrics(await res.text());
    } catch { /* metrics are optional: size and object count still update */ }
    return buckets.map((name) => {
      const u = du.bucketsUsageInfo?.[name], t = traffic.get(name);
      return { name, size: u?.size ?? 0, objects: u?.objectsCount ?? 0, requests: t?.requests ?? 0, bytesIn: t?.bytesIn ?? 0, bytesOut: t?.bytesOut ?? 0 };
    });
  }

  certStatus(host: string): Promise<CertState> {
    return new Promise((resolve) => {
      const s = connect({ host, port: 443, servername: host, timeout: 5000 });
      const done = (v: CertState) => { s.destroy(); resolve(v); };
      s.once("secureConnect", () => done(s.authorized ? "issued" : "pending"));
      s.once("timeout", () => done("pending"));
      s.once("error", () => done("pending"));
    });
  }
}
