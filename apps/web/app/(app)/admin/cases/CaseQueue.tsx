"use client";

import { AlertTriangle, Inbox } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, type BadgeProps, ErrorState, Select, Skeleton } from "@/components/ui";
import { listCases, type ModerationCaseStatus, type ModerationCaseSummary } from "@/lib/admin";
import { relativeTime } from "@/lib/format";

const STATUS_BADGE: Record<ModerationCaseStatus, NonNullable<BadgeProps["variant"]>> = {
  OPEN: "warning",
  ACTION_TAKEN: "success",
  DISMISSED: "neutral",
};

/**
 * `/admin/cases` — the moderation queue (WEB PHASE 14). Filters mirror
 * `GET /admin/cases`'s query params exactly (`status`,
 * `requiresLegalReview`) — nothing client-side-only that the API can't back.
 */
export function CaseQueue() {
  const [status, setStatus] = useState<ModerationCaseStatus | "">("OPEN");
  const [legalOnly, setLegalOnly] = useState(false);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [cases, setCases] = useState<ModerationCaseSummary[]>([]);

  async function load() {
    setState("loading");
    try {
      const result = await listCases({
        status: status || undefined,
        requiresLegalReview: legalOnly || undefined,
      });
      setCases(result);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, [status, legalOnly]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ModerationCaseStatus | "")}
          className="w-auto"
        >
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="ACTION_TAKEN">Action taken</option>
          <option value="DISMISSED">Dismissed</option>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={legalOnly}
            onChange={(e) => setLegalOnly(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Requires legal review only
        </label>
      </div>

      {state === "loading" && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      )}

      {state === "error" && <ErrorState message="Couldn't load the case queue." onRetry={() => void load()} />}

      {state === "ready" && cases.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-muted text-muted">
            <Inbox className="h-5 w-5" aria-hidden />
          </span>
          <p className="font-display text-base font-semibold">No cases match these filters</p>
        </div>
      )}

      {state === "ready" && cases.length > 0 && (
        <ul className="space-y-2">
          {cases.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/cases/${c.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-surface-muted"
              >
                <div className="flex items-center gap-3">
                  <Badge variant="neutral">{c.subjectType}</Badge>
                  <span className="font-mono text-xs text-muted">{c.subjectId}</span>
                  {c.requiresLegalReview && (
                    <Badge variant="danger">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      Legal review
                    </Badge>
                  )}
                  {c.classifierSuggestion?.severity && (
                    <Badge variant="warning">classifier: {c.classifierSuggestion.severity}</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-muted">
                  <span>{relativeTime(c.openedAt)}</span>
                  <Badge variant={STATUS_BADGE[c.status]}>{c.status.replace("_", " ")}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
