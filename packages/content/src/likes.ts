import type { PrismaClient } from "@foryour-fans/database";

export interface LikeState {
  likeCount: number;
  likedByViewer: boolean;
}

/**
 * `POST /posts/:id/likes` — idempotent: liking a post the caller already
 * liked is a no-op that still returns the current state, not an error (an
 * `upsert` against the `[postId, userId]` unique index rather than a plain
 * `create` that could collide). The caller is responsible for entitlement —
 * same storage-only discipline as packages/content/src/comments.ts.
 */
export async function likePost(prisma: PrismaClient, postId: string, userId: string): Promise<LikeState> {
  await prisma.like.upsert({
    where: { postId_userId: { postId, userId } },
    create: { postId, userId },
    update: {},
  });
  const likeCount = await prisma.like.count({ where: { postId } });
  return { likeCount, likedByViewer: true };
}

/** `DELETE /posts/:id/likes` — unliking a post the caller never liked is a safe no-op, not a 404. */
export async function unlikePost(prisma: PrismaClient, postId: string, userId: string): Promise<LikeState> {
  await prisma.like.deleteMany({ where: { postId, userId } });
  const likeCount = await prisma.like.count({ where: { postId } });
  return { likeCount, likedByViewer: false };
}

/** Read-only state for a post — used internally; there is no `GET /posts/:id/likes` route in prompts/full.md PHASE 12's route list. */
export async function getLikeState(prisma: PrismaClient, postId: string, userId: string | null): Promise<LikeState> {
  const likeCount = await prisma.like.count({ where: { postId } });
  if (!userId) {
    return { likeCount, likedByViewer: false };
  }
  const existing = await prisma.like.findUnique({ where: { postId_userId: { postId, userId } } });
  return { likeCount, likedByViewer: existing !== null };
}

export interface LikeSummary extends LikeState {
  likedByCreator: boolean;
}

/**
 * Like state enriched with whether the post's own creator has liked it — the
 * "liked by creator" indicator `prompts/web.md` WEB PHASE 12 asks for. Not a
 * new route: `GET /posts/:id` (apps/api/src/routes/posts.ts) calls this
 * directly and spreads the result onto its unlocked response, the same "thin
 * addition to an already-shipped route" pattern WEB PHASEs 5/7/8/10 used
 * rather than inventing a dedicated `GET /posts/:id/likes`.
 */
export async function getLikeSummary(
  prisma: PrismaClient,
  postId: string,
  viewerUserId: string | null,
  creatorUserId: string,
): Promise<LikeSummary> {
  const likeCount = await prisma.like.count({ where: { postId } });
  const candidateIds = viewerUserId && viewerUserId !== creatorUserId ? [viewerUserId, creatorUserId] : [creatorUserId];
  const rows = await prisma.like.findMany({
    where: { postId, userId: { in: candidateIds } },
    select: { userId: true },
  });
  const likedBy = new Set(rows.map((r) => r.userId));
  return {
    likeCount,
    likedByViewer: viewerUserId !== null && likedBy.has(viewerUserId),
    likedByCreator: likedBy.has(creatorUserId),
  };
}
