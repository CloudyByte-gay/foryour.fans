import type { PrismaClient } from "@foryour-fans/database";
import { NSID } from "@foryour-fans/lexicons";
import { nextTid, type PublishAtRecord, type ReadAtRecord } from "@foryour-fans/atproto";

/**
 * One-off migration of a creator's app-authoritative content to their own
 * PDS (prompts/creator-owned-pds.md "Migration Plan"). Conservative by
 * design:
 *
 *  1. If the creator has no usable AT OAuth session, do NOTHING and report
 *     `migration_required` — never delete or de-authoritize local data
 *     until they reauthorize and the PDS write succeeds.
 *  2. Publish profile / serviceConfig / tiers / PUBLIC posts to the repo.
 *  3. Read each written record back (`verify`) before flipping the local
 *     row to `isAuthoritative = false`. A failed round-trip leaves the row
 *     authoritative and is reported.
 *  4. GATED (SUBSCRIBERS/TIER) posts are counted as `gatedDeferred`, not
 *     migrated — encrypted-creator-owned storage is a documented protocol
 *     gap (docs/creator-owned-pds.md §4/§7). Local data is untouched.
 *
 * The one-off CLI wrapper is apps/api/src/scripts/migrateToPds.ts.
 */

export interface MigrationDeps {
  prisma: PrismaClient;
  publishAtRecord: PublishAtRecord;
  readAtRecord: ReadAtRecord;
  /** Returns true if `did` has a restorable AT OAuth session. */
  hasOAuthSession: (did: string) => Promise<boolean>;
  sourceApp: string;
  /** Public base URL of this app, for serviceConfig. */
  appEndpoint: string;
}

export interface MigrationResult {
  did: string;
  status: "migrated" | "migration_required" | "partial";
  profilePublished: boolean;
  serviceConfigPublished: boolean;
  tiersMigrated: number;
  postsMigrated: number;
  gatedDeferred: number;
  verifyFailures: string[];
  reason?: string;
}

const BSKY_FEED_POST = "app.bsky.feed.post";

export async function migrateCreatorContentToPds(deps: MigrationDeps, did: string): Promise<MigrationResult> {
  const { prisma, publishAtRecord, readAtRecord } = deps;
  const result: MigrationResult = {
    did,
    status: "migrated",
    profilePublished: false,
    serviceConfigPublished: false,
    tiersMigrated: 0,
    postsMigrated: 0,
    gatedDeferred: 0,
    verifyFailures: [],
  };

  const creator = await prisma.creator.findUnique({ where: { did }, include: { user: true } });
  if (!creator) {
    return { ...result, status: "migration_required", reason: "no local creator row" };
  }

  if (!(await deps.hasOAuthSession(did))) {
    return { ...result, status: "migration_required", reason: "no AT OAuth session — creator must reauthorize" };
  }

  const now = new Date().toISOString();

  // Profile
  if (!creator.profileSourceUri) {
    const record: Record<string, unknown> = { $type: NSID.profile, createdAt: creator.createdAt.toISOString() };
    if (creator.displayName) record.displayName = creator.displayName;
    if (creator.bio) record.bio = creator.bio;
    if (creator.website) record.website = creator.website;
    const { uri, cid } = await publishAtRecord(did, { collection: NSID.profile, rkey: "self", record });
    if (await verify(readAtRecord, did, NSID.profile, "self")) {
      await prisma.creator.update({
        where: { did },
        data: { profileSourceUri: uri, profileSourceCid: cid, pdsSyncedAt: new Date() },
      });
      result.profilePublished = true;
    } else {
      result.verifyFailures.push(uri);
    }
  }

  // Service config
  if (!creator.serviceConfigUri) {
    const { uri } = await publishAtRecord(did, {
      collection: NSID.serviceConfig,
      rkey: "self",
      record: {
        $type: NSID.serviceConfig,
        primaryAppEndpoint: deps.appEndpoint,
        keyGrantEndpoint: `${deps.appEndpoint.replace(/\/$/, "")}/api/content-keys/grant`,
        createdAt: now,
      },
    });
    if (await verify(readAtRecord, did, NSID.serviceConfig, "self")) {
      await prisma.creator.update({ where: { did }, data: { serviceConfigUri: uri } });
      result.serviceConfigPublished = true;
    } else {
      result.verifyFailures.push(uri);
    }
  }

  // Tiers
  const tiers = await prisma.subscriptionTier.findMany({
    where: { creatorId: creator.id, isActive: true, sourceUri: null },
  });
  for (const tier of tiers) {
    const { uri, cid } = await publishAtRecord(did, {
      collection: NSID.tier,
      rkey: tier.atRkey,
      record: {
        $type: NSID.tier,
        name: tier.name,
        ...(tier.description ? { description: tier.description } : {}),
        monthlyPrice: tier.priceCents,
        currency: tier.currency.trim(),
        sortOrder: tier.sortOrder,
        createdAt: tier.createdAt.toISOString(),
      },
    });
    if (await verify(readAtRecord, did, NSID.tier, tier.atRkey)) {
      await prisma.subscriptionTier.update({
        where: { id: tier.id },
        data: { sourceUri: uri, sourceCid: cid, isAuthoritative: false },
      });
      result.tiersMigrated += 1;
    } else {
      result.verifyFailures.push(uri);
    }
  }

  // Posts
  const posts = await prisma.post.findMany({
    where: { creatorId: creator.id, deletedAt: null, isAuthoritative: true },
  });
  for (const post of posts) {
    if (post.visibility !== "PUBLIC") {
      result.gatedDeferred += 1;
      continue;
    }
    const bskyRkey = nextTid();
    const bsky = await publishAtRecord(did, {
      collection: BSKY_FEED_POST,
      rkey: bskyRkey,
      record: { $type: BSKY_FEED_POST, text: post.text, createdAt: post.createdAt.toISOString() },
    });
    const postRkey = post.atRkey ?? nextTid();
    const postUri = `at://${did}/${NSID.post}/${postRkey}`;
    const { uri, cid } = await publishAtRecord(did, {
      collection: NSID.post,
      rkey: postRkey,
      record: {
        $type: NSID.post,
        text: post.text,
        visibility: "public",
        createdAt: post.createdAt.toISOString(),
        sourceApp: deps.sourceApp,
        bskyUri: bsky.uri,
        bskyCid: bsky.cid,
        canonicalUri: postUri,
      },
    });
    if (await verify(readAtRecord, did, NSID.post, postRkey)) {
      await prisma.post.update({
        where: { id: post.id },
        data: {
          atRkey: postRkey,
          sourceUri: uri,
          sourceCid: cid,
          bskyUri: bsky.uri,
          bskyCid: bsky.cid,
          isAuthoritative: false,
          indexedAt: new Date(),
        },
      });
      result.postsMigrated += 1;
    } else {
      result.verifyFailures.push(uri);
    }
  }

  if (result.verifyFailures.length > 0) {
    result.status = "partial";
    result.reason = "some records failed a post-write round-trip read; their local rows remain authoritative";
  }
  return result;
}

async function verify(
  readAtRecord: ReadAtRecord,
  did: string,
  collection: string,
  rkey: string,
): Promise<boolean> {
  const record = await readAtRecord(did, { collection, rkey, repo: did });
  return record !== null;
}
