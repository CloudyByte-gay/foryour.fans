import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchApi } from "@/lib/serverApi";
import { CreatorSettingsPanel } from "./CreatorSettingsPanel";

export const metadata: Metadata = { title: "Creator settings" };

export interface OwnCreator {
  did: string;
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  website: string | null;
  status: string;
  verificationStatus: string;
  createdAt: string;
  updatedAt: string;
}

export default async function CreatorSettingsPage() {
  // `/creators/me` is always the caller's own account — there is no way to
  // load another creator's edit surface (ownership by construction).
  const res = await fetchApi("/creators/me");
  if (res.status === 404) {
    redirect("/become-a-creator");
  }
  if (!res.ok) {
    throw new Error(`Failed to load /creators/me: ${res.status}`);
  }
  const creator = (await res.json()) as OwnCreator;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Creator settings</h1>
      <CreatorSettingsPanel creator={creator} />
    </div>
  );
}
