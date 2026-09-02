"use client";

import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  toast,
} from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { POST_VISIBILITY_META, deletePost, type OwnPost } from "@/lib/post";

export function PostList({
  initialPosts,
  pageAddress,
}: {
  initialPosts: OwnPost[];
  pageAddress: string;
}) {
  const [posts, setPosts] = useState<OwnPost[]>(initialPosts);
  const [deleting, setDeleting] = useState<OwnPost | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    const outcome = await deletePost(deleting.id);
    setBusy(false);
    if (!outcome.ok) {
      toast({ title: "Couldn't delete the post", description: outcome.message, variant: "error" });
      return;
    }
    setPosts((prev) => prev.filter((p) => p.id !== deleting.id));
    setDeleting(null);
    toast({ title: "Post deleted" });
  }

  if (posts.length === 0) {
    return (
      <EmptyState
        title="No posts yet"
        description="Write your first post — a text update for your subscribers, or something public for everyone."
        action={
          <Button asChild size="sm">
            <Link href="/creator/posts/new">New post</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {posts.map((post) => {
          const meta = POST_VISIBILITY_META[post.visibility];
          return (
            <li key={post.id}>
              <Card>
                <CardContent className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={meta.badge}>{meta.label}</Badge>
                      <span className="text-xs text-muted">{relativeTime(post.createdAt)}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 whitespace-pre-line text-sm">{post.text}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/creator/posts/${post.id}/edit`}>
                        <Pencil className="h-4 w-4" aria-hidden />
                        <span className="sr-only sm:not-sr-only">Edit</span>
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleting(post)}
                      aria-label={`Delete post from ${relativeTime(post.createdAt)}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-sm text-muted">
        These show on{" "}
        <Link href={`/c/${pageAddress}`} className="text-primary hover:underline">
          your page
        </Link>
        .
      </p>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && !busy && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this post?</DialogTitle>
            <DialogDescription>
              This can&rsquo;t be undone. If the post is public, it&rsquo;s also removed from the AT
              Protocol network.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={confirmDelete} loading={busy}>
              Delete post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
