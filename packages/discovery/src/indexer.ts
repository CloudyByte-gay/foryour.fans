import type { PrismaClient } from "@foryour-fans/database";
import { BSKY_NSID, NSID } from "@foryour-fans/lexicons";
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

  // The custom record carries the pairing (`bskyUri`) — record it so
  // packages/discovery/src/merge.ts can collapse the dual-published pair.
  const bskyUri = typeof record.bskyUri === "string" ? record.bskyUri : null;

  await prisma.indexedPost.upsert({
    where: { uri },
    create: {
      uri,
      did: event.did,
      collection: NSID.post,
      text: record.text,
      bskyUri,
      cid: event.cid ?? null,
      atCreatedAt: parseDate(record.createdAt),
    },
    update: {
      collection: NSID.post,
      text: record.text,
      bskyUri,
      cid: event.cid ?? null,
      atCreatedAt: parseDate(record.createdAt),
    },
  });
}

/**
 * `app.bsky.feed.post` — the paired Bluesky copy of a dual-published public
 * post (prompts/bluesky-public-posts.md, docs/bluesky-public-posts.md §6).
 * `wantedCollections` can only filter by collection, not DID, so this is
 * ingested ONLY when apps/api's ingest process is started with
 * `INDEX_BSKY_POSTS` — and even then, we only index events for a DID this
 * app already knows (has an `IndexedCreatorProfile` or a local `Creator`
 * row), so a global firehose subscription doesn't fill the table with the
 * whole network's posts.
 */
async function applyBskyPostEvent(prisma: PrismaClient, event: CommitEvent): Promise<void> {
  const uri = uriFor(event);

  if (event.operation === "delete") {
    await prisma.indexedPost.deleteMany({ where: { uri } });
    return;
  }

  const record = event.record ?? {};
  if (typeof record.text !== "string") {
    return;
  }

  const [profile, creator] = await Promise.all([
    prisma.indexedCreatorProfile.findUnique({ where: { did: event.did }, select: { did: true } }),
    prisma.creator.findUnique({ where: { did: event.did }, select: { did: true } }),
  ]);
  if (!profile && !creator) {
    // Not a DID this app tracks — drop it.
    return;
  }

  await prisma.indexedPost.upsert({
    where: { uri },
    create: {
      uri,
      did: event.did,
      collection: BSKY_NSID.feedPost,
      text: record.text,
      cid: event.cid ?? null,
      atCreatedAt: parseDate(record.createdAt),
    },
    update: {
      collection: BSKY_NSID.feedPost,
      text: record.text,
      cid: event.cid ?? null,
      atCreatedAt: parseDate(record.createdAt),
    },
  });
}

/**
 * `fans.foryour.like` — a like held in the LIKER's own repo (see
 * packages/content/src/likeService.ts). Always ingested (it's a low-volume,
 * app-authored NSID). Feeds `IndexedLike`, the like-count rebuild path: a like
 * can't be re-derived from the creator's own collections, so this is the only
 * way public counts survive a cache rebuild — the same model the Bluesky
 * AppView uses over the firehose. Match to a local post by `subjectUri` only.
 */
async function applyLikeEvent(prisma: PrismaClient, event: CommitEvent): Promise<void> {
  const uri = uriFor(event);

  if (event.operation === "delete") {
    await prisma.indexedLike.deleteMany({ where: { uri } });
    return;
  }

  const record = event.record ?? {};
  const subject = record.subject as { uri?: unknown; cid?: unknown } | undefined;
  if (!subject || typeof subject.uri !== "string") {
    // Malformed against the lexicon's own required `subject` — skip.
    return;
  }

  const data = {
    did: event.did,
    collection: NSID.like,
    subjectUri: subject.uri,
    subjectCid: typeof subject.cid === "string" ? subject.cid : null,
    atCreatedAt: parseDate(record.createdAt),
  };
  await prisma.indexedLike.upsert({ where: { uri }, create: { uri, ...data }, update: data });
}

/**
 * `app.bsky.feed.like` — the paired Bluesky copy of a like on a dual-published
 * PUBLIC post. Ingested ONLY when `INDEX_BSKY_POSTS` is set, and even then only
 * for a DID this app already tracks AND only when the subject resolves to a
 * post this app hosts — otherwise a global firehose subscription would fill
 * `indexed_likes` with the whole network's likes. Consequence (documented in
 * docs/known-limitations.md): public like counts under-count strangers' likes
 * vs bsky.app's true count.
 */
async function applyBskyLikeEvent(prisma: PrismaClient, event: CommitEvent): Promise<void> {
  const uri = uriFor(event);

  if (event.operation === "delete") {
    await prisma.indexedLike.deleteMany({ where: { uri } });
    return;
  }

  const record = event.record ?? {};
  const subject = record.subject as { uri?: unknown; cid?: unknown } | undefined;
  if (!subject || typeof subject.uri !== "string") {
    return;
  }

  const [profile, creator, hostedPost] = await Promise.all([
    prisma.indexedCreatorProfile.findUnique({ where: { did: event.did }, select: { did: true } }),
    prisma.creator.findUnique({ where: { did: event.did }, select: { did: true } }),
    prisma.post.findFirst({
      where: { OR: [{ bskyUri: subject.uri }, { sourceUri: subject.uri }, { canonicalUri: subject.uri }] },
      select: { id: true },
    }),
  ]);
  if ((!profile && !creator) || !hostedPost) {
    return;
  }

  const data = {
    did: event.did,
    collection: BSKY_NSID.feedLike,
    subjectUri: subject.uri,
    subjectCid: typeof subject.cid === "string" ? subject.cid : null,
    atCreatedAt: parseDate(record.createdAt),
  };
  await prisma.indexedLike.upsert({ where: { uri }, create: { uri, ...data }, update: data });
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
 * for whichever `fans.foryour.*` record type it is (profile, post, tier,
 * like), plus the paired `app.bsky.feed.{post,like}` when `INDEX_BSKY_POSTS`
 * is on. Any other collection is a no-op — the live Jetstream subscription
 * is filtered to these, but this stays defensive rather than assuming the
 * filter is airtight.
 */
export async function applyCommitEvent(prisma: PrismaClient, resolveDid: ResolveDid, event: CommitEvent): Promise<void> {
  switch (event.collection) {
    case NSID.profile:
      return applyProfileEvent(prisma, resolveDid, event);
    case NSID.post:
      return applyPostEvent(prisma, event);
    case NSID.tier:
      return applyTierEvent(prisma, event);
    case NSID.like:
      return applyLikeEvent(prisma, event);
    case BSKY_NSID.feedPost:
      return applyBskyPostEvent(prisma, event);
    case BSKY_NSID.feedLike:
      return applyBskyLikeEvent(prisma, event);
    default:
      return;
  }
}
