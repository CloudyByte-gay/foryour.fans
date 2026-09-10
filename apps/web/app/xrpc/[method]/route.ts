import type { NextRequest } from "next/server";
import { corsPreflight, xrpcResponse } from "@/lib/lexicon-authority";

/**
 * The `fans.foryour.*` Lexicon authority's read-only XRPC surface, served from
 * this origin because `did:web:foryour.fans` resolves here. Serves only the
 * `com.atproto.lexicon.schema` collection:
 *
 *   com.atproto.sync.getRecord   -> signed CAR (what @atproto/lex-resolver uses)
 *   com.atproto.sync.getRepo     -> the full signed CAR
 *   com.atproto.sync.listRepos / getLatestCommit
 *   com.atproto.repo.getRecord / listRecords / describeRepo  -> plain JSON
 *
 * No writes, no auth, no proxying, no other collection (Non-negotiable Rule 4).
 * See `docs/lexicon-authority.md` §3.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ method: string }> }) {
  const { method } = await ctx.params;
  return xrpcResponse(method, new URL(request.url));
}

export function OPTIONS() {
  return corsPreflight();
}
