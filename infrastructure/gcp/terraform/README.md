# Terraform — GCP / Cloud Run deployment

Provisions everything in [`docs/deployment-gcp.md`](../../../docs/deployment-gcp.md)
that is declarative infrastructure:

| File | Resources |
|---|---|
| `main.tf` | Enabled project APIs; the invariant API env config |
| `iam.tf` | `ffans-run` runtime service account + project roles (`cloudsql.client`, `artifactregistry.reader`) |
| `registry.tf` | Artifact Registry Docker repo |
| `storage.tf` | Private media bucket, CORS, lifecycle rule, HMAC key (= S3 creds), bucket IAM |
| `database.tf` | Cloud SQL Postgres 16 (private IP only), database, user, generated password; builds private-IP `DATABASE_URL` forms |
| `redis.tf` | Memorystore Redis on the private VPC (default), or falls back to an external `redis_url` when `create_redis = false` |
| `secrets.tf` | Secret Manager secrets + versions + per-secret accessor bindings; generates the AT OAuth EC P-256 key |
| `cloudrun.tf` | `api` + `web` Cloud Run v2 services (public), the `migrate` job, optional custom-domain mapping |
| `ingest.tf` | `e2-micro` Container-Optimized OS VM running the Cloud SQL proxy + the ingest worker container |
| `monitoring.tf` | Optional budget alert (`billing_account` set) |
| `outputs.tf` | URLs, registry prefix, DB connection name, DNS records, etc. |

**Not** in Terraform (genuinely imperative — see the deployment doc):
building & pushing the three container images (`infrastructure/gcp/cloudbuild.yaml`),
executing the migration job, and DNS record creation at your registrar.
(Redis is now in Terraform — `redis.tf` provisions Memorystore by default;
set `create_redis = false` + `redis_url` to use an external one.)

## Usage

```bash
cd infrastructure/gcp/terraform
cp terraform.tfvars.example terraform.tfvars   # edit it
terraform init

# Pass 1 — infra only (images don't exist yet)
terraform apply -var deploy_services=false

# Build & push images with the registry prefix Terraform just created:
#   terraform output -raw artifact_registry
# (see docs/deployment-gcp.md Step 6). Then get the api URL for the web build:
#   the api service isn't created yet, so first do a targeted apply:
terraform apply -var deploy_services=true \
  -var api_image=<AR>/api:TAG -var api_migrate_image=<AR>/api:TAG-migrate \
  -var web_image=<AR>/web:PLACEHOLDER \
  -target=google_cloud_run_v2_service.api
terraform output -raw api_url        # build the web image with this as API_INTERNAL_URL

# Pass 2 — everything, with the real web image
terraform apply -var deploy_services=true \
  -var api_image=<AR>/api:TAG \
  -var api_migrate_image=<AR>/api:TAG-migrate \
  -var web_image=<AR>/web:TAG

# Run migrations (once per release carrying a new migration)
gcloud run jobs execute $(terraform output -raw migrate_job_name) --region <region> --wait
```

Put the `-var` image refs in `terraform.tfvars` instead of the command line
once you have them, so later releases are just `terraform apply` after
bumping the tags.

## Releases

1. Build & push new image tags.
2. `terraform apply` with the new `api_image` / `web_image` / `api_migrate_image`.
3. If the release adds a migration, run the migrate job (above) **before**
   the apply routes traffic — or split: apply the job image, run it, then
   apply the services.
4. The ingest VM only re-reads its image on reboot:
   `gcloud compute instances reset $(terraform output -raw ingest_vm) --zone <zone>`.

## State

Use a remote backend for anything shared — uncomment the `backend "gcs"`
block in `versions.tf` and `terraform init -migrate-state`. State contains
the DB password and HMAC secret; treat the bucket as sensitive.

## Status

This module has **not** been `terraform apply`-ed against a real GCP project
yet — same disclaimer as the rest of the deployment docs. Treat the first
real `plan`/`apply` as the actual first test. The COS startup script
(`ingest-startup.sh.tftpl`) parses Secret Manager JSON with `sed`/`base64`
and is the most environment-specific part; verify it on the first boot
(`sudo journalctl -u google-startup-scripts`).
