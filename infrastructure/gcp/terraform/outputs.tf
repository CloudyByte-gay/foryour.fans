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
  description = "DNS records to add at your registrar for the custom domain (empty unless var.domain is set)."
  value       = try(google_cloud_run_domain_mapping.web[0].status[0].resource_records, null)
}
