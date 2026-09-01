import "dotenv/config";
import { createOAuthClient, fetchProfile } from "@foryour-fans/atproto";
import { createPrismaSessionStore, createRedisStateStore } from "@foryour-fans/auth";
import { getPrismaClient } from "@foryour-fans/database";
import { getRedisClient } from "@foryour-fans/shared";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const prisma = getPrismaClient();
const redis = getRedisClient(env.REDIS_URL);

const oauthClient = await createOAuthClient({
  config: {
    publicUrl: env.PUBLIC_URL,
    mode: env.ATPROTO_OAUTH_MODE,
    privateKeyPem: env.ATPROTO_OAUTH_PRIVATE_KEY,
  },
  stateStore: createRedisStateStore(redis),
  sessionStore: createPrismaSessionStore(prisma),
});

const app = buildApp({
  env,
  checkDatabaseConnection: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  redis,
  prisma,
  oauthClient,
  fetchProfile,
});

async function start(): Promise<void> {
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  try {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  } catch (error) {
    app.log.error(error, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void start();
