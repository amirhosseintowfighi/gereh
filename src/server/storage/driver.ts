/* What Object Storage needs from the S3 backend. Two implementations:
   - S3Driver (./s3.ts): MinIO (or any S3 API for the data path) signed with SigV4; access keys,
     policies, quotas and usage through the MinIO admin API. Used when STORAGE_S3_ENDPOINT,
     STORAGE_S3_ACCESS_KEY and STORAGE_S3_SECRET_KEY are set.
   - SimulatorDriver (below): in-memory buckets for dev, CI and demos; its presigned and public URLs
     are served by /api/storage/sim. */
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { StorageCorsRule, StorageLifecycle } from "../db/schema";
import { encPath } from "./sigv4";

export type ObjInfo = { key: string; size: number; modified: string; etag: string };
export type Listing = { folders: string[]; objects: ObjInfo[]; next: string | null };
export type BucketConfig = { name: string; quotaBytes: number; access: "private" | "public"; versioning: boolean; cors: StorageCorsRule[]; lifecycle: StorageLifecycle | null; suspended: boolean };
export type KeySpec = { accessKey: string; secretKey: string; grants: { bucket: string; perm: "read" | "write" }[] };
/** size/objects are current; requests and traffic are cumulative counters (they may reset) */
export type BucketUsage = { name: string; size: number; objects: number; requests: number; bytesIn: number; bytesOut: number };
export type CertState = "pending" | "issued" | "failed";

export interface StorageDriver {
  readonly name: "s3" | "simulator";
  test(): Promise<{ version: string }>;
  createBucket(cfg: BucketConfig): Promise<{ corsApplied: boolean }>;
  /** applies quota, access policy (public/private/suspended), versioning, CORS and lifecycle */
  applyBucket(cfg: BucketConfig): Promise<{ corsApplied: boolean }>;
  /** removes the bucket with everything in it */
  deleteBucket(name: string): Promise<void>;
  list(bucket: string, prefix: string, cursor?: string | null, limit?: number): Promise<Listing>;
  /** every key under a prefix (recursive), at most `max` */
  listKeys(bucket: string, prefix: string, max?: number): Promise<ObjInfo[]>;
  putObject(bucket: string, key: string, body: Buffer, contentType?: string): Promise<void>;
  copyObject(bucket: string, from: string, to: string): Promise<void>;
  deleteObjects(bucket: string, keys: string[]): Promise<void>;
  /** time-limited URL for a browser GET (download) or PUT (upload) */
  presign(method: "GET" | "PUT", bucket: string, key: string, ttlSec: number, o?: { download?: string; contentType?: string }): string;
  /** permanent URL of an object in a public bucket */
  publicUrl(bucket: string, key: string): string;
  upsertKey(k: KeySpec): Promise<void>;
  removeKey(accessKey: string): Promise<void>;
  usage(buckets: string[]): Promise<BucketUsage[]>;
  /** whether a valid certificate is served for a custom domain */
  certStatus(host: string): Promise<CertState>;
}

/* ---------- simulator ---------- */
type SimObj = { body: Buffer; type: string; modified: Date; etag: string };
type SimBucket = { cfg: BucketConfig; objects: Map<string, SimObj>; requests: number; bytesIn: number; bytesOut: number };
const SIM_MAX_BYTES = 256 * 1024 * 1024; // keep dev memory bounded

const secret = () => process.env.APP_SECRET || "gereh-dev-storage-sim";
const simSig = (method: string, bucket: string, key: string, exp: number, extra: string) => createHmac("sha256", secret()).update([method, bucket, key, exp, extra].join("\n")).digest("base64url");

export class SimulatorDriver implements StorageDriver {
  readonly name = "simulator" as const;
  static buckets = new Map<string, SimBucket>();
  static keys = new Map<string, KeySpec>();
  private get b() { return SimulatorDriver.buckets; }
  private need(bucket: string) { const b = this.b.get(bucket); if (!b) throw new Error("NoSuchBucket: " + bucket); return b; }
  async test() { return { version: "Simulator" }; }
  async createBucket(cfg: BucketConfig) {
    if (this.b.has(cfg.name)) throw new Error("BucketAlreadyExists: " + cfg.name);
    this.b.set(cfg.name, { cfg, objects: new Map(), requests: 0, bytesIn: 0, bytesOut: 0 });
    return { corsApplied: true };
  }
  async applyBucket(cfg: BucketConfig) { this.need(cfg.name).cfg = cfg; return { corsApplied: true }; }
  async deleteBucket(name: string) { this.b.delete(name); }
  async list(bucket: string, prefix: string, cursor?: string | null, limit = 1000): Promise<Listing> {
    const b = this.need(bucket);
    b.requests++;
    const folders = new Set<string>(); const objects: ObjInfo[] = [];
    for (const [key, o] of [...b.objects].sort(([x], [y]) => (x < y ? -1 : 1))) {
      if (!key.startsWith(prefix) || key === prefix) continue;
      const rest = key.slice(prefix.length), slash = rest.indexOf("/");
      if (slash >= 0) folders.add(prefix + rest.slice(0, slash + 1));
      else objects.push({ key, size: o.body.length, modified: o.modified.toISOString(), etag: o.etag });
    }
    const start = cursor ? Math.max(0, Number(cursor) || 0) : 0;
    const page = objects.slice(start, start + limit);
    return { folders: start ? [] : [...folders], objects: page, next: start + limit < objects.length ? String(start + limit) : null };
  }
  async listKeys(bucket: string, prefix: string, max = 10_000) {
    const b = this.need(bucket);
    return [...b.objects].filter(([k]) => k.startsWith(prefix)).sort(([x], [y]) => (x < y ? -1 : 1)).slice(0, max).map(([key, o]) => ({ key, size: o.body.length, modified: o.modified.toISOString(), etag: o.etag }));
  }
  /** shared by putObject and the simulated presigned PUT: quota and suspension like MinIO */
  write(bucket: string, key: string, body: Buffer, type = "application/octet-stream") {
    const b = this.need(bucket);
    if (b.cfg.suspended) throw new Error("AccessDenied");
    const used = [...b.objects].reduce((s, [k, o]) => s + (k === key ? 0 : o.body.length), 0);
    const total = [...this.b.values()].reduce((s, x) => s + [...x.objects.values()].reduce((t, o) => t + o.body.length, 0), 0);
    if (used + body.length > b.cfg.quotaBytes) throw new Error("XMinioAdminBucketQuotaExceeded");
    if (total + body.length > SIM_MAX_BYTES) throw new Error("SimulatorFull");
    b.objects.set(key, { body, type, modified: new Date(), etag: createHash("md5").update(body).digest("hex") });
    b.requests++; b.bytesIn += body.length;
  }
  async putObject(bucket: string, key: string, body: Buffer, contentType?: string) { this.write(bucket, key, body, contentType); }
  /** the object a simulated GET serves (counts as a request and outgoing traffic) */
  read(bucket: string, key: string) {
    const b = this.b.get(bucket);
    const o = b?.objects.get(key);
    if (!b || !o || b.cfg.suspended) return null;
    b.requests++; b.bytesOut += o.body.length;
    return o;
  }
  isPublic(bucket: string) { const b = this.b.get(bucket); return !!b && b.cfg.access === "public" && !b.cfg.suspended; }
  async copyObject(bucket: string, from: string, to: string) {
    const b = this.need(bucket);
    const o = b.objects.get(from);
    if (!o) throw new Error("NoSuchKey: " + from);
    b.objects.set(to, { ...o, modified: new Date() });
    b.requests++;
  }
  async deleteObjects(bucket: string, keys: string[]) { const b = this.need(bucket); for (const k of keys) b.objects.delete(k); b.requests++; }
  presign(method: "GET" | "PUT", bucket: string, key: string, ttlSec: number, o: { download?: string; contentType?: string } = {}) {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const extra = o.download ?? "";
    const q = new URLSearchParams({ m: method, exp: String(exp), sig: simSig(method, bucket, key, exp, extra), ...(o.download ? { dl: o.download } : {}) });
    return "/api/storage/sim/" + bucket + "/" + encPath(key) + "?" + q.toString();
  }
  /** validates a simulated presigned URL */
  checkSig(method: string, bucket: string, key: string, exp: number, sig: string, dl: string) {
    if (!exp || exp < Date.now() / 1000) return false;
    const want = Buffer.from(simSig(method, bucket, key, exp, dl)), got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }
  publicUrl(bucket: string, key: string) { return "/api/storage/sim/" + bucket + "/" + encPath(key); }
  async upsertKey(k: KeySpec) { SimulatorDriver.keys.set(k.accessKey, k); }
  async removeKey(accessKey: string) { SimulatorDriver.keys.delete(accessKey); }
  async usage(buckets: string[]) {
    return buckets.flatMap((name) => {
      const b = this.b.get(name);
      if (!b) return [];
      return [{ name, size: [...b.objects.values()].reduce((s, o) => s + o.body.length, 0), objects: b.objects.size, requests: b.requests, bytesIn: b.bytesIn, bytesOut: b.bytesOut }];
    });
  }
  async certStatus(host: string): Promise<CertState> { return /invalid|fail/.test(host) ? "failed" : "issued"; }
}

let cached: StorageDriver | null = null;
export const s3Configured = () => !!(process.env.STORAGE_S3_ENDPOINT && process.env.STORAGE_S3_ACCESS_KEY && process.env.STORAGE_S3_SECRET_KEY);
/** the configured driver (MinIO/S3 when STORAGE_S3_* are set) */
export async function storage(): Promise<StorageDriver> {
  if (cached) return cached;
  if (s3Configured()) {
    const { S3Driver } = await import("./s3");
    cached = new S3Driver();
  } else cached = new SimulatorDriver();
  return cached;
}
export const resetStorageDriver = () => { cached = null; };

/** what customers point their SDKs at */
export const storageEndpoint = () => (process.env.STORAGE_PUBLIC_ENDPOINT || "https://storage.gereh.net").replace(/\/$/, "");
export const storageRegion = () => process.env.STORAGE_REGION || "us-east-1";
/** custom domains CNAME here (an ingress maps the host onto the bucket) */
export const cnameTarget = (bucket: string) => bucket + "." + (process.env.STORAGE_CNAME_DOMAIN || new URL(storageEndpoint()).hostname);
