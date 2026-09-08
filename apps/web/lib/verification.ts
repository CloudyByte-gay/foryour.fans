import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";

/**
 * Client-safe creator identity/KYC verification helpers
 * (`apps/api/src/routes/verification.ts`). WEB PHASE 14.
 *
 * The backend enum is `UNVERIFIED` / `PENDING` / `VERIFIED` only — there is
 * no separate `REJECTED` status; an admin rejection resets a creator back to
 * `UNVERIFIED` (see `packages/moderation/src/verification.ts`). This differs
 * from `prompts/web.md`'s WEB PHASE 14 text, which lists a `rejected` state;
 * the UI here is built against what the API actually returns, per
 * cross-cutting requirement #10 ("never build ahead of the API") — see
 * docs/ux.md's Phase 14 known limitations for the full reasoning.
 */
export type VerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED";

interface ApiError {
  error?: { message?: string; statusCode?: number };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error?.message ?? fallback;
}

export type SubmitVerificationOutcome =
  | { ok: true; verificationStatus: VerificationStatus }
  | { ok: false; message: string };

/** `POST /creators/me/verification/submit` — UNVERIFIED -> PENDING. */
export async function submitVerification(): Promise<SubmitVerificationOutcome> {
  let res: Response;
  try {
    res = await apiFetch("/creators/me/verification/submit", {
      method: "POST",
      headers: { ...csrfHeaders() },
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.ok) {
    return { ok: true, ...(await res.json()) as { verificationStatus: VerificationStatus } };
  }
  return { ok: false, message: await readApiError(res, "Couldn't submit for verification.") };
}
