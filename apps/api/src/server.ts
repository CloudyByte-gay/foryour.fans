import "dotenv/config";
import {
  createOAuthClient,
  deleteRecord,
  fetchProfile,
  putRecord,
  type DeleteAtRecord,
  type PublishAtRecord,
} from "@foryour-fans/atproto";
import { createPrismaSessionStore, createRedisStateStore } from "@foryour-fans/auth";
import { getPrismaClient } from "@foryour-fans/database";
import { getRedisClient } from "@foryour-fans/shared";
import { FakePaymentProvider, FakePayoutProvider } from "@foryour-fans/subscriptions";
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

const publishAtRecord: PublishAtRecord = async (did, params) => {
  const session = await oauthClient.restore(did);
  return putRecord(session, params);
};

const deleteAtRecord: DeleteAtRecord = async (did, params) => {
  const session = await oauthClient.restore(did);
  return deleteRecord(session, params);
};

// The only PaymentProvider/PayoutProvider implementations that exist —
// real money must never move through these. See prompts/full.md's Phase 6
// note on why a real processor isn't chosen here, and Phase 14's note that
// enabling a real one must be gated on creator verification once one exists.
const paymentProvider = new FakePaymentProvider();
const payoutProvider = new FakePayoutProvider();

const app = buildApp({
  env,
  checkDatabaseConnection: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  redis,
  prisma,
  oauthClient,
  fetchProfile,
  publishAtRecord,
  deleteAtRecord,
  paymentProvider,
  payoutProvider,
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
