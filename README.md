# foryour.fans

An **AT Protocol-native paid creator platform** — think Patreon / OnlyFans,
but built on open protocol identity. A user's account *is* their portable AT
Protocol identity (a DID); there is no separate username or password to
create. Creators publish a public profile and posts to **their own PDS**
(personal data server), set up subscription tiers, and gate private content
behind entitlements. The platform never runs a PDS of its own — public
records are written to the user's repo via OAuth-scoped writes.

Adult / NSFW creator content is in scope, which is why the payment layer is
an abstraction (no assumed Stripe) and creator identity / age verification
is a first-class gating requirement rather than "future work".

> **Status:** feature-complete through the planned build phases (API Phases
> 1–17, Web Phases 0–17) plus two rearchitecture specs. It runs end-to-end
> locally. It is **not deployable for real money** — no real payment/payout
> processor has been integrated, and `NODE_ENV=production` deliberately
> refuses to boot with the fake providers. See
> [Project status](#project-status).

---

## How it works

| Concern | Where it lives |
|---|---|
| Identity (handle, DID, PDS) | The user's own AT Protocol account. Resolved and OAuth'd at login; never a password. |
| Public profile & public posts | Lexicon records (`fans.foryour.profile` / `post` / `tier`) in the **creator's own PDS**. Optionally dual-published as `app.bsky.feed.post` so they appear in Bluesky. |
| Private / subscriber / tier content | The application's **Postgres** database (app-authoritative). Never written to AT Protocol. |
| Media bytes | Private **S3-compatible object storage** (MinIO locally; GCS / R2 / S3 in production). Served only via short-lived signed URLs after an entitlement check. |
| Subscriptions, payments, payouts, moderation | Postgres. Payment/payout are provider-abstracted (`PaymentProvider` / `PayoutProvider`) with fakes only, so far. |
| Discovery / search | A local index built by a separate long-lived process that consumes the AT Protocol firehose (Jetstream) and indexes any DID publishing `fans.foryour.*` records. |

Full rationale: [`docs/architecture.md`](./docs/architecture.md) and
[`docs/atproto-vs-database.md`](./docs/atproto-vs-database.md).

---

## Repository structure

```text
apps/
  api/            Fastify 5 HTTP API (+ a separate Jetstream ingest process)
  web/            Next.js 15 / React 19 web client (App Router, standalone output)
packages/
  database/       Prisma schema + generated client (Postgres)
  shared/         Cross-cutting types/utilities (Did type, Redis client factory)
  atproto/        Handle/DID/PDS resolution, AT OAuth client, generic record read/write/delete
  auth/           App session store, AT OAuth token stores, User upsert
  lexicons/       fans.foryour.{profile,post,tier,...} lexicons + generated types
  subscriptions/  Tier CRUD, PaymentProvider/PayoutProvider + fakes, webhooks,
                  entitlements (canAccess), creator dashboard analytics
  content/        ContentRepository interface + PrivateContentRepository (Postgres),
                  CreatorOwnedContentRepository (flag-gated), comment/like helpers
  media/          ObjectStorage interface + S3ObjectStorage, presigned upload/download,
                  MediaProcessor hook, MediaAsset lifecycle
  discovery/      Jetstream client (JetstreamIngestor), commit-event indexer,
                  discover/search read model + queries
  moderation/     Reports, moderation cases, content labels, user/creator blocks,
                  admin actions + audit log, ADMIN_DIDS bootstrap
infrastructure/
  docker/         docker-compose.yml (local Postgres/Redis/MinIO) + production Dockerfiles
  kubernetes/     Kustomize manifests (base + dev/staging/prod overlays)
  gcp/            Cloud Build config + helpers for the Cloud Run deployment
docs/             architecture, build plan, UX, security, deployment, known limitations, …
prompts/          The phase-by-phase specs the codebase was built from
```

---

## Prerequisites

- **Node.js 20+** (developed against 22)
- **pnpm** — `corepack enable` picks up the `packageManager` field, or `npm i -g pnpm`
- **Docker** — for local Postgres, Redis, and MinIO

## Getting started

```bash
pnpm install
cp .env.example .env

# start local Postgres / Redis / MinIO
docker compose -f infrastructure/docker/docker-compose.yml up -d

# create the local MinIO bucket for media (not auto-created)
docker exec foryour-fans-minio-1 mc alias set local http://localhost:9000 foryour_fans foryour_fans_dev
docker exec foryour-fans-minio-1 mc mb local/foryour-fans-dev --ignore-existing

# generate the Prisma client and apply migrations
pnpm db:generate
pnpm --filter @foryour-fans/database run migrate

# build workspace packages once — apps/api's compiled output imports the
# built dist/ of workspace packages, not their TypeScript source
pnpm build

pnpm dev:api   # http://127.0.0.1:4000
pnpm dev:web   # http://127.0.0.1:3000

# optional, separate long-lived process: connects to a real public Jetstream
# server and indexes fans.foryour.* activity into /discover and /search.
# Nothing else depends on it.
pnpm --filter @foryour-fans/api dev:ingest
```

**Browse to `http://127.0.0.1:3000`, not `localhost`.** AT Protocol's dev
"loopback" OAuth client requires the redirect URI host to be exactly
`127.0.0.1` — using `localhost` makes login fail. See
[`docs/architecture.md`](./docs/architecture.md).

Verify the API:

```bash
curl http://127.0.0.1:4000/health   # liveness — process only
curl http://127.0.0.1:4000/ready    # readiness — checks Postgres + Redis
```

### Trying the product

Log in at `/login` with any real AT Protocol handle (e.g. an existing
Bluesky handle) — this runs a **real** OAuth flow against that handle's real
PDS; there is no mock login. From `/dashboard`, follow **Become a creator**
to publish a real `fans.foryour.profile` record to your own PDS — your page
is then `/c/<your-handle>` (and `/c/<your-did>`, which never breaks). Add
subscription tiers on `/creator/tiers`, compose posts on `/creator/posts`
(Public / Subscribers / specific Tier, with a drag-and-drop media
uploader). A second account can subscribe from your creator page; with the
fake payment provider the subscription stays `PENDING` until a matching
delivery hits `POST /webhooks/fake` (see
`apps/api/test/subscriptions.test.ts` for payload shapes). Entitlement is
enforced everywhere content is read — a locked post comes back as a safe
metadata-only stub, never body text or a media reference.

A deeper walk-through of the API surface and the web screens lives in
[`docs/web-app.md`](./docs/web-app.md).

---

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Builds every package/app in dependency order — **run before lint/typecheck/test on a clean checkout** |
| `pnpm lint` | ESLint across every workspace package |
| `pnpm typecheck` | `tsc --noEmit` across every workspace package |
| `pnpm test` | Vitest across every workspace package that has tests |
| `pnpm dev:api` / `pnpm dev:web` | API / web app in watch mode |
| `pnpm db:migrate` | Prisma migrate (dev) |
| `pnpm --filter @foryour-fans/web test:e2e` | Playwright flows (needs Postgres + Redis; starts a fake-OAuth API + a prod web build) |

CI (`.github/workflows/ci.yml`) runs install → generate → migrate →
**build** → lint → typecheck → test → Playwright e2e (headless Chromium)
against real Postgres and Redis service containers on every PR.

---

## Deployment

Production Dockerfiles live in `infrastructure/docker/`
(`api.Dockerfile`, `web.Dockerfile`). Two deployment paths are documented:

- **Kubernetes** — Kustomize manifests in `infrastructure/kubernetes/`, with
  base + dev/staging/prod overlays. See
  [`infrastructure/kubernetes/README.md`](./infrastructure/kubernetes/README.md).
- **Google Cloud (Cloud Run)** — a low-cost, scale-as-you-grow setup using
  Cloud Run for the app tiers plus managed GCP services for everything else,
  provisioned with **Terraform** (`infrastructure/gcp/terraform/`). See
  [`docs/deployment-gcp.md`](./docs/deployment-gcp.md).

Both note the same hard constraints: the API must currently run as a single
instance (in-process OAuth lock), the web app bakes two env vars in at build
time, and `NODE_ENV=production` will not boot until a real payment provider
exists.

---

## Project status

Every numbered build phase is complete: API Phases 1–17 and Web Phases
0–17, plus the Handle-as-Identity refactor and two post-Phase-10
rearchitecture specs (Bluesky-compatible public posts — shipped;
creator-owned PDS storage — backend proof-of-concept, flag-gated and paused
for a privacy review). The one remaining spec,
[`prompts/atproto-spaces.md`](./prompts/atproto-spaces.md) (AT Protocol
Spaces as a key-grant transport), runs dead last.

The gap between "runs" and "launchable for real money" is a fixed list of
deferred business/compliance decisions — a real payment/payout processor
and its security review, subscriber age verification, a real KYC vendor,
transactional notifications, and an edge/DDoS layer. None is an
architectural flaw.

- [`docs/build-plan.md`](./docs/build-plan.md) — phase-by-phase tracking view
- [`docs/known-limitations.md`](./docs/known-limitations.md) — per-phase known limitations + remaining work
- [`docs/final-architecture.md`](./docs/final-architecture.md) — system review, risk register, MVP-readiness
- [`docs/security-usability-review-2026-09-09.md`](./docs/security-usability-review-2026-09-09.md) — latest review: OAuth binding, redirect validation, rate-limit proxy trust, private-API caching, CSP, and upload/sign-in recovery fixes; 862 unit/integration + 36 browser tests green, zero known dependency vulnerabilities on that date

---

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/architecture.md`](./docs/architecture.md) | System design, per-phase rationale, verification transcripts |
| [`docs/atproto-vs-database.md`](./docs/atproto-vs-database.md) | Which data lives in AT Protocol vs Postgres, and why |
| [`docs/web-app.md`](./docs/web-app.md) | Detailed web client feature & implementation inventory |
| [`docs/ux.md`](./docs/ux.md) · [`docs/ux-review.md`](./docs/ux-review.md) | Screen inventory / state matrix; route × persona review |
| [`docs/web-accessibility.md`](./docs/web-accessibility.md) | Accessibility audit |
| [`docs/security.md`](./docs/security.md) · [`docs/threat-model.md`](./docs/threat-model.md) · [`docs/production-readiness.md`](./docs/production-readiness.md) | Hardening writeup, threat model, readiness checklist |
| [`docs/creator-owned-pds.md`](./docs/creator-owned-pds.md) · [`docs/bluesky-public-posts.md`](./docs/bluesky-public-posts.md) | The two rearchitecture specs' research & decisions |
| [`docs/deployment-gcp.md`](./docs/deployment-gcp.md) · [`infrastructure/kubernetes/README.md`](./infrastructure/kubernetes/README.md) | Deployment guides |
| [`docs/known-limitations.md`](./docs/known-limitations.md) · [`docs/build-plan.md`](./docs/build-plan.md) | Known limitations; build tracking |
