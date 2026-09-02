import type { Metadata } from "next";
import { Compass, Lock, Pencil } from "lucide-react";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { cache } from "react";
import { Avatar, Badge, Button, EmptyState } from "@/components/ui";
import { TierCard, type PublicTier } from "@/components/creator/TierCard";
import { monthYear } from "@/lib/format";
import { fetchApi } from "@/lib/serverApi";
import { getSession } from "@/lib/session";

interface PublicCreator {
  did: string;
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  website: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  createdAt: string;
}

type LoadResult = PublicCreator | { movedTo: string } | null | "error";

function decodeIdentifierParam(identifier: string): string {
  try {
    return decodeURIComponent(identifier);
  } catch {
    return identifier;
  }
}

// `cache()` so generateMetadata and the page share one request. The segment
// is a handle or a URL-encoded DID; a former handle comes back as a 301 with
// `{ movedTo }` (the API doesn't follow its own redirect, and neither do we —
// `redirect: "manual"` — so the page can issue a real Next redirect).
const loadCreator = cache(async (identifier: string): Promise<LoadResult> => {
  try {
    const res = await fetchApi(`/creators/${encodeURIComponent(identifier)}`, { redirect: "manual" });
    if (res.status === 404) return null;
    if (res.status === 301) {
      const body = (await res.json().catch(() => null)) as { movedTo?: string } | null;
      return body?.movedTo ? { movedTo: body.movedTo } : "error";
    }
    if (!res.ok) return "error";
    return (await res.json()) as PublicCreator;
  } catch {
    return "error";
  }
});

// Public, active-only tier list (apps/api `GET /creators/:identifier/tiers`).
// Anonymous-safe — no session needed. Any failure degrades to "no tiers"
// rather than erroring the whole page.
const loadTiers = cache(async (identifier: string): Promise<PublicTier[]> => {
  try {
    const res = await fetchApi(`/creators/${encodeURIComponent(identifier)}/tiers`);
    if (!res.ok) return [];
    return (await res.json()) as PublicTier[];
  } catch {
    return [];
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const identifier = decodeIdentifierParam(handle);
  const creator = await loadCreator(identifier);
  if (!creator || creator === "error" || "movedTo" in creator) {
    return { title: "Creator not found", robots: { index: false } };
  }
  const address = creator.handle ?? creator.did;
  const name = creator.displayName ?? `@${address}`;
  const description = creator.bio?.slice(0, 160) ?? `${name} on foryour.fans.`;
  return {
    title: name,
    description,
    alternates: { canonical: `/c/${address}` },
    // Inherits the brand-only OG image from the root layout — never a user or
    // NSFW asset in a preview (requirement #5).
    openGraph: { title: name, description, url: `/c/${address}`, type: "profile" },
  };
}

export default async function CreatorPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const identifier = decodeIdentifierParam(handle);
  const [creator, session] = await Promise.all([loadCreator(identifier), getSession()]);

  if (creator === "error") {
    throw new Error("Failed to load creator");
  }

  if (creator && "movedTo" in creator) {
    // The creator changed their AT handle — follow the DID to the new one.
    // Permanent (308): the old handle-address is not coming back.
    permanentRedirect(`/c/${creator.movedTo}`);
  }

  if (!creator) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20">
        <EmptyState
          icon={Compass}
          title="This creator isn't available"
          description="The page may have been removed, or the address is wrong. If you followed a link with an old handle, the creator may have changed it — a current link would redirect automatically."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/discover">Browse creators</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const address = creator.handle ?? creator.did;
  const isOwner = session.status === "authenticated" && session.user?.did === creator.did;
  const name = creator.displayName ?? `@${address}`;
  const tiers = await loadTiers(address);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      <div className="mt-4 h-36 overflow-hidden rounded-xl bg-gradient-to-br from-primary/30 via-primary/10 to-locked/20 sm:h-48">
        {creator.bannerUrl && (
          <img
            src={creator.bannerUrl}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        )}
      </div>

      <div className="-mt-10 flex flex-wrap items-end gap-4 px-1 sm:-mt-12">
        <Avatar
          src={creator.avatarUrl}
          name={name}
          size="xl"
          className="ring-4 ring-background"
        />
        <div className="flex-1">
          <h1 className="font-display text-2xl font-bold tracking-tight">{name}</h1>
          <p className="text-sm text-muted">@{address}</p>
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
        <div className="flex items-center justify-between gap-3">
          <h2 id="tiers-heading" className="font-display text-lg font-semibold">
            Membership tiers
          </h2>
          {isOwner && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/creator/tiers">Manage tiers</Link>
            </Button>
          )}
        </div>
        <div className="mt-3">
          {tiers.length === 0 ? (
            <EmptyState
              title="No tiers yet"
              description={
                isOwner
                  ? "Create subscription tiers from “Manage tiers”."
                  : "This creator hasn't set up subscription tiers yet."
              }
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {tiers.map((tier) => (
                <li key={tier.id}>
                  <TierCard
                    tier={tier}
                    action={
                      <div className="flex flex-col items-start gap-1">
                        <Button disabled size="sm" className="w-full">
                          <Lock className="h-4 w-4" aria-hidden />
                          Subscribe
                        </Button>
                        <span className="text-xs text-muted">Subscriptions open soon</span>
                      </div>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
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
