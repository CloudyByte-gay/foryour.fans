import "server-only";
import { cache } from "react";
import { fetchApi } from "./serverApi";
import type { ModerationNotice } from "@/components/shell/ModerationNoticesBanner";

/**
 * WEB PHASE 14 audit fix. `cache()` dedupes across the (app) layout and
 * anywhere else in the same request that needs it, matching
 * lib/session.ts's own `getSession`/`getOwnCreator` pattern. Any failure
 * (API unreachable, anonymous caller never reaching this — it's only
 * called from behind the authenticated shell) degrades to an empty list,
 * never an error page — this is a notice banner, not critical path.
 */
export const getModerationNotices = cache(async (): Promise<ModerationNotice[]> => {
  try {
    const res = await fetchApi("/me/moderation-notices");
    if (res.ok) {
      return ((await res.json()) as { notices: ModerationNotice[] }).notices;
    }
  } catch {
    // ignore
  }
  return [];
});
