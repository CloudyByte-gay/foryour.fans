import { AtRecordDeleteError, AtRecordPublishError } from "@foryour-fans/atproto";
import type { Creator, PrismaClient } from "@foryour-fans/database";
import { PostNotFoundError, PostValidationError, type ContentRepository, type PostRecord } from "@foryour-fans/content";
import { canAccess, TierNotFoundError, getOwnedTier } from "@foryour-fans/subscriptions";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "../plugins/session.js";
import { findActiveCreatorByIdentifier } from "../services/creators.js";

export interface PostsRoutesOptions {
  prisma: PrismaClient;
  contentRepository: ContentRepository;
}

const createBodySchema = z.object({
  visibility: z.enum(["PUBLIC", "SUBSCRIBERS", "TIER"]),
  minimumTierId: z.string().uuid().optional(),
  text: z.string().trim().min(1).max(10000),
  /** Public-post only — mirrored onto both the app.bsky.feed.post and fans.foryour.post. */
  langs: z.array(z.string().min(2).max(20)).max(3).optional(),
  tags: z.array(z.string().min(1).max(64)).max(8).optional(),
});

/**
 * `PATCH /creators/me/posts/:id` — full-replace semantics (the composer
 * always sends every field), so it's the create schema shape rather than a
 * `.partial()`. `minimumTierId` is still only meaningful for TIER; the route
 * clears it otherwise, matching how `updatePost` treats an explicit `null`.
 */
const updateBodySchema = createBodySchema;

/**
 * Shapes one post for an API response. Beyond the body it exposes the
 * dual-published-post linkage (prompts/bluesky-public-posts.md,
 * docs/bluesky-public-posts.md): the `fans.foryour.post` URI/CID, the paired
 * `app.bsky.feed.post` URI/CID, which record is `canonicalUri`, and
 * `sourceCollections` — so a client knows a single authored post is backed by
 * two AT records and can dedupe. All null / `["fans.foryour.post"]` / `[]`
 * when the post is not dual-published (the default `PrivateContentRepository`
 * path or a gated post).
 */
export function toPostResponse(post: PostRecord) {
  return {
    id: post.id,
    creatorId: post.creatorId,
    visibility: post.visibility,
    minimumTierId: post.minimumTierId,
    text: post.text,
    media: post.media,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    foryourAtUri: post.foryourAtUri,
    foryourAtCid: post.foryourAtCid,
    bskyAtUri: post.bskyAtUri,
    bskyAtCid: post.bskyAtCid,
    canonicalUri: post.canonicalUri,
    sourceCollections: post.sourceCollections,
  };
}

/**
 * Resolves the `:id` path param on `GET /posts/:id` to a local post id.
 * Accepts a local UUID, a `fans.foryour.post` AT URI, or an
 * `app.bsky.feed.post` AT URI (prompts/bluesky-public-posts.md "Single Post
 * View") — when both records exist they resolve to the same local `Post` row.
 */
async function resolvePostId(prisma: PrismaClient, raw: string): Promise<string | null> {
  if (raw.startsWith("at://")) {
    const row = await prisma.post.findFirst({
      where: { OR: [{ sourceUri: raw }, { bskyUri: raw }, { canonicalUri: raw }] },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  return raw;
}

interface RequiredTierSummary {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
}

/**
 * Safe, non-body metadata for a post the caller can't see — the only thing
 * `GET /posts/:id` and `GET /creators/:identifier/feed` (Phase 9) return for
 * a locked post. Never includes `text` or any media byte/ref: a locked post
 * must reveal nothing a non-entitled viewer isn't allowed to have (see
 * prompts/web.md WEB PHASE 7's single-post view and prompts/full.md PHASE 9's
 * locked-post metadata list).
 */
export async function toLockedStub(
  prisma: PrismaClient,
  post: PostRecord,
): Promise<{
  id: string;
  creatorId: string;
  visibility: PostRecord["visibility"];
  createdAt: Date;
  locked: true;
  hasMedia: boolean;
  requiredTier: RequiredTierSummary | null;
}> {
  let requiredTier: RequiredTierSummary | null = null;
  if (post.visibility === "TIER" && post.minimumTierId) {
    const tier = await prisma.subscriptionTier.findUnique({ where: { id: post.minimumTierId } });
    if (tier) {
      requiredTier = { id: tier.id, name: tier.name, priceCents: tier.priceCents, currency: tier.currency };
    }
  }
  return {
    id: post.id,
    creatorId: post.creatorId,
    visibility: post.visibility,
    createdAt: post.createdAt,
    locked: true,
    hasMedia: post.media.length > 0,
    requiredTier,
  };
}

function sendPostError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof PostValidationError) {
    return reply.status(400).send({ error: { message: error.message, statusCode: 400 } });
  }
  if (error instanceof TierNotFoundError) {
    return reply.status(400).send({ error: { message: "minimumTierId does not belong to this creator.", statusCode: 400 } });
  }
  if (error instanceof PostNotFoundError) {
    return reply.status(404).send({ error: { message: error.message, statusCode: 404 } });
  }
  if (error instanceof AtRecordPublishError || error instanceof AtRecordDeleteError) {
    reply.log.error({ err: error.cause }, "failed to sync post to AT network");
    return reply.status(502).send({ error: { message: error.message, statusCode: 502 } });
  }
  throw error;
}

/**
 * The entitlement gate every private-content read goes through — see
 * prompts/full.md PHASE 7 ("Every private-content request must go through
 * the entitlement service") and packages/subscriptions/src/entitlements.ts.
 * PUBLIC posts skip canAccess entirely (always allowed, even anonymously);
 * everything else requires a session, and TIER posts additionally pass
 * `minimumTierId` through as canAccess's sortOrder-hierarchy check.
 */
export async function checkPostAccess(
  prisma: PrismaClient,
  post: PostRecord,
  creator: Creator,
  viewerDid: string | null,
): Promise<boolean> {
  if (post.visibility === "PUBLIC") {
    return true;
  }
  if (!viewerDid) {
    return false;
  }
  return canAccess(prisma, {
    subscriberDid: viewerDid,
    creatorDid: creator.did,
    requiredTierId: post.visibility === "TIER" ? (post.minimumTierId ?? undefined) : undefined,
  });
}

export async function postsRoutes(app: FastifyInstance, { prisma, contentRepository }: PostsRoutesOptions): Promise<void> {
  app.post("/creators/me/posts", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const { visibility, minimumTierId, text, langs, tags } = parsed.data;
    if (visibility === "TIER") {
      if (!minimumTierId) {
        return reply
          .status(400)
          .send({ error: { message: "minimumTierId is required when visibility is TIER.", statusCode: 400 } });
      }
      try {
        await getOwnedTier(prisma, creator.id, minimumTierId);
      } catch (error) {
        return sendPostError(error, reply);
      }
    } else if (minimumTierId) {
      return reply
        .status(400)
        .send({ error: { message: "minimumTierId can only be set when visibility is TIER.", statusCode: 400 } });
    }

    if (visibility !== "PUBLIC" && (langs || tags)) {
      return reply
        .status(400)
        .send({ error: { message: "langs/tags are only valid on a PUBLIC post.", statusCode: 400 } });
    }

    try {
      const post = await contentRepository.createPost({ creatorId: creator.id, visibility, minimumTierId, text, langs, tags });
      return reply.status(201).send(toPostResponse(post));
    } catch (error) {
      return sendPostError(error, reply);
    }
  });

  /**
   * Edit a post — the web-track counterpart to `POST /creators/me/posts` (the
   * spec's Phase 7 route list has no PATCH, but `prompts/web.md` WEB PHASE 7's
   * composer explicitly has an edit mode, and `ContentRepository.updatePost`
   * — including the PUBLIC-boundary publish/retract transitions — already
   * exists). Same TIER validation as create; the repository handles the AT
   * record side effects.
   */
  app.patch("/creators/me/posts/:id", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const parsed = updateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const { id } = request.params as { id: string };
    const { visibility, minimumTierId, text, langs, tags } = parsed.data;
    if (visibility === "TIER") {
      if (!minimumTierId) {
        return reply
          .status(400)
          .send({ error: { message: "minimumTierId is required when visibility is TIER.", statusCode: 400 } });
      }
      try {
        await getOwnedTier(prisma, creator.id, minimumTierId);
      } catch (error) {
        return sendPostError(error, reply);
      }
    } else if (minimumTierId) {
      return reply
        .status(400)
        .send({ error: { message: "minimumTierId can only be set when visibility is TIER.", statusCode: 400 } });
    }

    if (visibility !== "PUBLIC" && (langs || tags)) {
      return reply
        .status(400)
        .send({ error: { message: "langs/tags are only valid on a PUBLIC post.", statusCode: 400 } });
    }

    try {
      const post = await contentRepository.updatePost(id, creator.id, {
        visibility,
        // Explicit null clears the gate when moving off TIER — see UpdatePostInput.
        minimumTierId: visibility === "TIER" ? minimumTierId : null,
        text,
        langs,
        tags,
      });
      return toPostResponse(post);
    } catch (error) {
      return sendPostError(error, reply);
    }
  });

  app.get("/creators/:identifier/posts", async (request, reply) => {
    const { identifier } = request.params as { identifier: string };
    const creator = await findActiveCreatorByIdentifier(prisma, identifier);
    if (!creator) {
      return reply.status(404).send({ error: { message: "Creator not found.", statusCode: 404 } });
    }

    const viewerDid = request.session?.did ?? null;
    const posts = await contentRepository.getCreatorFeed(creator.id);

    const accessible: PostRecord[] = [];
    for (const post of posts) {
      if (await checkPostAccess(prisma, post, creator, viewerDid)) {
        accessible.push(post);
      }
    }
    return accessible.map(toPostResponse);
  });

  /**
   * A non-entitled viewer (anonymous, non-subscriber, wrong tier) gets a
   * `200` locked stub — safe metadata only, never `text`/media — not a `403`.
   * `prompts/web.md` WEB PHASE 7's single-post view needs the required-tier
   * badge + subscribe CTA to render, and this is the same stub shape Phase 9
   * already returns from `GET /creators/:identifier/feed`. The creator's
   * public identity rides along on both branches so the web page doesn't need
   * a second round trip to label / link the post.
   */
  app.get("/posts/:id", async (request, reply) => {
    const { id: rawId } = request.params as { id: string };
    const id = await resolvePostId(prisma, decodeURIComponent(rawId));
    const post = id ? await contentRepository.getPost(id) : null;
    if (!post) {
      return reply.status(404).send({ error: { message: "Post not found.", statusCode: 404 } });
    }

    const creator = await prisma.creator.findUnique({ where: { id: post.creatorId }, include: { user: true } });
    if (!creator || creator.status !== "ACTIVE") {
      return reply.status(404).send({ error: { message: "Post not found.", statusCode: 404 } });
    }
    const creatorIdentity = { did: creator.did, handle: creator.user.handle, displayName: creator.displayName };

    const viewerDid = request.session?.did ?? null;
    const allowed = await checkPostAccess(prisma, post, creator, viewerDid);
    if (!allowed) {
      return reply.send({ ...(await toLockedStub(prisma, post)), creator: creatorIdentity });
    }
    return { ...toPostResponse(post), locked: false as const, creator: creatorIdentity };
  });

  app.delete("/creators/me/posts/:id", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const { id } = request.params as { id: string };
    try {
      await contentRepository.deletePost(id, creator.id);
      return reply.status(204).send();
    } catch (error) {
      return sendPostError(error, reply);
    }
  });
}
