"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { useSignedMedia } from "./useSignedMedia";
import type { PostMediaItem } from "@/lib/mediaItems";

/**
 * Full-size viewer. Built on Radix `Dialog` so it is focus-trapped and
 * `Esc`-closable for free (cross-cutting a11y req #6); left/right arrows and
 * on-screen chevrons page between items. Each frame resolves its own signed
 * URL — a URL for one item is never reused for another.
 */
export function MediaLightbox({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  items: PostMediaItem[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const count = items.length;
  const go = useCallback(
    (delta: number) => onIndexChange((index + delta + count) % count),
    [index, count, onIndexChange],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const current = items[index];

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/80 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center p-4 focus:outline-none"
          aria-label="Media viewer"
        >
          <DialogPrimitive.Title className="sr-only">
            Attachment {index + 1} of {count}
          </DialogPrimitive.Title>

          {current && <LightboxFrame key={current.mediaAssetId} item={current} />}

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-surface/90 p-2 text-foreground shadow-pop hover:bg-surface"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-surface/90 p-2 text-foreground shadow-pop hover:bg-surface"
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
              <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-surface/90 px-3 py-1 text-xs text-muted">
                {index + 1} / {count}
              </p>
            </>
          )}

          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-3 top-3 rounded-full bg-surface/90 p-2 text-foreground shadow-pop hover:bg-surface"
          >
            <X className="h-5 w-5" aria-hidden />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function LightboxFrame({ item }: { item: PostMediaItem }) {
  const media = useSignedMedia(item.mediaAssetId);
  const [revealed, setRevealed] = useState(false);
  const blur = item.nsfw && !revealed;

  if (media.status === "loading") {
    return <Spinner className="text-surface" aria-label="Loading attachment" />;
  }
  if (media.status !== "ready") {
    return (
      <p className="rounded-lg bg-surface px-4 py-3 text-sm text-muted">
        {media.status === "locked" ? "This attachment is locked." : "This attachment is unavailable."}
      </p>
    );
  }

  return (
    <div className="relative flex max-h-full max-w-full items-center justify-center">
      {item.kind === "video" ? (
        // No <track> to offer: this platform has no captioning pipeline for
        // creator-uploaded video (a known, documented gap — see README's
        // "Video transcoding... implementations" note under Phase 8) so
        // there is no caption file to reference here. A real fix is adding
        // that pipeline, not something to fake in this hardening pass.
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={media.url} controls autoPlay className={`max-h-[85vh] max-w-[90vw] rounded-lg ${blur ? "blur-2xl" : ""}`} />
      ) : (
        <img
          src={media.url}
          alt={item.alt ?? ""}
          className={`max-h-[85vh] max-w-[90vw] rounded-lg object-contain ${blur ? "blur-2xl" : ""}`}
        />
      )}
      {blur && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="absolute rounded-full bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-pop"
        >
          Reveal sensitive media
        </button>
      )}
    </div>
  );
}
