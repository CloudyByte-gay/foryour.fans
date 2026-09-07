import type { ModerationSubjectType, ReportReason } from "@foryour-fans/database";

/**
 * Phase 14 — "Build interfaces for future automated classifiers rather than
 * hard-coding one provider" (prompts/full.md). Same DI shape as
 * PaymentProvider/PayoutProvider (packages/subscriptions) and MediaProcessor
 * (packages/media): a narrow interface plus a no-op real implementation,
 * with the actual scanning/classification work left entirely to a future
 * phase.
 *
 * A classifier only ever SUGGESTS — `createReport` (../reports.ts) stores
 * its output on `ModerationCase.classifierSuggestion` for a human admin to
 * read, and never acts on it automatically. There is no auto-label,
 * auto-remove, or auto-suspend path anywhere in this codebase; every
 * AuditLog-worthy action in packages/moderation/src/moderationActions.ts
 * requires an acting admin User.
 */
export interface ClassifierSuggestionInput {
  subjectType: ModerationSubjectType;
  subjectId: string;
  reasonType: ReportReason;
  reason: string | null;
}

export interface ClassifierSuggestion {
  suggestedLabels?: string[];
  severity?: "low" | "medium" | "high";
  notes?: string;
}

export interface ContentClassifier {
  readonly name: string;
  /** Returns null when the classifier has nothing to add — the common case for PassthroughContentClassifier. */
  suggestForReport(input: ClassifierSuggestionInput): Promise<ClassifierSuggestion | null>;
}

/**
 * The only ContentClassifier implementation that exists today — always
 * returns null, exactly like Phase 8's PassthroughMediaProcessor always
 * returns "ready" without actually scanning anything. Wiring a real
 * classifier (a hosted moderation-AI API, a self-hosted model, …) later is a
 * new implementation of this interface plus a `server.ts` wiring change —
 * zero changes to packages/moderation's reporting/case logic.
 */
export class PassthroughContentClassifier implements ContentClassifier {
  readonly name = "passthrough";

  async suggestForReport(): Promise<ClassifierSuggestion | null> {
    return null;
  }
}
