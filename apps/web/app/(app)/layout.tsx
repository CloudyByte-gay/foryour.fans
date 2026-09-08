import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AccountStatusBanner } from "@/components/shell/AccountStatusBanner";
import { Footer } from "@/components/shell/Footer";
import { Header } from "@/components/shell/Header";
import { ModerationNoticesBanner } from "@/components/shell/ModerationNoticesBanner";
import { getModerationNotices } from "@/lib/moderationNotices";
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

  const [creator, moderationNotices] = await Promise.all([getOwnCreator(), getModerationNotices()]);

  return (
    <div className="flex min-h-dvh flex-col">
      <Header session={session} creator={creator} />
      {session.user && <AccountStatusBanner user={session.user} creator={creator} />}
      <ModerationNoticesBanner notices={moderationNotices} />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <div className="mx-auto w-full max-w-4xl px-4 py-8">{children}</div>
      </main>
      <Footer />
    </div>
  );
}
