import { z } from "zod";
import type { BadgeProps } from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";

/**
 * Client-safe post helpers, mirrored from the API's post routes
 * (`apps/api/src/routes/posts.ts`). The form schema rejects the same input
 * the server would (`createBodySchema` / `updateBodySchema` there), and the
 * types mirror `toPostResponse` / `toLockedStub`.
 *
 * No `next/headers` / server-only imports here — imported by client
 * components. Server components import the *types* only.
 *
 * Body text is **plain text** (the WEB PHASE 7 spec leaves "plain text or
 * minimal markdown" to be decided here): rendered with whitespace preserved,
 * never as HTML — no markdown parser, no rich-text surface, nothing to
 * sanitise. A richer editor can layer on later without changing storage.
 */

export const POST_TEXT_MAX = 10_000;

export type PostVisibility = "PUBLIC" | "SUBSCRIBERS" | "TIER";

interface VisibilityMeta {
  label: string;
  /** One-line description shown under the option in the composer. */
  hint: string;
  badge: NonNullable<BadgeProps["variant"]>;
}

export const POST_VISIBILITY_META: Record<PostVisibility, VisibilityMeta> = {
  PUBLIC: {
    label: "Public",
    hint: "Anyone can see it. Also published to the open AT Protocol network.",
    badge: "neutral",
  },
  SUBSCRIBERS: {
    label: "Subscribers",
    hint: "Any active subscriber, at any tier. Never leaves foryour.fans.",
    badge: "success",
  },
  TIER: {
    label: "Specific tier",
    hint: "Subscribers at the chosen tier or higher. Never leaves foryour.fans.",
    badge: "locked",
  },
};

export const VISIBILITY_ORDER: PostVisibility[] = ["PUBLIC", "SUBSCRIBERS", "TIER"];

/**
 * The persistent, unmissable warning shown while `Public` is selected — the
 * exact copy the WEB PHASE 7 spec mandates, enforcing `full.md`'s rule that
 * public and private posts have visibly different storage behaviour.
 */
export const PUBLIC_POST_WARNING =
  "This publishes to the open AT Protocol network and can be replicated by other apps. " +
  "Subscriber-only content never leaves foryour.fans.";

export const postFormSchema = z
  .object({
    visibility: z.enum(["PUBLIC", "SUBSCRIBERS", "TIER"]),
    minimumTierId: z.string().uuid().optional(),
    text: z
      .string()
      .trim()
      .min(1, "Write something first.")
      .max(POST_TEXT_MAX, `Keep it under ${POST_TEXT_MAX.toLocaleString()} characters.`),
  })
  .refine((v) => v.visibility !== "TIER" || !!v.minimumTierId, {
    message: "Pick which tier unlocks this post.",
    path: ["minimumTierId"],
  });

export type PostFormValues = z.infer<typeof postFormSchema>;

/** `toPostResponse` in the API — a creator's own post (list rows, edit seed). */
export interface OwnPost {
  id: string;
  creatorId: string;
  visibility: PostVisibility;
  minimumTierId: string | null;
  text: string;
  media: Array<{ mediaAssetId: string; sortOrder: number }>;
  createdAt: string;
  updatedAt: string;
}

export interface PostCreatorIdentity {
  did: string;
  handle: string | null;
  displayName: string | null;
}

export interface RequiredTierSummary {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
}

/** The fields the composer's `TIER` picker needs from `GET /creators/me/tiers`. */
export interface TierOption {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  isActive: boolean;
}

/** `GET /posts/:id` for an entitled viewer / the creator / a PUBLIC post. */
export interface UnlockedPostView extends OwnPost {
  locked: false;
  creator: PostCreatorIdentity;
}

/** `GET /posts/:id` for a non-entitled viewer — safe metadata only, no `text`. */
export interface LockedPostView {
  id: string;
  creatorId: string;
  visibility: PostVisibility;
  createdAt: string;
  locked: true;
  hasMedia: boolean;
  requiredTier: RequiredTierSummary | null;
  creator: PostCreatorIdentity;
}

export type PostView = UnlockedPostView | LockedPostView;

interface ApiError {
  error?: { message?: string; statusCode?: number };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  if (res.status === 502) {
    return "Saved, but publishing to the AT Protocol network failed. Try again.";
  }
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error?.message ?? fallback;
}

export type SavePostOutcome =
  | { ok: true; post: OwnPost }
  | { ok: false; message: string };

function toPayload(values: PostFormValues) {
  return {
    visibility: values.visibility,
    text: values.text.trim(),
    ...(values.visibility === "TIER" ? { minimumTierId: values.minimumTierId } : {}),
  };
}

/** `POST /creators/me/posts`. */
export async function createPost(values: PostFormValues): Promise<SavePostOutcome> {
  let res: Response;
  try {
    res = await apiFetch("/creators/me/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(toPayload(values)),
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.status === 201) {
    return { ok: true, post: (await res.json()) as OwnPost };
  }
  return { ok: false, message: await readApiError(res, "Couldn't save the post.") };
}

/** `PATCH /creators/me/posts/:id`. */
export async function updatePost(id: string, values: PostFormValues): Promise<SavePostOutcome> {
  let res: Response;
  try {
    res = await apiFetch(`/creators/me/posts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(toPayload(values)),
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.ok) {
    return { ok: true, post: (await res.json()) as OwnPost };
  }
  return { ok: false, message: await readApiError(res, "Couldn't save the post.") };
}

/** `DELETE /creators/me/posts/:id`. */
export async function deletePost(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await apiFetch(`/creators/me/posts/${id}`, {
      method: "DELETE",
      headers: { ...csrfHeaders() },
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.status === 204) {
    return { ok: true };
  }
  return { ok: false, message: await readApiError(res, "Couldn't delete the post.") };
}
