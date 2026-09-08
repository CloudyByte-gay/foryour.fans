import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";

/**
 * Client-safe report helpers, mirrored from `POST /reports`
 * (`apps/api/src/routes/reports.ts`). WEB PHASE 14. No `next/headers` /
 * server-only imports here — imported by client components.
 */

export type ReportSubjectType = "CREATOR" | "USER" | "POST" | "COMMENT";

export type ReportReason =
  | "SPAM"
  | "HARASSMENT"
  | "IMPERSONATION"
  | "SEXUAL_CONTENT_VIOLATION"
  | "NCII"
  | "COPYRIGHT"
  | "ILLEGAL_CONTENT"
  | "OTHER";

export const REPORT_REASON_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: "SPAM", label: "Spam" },
  { value: "HARASSMENT", label: "Harassment or abuse" },
  { value: "IMPERSONATION", label: "Impersonation" },
  { value: "SEXUAL_CONTENT_VIOLATION", label: "Sexual content policy violation" },
  { value: "NCII", label: "Non-consensual intimate imagery" },
  { value: "COPYRIGHT", label: "Copyright infringement" },
  { value: "ILLEGAL_CONTENT", label: "Illegal content" },
  { value: "OTHER", label: "Something else" },
];

export const REPORT_REASON_MAX = 20_000;

interface ApiError {
  error?: { message?: string; statusCode?: number };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error?.message ?? fallback;
}

export type FileReportOutcome = { ok: true } | { ok: false; message: string };

/**
 * `POST /reports`. No exposure of case internals in the response — the
 * caller only ever learns "your report was filed," matching the spec's
 * "no exposure of case internals" (a reporter never learns whether other
 * reports exist, the case status, or what action (if any) was taken).
 */
export async function fileReport(input: {
  subjectType: ReportSubjectType;
  subjectId: string;
  reasonType: ReportReason;
  reason?: string;
}): Promise<FileReportOutcome> {
  let res: Response;
  try {
    res = await apiFetch("/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.status === 201) {
    return { ok: true };
  }
  if (res.status === 403) {
    return { ok: false, message: "This account is restricted from filing reports." };
  }
  return { ok: false, message: await readApiError(res, "Couldn't file the report.") };
}
