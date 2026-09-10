import type { ContentRepository, LikeService, PostRecord } from "@foryour-fans/content";
import type { PrismaClient } from "@foryour-fans/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { findActiveCreatorByIdentifier } from "../services/creators.js";
import { checkPostAccess, toLockedStub, toPostResponse } from "./posts.js";

export interface FeedRoutesOptions {
  prisma: PrismaClient;
  contentRepository: ContentRepository;
  likeService: LikeService;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/**
 * How many extra PUBLIC/candidate posts to over-fetch on `GET /feed` beyond
 * the caller's requested `limit`, to absorb candidates that `canAccess`
 * ends up denying (a SUBSCRIBERS/TIER post from a creator the caller has
 * *some* active subscription to, but not one that unlocks this specific
 * post's tier). This is a pragmatic bound, not a full "keep fetching until
 * the page is full" loop — see docs/architecture.md's Phase 9 section for
 * why a strictly-guaranteed-full page wasn't worth the added complexity
 * here, and README's Known limitations for the honest residual gap.
 */
const FEED_OVERFETCH_PAD = 20;

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  cursor: z.string().uuid().optional(),
});

/** `{ did, handle }` — same minimal creator-identity shape apps/api/src/routes/creators.ts uses. */
async function creatorIdentitiesByIds(prisma: PrismaClient, creatorIds: string[]): Promise<Map<string, { did: string; handle: string | null }>> {
  if (creatorIds.length === 0) {
    return new Map();
  }
  const creators = await prisma.creator.findMany({
    where: { id: { in: creatorIds } },
    include: { user: true },
  });
  return new Map(creators.map((c) => [c.id, { did: c.did, handle: c.user.handle }]));
}

function parsePagination(request: FastifyRequest, reply: FastifyReply): { limit: number; cursor?: string } | null {
  const parsed = paginationQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.status(400).send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid query.", statusCode: 400 } });
    return null;
  }
  return { limit: parsed.data.limit ?? DEFAULT_LIMIT, cursor: parsed.data.cursor };
}

export async function feedRoutes(
  app: FastifyInstance,
  { prisma, contentRepository, likeService }: FeedRoutesOptions,
): Promise<void> {
  /**
   * The home feed — see prompts/full.md PHASE 9. There is no Follow model
   * anywhere in prompts/full.md's 17 phases (the spec's "followed" language
   * has no backing data model), so "public posts from followed/discovered
   * creators" collapses to "every PUBLIC post platform-wide" — PUBLIC
   * already means "visible to anyone", so there's no relationship to
   * gate that half on. "Unlocked subscription posts" is literal: posts a
   * caller's ACTIVE subscriptions actually grant access to. Anonymous
   * callers get the PUBLIC half only. Never returns locked-post stubs —
   * see docs/architecture.md for why that's scoped to the per-creator feed
   * only.
   */
  app.get("/feed", async (request, reply) => {
    const pagination = parsePagination(request, reply);
    if (!pagination) return;

    const viewerDid = request.session?.did ?? null;
    let unlockedCreatorIds: string[] = [];
    let viewerUserId: string | null = null;
    if (viewerDid) {
      const user = await prisma.user.findUnique({ where: { did: viewerDid } });
      if (user) {
        viewerUserId = user.id;
        const activeSubs = await prisma.subscription.findMany({
          where: { subscriberUserId: user.id, status: "ACTIVE" },
          select: { creatorId: true },
        });
        unlockedCreatorIds = activeSubs.map((s) => s.creatorId);
      }
    }

    const candidates = await contentRepository.getFeed({
      unlockedCreatorIds,
      limit: pagination.limit + FEED_OVERFETCH_PAD,
    });

    const creatorCache = new Map<string, Awaited<ReturnType<typeof prisma.creator.findUnique>>>();
    const accessible: PostRecord[] = [];
    for (const post of candidates) {
      if (accessible.length >= pagination.limit) break;
      if (post.visibility === "PUBLIC") {
        accessible.push(post);
        continue;
      }
      let creator = creatorCache.get(post.creatorId);
      if (creator === undefined) {
        creator = await prisma.creator.findUnique({ where: { id: post.creatorId } });
        creatorCache.set(post.creatorId, creator);
      }
      if (creator && (await checkPostAccess(prisma, post, creator, viewerDid))) {
        accessible.push(post);
      }
    }

    // Dedupe by canonical URI so a dual-published public post
    // (app.bsky.feed.post + fans.foryour.post — prompts/bluesky-public-posts.md)
    // is one feed item. The local `Post` table has exactly one row per
    // authored post, so this is a guard rather than a real collapse today;
    // it matters once an indexed/network feed (packages/discovery's
    // mergeIndexedPosts) can surface the paired records separately.
    const seen = new Set<string>();
    const deduped: PostRecord[] = [];
    for (const post of accessible) {
      const key = post.canonicalUri ?? post.id;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(post);
    }

    const identities = await creatorIdentitiesByIds(prisma, [...new Set(deduped.map((p) => p.creatorId))]);
    // WEB PHASE 12+ — like count + the viewer's own like state on feed cards.
    // A thin addition to this already-shipped route; batched to avoid an N+1.
    const likeSummaries = await likeService.getSummariesForPosts(
      deduped,
      viewerUserId ? { userId: viewerUserId } : null,
    );
    return deduped.map((post) => ({
      ...toPostResponse(post),
      creator: identities.get(post.creatorId) ?? null,
      ...(likeSummaries.get(post.id) ?? { likeCount: 0, likedByViewer: false }),
    }));
  });

  /**
   * A single creator's feed — every non-deleted post, newest first,
   * cursor-paginated. Unlike GET /creators/:identifier/posts (Phase 7,
   * still simple/unpaginated, silently omits inaccessible posts), this
   * route NEVER omits a post: one the caller can't see comes back as a
   * safe metadata-only stub instead — see toLockedStub above and
   * docs/architecture.md's Phase 9 section for why the two routes coexist.
   */
  app.get("/creators/:identifier/feed", async (request, reply) => {
    const { identifier } = request.params as { identifier: string };
    const creator = await findActiveCreatorByIdentifier(prisma, identifier);
    if (!creator) {
      return reply.status(404).send({ error: { message: "Creator not found.", statusCode: 404 } });
    }

    const pagination = parsePagination(request, reply);
    if (!pagination) return;

    if (pagination.cursor) {
      const cursorPost = await prisma.post.findUnique({ where: { id: pagination.cursor } });
      if (!cursorPost || cursorPost.creatorId !== creator.id) {
        return reply.status(400).send({ error: { message: "Invalid cursor.", statusCode: 400 } });
      }
    }

    const viewerDid = request.session?.did ?? null;
    const viewer = viewerDid ? await prisma.user.findUnique({ where: { did: viewerDid } }) : null;
    const posts = await contentRepository.getCreatorFeed(creator.id, { limit: pagination.limit, cursor: pagination.cursor });

    const access = await Promise.all(posts.map((post) => checkPostAccess(prisma, post, creator, viewerDid)));
    const unlocked = posts.filter((_, i) => access[i]);
    // Like count + viewer state on the unlocked cards only — a locked stub has
    // no like button to render (same rule as the single-post view).
    const likeSummaries = await likeService.getSummariesForPosts(
      unlocked,
      viewer ? { userId: viewer.id } : null,
    );

    const shaped = await Promise.all(
      posts.map(async (post, i) => {
        if (!access[i]) return toLockedStub(prisma, post);
        return {
          ...toPostResponse(post),
          locked: false as const,
          ...(likeSummaries.get(post.id) ?? { likeCount: 0, likedByViewer: false }),
        };
      }),
    );

    return { posts: shaped, nextCursor: posts.length > 0 ? posts[posts.length - 1]!.id : null };
  });
}
