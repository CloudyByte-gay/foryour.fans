import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchApi } from "@/lib/serverApi";
import { OnboardingWizard } from "./OnboardingWizard";

export const metadata: Metadata = { title: "Become a creator" };

interface OwnCreator {
  slug: string;
}

export default async function BecomeACreatorPage() {
  // The (app) layout guarantees an authenticated session. Already a creator?
  // Send them to their page.
  const res = await fetchApi("/creators/me");
  if (res.ok) {
    const creator = (await res.json()) as OwnCreator;
    redirect(`/c/${creator.slug}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Become a creator</h1>
        <p className="mt-1 text-muted">
          Claim your page and publish a public profile to the AT Protocol network. You can add
          subscription tiers and posts afterward.
        </p>
      </div>
      <OnboardingWizard />
    </div>
  );
}
