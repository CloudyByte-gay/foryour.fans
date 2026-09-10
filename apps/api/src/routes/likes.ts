import { AtRecordDeleteError, AtRecordPublishError } from "@foryour-fans/atproto";
import { type ContentRepository, type LikeService } from "@foryour-fans/content";
import type { PrismaClient } from "@foryour-fans/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCsrf, requireNotRestricted, requireSession } from "../plugins/session.js";
import { loadAccessiblePost } from "./posts.js";

export interface LikesRoutesOptions {
  prisma: PrismaClient;
  contentRepository: ContentRepository;
  likeService: LikeService;
}

const likedByQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  // Opaque base64url cursor from a previous page — NOT a row id, so no `.uuid()`.
  cursor: z.string().min(1).max(512).optional(),
});

/**
 * `POST`/`DELETE /posts/:id/likes` — toggle the caller's like. Same
 * access-inherited-from-post gate as comments (`loadAccessiblePost`): you can
 * only like content you're entitled to see. Both are idempotent (see
 * packages/content/src/likeService.ts) and always return the current
 * `{likeCount, likedByViewer}` state.
 *
 * `GET /posts/:id/likes` — the bsky-style "liked by" list
 * (`app.bsky.feed.getLikes`-shaped). Anonymous-readable for a PUBLIC post;
 * for a gated post `loadAccessiblePost` returns a real 403 so a creator's
 * subscriber identities aren't leaked to non-entitled viewers.
 *
 * When `CREATOR_OWNED_PDS_ENABLED` is on, a like is also written as a
 * `fans.foryour.like` in the LIKER's own repo (paired with an
 * `app.bsky.feed.like` for a PUBLIC post); a PDS write/delete failure surfaces
 * here as a 502.
 */
export async function likesRoutes(
  app: FastifyInstance,
  { prisma, contentRepository, likeService }: LikesRoutesOptions,
): Promise<void> {
  app.post("/posts/:id/likes", { preHandler: [requireSession, requireCsrf, requireNotRestricted(prisma)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await loadAccessiblePost(prisma, contentRepository, id, request.session!.did);
    if (!access.ok) {
      return reply.status(access.status).send({ error: { message: access.message, statusCode: access.status } });
    }

    const user = await prisma.user.findUnique({ where: { did: request.session!.did } });
    if (!user) {
      return reply.status(401).send({ error: { message: "Session user not found.", statusCode: 401 } });
    }

    try {
      return reply.status(200).send(await likeService.like(access.post, { userId: user.id, did: user.did }));
    } catch (err) {
      if (err instanceof AtRecordPublishError) {
        request.log.error({ err: err.cause }, "failed to publish like to the AT network");
        return reply.status(502).send({ error: { message: "Couldn't record your like right now.", statusCode: 502 } });
      }
      throw err;
    }
  });

  app.delete("/posts/:id/likes", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await loadAccessiblePost(prisma, contentRepository, id, request.session!.did);
    if (!access.ok) {
      return reply.status(access.status).send({ error: { message: access.message, statusCode: access.status } });
    }

    const user = await prisma.user.findUnique({ where: { did: request.session!.did } });
    if (!user) {
      return reply.status(401).send({ error: { message: "Session user not found.", statusCode: 401 } });
    }

    try {
      return reply.status(200).send(await likeService.unlike(access.post, { userId: user.id, did: user.did }));
    } catch (err) {
      if (err instanceof AtRecordDeleteError) {
        request.log.error({ err: err.cause }, "failed to delete like from the AT network");
        return reply.status(502).send({ error: { message: "Couldn't remove your like right now.", statusCode: 502 } });
      }
      throw err;
    }
  });

  app.get("/posts/:id/likes", async (request, reply) => {
    const { id } = request.params as { id: string };
    const viewerDid = request.session?.did ?? null;
    const access = await loadAccessiblePost(prisma, contentRepository, id, viewerDid);
    if (!access.ok) {
      return reply.status(access.status).send({ error: { message: access.message, statusCode: access.status } });
    }

    const parsed = likedByQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid query.", statusCode: 400 } });
    }

    const page = await likeService.listLikedBy(access.post, {
      limit: parsed.data.limit ?? 30,
      cursor: parsed.data.cursor,
    });
    return {
      likes: page.likes.map((actor) => ({
        actor: {
          did: actor.did,
          handle: actor.handle,
          displayName: actor.displayName,
          avatarUrl: actor.avatarUrl,
        },
        createdAt: actor.createdAt,
      })),
      nextCursor: page.nextCursor,
    };
  });
}
