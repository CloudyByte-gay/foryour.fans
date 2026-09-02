import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { POST_VISIBILITY_META, type UnlockedPostView } from "@/lib/post";

/**
 * A fully-readable post — shown to an entitled viewer, the creator, or anyone
 * for a PUBLIC post. Body text is rendered as plain text with line breaks
 * preserved; it is never interpreted as HTML/markdown (see lib/post.ts).
 */
export function PostArticle({
  creatorAddress,
  creatorName,
  view,
}: {
  creatorAddress: string;
  creatorName: string;
  view: UnlockedPostView;
}) {
  const meta = POST_VISIBILITY_META[view.visibility];

  return (
    <article className="mx-auto max-w-2xl px-4 py-8">
      <Link
        href={`/c/${creatorAddress}`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {creatorName}
      </Link>

      <div className="mt-4 flex items-center gap-2">
        <Badge variant={meta.badge}>{meta.label}</Badge>
        <span className="text-sm text-muted">{relativeTime(view.createdAt)}</span>
      </div>

      <div className="mt-4 whitespace-pre-line text-[15px] leading-relaxed">{view.text}</div>

      {view.visibility !== "PUBLIC" && (
        <p className="mt-8 border-t border-border pt-4 text-xs text-muted">
          This post is only on foryour.fans — it is not published to the AT Protocol network.
        </p>
      )}
    </article>
  );
}
