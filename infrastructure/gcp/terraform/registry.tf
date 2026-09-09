resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "foryour-fans"
  format        = "DOCKER"
  description   = "foryour.fans container images (api, api-migrate, web)"

  depends_on = [google_project_service.services]
}
