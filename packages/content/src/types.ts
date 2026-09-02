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
  /** A post `id` from a previous page's last result — returns posts strictly after it in the same order. Omit for the first page. */
  cursor?: string;
}

export interface GetFeedOptions {
  /**
   * Creator ids whose SUBSCRIBERS/TIER posts should also be candidates —
   * i.e. creators the caller has *some* active subscription to. Every
   * PUBLIC post platform-wide is always a candidate regardless of this
   * list (see docs/architecture.md's Phase 9 section for why "public" and
   * "followed" collapse to the same thing here: there is no Follow model
   * anywhere in prompts/full.md's 17 phases). Being in this list makes a
   * creator's non-public posts *candidates*, not automatically visible —
   * the caller (apps/api/src/routes/feed.ts) still runs each candidate
   * through `canAccess` to enforce the actual tier a subscription unlocks.
   */
  unlockedCreatorIds?: string[];
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
/**
 * The AES-256-GCM primitives CreatorOwnedContentRepository needs for gated
 * content, injected (not imported) so this package stays free of a Node
 * `crypto` / object-storage dependency — the concrete implementation is
 * wired from `@foryour-fans/media` in apps/api. See
 * prompts/creator-owned-pds.md "Required Privacy Design" and
 * docs/creator-owned-pds.md.
 */
export interface ContentCrypto {
  /** 32 random bytes. Never reuse across records. */
  generateContentKey(): Buffer;
  encryptText(text: string, contentKey: Buffer): { algorithm: string; iv: string; ciphertext: string };
  /** Envelope-wrap for at-rest storage in `ContentKey.wrappedKey`. */
  wrapKey(contentKey: Buffer): string;
}

/** Data for the creator portability / sync-status panel. */
export interface PortabilityStatus {
  did: string;
  handle: string | null;
  pdsUrl: string | null;
  collections: string[];
  profileSourceUri: string | null;
  serviceConfigUri: string | null;
  lastSyncedAt: Date | null;
  /** True when nothing creator-authored is still app-authoritative. */
  fullyPortable: boolean;
}

export interface ContentRepository {
  createPost(input: CreatePostInput): Promise<PostRecord>;
  /** Throws PostNotFoundError if `postId` doesn't exist, isn't owned by `creatorId`, or is soft-deleted. */
  updatePost(postId: string, creatorId: string, patch: UpdatePostInput): Promise<PostRecord>;
  /** Throws PostNotFoundError under the same conditions as updatePost. Soft-delete — see docs/architecture.md. */
  deletePost(postId: string, creatorId: string): Promise<void>;
  getPost(postId: string): Promise<PostRecord | null>;
  getCreatorFeed(creatorId: string, options?: GetCreatorFeedOptions): Promise<PostRecord[]>;
  /** Every PUBLIC post platform-wide, plus SUBSCRIBERS/TIER posts from `unlockedCreatorIds` — an unfiltered candidate set; see GetFeedOptions. */
  getFeed(options?: GetFeedOptions): Promise<PostRecord[]>;
}
