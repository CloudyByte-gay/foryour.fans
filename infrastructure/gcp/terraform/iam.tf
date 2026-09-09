# One least-privilege runtime identity shared by the api + web Cloud Run
# services, the migrate job, and the ingest VM. It gets:
#   - roles/cloudsql.client         (connect to Cloud SQL)
#   - roles/secretmanager.secretAccessor  (per-secret, in secrets.tf)
#   - roles/storage.objectAdmin     (on the media bucket only, in storage.tf)
#   - roles/artifactregistry.reader (pull images — needed by the ingest VM)
resource "google_service_account" "runtime" {
  account_id   = "${local.prefix}-run"
  display_name = "foryour.fans runtime (Cloud Run + ingest VM)"

  depends_on = [google_project_service.services]
}

resource "google_project_iam_member" "runtime_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_artifactregistry_reader" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}
