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
