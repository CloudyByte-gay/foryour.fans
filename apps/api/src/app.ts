import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import type { AtprotoProfile, DeleteAtRecord, OAuthClientLike, PublishAtRecord } from "@foryour-fans/atproto";
import type { ContentRepository } from "@foryour-fans/content";
import type { PrismaClient } from "@foryour-fans/database";
import type { MediaProcessor, ObjectStorage } from "@foryour-fans/media";
import type { KeyGrantService, PaymentProvider, PayoutProvider } from "@foryour-fans/subscriptions";
import type { OAuthSession } from "@atproto/oauth-client-node";
import Fastify, { type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { Env } from "./config/env.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { sessionPlugin } from "./plugins/session.js";
import { authRoutes } from "./routes/auth.js";
import { creatorsRoutes } from "./routes/creators.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { healthRoutes } from "./routes/health.js";
import { feedRoutes } from "./routes/feed.js";
import { mediaRoutes } from "./routes/media.js";
import { payoutsRoutes } from "./routes/payouts.js";
import { contentKeysRoutes } from "./routes/contentKeys.js";
import { postsRoutes } from "./routes/posts.js";
import { readyRoutes } from "./routes/ready.js";
import type { ReadinessCheck } from "./routes/ready.js";
import { subscriptionsRoutes } from "./routes/subscriptions.js";
import { tiersRoutes } from "./routes/tiers.js";
import { webhooksRoutes } from "./routes/webhooks.js";

export interface BuildAppOptions {
  env: Env;
  /** Injected so tests can simulate a database outage without a real Postgres. */
  checkDatabaseConnection: ReadinessCheck;
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
}

export function buildApp({
  env,
  checkDatabaseConnection,
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
}: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      // Silence request/response logs in tests; keep them for dev/prod.
      level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
    },
    genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
  });

  app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
  });
  app.register(cookie);

  registerErrorHandler(app);

  // Liveness/readiness must never depend on Redis/session resolution —
  // registered directly on the root instance, outside the encapsulated
  // scope below.
  app.register(healthRoutes);
  app.register(readyRoutes, { checkDatabaseConnection });

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
    });

    await scope.register(creatorsRoutes, { prisma, publishAtRecord });
    await scope.register(tiersRoutes, { prisma, publishAtRecord, deleteAtRecord });
    await scope.register(subscriptionsRoutes, { prisma, paymentProvider });
    await scope.register(payoutsRoutes, { prisma, payoutProvider });
    await scope.register(postsRoutes, { prisma, contentRepository });
    await scope.register(mediaRoutes, { prisma, objectStorage, mediaProcessor });
    await scope.register(feedRoutes, { prisma, contentRepository });
    await scope.register(contentKeysRoutes, { prisma, keyGrantService });
  });

  return app;
}
