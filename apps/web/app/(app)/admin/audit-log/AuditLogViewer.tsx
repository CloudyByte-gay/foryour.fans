"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, ErrorState, Select, Skeleton } from "@/components/ui";
import type { ReportSubjectType } from "@/lib/reports";
import { listAuditLog, type AuditLogEntry } from "@/lib/admin";
import { relativeTime } from "@/lib/format";

/**
 * `/admin/audit-log` — the append-only trail every moderation action writes
 * to (`GET /admin/audit-log`). Filterable by `targetType`, matching the
 * API's only filter — no client-side-only filtering that would silently lie
 * about what's actually in the log.
 */
export function AuditLogViewer() {
  const [targetType, setTargetType] = useState<ReportSubjectType | "">("");
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);

  async function load() {
    setState("loading");
    try {
      setLogs(await listAuditLog({ targetType: targetType || undefined, limit: 100 }));
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, [targetType]);

  return (
    <div className="space-y-4">
      <Select
        aria-label="Filter by target type"
        value={targetType}
        onChange={(e) => setTargetType(e.target.value as ReportSubjectType | "")}
        className="w-auto"
      >
        <option value="">All target types</option>
        <option value="POST">Post</option>
        <option value="COMMENT">Comment</option>
        <option value="USER">User</option>
        <option value="CREATOR">Creator</option>
      </Select>

      {state === "loading" && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      )}

      {state === "error" && <ErrorState message="Couldn't load the audit log." onRetry={() => void load()} />}

      {state === "ready" && logs.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          No matching audit log entries.
        </p>
      )}

      {state === "ready" && logs.length > 0 && (
        <ul className="space-y-2">
          {logs.map((log) => (
            <li key={log.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="neutral">{log.action.replace(/_/g, " ")}</Badge>
                  <Badge variant="neutral">{log.targetType}</Badge>
                  {log.moderationCaseId ? (
                    <Link
                      href={`/admin/cases/${log.moderationCaseId}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {log.targetId}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs text-muted">{log.targetId}</span>
                  )}
                </div>
                <span className="text-xs text-muted">{relativeTime(log.createdAt)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                by {log.actor ? `@${log.actor.handle ?? log.actor.did}` : `${log.actorRole.toLowerCase()} (system)`}
              </p>
              {log.metadata && Object.keys(log.metadata).length > 0 && (
                <pre className="mt-2 overflow-x-auto rounded-md bg-surface-muted p-2 text-xs">
                  {JSON.stringify(log.metadata, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
