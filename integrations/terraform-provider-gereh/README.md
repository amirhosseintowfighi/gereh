# Terraform provider for Gereh Cloud

Manages DNS records and reads cloud servers through the Gereh public API (`/api/v1`).

```hcl
provider "gereh" {
  # token = "grh_…"            # or GEREH_TOKEN
  # endpoint = "https://gereh.cloud"  # or GEREH_ENDPOINT
}
```

| Kind | Name | Notes |
|---|---|---|
| Resource | `gereh_dns_record` | `domain_id`, `type`, `name`, `value`, `ttl`, `priority`; import with `terraform import gereh_dns_record.x dom-501/r-abc123` |
| Data source | `gereh_server` | `id` → `ipv4`, `ipv6`, `status`, `cpu`, `ram_gb`, `disk_gb`, … |

See `examples/main.tf`. Create a **read-write** token in Panel › SSH و API.

## Development

```bash
go test ./... && go build -o terraform-provider-gereh .
```

For local use add a `dev_overrides` block for `gereh/gereh` in `~/.terraformrc` pointing at the build directory.
