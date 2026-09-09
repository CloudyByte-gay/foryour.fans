import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSafeInternalPath, safeNextOr } from "@/lib/nav";
import { getSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to foryour.fans with your AT Protocol identity.",
  robots: { index: false },
};

export default async function LoginPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const searchParams = await searchParamsPromise;
  const nextParam = Array.isArray(searchParams.next) ? searchParams.next[0] : searchParams.next;

  // Already signed in — go where they were headed, or the dashboard.
  const session = await getSession();
  if (session.status === "authenticated") {
    redirect(safeNextOr(nextParam));
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:py-24">
      <h1 className="font-display text-3xl font-bold tracking-tight">Log in</h1>
      <p className="mt-2 text-muted">
        foryour.fans uses your AT Protocol identity — there&rsquo;s no separate password to create.
      </p>
      <LoginForm next={isSafeInternalPath(nextParam) ? nextParam : undefined} />
    </div>
  );
}
