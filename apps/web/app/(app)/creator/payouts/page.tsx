import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchApi } from "@/lib/serverApi";
import { PayoutOnboarding, type PayoutAccountStatus } from "./PayoutOnboarding";

export const metadata: Metadata = { title: "Payouts" };

interface OwnCreator {
  verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED";
}

export default async function CreatorPayoutsPage() {
  // `/creators/me` is always the caller's own account — ownership by
  // construction, same as /creator/settings and /creator/tiers.
  const [creatorRes, statusRes] = await Promise.all([
    fetchApi("/creators/me"),
    fetchApi("/creators/me/payout-account/status"),
  ]);

  if (creatorRes.status === 404) {
    redirect("/become-a-creator");
  }
  if (!creatorRes.ok) {
    throw new Error(`Failed to load /creators/me: ${creatorRes.status}`);
  }

  const creator = (await creatorRes.json()) as OwnCreator;

  // 404 here means "onboarding not started" — a normal state, not an error.
  let initialStatus: PayoutAccountStatus = "NOT_STARTED";
  if (statusRes.ok) {
    initialStatus = ((await statusRes.json()) as { status: PayoutAccountStatus }).status;
  } else if (statusRes.status !== 404) {
    throw new Error(`Failed to load payout status: ${statusRes.status}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Payouts</h1>
        <p className="mt-1 text-muted">
          Set up where your subscription earnings are paid out. You can publish and take
          subscriptions before this is finished.
        </p>
      </div>
      <PayoutOnboarding
        initialStatus={initialStatus}
        isVerified={creator.verificationStatus === "VERIFIED"}
      />
    </div>
  );
}
