output "artifact_registry" {
  description = "Docker repo prefix — tag images as <this>/api:TAG, <this>/web:TAG."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "runtime_service_account" {
  description = "Service account the Cloud Run services / job / ingest VM run as."
  value       = google_service_account.runtime.email
}

output "media_bucket" {
  value = google_storage_bucket.media.name
}

output "redis_host" {
  description = "Memorystore private endpoint (host:port), or null when create_redis = false."
  value       = var.create_redis ? "${google_redis_instance.cache[0].host}:${google_redis_instance.cache[0].port}" : null
}

output "db_connection_name" {
  description = "Cloud SQL connection name (PROJECT:REGION:INSTANCE)."
  value       = google_sql_database_instance.main.connection_name
}

output "api_url" {
  description = "api Cloud Run URL. Build the web image with --build-arg API_INTERNAL_URL set to this before setting var.web_image."
  value       = try(google_cloud_run_v2_service.api[0].uri, null)
}

output "web_url" {
  description = "web Cloud Run URL."
  value       = try(google_cloud_run_v2_service.web[0].uri, null)
}

output "migrate_job_name" {
  description = "Run with: gcloud run jobs execute <this> --region <region> --wait"
  value       = try(google_cloud_run_v2_job.migrate[0].name, null)
}

output "ingest_vm" {
  value = try(google_compute_instance.ingest[0].name, null)
}

output "web_domain_dns" {
  description = "DNS records the custom domain needs (empty unless var.domain is set). Add these at your DNS host manually — OR set manage_dns = true to have Terraform write them into Cloudflare (see dns.tf)."
  value       = try(google_cloud_run_domain_mapping.web[0].status[0].resource_records, null)
}

output "cloudflare_dns_records" {
  description = "Custom-domain records Terraform manages in Cloudflare (empty unless manage_dns = true)."
  value       = [for r in cloudflare_dns_record.web : "${r.type} ${r.name} -> ${r.content}"]
}

output "github_actions_setup" {
  description = <<-EOT
    Set these on the GitHub repo (Settings -> Secrets and variables -> Actions)
    to enable .github/workflows/build.yml. GCP_PROVIDER / GCP_SA_EMAIL are
    secrets; the rest are variables. Null unless enable_github_wif = true.
    API_INTERNAL_URL is blank until the api service exists (first deploy) —
    set it after, so the web image is built against the real api URL.
  EOT
  value = var.enable_github_wif ? {
    GCP_PROVIDER     = google_iam_workload_identity_pool_provider.github[0].name
    GCP_SA_EMAIL     = google_service_account.ci[0].email
    GCP_REGION       = var.region
    AR_REPO          = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
    SITE_URL         = var.site_url
    API_INTERNAL_URL = try(google_cloud_run_v2_service.api[0].uri, "")
  } : null
}

output "lexicon_authority_dns_records" {
  description = "fans.foryour.* Lexicon authority TXT records Terraform manages (empty unless manage_lexicon_authority_dns = true). See docs/lexicon-authority.md."
  value       = [for r in cloudflare_dns_record.lexicon_authority : "${r.type} ${r.name} -> ${r.content}"]
}
