import Link from "next/link";
import { ImageIcon, PenSquare } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { POST_VISIBILITY_META, type PostVisibility } from "@/lib/post";
import type { DashboardRecentPost } from "@/lib/dashboard";

function excerpt(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export function RecentPostsList({ posts, pageAddress }: { posts: DashboardRecentPost[]; pageAddress: string }) {
  if (posts.length === 0) {
    return (
      <EmptyState
        title="No posts yet"
        description="Your most recent posts will show up here."
        icon={PenSquare}
        action={
          <Button asChild size="sm">
            <Link href="/creator/posts/new">New post</Link>
          </Button>
        }
      />
    );
  }

  return (
    <ul className="divide-y divide-border">
      {posts.map((post) => {
        const meta = POST_VISIBILITY_META[post.visibility as PostVisibility];
        return (
          <li key={post.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={meta.badge}>{meta.label}</Badge>
                <span className="text-xs text-muted">{relativeTime(post.createdAt)}</span>
                {post.mediaCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-muted">
                    <ImageIcon className="h-3 w-3" aria-hidden />
                    {post.mediaCount}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-sm">{excerpt(post.text)}</p>
            </div>
            <Link
              href={`/c/${pageAddress}/post/${post.id}`}
              className="shrink-0 whitespace-nowrap text-sm font-medium text-primary hover:underline"
            >
              View
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
