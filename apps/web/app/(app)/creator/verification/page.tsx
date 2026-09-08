import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchApi } from "@/lib/serverApi";
import type { VerificationStatus } from "@/lib/verification";
import { VerificationStatusCard } from "./VerificationStatusCard";

export const metadata: Metadata = { title: "Identity verification" };

export default async function CreatorVerificationPage() {
  // `/creators/me` is always the caller's own account — ownership by
  // construction, same as /creator/settings, /creator/tiers, /creator/payouts.
  const res = await fetchApi("/creators/me");
  if (res.status === 404) {
    redirect("/become-a-creator");
  }
  if (!res.ok) {
    throw new Error(`Failed to load /creators/me: ${res.status}`);
  }
  const creator = (await res.json()) as { verificationStatus: VerificationStatus };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Identity verification</h1>
        <p className="mt-1 text-muted">
          Required before marking a tier or post as containing adult content, per foryour.fans&rsquo;
          trust and safety policy.
        </p>
      </div>
      <VerificationStatusCard initialStatus={creator.verificationStatus} />
    </div>
  );
}
