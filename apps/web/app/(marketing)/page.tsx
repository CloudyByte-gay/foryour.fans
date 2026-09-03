import type { Metadata } from "next";
import { Hero } from "@/components/marketing/Hero";
import { PersonalizedPanel } from "@/components/marketing/PersonalizedPanel";
import {
  BuiltOnAtproto,
  FeaturedCreators,
  ForCreators,
  HowItWorks,
} from "@/components/marketing/Sections";
import type { DiscoveryPage } from "@/lib/discover";
import { fetchApi } from "@/lib/serverApi";
import { getOwnCreator, getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "foryour.fans — a portable paid creator network",
  description:
    "An AT Protocol-native paid creator network. Your identity is a portable DID, not a username and password we own. Public posts on the open network, subscriber-only content kept private.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "foryour.fans — a portable paid creator network",
    description:
      "Bring your AT Protocol identity, follow and subscribe, access tiered content. Leave any time without losing your audience.",
    url: "/",
    type: "website",
  },
};

/**
 * Home. Anonymous visitors get the marketing hero; logged-in visitors get a
 * personalized panel in its place (never a redirect). The session is the one
 * already resolved by the marketing layout — `cache()`-deduped, no extra call,
 * and no authenticated endpoints are hit.
 */
export default async function HomePage() {
  const session = await getSession();
  const isAuthed = session.status === "authenticated" && session.user !== null;
  const creator = isAuthed ? await getOwnCreator() : null;

  const discoverRes = await fetchApi("/discover?limit=6");
  const featured: DiscoveryPage = discoverRes.ok
    ? ((await discoverRes.json()) as DiscoveryPage)
    : { creators: [], nextCursor: null };

  return (
    <>
      {isAuthed && session.user ? (
        <PersonalizedPanel user={session.user} isCreator={creator !== null} />
      ) : (
        <Hero />
      )}
      <HowItWorks />
      <ForCreators />
      <BuiltOnAtproto />
      <FeaturedCreators creators={featured.creators} />
    </>
  );
}
