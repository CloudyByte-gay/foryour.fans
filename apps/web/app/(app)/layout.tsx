import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Footer } from "@/components/shell/Footer";
import { Header } from "@/components/shell/Header";
import { getOwnCreator, getSession } from "@/lib/session";

/**
 * Authenticated app shell. Anonymous users are redirected to
 * `/login?next=<path>` (requirement #1 — a chosen behavior, not an accident).
 * The path comes from the `x-pathname` header set in middleware.ts.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (session.status !== "authenticated") {
    const path = (await headers()).get("x-pathname") || "/";
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }

  const creator = await getOwnCreator();

  return (
    <div className="flex min-h-dvh flex-col">
      <Header session={session} creator={creator} />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-4xl px-4 py-8">{children}</div>
      </main>
      <Footer />
    </div>
  );
}
