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
