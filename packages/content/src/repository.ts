import type { Post, PrismaClient } from "@foryour-fans/database";
import { NSID } from "@foryour-fans/lexicons";
import {
  AtRecordDeleteError,
  AtRecordPublishError,
  nextTid,
  type DeleteAtRecord,
  type PublishAtRecord,
} from "@foryour-fans/atproto";
import type { ContentRepository, CreatePostInput, GetCreatorFeedOptions, GetFeedOptions, PostRecord, UpdatePostInput } from "./types.js";
import { validatePostFields } from "./validation.js";
import {
  POST_MEDIA_INCLUDE,
  resolvePostMedia,
  toMediaRefs,
  writePostMedia,
  type IncludedPostMediaRow,
  type PostMediaRef,
} from "./media.js";

export class PostNotFoundError extends Error {}

type PostWithCreatorDid = Post & { creator?: { did: string } | null; media?: IncludedPostMediaRow[] };

/** Every read query includes the attachment rows so `toPostRecord` can shape `media`. */
const WITH_MEDIA = POST_MEDIA_INCLUDE;

/**
 * `PrivateContentRepository` still mirrors a PUBLIC post to the creator's
 * PDS as a `fans.foryour.post` (Phase 7), so a PUBLIC post always has a
 * `foryourAtUri`; it never writes an `app.bsky.feed.post`, so the `bskyAt*`
 * fields are always null on this path. Dual-publish lives in
 * `CreatorOwnedContentRepository` (prompts/bluesky-public-posts.md).
 */
function toPostRecord(
  post: PostWithCreatorDid,
  creatorDid?: string | null,
  mediaOverride?: PostMediaRef[],
): PostRecord {
  const did = creatorDid ?? post.creator?.did ?? null;
  const isPublic = post.visibility === "PUBLIC";
  const foryourAtUri =
    isPublic && post.atRkey && did ? `at://${did}/${NSID.post}/${post.atRkey}` : null;
  return {
    id: post.id,
    creatorId: post.creatorId,
    visibility: post.visibility,
    minimumTierId: post.minimumTierId,
    text: post.text,
    media: mediaOverride ?? toMediaRefs(post.media),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    foryourAtUri,
    foryourAtCid: null,
    bskyAtUri: null,
    bskyAtCid: null,
    canonicalUri: foryourAtUri,
    sourceCollections: foryourAtUri ? [NSID.post] : [],
  };
}

function postAtRecord(text: string, createdAt: Date): Record<string, unknown> {
  return {
    $type: NSID.post,
    text,
    createdAt: createdAt.toISOString(),
  };
}

/**
 * PostgreSQL + (eventually, Phase 8) S3-compatible private object storage —
 * see prompts/full.md PHASE 7. The S3 half doesn't exist yet: PostMedia rows
 * are never written in this phase (see docs/architecture.md), so this
 * implementation is Postgres-only for now; attaching media is Phase 8's job,
 * additive to this class, not a redesign of it.
 *
 * The one piece of AT Protocol awareness this repository has: a PUBLIC post
 * is mirrored to the creator's own PDS as a fans.foryour.post record
 * (`atRkey` tracks the rkey, reused across edits exactly like
 * packages/subscriptions/src/tiers.ts does for tiers). SUBSCRIBERS/TIER
 * posts NEVER touch the AT network — see docs/atproto-vs-database.md's
 * "explicitly, permanently forbidden" list. A visibility change that
 * crosses the PUBLIC boundary in either direction publishes or retracts the
 * AT record accordingly; see updatePost below.
 */
export class PrivateContentRepository implements ContentRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly publishAtRecord: PublishAtRecord,
    private readonly deleteAtRecord: DeleteAtRecord,
  ) {}

  async createPost(input: CreatePostInput): Promise<PostRecord> {
    validatePostFields(input);
    // Validate attachments BEFORE any AT write, so a bad media ref can't
    // leave an orphaned fans.foryour.post record with no local row.
    const mediaRefs = await resolvePostMedia(this.prisma, input.creatorId, input.media);

    const now = new Date();
    let atRkey: string | null = null;

    if (input.visibility === "PUBLIC") {
      const creator = await this.prisma.creator.findUniqueOrThrow({ where: { id: input.creatorId } });
      atRkey = nextTid();
      try {
        await this.publishAtRecord(creator.did, {
          collection: NSID.post,
          rkey: atRkey,
          record: postAtRecord(input.text, now),
        });
      } catch (error) {
        throw new AtRecordPublishError("Failed to publish post to the AT network.", error);
      }
    }

    const post = await this.prisma.post.create({
      data: {
        creatorId: input.creatorId,
        visibility: input.visibility,
        minimumTierId: input.minimumTierId,
        text: input.text,
        atRkey,
        createdAt: now,
      },
      include: { creator: { select: { did: true } } },
    });
    if (mediaRefs.length > 0) {
      await writePostMedia(this.prisma, post.id, mediaRefs);
    }
    return toPostRecord(post, undefined, mediaRefs);
  }

  private async getOwnedRow(postId: string, creatorId: string): Promise<Post> {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.creatorId !== creatorId || post.deletedAt) {
      throw new PostNotFoundError("Post not found.");
    }
    return post;
  }

  async updatePost(postId: string, creatorId: string, patch: UpdatePostInput): Promise<PostRecord> {
    const existing = await this.getOwnedRow(postId, creatorId);

    // `media` omitted → leave attachments untouched; `media` present (even
    // `[]`) → full replace. Validate before any AT write, as in createPost.
    const mediaRefs =
      patch.media === undefined ? null : await resolvePostMedia(this.prisma, creatorId, patch.media);

    const merged = {
      visibility: patch.visibility ?? existing.visibility,
      minimumTierId: patch.minimumTierId === undefined ? existing.minimumTierId : patch.minimumTierId,
      text: patch.text ?? existing.text,
    };
    validatePostFields(merged);

    const wasPublic = existing.visibility === "PUBLIC";
    const isPublic = merged.visibility === "PUBLIC";
    let atRkey = existing.atRkey;

    // Only look up the creator's DID when an AT write/delete is actually
    // about to happen — a patch that never touches PUBLIC-ness shouldn't
    // pay for a query it doesn't need.
    if (wasPublic || isPublic) {
      const creator = await this.prisma.creator.findUniqueOrThrow({ where: { id: creatorId } });

      if (wasPublic && !isPublic) {
        // Leaving PUBLIC: retract the AT record entirely.
        try {
          await this.deleteAtRecord(creator.did, { collection: NSID.post, rkey: existing.atRkey! });
        } catch (error) {
          throw new AtRecordDeleteError("Failed to remove post from the AT network.", error);
        }
        atRkey = null;
      } else if (!wasPublic && isPublic) {
        // Becoming PUBLIC for the first time: mint a fresh rkey.
        atRkey = nextTid();
        try {
          await this.publishAtRecord(creator.did, {
            collection: NSID.post,
            rkey: atRkey,
            record: postAtRecord(merged.text, existing.createdAt),
          });
        } catch (error) {
          throw new AtRecordPublishError("Failed to publish post to the AT network.", error);
        }
      } else {
        // Stayed PUBLIC: republish under the SAME rkey, matching tiers.ts.
        try {
          await this.publishAtRecord(creator.did, {
            collection: NSID.post,
            rkey: existing.atRkey!,
            record: postAtRecord(merged.text, existing.createdAt),
          });
        } catch (error) {
          throw new AtRecordPublishError("Failed to publish post to the AT network.", error);
        }
      }
    }
    // else: stayed non-PUBLIC the whole time — no AT interaction at all.

    if (mediaRefs !== null) {
      await writePostMedia(this.prisma, postId, mediaRefs);
    }

    const updated = await this.prisma.post.update({
      where: { id: postId },
      data: {
        visibility: merged.visibility,
        minimumTierId: merged.minimumTierId,
        text: merged.text,
        atRkey,
      },
      include: { creator: { select: { did: true } }, ...WITH_MEDIA },
    });
    return toPostRecord(updated, undefined, mediaRefs ?? undefined);
  }

  async deletePost(postId: string, creatorId: string): Promise<void> {
    const existing = await this.getOwnedRow(postId, creatorId);

    if (existing.atRkey) {
      const creator = await this.prisma.creator.findUniqueOrThrow({ where: { id: creatorId } });
      try {
        await this.deleteAtRecord(creator.did, { collection: NSID.post, rkey: existing.atRkey });
      } catch (error) {
        throw new AtRecordDeleteError("Failed to remove post from the AT network.", error);
      }
    }

    await this.prisma.post.update({ where: { id: postId }, data: { deletedAt: new Date() } });
  }

  async getPost(postId: string): Promise<PostRecord | null> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { creator: { select: { did: true } }, ...WITH_MEDIA },
    });
    if (!post || post.deletedAt) {
      return null;
    }
    return toPostRecord(post);
  }

  /**
   * Cursor pagination via Prisma's native `cursor`/`skip: 1` — `id` alone
   * is sufficient (globally unique), but `orderBy` is compound
   * (`createdAt` then `id`) so ties on the same millisecond still resolve
   * to one deterministic order; two posts created close enough together to
   * share a `createdAt` is exactly the scenario
   * packages/content/src/repository.test.ts's ordering test already
   * exists to guard against, and an ambiguous tiebreak would make cursor
   * pagination skip or repeat a row across pages.
   */
  async getCreatorFeed(creatorId: string, options: GetCreatorFeedOptions = {}): Promise<PostRecord[]> {
    const posts = await this.prisma.post.findMany({
      where: { creatorId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: { creator: { select: { did: true } }, ...WITH_MEDIA },
    });
    return posts.map((p) => toPostRecord(p));
  }

  /**
   * An unfiltered candidate set — see GetFeedOptions's doc comment for why
   * entitlement filtering happens in the caller, not here (same "storage
   * doesn't know about entitlement" discipline as everywhere else in this
   * class). `creator.status === "ACTIVE"` IS enforced here though — a
   * suspended creator's posts (public or not) never belong in anyone's
   * feed, the same rule findActiveCreatorByIdentifier already applies
   * everywhere else a creator is looked up by the public.
   */
  async getFeed(options: GetFeedOptions = {}): Promise<PostRecord[]> {
    const posts = await this.prisma.post.findMany({
      where: {
        deletedAt: null,
        creator: { status: "ACTIVE" },
        OR: [
          { visibility: "PUBLIC" },
          ...(options.unlockedCreatorIds && options.unlockedCreatorIds.length > 0
            ? [{ creatorId: { in: options.unlockedCreatorIds }, visibility: { in: ["SUBSCRIBERS", "TIER"] as ("SUBSCRIBERS" | "TIER")[] } }]
            : []),
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      include: { creator: { select: { did: true } }, ...WITH_MEDIA },
    });
    return posts.map((p) => toPostRecord(p));
  }
}
