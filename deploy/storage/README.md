# Object Storage (فضای ذخیره‌سازی ابری) on MinIO

The panel talks to MinIO with the S3 API (SigV4) and the MinIO admin API. Without these env vars the
app uses the in-memory simulator (dev, CI, demos).

| Env | Example | Meaning |
| --- | --- | --- |
| `STORAGE_S3_ENDPOINT` | `http://minio.gereh-system:9000` | In-cluster URL the app uses (data path, admin API, metrics) |
| `STORAGE_S3_ACCESS_KEY` / `STORAGE_S3_SECRET_KEY` | from `minio-root` | Root user, or an admin user with `admin:*` and `s3:*` |
| `STORAGE_PUBLIC_ENDPOINT` | `https://storage.gereh.net` | URL customers' SDKs, presigned links and public objects use. Must reach the same MinIO **with the Host header preserved** (presigned signatures cover the host). |
| `STORAGE_REGION` | `us-east-1` | Must equal MinIO's `MINIO_SITE_REGION` (MinIO default `us-east-1`) |
| `STORAGE_CNAME_DOMAIN` | `storage.gereh.net` | Optional; custom domains CNAME to `<bucket>.<this>` (default: host of the public endpoint) |

## Cluster

`deploy/paas/minio.yaml` already runs MinIO for database backups. Customer buckets can share it
(bucket names starting with `gereh-` are reserved for the platform), but a separate MinIO deployment
for customer data is recommended so quotas and disk usage do not affect backups:

1. Copy `deploy/paas/minio.yaml` as `minio-storage` with its own PVC (size it for the plans you sell),
   and set these env vars on the container:
   - `MINIO_PROMETHEUS_AUTH_TYPE=jwt` (default; the app signs its own bearer token from the admin key)
   - `MINIO_API_CORS_ALLOW_ORIGIN=*` (MinIO answers CORS globally; per-bucket CORS rules are stored in
     the panel and applied only on backends that support `PutBucketCors`)
   - optionally `MINIO_SITE_REGION=<STORAGE_REGION>`
2. Expose port 9000 through the ingress at `storage.gereh.net` (TLS via the cluster issuer). Add
   `nginx.ingress.kubernetes.io/proxy-body-size: "0"` so large uploads are not cut.
3. Allow the app's namespace in the NetworkPolicy (`minio-from-jobs` style) so it reaches port 9000.
4. Set the env vars above on the app and use "تست اتصال" in `/admin/storage`.

## What the driver does

- Buckets: `PUT /<bucket>`; `DELETE /<bucket>` with `x-minio-force-delete: true` (removes contents).
- Plan size: admin `set-bucket-quota` (hard quota). Upgrades only raise it.
- Public/private: bucket policy (anonymous `s3:GetObject`); suspension (no credit or staff) replaces it
  with a deny-all policy. Root/admin requests still work, so the platform can resume.
- Versioning and lifecycle (`Expiration` + `NoncurrentVersionExpiration` after N days, optional prefix).
- Access keys: one MinIO user per key (`add-user`, payload encrypted like `madmin.EncryptData` with the
  PBKDF2/AES-GCM variant) and a canned policy `gereh-key-<accesskey>` listing the granted buckets
  (read: list/get; write: also put/delete/multipart) attached with `set-user-or-group-policy`.
  Regenerate re-runs `add-user` with a new secret; revoke removes the user and policy.
- Usage (hourly): admin `datausageinfo` (size, objects; refreshed by MinIO's scanner, so it lags) and
  `/minio/v2/metrics/bucket` (requests and traffic counters; deltas are stored per day).
- Uploads/downloads/share links in the panel: presigned URLs against `STORAGE_PUBLIC_ENDPOINT`.

## Not automated yet

- **Custom domains:** the panel verifies the CNAME (`<bucket>.<STORAGE_CNAME_DOMAIN>`) and reports SSL as
  issued once a TLS handshake to the host succeeds with a valid certificate. Routing the host to the
  bucket is not created by the app: add a wildcard DNS `*.storage.gereh.net` and, per verified domain,
  an Ingress for the host with a cert-manager certificate that rewrites `/(.*)` to `/<bucket>/$1`
  toward MinIO (or run MinIO with `MINIO_DOMAIN=storage.gereh.net` for virtual-host style).
- **Admin payload encryption** was implemented from the madmin/sio-go format without a live MinIO in
  CI. If `add-user` fails with a decryption error on your MinIO version, create keys with
  `mc admin user add` + `mc admin policy create/attach` using the same names, and report the version.
- Per-bucket CORS on MinIO (see above).
