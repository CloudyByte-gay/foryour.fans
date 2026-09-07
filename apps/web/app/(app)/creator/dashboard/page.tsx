import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchApi } from "@/lib/serverApi";
import { presetRange, DEFAULT_DASHBOARD_PRESET, type CreatorDashboard } from "@/lib/dashboard";
import { DashboardClient } from "./DashboardClient";

export const metadata: Metadata = { title: "Dashboard" };

interface OwnCreator {
  did: string;
  handle: string | null;
}

export default async function CreatorDashboardPage() {
  // `/creators/me` is always the caller's own account — ownership by
  // construction, same as /creator/settings, /creator/tiers, /creator/payouts.
  // Not a creator yet → onboarding, matching every other /creator/* page.
  const creatorRes = await fetchApi("/creators/me");
  if (creatorRes.status === 404) {
    redirect("/become-a-creator");
  }
  if (!creatorRes.ok) {
    throw new Error(`Failed to load /creators/me: ${creatorRes.status}`);
  }
  const creator = (await creatorRes.json()) as OwnCreator;

  const range = presetRange(DEFAULT_DASHBOARD_PRESET);
  const [dashboardRes, tiersRes] = await Promise.all([
    fetchApi(`/creators/me/dashboard?from=${range.from}&to=${range.to}`),
    fetchApi("/creators/me/tiers"),
  ]);
  if (!dashboardRes.ok) {
    throw new Error(`Failed to load /creators/me/dashboard: ${dashboardRes.status}`);
  }
  if (!tiersRes.ok) {
    throw new Error(`Failed to load /creators/me/tiers: ${tiersRes.status}`);
  }

  const dashboard = (await dashboardRes.json()) as CreatorDashboard;
  const tiers = (await tiersRes.json()) as unknown[];

  return (
    <div className="mx-auto max-w-4xl">
      <DashboardClient
        pageAddress={creator.handle ?? creator.did}
        initialRange={range}
        initialDashboard={dashboard}
        tiersCount={tiers.length}
      />
    </div>
  );
}
