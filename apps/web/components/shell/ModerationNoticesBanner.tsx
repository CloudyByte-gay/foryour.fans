import { EyeOff } from "lucide-react";

export interface ModerationNotice {
  targetType: "POST" | "COMMENT";
  targetId: string;
  reason: string | null;
  removedAt: string;
}

/**
 * WEB PHASE 14 audit fix — the spec's own "Moderation-notice banners on
 * restricted/removed content the viewer owns, with a placeholder appeal
 * link" was never built (see AccountStatusBanner's old doc comment, which
 * used to say this case has no banner at all). Backed by
 * `GET /me/moderation-notices` (apps/api/src/routes/reports.ts) — every
 * post/comment the viewer owns that a moderator removed, distinguished from
 * the viewer's own deletes (see that route's own doc comment for how, with
 * no schema change).
 *
 * "Appeal" is a real placeholder, not a real flow — there is no appeals
 * system anywhere in this codebase (same "placeholder, not a vendor/backend
 * integration" framing as age verification and the /legal/compliance page)
 * — so the control is disabled rather than linking somewhere that doesn't
 * exist yet.
 */
export function ModerationNoticesBanner({ notices }: { notices: ModerationNotice[] }) {
  if (notices.length === 0) return null;

  return (
    <div className="space-y-1 border-b border-warning/30 bg-warning/10 px-4 py-2">
      {notices.map((notice) => (
        <div
          key={`${notice.targetType}-${notice.targetId}`}
          role="alert"
          className="mx-auto flex max-w-4xl flex-wrap items-start justify-between gap-x-3 gap-y-1"
        >
          <p className="flex items-start gap-2 text-sm text-foreground">
            <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span>
              <span className="font-medium">
                A {notice.targetType === "POST" ? "post" : "comment"} you{" "}
                {notice.targetType === "POST" ? "published" : "wrote"} was removed by a moderator.
              </span>{" "}
              {notice.reason ? <>Reason given: {notice.reason}.</> : "No reason was given."}
            </span>
          </p>
          <button
            type="button"
            disabled
            title="Appeals aren't available yet."
            className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-muted disabled:cursor-not-allowed"
          >
            Appeal
          </button>
        </div>
      ))}
    </div>
  );
}
