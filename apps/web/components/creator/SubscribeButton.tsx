"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@/components/ui";
import type { PublicTier } from "@/components/creator/TierCard";
import { stashSubscribeReturn, subscribeToTier } from "@/lib/subscriptions";
import { formatPrice } from "@/lib/tier";

/**
 * The per-tier subscribe control on `/c/:handle`. WEB PHASE 6.
 *
 * - Anonymous visitors get a link to `/login?next=` back to the creator page.
 * - Signed-in visitors get a review dialog (the exact price being locked in +
 *   the grandfathering note), then `POST /creators/:identifier/subscribe`.
 *   The fake `PaymentProvider` is a hosted-checkout model, so the response is
 *   always a PENDING subscription plus a `redirectUrl` — we navigate there and
 *   let `/subscribe/return` reconcile the outcome.
 */
export function SubscribeButton({
  creatorAddress,
  creatorName,
  tier,
  isAuthed,
  className,
}: {
  creatorAddress: string;
  creatorName: string;
  tier: PublicTier;
  isAuthed: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const price = formatPrice(tier.priceCents, tier.currency);

  if (!isAuthed) {
    const next = `/c/${creatorAddress}`;
    return (
      <Button asChild size="sm" className={className}>
        <Link href={`/login?next=${encodeURIComponent(next)}`}>Subscribe</Link>
      </Button>
    );
  }

  async function confirm() {
    setSubmitting(true);
    const outcome = await subscribeToTier(creatorAddress, tier.id);
    if (outcome.ok) {
      stashSubscribeReturn({
        address: creatorAddress,
        creatorName,
        subscriptionId: outcome.result.id,
      });
      if (outcome.result.redirectUrl) {
        window.location.assign(outcome.result.redirectUrl);
        return; // navigating away — keep the spinner up
      }
      router.push("/subscribe/return");
      return;
    }

    setSubmitting(false);
    if (outcome.code === "already_subscribed") {
      setOpen(false);
      toast({
        title: "Already subscribed",
        description: "Manage it from your Subscriptions page.",
      });
      router.push("/subscriptions");
      return;
    }
    toast({ title: "Couldn't subscribe", description: outcome.message, variant: "error" });
  }

  return (
    <>
      <Button size="sm" className={className} onClick={() => setOpen(true)}>
        Subscribe
      </Button>
      <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Subscribe to {creatorName}</DialogTitle>
            <DialogDescription>
              You&rsquo;re subscribing to <strong className="text-foreground">{tier.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border bg-surface-muted p-4">
            <p className="text-sm text-muted">Price locked in now</p>
            <p className="font-display text-2xl font-bold">
              {price} <span className="text-base font-medium text-muted">/ month</span>
            </p>
          </div>

          <p className="text-sm text-muted">
            This is the price you keep for as long as the subscription stays active. If {creatorName}{" "}
            changes this tier&rsquo;s price later, it won&rsquo;t change what you pay. Billing renews
            monthly until you cancel.
          </p>
          <p className="flex items-start gap-2 text-sm text-muted">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Payment is handled on a secure checkout page. You&rsquo;ll come back here when
              it&rsquo;s done.
            </span>
          </p>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Not now
            </Button>
            <Button onClick={confirm} loading={submitting}>
              Continue to checkout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
