import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchApi } from "@/lib/serverApi";
import { getSession } from "@/lib/session";
import { OnboardingWizard } from "./OnboardingWizard";

export const metadata: Metadata = { title: "Become a creator" };

interface OwnCreator {
  handle: string | null;
  did: string;
}

export default async function BecomeACreatorPage() {
  // The (app) layout guarantees an authenticated session. Already a creator?
  // Send them to their page.
  const [res, session] = await Promise.all([fetchApi("/creators/me"), getSession()]);
  if (res.ok) {
    const creator = (await res.json()) as OwnCreator;
    redirect(`/c/${creator.handle ?? creator.did}`);
  }

  const handle = session.user?.handle ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Become a creator</h1>
        <p className="mt-1 text-muted">
          Publish a public profile to Bluesky's open network (AT Protocol). Your page lives at
          your Bluesky handle — there&rsquo;s nothing to claim. You can add subscription tiers and
          posts afterward.
        </p>
      </div>
      <OnboardingWizard handle={handle} did={session.user?.did ?? null} />
    </div>
  );
}
