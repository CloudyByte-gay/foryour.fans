import { CommentValidationError, createComment, listComments, type CommentRecord, type ContentRepository } from "@foryour-fans/content";
import type { PrismaClient } from "@foryour-fans/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "../plugins/session.js";
import { loadAccessiblePost } from "./posts.js";

export interface CommentsRoutesOptions {
  prisma: PrismaClient;
  contentRepository: ContentRepository;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const createCommentBodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  cursor: z.string().uuid().optional(),
});

function toCommentResponse(comment: CommentRecord) {
  return {
    id: comment.id,
    postId: comment.postId,
    text: comment.text,
    createdAt: comment.createdAt,
    author: comment.author,
  };
}

/**
 * Comments, Likes, and Social Interaction — prompts/full.md PHASE 12. Both
 * routes here go through `loadAccessiblePost` first, so a comment on
 * protected content is gated exactly like the post itself (the spec's
 * "inherits access rules from the post"); anonymous/non-entitled callers
 * get the same `403`/`404` a denied `GET /posts/:id` read would produce for
 * the body, not a comment thread. Comments are Postgres-only and never
 * touch the AT network — see the `Comment` model's doc comment in
 * packages/database/prisma/schema.prisma.
 */
export async function commentsRoutes(app: FastifyInstance, { prisma, contentRepository }: CommentsRoutesOptions): Promise<void> {
  app.post("/posts/:id/comments", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await loadAccessiblePost(prisma, contentRepository, id, request.session!.did);
    if (!access.ok) {
      return reply.status(access.status).send({ error: { message: access.message, statusCode: access.status } });
    }

    const parsed = createCommentBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    // requireSession guarantees a resolvable session DID, but the User row
    // is looked up fresh (not cached on the session) — same pattern every
    // other authenticated route in this codebase follows.
    const author = await prisma.user.findUnique({ where: { did: request.session!.did } });
    if (!author) {
      return reply.status(401).send({ error: { message: "Session user not found.", statusCode: 401 } });
    }

    try {
      const comment = await createComment(prisma, access.post.id, author.id, parsed.data.text);
      return reply.status(201).send(toCommentResponse(comment));
    } catch (error) {
      if (error instanceof CommentValidationError) {
        return reply.status(400).send({ error: { message: error.message, statusCode: 400 } });
      }
      throw error;
    }
  });

  app.get("/posts/:id/comments", async (request, reply) => {
    const { id } = request.params as { id: string };
    const viewerDid = request.session?.did ?? null;
    const access = await loadAccessiblePost(prisma, contentRepository, id, viewerDid);
    if (!access.ok) {
      return reply.status(access.status).send({ error: { message: access.message, statusCode: access.status } });
    }

    const parsedQuery = paginationQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply
        .status(400)
        .send({ error: { message: parsedQuery.error.issues[0]?.message ?? "Invalid query.", statusCode: 400 } });
    }

    const comments = await listComments(prisma, access.post.id, {
      limit: parsedQuery.data.limit ?? DEFAULT_LIMIT,
      cursor: parsedQuery.data.cursor,
    });
    // Same cursor-pagination response shape as GET /discover, /search, and
    // GET /creators/:creator/feed (nextCursor = the last row's id, or null
    // once a page comes back empty) — prompts/web.md WEB PHASE 12 needs this
    // paginated (a bare array, this route's original Phase 12 shape, had no
    // consumer yet and no way to page).
    return {
      comments: comments.map(toCommentResponse),
      nextCursor: comments.length > 0 ? comments[comments.length - 1]!.id : null,
    };
  });
}
