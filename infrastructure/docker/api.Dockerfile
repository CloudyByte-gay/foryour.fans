#
# Production image for apps/api (Phase 16 — see docs/architecture.md and
# docs/build-plan.md). This is a SEPARATE Dockerfile from
# infrastructure/docker/app.Dockerfile, which stays a bare dev-only base
# image for docker-compose (source bind-mounted in, `pnpm install` at
# container start). This one bakes a real, immutable artifact.
#
# Two things ship from one image, selected by CMD/command in the Kubernetes
# manifests that consume it (infrastructure/kubernetes/base):
#   - the Fastify HTTP server (dist/server.js), the default CMD below
#   - the Phase 10 Jetstream ingestion worker (dist/ingest.js), run as its
#     own separate Deployment with a different command — see
#     apps/api/src/ingest.ts's own doc comment on why it must never share a
#     process with the HTTP server (N replicas would each re-consume the
#     whole firehose)
#
# A third target, `migrate`, is not a runtime image at all — it is the full
# `build` stage as-is (devDependencies, the Prisma CLI, packages/database's
# schema + migrations included) used to run `prisma migrate deploy` as a
# one-off Kubernetes Job before a rollout.
#
# Build with: docker build -f infrastructure/docker/api.Dockerfile --target
# runtime .   (or --target migrate for the migration Job image)

FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Full workspace: every package's source, `pnpm install` (dev + prod
# deps), Prisma client generation, then a build of every workspace package
# apps/api depends on — its compiled output imports their dist/, not
# TypeScript source, same rule CI's own build step enforces.
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @foryour-fans/database run generate
RUN pnpm -r --workspace-concurrency=1 run --if-present build

# Migration image: same as `build`, kept as-is (schema, migrations, and the
# Prisma CLI devDependency all still present) — see the header comment.
FROM build AS migrate
WORKDIR /app/packages/database
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# Strips devDependencies from the already-built tree, IN PLACE — not a
# fresh install/`pnpm deploy` into a new directory. This matters: verified
# locally that `pnpm --filter @foryour-fans/api deploy --prod` (even with
# `--legacy`) re-resolves a FRESH, un-generated `@prisma/client` into its
# own new virtual store location, which throws "@prisma/client did not
# initialize yet" at runtime — Prisma's generated client code is tied to
# the exact `node_modules/@prisma/client` instance `generate` ran against
# in the `build` stage above, and a fresh install gets a different instance
# of that same version with none of the generated code. `pnpm prune --prod`
# only deletes devDependency packages from the tree that's already there,
# so the already-generated client survives untouched — verified by actually
# booting `node apps/api/dist/server.js` against real Postgres/Redis
# afterward and getting real 200s from /health and /ready, not just
# checking that files exist.
FROM build AS pruned
RUN CI=true pnpm prune --prod

# Final runtime image: no pnpm, no devDependencies, no test files — but the
# full built workspace tree (every package's dist/ plus every package's own
# node_modules), copied wholesale rather than cherry-picked, because pnpm's
# node_modules layout is a web of relative symlinks (each package's own
# node_modules pointing into the root's central .pnpm store) that only
# resolves correctly if the relative structure between them is preserved
# exactly. This is heavier than a hand-curated copy would be, but it is the
# thing that was actually verified to boot.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=pruned /app ./
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
