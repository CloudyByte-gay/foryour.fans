import Link from "next/link";
import { redirect } from "next/navigation";
import { fetchApi } from "../../lib/serverApi";
import { LogoutButton } from "./LogoutButton";

interface Me {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface OwnCreator {
  slug: string;
}

export default async function DashboardPage() {
  const meResponse = await fetchApi("/me");

  if (meResponse.status === 401) {
    redirect("/login");
  }
  if (!meResponse.ok) {
    throw new Error(`Failed to load /me: ${meResponse.status}`);
  }

  const me = (await meResponse.json()) as Me;

  const creatorResponse = await fetchApi("/creators/me");
  const creator = creatorResponse.ok ? ((await creatorResponse.json()) as OwnCreator) : null;

  return (
    <main>
      <h1>Dashboard</h1>
      {/* Plain <img>: avatar host is arbitrary (any PDS/CDN), not worth Next/Image domain config yet */}
      {me.avatarUrl && <img src={me.avatarUrl} alt="" width={64} height={64} />}
      <p>Handle: {me.handle ?? "(none)"}</p>
      <p>DID: {me.did}</p>
      <p>
        {creator ? (
          <>
            <Link href={`/c/${creator.slug}`}>View your creator page</Link> ·{" "}
            <Link href="/creator/settings">Creator settings</Link>
          </>
        ) : (
          <Link href="/become-a-creator">Become a creator</Link>
        )}
      </p>
      <LogoutButton />
    </main>
  );
}
