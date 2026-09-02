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

/**
 * The reverse direction of resolveHandle — given a DID (e.g. from a real
 * Jetstream commit event, packages/discovery), resolve its DID document to
 * find the handle it currently declares. No bidirectional handle->DID
 * verification here (unlike resolveHandle): that check exists to stop a
 * DID from claiming a handle it doesn't actually own during *login*; here
 * the DID is already the trusted starting point (it came from a real
 * network event, not a client-supplied login handle), and we only want
 * "what handle does this DID's own document currently say."
 */
export async function resolveDid(did: string): Promise<{ handle: string | null; pdsUrl: string | null }> {
  const didResolver = new DidResolver({});
  try {
    const atprotoData = await didResolver.resolveAtprotoData(did);
    return { handle: atprotoData.handle, pdsUrl: atprotoData.pds };
  } catch {
    // A DID that no longer resolves (deactivated account, deleted PLC
    // entry, transient resolver failure) — indexing continues with a null
    // handle rather than failing the whole commit event.
    return { handle: null, pdsUrl: null };
  }
}
