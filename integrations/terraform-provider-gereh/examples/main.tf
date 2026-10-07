terraform {
  required_providers {
    gereh = { source = "gereh/gereh" }
  }
}

# token from Panel › SSH و API (read-write); or export GEREH_TOKEN
provider "gereh" {}

data "gereh_server" "web" {
  id = "srv-1042"
}

resource "gereh_dns_record" "api" {
  domain_id = "dom-501"
  type      = "A"
  name      = "api"
  value     = data.gereh_server.web.ipv4
  ttl       = 300
}
