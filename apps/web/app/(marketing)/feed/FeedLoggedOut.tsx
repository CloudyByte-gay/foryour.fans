import { Rss } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";

/**
 * `/feed` for an anonymous visitor (WEB PHASE 9): a chosen answer
 * (requirement #1), not a redirect and not the real — possibly public-only —
 * stream. Explains what the feed is and offers a login CTA.
 */
export function FeedLoggedOut() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-muted">
        <Rss className="h-5 w-5" aria-hidden />
      </span>
      <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">Your feed, once you're signed in</h1>
      <p className="mt-2 text-muted">
        Log in to see public posts from across the network alongside subscriber-only posts from
        creators you support.
      </p>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href={`/login?next=${encodeURIComponent("/feed")}`}>Log in</Link>
        </Button>
        <Button asChild size="lg" variant="secondary">
          <Link href="/discover">Browse creators</Link>
        </Button>
      </div>
    </div>
  );
}
