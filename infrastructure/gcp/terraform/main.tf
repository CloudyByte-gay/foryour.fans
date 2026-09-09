locals {
  prefix = var.name_prefix

  # Env-invariant application config for the API. Secrets are wired
  # separately (see secrets.tf). NODE_ENV is "development" on purpose:
  # apps/api/src/config/env.ts refuses NODE_ENV=production while the only
  # PAYMENT_PROVIDER/PAYOUT_PROVIDER value is "fake" — see
  # docs/deployment-gcp.md, "Before you start".
  api_env = {
    NODE_ENV  = "development"
    LOG_LEVEL = "info"
    HOST      = "0.0.0.0"
    # PORT is injected automatically by Cloud Run (from ports.container_port
    # in cloudrun.tf) and is rejected if set explicitly on a v2 service.
    PUBLIC_URL                          = var.site_url
    CORS_ORIGIN                         = var.site_url
    ATPROTO_OAUTH_MODE                  = "hosted"
    ALLOW_FAKE_WEBHOOKS                 = "false"
    PAYMENT_PROVIDER                    = "fake"
    PAYOUT_PROVIDER                     = "fake"
    CREATOR_OWNED_PDS_ENABLED           = "false"
    CREATOR_OWNED_GATED_CONTENT_ENABLED = "false"
    S3_ENDPOINT                         = "https://storage.googleapis.com"
    S3_REGION                           = "auto"
    S3_BUCKET                           = google_storage_bucket.media.name
    S3_FORCE_PATH_STYLE                 = "true"
  }
}

# APIs this stack needs. disable_on_destroy = false so a `terraform destroy`
# of the app doesn't yank APIs another workload in the project may use.
resource "google_project_service" "services" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "servicenetworking.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "monitoring.googleapis.com",
    "billingbudgets.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}
