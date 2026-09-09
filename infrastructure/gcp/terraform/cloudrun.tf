locals {
  # env var name -> Secret Manager secret_id
  api_secret_env = {
    DATABASE_URL              = google_secret_manager_secret.app["database-url"].secret_id
    REDIS_URL                 = google_secret_manager_secret.app["redis-url"].secret_id
    ATPROTO_OAUTH_PRIVATE_KEY = google_secret_manager_secret.app["oauth-signing-key"].secret_id
    S3_ACCESS_KEY_ID          = google_secret_manager_secret.app["s3-access-key-id"].secret_id
    S3_SECRET_ACCESS_KEY      = google_secret_manager_secret.app["s3-secret-access-key"].secret_id
    ADMIN_DIDS                = google_secret_manager_secret.app["admin-dids"].secret_id
  }
}

# ---------------------------------------------------------------------------
# apps/api — Fastify HTTP server. MUST stay single-instance (var.api_max_instances)
# until the in-process AT OAuth lock is distributed. Publicly invocable: the
# web server proxies /api/* to it and can't attach an ID token via the
# built-in Next.js rewrite (see docs/deployment-gcp.md, Step 8).
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "api" {
  count               = var.deploy_services ? 1 : 0
  name                = "${local.prefix}-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account                  = google_service_account.runtime.email
    max_instance_request_concurrency = 80
    timeout                          = "60s"

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    containers {
      image = var.api_image

      ports {
        container_port = 4000
      }

      resources {
        limits = {
          cpu    = var.api_cpu
          memory = var.api_memory
        }
      }

      dynamic "env" {
        for_each = local.api_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.api_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/health"
          port = 4000
        }
        initial_delay_seconds = 5
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 6
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.db_conn]
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime_accessor]
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  count    = var.deploy_services ? 1 : 0
  location = var.region
  name     = google_cloud_run_v2_service.api[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# apps/web — Next.js standalone server. API_INTERNAL_URL is ALSO baked into
# the image at build time (var.web_image must have been built with
# --build-arg API_INTERNAL_URL = this same URL). Setting it here too keeps
# lib/serverApi.ts's runtime read consistent. See docs/deployment-gcp.md.
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "web" {
  count               = var.deploy_services ? 1 : 0
  name                = "${local.prefix}-web"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account                  = google_service_account.runtime.email
    max_instance_request_concurrency = 80
    timeout                          = "60s"

    scaling {
      min_instance_count = var.web_min_instances
      max_instance_count = var.web_max_instances
    }

    containers {
      image = var.web_image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = var.web_cpu
          memory = var.web_memory
        }
      }

      env {
        name  = "NODE_ENV"
        value = "development"
      }
      env {
        name  = "API_INTERNAL_URL"
        value = google_cloud_run_v2_service.api[0].uri
      }
      env {
        name  = "NEXT_PUBLIC_SITE_URL"
        value = var.site_url
      }

      startup_probe {
        http_get {
          path = "/healthz"
          port = 3000
        }
        initial_delay_seconds = 5
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 6
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "web_public" {
  count    = var.deploy_services ? 1 : 0
  location = var.region
  name     = google_cloud_run_v2_service.web[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# One-off migration job — `prisma migrate deploy`. Run it once per release
# that carries a new migration, BEFORE routing traffic to the new revision:
#   gcloud run jobs execute ffans-migrate --region <region> --wait
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_job" "migrate" {
  count    = var.deploy_services ? 1 : 0
  name     = "${local.prefix}-migrate"
  location = var.region

  template {
    template {
      service_account = google_service_account.runtime.email
      max_retries     = 1
      timeout         = "600s"

      containers {
        image   = var.api_migrate_image
        command = ["pnpm"]
        args    = ["exec", "prisma", "migrate", "deploy"]

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["database-url"].secret_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.db_conn]
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime_accessor]
}

# ---------------------------------------------------------------------------
# Optional: map a custom domain to the web service (free; no load balancer).
# Add the DNS records from `terraform output web_domain_dns` at your registrar.
# ---------------------------------------------------------------------------
resource "google_cloud_run_domain_mapping" "web" {
  count    = var.deploy_services && var.domain != "" ? 1 : 0
  provider = google-beta
  location = var.region
  name     = var.domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.web[0].name
  }
}
