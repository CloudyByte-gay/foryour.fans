"use client";

import { Compass, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, InfiniteList, Input, Spinner } from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import type { DiscoveryCreator, DiscoveryPage } from "@/lib/discover";
import { CreatorCard } from "./CreatorCard";

const RECENT_SEARCHES_KEY = "ff_recent_searches";
const RECENT_SEARCHES_MAX = 6;
const PAGE_LIMIT = 24;
const DEBOUNCE_MS = 350;

function loadRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return loadRecentSearches();
  const deduped = loadRecentSearches().filter((q) => q.toLowerCase() !== trimmed.toLowerCase());
  const next = [trimmed, ...deduped].slice(0, RECENT_SEARCHES_MAX);
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // best effort — localStorage may be unavailable (private mode, quota)
  }
  return next;
}

async function fetchDiscoveryPage(query: string, cursor: string | null): Promise<DiscoveryPage> {
  const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (cursor) qs.set("cursor", cursor);
  if (query) qs.set("q", query);
  const res = await apiFetch(`${query ? "/search" : "/discover"}?${qs.toString()}`);
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as DiscoveryPage;
}

/**
 * Browse (`/discover`, empty query) and search (`/search?q=`) share this one
 * client component (WEB PHASE 10) — same debounced-search-over-cursor-paged-
 * creators experience, just seeded with a different first page. Query changes
 * after the initial render are fetched client-side and mirrored into the URL
 * with `history.replaceState` (not a Next navigation, so no page remount) so
 * the address bar/back-button stay meaningful without a second round trip on
 * every keystroke.
 */
export function DiscoverBrowser({
  initialQuery,
  initialPage,
}: {
  initialQuery: string;
  initialPage: DiscoveryPage;
}) {
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [creators, setCreators] = useState<DiscoveryCreator[]>(initialPage.creators);
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor);
  const [status, setStatus] = useState<"ready" | "loading" | "error">("ready");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const requestId = useRef(0);
  const skipNextFetch = useRef(true);

  useEffect(() => {
    setRecentSearches(loadRecentSearches());
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  useEffect(() => {
    // The first page for `initialQuery` is already server-rendered.
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }

    const id = ++requestId.current;
    setStatus("loading");
    const url = query ? `/search?q=${encodeURIComponent(query)}` : "/discover";
    window.history.replaceState(null, "", url);

    fetchDiscoveryPage(query, null)
      .then((page) => {
        if (id !== requestId.current) return;
        setCreators(page.creators);
        setCursor(page.nextCursor);
        setStatus("ready");
        if (query) setRecentSearches(saveRecentSearch(query));
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setStatus("error");
      });
  }, [query]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await fetchDiscoveryPage(query, cursor);
      setCreators((prev) => [...prev, ...page.creators]);
      setCursor(page.nextCursor);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [query, cursor]);

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search by name, handle, or bio"
          aria-label="Search creators"
          className="pl-9"
        />
      </div>

      {!query && recentSearches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Recent:</span>
          {recentSearches.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setInput(q)}
              className="rounded-full border border-border px-2.5 py-0.5 text-foreground hover:bg-surface-muted"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {status === "loading" && (
        <div className="flex justify-center py-10">
          <Spinner label="Searching" />
        </div>
      )}

      {status === "error" && (
        <EmptyState title="Couldn't load creators" description="Something went wrong loading results. Try again in a moment." />
      )}

      {status === "ready" && creators.length === 0 && (
        <EmptyState
          icon={query ? Search : Compass}
          title={query ? "No creators found" : "No creators yet"}
          description={query ? `Nothing matches "${query}".` : "Check back once creators start publishing."}
        />
      )}

      {status !== "loading" && creators.length > 0 && (
        <InfiniteList hasMore={cursor !== null} isLoading={loadingMore} onLoadMore={loadMore} error={moreError}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creators.map((creator) => (
              <CreatorCard key={creator.did} creator={creator} />
            ))}
          </div>
        </InfiniteList>
      )}
    </div>
  );
}
