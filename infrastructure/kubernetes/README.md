# Kubernetes deployment (Phase 16 / WEB PHASE 16)

Manifests for `apps/api` (HTTP server + the separate Jetstream ingestion
worker) and `apps/web`. See `prompts/full.md` PHASE 16, `prompts/web.md` WEB
PHASE 16, and `docs/architecture.md`'s Phase 16 section for the full design
rationale — this file is the operational how-to.

```text
base/                     shared manifests — not meant to be applied alone
  namespace.yaml
  api-configmap.yaml       environment-INVARIANT api config (PORT, LOG_LEVEL, ...)
  api-secret.example.yaml  TEMPLATE ONLY — never applied, never real values
  api-deployment.yaml      the Fastify HTTP server (dist/server.js)
  api-ingest-deployment.yaml  the Phase 10 Jetstream worker (dist/ingest.js) — always 1 replica
  api-service.yaml
  api-pdb.yaml
  api-hpa.yaml
  web-deployment.yaml
  web-service.yaml
  web-pdb.yaml
  web-hpa.yaml
  ingress.yaml
  migrate-job.yaml         `prisma migrate deploy` — applied explicitly, not via kustomize resources
overlays/
  development/  local kind-testing of these manifests (NOT the everyday dev
                workflow — that's still infrastructure/docker/docker-compose.yml)
  staging/
  production/
```

## Why some config lives per-overlay, not in `base/`

`NODE_ENV`, `PUBLIC_URL`, `CORS_ORIGIN`, `ATPROTO_OAUTH_MODE`,
`PAYMENT_PROVIDER`, `PAYOUT_PROVIDER`, and the `S3_*` bucket/endpoint values
genuinely differ per environment, so each overlay defines its own
`api-env-config` ConfigMap rather than `base/` defining one every overlay
would have to override key-by-key. `base/api-deployment.yaml`'s `envFrom`
references it by name; **an overlay that forgets to provide it will fail to
apply** (a missing ConfigMap reference), which is the intended failure mode
— silently falling back to nothing would be worse.

## Secrets — never committed

See [trusted proxies and client rate limits](#trusted-proxies-and-client-rate-limits)
for the `TRUSTED_PROXIES` configuration required when the API runs behind the web
proxy and ingress.

`base/api-secret.example.yaml` is a **template only**, excluded from
`base/kustomization.yaml`'s `resources`, so `kubectl apply -k` never applies
it. A real `api-secrets` Secret (`DATABASE_URL`, `REDIS_URL`,
`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`, `ATPROTO_OAUTH_PRIVATE_KEY`,
`CONTENT_KEY_WRAP_SECRET`, `ADMIN_DIDS`) must exist in the target namespace
**before** applying `overlays/staging` or `overlays/production` — provision
it with your secrets manager of choice (Sealed Secrets, External Secrets
Operator, Vault, your CI/CD's own secret injection) or, at minimum,
`kubectl create secret generic api-secrets --from-literal=...`.

`overlays/development` is the one exception: it commits a real, applied
`api-secrets.yaml` — but every value in it is the same already-public,
non-sensitive dev-only credential this repo already commits in
`.env.example` and `infrastructure/docker/docker-compose.yml`, pointed at
that overlay's own throwaway in-cluster Postgres/Redis/MinIO
(`dev-datastores.yaml`). Never copy that pattern into staging or production.

## Trusted proxies and client rate limits

Set `TRUSTED_PROXIES` in the target overlay's `api-env-config` ConfigMap to a
comma-separated list of the actual trusted proxy IPs/CIDRs. The API reads this
at startup; roll out the API Deployment after changing it. It is not a secret
or a web build argument. The committed overlays leave it unset because proxy
addresses depend on the cluster.

Traffic follows browser → ingress → web → API. Fastify walks the forwarded
address chain from the API's socket peer toward the client and stops at the
first untrusted address. Include each trusted hop needed to reach the client;
trusting only the web peer can leave the ingress address as the rate-limit key.
Use the actual source addresses seen by the API, which may differ from Service
IP addresses when pod networking or source NAT is involved.

- Empty/unset trusts no proxies. Client-supplied `X-Forwarded-For` cannot choose
  a rate-limit bucket, but users behind one web proxy share its budget.
- Restrict API reachability to the intended proxy path. Configure the external
  ingress to sanitize forwarding headers and validate the resulting chain.
- Do not use `0.0.0.0/0`, `::/0`, or a whole cluster subnet containing untrusted
  workloads. Limit trusted CIDRs to infrastructure you control.
- Verify that separate clients get independent budgets and that changing a
  forged forwarding header does not reset a client's budget. The global limit
  is 300 requests/minute and sign-in start is 10/minute outside test mode.

Preserve `Cache-Control: private, no-store` on session-aware API responses,
including anonymous responses and errors; do not override it with CDN caching.
Keep the generated CSP intact. It allows signed HTTPS storage uploads and blob
media previews. HTTP MinIO origins are development-only exceptions, so validate
the real storage origin, TLS, upload CORS, and signed PUT/GET flow before launch.

## Building images

```bash
# api — both server.js and ingest.js ship from this one image; see
# infrastructure/docker/api.Dockerfile's header comment for the `command`
# override each Deployment uses.
docker build -f infrastructure/docker/api.Dockerfile --target runtime -t ghcr.io/foryour-fans/api:TAG .

# the migration image (Prisma CLI + schema + migrations, full workspace —
# NOT the pruned runtime image above)
docker build -f infrastructure/docker/api.Dockerfile --target migrate -t ghcr.io/foryour-fans/api:TAG-migrate .

# web — NEXT_PUBLIC_SITE_URL AND API_INTERNAL_URL are both inlined into the
# build; NEITHER can be changed by anything in the Kubernetes manifests
# afterward (verified directly — see web.Dockerfile's own comment on why
# API_INTERNAL_URL, despite not being a NEXT_PUBLIC_* var, is build-time
# too). NEXT_PUBLIC_SITE_URL varies per environment, so build a distinct
# image per environment's public URL; API_INTERNAL_URL's default
# (http://api:4000, the in-cluster Service name) is already correct for
# every overlay, so it's normally left unset here.
docker build -f infrastructure/docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_SITE_URL=https://foryour.fans \
  -t ghcr.io/foryour-fans/web:TAG .
```

Building and pushing these to a real registry, and wiring that into CI/CD,
is deliberately not part of this phase — see the repo's known-limitations
docs. The `images:` block in each overlay's `kustomization.yaml` is where a
real pipeline would set the resolved tag/digest (e.g. `kustomize edit set
image`), not a value hand-edited here.

## Applying an overlay

```bash
kubectl apply -k infrastructure/kubernetes/overlays/development   # or staging / production

# Run migrations once per rollout that carries a new one (see
# base/migrate-job.yaml's own header comment for why this isn't a normal
# kustomize resource):
kubectl apply -f infrastructure/kubernetes/base/migrate-job.yaml -n <namespace>
kubectl wait --for=condition=complete job/api-migrate -n <namespace> --timeout=120s
kubectl delete job/api-migrate -n <namespace>
```

`kustomize build infrastructure/kubernetes/overlays/<env>` (or `kubectl
kustomize ...`) renders the final manifests without applying anything —
useful for review or piping into other tooling.

## What was actually verified (and what wasn't)

The [2026-09-09 review](../../docs/security-usability-review-2026-09-09.md)
verified Next.js 15.5.24 / React 19.2.8 with a production web build, API/package
builds, lint/type checks, 862 unit/integration tests, and 36 Chromium browser
tests (including accessibility and mobile overflow checks). Tests used disposable
Postgres 16/Redis 7 and fake OAuth/payment providers. The production dependency
audit reported zero known vulnerabilities on that date. These checks do not
establish that the images or manifests have been deployed successfully.

The following records the original Phase 16 infrastructure verification:

The Kubernetes manifests themselves are built with the real `kustomize`
binary (all three overlays render cleanly, no warnings). The two
Dockerfiles could not be `docker build`-ed end-to-end in the environment
this phase was written in (no network access to Docker Hub to pull
`node:22-bookworm-slim`), so instead their actual logic was reproduced and
run directly on the host, against real Postgres/Redis:

- `pnpm install` → `prisma generate` → `pnpm -r build` → `pnpm prune --prod`
  → `node apps/api/dist/server.js`, confirming real `200`s from `/health`
  and `/ready`. This is what caught a real bug before it shipped:
  `pnpm --filter @foryour-fans/api deploy --prod` (even with `--legacy`)
  re-resolves a fresh, un-generated `@prisma/client` and throws at startup
  — `pnpm prune --prod`, run **in place** on the already-built tree instead,
  does not, because it only deletes devDependency packages rather than
  re-installing anything. `api.Dockerfile` uses the verified prune approach,
  not `deploy`.
- `next build` (with `output: "standalone"`) → copying `.next/standalone` +
  `.next/static` + `public/` into a scratch directory exactly as
  `web.Dockerfile` does → `node apps/web/server.js`, confirming a real `200`
  from `/healthz`, a real rendered homepage, and — importantly — the CSP
  nonce actually present and shared between `middleware.ts` and Next's own
  injected scripts. This is also what surfaced the `API_INTERNAL_URL`
  build-time-vs-runtime nuance documented throughout this directory and in
  `web.Dockerfile`'s own comments: it was found by booting the built server
  with a *different* value than was present at build time and observing
  the `/api/*` proxy still hit the stale, build-time one.

Not verified: an actual `docker build`/`docker run` of either image, or a
real `kubectl apply` against a live cluster. The Dockerfiles' own
`FROM`/`COPY --from=`/multi-stage mechanics are standard and low-risk given
the above, but treat a first real build in an environment with registry
access as the actual first run, not a formality.

## Production readiness note — read before treating `overlays/production` as deployable

`overlays/production/api-env-config.yaml` sets `NODE_ENV: "production"`,
which is the **correct target value** — but `apps/api/src/config/env.ts`
will refuse to boot with it today, because `PAYMENT_PROVIDER`/
`PAYOUT_PROVIDER` only ever have one possible value, `"fake"`, and a
deliberate, no-override startup guard (Phase 15) refuses `NODE_ENV=production`
with either set to `"fake"`. This is not a Phase 16 bug: no real
adult-content-compatible payment/payout processor has been selected yet
(`prompts/full.md`'s own Phase 6 note), so the honest state of this project
is that it **is not deployable for real money today**. The api Deployment
under `overlays/production` will crash-loop until a real provider ships and
the enum in `config/env.ts` grows to include it — the manifests describe the
target shape of that eventual, real deployment, not a claim that it works
right now. `overlays/staging` sidesteps this by running `NODE_ENV:
"development"` (see that overlay's own comment) specifically so hosted AT
OAuth and real external infra can still be exercised without tripping a
guard that exists for a payments reason staging doesn't have yet.
