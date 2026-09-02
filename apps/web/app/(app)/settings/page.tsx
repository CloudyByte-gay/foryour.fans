import type { Metadata } from "next";
import { Suspense } from "react";
import { fetchApi } from "@/lib/serverApi";
import type { SessionUser } from "@/lib/session";
import { SettingsTabs } from "./SettingsTabs";

export const metadata: Metadata = { title: "Settings" };

const TABS = ["account", "appearance", "notifications"] as const;
type Tab = (typeof TABS)[number];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  // The (app) layout guarantees a session; this is just the profile data.
  const res = await fetchApi("/me");
  if (!res.ok) {
    throw new Error(`Failed to load /me: ${res.status}`);
  }
  const me = (await res.json()) as SessionUser;

  const initialTab: Tab = TABS.includes(searchParams.tab as Tab) ? (searchParams.tab as Tab) : "account";

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
      <Suspense fallback={null}>
        <SettingsTabs me={me} initialTab={initialTab} />
      </Suspense>
    </div>
  );
}
