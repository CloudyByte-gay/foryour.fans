import type { Metadata } from "next";
import { Compass } from "lucide-react";
import Link from "next/link";
import { Button, EmptyState } from "@/components/ui";

export const metadata: Metadata = {
  title: "Discover creators",
  description: "Browse creators on foryour.fans.",
  alternates: { canonical: "/discover" },
};

/**
 * Teaser shell only. The real browse experience (sections, creator cards,
 * NSFW gating, search) is WEB PHASE 10.
 */
export default function DiscoverPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight">Discover creators</h1>
      <p className="mt-2 text-muted">
        Browse and search creators across the network. This is where discovery will live.
      </p>

      <div className="mt-8">
        <EmptyState
          icon={Compass}
          title="Discovery isn't live yet"
          description="Creator browsing and search are coming in a later release. For now, head to a creator's page directly if you have their link."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/">Back to home</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
