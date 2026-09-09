resource "random_password" "db" {
  length  = 32
  special = false # keep it URL-safe so DATABASE_URL needs no percent-encoding
}

resource "google_sql_database_instance" "main" {
  name             = "${local.prefix}-pg"
  region           = var.region
  database_version = "POSTGRES_16"

  deletion_protection = var.db_deletion_protection

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = var.db_availability_type
    disk_type         = "PD_HDD" # cheapest; switch to PD_SSD for IOPS at scale
    disk_size         = var.db_disk_size_gb
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      start_time                     = "08:00"
      point_in_time_recovery_enabled = false
      backup_retention_settings {
        retained_backups = 7
      }
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = data.google_compute_network.default.id
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "off"
    }
  }

  depends_on = [
    google_project_service.services,
    google_service_networking_connection.private_vpc_connection,
  ]
}

resource "google_sql_database" "app" {
  name     = "foryour_fans"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = "ffans"
  instance = google_sql_database_instance.main.name
  password = random_password.db.result
}

locals {
  db_conn = google_sql_database_instance.main.connection_name

  # Cloud Run: direct TCP to the instance's private address through VPC egress.
  database_url_private = "postgresql://${google_sql_user.app.name}:${random_password.db.result}@${google_sql_database_instance.main.private_ip_address}:5432/${google_sql_database.app.name}?sslmode=disable"

  # Ingest VM: TCP via a local cloud-sql-proxy using the private IP.
  database_url_proxy = "postgresql://${google_sql_user.app.name}:${random_password.db.result}@127.0.0.1:5432/${google_sql_database.app.name}?sslmode=disable"
}
