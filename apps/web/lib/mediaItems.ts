import { mediaKind } from "@/lib/media";
import type { PostMedia } from "@/lib/post";

/**
 * One attachment ready for rendering, derived from a post's `media[]` entry.
 * Plain module (no `"use client"`) so a Server Component can call
 * `toGalleryItems` and hand the result to the client `MediaGallery`.
 */
export interface PostMediaItem {
  mediaAssetId: string;
  sortOrder: number;
  kind: "image" | "video";
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  /**
   * Blur-by-default until an explicit reveal. There is no content-label API
   * before WEB PHASE 14, so this is `false` unless a caller opts in — the
   * blur *mechanism* is what ships now.
   */
  nsfw?: boolean;
  alt?: string;
}

export function toGalleryItems(media: PostMedia[], opts: { nsfw?: boolean } = {}): PostMediaItem[] {
  return [...media]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((m) => ({
      mediaAssetId: m.mediaAssetId,
      sortOrder: m.sortOrder,
      kind: mediaKind(m.mimeType) ?? "image",
      width: m.width,
      height: m.height,
      durationSeconds: m.durationSeconds,
      nsfw: opts.nsfw ?? false,
    }));
}
