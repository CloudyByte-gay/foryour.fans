import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchApi } from "@/lib/serverApi";
import { TierManager } from "./TierManager";

export const metadata: Metadata = { title: "Membership tiers" };

/** Shape of `GET /creators/me/tiers` (apps/api/src/routes/tiers.ts `toOwnTier`). */
export interface OwnTier {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  sortOrder: number;
  isActive: boolean;
  /** WEB PHASE 14 — see PublicTier.containsAdultContent (components/creator/TierCard.tsx). */
  containsAdultContent?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface OwnCreator {
  did: string;
  handle: string | null;
  verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED";
}

export default async function CreatorTiersPage() {
  // `/creators/me` is always the caller's own account — ownership by
  // construction, same as /creator/settings. Not a creator yet → onboarding.
  const [creatorRes, tiersRes] = await Promise.all([
    fetchApi("/creators/me"),
    fetchApi("/creators/me/tiers"),
  ]);

  if (creatorRes.status === 404) {
    redirect("/become-a-creator");
  }
  if (!creatorRes.ok) {
    throw new Error(`Failed to load /creators/me: ${creatorRes.status}`);
  }
  if (!tiersRes.ok) {
    throw new Error(`Failed to load /creators/me/tiers: ${tiersRes.status}`);
  }

  const creator = (await creatorRes.json()) as OwnCreator;
  const tiers = (await tiersRes.json()) as OwnTier[];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Membership tiers</h1>
        <p className="mt-1 text-muted">
          What people can subscribe to on your page. Prices sync to the AT Protocol network as public{" "}
          <code>fans.foryour.tier</code> records.
        </p>
      </div>
      <TierManager
        pageAddress={creator.handle ?? creator.did}
        initialTiers={tiers}
        isVerified={creator.verificationStatus === "VERIFIED"}
      />
    </div>
  );
}
