# Keyless auth for GitHub Actions -> GCP via Workload Identity Federation.
#
# `.github/workflows/build.yml` exchanges the workflow's GitHub OIDC token for
# a short-lived access token for the `ffans-ci` service account, then builds
# and pushes the api / api-migrate / web images to Artifact Registry. No JSON
# service-account key is ever created or stored.
#
# Deliberately narrow: `ffans-ci` can push (and pull) images in the one
# Artifact Registry repo and nothing else. It cannot deploy Cloud Run, read
# secrets, or reach the database — releasing a build stays a human
# `terraform apply` with the new image tags (see docs/deployment-gcp.md).
#
# After `terraform apply`, run `terraform output github_actions_setup` and set
# the six values it prints on the GitHub repo (Settings -> Secrets and
# variables -> Actions).

locals {
  github_wif = var.enable_github_wif
}

resource "google_iam_workload_identity_pool" "github" {
  count                     = local.github_wif ? 1 : 0
  workload_identity_pool_id = "${local.prefix}-github"
  display_name              = "GitHub Actions"
  description               = "OIDC federation for ${var.github_repo} CI"

  depends_on = [google_project_service.services]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  count                              = local.github_wif ? 1 : 0
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[0].workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Only tokens whose `repository` claim is exactly var.github_repo are
  # accepted at the STS exchange — a token from any other repo is rejected
  # before the service-account binding below is even consulted.
  attribute_condition = "assertion.repository == \"${var.github_repo}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "ci" {
  count        = local.github_wif ? 1 : 0
  account_id   = "${local.prefix}-ci"
  display_name = "foryour.fans GitHub Actions CI (build + push images)"

  depends_on = [google_project_service.services]
}

# Push + pull on the single image repo only.
resource "google_artifact_registry_repository_iam_member" "ci_writer" {
  count      = local.github_wif ? 1 : 0
  project    = var.project_id
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.ci[0].email}"
}

# Let workflows running in var.github_repo impersonate `ffans-ci`.
resource "google_service_account_iam_member" "ci_wif" {
  count              = local.github_wif ? 1 : 0
  service_account_id = google_service_account.ci[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[0].name}/attribute.repository/${var.github_repo}"
}
