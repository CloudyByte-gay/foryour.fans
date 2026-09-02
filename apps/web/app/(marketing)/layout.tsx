import type { ReactNode } from "react";
import { Footer } from "@/components/shell/Footer";
import { Header } from "@/components/shell/Header";
import { getOwnCreator, getSession } from "@/lib/session";

/**
 * Public marketing shell. Renders fully for anonymous visitors; the Header
 * falls back to its logged-out variant when `/me` is unauthenticated or the
 * API is unreachable (see lib/session.ts).
 */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const creator = session.status === "authenticated" ? await getOwnCreator() : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <Header session={session} creator={creator} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
