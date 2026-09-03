import { formatPrice } from "@/lib/tier";

/**
 * Client-safe discovery types, mirrored from `GET /discover` / `GET /search`
 * (`apps/api/src/routes/discovery.ts`'s `toDiscoveryResult`). The index is
 * DID-keyed and covers any DID on the network publishing `fans.foryour.profile`
 * — not only creators registered here — so `avatarUrl`/`tierCount`/
 * `fromPriceCents` are `null`/`0` for a profile this app has never seen sign
 * in (see that route's doc comment).
 *
 * No `next/headers` / server-only imports here — imported by client
 * components. Server components import the *types* only.
 */
export interface DiscoveryCreator {
  did: string;
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  website: string | null;
  isRegisteredCreator: boolean;
  avatarUrl: string | null;
  tierCount: number;
  fromPriceCents: number | null;
  fromPriceCurrency: string | null;
}

export interface DiscoveryPage {
  creators: DiscoveryCreator[];
  nextCursor: string | null;
}

/** `/c/<handle-or-did>` — the identifier a registered creator's card should link to. */
export function creatorHref(creator: Pick<DiscoveryCreator, "handle" | "did">): string {
  return `/c/${encodeURIComponent(creator.handle ?? creator.did)}`;
}

/** `"From $9.00/mo"`, or `null` when the creator has no priced tiers to show (unregistered, or no active tiers yet). */
export function fromPriceLabel(creator: Pick<DiscoveryCreator, "fromPriceCents" | "fromPriceCurrency">): string | null {
  if (creator.fromPriceCents === null || creator.fromPriceCurrency === null) return null;
  return `From ${formatPrice(creator.fromPriceCents, creator.fromPriceCurrency)}/mo`;
}
