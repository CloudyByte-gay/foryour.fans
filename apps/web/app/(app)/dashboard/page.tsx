import type { Metadata } from "next";
import Link from "next/link";
import { Avatar, Button, Card, CardContent } from "@/components/ui";
import { fetchApi } from "@/lib/serverApi";
import { LogoutButton } from "./LogoutButton";
import { WelcomeNudge } from "./WelcomeNudge";

export const metadata: Metadata = { title: "Dashboard" };

interface Me {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface OwnCreator {
  slug: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { welcome?: string };
}) {
  // The (app) layout already guarantees an authenticated session; this fetch
  // is just for the profile fields to show.
  const meResponse = await fetchApi("/me");
  if (!meResponse.ok) {
    throw new Error(`Failed to load /me: ${meResponse.status}`);
  }
  const me = (await meResponse.json()) as Me;

  const creatorResponse = await fetchApi("/creators/me");
  const creator = creatorResponse.ok ? ((await creatorResponse.json()) as OwnCreator) : null;

  return (
    <div className="space-y-6">
      {searchParams.welcome === "1" && <WelcomeNudge isCreator={creator !== null} />}

      <h1 className="font-display text-2xl font-bold tracking-tight">Dashboard</h1>

      <Card>
        <CardContent className="flex items-center gap-4 pt-5">
          <Avatar src={me.avatarUrl} name={me.displayName ?? me.handle} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-medium">{me.displayName ?? me.handle ?? "Your account"}</p>
            <p className="truncate text-sm text-muted">{me.handle ? `@${me.handle}` : me.did}</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        {creator ? (
          <>
            <Button asChild variant="secondary">
              <Link href={`/c/${creator.slug}`}>View your creator page</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/creator/settings">Creator settings</Link>
            </Button>
          </>
        ) : (
          <Button asChild>
            <Link href="/become-a-creator">Become a creator</Link>
          </Button>
        )}
        <LogoutButton />
      </div>
    </div>
  );
}
