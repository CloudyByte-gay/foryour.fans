import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { AtprotoProfile, DeleteAtRecord, OAuthClientLike, PublishAtRecord } from "@foryour-fans/atproto";
import type { ContentRepository } from "@foryour-fans/content";
import type { PrismaClient } from "@foryour-fans/database";
import type { MediaProcessor, ObjectStorage } from "@foryour-fans/media";
import type { KeyGrantService, PaymentProvider, PayoutProvider } from "@foryour-fans/subscriptions";
import type { ContentClassifier } from "@foryour-fans/moderation";
import type { OAuthSession } from "@atproto/oauth-client-node";
import Fastify, { type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { Env } from "./config/env.js";
import { LoggingErrorReporter, type ErrorReporter } from "./errorReporting.js";
import { createMetrics, metricsRoutes } from "./metrics.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { sessionPlugin } from "./plugins/session.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { blocksRoutes } from "./routes/blocks.js";
import { commentsRoutes } from "./routes/comments.js";
import { creatorBlocksRoutes } from "./routes/creatorBlocks.js";
import { creatorsRoutes } from "./routes/creators.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { healthRoutes } from "./routes/health.js";
import { feedRoutes } from "./routes/feed.js";
import { likesRoutes } from "./routes/likes.js";
import { mediaRoutes } from "./routes/media.js";
import { payoutsRoutes } from "./routes/payouts.js";
import { contentKeysRoutes } from "./routes/contentKeys.js";
import { postsRoutes } from "./routes/posts.js";
import { readyRoutes } from "./routes/ready.js";
import type { ReadinessCheck } from "./routes/ready.js";
import { reportsRoutes } from "./routes/reports.js";
import { subscriptionsRoutes } from "./routes/subscriptions.js";
import { tiersRoutes } from "./routes/tiers.js";
import { verificationRoutes } from "./routes/verification.js";
import { webhooksRoutes } from "./routes/webhooks.js";

export interface BuildAppOptions {
  env: Env;
  /** Injected so tests can simulate a database outage without a real Postgres. */
  checkDatabaseConnection: ReadinessCheck;
  /** Injected so tests can simulate a Redis outage; defaults to a no-op — see routes/ready.ts. */
  checkRedisConnection?: ReadinessCheck;
  redis: Redis;
  prisma: PrismaClient;
  oauthClient: OAuthClientLike;
  /** Injected so tests never need a real PDS/network round trip. */
  fetchProfile: (session: OAuthSession) => Promise<AtprotoProfile>;
  publishAtRecord: PublishAtRecord;
  deleteAtRecord: DeleteAtRecord;
  paymentProvider: PaymentProvider;
  payoutProvider: PayoutProvider;
  contentRepository: ContentRepository;
  objectStorage: ObjectStorage;
  mediaProcessor: MediaProcessor;
  /**
   * Creator-owned-PDS rearchitecture (see prompts/creator-owned-pds.md).
   * Present only when `CREATOR_OWNED_GATED_CONTENT_ENABLED` — it powers
   * `POST /content-keys/grant`, the entitlement→decryption-key boundary.
   * Absent → that route replies 501 (gated creator-owned content is a
   * documented, deferred protocol gap).
   */
  keyGrantService?: KeyGrantService;
  /** Phase 14 — automated report-triage hook; see @foryour-fans/moderation's classifiers/types.ts. */
  classifier: ContentClassifier;
  /** Phase 15 — see errorReporting.ts. Defaults to a real, logging-based reporter if omitted. */
  errorReporter?: ErrorReporter;
}

export function buildApp({
  env,
  checkDatabaseConnection,
  checkRedisConnection,
  redis,
  prisma,
  oauthClient,
  fetchProfile,
  publishAtRecord,
  deleteAtRecord,
  paymentProvider,
  payoutProvider,
  contentRepository,
  objectStorage,
  mediaProcessor,
  keyGrantService,
  classifier,
  errorReporter,
}: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      // Silence request/response logs in tests; keep them for dev/prod.
      level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
    },
    genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
    // Phase 15 (Production Hardening) — "request limits". Every body this
    // API actually accepts is small JSON (the largest realistic payload is
    // a post: ~10,000 chars of text plus up to MAX_POST_MEDIA media refs and
    // a handful of tags/langs — well under 64 KiB). Media BYTES never pass
    // through this API at all (Phase 8's presigned-URL flow uploads straight
    // to object storage), so there's no legitimate large body to allow for.
    // 256 KiB leaves generous headroom over the largest real request while
    // still turning an oversized-body attack into an immediate 413 rather
    // than Fastify's much larger 1 MiB default.
    bodyLimit: 256 * 1024,
  });

  app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
  });
  app.register(cookie);

  // Phase 15 — security response headers. This is a JSON API with no HTML
  // rendering surface of its own (the web app, and its own CSP, is a
  // separate PHASE 16 concern — see docs/build-plan.md), so the default
  // HTML-oriented Content-Security-Policy is switched off; every other
  // helmet default (X-Content-Type-Options: nosniff, X-Frame-Options,
  // Strict-Transport-Security, Referrer-Policy, etc.) still applies.
  // crossOriginResourcePolicy is relaxed to "cross-origin" because the web
  // app is a separate origin (CORS_ORIGIN) that legitimately fetches this
  // API — helmet's "same-origin" default would add a header actively
  // fighting the @fastify/cors config two lines up.
  app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  // Phase 15 — "rate limiting counters" (see prompts/full.md's Redis-usage
  // note under Technical preferences). Redis-backed so the limit is shared
  // across every API replica, not per-process — required the moment this
  // modular monolith runs as more than one pod (see apps/api/src/ingest.ts's
  // own doc comment on the same multi-replica assumption). A generous global
  // default (every route is protected) plus a much stricter override on
  // POST /auth/atproto/start below, since that route triggers an outbound
  // handle-resolution + PAR request to a THIRD-PARTY PDS per call — the one
  // route where a flood from here becomes an attack on someone else's
  // infrastructure, not just this one's.
  app.register(rateLimit, {
    global: true,
    // The automated test suite drives hundreds of fastify.inject() calls
    // per run through this same process, all resolving to the same
    // "127.0.0.1" key — a real 300/minute budget would make the suite
    // itself flaky (429s unrelated to whatever a given test is checking).
    // The *mechanism* is still exercised for real in test: the stricter
    // per-route override on POST /auth/atproto/start below is a route-level
    // config that fully replaces this default rather than adding to it, so
    // that route's own test (apps/api/test/auth.test.ts) verifies actual
    // rate-limiting behavior regardless of this number.
    max: env.NODE_ENV === "test" ? 10_000 : 300,
    timeWindow: "1 minute",
    redis,
    // A real deployment sits behind a load balancer/proxy; req.ip alone
    // would key every request to the proxy's own address. Fastify's
    // trustProxy isn't configured here (left to the reverse proxy to strip
    // spoofed headers before they reach this process, a deployment-level
    // concern), so this reads the same header nginx/most LBs set.
    keyGenerator: (request) => (request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? request.ip,
  });

  registerErrorHandler(app, errorReporter ?? new LoggingErrorReporter(app.log));

  // Phase 15 — "metrics". A Prometheus scrape target plus a per-request
  // duration observation on every route (the onResponse hook below) — see
  // metrics.ts for why this uses its own Registry rather than prom-client's
  // process-wide default one.
  const metrics = createMetrics();
  app.register(metricsRoutes, { registry: metrics.registry });
  app.addHook("onResponse", (request, reply, done) => {
    metrics.httpRequestDuration.observe(
      { method: request.method, route: request.routeOptions.url ?? "unknown", status_code: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
    done();
  });

  // Liveness/readiness must never depend on Redis/session resolution —
  // registered directly on the root instance, outside the encapsulated
  // scope below. Also exempt from rate limiting: a Kubernetes probe hammers
  // these on a fixed interval and must never be throttled into a false
  // "unhealthy" reading.
  app.register(healthRoutes);
  app.register(readyRoutes, { checkDatabaseConnection, checkRedisConnection });

  // Public — called by the payment provider, not a logged-in browser. Its
  // own encapsulated scope so its raw-body content-type parser (see
  // routes/webhooks.ts) never applies to any other route.
  app.register(webhooksRoutes, { prisma, paymentProvider });

  // Public and never personalized — no reason to pay for a Redis session
  // lookup on every /discover or /search request, so this stays outside
  // the sessionPlugin scope below, same as health/ready.
  app.register(discoveryRoutes, { prisma });

  // Everything that needs request.session lives in one encapsulated scope
  // so sessionPlugin's onRequest hook (a Redis lookup) only runs for these
  // routes, not for every request — see plugins/session.ts.
  app.register(async (scope) => {
    await sessionPlugin(scope, { redis });

    await scope.register(authRoutes, {
      publicUrl: env.PUBLIC_URL,
      isProduction: env.NODE_ENV === "production",
      redis,
      prisma,
      oauthClient,
      fetchProfile,
      adminDids: env.ADMIN_DIDS,
      // Phase 15 — same test-mode relaxation as the global rate-limit
      // default above, and for the same reason: the Playwright e2e suite
      // (apps/web) drives dozens of real sign-ins through this exact route
      // across many spec files in one process, all sharing one source IP.
      // 200/minute is still a real, bounded ceiling under test — nowhere
      // near "disabled" — just far enough above the suite's current ~20
      // sign-ins to leave room to grow without becoming flaky.
      authStartRateLimitMax: env.NODE_ENV === "test" ? 200 : 10,
    });

    await scope.register(creatorsRoutes, { prisma, publishAtRecord });
    await scope.register(tiersRoutes, { prisma, publishAtRecord, deleteAtRecord });
    await scope.register(subscriptionsRoutes, { prisma, paymentProvider });
    await scope.register(payoutsRoutes, { prisma, payoutProvider });
    await scope.register(dashboardRoutes, { prisma, contentRepository, payoutProvider });
    await scope.register(postsRoutes, { prisma, contentRepository });
    await scope.register(commentsRoutes, { prisma, contentRepository });
    await scope.register(likesRoutes, { prisma, contentRepository });
    await scope.register(mediaRoutes, { prisma, objectStorage, mediaProcessor, contentRepository });
    await scope.register(feedRoutes, { prisma, contentRepository });
    await scope.register(contentKeysRoutes, { prisma, keyGrantService });

    // Phase 14 — Trust and Safety.
    await scope.register(reportsRoutes, { prisma, classifier });
    await scope.register(blocksRoutes, { prisma, publishAtRecord, deleteAtRecord });
    await scope.register(creatorBlocksRoutes, { prisma });
    await scope.register(verificationRoutes, { prisma });
    await scope.register(adminRoutes, { prisma });
  });

  return app;
}
