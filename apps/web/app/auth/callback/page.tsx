import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCallback, FinishingSignIn } from "./AuthCallback";

export const metadata: Metadata = {
  title: "Finishing sign-in",
  robots: { index: false, follow: false },
};

// The API redirects here after the OAuth exchange; nothing to prerender.
export const dynamic = "force-dynamic";

export default function AuthCallbackPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-4">
      <Suspense fallback={<FinishingSignIn />}>
        <AuthCallback />
      </Suspense>
    </main>
  );
}
