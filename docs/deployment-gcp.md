# Deploying to Google Cloud (Cloud Run)

This is an operational how-to for running `foryour.fans` on Google Cloud
using **Cloud Run** for the application tiers plus managed GCP services for
everything else. It is the GCP counterpart to
`infrastructure/kubernetes/README.md` (which describes the same system on
Kubernetes) and follows the same honesty rule: where something is a
trade-off or a known gap, it says so.

It is written to **start cheap and scale up in place**: the step-by-step
build lands the lowest-cost viable footprint (~$12–18/mo), and
**[Scaling as usage grows](#scaling-as-usage-grows)** is the graduation
path — same architecture, bigger knobs — from launch through meaningful
traffic without a re-platform.

**Infrastructure as code.** Everything declarative is Terraform
(`infrastructure/gcp/terraform/` — see its README). The numbered `gcloud`
steps below double as the manual fallback and as an explanation of each
resource; building/pushing images, running the migration job, and creating
DNS records stay imperative either way.

If you just want the short version, read **[TL;DR](#tldr)**,
**[Before you start](#before-you-start-hard-constraints)**,
**[Cost](#cost-estimate)**, and **[Scaling](#scaling-as-usage-grows)**,
then work top-to-bottom through **[Step 0](#step-0--project-and-apis)**
onward.

---

## Architecture on GCP

```
                        ┌───────────────────────────────────────────┐
   browser ──HTTPS──▶   │  Cloud Run: web  (Next.js standalone)      │
                        │  - scale to zero, max 4                    │
                        │  - proxies /api/* server-side to  ┐        │
                        └───────────────────────────────────┼────────┘
                                                            │ HTTPS (run.app URL)
                        ┌───────────────────────────────────▼────────┐
                        │  Cloud Run: api  (Fastify)                 │
                        │  - scale to zero, MAX 1 (see constraints)  │
                        │  - Cloud SQL connector (unix socket)       │
                        │  - Secret Manager for all secrets          │
                        └───┬─────────────┬───────────────┬──────────┘
                            │             │               │
              ┌─────────────▼──┐  ┌───────▼───────┐  ┌────▼─────────────────┐
              │ Cloud SQL      │  │ Redis         │  │ Cloud Storage bucket │
              │ PostgreSQL 16  │  │ (Upstash free │  │ (S3-compatible XML   │
              │ db-f1-micro    │  │  tier, or     │  │  API + HMAC key)     │
              │                │  │  Memorystore) │  │  private media       │
              └────────▲───────┘  └───────────────┘  └──────────────────────┘
                       │
              ┌────────┴───────────────────────────────────────────────────┐
              │ Compute Engine e2-micro VM  (always-free tier)             │
              │  - runs the Jetstream ingest worker (dist/ingest.js)       │
              │    as the api container with an overridden command         │
              │  - runs cloud-sql-proxy for its DB connection              │
              └───────────────────────────────────────────────────────────┘

  external, free:  Jetstream firehose (wss://jetstream.us-east.bsky.network)
```

### Why three compute pieces, not one

| Piece | What it is | Why it can't merge with the others |
|---|---|---|
| **web** | `apps/web`, Next.js `output: "standalone"` server on `$PORT` | Separate Node server from the API; only ever talks to the API over HTTP. |
| **api** | `apps/api` Fastify server, `dist/server.js` | The HTTP request surface. Stateless except for its DB/Redis/storage deps. |
| **ingest** | `apps/api` `dist/ingest.js` | A long-lived Jetstream **WebSocket** consumer. It must be exactly **one** always-on process — N copies would each re-consume the whole firehose and race to write the same index (`apps/api/src/ingest.ts` header comment). It also serves **no HTTP**, so it cannot be a normal Cloud Run service (Cloud Run kills a container that doesn't listen on `$PORT`). |

The ingest worker is the one component that must never scale to zero. On
GCP the cheapest home for it is a **Compute Engine `e2-micro`**, which is
free under the [always-free tier](https://cloud.google.com/free/docs/free-cloud-features#compute)
in `us-central1`, `us-east1`, or `us-west1`. (Alternative: a Cloud Run
[worker pool](https://cloud.google.com/run/docs/deploy-worker-pools), or a
Cloud Run service after adding a tiny `$PORT` health listener to
`ingest.ts` — see [Ingest alternatives](#ingest-alternatives).)

---

## TL;DR

Provisioning is **Terraform** (`infrastructure/gcp/terraform/`); only image
builds, the migration run, and DNS stay imperative.

```bash
cd infrastructure/gcp/terraform
cp terraform.tfvars.example terraform.tfvars   # project_id, site_url, redis_url, …
terraform init

terraform apply -var deploy_services=false     # SA, registry, bucket+HMAC, Cloud SQL, secrets
#   -> build & push 3 images to the registry Terraform made               (Step 6)
terraform apply -target=google_cloud_run_v2_service.api -var deploy_services=true \
  -var api_image=… -var api_migrate_image=… -var web_image=…placeholder…
#   -> terraform output -raw api_url  →  build the web image with it baked in
terraform apply -var deploy_services=true -var api_image=… -var api_migrate_image=… -var web_image=…

gcloud run jobs execute "$(terraform output -raw migrate_job_name)" --region "$REGION" --wait
# add the DNS records from `terraform output web_domain_dns`, then wire OAuth (Step 12)
```

Redeploys after that: build & push new tags → `terraform apply` with the
new image vars (+ run the migration job when a release carries a migration;
`gcloud compute instances reset` the ingest VM to pick up its new image).

The `gcloud`/`gsutil` commands in Steps 1–5 and 8–12 are the **manual
equivalent** of what Terraform does — read them to understand the resources,
or follow them if you're not using Terraform.

---

## Before you start — hard constraints

These are enforced by the app itself. Ignoring them means a crash loop, not
a subtle bug.

### 1. You cannot run `NODE_ENV=production` yet

`apps/api/src/config/env.ts` refuses to boot when `NODE_ENV=production` and
`PAYMENT_PROVIDER`/`PAYOUT_PROVIDER` are `fake` — and `fake` is the only
value that exists, because no real adult-content-compatible payment
processor has been selected (`docs/production-readiness.md`). There is **no
override**, by design.

So this deployment runs with **`NODE_ENV=development`** — the same choice
`infrastructure/kubernetes/overlays/staging` makes, and for the same
reason. It is a real, internet-reachable, HTTPS deployment with hosted AT
OAuth and real infrastructure; it just can't move real money. When a
payment provider is implemented and the enum in `config/env.ts` grows, flip
to `NODE_ENV=production` and re-check this section.

Consequences of `NODE_ENV=development` on a public host:

- **Set `ALLOW_FAKE_WEBHOOKS=false`.** Otherwise `POST /webhooks/fake` is an
  unauthenticated subscription-status mutation endpoint
  (`apps/api/src/config/env.ts`, `security-hardening.md` §2).
- The web CSP is slightly looser (`'unsafe-eval'` for React Refresh is
  *not* added unless `NODE_ENV` is literally `development` **and** it's
  `next dev` — the standalone production build never includes it, so this
  is fine). HSTS is only emitted when `NODE_ENV=production`; put HSTS on
  your CDN/proxy if you want it now.
- Keep `CREATOR_OWNED_PDS_ENABLED=false` and
  `CREATOR_OWNED_GATED_CONTENT_ENABLED=false` (defaults). The gated-content
  path is not production-safe (`docs/creator-owned-pds.md`).

### 2. The `api` service must run as a single instance

`packages/atproto/src/oauthClient.ts` uses an **in-process** request lock
(`requestLocalLock`). Its own comment: *"only correct for a single API
replica … must replace this with a distributed lock (e.g. Redlock over
Redis) before scaling apps/api horizontally."* Until that lands, deploy
`api` with **`--max-instances=1`**. Convenient for cost; not optional for
correctness.

### 3. Two `web` env vars are baked in at **build** time

`apps/web` inlines these at `next build` and cannot be changed on the
running container (`apps/web/next.config.mjs` and
`infrastructure/docker/web.Dockerfile` both document this):

- `NEXT_PUBLIC_SITE_URL` — your public site origin, e.g. `https://foryour.fans`.
- `API_INTERNAL_URL` — where the web server proxies `/api/*`. On GCP this is
  the **api Cloud Run URL** (or its custom domain). It is baked into the
  static routes manifest; setting it only as a runtime env var will *not*
  change the `/api/*` proxy target.

  > `apps/web/lib/serverApi.ts` reads `API_INTERNAL_URL` live at request
  > time, so it must *also* be present as a runtime env var on the web
  > service — set it in **both** places, to the **same** value.

This forces the deploy order: **create `api` first, capture its URL, then
build `web` with that URL.** Cloud Run service URLs are stable for the life
of the service, so this only bites on first deploy.

### 4. Client rate-limiting is degraded behind the Next.js proxy

The browser only ever talks to the `web` origin; `web` proxies `/api/*`
server-side. Next.js's proxy does **not** forward the client IP, so
`apps/api`'s Redis-backed rate limiter (`@fastify/rate-limit`, keyed on
`request.ip`) sees the **web service's egress IP for every user** — the
per-IP limits (global 300/min, sign-in-start 10/min) become effectively
site-wide.

Leave `TRUSTED_PROXIES` **unset** (trusting a forwarded chain you can't
verify is worse). Mitigations, cheapest first:

- **Accept it for now** and raise the limits if the shared bucket is too
  tight. Safe; no spend. Document it as a known limitation.
- **Put Cloudflare (free) in front** as the single hostname: route `/api/*`
  straight to the api service and everything else to web. The api then sees
  Cloudflare's `X-Forwarded-For` with the real client appended; set
  `TRUSTED_PROXIES` to [Cloudflare's IP ranges](https://www.cloudflare.com/ips/).
- **Global external Application Load Balancer** with path routing
  (`/api/*` → api serverless NEG, `/*` → web serverless NEG). Correct
  client IPs, but ~\$18/mo for the forwarding rule — skip unless you need
  it for other reasons.

---

## Cost estimate

Region `us-central1`, low traffic (a few thousand requests/day, tens of GB
of media). Rough monthly USD.

### Tier A — recommended low-cost

| Service | Config | ~ / mo |
|---|---|---|
| Cloud Run `web` | scale-to-zero, 512 MiB, max 4 | **\$0** (free tier: 2M req, 360k GiB-s, 180k vCPU-s) |
| Cloud Run `api` | scale-to-zero, 512 MiB, **max 1** | **\$0–2** |
| Compute Engine `e2-micro` (ingest) | always-free region, 30 GB standard PD | **\$0** (always-free tier) + egress |
| Cloud SQL PostgreSQL | `db-f1-micro`, 10 GB HDD, 7-day backups | **\$9–11** (no free tier for Cloud SQL) |
| Redis | **Upstash** free tier (`rediss://`, 10k cmd/day) | **\$0** |
| Cloud Storage | Standard, ~20 GB + light ops | **< \$1** |
| Artifact Registry | 3 images, a few GB | **< \$0.50** |
| Secret Manager | ~8 secrets | **< \$0.50** (6 free, then \$0.06/version) |
| Cloud Build | within 2,500 free build-min/mo | **\$0** |
| Egress / misc | | **\$1–3** |
| **Total** | | **≈ \$12–18 / mo** |

### Tier B — all-Google, fully managed

Swap Upstash for **Memorystore for Redis** Basic M1 (1 GB, the floor):
**+~\$35/mo**, and it needs a **Serverless VPC Access connector**
(**+~\$8–14/mo** for the connector's `e2-micro` backers) for Cloud Run to
reach it. Total **≈ \$55–70 / mo**. Only choose this if an external Redis
vendor is a compliance non-starter.

### Tier C — rock-bottom

Move PostgreSQL onto the same `e2-micro` VM (Postgres in a container, on the
always-free instance) and keep Redis on Upstash free. Cloud SQL cost → \$0.
Total **≈ \$2–6 / mo** (egress + registry + secrets). Trade-off: you own
backups, patching, and a single point of failure with no HA. Fine for a
pre-revenue staging system; revisit before launch.

### Keep it from surprising you

```bash
# hard ceilings so a traffic spike can't run up a bill
gcloud run services update web --max-instances=4
gcloud run services update api --max-instances=1

# budget alert at $25/mo (needs the billing account id)
gcloud billing budgets create \
  --billing-account=BILLING_ACCOUNT_ID \
  --display-name="foryour-fans" \
  --budget-amount=25USD \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

---

## Scaling as usage grows

The architecture does not change as you grow — you turn knobs and swap a
managed tier for a bigger one. Nothing below is a re-platform. Work down
the stages as real metrics (not guesses) tell you a tier is the
bottleneck.

Most Stage 1 knobs are already Terraform variables (`api_min_instances`,
`web_max_instances`, `db_tier`, `db_availability_type`, `api_cpu`, …) — a
scale-up is an edit to `terraform.tfvars` and an `apply`. Stage 2+ adds new
resources (load balancer, Cloud Armor, read replicas, Memorystore); add
them to the module as you reach them.

### The one code change that gates horizontal API scale

`apps/api` runs **single-instance** today because the AT OAuth client uses
an in-process lock (`requestLocalLock` in
`packages/atproto/src/oauthClient.ts` — its own comment says so). Until
that is swapped for a **distributed lock (Redlock over Redis)**, the `api`
service must stay at `--max-instances=1` and can only scale **vertically**
(more CPU/memory, higher `--concurrency`). A single Cloud Run instance at
`--cpu=4 --memory=2Gi --concurrency=200` handles a lot of a JSON API's
load, so this is not urgent at launch — but it is the first thing to fix
when the single instance saturates. Once the lock is distributed, `api`
scales exactly like `web` below.

`web` and the ingest worker need **no** code change to scale — `web` is
already stateless and horizontal; ingest is deliberately single-consumer
(see [its row](#why-three-compute-pieces-not-one)) and scales vertically.

### Stage 1 — remove cold starts, raise ceilings (still cheap)

| Component | Change | Effect / ~cost delta |
| --- | --- | --- |
| Cloud Run `web` | `--min-instances=1`, `--max-instances=20`, `--cpu=1 --memory=1Gi` | No cold starts; ~$6–13/mo for the warm instance |
| Cloud Run `api` | `--min-instances=1`, `--cpu=2 --memory=1Gi`, `--concurrency=120` (stays `--max-instances=1`) | No cold starts; headroom on the single instance; ~$12–25/mo |
| Cloud SQL | `db-f1-micro` → `db-g1-small`, `--storage-auto-increase`, keep 7-day backups | ~$25–35/mo; more RAM for cache/connections |
| Redis | Upstash free → Upstash paid (pay-as-you-go) | single-digit $/mo |
| Prisma | Add `?connection_limit=10&pool_timeout=20` to `DATABASE_URL` | bounds pool per instance so more instances don't exhaust Postgres |
| Observability | Enable Cloud Trace; scrape `/metrics` with Managed Service for Prometheus; wire the `ErrorReporter` seam (`apps/api/src/errorReporting.ts`) to Error Reporting | ~$0 at low volume |

### Stage 2 — real traffic: edge, HA database, distributed API

- **Global external Application Load Balancer** in front of both services
  (serverless NEGs: `/api/*` → `api`, `/*` → `web`), with **Cloud CDN** for
  `web`'s static assets and **Cloud Armor** for WAF + edge rate limiting +
  L3/4 DDoS. ~$18/mo for the LB + Armor/CDN usage. This also **fixes
  [constraint 4](#4-client-rate-limiting-is-degraded-behind-the-nextjs-proxy)**:
  the LB gives the API a trustworthy `X-Forwarded-For`, so set
  `TRUSTED_PROXIES` to [Google's LB ranges](https://cloud.google.com/load-balancing/docs/https#firewall-rules)
  (`35.191.0.0/16`, `130.211.0.0/22`) and real per-client rate limiting
  comes back — plus Cloud Armor rate rules run before a request ever
  reaches Cloud Run.
- **Distribute the OAuth lock** (see above), then `api`:
  `--min-instances=2 --max-instances=50 --concurrency=80`. Now both app
  tiers autoscale on request load.
- **Cloud SQL** → dedicated-core (`db-custom-2-7680` and up), **enable HA**
  (`--availability-type=REGIONAL`), add **read replicas** and point
  read-heavy paths (feed, discovery, dashboard) at them. Turn on
  **Cloud SQL connection pooling** (managed PgBouncer) — essential once
  many Cloud Run instances each hold a pool. Bump SSD storage/IOPS.
  Roughly $150–400/mo depending on size and HA.
- **Redis** → **Memorystore Standard** (HA, read replicas). Cloud Run
  reaches it over **Direct VPC egress** (GA — no Serverless VPC connector
  to run or pay for). ~$50–150/mo.
- **Media delivery** → front the GCS bucket with **Cloud CDN** using
  signed URLs / signed cookies so hot media is served from the edge, not
  re-fetched from the bucket each view. GCS itself needs no change — it is
  already effectively unbounded.
- **Ingest VM** → `e2-micro` → `e2-small` → `e2-medium`, or move it to a
  Cloud Run **worker pool** with `--cpu=2`. Keep it at exactly one
  consumer. If firehose volume itself becomes the limit, shard by
  collection or by DID-hash across N workers — future work, not a config
  change.

### Stage 3 — scale-out and multi-region (only if you need it)

- **CI/CD**: Cloud Build triggers → **Cloud Deploy** with Cloud Run canary
  (traffic splitting: `gcloud run services update-traffic --to-revisions=NEW=10`).
- **Multi-region**: deploy `web`/`api` to a second region behind the same
  global LB (it routes to the nearest healthy backend); Cloud SQL
  cross-region read replicas; promote on regional failure. Ingest stays
  single-region (one consumer).
- **Postgres ceiling**: if a single primary is the limit, **AlloyDB**
  (Postgres-compatible, read pool nodes, columnar engine) is the drop-in
  next step — connection string change only. Partition the largest tables
  (`Post`, `PaymentEvent`, indexed-* discovery tables) by time before this
  becomes urgent.
- **Rate-limit counters / sessions**: Memorystore Cluster (sharded) if a
  single Redis Standard node saturates.

### What never needs re-architecting to scale

Cloud Storage (media bytes), Artifact Registry, Secret Manager, Cloud
Build, the migration job, and the `web` tier are all either
auto-scaling or trivially horizontal already. The only genuine scaling
prerequisite in the whole system is the distributed OAuth lock.

---

## Placeholders used below

```bash
export PROJECT=your-gcp-project
export REGION=us-central1                 # an always-free-tier region for the VM
export AR=$REGION-docker.pkg.dev/$PROJECT/foryour-fans
export SITE_URL=https://foryour.fans      # your real public origin
export DB_INSTANCE=ffans-pg
export DB_NAME=foryour_fans
export DB_USER=ffans
export BUCKET=$PROJECT-ffans-media
```

---

## Step 0 — project and APIs

> **Terraform** does all of this (`google_project_service` in `main.tf`,
> `google_service_account.runtime` + role bindings in `iam.tf`). You still
> need `gcloud config set project` and application-default credentials
> (`gcloud auth application-default login`) for Terraform to authenticate.

```bash
gcloud config set project $PROJECT

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  compute.googleapis.com \
  storage.googleapis.com
```

Create a dedicated runtime service account for the Cloud Run services
(least privilege — don't use the default compute SA):

```bash
gcloud iam service-accounts create ffans-run --display-name="foryour.fans Cloud Run"
export RUN_SA=ffans-run@$PROJECT.iam.gserviceaccount.com

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$RUN_SA" --role="roles/cloudsql.client"
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$RUN_SA" --role="roles/secretmanager.secretAccessor"
```

---

## Step 1 — Artifact Registry

> **Terraform:** `google_artifact_registry_repository.images` (`registry.tf`).
> `terraform output -raw artifact_registry` prints the tag prefix.

```bash
gcloud artifacts repositories create foryour-fans \
  --repository-format=docker --location=$REGION \
  --description="foryour.fans container images"

gcloud auth configure-docker $REGION-docker.pkg.dev   # only if you build locally
```

---

## Step 2 — Cloud Storage bucket (S3-compatible)

> **Terraform:** `storage.tf` — bucket (uniform access, public-access
> prevention, CORS from `var.site_url`, abandoned-upload lifecycle rule),
> the HMAC key (its secret goes straight into Secret Manager), and the
> bucket `objectAdmin` binding for the runtime SA.

`packages/media`'s `S3ObjectStorage` speaks the S3 API via
`@aws-sdk/client-s3`. GCS exposes an
[S3-compatible XML API](https://cloud.google.com/storage/docs/aws-simple-migration)
with **HMAC keys**, so only the `S3_*` env vars change.

```bash
# private bucket, uniform access, in the same region as Cloud Run
gcloud storage buckets create gs://$BUCKET \
  --location=$REGION --uniform-bucket-level-access --public-access-prevention

# an HMAC key belongs to a service account — reuse the runtime SA
gcloud storage hmac create $RUN_SA
#  -> prints  Access ID  (S3_ACCESS_KEY_ID)  and  Secret  (S3_SECRET_ACCESS_KEY) ONCE

# the SA needs object read/write on the bucket
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member="serviceAccount:$RUN_SA" --role="roles/storage.objectAdmin"
```

CORS on the bucket so the browser can `PUT`/`GET` signed URLs directly
(`infrastructure/kubernetes/README.md` calls this out as a launch
blocker if missing):

```bash
gcloud storage buckets update gs://$BUCKET --cors-file=infrastructure/gcp/gcs-cors.json
```

`infrastructure/gcp/gcs-cors.json` (edit `origin` to your site):

```json
[
  {
    "origin": ["https://foryour.fans"],
    "method": ["GET", "PUT", "HEAD"],
    "responseHeader": ["Content-Type", "Content-MD5", "ETag", "x-goog-*"],
    "maxAgeSeconds": 3600
  }
]
```

Resulting env values (used in Step 5):

```
S3_ENDPOINT=https://storage.googleapis.com
S3_REGION=auto
S3_BUCKET=$BUCKET
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=<HMAC access id>
S3_SECRET_ACCESS_KEY=<HMAC secret>
```

> The web CSP already allows `https:` for `img-src`/`media-src`/`connect-src`
> (`apps/web/middleware.ts`), so `storage.googleapis.com` signed URLs work
> with no CSP change. **Validate the signed `PUT`/`GET` round-trip before
> launch** — it's the most environment-specific thing here.

---

## Step 3 — Cloud SQL for PostgreSQL

> **Terraform:** `database.tf` — the instance (private IP only), database,
> user with a `random_password`, and private-IP `DATABASE_URL` forms for
> Cloud Run and the ingest VM. Private service access is provisioned by
> `network.tf`. Tune with `var.db_tier`,
> `var.db_availability_type`, `var.db_disk_size_gb`.

```bash
gcloud sql instances create $DB_INSTANCE \
  --database-version=POSTGRES_16 \
  --edition=ENTERPRISE --tier=db-f1-micro \
  --region=$REGION \
  --storage-type=HDD --storage-size=10GB --no-storage-auto-increase \
  --backup-start-time=08:00 --retained-backups-count=7 \
  --database-flags=cloudsql.iam_authentication=off

gcloud sql databases create $DB_NAME --instance=$DB_INSTANCE
gcloud sql users create $DB_USER --instance=$DB_INSTANCE --password='CHOOSE_A_STRONG_PASSWORD'

gcloud sql instances describe $DB_INSTANCE --format='value(connectionName)'
#  -> PROJECT:REGION:ffans-pg    (the "connection name")
export DB_CONN=$(gcloud sql instances describe $DB_INSTANCE --format='value(connectionName)')
```

`DATABASE_URL` for Cloud Run (private IP through direct VPC egress):

```
postgresql://ffans:PASSWORD@PRIVATE_IP:5432/foryour_fans?sslmode=disable
```

Cost trims: `db-f1-micro` (shared vCPU), `HDD` storage, `--no-storage-auto-increase`
(you get an alert instead of silent growth), 10 GB, 7 daily backups. Turn
off backups entirely (`--no-backup` on create) only for a throwaway
environment.

---

## Step 4 — Redis

`apps/api` uses Redis for sessions, OAuth state, and rate-limit counters
(`ioredis`, accepts `redis://` and `rediss://`). The **ingest worker does
not use Redis** — only the `api` service does.

> **Terraform** does not create the Upstash database (no Google provider
> resource for it). Create it in the Upstash console and pass the URL as
> `var.redis_url` / `TF_VAR_redis_url`; Terraform stores it in Secret
> Manager (`secrets.tf`). Memorystore *is* Terraform-able
> (`google_redis_instance`) when you move to Option B at scale.

### Option A (recommended low-cost): Upstash

Create a database at [upstash.com](https://upstash.com), region close to
`$REGION`. Copy the `rediss://…` URL. That's `REDIS_URL`. No VPC, TLS by
default, free tier covers this workload.

### Option B (all-Google): Memorystore

```bash
gcloud redis instances create ffans-redis --size=1 --region=$REGION --tier=basic
# then create a Serverless VPC Access connector and pass --vpc-connector to `gcloud run deploy`
```

See [Cost tier B](#tier-b--all-google-fully-managed) for the price. The
connector is required — Cloud Run can't reach Memorystore's private IP
without it.

---

## Step 5 — secrets

> **Terraform:** `secrets.tf` creates all seven secrets, their versions,
> and per-secret `secretAccessor` bindings for the runtime SA. The AT OAuth
> EC P-256 key is generated by `tls_private_key.oauth` — no `openssl` step.
> The DB URL and S3 HMAC values are wired straight from the other
> resources. You only supply `redis_url` and `admin_dids`.

Generate the AT OAuth signing key (EC P-256, PKCS#8 PEM — `JoseKey.fromImportable`
in `packages/atproto/src/oauthClient.ts`):

```bash
openssl ecparam -name prime256v1 -genkey -noout \
  | openssl pkcs8 -topk8 -nocrypt -out oauth-signing-key.pem
```

Create the secrets (each `--data-file=-` reads stdin so nothing lands in
shell history):

```bash
printf '%s' 'postgresql://ffans:PASSWORD@localhost/foryour_fans?host=/cloudsql/'"$DB_CONN"'&sslmode=disable' \
  | gcloud secrets create ffans-database-url --data-file=-

printf '%s' 'rediss://…your-upstash-url…' \
  | gcloud secrets create ffans-redis-url --data-file=-

gcloud secrets create ffans-oauth-key --data-file=oauth-signing-key.pem

printf '%s' '<HMAC access id>'  | gcloud secrets create ffans-s3-access-key-id --data-file=-
printf '%s' '<HMAC secret>'     | gcloud secrets create ffans-s3-secret-access-key --data-file=-

# comma-separated DIDs that become ADMIN on login; the ONLY path to admin
printf '%s' 'did:plc:youradmindid' | gcloud secrets create ffans-admin-dids --data-file=-
```

`ffans-database-url` is needed by both `api` (via socket) and the ingest VM
(via proxy, `@127.0.0.1:5432`). Simplest is to store the **socket** form as
the secret and give the VM its own `DATABASE_URL` in an env file (Step 10).

---

## Step 6 — build and push the three images

The existing Dockerfiles are reused unchanged:

- `infrastructure/docker/api.Dockerfile` — `--target runtime` (the server &
  ingest share this image) and `--target migrate` (Prisma CLI + migrations,
  for the one-off job).
- `infrastructure/docker/web.Dockerfile` — bakes `NEXT_PUBLIC_SITE_URL` and
  `API_INTERNAL_URL`.

`infrastructure/gcp/cloudbuild.yaml` (in this repo) builds all three. It
needs the api URL for the web build, so run it in two passes on first
deploy:

```bash
# pass 1 — build api + migrate images only, then deploy api (Steps 7–8) to learn its URL
gcloud builds submit --config infrastructure/gcp/cloudbuild.yaml \
  --substitutions=_AR=$AR,_TAG=$(git rev-parse --short HEAD),_TARGETS=api

# ... deploy api (Step 8), capture API_URL ...

# pass 2 — build web with the real api URL
gcloud builds submit --config infrastructure/gcp/cloudbuild.yaml \
  --substitutions=_AR=$AR,_TAG=$(git rev-parse --short HEAD),_TARGETS=web,_SITE_URL=$SITE_URL,_API_URL=$API_URL
```

On every later release, `_TARGETS=all` in one pass (the api URL is stable).

Prefer building locally? The equivalent, from the repo root:

```bash
TAG=$(git rev-parse --short HEAD)
docker build -f infrastructure/docker/api.Dockerfile --target runtime -t $AR/api:$TAG .
docker build -f infrastructure/docker/api.Dockerfile --target migrate -t $AR/api:$TAG-migrate .
docker build -f infrastructure/docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_SITE_URL=$SITE_URL \
  --build-arg API_INTERNAL_URL=$API_URL \
  -t $AR/web:$TAG .
docker push $AR/api:$TAG && docker push $AR/api:$TAG-migrate && docker push $AR/web:$TAG
```

---

## Step 7 — run migrations (one-off Cloud Run job)

> **Terraform** creates the job (`google_cloud_run_v2_job.migrate` in
> `cloudrun.tf`, image `var.api_migrate_image`). *Executing* it is
> imperative — `gcloud run jobs execute` — because a run is an action, not
> a resource.

```bash
export TAG=$(git rev-parse --short HEAD)

gcloud run jobs create ffans-migrate \
  --image=$AR/api:$TAG-migrate \
  --region=$REGION \
  --service-account=$RUN_SA \
  --set-cloudsql-instances=$DB_CONN \
  --set-secrets=DATABASE_URL=ffans-database-url:latest \
  --max-retries=1 --task-timeout=600 \
  --command=pnpm --args=exec,prisma,migrate,deploy

gcloud run jobs execute ffans-migrate --region=$REGION --wait
```

On later releases: `gcloud run jobs update ffans-migrate --image=$AR/api:$NEWTAG-migrate …`
then `execute --wait`, **before** routing traffic to the new revision — but
only when that release actually adds a migration.

---

## Step 8 — deploy `api`

> **Terraform:** `google_cloud_run_v2_service.api` (`cloudrun.tf`) — same
> env vars, secret refs, Cloud SQL volume, startup probe, `max_instances=1`,
> and `allUsers`/`run.invoker` binding as below. Set `var.api_image`.

```bash
gcloud run deploy api \
  --image=$AR/api:$TAG \
  --region=$REGION \
  --service-account=$RUN_SA \
  --port=4000 \
  --cpu=1 --memory=512Mi \
  --min-instances=0 --max-instances=1 \
  --concurrency=80 \
  --timeout=60 \
  --allow-unauthenticated \
  --set-cloudsql-instances=$DB_CONN \
  --set-secrets=\
DATABASE_URL=ffans-database-url:latest,\
REDIS_URL=ffans-redis-url:latest,\
ATPROTO_OAUTH_PRIVATE_KEY=ffans-oauth-key:latest,\
S3_ACCESS_KEY_ID=ffans-s3-access-key-id:latest,\
S3_SECRET_ACCESS_KEY=ffans-s3-secret-access-key:latest,\
ADMIN_DIDS=ffans-admin-dids:latest \
  --set-env-vars=\
NODE_ENV=development,\
LOG_LEVEL=info,\
HOST=0.0.0.0,\
PUBLIC_URL=$SITE_URL,\
CORS_ORIGIN=$SITE_URL,\
ATPROTO_OAUTH_MODE=hosted,\
ALLOW_FAKE_WEBHOOKS=false,\
PAYMENT_PROVIDER=fake,\
PAYOUT_PROVIDER=fake,\
CREATOR_OWNED_PDS_ENABLED=false,\
CREATOR_OWNED_GATED_CONTENT_ENABLED=false,\
S3_ENDPOINT=https://storage.googleapis.com,\
S3_REGION=auto,\
S3_BUCKET=$BUCKET,\
S3_FORCE_PATH_STYLE=true

export API_URL=$(gcloud run services describe api --region=$REGION --format='value(status.url)')
echo "API_URL=$API_URL"     # feeds the web build
```

Notes:

- **`--max-instances=1`** — see [constraint 2](#2-the-api-service-must-run-as-a-single-instance).
- **`--allow-unauthenticated`** — the web server proxies to this URL and
  can't attach an ID token via the built-in Next.js rewrite. The surface is
  protected by session cookies, CORS, helmet, and rate limiting. To lock it
  down later: set `--no-allow-unauthenticated`, grant the web SA
  `roles/run.invoker` on `api`, and replace the `next.config.mjs` rewrite
  with a route handler that adds `Authorization: Bearer <metadata id-token>`.
- **Startup probe** (optional but recommended):
  `--startup-probe=httpGet.path=/health,initialDelaySeconds=5,timeoutSeconds=3,failureThreshold=6`.
  Don't point a liveness probe at `/ready` — it checks Postgres+Redis and a
  transient blip would kill the instance.
- Cold starts: with `--min-instances=0` the first request after idle pays
  ~1–3 s (Prisma + OAuth client init). Set `--min-instances=1` (~\$6–13/mo)
  if that's unacceptable.

---

## Step 9 — deploy `web`

> **Terraform:** `google_cloud_run_v2_service.web` (`cloudrun.tf`), with
> `API_INTERNAL_URL` set to the api service's own URL. Set `var.web_image`
> (built with that URL baked in — see Step 6 / the two-phase apply).

Build it now (Step 6, pass 2) with `_API_URL=$API_URL` and `_SITE_URL=$SITE_URL`,
then:

```bash
gcloud run deploy web \
  --image=$AR/web:$TAG \
  --region=$REGION \
  --service-account=$RUN_SA \
  --port=3000 \
  --cpu=1 --memory=512Mi \
  --min-instances=0 --max-instances=4 \
  --concurrency=80 \
  --timeout=60 \
  --allow-unauthenticated \
  --set-env-vars=NODE_ENV=development,API_INTERNAL_URL=$API_URL,NEXT_PUBLIC_SITE_URL=$SITE_URL
```

`API_INTERNAL_URL` is set here **and** baked into the image — same value.
`--startup-probe=httpGet.path=/healthz`.

---

## Step 10 — ingest worker on an `e2-micro` VM

> **Terraform:** `ingest.tf` creates the COS VM with a `templatefile`
> startup script (`ingest-startup.sh.tftpl`) that does exactly the manual
> steps below — Artifact Registry auth, the Cloud SQL proxy container, and
> the ingest container with its command overridden to `dist/ingest.js`. It
> reads the proxy `DATABASE_URL` from Secret Manager via the VM's own
> token. After a release, `gcloud compute instances reset` the VM to pull
> the new image.

```bash
gcloud compute instances create ffans-ingest \
  --zone=$REGION-b \
  --machine-type=e2-micro \
  --image-family=cos-stable --image-project=cos-cloud \
  --boot-disk-size=10GB --boot-disk-type=pd-standard \
  --scopes=cloud-platform \
  --service-account=$RUN_SA
```

Container-Optimized OS ships Docker. The VM's SA (`$RUN_SA`) already has
`cloudsql.client` and `secretmanager.secretAccessor`. SSH in
(`gcloud compute ssh ffans-ingest --zone=$REGION-b`) and:

```bash
# auth Docker to Artifact Registry
docker-credential-gcr configure-docker --registries=$REGION-docker.pkg.dev

# Cloud SQL Auth Proxy, listening on localhost:5432
docker run -d --name cloudsql-proxy --restart=always --network=host \
  gcr.io/cloud-sql-connectors/cloud-sql-proxy:latest \
  --address 127.0.0.1 --port 5432 PROJECT:REGION:ffans-pg

# the ingest worker: same api image, command overridden, no HTTP port
docker run -d --name ffans-ingest --restart=always --network=host \
  -e NODE_ENV=development \
  -e LOG_LEVEL=info \
  -e DATABASE_URL='postgresql://ffans:PASSWORD@127.0.0.1:5432/foryour_fans?sslmode=disable' \
  -e REDIS_URL='unused://' \
  -e JETSTREAM_URL='wss://jetstream.us-east.bsky.network/subscribe' \
  -e INDEX_BSKY_POSTS=false \
  US-REGION-docker.pkg.dev/PROJECT/foryour-fans/api:TAG \
  node apps/api/dist/ingest.js
```

> `loadEnv()` requires `REDIS_URL` and a few `S3_*` to be *present* even
> though `ingest.ts` never uses them — pass throwaway values (`unused://`,
> etc.) so validation passes. `DATABASE_URL` here is the **proxy** form
> (`@127.0.0.1:5432`), not the Cloud Run socket form.

Redeploying ingest = `docker pull` the new tag, `docker rm -f ffans-ingest`,
re-run. Consider a tiny systemd unit or a `docker compose` file on the VM
to make that one command.

### Ingest alternatives

- **Cloud Run worker pool** (`gcloud run worker-pools deploy`, no `$PORT`
  required): cleanest managed option; check availability/pricing in your
  region.
- **Cloud Run service**: add a ~10-line `http.createServer(...).listen($PORT)`
  that returns 200 to `ingest.ts`, deploy with `--min-instances=1
  --no-cpu-throttling --max-instances=1 --no-allow-unauthenticated`.
  ~\$6–13/mo vs \$0 for the always-free VM.

---

## Step 11 — custom domain

> **Terraform:** set `var.domain` and `google_cloud_run_domain_mapping.web`
> (`cloudrun.tf`) creates the mapping; `terraform output web_domain_dns`
> prints the records to add at your registrar (creating those is manual).

```bash
gcloud beta run domain-mappings create --service=web --domain=foryour.fans --region=$REGION
gcloud beta run domain-mappings describe --domain=foryour.fans --region=$REGION   # shows the DNS records to add
```

Add the shown `A`/`AAAA` (or `CNAME`) records at your registrar. Google
provisions a managed cert automatically. This path costs **\$0** (no load
balancer). If you instead front everything with Cloudflare (free) for the
rate-limit fix in [constraint 4](#4-client-rate-limiting-is-degraded-behind-the-nextjs-proxy),
point Cloudflare at the `web` run.app host and add an `/api/*` route to the
`api` run.app host there instead of a Cloud Run domain mapping.

Optionally map `api.foryour.fans` to the `api` service the same way and
rebuild `web` with `API_INTERNAL_URL=https://api.foryour.fans` for a
stable, readable value.

---

## Step 12 — AT OAuth (hosted mode) wiring

With `ATPROTO_OAUTH_MODE=hosted`, the api serves the client metadata and
JWKS, and they must be reachable over HTTPS at `PUBLIC_URL` under `/api`
(the web app proxies them). After Steps 9–11, verify:

```bash
curl -s $SITE_URL/api/oauth/client-metadata.json | jq .
curl -s $SITE_URL/api/oauth/jwks.json | jq .
```

`client-metadata.json` must show `client_id` = `$SITE_URL/api/oauth/client-metadata.json`,
`redirect_uris` = `[$SITE_URL/api/auth/atproto/callback]`, and a non-empty
`jwks_uri`. If `PUBLIC_URL` doesn't exactly match the origin the browser
uses (scheme + host, no trailing slash), OAuth login will fail — this is
the single most common misconfiguration.

---

## Step 13 — smoke test

```bash
curl -si $API_URL/health           # 200, security headers present, NO rate-limit headers
curl -si $API_URL/ready            # 200 {"database":"ok","redis":"ok"}
curl -si $SITE_URL/healthz         # 200
curl -sI $SITE_URL/                # 200, CSP header with a nonce, HSTS absent (NODE_ENV=development)
```

Then in a browser:

1. Load `$SITE_URL` — homepage renders, no CSP violations in the console.
2. Sign in with a real Bluesky handle — full OAuth round-trip completes,
   session cookie set on `$SITE_URL` (same-origin).
3. As a creator, create a post with an image — the signed `PUT` to
   `storage.googleapis.com` succeeds, the image renders back via a signed
   `GET`.
4. Confirm the ingest VM is indexing: `docker logs -f ffans-ingest` shows
   `"indexed a commit event"` lines.
5. `POST $API_URL/webhooks/fake` → **404** (proves `ALLOW_FAKE_WEBHOOKS=false`).

---

## Ongoing operations

**Normal release** (Terraform path)

```bash
TAG=$(git rev-parse --short HEAD)
AR=$(terraform -chdir=infrastructure/gcp/terraform output -raw artifact_registry)
API_URL=$(terraform -chdir=infrastructure/gcp/terraform output -raw api_url)

gcloud builds submit --config infrastructure/gcp/cloudbuild.yaml \
  --substitutions=_AR=$AR,_TAG=$TAG,_TARGETS=all,_SITE_URL=$SITE_URL,_API_URL=$API_URL

# only if this release adds a migration — run BEFORE the apply routes traffic:
gcloud run jobs execute "$(terraform -chdir=infrastructure/gcp/terraform output -raw migrate_job_name)" \
  --region "$REGION" --wait   # (bump api_migrate_image first if the job image changed)

terraform -chdir=infrastructure/gcp/terraform apply \
  -var api_image=$AR/api:$TAG \
  -var api_migrate_image=$AR/api:$TAG-migrate \
  -var web_image=$AR/web:$TAG

# ingest VM only re-reads its image on reboot:
gcloud compute instances reset \
  "$(terraform -chdir=infrastructure/gcp/terraform output -raw ingest_vm)" --zone "$ZONE"
```

Put the image tags in `terraform.tfvars` so a release is just `apply` after
bumping them. Without Terraform, the equivalent is `gcloud run deploy api`
/ `web` + `gcloud run jobs update` with the new `--image`.

**Rollback** — Cloud Run keeps revisions:
`gcloud run services update-traffic ffans-api --to-revisions=PRIOR_REVISION=100 --region=$REGION`
(then reconcile `terraform.tfvars` back to the prior tag so the next apply
doesn't re-roll-forward). DB migrations are not auto-rolled-back; use
expand/contract migrations.

**Logs / metrics** — `gcloud run services logs read api --region=$REGION`,
or Cloud Logging. `apps/api` exposes Prometheus metrics at `/metrics`
(unauthenticated, rate-limit-exempt); scrape it from Managed Service for
Prometheus later if you want dashboards.

**Cost hygiene**

- `max_instances` capped on both services (Terraform `var.*_max_instances`).
- `db-f1-micro` + HDD (Terraform `var.db_tier`); `disk_autoresize` is on so
  you get more storage rather than an outage — watch the size.
- Object storage: the abandoned-multipart lifecycle rule is in
  `storage.tf`; add a Nearline transition rule there if media access
  cools off.
- Delete untagged Artifact Registry images periodically
  (`gcloud artifacts docker images list … --include-tags`), or add a
  cleanup policy.
- Watch egress: Cloud Run → internet and VM → internet are billed. Media
  served via signed GCS URLs is GCS egress, not Cloud Run egress.

---

## Known limitations carried into this deployment

- **No real payments** — `NODE_ENV=development`; see
  [constraint 1](#1-you-cannot-run-nodeenvproduction-yet).
- **Single api instance** — no horizontal scale until the OAuth request
  lock is distributed; see [constraint 2](#2-the-api-service-must-run-as-a-single-instance).
- **Degraded per-client rate limiting** behind the Next.js proxy; see
  [constraint 4](#4-client-rate-limiting-is-degraded-behind-the-nextjs-proxy).
  Fixed by the load balancer + Cloud Armor at Stage 2 of
  [Scaling as usage grows](#scaling-as-usage-grows).
- **api is publicly invocable** (`--allow-unauthenticated`); hardening path
  noted in Step 8.
- **The launch footprint runs PostgreSQL without HA** (`db-f1-micro`, no
  failover) and the API single-instance. Both are deliberate launch
  economics, not the ceiling — see
  [Scaling as usage grows](#scaling-as-usage-grows) for the graduation
  path (HA at Stage 2, the one code change gating horizontal API scale).
- **Ingest on a single always-free VM** — if the VM is stopped or the
  region has an outage, discovery indexing pauses (the HTTP app keeps
  serving). No data loss; it resumes from the live firehose on restart
  (there is no backfill).
- None of this has been run end-to-end against real GCP yet — treat the
  first real deploy as the actual first test, per the same disclaimer in
  `infrastructure/kubernetes/README.md`.
