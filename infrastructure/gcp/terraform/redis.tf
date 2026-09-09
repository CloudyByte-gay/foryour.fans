# ---------------------------------------------------------------------------
# Redis for apps/api — sessions, AT OAuth state, and rate-limit counters
# (ioredis; the ingest worker does NOT use Redis).
#
# Two ways to satisfy the dependency, controlled by var.create_redis:
#
#   create_redis = true  (default) — Terraform provisions a Memorystore
#     instance on the default VPC's private range. Cloud Run reaches it over
#     the same PRIVATE_RANGES_ONLY egress it already uses for Cloud SQL, so
#     there is no manual console step and no public endpoint.
#
#   create_redis = false — no instance is created; you MUST supply an
#     external endpoint in var.redis_url (e.g. Upstash `rediss://…`). Use
#     this to stop the Memorystore spend when a deployment is idle — flip
#     the flag, `terraform apply`, and the instance is destroyed. (apps/api
#     cannot boot without *some* REDIS_URL: loadEnv() requires it and
#     /ready pings it — there is no "no Redis" mode.)
#
# Cost, cheapest possible config (BASIC tier, 1 GB, the floor):
#   ~$0.049/GB/hr ≈ $35/mo, us-central1, list price. Not free-tier.
#   Bump var.redis_tier to "STANDARD_HA" / var.redis_memory_size_gb for
#   growth — see docs/deployment-gcp.md "Scaling".
# ---------------------------------------------------------------------------

resource "google_redis_instance" "cache" {
  count = var.create_redis ? 1 : 0

  name           = "${local.prefix}-redis"
  region         = var.region
  tier           = var.redis_tier
  memory_size_gb = var.redis_memory_size_gb
  redis_version  = "REDIS_7_2"

  # Private RFC1918 IP on the default VPC; Google auto-allocates the /29 for
  # DIRECT_PEERING. Matches the Cloud SQL private-IP model in database.tf.
  authorized_network = data.google_compute_network.default.id
  connect_mode       = "DIRECT_PEERING"

  # No AUTH / no TLS: the instance is only routable from inside
  # authorized_network, and dropping both keeps REDIS_URL a plain
  # redis://host:port with nothing else to wire. Enable
  # auth_enabled + transit_encryption_mode = "SERVER_AUTHENTICATION" here
  # (and switch local.redis_url to rediss:// with .auth_string) if the
  # threat model needs defence-in-depth on the private range.
  auth_enabled            = false
  transit_encryption_mode = "DISABLED"

  lifecycle {
    precondition {
      condition     = var.create_redis != (var.redis_url != "")
      error_message = "Set exactly one Redis source: either create_redis = true (Terraform provisions Memorystore) OR create_redis = false with a non-empty redis_url (external endpoint). Not both, not neither."
    }
  }

  depends_on = [google_project_service.services]
}

locals {
  # What actually lands in the ffans-redis-url secret (see secrets.tf).
  redis_url = var.create_redis ? "redis://${google_redis_instance.cache[0].host}:${google_redis_instance.cache[0].port}" : var.redis_url
}
