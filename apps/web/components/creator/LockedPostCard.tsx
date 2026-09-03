import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { Badge, Button } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { formatPrice } from "@/lib/tier";
import type { LockedPostView } from "@/lib/post";
import { PostNav } from "@/components/post/PostNav";

/**
 * The locked treatment for a viewer without entitlement (anonymous,
 * non-subscriber, wrong tier). It renders ONLY the safe metadata the API
 * puts in a locked stub — id, creator, createdAt, visibility, required tier.
 * There is no post body or media reference to show, by construction: the
 * server never sends one. Do not add anything here that would need the post
 * text. `newerId`/`olderId` (WEB PHASE 9) render prev/next links within the
 * creator's feed — a locked post can still be skipped past.
 */
export function LockedPostCard({
  creatorAddress,
  creatorName,
  isAuthed,
  view,
  newerId = null,
  olderId = null,
}: {
  creatorAddress: string;
  creatorName: string;
  isAuthed: boolean;
  view: LockedPostView;
  newerId?: string | null;
  olderId?: string | null;
}) {
  const isTier = view.visibility === "TIER";
  const tier = view.requiredTier;

  const subscribeHref = isAuthed
    ? `/c/${creatorAddress}#tiers-heading`
    : `/login?next=${encodeURIComponent(`/c/${creatorAddress}`)}`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link
        href={`/c/${creatorAddress}`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {creatorName}
      </Link>

      <div className="mt-4 flex items-center gap-2">
        <Badge variant="locked">
          <Lock className="h-3 w-3" aria-hidden />
          {isTier ? "Premium" : "Subscribers only"}
        </Badge>
        <span className="text-sm text-muted">{relativeTime(view.createdAt)}</span>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface-muted p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-locked" aria-hidden />
        <h1 className="mt-3 font-display text-lg font-semibold">
          {isTier && tier
            ? `This post is for ${tier.name} members`
            : `This post is for ${creatorName}'s subscribers`}
        </h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          {isTier && tier
            ? `Subscribe to ${tier.name} (${formatPrice(tier.priceCents, tier.currency)}/month) or a higher tier to unlock it.`
            : "Subscribe to unlock this post and everything else behind the paywall."}
        </p>
        {view.hasMedia && (
          <p className="mt-1 text-xs text-muted">Includes an attachment.</p>
        )}
        <Button asChild className="mt-5">
          <Link href={subscribeHref}>{isAuthed ? "See subscription options" : "Log in to subscribe"}</Link>
        </Button>
      </div>

      <PostNav creatorAddress={creatorAddress} newerId={newerId} olderId={olderId} />
    </div>
  );
}
