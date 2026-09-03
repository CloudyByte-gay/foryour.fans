import type { Metadata } from "next";
import { fetchApi } from "@/lib/serverApi";
import { getSession } from "@/lib/session";
import type { FullPost } from "@/lib/post";
import { FeedList } from "./FeedList";
import { FeedLoggedOut } from "./FeedLoggedOut";

export const metadata: Metadata = { title: "Feed" };

/**
 * The home feed (WEB PHASE 9). Lives in the `(marketing)` group rather than
 * `(app)` — an anonymous visit here is a *chosen* answer (requirement #1): a
 * logged-out explainer + login CTA, never the `(app)` group's redirect and
 * never an empty stream (the API's `/feed` would actually serve one — PUBLIC
 * posts only — but the phase spec calls for the explainer instead).
 */
export default async function FeedPage() {
  const session = await getSession();
  const isAuthed = session.status === "authenticated" && session.user !== null;

  if (!isAuthed) {
    return <FeedLoggedOut />;
  }

  const res = await fetchApi("/feed?limit=20");
  const initial = res.ok ? ((await res.json()) as FullPost[]) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Feed</h1>
        <p className="mt-1 text-muted">
          Public posts (also on Bluesky) plus posts from creators you subscribe to.
        </p>
      </div>
      <FeedList initialPosts={initial} />
    </div>
  );
}
