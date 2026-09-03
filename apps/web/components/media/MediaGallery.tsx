"use client";

import { AlertTriangle, Film, Lock } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui";
import type { PostMediaItem } from "@/lib/mediaItems";
import { useSignedMedia } from "./useSignedMedia";
import { MediaLightbox } from "./MediaLightbox";

export type { PostMediaItem } from "@/lib/mediaItems";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * The attachment grid shown on a post the viewer can read. Every item
 * resolves its own short-lived signed URL via `GET /media/:id/access`
 * (`useSignedMedia`); nothing here embeds a storage URL. Clicking an item
 * opens the keyboard-navigable `MediaLightbox`.
 */
export function MediaGallery({ items }: { items: PostMediaItem[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  if (items.length === 0) return null;

  return (
    <>
      <ul
        className={`mt-4 grid gap-2 ${items.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
        data-testid="media-gallery"
      >
        {items.map((item, index) => (
          <li key={item.mediaAssetId}>
            <GalleryTile item={item} onOpen={() => setLightbox(index)} />
          </li>
        ))}
      </ul>
      {lightbox !== null && (
        <MediaLightbox items={items} index={lightbox} onIndexChange={setLightbox} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}

function GalleryTile({ item, onOpen }: { item: PostMediaItem; onOpen: () => void }) {
  const media = useSignedMedia(item.mediaAssetId);
  const [revealed, setRevealed] = useState(false);
  const blurred = item.nsfw && !revealed;

  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : "4 / 3";

  if (media.status === "loading") {
    return <Skeleton className="w-full rounded-lg" style={{ aspectRatio: ratio }} />;
  }

  if (media.status !== "ready") {
    return (
      <div
        className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-border bg-surface-muted p-4 text-center text-xs text-muted"
        style={{ aspectRatio: ratio }}
      >
        {media.status === "locked" ? (
          <>
            <Lock className="h-4 w-4" aria-hidden />
            Locked attachment
          </>
        ) : (
          <>
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Attachment unavailable
            {media.status === "error" && (
              <button type="button" onClick={media.retry} className="mt-1 text-primary hover:underline">
                Retry
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border" style={{ aspectRatio: ratio }}>
      <button
        type="button"
        onClick={blurred ? () => setRevealed(true) : onOpen}
        className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={blurred ? "Reveal sensitive media" : item.kind === "video" ? "Play video" : "View image"}
      >
        {item.kind === "video" ? (
          <video
            src={media.url}
            muted
            playsInline
            preload="metadata"
            className={`h-full w-full object-cover ${blurred ? "blur-2xl" : ""}`}
          />
        ) : (
          <img
            src={media.url}
            alt={item.alt ?? ""}
            className={`h-full w-full object-cover transition-transform group-hover:scale-[1.02] ${blurred ? "blur-2xl" : ""}`}
          />
        )}
      </button>

      {blurred && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-foreground/10 text-xs font-medium text-surface">
          Sensitive — tap to reveal
        </span>
      )}

      {!blurred && item.kind === "video" && (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded bg-foreground/70 px-1.5 py-0.5 text-[11px] font-medium text-surface">
          <Film className="h-3 w-3" aria-hidden />
          {item.durationSeconds ? formatDuration(item.durationSeconds) : "Video"}
        </span>
      )}
    </div>
  );
}
