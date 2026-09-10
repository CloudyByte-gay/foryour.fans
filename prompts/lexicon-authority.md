# INFRASTRUCTURE PHASE — Lexicon Authority for `fans.foryour.*`

Runs as its own self-contained session, with the same discipline as a numbered
phase (tests green, exit checklist, `Stop after` line). It has no ordering
dependency on the creator-owned-PDS / Bluesky-public-posts rearchitecture work —
it can run before or after — because it changes nothing about how records are
*written*; it makes the schemas those records validate against *resolvable* by
anyone on the open AT network.

Companion files: [`prompts/full.md`](./full.md) ("Hosting model" — this app
runs no PDS), [`prompts/creator-owned-pds.md`](./creator-owned-pds.md) and
[`prompts/bluesky-public-posts.md`](./bluesky-public-posts.md) (the lexicons
whose authority this establishes), [`prompts/handle-identity.md`](./handle-identity.md)
(the `_atproto` DNS precedent this mirrors),
[`docs/architecture.md`](../docs/architecture.md),
[`docs/atproto-vs-database.md`](../docs/atproto-vs-database.md).

Normative references — read both in full before implementing:

- AT Protocol NSID spec: <https://atproto.com/specs/nsid>
- AT Protocol Lexicon spec, "Lexicon resolution" section:
  <https://atproto.com/specs/lexicon>

## Why

`packages/lexicons` defines this application's namespace —
`packages/lexicons/src/nsids.ts` is the single source of truth for the NSIDs,
and `packages/lexicons/lexicons/fans/foryour/**/*.json` are the schemas. Today
those schemas exist **only inside this repo**. Nothing on the open network can
take `fans.foryour.post`, discover who defines it, and fetch the definition.

That is a real gap for a project whose entire premise is portability: the
creator-owned-PDS and Bluesky-public-posts specs promise that "another
compatible fan-service app can discover the creator's records and reconstruct
the creator-facing surface" — but a second app cannot *validate* those records
against `fans.foryour.*` without a copy of our schemas that it trusts came from
us. AT Protocol already specifies the mechanism for this: **Lexicon
resolution**, rooted in DNS control of the domain authority. This phase makes
`foryour.fans` the resolvable, verifiable authority for the `fans.foryour.*`
namespace.

## Background: how Lexicon resolution works (from the specs)

An NSID is `<domain-authority-reversed>.<name>` — the **name** is the *last*
dot-segment, the **authority** is everything before it, reversed back into a
hostname. A resolver, given an NSID:

1. Splits off the final segment (the name); reverses the rest to get the
   authority hostname. `fans.foryour.post` → authority `foryour.fans`.
2. Does a **DNS TXT lookup on `_lexicon.<authority-hostname>`**. The record
   value is `did=<did>` (same shape as handle resolution's `_atproto`
   record, different subdomain).
3. Resolves that **DID** to its atproto service endpoint (the
   `#atproto_pds` service in the DID document).
4. Fetches the schema record at
   `at://<did>/com.atproto.lexicon.schema/<full-NSID>` — i.e. collection
   `com.atproto.lexicon.schema`, **record key = the full NSID string**.

Resolution is **not hierarchical**: a resolver does not fall back to a parent
domain if `_lexicon.<authority>` has no record. Each distinct authority needs
its own TXT record.

The published record is a `com.atproto.lexicon.schema` record whose body is the
Lexicon document itself: `{ "$type": "com.atproto.lexicon.schema", "lexicon":
1, "id": "<NSID>", "defs": { ... } }`, with `id` **equal to** the record key.

### Our namespace has TWO authorities

Derive the authority set from `NSID` in `packages/lexicons/src/nsids.ts`; do not
hardcode a list that can drift. For the current set:

| NSID | name segment | authority (reversed) | TXT record name |
| --- | --- | --- | --- |
| `fans.foryour.profile` | `profile` | `foryour.fans` | `_lexicon.foryour.fans` |
| `fans.foryour.post` | `post` | `foryour.fans` | `_lexicon.foryour.fans` |
| `fans.foryour.tier` | `tier` | `foryour.fans` | `_lexicon.foryour.fans` |
| `fans.foryour.media` | `media` | `foryour.fans` | `_lexicon.foryour.fans` |
| `fans.foryour.accessPolicy` | `accessPolicy` | `foryour.fans` | `_lexicon.foryour.fans` |
| `fans.foryour.serviceConfig` | `serviceConfig` | `foryour.fans` | `_lexicon.foryour.fans` |
| `fans.foryour.embed.images` | `images` | `embed.foryour.fans` | `_lexicon.embed.foryour.fans` |

`fans.foryour.embed.images` has a nested authority (`fans.foryour.embed` →
`embed.foryour.fans`) because the **name** is only the last segment. It
therefore needs its **own** `_lexicon.embed.foryour.fans` TXT record. Both TXT
records may point at the **same DID**, and all seven schema records may live in
the **same repo** — the spec only *requires* co-location for NSIDs that differ
solely in the final name segment, but permits one repo to serve many
authorities. Use one DID and one repo for all seven.

If a future NSID adds another nesting level (e.g. `fans.foryour.embed.video`
would still be authority `embed.foryour.fans`, but `fans.foryour.chat.message`
would be `chat.foryour.fans`), the authority set — and the set of required TXT
records — must expand automatically from `nsids.ts`. Make that a test, not a
convention (see Tests).

## Required Research Before Implementation

Before changing code or infrastructure, research and write
`docs/lexicon-authority.md`. It must resolve these questions with concrete
source links and mark every assumption not guaranteed by the protocol today:

1. **DID method for the authority.** Compare:
   - `did:web:foryour.fans` — DID document served at
     `https://foryour.fans/.well-known/did.json`, no PLC directory, no external
     custody, versioned in this repo. Requires us to serve the atproto read
     XRPC the resolver calls in step 4.
   - A dedicated `did:plc:*` created for the authority, backed by a real atproto
     repo on a real PDS (`bsky.social` or self-hosted), records published with
     `@atproto/api` / `goat` / `lex`. Simplest read path (a real PDS answers
     `com.atproto.repo.getRecord`), but re-introduces an external custodian for
     data the rest of the architecture works hard to self-own.
   Recommendation to validate, not assume: **`did:web:foryour.fans`**, with this
   app serving a minimal read-only lexicon-schema XRPC surface (below). Confirm
   real third-party resolvers accept it.
2. **What the resolver actually calls in step 4.** Determine the exact request
   real resolvers make against the DID's `#atproto_pds` endpoint — collection,
   rkey encoding (the NSID contains dots; confirm it is used verbatim as the
   rkey and how it is percent-encoded in the query string), and whether any of
   `com.atproto.repo.getRecord`, `com.atproto.repo.listRecords`,
   `com.atproto.repo.describeRepo`, or `com.atproto.sync.getRecord` are
   required vs. optional. Test against at least: `@atproto/lex-cli` (or the
   current `@atproto/lexicon` resolver), and one independent implementation
   (e.g. `goat lex resolve`, or a community resolver) — cite versions.
3. **Whether a `did:web` served surface must return a signed commit / MST proof**
   or whether a plain `getRecord` JSON response is accepted for lexicon
   resolution specifically. If a verifiable proof is required, that likely
   forces the `did:plc` + real-repo path; document that finding.
4. **Key custody for the DID.** For `did:web`, the DID document lists a
   verification method; where does its key live, who can rotate it, and what
   breaks if it is lost? For `did:plc`, where do the rotation keys live and how
   is recovery handled? This authority is a long-lived trust root — treat key
   loss as a documented disaster-recovery scenario, not an afterthought.
5. **DNS management.** `infrastructure/gcp/terraform` manages no DNS zone today.
   Determine where `foryour.fans` DNS actually lives (registrar / Cloudflare /
   Cloud DNS) and whether we can manage `_lexicon.*` records as code. If yes,
   add them to Terraform. If no, the deliverable is a documented manual runbook
   plus a verification script — do not leave it undefined.
6. **Cache / rotation semantics.** The spec warns resolvers not to cache DNS
   results for long, because a changed TXT record silently redirects schema
   resolution to a different repo. Decide our TTL for `_lexicon.*` records and
   document the rotation procedure (change TXT → old repo still answers for a
   grace period → cut over), including how we would migrate the authority to a
   new DID without breaking in-flight resolvers.
7. **Relationship to `_atproto`.** `_lexicon.foryour.fans` (Lexicon authority)
   and `_atproto.foryour.fans` (handle resolution, if `foryour.fans` is ever
   also used as a handle) are independent records with independent meaning.
   Confirm nothing in this phase touches or depends on handle resolution.

`docs/lexicon-authority.md` must be committed before implementation starts.

## Non-negotiable Rules

1. **`nsids.ts` stays the single source of truth.** The authority set, the list
   of `_lexicon.*` TXT records, and the set of published schema records are all
   *derived* from `NSID` in `packages/lexicons/src/nsids.ts`. A new entry there
   must flow through to publishing and to the DNS record set with no other code
   edit, and a mismatch must fail a test.
2. **Published schema === compiled schema.** The `com.atproto.lexicon.schema`
   record body for an NSID must be byte-for-byte the schema this repo compiles
   and validates against (`packages/lexicons/lexicons/fans/foryour/**`, with
   `$type` added and `id` asserted equal to the NSID). Publishing must never be
   able to put a schema on the network that differs from the one the app
   enforces locally. A drift check must fail CI.
3. **One DID, one repo, all seven NSIDs.** Both `_lexicon.foryour.fans` and
   `_lexicon.embed.foryour.fans` point at the same DID; that DID's repo holds
   every `fans.foryour.*` schema record.
4. **The authority is read-only and public.** The served surface exposes only
   schema records. It must not expose, proxy, or authenticate anything else. No
   creator data, no app state.
5. **Schema evolution follows the Lexicon back-compat rules.** Once a
   `fans.foryour.*` schema is published (and especially once a third party could
   have adopted it), changes must be backward compatible: new fields optional,
   no field removed, no type/name change on an existing field. A breaking change
   requires a **new NSID**, not an edit. Add a guard test (below).
6. **`com.atproto.*` and `app.bsky.*` are not ours to publish.** This phase
   establishes authority for `fans.foryour.*` only. The vendored
   `packages/lexicons/vendor/app/bsky/**` files are unchanged and unpublished —
   Bluesky is their authority.
7. **Do not overclaim.** `docs/*` and any UI copy must describe what resolution
   actually guarantees (schema provenance via DNS control) and what it does not
   (it is not a signature on records, not a version lock, and a DNS compromise
   moves the authority).

## Target Architecture

### `packages/lexicons` — authority manifest + record builder

- Add a derived export (e.g. `LEXICON_AUTHORITIES`) computing, from `NSID`, the
  set of `{ authorityHostname, txtRecordName, nsids: string[] }`. Pure, tested,
  no I/O.
- Add a builder that, for each NSID, loads its compiled schema JSON and returns
  the exact `com.atproto.lexicon.schema` record body (`$type`, `lexicon: 1`,
  `id` === NSID asserted, `defs`). Reused by both the publish path and the
  served read path so they cannot diverge.
- Export the chosen authority **DID** as a constant here too (same reasoning as
  the `nsids.ts` doc comment: a compile-time constant, not a runtime env read),
  or document why it must be config.

### The served read surface (if `did:web`)

Decide placement in `docs/lexicon-authority.md`: a minimal route group in
`apps/api`, or a tiny standalone worker/function. It must serve:

- `GET /.well-known/did.json` — the `did:web:foryour.fans` document, listing the
  `#atproto_pds` service endpoint pointing back at this surface.
- Whatever XRPC the research pass in step 2/3 proves is required — at minimum
  `com.atproto.repo.getRecord` for `collection=com.atproto.lexicon.schema`,
  returning the record body from the shared builder; likely also
  `com.atproto.repo.listRecords` and `com.atproto.repo.describeRepo`.
- Correct `uri`/`cid` fields in responses if resolvers check them (compute the
  CID over the record the same way atproto does; research the exact codec/hash).
- Sensible `Cache-Control` (short), CORS `*` (public schemas), and a `404` in
  the atproto error shape for unknown rkeys.

No write endpoints. No auth.

### DNS

- `_lexicon.foryour.fans` TXT `did=<authority-did>`
- `_lexicon.embed.foryour.fans` TXT `did=<authority-did>`
- Managed in `infrastructure/gcp/terraform` (new `dns.tf` or equivalent) if the
  zone is manageable as code; otherwise a runbook in `docs/lexicon-authority.md`
  plus the verification script below. Low TTL per the research decision.

### Publish / verify tooling

- A script (e.g. `packages/lexicons` `scripts/publish-authority.ts` or an
  `apps/api` script alongside the existing `apps/api/src/scripts`) that:
  - `--check` (default in CI): resolves every `fans.foryour.*` NSID **over the
    real network** the way an external client would, and asserts the resolved
    schema deep-equals the locally compiled one. Non-zero exit on any drift,
    missing record, or missing/incorrect TXT record.
  - `--publish` (operator-run, `did:plc` path only): writes/updates the
    `com.atproto.lexicon.schema` records into the authority repo.
  - `--dry-run`: prints the record set and the required TXT records.
- Wire `--check` into CI (see below).

## Tests

Add tests that prove:

- **Authority derivation.** `LEXICON_AUTHORITIES` computed from a fixture NSID
  set yields the right authority hostnames and `_lexicon.*` names, including the
  nested `embed.foryour.fans` case and a hypothetical deeper/sibling nesting.
- **Round-trip fidelity.** For every NSID in `NSID`, the record body from the
  builder has `$type === "com.atproto.lexicon.schema"`, `id === <that NSID>`,
  and `defs` deep-equal to the compiled schema's `defs`.
- **NSID validity.** Every NSID in `NSID` matches the NSID spec's reference
  regex and segment rules (ASCII, segment lengths, name segment is a valid
  token, ≤ 317 chars). This catches a malformed namespace addition early.
- **No drift guard.** A test that fails if the set of schema files under
  `lexicons/fans/foryour/**` and the set of keys in `NSID` disagree.
- **Back-compat guard.** Check the current compiled schemas against a committed
  golden snapshot of the *published* shapes (`test/__snapshots__` or a checked-in
  JSON). Removing a field, renaming one, changing a type, or making an optional
  field required fails the test with a message pointing at rule 5 (breaking
  change ⇒ new NSID). Adding an optional field updates the snapshot cleanly.
- **Served surface** (if built): `GET /.well-known/did.json` shape;
  `getRecord` returns the right body for a known NSID and an atproto-shaped
  `404` for an unknown rkey; unknown collection is rejected.
- **Network resolution integration test** (may be `describe.skipIf(offline)`):
  using a real resolver library, resolve `fans.foryour.post` end to end and
  assert it equals the local schema. This is the Phase-2/Phase-8 analogue —
  the one check that talks to the genuinely external thing (DNS + the served
  surface) rather than a fake.

## Documentation Updates

- `docs/lexicon-authority.md` — the research + design doc (created above); keep
  it current with what was actually built.
- `docs/architecture.md` — a section on the Lexicon authority: the two TXT
  records, the DID, the served surface, how it relates to (and is independent
  of) handle resolution, and the rotation/DR procedure.
- `docs/atproto-vs-database.md` — note that `fans.foryour.*` schemas are now
  network-resolvable, so third-party apps can validate our records.
- `packages/lexicons/src/nsids.ts` doc comment — point at the authority
  manifest and note that adding an NSID now also means publishing its schema
  record and (for a new authority) a new `_lexicon.*` TXT record.
- `packages/lexicons/vendor/SOURCES.md` — a line clarifying that vendored
  `app.bsky.*` schemas are **not** part of our authority.
- `README.md` — one line under the AT Protocol section that our lexicons resolve
  from `foryour.fans`.
- `docs/build-plan.md` — record this phase.

## Exit Checklist

Before marking this phase complete:

1. `pnpm build`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `docs/lexicon-authority.md` committed, with source links and marked
   assumptions.
6. `_lexicon.foryour.fans` and `_lexicon.embed.foryour.fans` TXT records exist
   (in Terraform, or in a runbook that has been executed), each
   `did=<authority-did>`.
7. The authority DID resolves to a document advertising the served surface.
8. All seven `fans.foryour.*` schema records are fetchable at
   `at://<did>/com.atproto.lexicon.schema/<nsid>` and deep-equal the compiled
   schemas.
9. The `--check` script passes against the real network and is wired into CI.
10. A real third-party resolver library resolves at least `fans.foryour.post`
    and `fans.foryour.embed.images` end to end.
11. The back-compat guard test is in place and green.
12. Docs state plainly what resolution does and does not guarantee.

**Stop after the authority is resolvable end to end from a third-party resolver
and the `--check` script + back-compat guard are green in CI. Do not begin
using resolution results to gate or transform runtime behavior (e.g. fetching
remote schemas at record-write time) — that is a separate follow-up.**
