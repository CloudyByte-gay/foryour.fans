/**
 * Signed atproto repo for the `fans.foryour.*` Lexicon authority.
 *
 * The reference resolver (`@atproto/lex-resolver`) fetches a schema record via
 * `com.atproto.sync.getRecord` and verifies a signed commit + MST proof — a
 * plain JSON body is not accepted (see `docs/lexicon-authority.md` §1.3). So the
 * authority publishes a real, minimal atproto repo: one collection
 * (`com.atproto.lexicon.schema`), one record per NSID, rkey = the full NSID.
 *
 * This module pulls in `@atproto/repo` + `@atproto/crypto` and is therefore
 * deliberately NOT re-exported from `./index.ts`. It is used only by the publish
 * tooling (`scripts/authority.ts`) and by tests. The served read surface in
 * `apps/web` never imports it — it serves the committed CAR verbatim and builds
 * JSON bodies from the pure `./authority.ts` builder.
 */
import { Secp256k1Keypair, formatDidKey, parseDidKey, parseMultikey } from "@atproto/crypto";
import {
  MemoryBlockstore,
  Repo,
  WriteOpAction,
  blocksToCarFile,
  readCarWithRoot,
  verifyCommitSig,
  type RecordCreateOp,
} from "@atproto/repo";
import {
  ALL_NSIDS,
  LEXICON_AUTHORITY_DID,
  LEXICON_SCHEMA_COLLECTION,
  buildLexiconSchemaRecord,
  type LexiconSchemaRecord,
} from "./authority.js";

/**
 * Deterministic `rev` for the authority commit.
 *
 * A repo commit's `rev` is normally a wall-clock TID. We derive it from the
 * DID + the sorted NSID list instead, so regenerating the CAR from an unchanged
 * schema set produces a byte-identical artifact (no noise diffs). It changes
 * only when the namespace changes; a schema-body edit changes a record CID,
 * which changes the MST root, which the drift test catches regardless of `rev`.
 *
 * TID shape: 13 chars from `[234567abcdefghij...]`-ish base32-sortable. We just
 * need a stable, valid-looking string; no resolver validates `rev` format.
 */
export function deterministicRev(did: string, nsids: readonly string[]): string {
  const B32 = "234567abcdefghijklmnopqrstuvwxyz"; // atproto's base32-sortable alphabet
  let h = 0x811c9dc5;
  for (const ch of `${did}\n${[...nsids].sort().join("\n")}`) {
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  }
  // Spread the 32-bit hash across 13 base32 chars deterministically.
  let out = "";
  let state = h;
  for (let i = 0; i < 13; i++) {
    state = Math.imul(state, 0x01000193) >>> 0;
    out += B32[(state >>> (i % 24)) & 31];
  }
  // First char of a TID is one of [2-7] to keep it in-range; force it.
  return "3" + out.slice(1);
}

export interface BuildAuthorityRepoResult {
  car: Uint8Array;
  did: string;
  /** Root commit CID (base32 CIDv1 string). */
  commitCid: string;
  rev: string;
  /** NSID → record CID (base32 CIDv1 string). */
  recordCids: Record<string, string>;
  /** `did:key:z...` form of the signing key's public half. */
  signingDidKey: string;
}

/**
 * Build the signed authority repo CAR from the compiled schemas and a signing
 * keypair. Deterministic: same key + same schema set → identical bytes
 * (secp256k1 signing is RFC-6979 deterministic).
 */
export async function buildAuthorityRepo(options: {
  keypair: Secp256k1Keypair;
  did?: string;
  nsids?: readonly string[];
}): Promise<BuildAuthorityRepoResult> {
  const did = options.did ?? LEXICON_AUTHORITY_DID;
  const nsids = [...(options.nsids ?? ALL_NSIDS)].sort();

  const storage = new MemoryBlockstore();
  const writes = nsids.map((nsid) => ({
    action: WriteOpAction.Create,
    collection: LEXICON_SCHEMA_COLLECTION,
    rkey: nsid,
    record: buildLexiconSchemaRecord(nsid) as unknown as Record<string, unknown>,
  })) as unknown as RecordCreateOp[];

  const rev = deterministicRev(did, nsids);
  const commit = await Repo.formatInitCommit(storage, did, options.keypair, writes, rev);
  await storage.applyCommit(commit);

  const repo = await Repo.load(storage, commit.cid);
  const recordCids: Record<string, string> = {};
  for await (const entry of repo.walkRecords()) {
    recordCids[entry.rkey] = entry.cid.toString();
  }

  const car = await blocksToCarFile(commit.cid, commit.newBlocks);

  return {
    car,
    did,
    commitCid: commit.cid.toString(),
    rev: commit.rev,
    recordCids,
    signingDidKey: options.keypair.did(),
  };
}

export interface ReadAuthorityRepoResult {
  did: string;
  commitCid: string;
  rev: string;
  /** NSID → { cid, record } read back out of the MST. */
  records: Record<string, { cid: string; record: LexiconSchemaRecord }>;
}

/** Parse a CAR produced by {@link buildAuthorityRepo} and read its records back. */
export async function readAuthorityRepo(car: Uint8Array): Promise<ReadAuthorityRepoResult> {
  const { root, blocks } = await readCarWithRoot(car);
  const storage = new MemoryBlockstore(blocks);
  const repo = await Repo.load(storage, root);
  const records: ReadAuthorityRepoResult["records"] = {};
  for await (const entry of repo.walkRecords()) {
    if (entry.collection !== LEXICON_SCHEMA_COLLECTION) {
      throw new Error(`Authority repo contains an unexpected collection: ${entry.collection}`);
    }
    records[entry.rkey] = {
      cid: entry.cid.toString(),
      record: entry.record as unknown as LexiconSchemaRecord,
    };
  }
  return {
    did: repo.did,
    commitCid: root.toString(),
    rev: repo.commit.rev,
    records,
  };
}

/**
 * Verify the CAR's root commit is signed by `signingDidKey` (a `did:key:...`
 * string) — the same check `@atproto/lex-resolver`'s `verifyRecordProof` runs.
 * Throws on failure.
 */
export async function verifyAuthorityRepoSig(car: Uint8Array, signingDidKey: string): Promise<void> {
  parseDidKey(signingDidKey); // throws if malformed
  const { root, blocks } = await readCarWithRoot(car);
  const storage = new MemoryBlockstore(blocks);
  const repo = await Repo.load(storage, root);
  const ok = await verifyCommitSig(repo.commit, signingDidKey);
  if (!ok) {
    throw new Error(`Authority repo commit ${root.toString()} is not signed by ${signingDidKey}`);
  }
}

/** `publicKeyMultibase` (Multikey) → `did:key:z...`, matching lex-resolver. */
export function multikeyToDidKey(publicKeyMultibase: string): string {
  const { jwtAlg, keyBytes } = parseMultikey(publicKeyMultibase);
  return formatDidKey(jwtAlg, keyBytes);
}
