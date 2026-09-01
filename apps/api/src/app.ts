import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import type { AtprotoProfile, OAuthClientLike } from "@foryour-fans/atproto";
import type { PrismaClient } from "@foryour-fans/database";
import type { OAuthSession } from "@atproto/oauth-client-node";
import Fastify, { type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { Env } from "./config/env.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { sessionPlugin } from "./plugins/session.js";
import { authRoutes } from "./routes/auth.js";
import { creatorsRoutes } from "./routes/creators.js";
import { healthRoutes } from "./routes/health.js";
import { readyRoutes } from "./routes/ready.js";
import type { ReadinessCheck } from "./routes/ready.js";
import type { PublishAtRecord } from "./services/creators.js";

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
}

export function buildApp({
  env,
  checkDatabaseConnection,
  redis,
  prisma,
  oauthClient,
  fetchProfile,
  publishAtRecord,
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
  });

  return app;
}
