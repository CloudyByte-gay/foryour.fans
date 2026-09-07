import Link from "next/link";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui";
import type { PayoutAccountStatus } from "@/lib/dashboard";

/**
 * Gates real money figures (MRR, revenue-by-tier, the MRR-over-time chart)
 * behind payout verification, per prompts/web.md WEB PHASE 13: "if payout is
 * not verified, real payout amounts are replaced with a 'complete payout
 * onboarding to see earnings' prompt." Subscriber/engagement numbers are
 * never gated by this — only figures denominated in money.
 */
export function PayoutGate({ status, children }: { status: PayoutAccountStatus | null | undefined; children: React.ReactNode }) {
  if (status === "VERIFIED") {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-muted text-muted">
        <Wallet className="h-5 w-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-display text-base font-semibold">Earnings hidden until payout is verified</p>
        <p className="mx-auto max-w-sm text-sm text-muted">Complete payout onboarding to see earnings.</p>
      </div>
      <Button asChild variant="secondary" size="sm">
        <Link href="/creator/payouts">Complete payout onboarding</Link>
      </Button>
    </div>
  );
}
