import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";
import type { ReportReason, ReportSubjectType } from "@/lib/reports";

/**
 * Client-safe admin moderation-console helpers, mirrored from
 * `apps/api/src/routes/admin.ts`. WEB PHASE 14. Every route here 403s a
 * non-admin caller and 401s an anonymous one — the same `requireAdmin`
 * check the server enforces regardless of what the UI shows, so a stray
 * client bug here is never a real authorization gap.
 */

export type ModerationCaseStatus = "OPEN" | "ACTION_TAKEN" | "DISMISSED";

/**
 * The classifier-suggestion shape is intentionally loose — it mirrors
 * `packages/moderation/src/classifiers/types.ts#ClassifierSuggestion`,
 * whatever a future real classifier implementation actually returns. The
 * case-detail UI renders it generically (a pluggable "signal" row), never
 * assuming a specific provider's fields.
 */
export interface ClassifierSuggestion {
  suggestedLabels?: string[];
  severity?: "low" | "medium" | "high";
  notes?: string;
  [key: string]: unknown;
}

export interface ModerationCaseSummary {
  id: string;
  subjectType: ReportSubjectType;
  subjectId: string;
  status: ModerationCaseStatus;
  requiresLegalReview: boolean;
  classifierSuggestion: ClassifierSuggestion | null;
  openedAt: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
}

export interface CaseReport {
  id: string;
  reasonType: ReportReason;
  reason: string | null;
  createdAt: string;
  reporter: { id: string; did: string; handle: string | null };
}

export interface ContentLabelRow {
  id: string;
  subjectType: ReportSubjectType;
  subjectId: string;
  subjectUri: string | null;
  val: string;
  src: string;
  neg: boolean;
  cts: string;
  exp: string | null;
}

export type AuditAction =
  | "CASE_DISMISSED"
  | "CONTENT_REMOVED"
  | "ACCOUNT_RESTRICTED"
  | "ACCOUNT_REINSTATED"
  | "CREATOR_SUSPENDED"
  | "CREATOR_REINSTATED"
  | "LABEL_APPLIED"
  | "LABEL_REMOVED"
  | "CREATOR_VERIFICATION_SUBMITTED"
  | "CREATOR_VERIFICATION_APPROVED"
  | "CREATOR_VERIFICATION_REJECTED";

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  actorRole: string;
  action: AuditAction;
  targetType: ReportSubjectType;
  targetId: string;
  moderationCaseId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor?: { id: string; did: string; handle: string | null } | null;
}

export interface ModerationCaseDetail extends ModerationCaseSummary {
  reports: CaseReport[];
  labels: ContentLabelRow[];
  auditLogs: AuditLogEntry[];
}

interface ApiError {
  error?: { message?: string; statusCode?: number };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error?.message ?? fallback;
}

export type AdminActionOutcome = { ok: true } | { ok: false; message: string };

async function adminAction(path: string, body?: Record<string, unknown>): Promise<AdminActionOutcome> {
  let res: Response;
  try {
    res = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.ok) return { ok: true };
  return { ok: false, message: await readApiError(res, "That action failed.") };
}

/** `GET /admin/cases[?status=][&requiresLegalReview=]`. */
export async function listCases(filter: { status?: ModerationCaseStatus; requiresLegalReview?: boolean } = {}): Promise<ModerationCaseSummary[]> {
  const qs = new URLSearchParams();
  if (filter.status) qs.set("status", filter.status);
  if (filter.requiresLegalReview !== undefined) qs.set("requiresLegalReview", String(filter.requiresLegalReview));
  const res = await apiFetch(`/admin/cases${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`GET /admin/cases failed: ${res.status}`);
  return (await res.json()) as ModerationCaseSummary[];
}

/** `GET /admin/cases/:id`. */
export async function getCase(caseId: string): Promise<ModerationCaseDetail | null> {
  const res = await apiFetch(`/admin/cases/${caseId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /admin/cases/:id failed: ${res.status}`);
  return (await res.json()) as ModerationCaseDetail;
}

export async function dismissCase(caseId: string, note: string): Promise<AdminActionOutcome> {
  return adminAction(`/admin/cases/${caseId}/dismiss`, { note });
}

export async function applyCaseLabel(caseId: string, val: string): Promise<AdminActionOutcome> {
  return adminAction(`/admin/cases/${caseId}/labels`, { val });
}

export async function removeCaseLabel(caseId: string, val: string): Promise<AdminActionOutcome> {
  let res: Response;
  try {
    res = await apiFetch(`/admin/cases/${caseId}/labels/${encodeURIComponent(val)}`, {
      method: "DELETE",
      headers: { ...csrfHeaders() },
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.status === 204) return { ok: true };
  return { ok: false, message: await readApiError(res, "Couldn't remove that label.") };
}

export async function removePost(postId: string, reason: string, caseId?: string): Promise<AdminActionOutcome> {
  return adminAction(`/admin/posts/${postId}/remove`, { reason, caseId });
}

export async function removeComment(commentId: string, reason: string, caseId?: string): Promise<AdminActionOutcome> {
  return adminAction(`/admin/comments/${commentId}/remove`, { reason, caseId });
}

export async function restrictUser(userId: string, reason: string, caseId?: string): Promise<AdminActionOutcome> {
  return adminAction(`/admin/users/${userId}/restrict`, { reason, caseId });
}

export async function reinstateUser(userId: string): Promise<AdminActionOutcome> {
  return adminAction(`/admin/users/${userId}/reinstate`);
}

export async function suspendCreator(creatorId: string, reason: string, caseId?: string): Promise<AdminActionOutcome> {
  return adminAction(`/admin/creators/${creatorId}/suspend`, { reason, caseId });
}

export async function reinstateCreator(creatorId: string): Promise<AdminActionOutcome> {
  return adminAction(`/admin/creators/${creatorId}/reinstate`);
}

export async function approveCreatorVerification(creatorId: string): Promise<AdminActionOutcome> {
  return adminAction(`/admin/creators/${creatorId}/verification/approve`);
}

export async function rejectCreatorVerification(creatorId: string, note?: string): Promise<AdminActionOutcome> {
  return adminAction(`/admin/creators/${creatorId}/verification/reject`, note ? { note } : {});
}

/** `GET /admin/audit-log[?targetType=][&targetId=]`. */
export async function listAuditLog(filter: { targetType?: ReportSubjectType; targetId?: string; limit?: number } = {}): Promise<AuditLogEntry[]> {
  const qs = new URLSearchParams();
  if (filter.targetType) qs.set("targetType", filter.targetType);
  if (filter.targetId) qs.set("targetId", filter.targetId);
  if (filter.limit) qs.set("limit", String(filter.limit));
  const res = await apiFetch(`/admin/audit-log${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`GET /admin/audit-log failed: ${res.status}`);
  return (await res.json()) as AuditLogEntry[];
}
