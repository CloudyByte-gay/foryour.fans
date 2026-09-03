import { Lock } from "lucide-react";
import Link from "next/link";
import { Badge, Card, CardContent } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { bskyAppUrl, isLocked, postBadges, type FeedPost } from "@/lib/post";
import { MediaThumb } from "@/components/media/MediaThumb";

/**
 * Renders ONE authored post. A dual-published public post
 * (`app.bsky.feed.post` + `fans.foryour.post`) is a single card with a
 * "Bluesky" chip — never two cards (prompts/bluesky-public-posts.md "Do not
 * create separate duplicated cards"). A gated post the viewer can't see
 * renders as a locked stub with no body. `viewerIsOwner` suppresses the
 * "Subscribed" badge on the creator's own view of their gated post.
 */
export function PostCard({
  post,
  href,
  viewerIsOwner,
}: {
  post: FeedPost;
  href?: string;
  viewerIsOwner?: boolean;
}) {
  const badges = postBadges(post, { viewerIsOwner });
  const locked = isLocked(post);
  const handleOrDid = post.creator?.handle ?? post.creator?.did ?? null;
  const bskyLink = locked ? null : bskyAppUrl(post.bskyAtUri, handleOrDid);

  return (
    <Card data-testid="post-card" data-visibility={post.visibility}>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {badges.map((b) => (
            <Badge key={b.label} variant={b.variant}>
              {b.label === "Locked" && <Lock className="h-3 w-3" aria-hidden />}
              {b.label}
            </Badge>
          ))}
          <span className="ml-auto text-xs text-muted">{relativeTime(post.createdAt)}</span>
        </div>

        {locked ? (
          <p className="text-sm text-muted">
            {post.requiredTier
              ? `Unlock with the ${post.requiredTier.name} tier.`
              : "Subscribe to unlock this post."}
            {post.hasMedia ? " Includes media." : ""}
          </p>
        ) : (
          <>
            <p className="whitespace-pre-line text-sm leading-relaxed">
              {href ? (
                <Link href={href} className="hover:underline">
                  {post.text}
                </Link>
              ) : (
                post.text
              )}
            </p>
            {post.media.length > 0 && <MediaThumb media={post.media} />}
          </>
        )}

        {bskyLink && (
          <a
            href={bskyLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs text-primary hover:underline"
          >
            View on Bluesky ↗
          </a>
        )}
      </CardContent>
    </Card>
  );
}
