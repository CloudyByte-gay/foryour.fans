/**
 * The DI-friendly, DID-bound shape of "write/delete a record on someone's
 * own PDS" — what packages/atproto/src/records.ts#putRecord/deleteRecord
 * become once bound to a specific DID via oauthClient.restore(did). Any
 * package/app that needs to publish an AT record depends on these
 * interfaces (and injects a real or fake implementation), never on
 * NodeOAuthClient/Agent directly — see apps/api/src/server.ts for the real
 * wiring and apps/api/test/fakes.ts for the test doubles.
 *
 * Lives here (not in apps/api) because packages must not depend on an app —
 * packages/subscriptions needs this exact shape too (see
 * packages/subscriptions/src/tiers.ts), and apps/api/src/services/creators.ts
 * does as well.
 */

export interface PublishAtRecord {
  (did: string, params: { collection: string; rkey: string; record: Record<string, unknown> }): Promise<{
    uri: string;
    cid: string;
  }>;
}

export interface DeleteAtRecord {
  (did: string, params: { collection: string; rkey: string }): Promise<void>;
}

/**
 * Read one record from a repo. `repo` defaults to `did` (act on the bound
 * DID's own repo); pass a different `repo` to read another creator's public
 * records — the same call a competing fan-service app would make.
 */
export interface ReadAtRecord {
  (
    did: string,
    params: { collection: string; rkey: string; repo?: string },
  ): Promise<{ uri: string; cid?: string; value: Record<string, unknown> } | null>;
}

/** List a page of records from a collection in a repo. */
export interface ListAtRecords {
  (
    did: string,
    params: { collection: string; repo?: string; limit?: number; cursor?: string; reverse?: boolean },
  ): Promise<{ records: Array<{ uri: string; cid: string; value: Record<string, unknown> }>; cursor?: string }>;
}

/**
 * Upload bytes as a blob to the bound DID's own PDS. The bytes become
 * PUBLICLY fetchable once any record references the returned blob — gated
 * media must be encrypted before it reaches here.
 */
export interface UploadAtBlob {
  (
    did: string,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<{ blob: Record<string, unknown>; mimeType: string; size: number }>;
}

export class AtRecordPublishError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
  ) {
    super(message);
  }
}

export class AtRecordDeleteError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
  ) {
    super(message);
  }
}
