import type { PostVisibility } from "./types.js";

export class PostValidationError extends Error {}

export interface PostFieldsToValidate {
  visibility: PostVisibility;
  minimumTierId?: string | null;
  text: string;
}

/**
 * `minimumTierId` is only meaningful for TIER visibility — enforced here
 * rather than at the DB layer (Prisma/Postgres can't express "this column
 * is required exactly when that other column has this value") so both
 * createPost and updatePost's merged-field validation share one rule.
 */
export function validatePostFields(fields: PostFieldsToValidate): void {
  if (fields.text.trim().length === 0) {
    throw new PostValidationError("Post text is required.");
  }
  if (fields.visibility === "TIER" && !fields.minimumTierId) {
    throw new PostValidationError("minimumTierId is required when visibility is TIER.");
  }
  if (fields.visibility !== "TIER" && fields.minimumTierId) {
    throw new PostValidationError("minimumTierId can only be set when visibility is TIER.");
  }
}
