import type { Creator, PrismaClient, User } from "@foryour-fans/database";
import { NSID } from "@foryour-fans/lexicons";
import { Prisma } from "@foryour-fans/database";
import { AtRecordPublishError, type PublishAtRecord } from "@foryour-fans/atproto";

export class AlreadyACreatorError extends Error {}

export interface CreatorProfileFields {
  displayName?: string;
  bio?: string;
  website?: string;
}

async function publishCreatorProfileRecord(
  publishAtRecord: PublishAtRecord,
  did: string,
  fields: CreatorProfileFields,
  createdAt: Date,
): Promise<void> {
  const record = {
    $type: NSID.profile,
    displayName: fields.displayName,
    bio: fields.bio,
    website: fields.website,
    createdAt: createdAt.toISOString(),
  };

  try {
    await publishAtRecord(did, { collection: NSID.profile, rkey: "self", record });
  } catch (error) {
    throw new AtRecordPublishError("Failed to publish creator profile to the AT network.", error);
  }
}

export interface CreateCreatorInput {
  did: string;
  userId: string;
  profile: CreatorProfileFields;
  siteImages?: {
    avatarUrl?: string | null;
    bannerUrl?: string | null;
  };
}

/**
 * Publishes the fans.foryour.profile AT record FIRST, then creates the local
 * row — becoming a creator is fundamentally a "publish to the open network"
 * action, so a Creator row must never exist locally without a corresponding
 * AT record (see docs/atproto-vs-database.md). If the DB insert then fails
 * (e.g. a one-creator-per-user race), the AT record is left in place — a
 * known, rare, non-corrected edge case; see docs/architecture.md.
 *
 * Becoming a creator is now "mark this DID a creator + publish the profile",
 * nothing more — there is no app-owned name to pick. The public page address
 * is `/c/<handle>` (derived from the DID's AT handle) and `/c/<did>`.
 */
export async function createCreator(
  prisma: PrismaClient,
  publishAtRecord: PublishAtRecord,
  input: CreateCreatorInput,
): Promise<Creator> {
  const existing = await prisma.creator.findUnique({ where: { userId: input.userId } });
  if (existing) {
    throw new AlreadyACreatorError("This user already has a creator account.");
  }

  const now = new Date();
  await publishCreatorProfileRecord(publishAtRecord, input.did, input.profile, now);

  try {
    return await prisma.creator.create({
      data: {
        userId: input.userId,
        did: input.did,
        displayName: input.profile.displayName,
        bio: input.profile.bio,
        website: input.profile.website,
        avatarUrl: input.siteImages?.avatarUrl ?? undefined,
        bannerUrl: input.siteImages?.bannerUrl ?? undefined,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // The only uniqueness left on Creator is userId/did — either way it
      // means this DID is already a creator.
      throw new AlreadyACreatorError("This user already has a creator account.");
    }
    throw error;
  }
}

export interface UpdateCreatorInput {
  profile?: CreatorProfileFields;
}

/**
 * Profile-only. Publishes the merged fans.foryour.profile AT record, then
 * write-through-caches it locally — if the AT write fails, nothing is
 * changed. An empty patch (no profile fields) is a no-op with no network
 * call.
 */
export async function updateCreator(
  prisma: PrismaClient,
  publishAtRecord: PublishAtRecord,
  creator: Creator,
  patch: UpdateCreatorInput,
): Promise<Creator> {
  if (!patch.profile) {
    return creator;
  }

  const merged: CreatorProfileFields = {
    displayName: patch.profile.displayName ?? creator.displayName ?? undefined,
    bio: patch.profile.bio ?? creator.bio ?? undefined,
    website: patch.profile.website ?? creator.website ?? undefined,
  };
  await publishCreatorProfileRecord(publishAtRecord, creator.did, merged, creator.createdAt);

  return prisma.creator.update({
    where: { id: creator.id },
    data: {
      displayName: patch.profile.displayName,
      bio: patch.profile.bio,
      website: patch.profile.website,
    },
  });
}

/**
 * The outcome of resolving a `/c/<identifier>` address:
 *  - `found`     — the identifier names an active creator right now.
 *  - `moved`     — the identifier is a handle this creator's DID used to
 *                  publish; callers should 301 to `/c/<currentHandle>`.
 *  - `not-found` — nothing matches (including a suspended creator).
 */
export type CreatorWithUser = Creator & { user: User };

export type CreatorResolution =
  | { status: "found"; creator: CreatorWithUser }
  | { status: "moved"; creator: CreatorWithUser; currentHandle: string; did: string }
  | { status: "not-found" };

/**
 * Resolves a DID or an AT handle to a creator, in this order:
 *   1. `did:` prefix           → look up Creator by `did`.
 *   2. otherwise (a handle)     → the Creator whose cached `User.handle`
 *      currently equals it (lowercased). This is the local cache, not a live
 *      PDS resolution — deliberately, to keep a network dependency off this
 *      public hot path (Phase 10 owns real indexing).
 *   3. no current match         → look in `CreatorHandleHistory` for a
 *      `previousHandle` equal to it and follow that row's `did` to the
 *      creator who holds that handle-lineage now → `moved`.
 *   4. still nothing            → `not-found`.
 *
 * Step 3 disambiguation: a handle can be freed and re-registered by a
 * different DID over time, so several history rows may share one
 * `previousHandle`. We walk them most-recent-`recordedAt` first and take the
 * first whose creator is still ACTIVE and whose *current* handle differs
 * from the one being looked up (if the handle has since cycled back to that
 * same DID, it's a live match handled by step 2, not a redirect).
 */
export async function resolveCreatorByIdentifier(
  prisma: PrismaClient,
  identifier: string,
): Promise<CreatorResolution> {
  if (identifier.startsWith("did:")) {
    const creator = await prisma.creator.findUnique({
      where: { did: identifier },
      include: { user: true },
    });
    return creator && creator.status === "ACTIVE"
      ? { status: "found", creator }
      : { status: "not-found" };
  }

  const handle = identifier.toLowerCase();

  const current = await prisma.creator.findFirst({
    where: { user: { handle } },
    include: { user: true },
  });
  if (current && current.status === "ACTIVE") {
    return { status: "found", creator: current };
  }

  const history = await prisma.creatorHandleHistory.findMany({
    where: { previousHandle: handle },
    orderBy: { recordedAt: "desc" },
    include: { creator: { include: { user: true } } },
  });
  for (const row of history) {
    const creator = row.creator;
    if (!creator || creator.status !== "ACTIVE") continue;
    const currentHandle = creator.user.handle;
    if (!currentHandle || currentHandle.toLowerCase() === handle) continue;
    return { status: "moved", creator, currentHandle, did: row.did };
  }

  return { status: "not-found" };
}

/**
 * Thin wrapper for the routes that just need "the active creator for this
 * identifier" and don't redirect (subscribe, tiers, posts). A former handle
 * still resolves — it follows the DID to the current creator.
 */
export async function findActiveCreatorByIdentifier(
  prisma: PrismaClient,
  identifier: string,
): Promise<Creator | null> {
  const resolution = await resolveCreatorByIdentifier(prisma, identifier);
  return resolution.status === "not-found" ? null : resolution.creator;
}
