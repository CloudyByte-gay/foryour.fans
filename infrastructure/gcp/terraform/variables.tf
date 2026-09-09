variable "project_id" {
  type        = string
  description = "GCP project ID to deploy into."
}

variable "region" {
  type        = string
  description = "Region for Cloud Run, Cloud SQL, Artifact Registry, and the GCS bucket. Use an always-free-tier region (us-central1 / us-east1 / us-west1) so the ingest e2-micro is free."
  default     = "us-central1"
}

variable "zone" {
  type        = string
  description = "Zone for the ingest Compute Engine VM."
  default     = "us-central1-b"
}

variable "name_prefix" {
  type        = string
  description = "Prefix for resource names."
  default     = "ffans"
}

variable "site_url" {
  type        = string
  description = "Public origin the web app is served from, e.g. https://foryour.fans. Used for PUBLIC_URL / CORS_ORIGIN / NEXT_PUBLIC_SITE_URL. Must be HTTPS and have no trailing slash."

  validation {
    condition     = can(regex("^https://[^/]+$", var.site_url))
    error_message = "site_url must be an https:// origin with no trailing slash."
  }
}

variable "domain" {
  type        = string
  description = "Optional. Custom domain to map to the web Cloud Run service (no scheme). Leave empty to skip domain mapping and use the run.app URL."
  default     = ""
}

# ---------------------------------------------------------------------------
# Container images. Build & push with infrastructure/gcp/cloudbuild.yaml
# (see docs/deployment-gcp.md, Step 6), then pass the tags here.
# ---------------------------------------------------------------------------

variable "deploy_services" {
  type        = bool
  description = "First apply on a brand-new project: set false so Terraform provisions the SA / registry / DB / secrets / bucket WITHOUT the Cloud Run services & ingest VM (whose images don't exist yet). Build & push the images, then set true and apply again."
  default     = true
}

variable "api_image" {
  type        = string
  description = "Full image ref for the apps/api runtime image (…/api:TAG). Required when deploy_services = true."
  default     = ""
}

variable "api_migrate_image" {
  type        = string
  description = "Full image ref for the apps/api migrate image (…/api:TAG-migrate). Required when deploy_services = true."
  default     = ""
}

variable "web_image" {
  type        = string
  description = "Full image ref for the apps/web image (…/web:TAG). Must have been built with --build-arg API_INTERNAL_URL set to the api service URL (see docs/deployment-gcp.md). Required when deploy_services = true."
  default     = ""
}

# ---------------------------------------------------------------------------
# External Redis (Upstash free tier, or any rediss:// endpoint). The Google
# provider can't create an Upstash DB; create it in the Upstash console and
# paste the URL here (or supply it via TF_VAR_redis_url).
# ---------------------------------------------------------------------------

variable "redis_url" {
  type        = string
  description = "redis:// or rediss:// connection URL for the API's session / OAuth-state / rate-limit store."
  sensitive   = true
}

variable "admin_dids" {
  type        = string
  description = "Comma-separated AT Protocol DIDs promoted to ADMIN on login. Empty = no admins."
  default     = ""
}

# ---------------------------------------------------------------------------
# Sizing — bump these as usage grows (see docs/deployment-gcp.md "Scaling").
# ---------------------------------------------------------------------------

variable "db_tier" {
  type        = string
  description = "Cloud SQL machine tier. db-f1-micro is the cheapest; db-g1-small / db-custom-N-M for growth."
  default     = "db-f1-micro"
}

variable "db_disk_size_gb" {
  type        = number
  description = "Cloud SQL data disk size in GB."
  default     = 10
}

variable "db_availability_type" {
  type        = string
  description = "ZONAL (cheapest, no failover) or REGIONAL (HA). Flip to REGIONAL at Stage 2."
  default     = "ZONAL"
}

variable "db_deletion_protection" {
  type        = bool
  description = "Block `terraform destroy` from deleting the database. Keep true outside throwaway environments."
  default     = true
}

variable "api_cpu" {
  type    = string
  default = "1"
}

variable "api_memory" {
  type    = string
  default = "512Mi"
}

variable "api_max_instances" {
  type        = number
  description = "MUST stay 1 until the in-process AT OAuth lock is replaced with a distributed lock (see docs/deployment-gcp.md constraint 2)."
  default     = 1
}

variable "api_min_instances" {
  type        = number
  description = "0 = scale to zero (cold starts). 1 to keep it warm."
  default     = 0
}

variable "web_cpu" {
  type    = string
  default = "1"
}

variable "web_memory" {
  type    = string
  default = "512Mi"
}

variable "web_max_instances" {
  type    = number
  default = 4
}

variable "web_min_instances" {
  type    = number
  default = 0
}

variable "ingest_machine_type" {
  type        = string
  description = "e2-micro is always-free-tier eligible in us-central1/us-east1/us-west1."
  default     = "e2-micro"
}

variable "jetstream_url" {
  type    = string
  default = "wss://jetstream.us-east.bsky.network/subscribe"
}

# ---------------------------------------------------------------------------
# Optional budget alert.
# ---------------------------------------------------------------------------

variable "billing_account" {
  type        = string
  description = "Billing account ID (e.g. 012345-6789AB-CDEF01) to attach a budget alert to. Empty = no budget resource."
  default     = ""
}

variable "budget_amount_usd" {
  type    = number
  default = 25
}

variable "budget_alert_emails" {
  type        = list(string)
  description = "Email addresses to notify on budget thresholds (via a Monitoring notification channel)."
  default     = []
}
