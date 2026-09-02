import { Agent } from "@atproto/api";
import { TID } from "@atproto/common-web";
import type { OAuthSession } from "@atproto/oauth-client-node";

/**
 * A fresh record key for a `key: "tid"` Lexicon record (see
 * fans.foryour.tier in packages/lexicons) — callers choose the rkey for
 * tid-keyed records themselves; the PDS doesn't generate one for you, so
 * this must be generated once per record and then reused for every future
 * update/delete of that same record (see SubscriptionTier.atRkey).
 */
export function nextTid(): string {
  return TID.nextStr();
}

export interface PutRecordParams {
  collection: string;
  rkey: string;
  record: Record<string, unknown>;
}

export interface PutRecordResult {
  uri: string;
  cid: string;
}

/**
 * Writes a record to the DID's OWN repo (their own PDS), using their AT
 * OAuth session. Generic — callers pass an already-validated record (see
 * @foryour-fans/lexicons' generated `$build`/`$validate`); this module has
 * no knowledge of any specific Lexicon.
 */
export async function putRecord(session: OAuthSession, params: PutRecordParams): Promise<PutRecordResult> {
  const agent = new Agent(session);
  const { data } = await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: params.collection,
    rkey: params.rkey,
    record: params.record,
  });
  return { uri: data.uri, cid: data.cid };
}

export interface DeleteRecordParams {
  collection: string;
  rkey: string;
}

/** Deletes a record from the DID's own repo. Callers that need this to be idempotent (e.g. a DELETE route hit twice) should track locally whether the record still exists rather than relying on delete-of-nonexistent being a no-op here — that hasn't been verified against a real PDS. */
export async function deleteRecord(session: OAuthSession, params: DeleteRecordParams): Promise<void> {
  const agent = new Agent(session);
  await agent.com.atproto.repo.deleteRecord({
    repo: session.did,
    collection: params.collection,
    rkey: params.rkey,
  });
}

export interface GetRecordParams {
  /** Whose repo to read. Defaults to the session's own DID — pass another DID to read a different creator's public records. */
  repo?: string;
  collection: string;
  rkey: string;
}

export interface GetRecordResult {
  uri: string;
  cid?: string;
  value: Record<string, unknown>;
}

/**
 * Reads one record from a repo. `com.atproto.repo.getRecord` is
 * unauthenticated for public collections, so a compatible fan-service app
 * can call this against any creator's DID with no relationship to that
 * creator — see docs/creator-owned-pds.md §5.
 */
export async function getRecord(session: OAuthSession, params: GetRecordParams): Promise<GetRecordResult | null> {
  const agent = new Agent(session);
  try {
    const { data } = await agent.com.atproto.repo.getRecord({
      repo: params.repo ?? session.did,
      collection: params.collection,
      rkey: params.rkey,
    });
    return { uri: data.uri, cid: data.cid, value: data.value as Record<string, unknown> };
  } catch (error) {
    if (isRecordNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export interface ListRecordsParams {
  repo?: string;
  collection: string;
  limit?: number;
  cursor?: string;
  /** Oldest-first when true (TID rkeys sort chronologically). */
  reverse?: boolean;
}

export interface ListRecordsResult {
  records: Array<{ uri: string; cid: string; value: Record<string, unknown> }>;
  cursor?: string;
}

/** Lists a page of records from a collection in a repo. Paginate with `cursor`. */
export async function listRecords(session: OAuthSession, params: ListRecordsParams): Promise<ListRecordsResult> {
  const agent = new Agent(session);
  const { data } = await agent.com.atproto.repo.listRecords({
    repo: params.repo ?? session.did,
    collection: params.collection,
    limit: params.limit,
    cursor: params.cursor,
    reverse: params.reverse,
  });
  return {
    records: data.records.map((r) => ({ uri: r.uri, cid: r.cid, value: r.value as Record<string, unknown> })),
    cursor: data.cursor,
  };
}

export interface UploadBlobResult {
  /** The `blob` lexicon value to embed in a record (`{$type: "blob", ref, mimeType, size}`). */
  blob: Record<string, unknown>;
  mimeType: string;
  size: number;
}

/**
 * Uploads bytes to the DID's OWN PDS via `com.atproto.repo.uploadBlob`. The
 * blob is inaccessible until a record references it, then becomes PUBLICLY
 * fetchable via `com.atproto.sync.getBlob` with no per-viewer auth — so
 * gated media bytes MUST be ciphertext before they reach here. See
 * docs/creator-owned-pds.md §2.
 */
export async function uploadBlob(
  session: OAuthSession,
  bytes: Uint8Array,
  mimeType: string,
): Promise<UploadBlobResult> {
  const agent = new Agent(session);
  const { data } = await agent.com.atproto.repo.uploadBlob(bytes, { encoding: mimeType });
  const blob = data.blob;
  return {
    blob: blob.toJSON() as Record<string, unknown>,
    mimeType,
    size: typeof blob.size === "number" ? blob.size : bytes.byteLength,
  };
}

interface XrpcErrorLike {
  error?: string;
  status?: number;
}

function isRecordNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const e = error as XrpcErrorLike;
  return e.error === "RecordNotFound" || e.status === 404;
}
