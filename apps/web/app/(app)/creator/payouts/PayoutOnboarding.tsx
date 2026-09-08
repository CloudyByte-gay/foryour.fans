"use client";

import { AlertTriangle, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  toast,
} from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";

export type PayoutAccountStatus = "NOT_STARTED" | "PENDING" | "VERIFIED" | "RESTRICTED";

interface StatusView {
  label: string;
  badge: "neutral" | "warning" | "success" | "danger";
  title: string;
  body: string;
}

const STATUS_VIEW: Record<PayoutAccountStatus, StatusView> = {
  NOT_STARTED: {
    label: "Not started",
    badge: "neutral",
    title: "You haven't started payout onboarding",
    body: "Subscriptions still work without this, but you won't be able to receive earnings until your payout account is set up and verified.",
  },
  PENDING: {
    label: "Pending verification",
    badge: "warning",
    title: "Verification in progress",
    body: "Your payout provider is reviewing your details. You can keep publishing and taking subscriptions in the meantime — earnings figures on your dashboard unlock once you're verified.",
  },
  VERIFIED: {
    label: "Verified",
    badge: "success",
    title: "Your payout account is verified",
    body: "Earnings from your subscriptions will be paid out to this account.",
  },
  RESTRICTED: {
    label: "Needs attention",
    badge: "danger",
    title: "Your payout account is restricted",
    body: "The payout provider couldn't verify your account, or flagged a problem. Restart onboarding to provide what's needed.",
  },
};

export function PayoutOnboarding({ initialStatus }: { initialStatus: PayoutAccountStatus }) {
  const [status, setStatus] = useState<PayoutAccountStatus>(initialStatus);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/creators/me/payout-account/status");
      if (res.ok) {
        setStatus(((await res.json()) as { status: PayoutAccountStatus }).status);
      } else if (res.status === 404) {
        setStatus("NOT_STARTED");
      }
    } catch {
      // leave the last known status in place
    }
  }, []);

  // There's no payout webhook — the status endpoint re-checks with the
  // provider on every call, so re-poll whenever the tab regains focus (e.g.
  // coming back from the provider's onboarding page).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = () => void refreshStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshStatus]);

  async function startOnboarding() {
    setBusy(true);
    try {
      const res = await apiFetch("/creators/me/payout-account", {
        method: "POST",
        headers: { ...csrfHeaders() },
      });
      if (!res.ok) {
        toast({
          title: "Couldn't start payout onboarding",
          description: "Please try again in a moment.",
          variant: "error",
        });
        return;
      }
      const body = (await res.json()) as { status: PayoutAccountStatus; onboardingUrl?: string | null };
      if (body.onboardingUrl) {
        window.location.assign(body.onboardingUrl);
        return; // navigating away
      }
      setStatus(body.status);
    } finally {
      setBusy(false);
    }
  }

  const view = STATUS_VIEW[status];
  const canStart = status === "NOT_STARTED" || status === "RESTRICTED";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{view.title}</CardTitle>
            <Badge variant={view.badge}>{view.label}</Badge>
          </div>
          <CardDescription>{view.body}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "VERIFIED" && (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              No further action needed.
            </p>
          )}

          {status === "PENDING" && (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm text-muted">
                <Clock className="h-4 w-4" aria-hidden />
                We&rsquo;ll update this automatically when the provider finishes.
              </p>
              <Button variant="secondary" size="sm" onClick={() => void refreshStatus()}>
                Refresh status
              </Button>
            </div>
          )}

          {canStart && (
            <div className="space-y-4">
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <span>
                    <strong className="font-semibold">Age &amp; identity check.</strong> Receiving
                    payouts requires you to be 18+. This fake onboarding flow doesn&rsquo;t check
                    creator identity verification yet — a real payout processor will require it once
                    one is connected. You can complete{" "}
                    <Link href="/creator/verification" className="text-primary hover:underline">
                      identity verification
                    </Link>{" "}
                    now if you plan to mark any tiers or posts as adult content, which does require it.
                  </span>
                </p>
              </div>

              <label htmlFor="age-confirmed" className="flex items-start gap-3">
                <Checkbox
                  id="age-confirmed"
                  checked={ageConfirmed}
                  onCheckedChange={(c) => setAgeConfirmed(c === true)}
                />
                <span className="text-sm">
                  I confirm I am at least 18 years old and will complete identity verification when
                  it&rsquo;s required.
                </span>
              </label>

              <Button onClick={startOnboarding} loading={busy} disabled={!ageConfirmed}>
                <ExternalLink className="h-4 w-4" aria-hidden />
                {status === "RESTRICTED" ? "Restart payout onboarding" : "Start payout onboarding"}
              </Button>
              <p className="text-xs text-muted">
                This opens your payout provider&rsquo;s secure onboarding page in this window.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted">
        Real payout amounts show on your{" "}
        <span className="font-medium text-foreground">creator dashboard</span> once your account is
        verified.
      </p>
    </div>
  );
}
