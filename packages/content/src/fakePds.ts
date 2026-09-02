import type { DeleteAtRecord, ListAtRecords, PublishAtRecord, ReadAtRecord } from "@foryour-fans/atproto";

/**
 * An in-memory stand-in for a creator's PDS repo — enough to exercise
 * CreatorOwnedContentRepository (and to play the role of "a different
 * fan-service app reading the same records") without a live PDS. Keyed by
 * `did/collection/rkey`, like a real repo's MST paths.
 *
 * `failPublishOn` / `failDeleteOn` let a test simulate a mid-write failure.
 */
export class FakePds {
  private readonly records = new Map<string, { uri: string; cid: string; value: Record<string, unknown> }>();
  private cidSeq = 0;

  publishCalls: Array<{ did: string; collection: string; rkey: string; record: Record<string, unknown> }> = [];
  deleteCalls: Array<{ did: string; collection: string; rkey: string }> = [];

  /** Throw on the Nth publish call (1-indexed) whose collection matches. */
  failPublishOn?: { collection: string; nth: number };
  private matchingPublishes = 0;

  private key(did: string, collection: string, rkey: string): string {
    return `${did}/${collection}/${rkey}`;
  }

  publish: PublishAtRecord = async (did, params) => {
    this.publishCalls.push({ did, ...params });
    if (this.failPublishOn && params.collection === this.failPublishOn.collection) {
      this.matchingPublishes += 1;
      if (this.matchingPublishes === this.failPublishOn.nth) {
        throw new Error(`FakePds: simulated publish failure on ${params.collection}`);
      }
    }
    const uri = `at://${did}/${params.collection}/${params.rkey}`;
    const cid = `bafyfake${this.cidSeq++}`;
    this.records.set(this.key(did, params.collection, params.rkey), { uri, cid, value: params.record });
    return { uri, cid };
  };

  delete: DeleteAtRecord = async (did, params) => {
    this.deleteCalls.push({ did, ...params });
    this.records.delete(this.key(did, params.collection, params.rkey));
  };

  read: ReadAtRecord = async (did, params) => {
    const repo = params.repo ?? did;
    return this.records.get(this.key(repo, params.collection, params.rkey)) ?? null;
  };

  list: ListAtRecords = async (did, params) => {
    const repo = params.repo ?? did;
    const prefix = `${repo}/${params.collection}/`;
    const records = [...this.records.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v);
    return { records };
  };

  /** All records currently in a repo, for assertions. */
  all(did: string): Array<{ uri: string; cid: string; value: Record<string, unknown> }> {
    const prefix = `${did}/`;
    return [...this.records.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  }

  get(did: string, collection: string, rkey: string): Record<string, unknown> | undefined {
    return this.records.get(this.key(did, collection, rkey))?.value;
  }
}
