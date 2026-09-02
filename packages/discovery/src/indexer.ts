import type { PrismaClient } from "@foryour-fans/database";
import { NSID } from "@foryour-fans/lexicons";
import type { CommitEvent } from "./jetstreamTypes.js";

/** Matches packages/atproto/src/identity.ts#resolveDid's return shape — injected so tests never make a real network call. */
export type ResolveDid = (did: string) => Promise<{ handle: string | null; pdsUrl: string | null }>;

function uriFor(event: CommitEvent): string {
  return `at://${event.did}/${event.collection}/${event.rkey}`;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function applyProfileEvent(prisma: PrismaClient, resolveDid: ResolveDid, event: CommitEvent): Promise<void> {
  if (event.operation === "delete") {
    await prisma.indexedCreatorProfile.deleteMany({ where: { did: event.did } });
    return;
  }

  const record = event.record ?? {};
  const { handle } = await resolveDid(event.did);

  await prisma.indexedCreatorProfile.upsert({
    where: { did: event.did },
    create: {
      did: event.did,
      handle,
      displayName: typeof record.displayName === "string" ? record.displayName : null,
      bio: typeof record.bio === "string" ? record.bio : null,
      website: typeof record.website === "string" ? record.website : null,
      atCreatedAt: parseDate(record.createdAt),
    },
    update: {
      handle,
      displayName: typeof record.displayName === "string" ? record.displayName : null,
      bio: typeof record.bio === "string" ? record.bio : null,
      website: typeof record.website === "string" ? record.website : null,
      atCreatedAt: parseDate(record.createdAt),
    },
  });
}

async function applyPostEvent(prisma: PrismaClient, event: CommitEvent): Promise<void> {
  const uri = uriFor(event);

  if (event.operation === "delete") {
    await prisma.indexedPost.deleteMany({ where: { uri } });
    return;
  }

  const record = event.record ?? {};
  if (typeof record.text !== "string") {
    // Malformed against the lexicon's own required field — skip rather
    // than index a post with no body.
    return;
  }

  await prisma.indexedPost.upsert({
    where: { uri },
    create: { uri, did: event.did, text: record.text, atCreatedAt: parseDate(record.createdAt) },
    update: { text: record.text, atCreatedAt: parseDate(record.createdAt) },
  });
}

async function applyTierEvent(prisma: PrismaClient, event: CommitEvent): Promise<void> {
  const uri = uriFor(event);

  if (event.operation === "delete") {
    await prisma.indexedTier.deleteMany({ where: { uri } });
    return;
  }

  const record = event.record ?? {};
  if (typeof record.name !== "string") {
    return;
  }

  const data = {
    did: event.did,
    name: record.name,
    description: typeof record.description === "string" ? record.description : null,
    monthlyPrice: typeof record.monthlyPrice === "number" ? record.monthlyPrice : null,
    currency: typeof record.currency === "string" ? record.currency : null,
    sortOrder: typeof record.sortOrder === "number" ? record.sortOrder : null,
    atCreatedAt: parseDate(record.createdAt),
  };

  await prisma.indexedTier.upsert({
    where: { uri },
    create: { uri, ...data },
    update: data,
  });
}

/**
 * The single entry point every parsed commit event flows through — routes
 * on `collection`, applying the create/update-as-upsert-or-delete rule
 * for whichever of the three fans.foryour.* record types it is. Any other
 * collection is a no-op (the live Jetstream subscription is filtered to
 * just these three, but this stays defensive rather than assuming the
 * filter is airtight).
 */
export async function applyCommitEvent(prisma: PrismaClient, resolveDid: ResolveDid, event: CommitEvent): Promise<void> {
  switch (event.collection) {
    case NSID.profile:
      return applyProfileEvent(prisma, resolveDid, event);
    case NSID.post:
      return applyPostEvent(prisma, event);
    case NSID.tier:
      return applyTierEvent(prisma, event);
    default:
      return;
  }
}
