import "dotenv/config";
import {
  createOAuthClient,
  deleteRecord,
  fetchProfile,
  getRecord,
  listRecords,
  putRecord,
  resolveHandle,
  type DeleteAtRecord,
  type ListAtRecords,
  type PublishAtRecord,
  type ReadAtRecord,
  type ResolveHandleToDid,
} from "@foryour-fans/atproto";
import { createPrismaSessionStore, createRedisStateStore } from "@foryour-fans/auth";
import { CreatorOwnedContentRepository, PrivateContentRepository, type ContentRepository } from "@foryour-fans/content";
import { getPrismaClient } from "@foryour-fans/database";
import {
  generateContentKey,
  encryptText,
  PassthroughMediaProcessor,
  S3ObjectStorage,
  unwrapContentKey,
  wrapContentKey,
} from "@foryour-fans/media";
import { PassthroughContentClassifier } from "@foryour-fans/moderation";
import { getRedisClient } from "@foryour-fans/shared";
import { FakePaymentProvider, FakePayoutProvider, KeyGrantService } from "@foryour-fans/subscriptions";
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

const readAtRecord: ReadAtRecord = async (did, params) => {
  const session = await oauthClient.restore(did);
  return getRecord(session, params);
};

const listAtRecords: ListAtRecords = async (did, params) => {
  const session = await oauthClient.restore(did);
  return listRecords(session, params);
};

// The only PaymentProvider/PayoutProvider implementations that exist —
// real money must never move through these. See prompts/full.md's Phase 6
// note on why a real processor isn't chosen here, and Phase 14's note that
// enabling a real one must be gated on creator verification once one exists.
const paymentProvider = new FakePaymentProvider();
const payoutProvider = new FakePayoutProvider();
// Phase 14 — the only ContentClassifier implementation that exists; see
// @foryour-fans/moderation's classifiers/types.ts.
const classifier = new PassthroughContentClassifier();

// Content repository selection (prompts/creator-owned-pds.md). Default:
// PrivateContentRepository (Phases 1–10 behaviour, Postgres-authoritative).
// With CREATOR_OWNED_PDS_ENABLED: CreatorOwnedContentRepository — public
// posts dual-publish to the creator's own PDS and Postgres is a rebuildable
// cache. Gated content only leaves Postgres when
// CREATOR_OWNED_GATED_CONTENT_ENABLED is also set (see docs/creator-owned-pds.md
// for why that stays off by default). AtprotoSpacesContentRepository is
// still defined but never wired, gated behind ATPROTO_SPACES_ENABLED.
const gatedEnabled = env.CREATOR_OWNED_GATED_CONTENT_ENABLED;
const contentCrypto = gatedEnabled
  ? {
      generateContentKey,
      encryptText: (text: string, key: Buffer) => encryptText(text, key),
      wrapKey: (key: Buffer) => wrapContentKey(key, env.CONTENT_KEY_WRAP_SECRET!),
    }
  : null;

// Resolves an `@handle` in public post text to a DID for a Bluesky mention
// facet (prompts/bluesky-public-posts.md). Bidirectionally verified via
// resolveHandle; an unresolvable handle just stays plain text.
const resolveHandleToDid: ResolveHandleToDid = async (handle) => {
  try {
    return (await resolveHandle(handle)).did;
  } catch {
    return null;
  }
};

const contentRepository: ContentRepository = env.CREATOR_OWNED_PDS_ENABLED
  ? new CreatorOwnedContentRepository(prisma, {
      publishAtRecord,
      deleteAtRecord,
      readAtRecord,
      listAtRecords,
      crypto: contentCrypto,
      resolveHandleToDid,
      config: { sourceApp: "foryour.fans", gatedContentEnabled: gatedEnabled },
    })
  : new PrivateContentRepository(prisma, publishAtRecord, deleteAtRecord);

const keyGrantService = gatedEnabled
  ? new KeyGrantService(prisma, (wrapped) => unwrapContentKey(wrapped, env.CONTENT_KEY_WRAP_SECRET!))
  : undefined;

// The real Phase 8 implementations — see packages/media. S3ObjectStorage
// speaks the S3 API itself (via @aws-sdk/client-s3), not a MinIO-specific
// SDK, so it's expected to work unmodified against Cloudflare R2 or GCS's
// S3-compatible endpoint in production; only the S3_* env vars change.
const objectStorage = new S3ObjectStorage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  bucket: env.S3_BUCKET,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});
const mediaProcessor = new PassthroughMediaProcessor();

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
  contentRepository,
  objectStorage,
  mediaProcessor,
  keyGrantService,
  classifier,
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
