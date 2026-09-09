# Private bucket for media bytes, reached over the S3-compatible XML API
# (S3ObjectStorage in packages/media) with an HMAC key.
resource "google_storage_bucket" "media" {
  name     = "${var.project_id}-${local.prefix}-media"
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  cors {
    origin          = [var.site_url]
    method          = ["GET", "PUT", "HEAD"]
    response_header = ["Content-Type", "Content-MD5", "ETag", "x-goog-resumable"]
    max_age_seconds = 3600
  }

  # Stop paying for multipart uploads a client started and abandoned.
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "AbortIncompleteMultipartUpload"
    }
  }

  depends_on = [google_project_service.services]
}

resource "google_storage_bucket_iam_member" "runtime_object_admin" {
  bucket = google_storage_bucket.media.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

# HMAC key = the S3 access key id / secret. The secret is only ever
# available at creation time; it is written straight into Secret Manager
# (secrets.tf) and surfaced nowhere else.
resource "google_storage_hmac_key" "runtime" {
  service_account_email = google_service_account.runtime.email

  depends_on = [google_project_service.services]
}
