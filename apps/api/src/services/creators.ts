import type { Creator, PrismaClient } from "@foryour-fans/database";
import { NSID } from "@foryour-fans/lexicons";
import { Prisma } from "@foryour-fans/database";

/** Public routes/pages this app already owns, plus obvious squatting targets. */
const RESERVED_SLUGS = new Set([
  "api",
  "admin",
  "login",
  "logout",
  "dashboard",
  "become-a-creator",
  "creator",
  "creators",
  "discover",
  "search",
  "settings",
  "help",
  "support",
  "about",
  "terms",
  "privacy",
  "static",
  "assets",
  "c",
  "www",
  "me",
  "health",
  "ready",
  "null",
  "undefined",
]);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

/** A creator may change their slug at most this often — see docs/architecture.md "Slugs". */
const SLUG_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export class SlugValidationError extends Error {}
export class SlugCooldownError extends Error {}
export class SlugTakenError extends Error {}
export class AlreadyACreatorError extends Error {}
export class AtRecordPublishError extends Error {
  constructor(message: string, readonly cause: unknown) {
    super(message);
  }
}

export function validateSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new SlugValidationError(
      "Slug must be 3-32 characters, lowercase letters/numbers/hyphens only, and can't start or end with a hyphen.",
    );
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new SlugValidationError(`"${slug}" is a reserved word and can't be used as a slug.`);
  }
}

export interface CreatorProfileFields {
  displayName?: string;
  bio?: string;
  website?: string;
}

export interface PublishAtRecord {
  (did: string, params: { collection: string; rkey: string; record: Record<string, unknown> }): Promise<{
    uri: string;
    cid: string;
  }>;
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
  slug: string;
  profile: CreatorProfileFields;
}

/**
 * Publishes the dev.creator.profile AT record FIRST, then creates the local
 * row — becoming a creator is fundamentally a "publish to the open network"
 * action, so a Creator row must never exist locally without a corresponding
 * AT record (see docs/atproto-vs-database.md). If the DB insert then fails
 * (e.g. a slug uniqueness race), the AT record is left in place — a known,
 * rare, non-corrected edge case; see docs/architecture.md.
 */
export async function createCreator(
  prisma: PrismaClient,
  publishAtRecord: PublishAtRecord,
  input: CreateCreatorInput,
): Promise<Creator> {
  validateSlug(input.slug);

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
        slug: input.slug,
        displayName: input.profile.displayName,
        bio: input.profile.bio,
        website: input.profile.website,
        // slugUpdatedAt stays null: the initial pick isn't a "change".
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // A concurrent request could race on either constraint — inspect
      // which one actually fired rather than assuming it's the slug.
      const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
      if (target.includes("userId")) {
        throw new AlreadyACreatorError("This user already has a creator account.");
      }
      throw new SlugTakenError(`Slug "${input.slug}" is already taken.`);
    }
    throw error;
  }
}

export interface UpdateCreatorInput {
  slug?: string;
  profile?: CreatorProfileFields;
}

/**
 * Only writes the AT record if a profile field was actually included in the
 * patch — an update touching only `slug` never talks to the network. If the
 * AT write fails, nothing (including the slug) is changed: the whole PATCH
 * is atomic, so a flaky PDS never leaves the local cache diverged from what
 * was actually published.
 */
export async function updateCreator(prisma: PrismaClient, publishAtRecord: PublishAtRecord, creator: Creator, patch: UpdateCreatorInput): Promise<Creator> {
  let slugUpdatedAt: Date | undefined;

  if (patch.slug !== undefined && patch.slug !== creator.slug) {
    validateSlug(patch.slug);

    if (creator.slugUpdatedAt) {
      const elapsedMs = Date.now() - creator.slugUpdatedAt.getTime();
      if (elapsedMs < SLUG_CHANGE_COOLDOWN_MS) {
        const daysLeft = Math.ceil((SLUG_CHANGE_COOLDOWN_MS - elapsedMs) / (24 * 60 * 60 * 1000));
        throw new SlugCooldownError(`Slug can only be changed once every 7 days. Try again in ${daysLeft} day(s).`);
      }
    }
    slugUpdatedAt = new Date();
  }

  if (patch.profile) {
    const merged: CreatorProfileFields = {
      displayName: patch.profile.displayName ?? creator.displayName ?? undefined,
      bio: patch.profile.bio ?? creator.bio ?? undefined,
      website: patch.profile.website ?? creator.website ?? undefined,
    };
    await publishCreatorProfileRecord(publishAtRecord, creator.did, merged, creator.createdAt);
  }

  try {
    return await prisma.creator.update({
      where: { id: creator.id },
      data: {
        slug: patch.slug,
        slugUpdatedAt,
        displayName: patch.profile?.displayName,
        bio: patch.profile?.bio,
        website: patch.profile?.website,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SlugTakenError(`Slug "${patch.slug}" is already taken.`);
    }
    throw error;
  }
}

export type CreatorIdentifierKind = "did" | "handle" | "slug";

export function classifyIdentifier(identifier: string): CreatorIdentifierKind {
  if (identifier.startsWith("did:")) return "did";
  if (identifier.includes(".")) return "handle";
  return "slug";
}

/**
 * Handle-shaped identifiers resolve via the locally cached User.handle, not
 * a live network resolution — see docs/architecture.md "Creator identifier
 * resolution" for why (avoids a network dependency on a public hot path;
 * proper indexing arrives in Phase 10).
 */
export async function findActiveCreatorByIdentifier(prisma: PrismaClient, identifier: string): Promise<Creator | null> {
  const kind = classifyIdentifier(identifier);

  const creator = await (kind === "did"
    ? prisma.creator.findUnique({ where: { did: identifier } })
    : kind === "slug"
      ? prisma.creator.findUnique({ where: { slug: identifier } })
      : prisma.creator.findFirst({ where: { user: { handle: identifier } } }));

  return creator && creator.status === "ACTIVE" ? creator : null;
}
