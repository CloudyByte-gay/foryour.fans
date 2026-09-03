import { likePost, unlikePost, type ContentRepository } from "@foryour-fans/content";
import type { PrismaClient } from "@foryour-fans/database";
import type { FastifyInstance } from "fastify";
import { requireCsrf, requireSession } from "../plugins/session.js";
import { loadAccessiblePost } from "./posts.js";

export interface LikesRoutesOptions {
  prisma: PrismaClient;
  contentRepository: ContentRepository;
}

/**
 * `POST`/`DELETE /posts/:id/likes` — prompts/full.md PHASE 12. Same
 * access-inherited-from-post gate as comments.ts (`loadAccessiblePost`):
 * a caller can only like content they're actually entitled to see. Both
 * routes are idempotent (see packages/content/src/likes.ts) — liking an
 * already-liked post, or unliking a never-liked one, is a safe no-op that
 * still returns the current `{likeCount, likedByViewer}` state, not an
 * error.
 */
export async function likesRoutes(app: FastifyInstance, { prisma, contentRepository }: LikesRoutesOptions): Promise<void> {
  app.post("/posts/:id/likes", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await loadAccessiblePost(prisma, contentRepository, id, request.session!.did);
    if (!access.ok) {
      return reply.status(access.status).send({ error: { message: access.message, statusCode: access.status } });
    }

    const user = await prisma.user.findUnique({ where: { did: request.session!.did } });
    if (!user) {
      return reply.status(401).send({ error: { message: "Session user not found.", statusCode: 401 } });
    }

    return reply.status(200).send(await likePost(prisma, access.post.id, user.id));
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

    return reply.status(200).send(await unlikePost(prisma, access.post.id, user.id));
  });
}
