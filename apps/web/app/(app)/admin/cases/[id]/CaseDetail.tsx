"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Badge,
  type BadgeProps,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  Skeleton,
  Textarea,
  toast,
} from "@/components/ui";
import {
  applyCaseLabel,
  dismissCase,
  getCase,
  reinstateCreator,
  reinstateUser,
  removeCaseLabel,
  removeComment,
  removePost,
  restrictUser,
  suspendCreator,
  type AdminActionOutcome,
  type ModerationCaseDetail,
  type ModerationCaseStatus,
} from "@/lib/admin";
import { relativeTime } from "@/lib/format";

const STATUS_BADGE: Record<ModerationCaseStatus, NonNullable<BadgeProps["variant"]>> = {
  OPEN: "warning",
  ACTION_TAKEN: "success",
  DISMISSED: "neutral",
};

/**
 * `/admin/cases/:id` — one case's reports, labels, classifier signal, and
 * audit history, plus the moderation actions `full.md`'s Phase 14 gives an
 * admin (dismiss, remove content, restrict/suspend, apply/remove a label).
 * Which action buttons show depends on `subjectType` — a CREATOR case never
 * offers "remove post", etc. Actions are disabled once the case leaves OPEN
 * (the API itself 409s — `ModerationCaseAlreadyResolvedError` — this just
 * avoids the round trip).
 *
 * Deliberately does not surface creator-verification approve/reject here:
 * that action exists on the API (`POST /admin/creators/:id/verification/
 * approve|reject`) but there is no `GET` endpoint listing creators pending
 * verification, so there is nothing to build a queue from without inventing
 * API surface (`full.md`'s "never build ahead of the API"). Documented as a
 * known gap in docs/ux.md.
 */
export function CaseDetail({ caseId }: { caseId: string }) {
  const [state, setState] = useState<"loading" | "error" | "notfound" | "ready">("loading");
  const [detail, setDetail] = useState<ModerationCaseDetail | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setState("loading");
    try {
      const result = await getCase(caseId);
      if (!result) {
        setState("notfound");
        return;
      }
      setDetail(result);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, [caseId]);

  async function runAction(key: string, run: () => Promise<AdminActionOutcome>, successMessage: string) {
    setBusy(key);
    const outcome = await run();
    setBusy(null);
    if (!outcome.ok) {
      toast({ title: "Action failed", description: outcome.message, variant: "error" });
      return;
    }
    toast({ title: successMessage });
    await load();
  }

  if (state === "loading") {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (state === "notfound") {
    return <ErrorState title="Case not found" message="It may have been deleted." />;
  }

  if (state === "error" || !detail) {
    return <ErrorState message="Couldn't load this case." onRetry={() => void load()} />;
  }

  const isOpen = detail.status === "OPEN";
  const reasonRequired = reason.trim().length === 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/cases" className="text-sm text-muted hover:text-foreground">
          ← Case queue
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="neutral">{detail.subjectType}</Badge>
        <span className="font-mono text-sm text-muted">{detail.subjectId}</span>
        <Badge variant={STATUS_BADGE[detail.status]}>{detail.status.replace("_", " ")}</Badge>
        {detail.requiresLegalReview && <Badge variant="danger">Requires legal review</Badge>}
        <span className="text-sm text-muted">Opened {relativeTime(detail.openedAt)}</span>
      </div>

      {detail.classifierSuggestion && (
        <Card>
          <CardHeader>
            <CardTitle>Classifier signal</CardTitle>
            <CardDescription>Advisory only — an admin decides, this never auto-acts.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-surface-muted p-3 text-xs">
              {JSON.stringify(detail.classifierSuggestion, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Reports ({detail.reports.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.reports.length === 0 ? (
            <p className="text-sm text-muted">No reports are linked to this case.</p>
          ) : (
            <ul className="space-y-3">
              {detail.reports.map((r) => (
                <li key={r.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="neutral">{r.reasonType.replace(/_/g, " ")}</Badge>
                    <span className="text-xs text-muted">{relativeTime(r.createdAt)}</span>
                  </div>
                  {r.reason && <p className="mt-2 whitespace-pre-wrap text-foreground">{r.reason}</p>}
                  <p className="mt-2 text-xs text-muted">
                    Reported by @{r.reporter.handle ?? r.reporter.did}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Labels ({detail.labels.length})</CardTitle>
          <CardDescription>Applied `ContentLabel` records, net of any retraction.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {detail.labels.length === 0 ? (
            <p className="text-sm text-muted">No labels applied.</p>
          ) : (
            <ul className="space-y-2">
              {detail.labels.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                  <span className="font-mono">{l.val}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === `label-remove-${l.val}`}
                    onClick={() =>
                      runAction(
                        `label-remove-${l.val}`,
                        () => removeCaseLabel(caseId, l.val),
                        "Label removed",
                      )
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Label value, e.g. porn"
              className="h-9 flex-1 rounded-md border border-border bg-surface px-3 text-sm"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={labelInput.trim().length === 0}
              loading={busy === "label-apply"}
              onClick={() =>
                runAction(
                  "label-apply",
                  () => applyCaseLabel(caseId, labelInput.trim()),
                  "Label applied",
                ).then(() => setLabelInput(""))
              }
            >
              Apply label
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
          <CardDescription>
            {isOpen ? "Every action here is written to the audit log." : "This case is resolved — no further actions."}
          </CardDescription>
        </CardHeader>
        {isOpen && (
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="case-reason" className="text-sm font-medium">
                Reason (required for content/account actions)
              </label>
              <Textarea
                id="case-reason"
                value={reason}
                rows={2}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this action being taken?"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {detail.subjectType === "POST" && (
                <Button
                  variant="secondary"
                  disabled={reasonRequired}
                  loading={busy === "remove-post"}
                  onClick={() =>
                    runAction(
                      "remove-post",
                      () => removePost(detail.subjectId, reason.trim(), caseId),
                      "Post removed",
                    )
                  }
                >
                  Remove post
                </Button>
              )}
              {detail.subjectType === "COMMENT" && (
                <Button
                  variant="secondary"
                  disabled={reasonRequired}
                  loading={busy === "remove-comment"}
                  onClick={() =>
                    runAction(
                      "remove-comment",
                      () => removeComment(detail.subjectId, reason.trim(), caseId),
                      "Comment removed",
                    )
                  }
                >
                  Remove comment
                </Button>
              )}
              {detail.subjectType === "USER" && (
                <>
                  <Button
                    variant="secondary"
                    disabled={reasonRequired}
                    loading={busy === "restrict-user"}
                    onClick={() =>
                      runAction(
                        "restrict-user",
                        () => restrictUser(detail.subjectId, reason.trim(), caseId),
                        "Account restricted",
                      )
                    }
                  >
                    Restrict account
                  </Button>
                  <Button
                    variant="ghost"
                    loading={busy === "reinstate-user"}
                    onClick={() => runAction("reinstate-user", () => reinstateUser(detail.subjectId), "Account reinstated")}
                  >
                    Reinstate account
                  </Button>
                </>
              )}
              {detail.subjectType === "CREATOR" && (
                <>
                  <Button
                    variant="secondary"
                    disabled={reasonRequired}
                    loading={busy === "suspend-creator"}
                    onClick={() =>
                      runAction(
                        "suspend-creator",
                        () => suspendCreator(detail.subjectId, reason.trim(), caseId),
                        "Creator suspended",
                      )
                    }
                  >
                    Suspend creator
                  </Button>
                  <Button
                    variant="ghost"
                    loading={busy === "reinstate-creator"}
                    onClick={() =>
                      runAction("reinstate-creator", () => reinstateCreator(detail.subjectId), "Creator reinstated")
                    }
                  >
                    Reinstate creator
                  </Button>
                </>
              )}
            </div>

            <div className="border-t border-border pt-4">
              <label htmlFor="case-note" className="text-sm font-medium">
                Dismiss without action
              </label>
              <Textarea
                id="case-note"
                value={note}
                rows={2}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note explaining why no action was taken"
              />
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                loading={busy === "dismiss"}
                onClick={() => runAction("dismiss", () => dismissCase(caseId, note.trim()), "Case dismissed")}
              >
                Dismiss case
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit log for this case</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.auditLogs.length === 0 ? (
            <p className="text-sm text-muted">No actions recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {detail.auditLogs.map((log) => (
                <li key={log.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                  <span>
                    <Badge variant="neutral">{log.action.replace(/_/g, " ")}</Badge>{" "}
                    <span className="text-muted">
                      by {log.actor ? `@${log.actor.handle ?? log.actor.did}` : "system"}
                    </span>
                  </span>
                  <span className="text-xs text-muted">{relativeTime(log.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
