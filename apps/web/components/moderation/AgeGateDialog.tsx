"use client";

import { ShieldCheck } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui";
import { confirmAge } from "@/lib/ageVerification";

/**
 * Age-verification gate (WEB PHASE 14) — see lib/ageVerification.ts's doc
 * comment for why this stays a client-side self-attestation placeholder
 * rather than a backend-tracked status: `full.md`'s Phase 14 only elevates
 * CREATOR identity verification to a real field/workflow, not subscriber
 * age verification.
 *
 * Callers check `hasConfirmedAge()` before an adult-gated action (viewing
 * adult media, subscribing to an adult tier) and open this dialog instead
 * when it's `false`; `onConfirmed` runs the original action after recording
 * the attestation.
 */
export function AgeGateDialog({
  open,
  onOpenChange,
  onConfirmed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
            Confirm your age
          </DialogTitle>
          <DialogDescription>
            This content is marked as containing adult material. You must be at least 18 years old
            (or the age of majority where you live, if higher) to continue.
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted">
          This is a self-attestation, not identity verification — foryour.fans does not collect or
          check any identity document from you for this.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Go back
          </Button>
          <Button
            onClick={() => {
              confirmAge();
              onOpenChange(false);
              onConfirmed();
            }}
          >
            I&rsquo;m 18 or older
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
