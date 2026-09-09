import type { Metadata } from "next";
import { DiscoverBrowser } from "@/components/discover/DiscoverBrowser";
import type { DiscoveryPage } from "@/lib/discover";
import { fetchApi } from "@/lib/serverApi";

export const metadata: Metadata = {
  title: "Search creators",
  description: "Search creators by name, handle, or bio.",
  alternates: { canonical: "/search" },
  robots: { index: false },
};

const EMPTY_PAGE: DiscoveryPage = { creators: [], nextCursor: null };

/**
 * Search creators (WEB PHASE 10) — shares `DiscoverBrowser` with `/discover`;
 * this route just seeds it with the `?q=` page instead of the unfiltered
 * one. No auth required, must render fully for anonymous visitors.
 */
export default async function SearchPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const searchParams = await searchParamsPromise;
  const q = (Array.isArray(searchParams.q) ? searchParams.q[0] : searchParams.q)?.trim() ?? "";

  const path = q ? `/search?limit=24&q=${encodeURIComponent(q)}` : "/discover?limit=24";
  const res = await fetchApi(path);
  const initialPage: DiscoveryPage = res.ok ? ((await res.json()) as DiscoveryPage) : EMPTY_PAGE;

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight">Search creators</h1>
      <p className="mt-2 text-muted">Search by name, handle, or bio.</p>

      <div className="mt-8">
        <DiscoverBrowser initialQuery={q} initialPage={initialPage} />
      </div>
    </div>
  );
}
