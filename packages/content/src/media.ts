import type { PrismaClient } from "@foryour-fans/database";

/**
 * Media-attachment support for the content repositories — the writer
 * `PostMedia` never had (WEB PHASE 8 / prompts/web.md). Kept in its own
 * module so both `PrivateContentRepository` and
 * `CreatorOwnedContentRepository` share exactly one set of validation
 * rules and one PostMedia-row writer.
 *
 * Storage-only discipline, same as the rest of this package: this validates
 * that an attached asset is a real, READY asset *owned by the posting
 * creator* — an integrity check, not an entitlement one. Who is allowed to
 * *download* the bytes later is decided by `GET /media/:id/access` in
 * apps/api, against the post the media hangs off.
 */

export class PostMediaError extends Error {}

/** One attachment as the API/composer sends it. */
export interface PostMediaInput {
  mediaAssetId: string;
  sortOrder: number;
}

/**
 * One resolved attachment as a `PostRecord` exposes it — the ref plus the
 * asset metadata a renderer needs to lay out the item before it fetches a
 * signed URL (image vs video, aspect ratio, video length). No storage key
 * or signed URL: those only ever come from `GET /media/:id/access`.
 */
export interface PostMediaRef {
  mediaAssetId: string;
  sortOrder: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

/** A post can carry at most this many attachments — matches the composer's reorderable list. */
export const MAX_POST_MEDIA = 20;
/** `sortOrder` is a small non-negative display index, never a timestamp or arbitrary int. */
export const MAX_MEDIA_SORT_ORDER = 999;

/**
 * Validates a create/update's `media` list against the DB and returns it
 * normalised (deduped, sorted by `sortOrder`, `sortOrder` re-packed to a
 * dense 0..n-1 so it is always stable and bounded regardless of what the
 * client sent). Throws `PostMediaError` (→ 400 at the route) on any of:
 * too many attachments, an unknown asset id, an asset owned by another
 * creator, or an asset that is not `READY`.
 */
export async function resolvePostMedia(
  prisma: PrismaClient,
  creatorId: string,
  media: PostMediaInput[] | undefined,
): Promise<PostMediaRef[]> {
  if (!media || media.length === 0) {
    return [];
  }
  if (media.length > MAX_POST_MEDIA) {
    throw new PostMediaError(`A post can have at most ${MAX_POST_MEDIA} attachments.`);
  }
  for (const item of media) {
    if (!Number.isInteger(item.sortOrder) || item.sortOrder < 0 || item.sortOrder > MAX_MEDIA_SORT_ORDER) {
      throw new PostMediaError("Each attachment's sortOrder must be a small non-negative integer.");
    }
  }

  // Dedupe by asset id, keeping the first occurrence's sortOrder.
  const byId = new Map<string, number>();
  for (const item of media) {
    if (!byId.has(item.mediaAssetId)) {
      byId.set(item.mediaAssetId, item.sortOrder);
    }
  }
  const ids = [...byId.keys()];

  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: ids } } });
  const assetById = new Map(assets.map((a) => [a.id, a]));
  for (const id of ids) {
    const asset = assetById.get(id);
    if (!asset || asset.creatorId !== creatorId) {
      throw new PostMediaError("An attached media asset does not exist or does not belong to you.");
    }
    if (asset.status !== "READY") {
      throw new PostMediaError("An attached media asset is not ready yet.");
    }
  }

  return ids
    .map((id) => ({ id, sortOrder: byId.get(id)! }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((ref, index) => {
      const asset = assetById.get(ref.id)!;
      return {
        mediaAssetId: ref.id,
        sortOrder: index,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        durationSeconds: asset.duration,
      };
    });
}

/**
 * Replaces a post's `PostMedia` rows with `refs` (already validated by
 * `resolvePostMedia`). Full-replace semantics — an empty `refs` clears all
 * attachments — matching the composer's full-replace `PATCH`.
 */
export async function writePostMedia(
  prisma: Pick<PrismaClient, "postMedia">,
  postId: string,
  refs: Array<{ mediaAssetId: string; sortOrder: number }>,
): Promise<void> {
  await prisma.postMedia.deleteMany({ where: { postId } });
  if (refs.length > 0) {
    await prisma.postMedia.createMany({
      data: refs.map((ref) => ({ postId, mediaAssetId: ref.mediaAssetId, sortOrder: ref.sortOrder })),
    });
  }
}

/** The included-row shape `toMediaRefs` needs — every content-repo read uses `WITH_MEDIA`. */
export interface IncludedPostMediaRow {
  mediaAssetId: string;
  sortOrder: number;
  mediaAsset: { mimeType: string; width: number | null; height: number | null; duration: number | null };
}

/** The Prisma `include` clause every `ContentRepository` read applies to shape `PostRecord.media`. */
export const POST_MEDIA_INCLUDE = {
  media: {
    orderBy: { sortOrder: "asc" },
    include: { mediaAsset: { select: { mimeType: true, width: true, height: true, duration: true } } },
  },
} as const;

/** Shapes the `media` field of a `PostRecord` from included `PostMedia` rows. */
export function toMediaRefs(rows: IncludedPostMediaRow[] | undefined): PostMediaRef[] {
  return [...(rows ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => ({
      mediaAssetId: row.mediaAssetId,
      sortOrder: row.sortOrder,
      mimeType: row.mediaAsset.mimeType,
      width: row.mediaAsset.width,
      height: row.mediaAsset.height,
      durationSeconds: row.mediaAsset.duration,
    }));
}
