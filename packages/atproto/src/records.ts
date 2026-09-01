import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-node";

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
