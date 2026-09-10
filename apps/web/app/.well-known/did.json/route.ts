import { corsPreflight, didDocumentResponse } from "@/lib/lexicon-authority";

/**
 * `did:web:foryour.fans` DID document — the trust anchor for the
 * `fans.foryour.*` Lexicon authority. A Route Handler (no layout, no session,
 * no middleware nonce plumbing — `/.well-known` is excluded from the matcher).
 * Content is a committed artifact from `@foryour-fans/lexicons`; regenerate
 * with `pnpm --filter @foryour-fans/lexicons authority:regen`. See
 * `docs/lexicon-authority.md`.
 */
export const dynamic = "force-static";

export function GET() {
  return didDocumentResponse();
}

export function OPTIONS() {
  return corsPreflight();
}
