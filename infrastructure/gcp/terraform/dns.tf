# ---------------------------------------------------------------------------
# Cloudflare DNS for the web custom domain (var.domain).
#
# google_cloud_run_domain_mapping.web (cloudrun.tf) needs DNS records pointed
# at Google before it can verify the domain and issue a managed TLS cert.
# With manage_dns = true this writes those records into your Cloudflare zone
# so you don't have to copy them out of `terraform output web_domain_dns`.
#
# The targets are Google's fixed, documented values for Cloud Run / App
# Engine custom domains, so this plans in a single apply (it does not depend
# on the mapping's computed output):
#   apex:      A/AAAA -> 216.239.3x.21 / 2001:4860:4802:3x::15
#   subdomain: CNAME  -> ghs.googlehosted.com
#   https://cloud.google.com/run/docs/mapping-custom-domains#dns_update
#
# Keep cloudflare_proxied = false until the mapping reports
# CERTIFICATE_PROVISIONED — Cloud Run terminates its own TLS and the proxy
# blocks its domain-ownership check.
# ---------------------------------------------------------------------------

locals {
  # Zone apex; defaults to var.domain when it is itself the apex.
  dns_zone_apex = var.dns_zone != "" ? var.dns_zone : var.domain

  # Apex needs A/AAAA (Cloudflare can't CNAME a zone apex); a subdomain gets a
  # single CNAME. var.domain is already the FQDN of the record either way.
  domain_is_apex = var.domain == local.dns_zone_apex

  web_dns_records = local.domain_is_apex ? concat(
    [for ip in ["216.239.32.21", "216.239.34.21", "216.239.36.21", "216.239.38.21"] :
      { type = "A", content = ip }
    ],
    [for ip in ["2001:4860:4802:32::15", "2001:4860:4802:34::15", "2001:4860:4802:36::15", "2001:4860:4802:38::15"] :
      { type = "AAAA", content = ip }
    ],
    ) : [
    { type = "CNAME", content = "ghs.googlehosted.com" },
  ]

  manage_web_dns = var.manage_dns && var.domain != ""
}

resource "cloudflare_dns_record" "web" {
  for_each = local.manage_web_dns ? {
    for rec in local.web_dns_records : "${rec.type}-${rec.content}" => rec
  } : {}

  zone_id = var.cloudflare_zone_id
  name    = var.domain
  type    = each.value.type
  content = each.value.content
  ttl     = 1 # 1 = automatic; required to be 1 while proxied
  proxied = var.cloudflare_proxied
  comment = "Terraform: Cloud Run web domain mapping (${var.domain})"
}
