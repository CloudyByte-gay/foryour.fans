import { z } from "zod";

/**
 * Jetstream's wire format — verified against REAL live bytes from the
 * production endpoint (`wss://jetstream.us-east.bsky.network/subscribe`),
 * not just documentation. This matters: initial research (fetching
 * bsky.network's docs) described a different-looking "v2" envelope
 * (`{ $type: "message", payload: { $type: "...#commit", ... } }`) as
 * "recommended for new projects" — but connecting to the real endpoint
 * and inspecting actual messages showed it still serves the flat v1
 * shape below. The parser is built against what the live server actually
 * sends, confirmed by directly connecting to it (see the verification
 * transcript in docs/architecture.md's Phase 10 section) — exactly the
 * kind of gap prompts/full.md's "research current recommended AT
 * Protocol mechanisms before implementing" instruction exists to catch.
 *
 * A commit event:
 *   { did, time_us, cursor, kind: "commit",
 *     commit: { rev, operation: "create"|"update"|"delete", collection,
 *               rkey, record?, cid? } }
 * `record`/`cid` are present on create/update, absent on delete. Jetstream
 * also emits `kind: "identity"`/`"account"` events (not "commit") — see
 * packages/discovery/src/ingestor.ts's doc comment for why this project
 * doesn't subscribe to those this phase; `parseJetstreamMessage` returns
 * `null` for them rather than erroring, same as any other message shape
 * it doesn't recognize.
 */
const commitDetailsSchema = z.object({
  rev: z.string().optional(),
  operation: z.enum(["create", "update", "delete"]),
  collection: z.string(),
  rkey: z.string(),
  cid: z.string().optional(),
  record: z.record(z.unknown()).optional(),
});

const commitMessageSchema = z.object({
  kind: z.literal("commit"),
  did: z.string(),
  time_us: z.number(),
  commit: commitDetailsSchema,
});

export interface CommitEvent {
  did: string;
  /** Unix microseconds — the portable, cross-instance Jetstream resume cursor (see ingestor.ts). */
  timeUs: number;
  operation: "create" | "update" | "delete";
  collection: string;
  rkey: string;
  cid?: string;
  record?: Record<string, unknown>;
}

/**
 * Parses one raw Jetstream WebSocket message. Returns `null` — never
 * throws — for anything that isn't a well-formed commit event: malformed
 * JSON, an `identity`/`account` message (not handled this phase), or a
 * commit missing a field this parser requires. Ingestion is best-effort
 * by design — one unparseable/unexpected message must never take the
 * whole stream down.
 */
export function parseJetstreamMessage(raw: string): CommitEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = commitMessageSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }

  const { did, time_us, commit } = result.data;
  return {
    did,
    timeUs: time_us,
    operation: commit.operation,
    collection: commit.collection,
    rkey: commit.rkey,
    cid: commit.cid,
    record: commit.record,
  };
}
