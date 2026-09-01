import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import type { OAuthClientLike, AtprotoProfile } from "@foryour-fans/atproto";
import type { PrismaClient } from "@foryour-fans/database";
import Fastify, { type FastifyInstance } from "fastify";
import type { OAuthSession } from "@atproto/oauth-client-node";
import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { Env } from "./config/env.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { readyRoutes } from "./routes/ready.js";
import type { ReadinessCheck } from "./routes/ready.js";

export interface BuildAppOptions {
  env: Env;
  /** Injected so tests can simulate a database outage without a real Postgres. */
  checkDatabaseConnection: ReadinessCheck;
  redis: Redis;
  prisma: PrismaClient;
  oauthClient: OAuthClientLike;
  /** Injected so tests never need a real PDS/network round trip. */
  fetchProfile: (session: OAuthSession) => Promise<AtprotoProfile>;
}

export function buildApp({
  env,
  checkDatabaseConnection,
  redis,
  prisma,
  oauthClient,
  fetchProfile,
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

  app.register(healthRoutes);
  app.register(readyRoutes, { checkDatabaseConnection });
  app.register(authRoutes, {
    publicUrl: env.PUBLIC_URL,
    isProduction: env.NODE_ENV === "production",
    redis,
    prisma,
    oauthClient,
    fetchProfile,
  });

  return app;
}
