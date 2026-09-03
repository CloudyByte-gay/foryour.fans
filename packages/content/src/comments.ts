import type { Comment, PrismaClient } from "@foryour-fans/database";

export class CommentValidationError extends Error {}

const MAX_COMMENT_LENGTH = 2000;

export interface CommentAuthor {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Storage-agnostic shape returned by every function here — see
 * PostRecord's own doc comment in types.ts for why this package prefers a
 * shaped record over the raw Prisma row. There is only one storage backend
 * for comments (Postgres, always — see the model's doc comment in
 * packages/database/prisma/schema.prisma for why they're never mirrored to
 * AT Protocol), so unlike Post there's no interface to implement here, just
 * these plain functions.
 */
export interface CommentRecord {
  id: string;
  postId: string;
  text: string;
  createdAt: Date;
  author: CommentAuthor;
}

/** Trims and rejects empty/oversized text. Thrown before any DB write. */
export function validateCommentText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new CommentValidationError("Comment text is required.");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new CommentValidationError(`Comment text must be ${MAX_COMMENT_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

const WITH_AUTHOR = {
  authorUser: { select: { did: true, handle: true, displayName: true, avatarUrl: true } },
} as const;

type CommentWithAuthor = Comment & {
  authorUser: { did: string; handle: string | null; displayName: string | null; avatarUrl: string | null };
};

function toCommentRecord(row: CommentWithAuthor): CommentRecord {
  return {
    id: row.id,
    postId: row.postId,
    text: row.text,
    createdAt: row.createdAt,
    author: {
      did: row.authorUser.did,
      handle: row.authorUser.handle,
      displayName: row.authorUser.displayName,
      avatarUrl: row.authorUser.avatarUrl,
    },
  };
}

/**
 * Creates a comment on `postId` — the caller (apps/api/src/routes/comments.ts)
 * is responsible for having already verified `postId` exists and that
 * `authorUserId`'s DID passes `checkPostAccess` for it; this function has no
 * opinion on entitlement, matching the storage-only discipline every other
 * write path in this package follows.
 */
export async function createComment(
  prisma: PrismaClient,
  postId: string,
  authorUserId: string,
  text: string,
): Promise<CommentRecord> {
  const trimmed = validateCommentText(text);
  const row = await prisma.comment.create({
    data: { postId, authorUserId, text: trimmed },
    include: WITH_AUTHOR,
  });
  return toCommentRecord(row);
}

export interface ListCommentsOptions {
  limit?: number;
  /** A comment `id` from a previous page's last result — returns comments strictly after it in the same order. Omit for the first page. */
  cursor?: string;
}

/**
 * Oldest-first (natural reading order for a discussion thread) — unlike
 * the feeds in packages/content/src/repository.ts, which are newest-first.
 * Cursor pagination follows the same compound-orderBy-plus-`id`-tiebreak
 * pattern as `getCreatorFeed` for the same reason: two comments posted in
 * the same millisecond must still resolve to one deterministic order.
 */
export async function listComments(
  prisma: PrismaClient,
  postId: string,
  options: ListCommentsOptions = {},
): Promise<CommentRecord[]> {
  const rows = await prisma.comment.findMany({
    where: { postId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: options.limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    include: WITH_AUTHOR,
  });
  return rows.map(toCommentRecord);
}
