import type { Metadata } from "next";
import { DiscoverBrowser } from "@/components/discover/DiscoverBrowser";
import type { DiscoveryPage } from "@/lib/discover";
import { fetchApi } from "@/lib/serverApi";

export const metadata: Metadata = {
  title: "Discover creators",
  description: "Browse creators on foryour.fans.",
  alternates: { canonical: "/discover" },
};

const EMPTY_PAGE: DiscoveryPage = { creators: [], nextCursor: null };

/**
 * Browse creators (WEB PHASE 10) — no auth required, must render fully for
 * anonymous visitors. `DiscoverBrowser` also backs `/search`; this route
 * seeds it with the unfiltered first page.
 */
export default async function DiscoverPage() {
  const res = await fetchApi("/discover?limit=24");
  const initialPage: DiscoveryPage = res.ok ? ((await res.json()) as DiscoveryPage) : EMPTY_PAGE;

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight">Discover creators</h1>
      <p className="mt-2 text-muted">Browse creators across the network, most recently active first.</p>

      <div className="mt-8">
        <DiscoverBrowser initialQuery="" initialPage={initialPage} />
      </div>
    </div>
  );
}
