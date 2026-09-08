"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormControl,
  FormField,
  FormLabel,
  Select,
  Textarea,
  toast,
} from "@/components/ui";
import { fileReport, REPORT_REASON_MAX, REPORT_REASON_OPTIONS, type ReportReason, type ReportSubjectType } from "@/lib/reports";

/**
 * The report dialog for creator/post/comment (WEB PHASE 14) — one shared
 * component parameterized by subject, since the flow (reason picker + free
 * text + confirmation) is identical for all three per `prompts/web.md`.
 * Never surfaces case internals: on success the dialog just confirms the
 * report was filed, matching `POST /reports`' own "no exposure of case
 * internals" (see lib/reports.ts).
 */
export function ReportDialog({
  open,
  onOpenChange,
  subjectType,
  subjectId,
  subjectLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectType: ReportSubjectType;
  subjectId: string;
  /** e.g. "this post", "@alice", "this comment" — used in the dialog copy. */
  subjectLabel: string;
}) {
  const [reasonType, setReasonType] = useState<ReportReason>("SPAM");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const outcome = await fileReport({
      subjectType,
      subjectId,
      reasonType,
      reason: reason.trim() || undefined,
    });
    setSubmitting(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    onOpenChange(false);
    setReason("");
    setReasonType("SPAM");
    toast({ title: "Report filed", description: "Thanks — a moderator will review it." });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report {subjectLabel}</DialogTitle>
          <DialogDescription>
            Reports are reviewed by moderators. We won&rsquo;t tell the reported account who filed
            this.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormField>
            <FormLabel>Reason</FormLabel>
            <FormControl>
              <Select value={reasonType} onChange={(e) => setReasonType(e.target.value as ReportReason)}>
                {REPORT_REASON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </FormControl>
          </FormField>

          <FormField>
            <FormLabel optional>Additional details</FormLabel>
            <FormControl>
              <Textarea
                value={reason}
                rows={4}
                maxLength={REPORT_REASON_MAX}
                placeholder="Anything that helps a moderator understand the issue."
                onChange={(e) => setReason(e.target.value)}
              />
            </FormControl>
          </FormField>

          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} loading={submitting}>
            Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
