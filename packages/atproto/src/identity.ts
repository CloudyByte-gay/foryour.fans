import { DidResolver, HandleResolver } from "@atproto/identity";
import type { Did } from "@foryour-fans/shared";
import { assertDid } from "@foryour-fans/shared";

export interface ResolvedIdentity {
  did: Did;
  handle: string;
  pdsUrl: string;
}

export class HandleResolutionError extends Error {}

/**
 * Resolves a handle (e.g. alice.bsky.social) all the way through:
 *   handle -> DID -> DID document -> PDS service endpoint
 * and verifies the DID's own document actually declares this handle,
 * per the atproto bidirectional handle verification requirement — a DID
 * cannot be trusted to "own" a handle just because handle resolution
 * pointed at it; the DID document must claim the handle back.
 */
export async function resolveHandle(handle: string): Promise<ResolvedIdentity> {
  const handleResolver = new HandleResolver({});
  const did = await handleResolver.resolve(handle);
  if (!did) {
    throw new HandleResolutionError(`Could not resolve handle to a DID: ${handle}`);
  }

  const didResolver = new DidResolver({});
  const atprotoData = await didResolver.resolveAtprotoData(did);

  if (atprotoData.handle !== handle) {
    throw new HandleResolutionError(
      `Handle verification failed: ${handle} resolved to ${did}, but that DID's document declares handle ${atprotoData.handle}`,
    );
  }

  return {
    did: assertDid(did),
    handle: atprotoData.handle,
    pdsUrl: atprotoData.pds,
  };
}
