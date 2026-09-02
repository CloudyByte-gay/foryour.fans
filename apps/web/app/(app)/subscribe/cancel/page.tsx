import type { Metadata } from "next";
import { XCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";

export const metadata: Metadata = {
  title: "Checkout cancelled",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The hosted checkout redirects here when the visitor backs out. Nothing was
 * charged and no subscription was created (the row stays PENDING until a
 * webhook confirms it — see packages/subscriptions).
 */
export default function SubscribeCancelPage() {
  return (
    <div className="mx-auto max-w-md space-y-4 py-10 text-center">
      <XCircle className="mx-auto h-10 w-10 text-muted" aria-hidden />
      <h1 className="font-display text-xl font-semibold">Checkout cancelled</h1>
      <p className="text-sm text-muted">
        You closed the payment page before finishing, so nothing was charged and no subscription was
        started. You can pick up where you left off from the creator&rsquo;s page.
      </p>
      <div className="flex justify-center gap-3">
        <Button asChild>
          <Link href="/discover">Browse creators</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/subscriptions">My subscriptions</Link>
        </Button>
      </div>
    </div>
  );
}
