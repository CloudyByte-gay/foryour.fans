"use client";

import { Film, ImageOff, Images } from "lucide-react";
import { Skeleton } from "@/components/ui";
import { mediaKind } from "@/lib/media";
import { useSignedMedia } from "./useSignedMedia";

interface ThumbMedia {
  mediaAssetId: string;
  sortOrder: number;
  mimeType: string;
  width: number | null;
  height: number | null;
}

/**
 * A single preview thumbnail for a feed card — the first attachment, with a
 * "+N" chip when there are more. The card itself links to the post, where
 * `MediaGallery` renders the full set, so this has no lightbox. Blurs when
 * `nsfw` (no reveal control here — that lives on the post page).
 */
export function MediaThumb({ media, nsfw = false }: { media: ThumbMedia[]; nsfw?: boolean }) {
  const first = [...media].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const signed = useSignedMedia(first?.mediaAssetId ?? "", Boolean(first));
  if (!first) return null;

  const kind = mediaKind(first.mimeType) ?? "image";
  const ratio = first.width && first.height ? `${first.width} / ${first.height}` : "16 / 9";
  const extra = media.length - 1;

  return (
    <div
      className="relative mt-3 overflow-hidden rounded-lg border border-border"
      style={{ aspectRatio: ratio, maxHeight: "20rem" }}
      data-testid="media-thumb"
    >
      {signed.status === "loading" && <Skeleton className="h-full w-full" />}

      {signed.status === "ready" &&
        (kind === "video" ? (
          <video src={signed.url} muted playsInline preload="metadata" className={`h-full w-full object-cover ${nsfw ? "blur-2xl" : ""}`} />
        ) : (
          <img src={signed.url} alt="" className={`h-full w-full object-cover ${nsfw ? "blur-2xl" : ""}`} />
        ))}

      {signed.status !== "loading" && signed.status !== "ready" && (
        <div className="flex h-full w-full items-center justify-center bg-surface-muted text-muted">
          <ImageOff className="h-5 w-5" aria-hidden />
        </div>
      )}

      {nsfw && signed.status === "ready" && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-foreground/10 text-xs font-medium text-surface">
          Sensitive media
        </span>
      )}

      {kind === "video" && (
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-foreground/70 p-1 text-surface">
          <Film className="h-3 w-3" aria-hidden />
        </span>
      )}
      {extra > 0 && (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded bg-foreground/70 px-1.5 py-0.5 text-[11px] font-medium text-surface">
          <Images className="h-3 w-3" aria-hidden />+{extra}
        </span>
      )}
    </div>
  );
}
