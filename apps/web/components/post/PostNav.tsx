import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

/**
 * Prev/next navigation within a creator's feed (WEB PHASE 9), shown at the
 * bottom of a single post view. `newerId`/`olderId` come from
 * `findFeedNeighbors` — both null renders nothing.
 */
export function PostNav({
  creatorAddress,
  newerId,
  olderId,
}: {
  creatorAddress: string;
  newerId: string | null;
  olderId: string | null;
}) {
  if (!newerId && !olderId) return null;

  return (
    <nav
      aria-label="More posts from this creator"
      className="mt-8 flex items-center justify-between border-t border-border pt-4 text-sm"
    >
      {newerId ? (
        <Link
          href={`/c/${creatorAddress}/post/${newerId}`}
          className="inline-flex items-center gap-1 text-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Newer
        </Link>
      ) : (
        <span />
      )}
      {olderId ? (
        <Link
          href={`/c/${creatorAddress}/post/${olderId}`}
          className="inline-flex items-center gap-1 text-muted hover:text-foreground"
        >
          Older
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
