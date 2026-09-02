import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { bskyAppUrl, postBadges, type FullPost } from "@/lib/post";
import { fetchApi } from "@/lib/serverApi";

type LoadResult = { kind: "ok"; post: FullPost } | { kind: "locked" } | { kind: "missing" } | { kind: "error" };

async function loadPost(id: string): Promise<LoadResult> {
  try {
    const res = await fetchApi(`/posts/${encodeURIComponent(id)}`);
    if (res.status === 404) return { kind: "missing" };
    if (res.status === 403) return { kind: "locked" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", post: (await res.json()) as FullPost };
  } catch {
    return { kind: "error" };
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await loadPost(decodeURIComponent(id));
  if (result.kind !== "ok") {
    return { title: "Post", robots: { index: false } };
  }
  return {
    title: result.post.text.slice(0, 60) || "Post",
    description: result.post.text.slice(0, 160) || undefined,
    robots: { index: false },
  };
}

export default async function SinglePostPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;
  const address = decodeURIComponent(handle);
  const result = await loadPost(decodeURIComponent(id));

  if (result.kind === "missing") notFound();
  if (result.kind === "error") throw new Error("Failed to load post");

  if (result.kind === "locked") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <Badge variant="locked">Locked</Badge>
            <h1 className="font-display text-xl font-semibold">This post is for subscribers</h1>
            <p className="text-sm text-muted">Subscribe to this creator to read it.</p>
            <Button asChild size="sm">
              <Link href={`/c/${encodeURIComponent(address)}`}>Go to the creator page</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { post } = result;
  const handleOrDid = post.creator?.handle ?? post.creator?.did ?? address;
  const bskyLink = bskyAppUrl(post.bskyAtUri, handleOrDid);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
      <Link href={`/c/${encodeURIComponent(address)}`} className="text-sm text-primary hover:underline">
        ← @{handleOrDid}
      </Link>
      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="flex flex-wrap items-center gap-2">
            {postBadges(post).map((b) => (
              <Badge key={b.label} variant={b.variant}>
                {b.label}
              </Badge>
            ))}
            <span className="ml-auto text-xs text-muted">{relativeTime(post.createdAt)}</span>
          </div>
          <p className="whitespace-pre-line leading-relaxed">{post.text}</p>
          <div className="flex flex-wrap gap-4 border-t border-border pt-3 text-xs text-muted">
            {bskyLink && (
              <a href={bskyLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                View on Bluesky ↗
              </a>
            )}
            {post.sourceCollections.length > 1 && (
              <span>Published as {post.sourceCollections.join(" + ")}</span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
