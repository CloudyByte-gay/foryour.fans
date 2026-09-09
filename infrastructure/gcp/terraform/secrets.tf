# AT OAuth private_key_jwt signing key: EC P-256, PKCS#8 PEM — the format
# JoseKey.fromImportable() in packages/atproto/src/oauthClient.ts expects.
resource "tls_private_key" "oauth" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

locals {
  secret_values = {
    "database-url"         = local.database_url_private
    "database-url-proxy"   = local.database_url_proxy
    "redis-url"            = var.redis_url
    "oauth-signing-key"    = tls_private_key.oauth.private_key_pem_pkcs8
    "s3-access-key-id"     = google_storage_hmac_key.runtime.access_id
    "s3-secret-access-key" = google_storage_hmac_key.runtime.secret
    "admin-dids"           = var.admin_dids
  }
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.secret_values
  secret_id = "${local.prefix}-${each.key}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "app" {
  for_each    = local.secret_values
  secret      = google_secret_manager_secret.app[each.key].id
  secret_data = each.value
}

# The runtime SA may read each secret. Per-secret rather than a project-wide
# grant, so the identity can only see these seven.
resource "google_secret_manager_secret_iam_member" "runtime_accessor" {
  for_each  = local.secret_values
  secret_id = google_secret_manager_secret.app[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
