import type { Metadata } from "next";
import { Compass, Lock, Pencil } from "lucide-react";
import Link from "next/link";
import { cache } from "react";
import { Avatar, Badge, Button, EmptyState } from "@/components/ui";
import { monthYear } from "@/lib/format";
import { fetchApi } from "@/lib/serverApi";
import { getSession } from "@/lib/session";

interface PublicCreator {
  did: string;
  slug: string;
  displayName: string | null;
  bio: string | null;
  website: string | null;
  createdAt: string;
}

// `cache()` so generateMetadata and the page share one request.
const loadCreator = cache(
  async (identifier: string): Promise<PublicCreator | null | "error"> => {
    try {
      const res = await fetchApi(`/creators/${encodeURIComponent(identifier)}`);
      if (res.status === 404) return null;
      if (!res.ok) return "error";
      return (await res.json()) as PublicCreator;
    } catch {
      return "error";
    }
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const creator = await loadCreator(slug);
  if (!creator || creator === "error") {
    return { title: "Creator not found", robots: { index: false } };
  }
  const name = creator.displayName ?? `@${creator.slug}`;
  const description = creator.bio?.slice(0, 160) ?? `${name} on foryour.fans.`;
  return {
    title: name,
    description,
    alternates: { canonical: `/c/${creator.slug}` },
    // Inherits the brand-only OG image from the root layout — never a user or
    // NSFW asset in a preview (requirement #5).
    openGraph: { title: name, description, url: `/c/${creator.slug}`, type: "profile" },
  };
}

export default async function CreatorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [creator, session] = await Promise.all([loadCreator(slug), getSession()]);

  if (creator === "error") {
    throw new Error("Failed to load creator");
  }

  if (!creator) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20">
        <EmptyState
          icon={Compass}
          title="This creator isn't available"
          description="The page may have been removed, or the address is wrong. If you followed a link with an old slug, the creator may have changed it."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/discover">Browse creators</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const isOwner = session.status === "authenticated" && session.user?.did === creator.did;
  const name = creator.displayName ?? `@${creator.slug}`;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      {/* Banner — a plain gradient until image upload lands (WEB PHASE 8). */}
      <div className="mt-4 h-36 rounded-xl bg-gradient-to-br from-primary/30 via-primary/10 to-locked/20 sm:h-48" />

      <div className="-mt-10 flex flex-wrap items-end gap-4 px-1 sm:-mt-12">
        <Avatar
          src={null}
          name={name}
          size="xl"
          className="ring-4 ring-background"
        />
        <div className="flex-1">
          <h1 className="font-display text-2xl font-bold tracking-tight">{name}</h1>
          <p className="text-sm text-muted">@{creator.slug}</p>
        </div>
        {isOwner ? (
          <Button asChild variant="secondary" size="sm">
            <Link href="/creator/settings">
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </Link>
          </Button>
        ) : (
          <div className="flex flex-col items-end">
            <Button disabled size="sm">
              <Lock className="h-4 w-4" aria-hidden />
              Subscribe
            </Button>
            <span className="mt-1 text-xs text-muted">Subscriptions open soon</span>
          </div>
        )}
      </div>

      {creator.bio && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{creator.bio}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        {creator.website && (
          <a
            href={creator.website}
            rel="nofollow noopener noreferrer"
            target="_blank"
            className="text-primary hover:underline"
          >
            {creator.website.replace(/^https?:\/\//, "")}
          </a>
        )}
        <span>Member since {monthYear(creator.createdAt)}</span>
        {isOwner && <Badge variant="neutral">This is your page</Badge>}
      </div>

      <section aria-labelledby="tiers-heading" className="mt-10">
        <h2 id="tiers-heading" className="font-display text-lg font-semibold">
          Membership tiers
        </h2>
        <div className="mt-3">
          <EmptyState
            title="No tiers yet"
            description={
              isOwner
                ? "You'll be able to create subscription tiers here soon."
                : "This creator hasn't set up subscription tiers yet."
            }
          />
        </div>
      </section>

      <section aria-labelledby="posts-heading" className="mt-10">
        <h2 id="posts-heading" className="font-display text-lg font-semibold">
          Posts
        </h2>
        <div className="mt-3">
          <EmptyState
            title="Nothing posted yet"
            description={
              isOwner ? "Your public posts will show up here." : "Check back later for posts."
            }
          />
        </div>
      </section>
    </div>
  );
}
