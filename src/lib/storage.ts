/* Object Storage (فضای ذخیره‌سازی ابری): rules and copy shared by the panel and the server. */

export type StoragePlan = { id: string; name: string; sizeGb: number; price: number; active: boolean };

/* Seven sizes, doubling, priced under Iranian competitors' S3 offers (≈3k Toman/GB/month at 20 GB,
   falling to ≈2k at 1 TB). Traffic and requests are included. */
export const STORAGE_PLAN_DEFAULTS: StoragePlan[] = [
  { id: "st-20", name: "۲۰ گیگ", sizeGb: 20, price: 59_000, active: true },
  { id: "st-40", name: "۴۰ گیگ", sizeGb: 40, price: 109_000, active: true },
  { id: "st-80", name: "۸۰ گیگ", sizeGb: 80, price: 199_000, active: true },
  { id: "st-160", name: "۱۶۰ گیگ", sizeGb: 160, price: 379_000, active: true },
  { id: "st-320", name: "۳۲۰ گیگ", sizeGb: 320, price: 729_000, active: true },
  { id: "st-640", name: "۶۴۰ گیگ", sizeGb: 640, price: 1_390_000, active: true },
  { id: "st-1280", name: "۱٫۲۸ ترابایت", sizeGb: 1280, price: 2_690_000, active: true },
];

/** S3 bucket naming (DNS-compatible): 3–63 lowercase letters, digits and hyphens */
export const BUCKET_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
export const BUCKET_RESERVED = new Set(["minio", "admin", "api", "www", "gereh", "static", "assets", "backup", "backups", "gereh-backups", "storage", "console", "metrics", "public", "private"]);

export function bucketNameError(name: string): string | null {
  if (!BUCKET_RE.test(name)) return "نام باکت فقط حروف کوچک انگلیسی، عدد و خط تیره؛ ۳ تا ۶۳ نویسه و بدون خط تیره در ابتدا و انتها.";
  if (name.includes("--")) return "دو خط تیره پشت سر هم مجاز نیست.";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name) || /^xn--/.test(name) || /-s3alias$/.test(name)) return "این الگوی نام مجاز نیست.";
  if (BUCKET_RESERVED.has(name) || name.startsWith("gereh-")) return "این نام رزرو شده است.";
  return null;
}

/** object keys: 1–1024 bytes, no control characters, no "." / ".." segments */
export function keyError(key: string): string | null {
  if (!key || new TextEncoder().encode(key).length > 1024) return "نام فایل باید ۱ تا ۱۰۲۴ بایت باشد.";
  if (/[\u0000-\u001f\u007f\\]/.test(key)) return "نام فایل نویسه نامعتبر دارد.";
  if (key.startsWith("/") || key.split("/").some((s, i, a) => s === "." || s === ".." || (s === "" && i < a.length - 1))) return "مسیر فایل نامعتبر است.";
  return null;
}
/** folder prefixes end with "/" ("" is the bucket root) */
export const prefixError = (p: string) => (p === "" ? null : !p.endsWith("/") ? "مسیر پوشه باید با / تمام شود." : keyError(p));

export const CORS_METHODS = ["GET", "PUT", "POST", "DELETE", "HEAD"] as const;
export const MAX_CORS_RULES = 10;
export const SHARE_TTLS: { value: number; label: string }[] = [
  { value: 3600, label: "۱ ساعت" }, { value: 6 * 3600, label: "۶ ساعت" }, { value: 86400, label: "۱ روز" }, { value: 3 * 86400, label: "۳ روز" }, { value: 7 * 86400, label: "۷ روز" },
];
export const MAX_SHARE_TTL = 7 * 86400; // SigV4 presigned URLs are valid for at most 7 days
export const MAX_KEYS_PER_USER = 20;
export const MAX_BUCKETS_PER_USER = 30;

export const BUCKET_STATUS: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]> = {
  active: ["فعال", "green"], suspended: ["معلق", "red"],
};
export const DOMAIN_STATUS: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]> = {
  pending: ["در انتظار CNAME", "amber"], active: ["متصل", "green"], failed: ["ناموفق", "red"],
};
export const SSL_STATUS: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]> = {
  pending: ["در حال صدور", "amber"], issued: ["صادر شد", "green"], failed: ["خطا", "red"],
};

export function bytes(n: number): string {
  const u = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت", "ترابایت"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString("fa-IR") + " " + u[i];
}
export const GB = 1024 ** 3;

/** the last path segment of a key or folder prefix */
export const baseName = (key: string) => key.replace(/\/$/, "").split("/").pop() ?? key;
/** "a/b/c.txt" → ["a/", "a/b/"] */
export const crumbs = (prefix: string) => prefix.split("/").filter(Boolean).map((_, i, a) => a.slice(0, i + 1).join("/") + "/");

/* ---------- connection snippets ---------- */
export type Conn = { endpoint: string; region: string; bucket: string; accessKey?: string; secretKey?: string };
export const SDKS = [
  { id: "node", label: "Node.js" }, { id: "python", label: "Python" }, { id: "laravel", label: "PHP / Laravel" },
  { id: "go", label: "Go" }, { id: "rclone", label: "rclone" }, { id: "awscli", label: "aws-cli" },
] as const;
export type SdkId = (typeof SDKS)[number]["id"];

export function snippet(sdk: SdkId, c: Conn): string {
  const ak = c.accessKey || "YOUR_ACCESS_KEY", sk = c.secretKey || "YOUR_SECRET_KEY";
  const host = c.endpoint.replace(/^https?:\/\//, "");
  switch (sdk) {
    case "node": return `// npm i @aws-sdk/client-s3
import { S3Client, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: "${c.endpoint}",
  region: "${c.region}",
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? "${ak}", secretAccessKey: process.env.S3_SECRET_KEY ?? "${sk}" },
});

await s3.send(new PutObjectCommand({ Bucket: "${c.bucket}", Key: "hello.txt", Body: "سلام" }));
const { Contents } = await s3.send(new ListObjectsV2Command({ Bucket: "${c.bucket}" }));
console.log(Contents?.map((o) => o.Key));`;
    case "python": return `# pip install boto3
import boto3
from botocore.client import Config

s3 = boto3.client(
    "s3",
    endpoint_url="${c.endpoint}",
    region_name="${c.region}",
    aws_access_key_id="${ak}",
    aws_secret_access_key="${sk}",
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)

s3.upload_file("photo.jpg", "${c.bucket}", "images/photo.jpg")
for obj in s3.list_objects_v2(Bucket="${c.bucket}").get("Contents", []):
    print(obj["Key"], obj["Size"])`;
    case "laravel": return `# composer require league/flysystem-aws-s3-v3 "^3.0"
# .env
FILESYSTEM_DISK=s3
AWS_ACCESS_KEY_ID=${ak}
AWS_SECRET_ACCESS_KEY=${sk}
AWS_DEFAULT_REGION=${c.region}
AWS_BUCKET=${c.bucket}
AWS_ENDPOINT=${c.endpoint}
AWS_USE_PATH_STYLE_ENDPOINT=true

// usage
use Illuminate\\Support\\Facades\\Storage;
Storage::disk('s3')->put('avatars/1.jpg', $contents);
$url = Storage::disk('s3')->temporaryUrl('avatars/1.jpg', now()->addMinutes(10));`;
    case "go": return `// go get github.com/minio/minio-go/v7
package main

import (
	"context"
	"log"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func main() {
	client, err := minio.New("${host}", &minio.Options{
		Creds:  credentials.NewStaticV4("${ak}", "${sk}", ""),
		Secure: ${c.endpoint.startsWith("https") ? "true" : "false"},
		Region: "${c.region}",
	})
	if err != nil {
		log.Fatal(err)
	}
	info, err := client.FPutObject(context.Background(), "${c.bucket}", "backup.tar.gz", "./backup.tar.gz", minio.PutObjectOptions{})
	if err != nil {
		log.Fatal(err)
	}
	log.Println("uploaded", info.Key, info.Size)
}`;
    case "rclone": return `# ~/.config/rclone/rclone.conf
[gereh]
type = s3
provider = Minio
access_key_id = ${ak}
secret_access_key = ${sk}
endpoint = ${c.endpoint}
region = ${c.region}

# usage
rclone ls gereh:${c.bucket}
rclone sync ./site gereh:${c.bucket}/site --progress`;
    case "awscli": return `aws configure set aws_access_key_id ${ak} --profile gereh
aws configure set aws_secret_access_key ${sk} --profile gereh
aws configure set region ${c.region} --profile gereh

aws --profile gereh --endpoint-url ${c.endpoint} s3 ls s3://${c.bucket}/
aws --profile gereh --endpoint-url ${c.endpoint} s3 cp ./file.zip s3://${c.bucket}/file.zip
aws --profile gereh --endpoint-url ${c.endpoint} s3 presign s3://${c.bucket}/file.zip --expires-in 3600`;
  }
}
