import "dotenv/config";
import {
  createOAuthClient,
  getRecord,
  putRecord,
  type PublishAtRecord,
  type ReadAtRecord,
} from "@foryour-fans/atproto";
import { createPrismaSessionStore, createRedisStateStore } from "@foryour-fans/auth";
import { migrateCreatorContentToPds } from "@foryour-fans/content";
import { getPrismaClient } from "@foryour-fans/database";
import { getRedisClient } from "@foryour-fans/shared";
import pino from "pino";
import { loadEnv } from "../config/env.js";

/**
 * One-off: migrate existing app-authoritative creator content to each
 * creator's own PDS (prompts/creator-owned-pds.md "Migration Plan").
 *
 *   node dist/scripts/migrateToPds.js [did ...]
 *
 * With no args, walks every creator. Conservative: a creator with no
 * restorable OAuth session is reported `migration_required` and left
 * completely untouched. GATED posts are counted but NOT migrated (the
 * documented protocol gap). Nothing local is deleted — a later migration
 * removes the now-redundant authoritative columns once round-trips are
 * confirmed in the field.
 */

const env = loadEnv();
const prisma = getPrismaClient();
const redis = getRedisClient(env.REDIS_URL);
const log = pino({ level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL });

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
const readAtRecord: ReadAtRecord = async (did, params) => {
  const session = await oauthClient.restore(did);
  return getRecord(session, params);
};
const hasOAuthSession = async (did: string): Promise<boolean> => {
  try {
    await oauthClient.restore(did);
    return true;
  } catch {
    return false;
  }
};

async function main(): Promise<void> {
  const argDids = process.argv.slice(2);
  const dids =
    argDids.length > 0
      ? argDids
      : (await prisma.creator.findMany({ select: { did: true } })).map((c) => c.did);

  log.info({ count: dids.length }, "starting creator-owned-PDS migration");
  let migrated = 0;
  let needsReauth = 0;
  for (const did of dids) {
    try {
      const result = await migrateCreatorContentToPds(
        { prisma, publishAtRecord, readAtRecord, hasOAuthSession, sourceApp: "foryour.fans", appEndpoint: env.PUBLIC_URL },
        did,
      );
      log.info({ result }, `migrated ${did}`);
      if (result.status === "migration_required") needsReauth += 1;
      else migrated += 1;
    } catch (error) {
      log.error({ err: error, did }, "migration failed for creator — local data left untouched");
    }
  }
  log.info({ migrated, needsReauth, total: dids.length }, "migration complete");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
  redis.disconnect();
}
