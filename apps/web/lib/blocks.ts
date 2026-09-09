import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";

/**
 * Client-safe user-blocking helpers, mirrored from `apps/api/src/routes/blocks.ts`.
 * WEB PHASE 14. Covers both "block user" and "block creator" from the
 * viewer's own perspective — a creator's account is a User too, so blocking
 * one goes through this same generic endpoint (backed by a real
 * `app.bsky.graph.block` record on the blocker's own PDS — see
 * packages/atproto/src/bskyBlock.ts). `CreatorBlock` (a creator banning a
 * specific user from their own content) is a separate backend capability
 * with no dedicated web surface yet — see docs/ux.md's Phase 14 known
 * limitations.
 */

export interface BlockedUserSummary {
  blockedUserId: string;
  createdAt: string;
  user: { id: string; did: string; handle: string | null; displayName: string | null } | null;
}

interface ApiError {
  error?: { message?: string; statusCode?: number };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error?.message ?? fallback;
}

export type BlockOutcome = { ok: true } | { ok: false; message: string };

/** `POST /blocks` — `identifier` is a handle or DID, same as everywhere else a person is looked up. */
export async function blockUser(identifier: string): Promise<BlockOutcome> {
  let res: Response;
  try {
    res = await apiFetch("/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ identifier }),
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.status === 201) return { ok: true };
  if (res.status === 502) return { ok: false, message: "Blocked, but publishing to Bluesky failed. Try again." };
  return { ok: false, message: await readApiError(res, "Couldn't block that account.") };
}

/** `DELETE /blocks/:identifier`. */
export async function unblockUser(identifier: string): Promise<BlockOutcome> {
  let res: Response;
  try {
    res = await apiFetch(`/blocks/${encodeURIComponent(identifier)}`, {
      method: "DELETE",
      headers: { ...csrfHeaders() },
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.status === 204) return { ok: true };
  return { ok: false, message: await readApiError(res, "Couldn't unblock that account.") };
}

/** `GET /blocks` — the caller's own block list, for `/settings` → Blocks. */
export async function listBlocks(): Promise<BlockedUserSummary[]> {
  const res = await apiFetch("/blocks");
  if (!res.ok) throw new Error(`GET /blocks failed: ${res.status}`);
  return (await res.json()) as BlockedUserSummary[];
}
