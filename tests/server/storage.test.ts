import { createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as SIM_GET, PUT as SIM_PUT } from "@/app/api/storage/sim/[...path]/route";
import { GET as API_GET, POST as API_POST } from "@/app/api/v1/[[...path]]/route";
import { snippet, SDKS, bucketNameError } from "@/lib/storage";
import { context } from "@/server/ctx";
import { storageBuckets, storageKeys, storageUsage, transactions, users } from "@/server/db/schema";
import { MCP_TOOLS } from "@/server/mcp";
import { open } from "@/server/secrets";
import { buildState } from "@/server/state";
import { SimulatorDriver } from "@/server/storage/driver";
import { bucketPolicy, corsXml, keyPolicy, lifecycleXml, parseBucketMetrics, parseList } from "@/server/storage/s3";
import { setCnameResolver, storageBilling, storageCollect } from "@/server/storage/service";
import { encryptAdmin, presign, prometheusToken, signRequest } from "@/server/storage/sigv4";
import { asAdmin, asUser, call, db, fails, fresh, login } from "./helpers";

beforeEach(async () => {
  await fresh();
  SimulatorDriver.buckets.clear(); SimulatorDriver.keys.clear();
  setCnameResolver(async () => { throw new Error("ENOTFOUND"); });
});
const state = async () => { const c = await context(); return (await buildState(c.db, c.auth, "customer")).db.storage; };
const balance = async () => (await (await db()).select().from(users).where(eq(users.id, "u1")))[0].balance;
const simCtx = (url: string) => ({ params: Promise.resolve({ path: decodeURIComponent(new URL(url, "http://x").pathname).replace("/api/storage/sim/", "").split("/") }) }) as never;
const simGet = (url: string) => SIM_GET(new Request(new URL(url, "http://localhost")), simCtx(url));
const simPut = (url: string, body: string) => SIM_PUT(new Request(new URL(url, "http://localhost"), { method: "PUT", body, headers: { "content-type": "text/plain" } }), simCtx(url));
const newBucket = async (name = "my-files", access: "private" | "public" = "private", planId = "st-20") => call<string>("storage.create", { name, planId, access });

describe("SigV4", () => {
  const c = { accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
  const now = new Date("2013-05-24T00:00:00Z");
  it("matches the AWS presigned URL example", () => {
    const url = presign(c, { method: "GET", origin: "https://examplebucket.s3.amazonaws.com", path: "/test.txt", expires: 86400, now });
    expect(new URL(url).searchParams.get("X-Amz-Signature")).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });
  it("matches the AWS GET Object header example", () => {
    const r = signRequest(c, { method: "GET", origin: "https://examplebucket.s3.amazonaws.com", path: "/test.txt", headers: { range: "bytes=0-9" }, now });
    expect(r.headers.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(r.url).toBe("https://examplebucket.s3.amazonaws.com/test.txt");
  });
  it("encrypts MinIO admin payloads in the madmin/sio format", () => {
    const out = encryptAdmin("root-secret", JSON.stringify({ secretKey: "abc", status: "enabled" }));
    const salt = out.subarray(0, 32), nonce = out.subarray(33, 41), body = out.subarray(41);
    expect(out[32]).toBe(0x02);
    const key = pbkdf2Sync("root-secret", salt, 8192, 32, "sha256");
    const iv = (n: number) => Buffer.concat([nonce, Buffer.from([n, 0, 0, 0])]);
    const c0 = createCipheriv("aes-256-gcm", key, iv(0)); // the stream's bound associated data
    c0.final();
    const d = createDecipheriv("aes-256-gcm", key, iv(1));
    d.setAAD(Buffer.concat([Buffer.from([0x80]), c0.getAuthTag()]));
    d.setAuthTag(body.subarray(body.length - 16));
    expect(JSON.parse(Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]).toString())).toEqual({ secretKey: "abc", status: "enabled" });
  });
  it("makes Prometheus bearer tokens", () => {
    const [h, p] = prometheusToken("admin", "secret").split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "HS512", typ: "JWT" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({ sub: "admin", iss: "prometheus" });
  });
});

describe("S3 documents", () => {
  it("scopes key policies to the granted buckets", () => {
    const p = keyPolicy([{ bucket: "a", perm: "read" }, { bucket: "b", perm: "write" }]);
    expect(JSON.stringify(p)).toContain("arn:aws:s3:::a/*");
    expect(p.Statement[2]).toMatchObject({ Action: expect.arrayContaining(["s3:PutObject"]), Resource: ["arn:aws:s3:::b/*"] });
    expect(keyPolicy([]).Statement[0]).toMatchObject({ Effect: "Deny" });
    expect(bucketPolicy("x", "private", false)).toBeNull();
    expect(bucketPolicy("x", "public", true)!.Statement[0]).toMatchObject({ Effect: "Deny" });
    expect(lifecycleXml({ days: 30, prefix: "logs/" }, true)).toContain("<Prefix>logs/</Prefix><\/Filter><Expiration><Days>30</Days>");
    expect(corsXml([{ origins: ["https://a.ir"], methods: ["GET"], headers: ["*"], maxAge: 60 }])).toContain("<AllowedOrigin>https://a.ir</AllowedOrigin><AllowedMethod>GET</AllowedMethod>");
  });
  it("parses listings and bucket metrics", () => {
    const l = parseList("<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok</NextContinuationToken><Contents><Key>a/b &amp; c.txt</Key><LastModified>2026-01-01T00:00:00Z</LastModified><ETag>&quot;e1&quot;</ETag><Size>12</Size></Contents><CommonPrefixes><Prefix>a/d/</Prefix></CommonPrefixes></ListBucketResult>");
    expect(l).toEqual({ folders: ["a/d/"], objects: [{ key: "a/b & c.txt", size: 12, modified: "2026-01-01T00:00:00Z", etag: "e1" }], next: "tok" });
    const m = parseBucketMetrics('minio_bucket_requests_total{api="getobject",bucket="x",server="s"} 5\nminio_bucket_requests_total{api="putobject",bucket="x",server="s"} 2\nminio_bucket_traffic_sent_bytes{bucket="x",server="s"} 1.5e3\n# HELP x\n');
    expect(m.get("x")).toEqual({ requests: 7, bytesIn: 0, bytesOut: 1500 });
  });
  it("names and snippets", () => {
    expect(bucketNameError("ok-name")).toBeNull();
    for (const bad of ["ab", "Upper", "-x-y", "a--b", "gereh-files", "admin", "1.2.3.4"]) expect(bucketNameError(bad)).not.toBeNull();
    for (const s of SDKS) expect(snippet(s.id, { endpoint: "https://s3.example", region: "r1", bucket: "bk" })).toContain("bk");
  });
});

describe("buckets", () => {
  it("create validates, needs credit, is unique and shows in the panel state", async () => {
    await asUser();
    expect(await fails("storage.create", { name: "Bad_Name", planId: "st-20" })).toContain("نام باکت");
    expect(await fails("storage.create", { name: "nope-plan", planId: "st-x" })).toContain("پلن");
    const id = await newBucket();
    expect(SimulatorDriver.buckets.get("my-files")!.cfg).toMatchObject({ quotaBytes: 20 * 1024 ** 3, access: "private", suspended: false });
    expect(await fails("storage.create", { name: "my-files", planId: "st-20" })).toContain("گرفته شده");
    const s = await state();
    expect(s.buckets.map((b) => b.id)).toEqual([id]);
    expect(s.buckets[0]).toMatchObject({ name: "my-files", hourly: Math.ceil(59_000 / 720), cname: "my-files.storage.gereh.net" });
    expect(s.plans).toHaveLength(7);
    await (await db()).update(users).set({ balance: 100 }).where(eq(users.id, "u1"));
    expect(await fails("storage.create", { name: "poor-bucket", planId: "st-20" })).toContain("موجودی");
  });

  it("other customers cannot touch a bucket", async () => {
    await asUser();
    const id = await newBucket();
    await login("kaveh@gereh.net"); // another account
    expect(await fails("storage.objects", id, "", null)).toContain("پیدا نشد");
    expect(await fails("storage.remove", id, "my-files")).toContain("پیدا نشد");
    expect((await state()).buckets).toEqual([]);
  });

  it("plans can only be upgraded", async () => {
    await asUser();
    const id = await newBucket("grow", "private", "st-40");
    expect(await fails("storage.changePlan", id, "st-20")).toContain("فقط ارتقا");
    await call("storage.changePlan", id, "st-160");
    expect(SimulatorDriver.buckets.get("grow")!.cfg.quotaBytes).toBe(160 * 1024 ** 3);
  });

  it("settings: access, versioning, CORS and lifecycle reach the backend", async () => {
    await asUser();
    const id = await newBucket();
    await call("storage.setAccess", id, "public");
    await call("storage.setVersioning", id, true);
    expect(await fails("storage.setCors", id, [{ origins: ["ftp://x"], methods: ["GET"] }])).toContain("Origin");
    expect(await call("storage.setCors", id, [{ origins: ["https://shop.ir", "*"], methods: ["GET", "PUT", "GET"] }])).toEqual({ corsApplied: true });
    await call("storage.setLifecycle", id, { days: 30, prefix: "logs/" });
    expect(SimulatorDriver.buckets.get("my-files")!.cfg).toMatchObject({ access: "public", versioning: true, lifecycle: { days: 30, prefix: "logs/" }, cors: [{ origins: ["https://shop.ir", "*"], methods: ["GET", "PUT"], headers: ["*"], maxAge: 3600 }] });
    await call("storage.setLifecycle", id, null);
    expect(SimulatorDriver.buckets.get("my-files")!.cfg.lifecycle).toBeNull();
  });

  it("delete needs the exact name and drops grants from keys", async () => {
    await asUser();
    const id = await newBucket();
    const k = await call<{ id: string; accessKey: string }>("storage.createKey", { name: "ci", grants: [{ bucketId: id, perm: "write" }] });
    expect(await fails("storage.remove", id, "other")).toContain("نام باکت");
    await call("storage.remove", id, "my-files");
    expect(SimulatorDriver.buckets.has("my-files")).toBe(false);
    expect((await (await db()).select().from(storageKeys).where(eq(storageKeys.id, k.id)))[0].grants).toEqual([]);
    expect(SimulatorDriver.keys.get(k.accessKey)!.grants).toEqual([]);
  });
});

describe("access keys", () => {
  it("secret shown once, stored sealed; scope edit, regenerate and revoke", async () => {
    await asUser();
    const a = await newBucket("bucket-a"), b = await newBucket("bucket-b");
    const k = await call<{ id: string; accessKey: string; secretKey: string }>("storage.createKey", { name: "deploy", grants: [{ bucketId: a, perm: "read" }] });
    expect(k.accessKey).toMatch(/^GRH[A-Z0-9]{17}$/);
    expect(k.secretKey).toHaveLength(40);
    const [row] = await (await db()).select().from(storageKeys).where(eq(storageKeys.id, k.id));
    expect(row.secretEnc).not.toContain(k.secretKey);
    expect(open(row.secretEnc)).toBe(k.secretKey);
    expect(SimulatorDriver.keys.get(k.accessKey)).toEqual({ accessKey: k.accessKey, secretKey: k.secretKey, grants: [{ bucket: "bucket-a", perm: "read" }] });
    expect(JSON.stringify(await state())).not.toContain(k.secretKey);

    await call("storage.updateKey", k.id, { grants: [{ bucketId: a, perm: "write" }, { bucketId: b, perm: "read" }] });
    expect(SimulatorDriver.keys.get(k.accessKey)!.grants).toEqual([{ bucket: "bucket-a", perm: "write" }, { bucket: "bucket-b", perm: "read" }]);
    expect(await fails("storage.updateKey", k.id, { grants: [{ bucketId: "bkt-nothere", perm: "read" }] })).toContain("پیدا نشد");

    const r = await call<{ secretKey: string }>("storage.regenerateKey", k.id);
    expect(r.secretKey).not.toBe(k.secretKey);
    expect(SimulatorDriver.keys.get(k.accessKey)!.secretKey).toBe(r.secretKey);

    await call("storage.revokeKey", k.id);
    expect(SimulatorDriver.keys.has(k.accessKey)).toBe(false);
    expect((await state()).keys).toEqual([]);
  });
});

describe("file browser", () => {
  it("folders, presigned upload, listing, rename, share, public URL and delete", async () => {
    await asUser();
    const id = await newBucket();
    expect(await call("storage.mkdir", id, "", "docs")).toBe("docs/");
    expect(await fails("storage.mkdir", id, "", "a/b")).toContain("/");
    const up = await call<{ url: string }>("storage.uploadUrl", id, "docs/سلام دنیا.txt", 5, "text/plain");
    expect((await simPut(up.url, "hello")).status).toBe(200);
    expect((await simPut(up.url.replace(/sig=[^&]+/, "sig=bad"), "x")).status).toBe(403);
    expect(await fails("storage.uploadUrl", id, "../etc", 1)).toContain("مسیر");

    const root = await call<{ folders: { prefix: string }[]; objects: unknown[] }>("storage.objects", id, "", null);
    expect(root.folders.map((f) => f.prefix)).toEqual(["docs/"]);
    const docs = await call<{ objects: { key: string; size: number; name: string }[] }>("storage.objects", id, "docs/", null);
    expect(docs.objects).toEqual([expect.objectContaining({ key: "docs/سلام دنیا.txt", name: "سلام دنیا.txt", size: 5 })]);

    expect(await call("storage.move", id, "docs/سلام دنیا.txt", "docs/hello.txt")).toBe(1);
    expect(await fails("storage.move", id, "docs/", "docs/inner/")).toContain("داخل خودش");
    await call("storage.move", id, "docs/", "files/");
    const share = await call<{ url: string }>("storage.share", id, "files/hello.txt", 3600);
    const got = await simGet(share.url);
    expect(got.status).toBe(200);
    expect(await got.text()).toBe("hello");
    const dl = await call<string>("storage.downloadUrl", id, "files/hello.txt");
    expect((await simGet(dl)).headers.get("content-disposition")).toContain("hello.txt");

    // permanent public URL only while the bucket is public
    const pub = "/api/storage/sim/my-files/files/hello.txt";
    expect((await simGet(pub)).status).toBe(403);
    await call("storage.setAccess", id, "public");
    expect((await simGet(pub)).status).toBe(200);

    expect(await call("storage.deleteObjects", id, ["files/"])).toBe(2);
    expect((await call<{ folders: unknown[]; objects: unknown[] }>("storage.objects", id, "", null))).toMatchObject({ folders: [], objects: [] });
  });

  it("the plan quota stops uploads", async () => {
    await asUser();
    const id = await newBucket();
    await (await db()).update(storageBuckets).set({ usedBytes: 20 * 1024 ** 3 - 2 }).where(eq(storageBuckets.id, id));
    expect(await fails("storage.uploadUrl", id, "big.bin", 10)).toContain("فضای باکت");
  });
});

describe("billing, usage and domains", () => {
  it("bills hourly, suspends without credit and resumes after a top-up", async () => {
    await asUser();
    const id = await newBucket();
    const before = await balance();
    const d = await db();
    await storageBilling(d);
    expect(await balance()).toBe(before - Math.ceil(59_000 / 720));
    expect((await d.select().from(transactions).where(eq(transactions.userId, "u1"))).some((t) => t.desc.includes("فضای ذخیره‌سازی"))).toBe(true);

    await d.update(users).set({ balance: 10 }).where(eq(users.id, "u1"));
    await storageBilling(d);
    expect((await d.select().from(storageBuckets).where(eq(storageBuckets.id, id)))[0]).toMatchObject({ status: "suspended", suspendReason: "billing" });
    expect(SimulatorDriver.buckets.get("my-files")!.cfg.suspended).toBe(true);
    expect(await fails("storage.objects", id, "", null)).toContain("معلق");

    await d.update(users).set({ balance: 1_000_000 }).where(eq(users.id, "u1"));
    await storageBilling(d);
    expect((await d.select().from(storageBuckets).where(eq(storageBuckets.id, id)))[0].status).toBe("active");
    expect(SimulatorDriver.buckets.get("my-files")!.cfg.suspended).toBe(false);
  });

  it("staff suspensions are not lifted by a top-up", async () => {
    await asUser();
    const id = await newBucket();
    await asAdmin();
    await call("storage.adminSuspend", id, true);
    await storageBilling(await db());
    expect((await (await db()).select().from(storageBuckets).where(eq(storageBuckets.id, id)))[0].status).toBe("suspended");
    await call("storage.adminPlan", "st-20", { price: 69_000 });
    expect((await call<{ driver: string }>("storage.adminTest")).driver).toBe("simulator");
  });

  it("collects 7-day usage with counter deltas", async () => {
    await asUser();
    const id = await newBucket();
    await SimulatorDriver.buckets.get("my-files")!.objects.set("a.txt", { body: Buffer.from("12345"), type: "text/plain", modified: new Date(), etag: "x" });
    const sim = SimulatorDriver.buckets.get("my-files")!;
    sim.requests = 10; sim.bytesOut = 100;
    const d = await db();
    await storageCollect(d);
    sim.requests = 15; sim.bytesOut = 160;
    await storageCollect(d);
    const [u] = await d.select().from(storageUsage).where(eq(storageUsage.bucketId, id));
    expect(u).toMatchObject({ sizeBytes: 5, objects: 1, requests: 15, bytesOut: 160 });
    expect((await state()).buckets[0]).toMatchObject({ usedBytes: 5, objects: 1, usage: [expect.objectContaining({ requests: 15 })] });
  });

  it("custom domains activate once the CNAME points at the bucket", async () => {
    await asUser();
    const id = await newBucket();
    expect(await fails("storage.addDomain", id, "not a domain")).toContain("دامنه");
    const did = await call<string>("storage.addDomain", id, "https://cdn.shop.ir/");
    expect((await state()).buckets[0].domains[0]).toMatchObject({ host: "cdn.shop.ir", status: "pending" });
    setCnameResolver(async () => ["my-files.storage.gereh.net."]);
    expect(await call("storage.verifyDomain", id, did)).toEqual({ status: "active", ssl: "issued" });
    await call("storage.removeDomain", id, did);
    expect((await state()).buckets[0].domains).toEqual([]);
  });
});

describe("public API and MCP", () => {
  const req = (method: string, path: string, token: string, body?: unknown) => new Request("http://localhost/api/v1/" + path, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) }) as never;
  it("lists and creates buckets", async () => {
    await asUser();
    const t = await call<string>("account.createToken", { name: "ci", scope: "read-write", expires: "۹۰ روز" });
    const created = await API_POST(req("POST", "storage/buckets", t, { name: "api-bucket", plan: "st-40" }), ctx("storage/buckets"));
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ name: "api-bucket", size_gb: 40, access: "private" });
    const list = await (await API_GET(req("GET", "storage/buckets", t), ctx("storage/buckets"))).json();
    expect(list.data.map((b: { name: string }) => b.name)).toEqual(["api-bucket"]);
    expect(MCP_TOOLS.map((x) => x.name)).toEqual(expect.arrayContaining(["list_buckets", "create_bucket"]));
  });
});
