#
# Production image for apps/web (WEB PHASE 16 — see docs/architecture.md and
# docs/build-plan.md). Uses Next.js's `output: "standalone"` (next.config.mjs),
# which traces the minimal set of files and node_modules this app actually
# needs at runtime — apps/web has zero @foryour-fans/* workspace dependencies
# (it only ever talks to apps/api over HTTP, via next.config.mjs's /api/*
# rewrite), so the workspace install below is filtered to just this package,
# unlike infrastructure/docker/api.Dockerfile's full-workspace build.
#
# Build with: docker build -f infrastructure/docker/web.Dockerfile .

FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
# NEXT_PUBLIC_* vars are inlined into both the client AND server bundles at
# `next build` time (Next.js's webpack define-plugin replaces the literal
# `process.env.NEXT_PUBLIC_*` expression everywhere, so client/server agree)
# — unlike API_INTERNAL_URL below, there is no way to override this per
# environment at container-start time once the image is built. Each
# environment (development/staging/production) that needs a different
# public site URL must build/tag its own image with this build arg set —
# see infrastructure/kubernetes/overlays/*/kustomization.yaml's `images:`
# comment for the corresponding tag-per-environment convention.
ARG NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
# API_INTERNAL_URL is ALSO effectively build-time, for a reason specific to
# this var, not a NEXT_PUBLIC_* rule: Next.js resolves next.config.mjs's
# `rewrites()` (what makes /api/* same-origin for the browser) into a
# static routes manifest at `next build` time and never re-invokes it at
# request time — verified directly: booting the built server with a
# DIFFERENT API_INTERNAL_URL than the one present at build time still
# proxied to the build-time value. lib/serverApi.ts's own direct
# server-to-server fetch (bypassing the browser-facing rewrite entirely)
# DOES read process.env.API_INTERNAL_URL live at request time — so setting
# this differently at container-start than at build-time would silently
# split the two mechanisms. The default below is the Kubernetes internal
# Service DNS name, which is the SAME value in every overlay (development/
# staging/production all name the Service `api` within their own
# namespace), so there is deliberately no per-environment override for
# this one — see web-configmap.yaml's own comment.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
COPY . .
RUN pnpm install --frozen-lockfile --filter @foryour-fans/web...
RUN pnpm --filter @foryour-fans/web run build

# Standalone runtime: `.next/standalone` already contains a pruned,
# self-contained `node_modules` (Next traces real production usage, not
# package.json's dependency list) plus `server.js`. `.next/static` and
# `public/` are NOT included in `.next/standalone` by design — Next expects
# them copied in alongside it. See
# https://nextjs.org/docs/pages/api-reference/next-config-js/output.
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
