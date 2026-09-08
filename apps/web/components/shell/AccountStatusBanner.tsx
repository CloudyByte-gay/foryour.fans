import { ShieldAlert } from "lucide-react";
import type { OwnCreatorSummary, SessionUser } from "@/lib/session";

/**
 * WEB PHASE 14 — account-level moderation notices (`User.status`,
 * `Creator.status`). A restricted user takes priority over a suspended
 * creator account since it's the broader-reaching state (it also blocks
 * creator actions). Scoped to account-level only — see
 * `ModerationNoticesBanner` for the per-content (a specific removed post or
 * comment) case.
 */
export function AccountStatusBanner({
  user,
  creator,
}: {
  user: SessionUser;
  creator: OwnCreatorSummary | null;
}) {
  if (user.status === "RESTRICTED") {
    return (
      <div role="alert" className="border-b border-danger/30 bg-danger/10 px-4 py-2">
        <p className="mx-auto flex max-w-4xl items-start gap-2 text-sm text-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          <span>
            <span className="font-medium">Your account is restricted.</span> A moderator took this
            action after reviewing a report. Some actions may be unavailable.
          </span>
        </p>
      </div>
    );
  }

  if (creator?.status === "SUSPENDED") {
    return (
      <div role="alert" className="border-b border-danger/30 bg-danger/10 px-4 py-2">
        <p className="mx-auto flex max-w-4xl items-start gap-2 text-sm text-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          <span>
            <span className="font-medium">Your creator account is suspended.</span> Your page and
            posts are hidden from other people until a moderator reinstates it.
          </span>
        </p>
      </div>
    );
  }

  return null;
}
