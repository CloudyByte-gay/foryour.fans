"use client";

import { CheckCircle2, Clock, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import {
  listOwnSubscriptions,
  takeSubscribeReturn,
  type ListedSubscription,
  type SubscribeReturnContext,
} from "@/lib/subscriptions";

type Phase = "checking" | "active" | "pending" | "problem" | "error";

const MAX_POLLS = 6;
const POLL_INTERVAL_MS = 1500;

export function ReconcilingFallback() {
  return (
    <div className="flex flex-col items-center gap-3 text-center" role="status">
      <Spinner className="h-6 w-6 text-primary" />
      <p className="text-sm text-muted">Checking your subscription…</p>
    </div>
  );
}

export function SubscribeReturn() {
  // sessionStorage is read once, synchronously, so a re-render doesn't lose it.
  const [context] = useState<SubscribeReturnContext | null>(() =>
    typeof window === "undefined" ? null : takeSubscribeReturn(),
  );
  const [phase, setPhase] = useState<Phase>("checking");
  const polls = useRef(0);

  const creatorHref = context ? `/c/${context.address}` : "/discover";
  const creatorName = context?.creatorName ?? "the creator";

  const check = useCallback(async (): Promise<void> => {
    setPhase("checking");
    let subs: ListedSubscription[];
    try {
      subs = await listOwnSubscriptions();
    } catch {
      setPhase("error");
      return;
    }

    const match = context?.subscriptionId
      ? subs.find((s) => s.id === context.subscriptionId)
      : subs[0];

    if (!match) {
      // The row should exist immediately after subscribe; a couple of misses
      // is tolerable, then treat it as a problem.
      if (polls.current < MAX_POLLS) {
        polls.current += 1;
        window.setTimeout(() => void check(), POLL_INTERVAL_MS);
        return;
      }
      setPhase("problem");
      return;
    }

    if (match.status === "ACTIVE") {
      setPhase("active");
      return;
    }
    if (match.status === "PENDING") {
      if (polls.current < MAX_POLLS) {
        polls.current += 1;
        window.setTimeout(() => void check(), POLL_INTERVAL_MS);
        return;
      }
      setPhase("pending");
      return;
    }
    // PAST_DUE / CANCELED / EXPIRED
    setPhase("problem");
  }, [context]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void check();
  }, [check]);

  function retryPolling() {
    polls.current = 0;
    void check();
  }

  if (phase === "checking") {
    return <ReconcilingFallback />;
  }

  if (phase === "active") {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden />
        <h1 className="font-display text-xl font-semibold">You&rsquo;re subscribed</h1>
        <p className="text-sm text-muted">
          Your subscription to {creatorName} is active. Their subscriber content is unlocked.
        </p>
        <div className="flex justify-center gap-3">
          <Button asChild>
            <Link href={creatorHref}>Go to {creatorName}</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/subscriptions">My subscriptions</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "pending") {
    return (
      <div className="space-y-4 text-center">
        <Clock className="mx-auto h-10 w-10 text-warning" aria-hidden />
        <h1 className="font-display text-xl font-semibold">Payment is still processing</h1>
        <p className="text-sm text-muted">
          We haven&rsquo;t had confirmation from the payment provider yet. This can take a moment —
          your access turns on automatically once it clears.
        </p>
        <div className="flex justify-center gap-3">
          <Button onClick={retryPolling}>Check again</Button>
          <Button asChild variant="ghost">
            <Link href="/subscriptions">My subscriptions</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="space-y-4 text-center">
        <XCircle className="mx-auto h-10 w-10 text-danger" aria-hidden />
        <h1 className="font-display text-xl font-semibold">Couldn&rsquo;t check your subscription</h1>
        <p className="text-sm text-muted">Something went wrong reaching the server.</p>
        <div className="flex justify-center gap-3">
          <Button onClick={retryPolling}>Try again</Button>
          <Button asChild variant="ghost">
            <Link href="/subscriptions">My subscriptions</Link>
          </Button>
        </div>
      </div>
    );
  }

  // problem
  return (
    <div className="space-y-4 text-center">
      <XCircle className="mx-auto h-10 w-10 text-danger" aria-hidden />
      <h1 className="font-display text-xl font-semibold">Your subscription didn&rsquo;t go through</h1>
      <p className="text-sm text-muted">
        The payment wasn&rsquo;t completed, or it was declined. You haven&rsquo;t been charged. You
        can try again from {creatorName}&rsquo;s page.
      </p>
      <div className="flex justify-center gap-3">
        <Button asChild>
          <Link href={creatorHref}>Back to {creatorName}</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/subscriptions">My subscriptions</Link>
        </Button>
      </div>
    </div>
  );
}
