"use client";

import { AlertTriangle, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, toast } from "@/components/ui";
import { submitVerification, type VerificationStatus } from "@/lib/verification";

interface StatusView {
  label: string;
  badge: "neutral" | "warning" | "success";
  title: string;
  body: string;
}

/**
 * `UNVERIFIED` / `PENDING` / `VERIFIED` only — the backend has no separate
 * `REJECTED` status; an admin rejection resets a creator straight back to
 * `UNVERIFIED` (see lib/verification.ts's doc comment for why this differs
 * from `prompts/web.md`'s WEB PHASE 14 text).
 */
const STATUS_VIEW: Record<VerificationStatus, StatusView> = {
  UNVERIFIED: {
    label: "Not verified",
    badge: "neutral",
    title: "You haven't submitted for verification",
    body: "Submit to unlock marking tiers/posts as adult content. This is a placeholder submission — no documents are collected yet; a moderator reviews and approves or rejects it.",
  },
  PENDING: {
    label: "Pending review",
    badge: "warning",
    title: "Your submission is under review",
    body: "A moderator will review this. If it's rejected, you'll come back to \"Not verified\" and can resubmit.",
  },
  VERIFIED: {
    label: "Verified",
    badge: "success",
    title: "You're a verified creator",
    body: "You can mark tiers and posts as containing adult content.",
  },
};

export function VerificationStatusCard({ initialStatus }: { initialStatus: VerificationStatus }) {
  const [status, setStatus] = useState<VerificationStatus>(initialStatus);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    const outcome = await submitVerification();
    setSubmitting(false);
    if (!outcome.ok) {
      toast({ title: "Couldn't submit", description: outcome.message, variant: "error" });
      return;
    }
    setStatus(outcome.verificationStatus);
    toast({ title: "Submitted for verification" });
  }

  const view = STATUS_VIEW[status];

  return (
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
          <p className="flex items-center gap-2 text-sm text-muted">
            <Clock className="h-4 w-4" aria-hidden />
            We&rsquo;ll update this automatically once it&rsquo;s reviewed.
          </p>
        )}

        {status === "UNVERIFIED" && (
          <div className="space-y-4">
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <span>
                  This does not collect any identity document — it&rsquo;s a placeholder for a real
                  KYC integration. What&rsquo;s real: a moderator does review and approve/reject
                  every submission, and the gate itself (adult-content posting/tiers stay blocked
                  until VERIFIED) is fully enforced.
                </span>
              </p>
            </div>
            <Button onClick={submit} loading={submitting}>
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Submit for verification
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
