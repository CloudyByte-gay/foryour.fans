import type { PostVisibility } from "@foryour-fans/database";

export type { PostVisibility };

/**
 * The storage-agnostic shape every ContentRepository implementation
 * returns. Deliberately NOT the raw Prisma `Post` row — `media` is resolved
 * separately (empty in Phase 7; PostMedia has no writer yet, see
 * packages/database/prisma/schema.prisma), and `atRkey` is an
 * implementation detail of PrivateContentRepository specifically (a
 * hypothetical AtprotoSpacesContentRepository, Phase 11, wouldn't have one
 * the same way), so it's intentionally omitted from this shared shape.
 */
export interface PostRecord {
  id: string;
  creatorId: string;
  visibility: PostVisibility;
  minimumTierId: string | null;
  text: string;
  media: Array<{ mediaAssetId: string; sortOrder: number }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePostInput {
  creatorId: string;
  visibility: PostVisibility;
  minimumTierId?: string;
  text: string;
}

export interface UpdatePostInput {
  visibility?: PostVisibility;
  /** Pass `null` explicitly to clear it (e.g. moving off TIER visibility); omit to leave unchanged. */
  minimumTierId?: string | null;
  text?: string;
}

export interface GetCreatorFeedOptions {
  limit?: number;
}

/**
 * Storage abstraction for private/paid content — see prompts/full.md PHASE 7
 * and docs/architecture.md. Entitlement checking is deliberately NOT part of
 * this interface: `canAccess` (packages/subscriptions/src/entitlements.ts)
 * is storage-backend-agnostic and is called directly by the routes that use
 * a ContentRepository (see apps/api/src/routes/posts.ts), the same way it
 * would be called regardless of which implementation is wired in.
 *
 * `getPost`/`getCreatorFeed` never return a soft-deleted post (`deletedAt`
 * set) — a deleted post is simply gone from every repository read.
 */
export interface ContentRepository {
  createPost(input: CreatePostInput): Promise<PostRecord>;
  /** Throws PostNotFoundError if `postId` doesn't exist, isn't owned by `creatorId`, or is soft-deleted. */
  updatePost(postId: string, creatorId: string, patch: UpdatePostInput): Promise<PostRecord>;
  /** Throws PostNotFoundError under the same conditions as updatePost. Soft-delete — see docs/architecture.md. */
  deletePost(postId: string, creatorId: string): Promise<void>;
  getPost(postId: string): Promise<PostRecord | null>;
  getCreatorFeed(creatorId: string, options?: GetCreatorFeedOptions): Promise<PostRecord[]>;
}
