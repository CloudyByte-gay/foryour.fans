resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "foryour-fans"
  format        = "DOCKER"
  description   = "foryour.fans container images (api, api-migrate, web)"

  # Every push to main adds ~300 MB per image; storage past the 0.5 GB free
  # tier is billed. Keep the newest few versions of each image (enough to
  # roll back) and drop the rest.
  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "604800s" # 7 days
    }
  }

  depends_on = [google_project_service.services]
}
