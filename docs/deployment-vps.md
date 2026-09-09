# Deploying to a single VPS (Docker + Caddy)

This is the low-effort path to a real, internet-reachable deployment: one
VPS, `docker compose`, and [Caddy](https://caddyserver.com/) for automatic
HTTPS. No cloud account, no Terraform, no managed database. It's the right
choice for a demo/POC with friends — not for real revenue (see
[Known limitations](#known-limitations-carried-into-this-deployment)) or for
anything that needs to survive a single box dying. For that, see
[`docs/deployment-gcp.md`](./deployment-gcp.md) or
[`infrastructure/kubernetes/README.md`](../infrastructure/kubernetes/README.md)
instead — same app, same hard constraints, more moving parts.

Everything here runs from
[`infrastructure/docker/docker-compose.prod.yml`](../infrastructure/docker/docker-compose.prod.yml)
— a separate file from the dev-only `docker-compose.yml` (which bind-mounts
source, runs `pnpm install` at container start, and has no TLS or auth on
Postgres/Redis/MinIO). This one builds the real production Dockerfiles
(`api.Dockerfile`, `web.Dockerfile`) into immutable images.

---

## Architecture

```
                         ┌─────────────────────────────────────────┐
   browser ──HTTPS──▶    │  Caddy (ports 80/443, auto Let's Encrypt) │
                         │    $DOMAIN/api/*        -> api:4000       │
                         │    $DOMAIN/*            -> web:3000       │
                         │    media.$DOMAIN/*      -> minio:9000     │
                         └───┬─────────────┬─────────────┬──────────┘
                             │             │             │
                   ┌─────────▼───┐  ┌──────▼──────┐  ┌───▼──────────┐
                   │ web         │  │ api         │  │ minio        │
                   │ (Next.js)   │  │ (Fastify)   │  │ (media, S3   │
                   └─────────────┘  └──┬───┬──────┘  │  API-compat) │
                                       │   │          └──────────────┘
                             ┌─────────▼┐ ┌▼──────────┐
                             │ postgres │ │ redis      │
                             └──────────┘ └────────────┘

                             ┌────────────────────────┐
                             │ ingest (same api image, │
                             │ overridden command) —   │
                             │ long-lived Jetstream     │
                             │ WebSocket consumer       │
                             └────────────────────────┘

  external, free: Jetstream firehose (wss://jetstream.us-east.bsky.network)
```

Everything runs on one box. There's no separate managed database, no CDN, no
object storage vendor — Postgres, Redis, and MinIO are all containers with
named volumes. That's the entire point (cheap, simple, one thing to manage)
and also the entire risk (one VM failing loses everything until you restore
a backup — see [Backups](#backups)).

`/api/*` is routed by Caddy **directly** to the `api` container, not through
`web`'s own server-side `/api/*` rewrite (which is what `apps/web` does when
nothing else intercepts the path first). This matters for one reason: if
`web` proxied it, `apps/api`'s rate limiter (keyed on `request.ip`) would see
the `web` container's internal IP for every visitor, collapsing per-client
limits to a single site-wide bucket. Caddy sets a real `X-Forwarded-For`,
and `api`'s `TRUSTED_PROXIES` is scoped to the compose network so that
header is actually trusted.

---

## TL;DR

```bash
# on the VPS, as a non-root sudo user, with Docker + the compose plugin installed
git clone <this repo> foryour-fans && cd foryour-fans/infrastructure/docker

cp .env.prod.example .env.prod && $EDITOR .env.prod         # fill in every value
mkdir -p secrets
openssl ecparam -name prime256v1 -genkey -noout \
  | openssl pkcs8 -topk8 -nocrypt -out secrets/atproto_oauth_key.pem

# point DNS at the VPS first (Step 3), then:
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api ingest
```

`docker compose` does **not** auto-load a file named `.env.prod` (only a
literal `.env`) — pass `--env-file .env.prod` on every command below, or
`export $(grep -v '^#' .env.prod | xargs)` once per shell session.

---

## Before you start — hard constraints

Same two that gate every deployment path this repo documents (GCP, K8s) —
they're properties of the app, not of how you host it.

### 1. You cannot run `NODE_ENV=production` for `api`

`apps/api/src/config/env.ts` refuses to boot when `NODE_ENV=production` and
`PAYMENT_PROVIDER`/`PAYOUT_PROVIDER` are `fake` — and `fake` is the only
value that exists (no real adult-content-compatible payment processor has
been picked yet). `docker-compose.prod.yml` sets `NODE_ENV=development` for
`api`/`ingest`/`migrate` deliberately — this is still a real,
internet-reachable, HTTPS deployment with hosted AT OAuth; it just can't
move real money. There is no override.

Consequences, both already handled in the compose file:

- `ALLOW_FAKE_WEBHOOKS=true`, but the Caddyfile explicitly 404s
  `/api/webhooks/*` before it reaches `api` — see
  [Completing a test subscription](#completing-a-test-subscription) for why
  and how to use it.
- `CREATOR_OWNED_PDS_ENABLED` / `CREATOR_OWNED_GATED_CONTENT_ENABLED` stay
  `false` (defaults) — that path isn't production-safe yet regardless of
  `NODE_ENV` (see `docs/creator-owned-pds.md`).

`apps/web`'s `NODE_ENV` is a different, unrelated question — see
[Why web keeps `NODE_ENV=production`](#why-web-keeps-node_envproduction)
below.

### 2. `api` must run as a single instance

`packages/atproto/src/oauthClient.ts` uses an in-process OAuth request lock
— only correct for one replica. Irrelevant risk here (`docker-compose.prod.yml`
only ever runs one `api` container), but don't "fix" a slow demo by scaling
it — that silently breaks OAuth instead.

### 3. Two `web` build args are baked in, not runtime-configurable

`NEXT_PUBLIC_SITE_URL` and `API_INTERNAL_URL` are inlined into the Next.js
build (`web.Dockerfile`'s own comment explains why for `API_INTERNAL_URL`
specifically: `next.config.mjs`'s `rewrites()` resolves to a static routes
manifest at build time, never re-evaluated at request time). Both are
already correct in `docker-compose.prod.yml`'s `web.build.args` — if you
ever change `DOMAIN` in `.env.prod`, you must `docker compose build web`
again, not just restart it.

---

## Cost estimate

A single small VPS. Nothing else to pay for — Postgres/Redis/MinIO are
self-hosted, and the AT OAuth signing key and Jetstream firehose are free.

| Provider (examples) | Spec | ~ / mo |
|---|---|---|
| Hetzner CX22 | 2 vCPU, 4 GB RAM, 40 GB disk | **€3.79** |
| DigitalOcean Basic | 2 vCPU, 4 GB RAM, 80 GB disk | **$24** |
| Any cheaper 1–2 GB box | — | Building `web`/`api` images (a `next build` + `tsc` across every workspace package) can OOM under ~2 GB during `docker compose build`. Build on a beefier machine (or your own laptop, pushing images to a registry) and only *run* the compose stack on the cheap box if you want to go smaller. |

A domain you control (a few $/yr, or reuse one you already own) is the only
other real cost.

---

## Prerequisites

- A VPS running Debian/Ubuntu (or similar), with **Docker Engine + the
  Compose plugin** installed (`docker compose version` should print v2.20+
  — `service_completed_successfully` in the compose file needs it).
  [Docker's own install docs](https://docs.docker.com/engine/install/) —
  use the official repo, not a distro package, to get a current version.
- A domain, with access to add DNS records.
- At least 4 GB RAM to comfortably `docker compose build` all three images
  on the box itself (see [Cost estimate](#cost-estimate) if you'd rather
  build elsewhere).

---

## Step 1 — DNS

Point two records at the VPS's public IP, **before** you request certs (Step
6 — Caddy needs them resolving to issue Let's Encrypt certs):

```
A     example.com          -> <VPS IP>
A     media.example.com    -> <VPS IP>
```

(`AAAA` too if the VPS has IPv6.) `media.$DOMAIN` is real and load-bearing,
not cosmetic — see [Why media needs its own subdomain](#why-media-needs-its-own-subdomain).

---

## Step 2 — firewall

Only Caddy's ports need to be reachable from the internet; everything else
in the compose file already has no `ports:` mapping to the host (Postgres,
Redis, MinIO, `api`, `web` are only reachable from other containers on the
compose network).

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## Step 3 — clone the repo and configure

```bash
git clone <this repo's URL> foryour-fans
cd foryour-fans/infrastructure/docker
cp .env.prod.example .env.prod
```

Fill in `.env.prod`:

- `DOMAIN` / `ACME_EMAIL` — your real domain and an email Let's Encrypt can
  reach about cert issues.
- `POSTGRES_PASSWORD` / `REDIS_PASSWORD` / `MINIO_ROOT_PASSWORD` — generate
  with `openssl rand -hex 24` each. Don't reuse one value across all three.
- `MINIO_ROOT_USER` / `S3_BUCKET` — any values; the defaults in the example
  file are fine.
- `ADMIN_DIDS` — leave empty for now (see [Step 7](#step-7--make-yourself-an-admin-optional)).

---

## Step 4 — the AT OAuth signing key

`ATPROTO_OAUTH_MODE=hosted` (required — `loopback` is a dev-only,
localhost-only client convention, unusable for a real domain) needs an EC
P-256 private key for `private_key_jwt` client auth. It's **not** stored in
`.env.prod` — a PEM's real newlines don't survive `.env` file parsing
reliably across tooling — it's mounted into the container as a file
instead:

```bash
mkdir -p secrets
openssl ecparam -name prime256v1 -genkey -noout \
  | openssl pkcs8 -topk8 -nocrypt -out secrets/atproto_oauth_key.pem
```

`docker-compose.prod.yml` mounts this at `/run/secrets/atproto_oauth_key`
inside the `api` container only (`ingest` never touches OAuth — see its own
comment in the compose file); `api`'s `command:` reads the file into
`ATPROTO_OAUTH_PRIVATE_KEY` at container start. `secrets/` and `.env.prod`
are both gitignored — **never commit either.**

---

## Step 5 — build and start

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Startup order is handled by `depends_on: condition: service_healthy` /
`service_completed_successfully` throughout the compose file: Postgres and
Redis come up, `migrate` runs `prisma migrate deploy` once and exits,
`minio-init` creates the bucket once and exits, then `api`/`ingest`/`web`
start, then Caddy — which requests its certs on first request to each
hostname.

Watch it come up:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api ingest caddy
```

`ingest` logging `"connected and subscribed"` means the Jetstream consumer
is live — without it, `/discover` and `/search` stay empty forever no
matter how many creators sign up (see the compose file's own comment on
that service, and `apps/api/src/ingest.ts`).

---

## Step 6 — smoke test

```bash
curl -sI https://example.com/                        # 200, CSP header, HSTS present
curl -s https://example.com/api/oauth/client-metadata.json | jq .
curl -s https://example.com/api/oauth/jwks.json | jq .
curl -s https://example.com/api/webhooks/fake -X POST # 404 — proves it's NOT publicly reachable
```

`client-metadata.json` must show `client_id` = `https://example.com/api/oauth/client-metadata.json`
and `redirect_uris` = `["https://example.com/api/auth/atproto/callback"]`. If
`PUBLIC_URL` doesn't exactly match the origin the browser uses (scheme +
host, no trailing slash — already set correctly from `DOMAIN` in the compose
file), OAuth login fails. This is the single most common misconfiguration
across every deployment path this repo documents.

Then in a browser:

1. Load `https://example.com` — homepage renders, no CSP violations in the
   console.
2. Sign in with a real Bluesky/AT Protocol handle — full OAuth round-trip,
   session cookie set.
3. "Become a creator," publish a profile — within a few seconds (once
   `ingest` picks up the commit off the firehose), you should show up at
   `/discover`.
4. Create a post with an image — the signed `PUT` to `https://media.example.com/...`
   succeeds, the image renders back via a signed `GET`.

---

## Step 7 — make yourself an admin (optional)

Log in once first (`User` rows only exist after a real login), grab your
DID from `/dashboard` or the session, then:

```bash
# edit .env.prod: ADMIN_DIDS=did:plc:your-own-did
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api ingest
```

---

## Completing a test subscription

There's no real payment provider — `FakePaymentProvider` leaves every new
subscription `PENDING` until something delivers a matching webhook
(normally a real processor would; here, nothing does automatically). That
webhook route (`POST /webhooks/fake`) verifies no signature, so it's
deliberately **not** reachable from the public internet (the Caddyfile 404s
`/api/webhooks/*` before the request ever reaches `api` — see Step 6's
smoke test). `ALLOW_FAKE_WEBHOOKS` stays `true` in the compose file so you,
the operator, can still complete it by hand from inside the container:

```bash
# have a friend (or you, on a second account) hit "Subscribe" on a tier
# first — note the providerSubscriptionId from the subscribe response or
# the fake checkout redirect URL (…/session/<providerSubscriptionId>?tier=…)

docker compose -f docker-compose.prod.yml --env-file .env.prod exec api \
  wget -q -O- --header='Content-Type: application/json' \
  --post-data='{"id":"evt_1","type":"subscription.activated","data":{"providerSubscriptionId":"<paste it>"}}' \
  http://127.0.0.1:4000/webhooks/fake
```

See `apps/api/test/subscriptions.test.ts` for the full set of event
`type`s (`subscription.past_due`, `subscription.canceled`,
`payment.failed`, `payment.refunded`) if you want to demo those states too.

If you'd rather not deal with this at all, set `ALLOW_FAKE_WEBHOOKS=false`
in `.env.prod` and restart `api` — subscriptions will just stay `PENDING`
forever, which is also a legitimate way to demo the paywall (a friend sees
the locked-content state, never the unlocked one).

---

## Why media needs its own subdomain

`packages/media`'s `S3ObjectStorage` signs upload/download URLs against
whatever `S3_ENDPOINT` is configured — the browser is handed that exact
host and fetches it directly, never through `api`. If `S3_ENDPOINT` were
the internal `http://minio:9000` Docker DNS name (like the dev
`docker-compose.yml` uses), a real browser outside the Docker network
couldn't resolve it. `media.$DOMAIN` gives MinIO a real, publicly
resolvable HTTPS host via Caddy instead.

Community MinIO (the free image this compose file uses) has no per-bucket
CORS API — that's an AIStor/enterprise-only feature — so cross-origin
browser `PUT`/`GET` from the main site to `media.$DOMAIN` is allowed via
the server-wide `MINIO_API_CORS_ALLOW_ORIGIN` env var instead (already set
from `DOMAIN` in the compose file). **Validate a real upload before your
demo** — it's the most environment-specific thing in this whole setup, per
the same caveat `docs/deployment-gcp.md` makes about its own bucket CORS.

---

## Why web keeps `NODE_ENV=production`

Unlike `api`, `apps/web` has no payment-provider gate tied to `NODE_ENV` —
it's purely a rendering/serving concern there. `web.Dockerfile` bakes
`NODE_ENV=production` into the image, and `docker-compose.prod.yml`
deliberately does **not** override it at runtime (unlike `docs/deployment-gcp.md`,
which sets `NODE_ENV=development` on `web` too, for consistency with `api`
— also a legitimate choice, just not this one). Leaving it as `production`
gets two things for free from `apps/web`'s own code:

- `middleware.ts`'s CSP drops `'unsafe-eval'` from `script-src` (only added
  for `next dev`'s React Refresh, never needed here since this is the
  standalone production build regardless).
- `next.config.mjs` emits a real `Strict-Transport-Security` header.

Nothing about the app depends on `web` and `api` sharing the same
`NODE_ENV` — they're separate processes/containers, each reading their own
environment.

---

## Operations

### Redeploying after a code change

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
# only if this release adds a Prisma migration — `migrate` re-runs
# automatically on `up -d` since it's a restart:"no" one-shot service that
# hasn't "completed successfully" under the NEW image yet; api/ingest wait
# on it via depends_on as before.
```

### Logs

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f ingest
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f caddy
```

### Backups

Nothing here is automated — this is a demo/POC deployment. At minimum,
cron a nightly `pg_dump` off the box (Postgres is the only place
non-recoverable state lives — AT records are recoverable from the network,
media is recoverable only from MinIO's own volume, which is worth including
too):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_dump -U foryour_fans foryour_fans | gzip > "backup-$(date +%F).sql.gz"
```

Copy the resulting file (and periodically, `minio-data`'s volume contents)
somewhere off the VPS — a backup that only lives on the box it's backing up
protects against nothing.

### MinIO admin console

Never exposed publicly. Reach it over SSH:

```bash
ssh -L 9001:localhost:9001 you@your-vps
# then open http://localhost:9001 locally, log in with MINIO_ROOT_USER/PASSWORD
```

### Rotating a secret

Edit `.env.prod` (or replace `secrets/atproto_oauth_key.pem`), then:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d <service>
```

Rotating `POSTGRES_PASSWORD` also needs `ALTER USER foryour_fans WITH
PASSWORD '...'` run inside the `postgres` container first — changing the
env var alone doesn't change the already-initialized database user's
password.

---

## Known limitations carried into this deployment

- **No real payments** — `NODE_ENV=development` on `api`; see
  [constraint 1](#1-you-cannot-run-nodeenvproduction-for-api).
- **No high availability, anywhere.** One VPS, one Postgres container, one
  MinIO container. A disk failure or a bad `docker compose down -v` loses
  everything since the last backup. This deployment path trades that away
  for cost and simplicity — see `docs/deployment-gcp.md` / the Kubernetes
  guide for managed alternatives.
- **`ALLOW_FAKE_WEBHOOKS=true`, gated at the Caddy layer, not the app
  layer.** If you ever change the Caddyfile's routing, re-check that
  `/api/webhooks/*` is still blocked before the general `/api/*` proxy —
  see [Completing a test subscription](#completing-a-test-subscription).
- **`ingest` has no failover.** Single container, no leader election — a
  crash pauses discovery indexing (nothing else) until `docker compose up
  -d ingest` restarts it; it resumes from the live firehose, no backfill.
- **Backups are manual** — see [Backups](#backups). Nothing here schedules
  or off-boxes them for you.
- **Not yet run end-to-end against a real VPS** in the environment this
  guide was written in (no outbound access to a real host to provision).
  Treat the first real deploy as the actual first test of this exact
  compose file — `docker compose config` was used to validate syntax and
  variable interpolation, not a live `up`, per the same disclaimer
  `docs/deployment-gcp.md` and `infrastructure/kubernetes/README.md` both
  carry about their own paths.
