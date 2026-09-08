import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui";

/**
 * WEB PHASE 15 — wraps every route-level skeleton in an accessible
 * "busy" announcement. `aria-busy` alone (the pre-existing convention on
 * the three loading.tsx files this phase found) tells assistive tech a
 * region is updating but announces nothing on its own; `role="status"`
 * (implicit `aria-live="polite"`) plus an `sr-only` label is what actually
 * tells a screen-reader user a page finished loading rather than sitting in
 * silence until content appears.
 */
function LoadingRegion({ children }: { children: ReactNode }) {
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

/** A heading + description + single content card — settings-shaped pages. */
export function FormRouteLoading() {
  return (
    <LoadingRegion>
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </LoadingRegion>
  );
}

/** A heading + action button + a handful of list rows — post/tier list pages. */
export function ListRouteLoading() {
  return (
    <LoadingRegion>
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-9 w-28 shrink-0" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    </LoadingRegion>
  );
}

/** A creator-profile-shaped skeleton — banner, avatar, tier grid. */
export function ProfileRouteLoading() {
  return (
    <LoadingRegion>
      <div className="mx-auto max-w-3xl space-y-6">
        <Skeleton className="h-40 w-full rounded-xl" />
        <div className="flex items-center gap-4 px-4">
          <Skeleton className="h-20 w-20 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="space-y-2 px-4">
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="h-4 w-2/3 max-w-sm" />
        </div>
        <div className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </LoadingRegion>
  );
}

/** A single post/article-shaped skeleton. */
export function ArticleRouteLoading() {
  return (
    <LoadingRegion>
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-64 w-full" />
      </div>
    </LoadingRegion>
  );
}

/** A discovery/feed grid — /discover, /search, /feed. */
export function GridRouteLoading() {
  return (
    <LoadingRegion>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-16">
        <div className="space-y-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </LoadingRegion>
  );
}

/** A short auth-adjacent form — /login. */
export function AuthRouteLoading() {
  return (
    <LoadingRegion>
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16 sm:py-24">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </LoadingRegion>
  );
}
