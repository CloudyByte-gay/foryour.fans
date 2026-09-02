"use client";

import { Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

/**
 * Shown once, right after a brand-new user finishes sign-in (`?welcome=1`,
 * set by the auth callback when the account has no creator profile yet).
 * Dismissing it just strips the query param.
 */
export function WelcomeNudge({ isCreator }: { isCreator: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    router.replace(pathname);
  }

  return (
    <div className="relative rounded-lg border border-primary/30 bg-primary/5 p-4 pr-10">
      <div className="flex gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="space-y-2">
          <p className="font-medium">You&rsquo;re signed in with your AT Protocol identity.</p>
          <p className="text-sm text-muted">
            {isCreator
              ? "Your account is all set."
              : "Want to publish and take subscriptions? Set up a creator profile to claim your page and add tiers."}
          </p>
          {!isCreator && (
            <Button asChild size="sm">
              <Link href="/become-a-creator">Set up your profile</Link>
            </Button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
