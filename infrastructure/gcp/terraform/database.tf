# ---------------------------------------------------------------------------
# PostgreSQL. Two homes, switched by three variables so the move between
# them is a staged, data-preserving cutover (docs/deployment-gcp.md,
# "Moving Postgres onto the ingest VM"):
#
#   cloud_sql_enabled — the managed Cloud SQL instance below exists.
#   vm_postgres       — a postgres:16 container runs on the ingest e2-micro
#                       (ingest.tf), its data on a separate persistent disk
#                       that survives VM replacement.
#   database_host     — "cloudsql" | "vm": which one DATABASE_URL points at.
#
# Cloud SQL has no free tier (~$10/mo for db-f1-micro); the VM option rides
# the always-free e2-micro + 30 GB standard PD, so it costs only snapshot
# storage. Trade-off: no managed HA/patching, and daily disk snapshots
# instead of Cloud SQL backups.
# ---------------------------------------------------------------------------

resource "random_password" "db" {
  length  = 32
  special = false # keep it URL-safe so DATABASE_URL needs no percent-encoding
}

moved {
  from = google_sql_database_instance.main
  to   = google_sql_database_instance.main[0]
}

moved {
  from = google_sql_database.app
  to   = google_sql_database.app[0]
}

moved {
  from = google_sql_user.app
  to   = google_sql_user.app[0]
}

resource "google_sql_database_instance" "main" {
  count            = var.cloud_sql_enabled ? 1 : 0
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
  count    = var.cloud_sql_enabled ? 1 : 0
  name     = local.db_name
  instance = google_sql_database_instance.main[0].name
}

resource "google_sql_user" "app" {
  count    = var.cloud_sql_enabled ? 1 : 0
  name     = local.db_user
  instance = google_sql_database_instance.main[0].name
  password = random_password.db.result
}

# ---------------------------------------------------------------------------
# VM-hosted Postgres: data disk, stable internal IP, daily snapshots, and a
# firewall rule scoped to the subnet Cloud Run's Direct VPC egress uses. The
# container itself is started by ingest-startup.sh.tftpl.
# ---------------------------------------------------------------------------

resource "google_compute_disk" "pgdata" {
  count = var.vm_postgres ? 1 : 0
  name  = "${local.prefix}-pgdata"
  zone  = var.zone
  type  = "pd-standard" # always-free: 30 GB standard PD, incl. the 10 GB boot disk
  size  = var.vm_postgres_disk_size_gb

  depends_on = [google_project_service.services]
}

resource "google_compute_resource_policy" "pgdata_snapshots" {
  count  = var.vm_postgres ? 1 : 0
  name   = "${local.prefix}-pgdata-daily"
  region = var.region

  snapshot_schedule_policy {
    schedule {
      daily_schedule {
        days_in_cycle = 1
        start_time    = "08:00"
      }
    }
    retention_policy {
      max_retention_days    = 7
      on_source_disk_delete = "KEEP_AUTO_SNAPSHOTS"
    }
    snapshot_properties {
      storage_locations = [var.region]
    }
  }
}

resource "google_compute_disk_resource_policy_attachment" "pgdata_snapshots" {
  count = var.vm_postgres ? 1 : 0
  name  = google_compute_resource_policy.pgdata_snapshots[0].name
  disk  = google_compute_disk.pgdata[0].name
  zone  = var.zone
}

# Reserved so DATABASE_URL stays valid when the VM is replaced (any change to
# the startup script replaces it).
resource "google_compute_address" "ingest_internal" {
  count        = var.vm_postgres ? 1 : 0
  name         = "${local.prefix}-ingest-internal"
  region       = var.region
  address_type = "INTERNAL"
  subnetwork   = data.google_compute_subnetwork.default.id
}

resource "google_compute_firewall" "postgres_from_subnet" {
  count     = var.vm_postgres ? 1 : 0
  name      = "${local.prefix}-allow-postgres"
  network   = data.google_compute_network.default.name
  direction = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["5432"]
  }

  source_ranges = [data.google_compute_subnetwork.default.ip_cidr_range]
  target_tags   = [local.db_vm_tag]
}

# Plan-time guard for the cutover flags (variable validations can't
# cross-reference other variables on terraform < 1.9).
resource "terraform_data" "database_flags_check" {
  lifecycle {
    precondition {
      condition     = var.database_host != "cloudsql" || var.cloud_sql_enabled
      error_message = "database_host = \"cloudsql\" needs cloud_sql_enabled = true."
    }
    precondition {
      condition     = var.database_host != "vm" || var.vm_postgres
      error_message = "database_host = \"vm\" needs vm_postgres = true."
    }
    precondition {
      condition     = !var.vm_postgres || var.deploy_services
      error_message = "vm_postgres = true needs deploy_services = true (Postgres runs on the ingest VM)."
    }
  }
}

locals {
  db_user   = "ffans"
  db_name   = "foryour_fans"
  db_vm_tag = "${local.prefix}-postgres"

  db_conn  = var.cloud_sql_enabled ? google_sql_database_instance.main[0].connection_name : ""
  db_vm_ip = var.vm_postgres ? google_compute_address.ingest_internal[0].address : ""

  db_private_host = (
    var.database_host == "vm" ? local.db_vm_ip :
    var.cloud_sql_enabled ? google_sql_database_instance.main[0].private_ip_address : ""
  )

  # Cloud Run: direct TCP to the database's private address through VPC egress.
  database_url_private = "postgresql://${local.db_user}:${random_password.db.result}@${local.db_private_host}:5432/${local.db_name}?sslmode=disable"

  # Ingest VM: localhost — the cloud-sql-proxy while database_host =
  # "cloudsql", the co-located Postgres container once it's "vm".
  database_url_proxy = "postgresql://${local.db_user}:${random_password.db.result}@127.0.0.1:5432/${local.db_name}?sslmode=disable"
}
