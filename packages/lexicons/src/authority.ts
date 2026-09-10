/**
 * Lexicon authority manifest + schema-record builder for `fans.foryour.*`.
 *
 * This module makes the schemas in `packages/lexicons/lexicons/fans/foryour/**`
 * *resolvable* on the open AT network. AT Protocol Lexicon resolution
 * (https://atproto.com/specs/lexicon) is rooted in DNS control of the domain
 * authority: a resolver splits an NSID into `<name>` (last dot-segment) and
 * `<authority>` (the rest, reversed into a hostname), does a DNS TXT lookup on
 * `_lexicon.<authority>` for a `did=<did>` value, resolves that DID, and fetches
 * the schema record at `at://<did>/com.atproto.lexicon.schema/<full-NSID>`.
 *
 * Everything here is DERIVED from `NSID` in `./nsids.ts` — the single source of
 * truth. Adding an entry there must flow through to the authority set, the
 * required `_lexicon.*` TXT records, and the published schema records with no
 * other code edit (a mismatch fails a test — see `authority.test.ts` and
 * `authority.terraform.test.ts`).
 *
 * Design + protocol research: `docs/lexicon-authority.md`.
 *
 * This file is PURE and dependency-light on purpose: it is imported by the
 * `apps/web` served read surface. The signed-repo / CAR machinery (which pulls
 * in `@atproto/repo`) lives in `./authorityRepo.ts`, used only by the publish
 * tooling and tests.
 */
import { readFileSync } from "node:fs";
import { NSID } from "./nsids.js";

/** The atproto collection every Lexicon schema record lives in. [SPEC] */
export const LEXICON_SCHEMA_COLLECTION = "com.atproto.lexicon.schema";

/**
 * The DID that controls the `fans.foryour.*` Lexicon namespace.
 *
 * A compile-time constant, for the same reason `LEXICON_NAMESPACE` is (see
 * `./nsids.ts`): it must exactly match the `did=` value published in the
 * `_lexicon.*` DNS TXT records and the `id` of the served DID document.
 * Reading it from the environment would let the published authority drift from
 * the one the code builds records for.
 *
 * `did:web:foryour.fans` — DID document at
 * `https://foryour.fans/.well-known/did.json`, served by `apps/web`. No PLC
 * directory, no external custodian. See `docs/lexicon-authority.md` §2.
 *
 * Local integration tests point resolvers at a `did:web:localhost%3A<port>`
 * surface instead; that override is a test-only parameter, never this constant.
 */
export const LEXICON_AUTHORITY_DID = "did:web:foryour.fans";

/** Hostname `did:web:foryour.fans` resolves to (serves `/.well-known/did.json`). */
export const LEXICON_AUTHORITY_HOSTNAME = "foryour.fans";

// ---------------------------------------------------------------------------
// NSID validation (https://atproto.com/specs/nsid)
// ---------------------------------------------------------------------------

/**
 * The reference validation regex from the NSID spec, verbatim.
 * <https://atproto.com/specs/nsid>
 */
export const NSID_REFERENCE_REGEX =
  /^[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(\.[a-zA-Z]([a-zA-Z0-9]{0,62})?)$/;

export interface NsidValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate an NSID against the spec's regex AND its prose rules the regex alone
 * does not fully capture (overall length, per-segment length, ≥ 3 segments,
 * authority ≤ 253 chars, name segment is letters/digits with a non-digit
 * first char).
 */
export function validateNsid(nsid: string): NsidValidationResult {
  if (typeof nsid !== "string" || nsid.length === 0) {
    return { valid: false, reason: "empty" };
  }
  if (nsid.length > 317) {
    return { valid: false, reason: `too long (${nsid.length} > 317)` };
  }
  for (let i = 0; i < nsid.length; i++) {
    if (nsid.charCodeAt(i) > 0x7f) {
      return { valid: false, reason: "non-ASCII characters" };
    }
  }
  const segments = nsid.split(".");
  if (segments.length < 3) {
    return { valid: false, reason: `fewer than 3 segments (${segments.length})` };
  }
  const authority = segments.slice(0, -1).join(".");
  if (authority.length > 253) {
    return { valid: false, reason: `authority too long (${authority.length} > 253)` };
  }
  for (const seg of segments) {
    if (seg.length < 1 || seg.length > 63) {
      return { valid: false, reason: `segment "${seg}" length out of range 1..63` };
    }
  }
  const name = segments[segments.length - 1]!;
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
    return {
      valid: false,
      reason: `name segment "${name}" must be ASCII letters/digits with a non-digit first char (no hyphens)`,
    };
  }
  if (!NSID_REFERENCE_REGEX.test(nsid)) {
    return { valid: false, reason: "does not match the NSID reference regex" };
  }
  return { valid: true };
}

export function isValidNsid(nsid: string): boolean {
  return validateNsid(nsid).valid;
}

export function assertValidNsid(nsid: string): void {
  const result = validateNsid(nsid);
  if (!result.valid) {
    throw new Error(`Invalid NSID "${nsid}": ${result.reason}`);
  }
}

// ---------------------------------------------------------------------------
// Authority derivation
// ---------------------------------------------------------------------------

export interface LexiconAuthority {
  /** e.g. `foryour.fans`, `embed.foryour.fans` — the reversed domain authority. */
  authorityHostname: string;
  /** The DNS name a resolver does a TXT lookup on, e.g. `_lexicon.foryour.fans`. */
  txtRecordName: string;
  /** The NSIDs served by this authority, sorted. */
  nsids: string[];
}

/**
 * Split an NSID into its `name` (last segment) and `authority` (the rest,
 * reversed into a hostname). `fans.foryour.post` → `foryour.fans`;
 * `fans.foryour.embed.images` → `embed.foryour.fans`.
 */
export function authorityHostnameForNsid(nsid: string): string {
  assertValidNsid(nsid);
  const segments = nsid.split(".");
  return segments.slice(0, -1).reverse().join(".");
}

/**
 * Group a set of NSIDs by their domain authority. Resolution is NOT
 * hierarchical (the spec: resolvers do not recurse up/down the DNS tree), so
 * each distinct authority hostname needs its own `_lexicon.*` TXT record.
 */
export function deriveLexiconAuthorities(nsids: readonly string[]): LexiconAuthority[] {
  const byHostname = new Map<string, Set<string>>();
  for (const nsid of nsids) {
    const hostname = authorityHostnameForNsid(nsid);
    let set = byHostname.get(hostname);
    if (!set) {
      set = new Set();
      byHostname.set(hostname, set);
    }
    set.add(nsid);
  }
  return [...byHostname.entries()]
    .map(([authorityHostname, set]) => ({
      authorityHostname,
      txtRecordName: `_lexicon.${authorityHostname}`,
      nsids: [...set].sort(),
    }))
    .sort((a, b) => a.authorityHostname.localeCompare(b.authorityHostname));
}

/** Every NSID this application defines, from `NSID` in `./nsids.ts`. */
export const ALL_NSIDS: string[] = Object.values(NSID).slice().sort();

/**
 * The authority set for the current namespace. `foryour.fans` (six NSIDs) and
 * `embed.foryour.fans` (`fans.foryour.embed.images`).
 */
export const LEXICON_AUTHORITIES: LexiconAuthority[] = deriveLexiconAuthorities(ALL_NSIDS);

/** Just the `_lexicon.*` DNS names, e.g. for the Terraform sync test. */
export const LEXICON_TXT_RECORD_NAMES: string[] = LEXICON_AUTHORITIES.map((a) => a.txtRecordName);

/** The `did=<did>` value every `_lexicon.*` TXT record must carry. */
export const LEXICON_TXT_RECORD_VALUE = `did=${LEXICON_AUTHORITY_DID}`;

// ---------------------------------------------------------------------------
// Schema loading + record builder
// ---------------------------------------------------------------------------

/**
 * Relative path (under `packages/lexicons/lexicons/`) of the authored JSON for
 * an NSID. `fans.foryour.post` → `fans/foryour/post.json`;
 * `fans.foryour.embed.images` → `fans/foryour/embed/images.json`.
 */
export function schemaFilePathForNsid(nsid: string): string {
  assertValidNsid(nsid);
  return `${nsid.split(".").join("/")}.json`;
}

export interface LexiconDocument {
  lexicon: 1;
  id: string;
  description?: string;
  defs: Record<string, unknown>;
}

/**
 * Load the authored lexicon JSON for an NSID — the same file `lex build`
 * compiles and the app validates records against. Not the generated TypeScript.
 */
export function loadCompiledSchema(nsid: string): LexiconDocument {
  const rel = schemaFilePathForNsid(nsid);
  const url = new URL(`../lexicons/${rel}`, import.meta.url);
  let raw: string;
  try {
    raw = readFileSync(url, "utf8");
  } catch (cause) {
    throw new Error(`No lexicon JSON for NSID "${nsid}" at lexicons/${rel}`, { cause });
  }
  const doc = JSON.parse(raw) as LexiconDocument;
  if (doc.lexicon !== 1) {
    throw new Error(`lexicons/${rel}: expected "lexicon": 1, got ${JSON.stringify(doc.lexicon)}`);
  }
  if (doc.id !== nsid) {
    throw new Error(`lexicons/${rel}: "id" is ${JSON.stringify(doc.id)}, expected ${JSON.stringify(nsid)}`);
  }
  if (typeof doc.defs !== "object" || doc.defs === null) {
    throw new Error(`lexicons/${rel}: missing "defs" object`);
  }
  return doc;
}

/**
 * A `com.atproto.lexicon.schema` record body. Its shape is the Lexicon document
 * itself with `$type` added; `id` equals the record key (the full NSID).
 * <https://atproto.com/specs/lexicon>
 */
export interface LexiconSchemaRecord {
  $type: "com.atproto.lexicon.schema";
  lexicon: 1;
  id: string;
  description?: string;
  defs: Record<string, unknown>;
}

/**
 * Build the exact record body to publish for an NSID. This is the single
 * builder reused by the publish path (`scripts/authority.ts`) and the served
 * read path (`apps/web`), so a schema can never be published that differs from
 * the one this repo enforces locally (Non-negotiable Rule 2).
 */
export function buildLexiconSchemaRecord(nsid: string): LexiconSchemaRecord {
  const doc = loadCompiledSchema(nsid);
  const record: LexiconSchemaRecord = {
    $type: "com.atproto.lexicon.schema",
    lexicon: 1,
    id: nsid,
    defs: doc.defs,
  };
  if (typeof doc.description === "string") {
    // Preserve source key order: $type, lexicon, id, description, defs.
    return {
      $type: record.$type,
      lexicon: record.lexicon,
      id: record.id,
      description: doc.description,
      defs: doc.defs,
    };
  }
  return record;
}

/** `{ [nsid]: record }` for every NSID in `NSID`, keyed and iterable in sorted order. */
export function buildAllLexiconSchemaRecords(): Record<string, LexiconSchemaRecord> {
  const out: Record<string, LexiconSchemaRecord> = {};
  for (const nsid of ALL_NSIDS) {
    out[nsid] = buildLexiconSchemaRecord(nsid);
  }
  return out;
}

/** The AT URI a resolver fetches an NSID's schema record from. */
export function schemaRecordUri(nsid: string, did: string = LEXICON_AUTHORITY_DID): string {
  return `at://${did}/${LEXICON_SCHEMA_COLLECTION}/${nsid}`;
}

// The published artifact (DID document + signed schema-repo CAR + manifest),
// generated by `authority regen` and committed. Re-exported here so the
// `@foryour-fans/lexicons/authority` subpath — which `apps/web`'s served read
// surface imports — carries everything it needs with no `@atproto/repo`
// dependency. See docs/lexicon-authority.md §3.
export {
  AUTHORITY_CAR,
  AUTHORITY_DID_DOCUMENT,
  AUTHORITY_MANIFEST,
  AUTHORITY_RECORDS,
} from "./authorityArtifact.generated.js";
