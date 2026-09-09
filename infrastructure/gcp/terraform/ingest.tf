# The Jetstream ingest worker. Exactly one always-on consumer, by design
# (N copies would each re-consume the whole firehose — see
# apps/api/src/ingest.ts). An e2-micro in an always-free-tier region is
# $0 for the instance. It serves no HTTP, so it can't be a Cloud Run
# service without a code change; a VM is the cheapest home.
resource "google_compute_instance" "ingest" {
  count        = var.deploy_services ? 1 : 0
  name         = "${local.prefix}-ingest"
  machine_type = var.ingest_machine_type
  zone         = var.zone

  boot_disk {
    initialize_params {
      image = "cos-cloud/cos-stable"
      size  = 10
      type  = "pd-standard"
    }
  }

  network_interface {
    network = "default"
    # Ephemeral external IP — needed for outbound to Jetstream, Secret
    # Manager, and Artifact Registry without a Cloud NAT.
    access_config {}
  }

  service_account {
    email  = google_service_account.runtime.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    google-logging-enabled    = "true"
    google-monitoring-enabled = "true"
  }

  metadata_startup_script = templatefile("${path.module}/ingest-startup.sh.tftpl", {
    region        = var.region
    project_id    = var.project_id
    secret_id     = google_secret_manager_secret.app["database-url-proxy"].secret_id
    db_conn       = local.db_conn
    api_image     = var.api_image
    jetstream_url = var.jetstream_url
  })

  # Compute Engine only runs the startup script at boot. After a release
  # that changes var.api_image, `terraform apply` updates the metadata but
  # the worker keeps running the old image until the VM reboots — force it:
  #   gcloud compute instances reset ${local.prefix}-ingest --zone ${var.zone}
  # or recreate the VM:
  #   terraform apply -replace='google_compute_instance.ingest[0]'

  allow_stopping_for_update = true

  depends_on = [google_secret_manager_secret_iam_member.runtime_accessor]
}
