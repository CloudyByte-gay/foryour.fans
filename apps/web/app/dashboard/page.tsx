import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LogoutButton } from "./LogoutButton";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

interface Me {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  // Server-to-server call, bypassing the public /api proxy — we're already
  // on the server, so we forward the incoming request's cookies directly.
  const response = await fetch(`${API_INTERNAL_URL}/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });

  if (response.status === 401) {
    redirect("/login");
  }
  if (!response.ok) {
    throw new Error(`Failed to load /me: ${response.status}`);
  }

  const me = (await response.json()) as Me;

  return (
    <main>
      <h1>Dashboard</h1>
      {/* Plain <img>: avatar host is arbitrary (any PDS/CDN), not worth Next/Image domain config yet */}
      {me.avatarUrl && <img src={me.avatarUrl} alt="" width={64} height={64} />}
      <p>Handle: {me.handle ?? "(none)"}</p>
      <p>DID: {me.did}</p>
      <LogoutButton />
    </main>
  );
}
