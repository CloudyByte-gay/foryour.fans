# Lexicon Authority for `fans.foryour.*` — Research & Design

This is the "Required Research Before Implementation" output of
[`prompts/lexicon-authority.md`](../prompts/lexicon-authority.md). It records
what AT Protocol Lexicon resolution actually requires today — verified against
the reference resolver's source, not assumed — and the design decisions that
follow.

Every claim is tagged:

- **[SPEC]** — stated in an atproto specification.
- **[CODE]** — read directly from a pinned reference implementation in this
  repo's `node_modules` (version cited).
- **[OBSERVED]** — checked against live DNS / a running server during research.
- **[ASSUMPTION]** — not guaranteed by the protocol today; a risk to accept
  explicitly. Re-verify before it becomes load-bearing.

Research date: 2026-09-09. Normative references:

- NSID spec: <https://atproto.com/specs/nsid>
- Lexicon spec, "Lexicon resolution": <https://atproto.com/specs/lexicon>
- Reference resolver: `@atproto/lex-resolver@0.2.10`
  (`node_modules/.pnpm/@atproto+lex-resolver@0.2.10/.../dist/lex-resolver.js`),
  reached transitively through `@atproto/lex@0.3.8` (`lex install`).

---

## 0. TL;DR / decisions

| Question | Decision |
|---|---|
| DID method | **`did:web:foryour.fans`** — DID document at `https://foryour.fans/.well-known/did.json`, versioned in this repo, no PLC directory, no external custodian. |
| Served surface | A minimal **read-only, signed atproto repo** served by **`apps/web`** (Next route handlers), because `did:web:foryour.fans` resolves to that origin. It exposes only the `com.atproto.lexicon.schema` collection. |
| Does the resolver need a cryptographic proof? | **Yes.** [CODE] The reference resolver calls `com.atproto.sync.getRecord` and verifies a signed commit + MST proof. A plain `com.atproto.repo.getRecord` JSON body is **not** accepted. This is the single biggest finding and it shaped everything below. |
| Signing key custody | A dedicated secp256k1 keypair. Public half in `did.json` as a `Multikey` verification method `#atproto`. Private half in the secret store (`LEXICON_AUTHORITY_SIGNING_KEY`), touched only by the publish job. |
| DNS | `_lexicon.foryour.fans` and `_lexicon.embed.foryour.fans` TXT `did=did:web:foryour.fans`, managed in `infrastructure/gcp/terraform` (Cloudflare, same zone as the web domain). TTL 300s. |
| Repo generation | Deterministic. The publish tooling builds the commit + MST + CAR offline from the compiled schemas and the signing key; the result is committed as a static artifact and a drift test fails CI if it diverges from the schemas. |
| Relationship to handle resolution | Independent. `_lexicon.*` and `_atproto.*` are different records with different meanings. This phase touches neither handle resolution nor any per-creator DID. |

**What resolution does and does not guarantee** (this wording is mirrored in
`docs/architecture.md`, `README.md`, and any UI copy):

- **Does:** prove that whoever controls DNS for `foryour.fans` published these
  exact schema definitions, and that a resolver fetched them unmodified (commit
  signature + MST proof).
- **Does not:** sign individual *creator* records (`fans.foryour.post` etc. on
  creators' own PDSes are validated against the schema, not signed by us); lock
  a schema version (a resolver always gets whatever the authority repo holds
  *now*); or survive a DNS compromise (an attacker who controls
  `_lexicon.foryour.fans` can point the namespace at their own repo — the
  mitigation is DNS security, monitoring, and a short TTL, not cryptography).

---

## 1. How Lexicon resolution works — verified against the reference resolver

### 1.1 Authority derivation [SPEC]

An NSID is `<domain-authority-reversed>.<name>`. The **name** is the *last*
dot-segment; the **authority** is everything before it, reversed into a
hostname.

| NSID | name | authority | TXT record |
|---|---|---|---|
| `fans.foryour.profile` | `profile` | `foryour.fans` | `_lexicon.foryour.fans` |
| `fans.foryour.post` | `post` | `foryour.fans` | `_lexicon.foryour.fans` |
| `fans.foryour.tier` | `tier` | `foryour.fans` | `_lexicon.foryour.fans` |
| `fans.foryour.media` | `media` | `foryour.fans` | `_lexicon.foryour.fans` |
| `fans.foryour.accessPolicy` | `accessPolicy` | `foryour.fans` | `_lexicon.foryour.fans` |
| `fans.foryour.serviceConfig` | `serviceConfig` | `foryour.fans` | `_lexicon.foryour.fans` |
| `fans.foryour.embed.images` | `images` | `embed.foryour.fans` | `_lexicon.embed.foryour.fans` |

`fans.foryour.embed.images` has a **nested authority** because only the last
segment is the name. It needs its own `_lexicon.embed.foryour.fans` TXT record.
Both records may point at the same DID and one repo may serve both authorities
— the spec only *requires* co-location for NSIDs differing solely in the final
segment.

The authority set is derived in code from `NSID` in
[`packages/lexicons/src/nsids.ts`](../packages/lexicons/src/nsids.ts) — see
`deriveLexiconAuthorities()` in
[`packages/lexicons/src/authority.ts`](../packages/lexicons/src/authority.ts).
A test (`authority.test.ts`) proves a future deeper/sibling nesting
(`fans.foryour.chat.message` → `chat.foryour.fans`) expands the required TXT-
record set automatically.

### 1.2 Resolution is not hierarchical [SPEC]

> "resolvers should not recurse up or down the DNS hierarchy looking for TXT
> records."

Each distinct authority needs its own record. There is no fallback from
`_lexicon.embed.foryour.fans` to `_lexicon.foryour.fans`.

### 1.3 What the resolver actually calls — `@atproto/lex-resolver@0.2.10` [CODE]

`LexResolver.get(nsid)` = `resolve(nsid)` then `fetch(uri)`:

**`resolve(nsid)`**
1. `NSID.from(nsid)` → `nsid.authority`.
2. `resolveTxt("_lexicon." + nsid.authority)` (Node `dns/promises`), keep lines
   starting `did=`, require **exactly one**, `assertDid` it.
3. Return `AtUri.make(did, "com.atproto.lexicon.schema", nsid.toString())` —
   i.e. collection `com.atproto.lexicon.schema`, **rkey = the full NSID string,
   verbatim, dots and all**.

**`fetch(uri)`**
1. Resolve the DID document (`@atproto-labs/did-resolver`), then
   `extractAtprotoData` (`@atproto/did@0.5.4`), which requires:
   - a **service** `{ type: "AtprotoPersonalDataServer", id ends "#atproto_pds",
     serviceEndpoint: <url> }`, and
   - a **verificationMethod** `{ id ends "#atproto", type one of
     `Multikey` / `EcdsaSecp256k1VerificationKey2019` /
     `EcdsaSecp256r1VerificationKey2019`, publicKeyMultibase: <string> }`.
   Missing either → `LexResolverError`.
2. `xrpc(agent, com.atproto.sync.getRecord, { params: { did, collection:
   "com.atproto.lexicon.schema", rkey: nsid } })` against `serviceEndpoint`.
   **This returns a CAR file**, not JSON.
3. `verifyRecordProof(car, did, key, collection, rkey)`:
   - `readCarWithRoot`, load the **commit** object at the root,
   - assert `commit.did === did`,
   - `verifyCommitSig(commit, signingKey)` — **must pass**,
   - `MST.load(blockstore, commit.data)`, `mst.get("com.atproto.lexicon.schema/" + rkey)`,
   - read that record block, assert `record.$type === "com.atproto.lexicon.schema"`.
4. Validate the record against `lexiconDocumentSchema` (`@atproto/lex-document`),
   assert `lexicon.id === uri.rkey`.

There is **no code path** that accepts an unsigned response and **no fallback**
to `com.atproto.repo.getRecord`.

> rkey encoding [CODE][OBSERVED]: `nsid.toString()` is used verbatim as the
> rkey. `@atproto/lex-client`'s `xrpc` builds the query string with
> `URLSearchParams`, so `rkey=fans.foryour.post` is sent literally (`.` is not
> percent-encoded by `URLSearchParams`; even if a client encodes it, `%2E`
> decodes back). Record keys permit `.` (`@atproto/syntax` `ensureValidRecordKey`
> allows `A-Za-z0-9._:~-`), so `fans.foryour.post` is a valid rkey.

### 1.4 Independent implementations

- **`@atproto/lex` `lex install` [CODE]** — uses exactly the resolver above
  (via `@atproto/lex-installer@0.1.17` → `@atproto/lex-resolver`).
- **`goat lex resolve`** (Bluesky's Go CLI) — **[ASSUMPTION]** believed to
  perform the same DNS→DID→`sync.getRecord`→proof flow; not executed in this
  environment (no Go toolchain). The exit checklist's third-party check runs
  `lex install` against the deployed authority; a `goat` run is a manual
  follow-up noted in the runbook (§7).
- **Classic `@atproto/lexicon@0.7.12`** — validation library only (`Lexicons`
  class). No network resolution. Not relevant here.

### 1.5 Schema record shape [SPEC]

```json
{
  "$type": "com.atproto.lexicon.schema",
  "lexicon": 1,
  "id": "<the full NSID, === the rkey>",
  "defs": { "...": "the lexicon's defs, verbatim" },
  "description": "<optional, carried through if the source lexicon has one>"
}
```

`buildLexiconSchemaRecord(nsid)` in `packages/lexicons/src/authority.ts` builds
this from the committed source JSON
(`packages/lexicons/lexicons/fans/foryour/**`), adds `$type`, asserts
`id === nsid`, and is the single builder reused by the publish path and the
served read path so they cannot diverge (Non-negotiable Rule 2).

---

## 2. DID method — `did:web:foryour.fans`

### 2.1 Options considered

| | `did:web:foryour.fans` | dedicated `did:plc:*` + real repo |
|---|---|---|
| DID document | Served by us at `/.well-known/did.json`, versioned in-repo | In the PLC directory, mutated via signed PLC operations |
| Repo host | Us (`apps/web` route handlers) | `bsky.social` or a self-hosted PDS |
| External custodian | **None** | PLC directory + the repo host |
| Key rotation | Edit `did.json`, redeploy | Signed PLC operation with the rotation key |
| Key-loss recovery | Generate a new key, edit `did.json`, redeploy; TXT records unchanged | Needs a surviving PLC rotation key, or the DID is unrecoverable |
| Conformance | Requires us to serve `com.atproto.sync.getRecord` with a valid proof | A real PDS already does this |
| Fit with the rest of the architecture | High — the project self-owns everything else | Low — re-introduces exactly the custodians the creator-owned-PDS work removes |

### 2.2 Decision: `did:web:foryour.fans`

Chosen for custodian independence and simple disaster recovery. The cost — we
must serve a cryptographically verifiable read surface — is bounded because the
"repo" is **static and tiny**: 7 records in one collection, changing only when a
schema changes. The commit + MST + CAR are generated offline at publish time
(§4), not by a live PDS.

`did:web` constraints honoured [CODE] (`@atproto/did` `assertAtprotoDidWeb`):
no path component (`did:web:foryour.fans`, not `did:web:foryour.fans:lexicon`),
no port outside localhost. Local integration tests use
`did:web:localhost%3A<port>`, which the same code explicitly allows.

### 2.3 The DID document

`GET https://foryour.fans/.well-known/did.json`:

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/multikey/v1",
    "https://w3id.org/security/suites/secp256k1-2019/v1"
  ],
  "id": "did:web:foryour.fans",
  "verificationMethod": [
    {
      "id": "did:web:foryour.fans#atproto",
      "type": "Multikey",
      "controller": "did:web:foryour.fans",
      "publicKeyMultibase": "z<base58btc-multicodec-compressed-secp256k1-pubkey>"
    }
  ],
  "service": [
    {
      "id": "#atproto_pds",
      "type": "AtprotoPersonalDataServer",
      "serviceEndpoint": "https://foryour.fans"
    }
  ]
}
```

`serviceEndpoint` points back at the same origin; the sync XRPC lives under
`https://foryour.fans/xrpc/...`. There is no `alsoKnownAs` — this DID is not a
handle and must never be treated as one.

---

## 3. The served read surface

### 3.1 Placement — `apps/web`, not `apps/api`

`did:web:foryour.fans` resolves to `https://foryour.fans`, which is the **web
app** (Cloud Run `web` service, `var.domain` in `infrastructure/gcp/terraform/dns.tf`).
The API is a separate origin. Three placements were possible:

1. **Next route handlers in `apps/web`** — chosen. The content is fully static
   (7 schemas + one CAR), needs no database, no session, no Redis. Route
   handlers import the shared builder from `@foryour-fans/lexicons` and read one
   committed CAR artifact. Zero coupling to app state (Non-negotiable Rule 4).
2. apps/api route group + a `next.config.mjs` rewrite — rejected: Next rewrites
   are build-time (see `next.config.mjs`'s own comment), and this couples the
   trust root to the application API.
3. A standalone worker — rejected: another deploy unit for ~4 static routes.

### 3.2 Routes (all under `apps/web/app/`)

| Route | Purpose |
|---|---|
| `GET /.well-known/did.json` | The DID document above. `Cache-Control: public, max-age=300`. |
| `GET /xrpc/com.atproto.sync.getRecord` | `?did=&collection=com.atproto.lexicon.schema&rkey=<nsid>` → the CAR (`application/vnd.ipld.car`). Serves the whole authority CAR for any known rkey (it is only a few KB and `verifyRecordProof` MST-walks to the requested key). Unknown rkey → atproto error JSON `{"error":"RecordNotFound"}` 404. |
| `GET /xrpc/com.atproto.sync.getRepo` | `?did=` → the full authority CAR. |
| `GET /xrpc/com.atproto.sync.listRepos` | `{ repos: [{ did, head, rev }] }` — some crawlers probe this. |
| `GET /xrpc/com.atproto.repo.describeRepo` | `?repo=` → `{ did, handle: did, didDoc, collections: ["com.atproto.lexicon.schema"], handleIsCorrect: false }`. |
| `GET /xrpc/com.atproto.repo.getRecord` | `?repo=&collection=&rkey=` → plain JSON `{ uri, cid, value }` from the shared builder. **Not** used by `@atproto/lex-resolver`, provided for lenient/inspection clients (`goat`, manual `curl`). |
| `GET /xrpc/com.atproto.repo.listRecords` | `?repo=&collection=` → `{ records: [{ uri, cid, value }] }`, all 7. |

Common behaviour: `Access-Control-Allow-Origin: *` (public schemas, no
credentials ever), short `Cache-Control`, atproto-shaped error bodies
(`{"error":"InvalidRequest","message":"..."}`) with the right status, `405` on
non-GET. `repo`/`did` params must equal the authority DID (or its configured
local-test override) or → `400`. Unknown `collection` → `400`. No write
endpoints, no auth, no other collection.

### 3.3 `cid` fields

`buildLexiconSchemaRecord` output is hashed with `@atproto/lex`'s `cidForCbor`
(dag-cbor, sha-256, CIDv1 — the same codec/hash atproto uses for record CIDs),
so the `cid` returned by `repo.getRecord`/`listRecords` matches the CID inside
the MST. `verifyRecordProof` recomputes and compares against the MST entry, so a
wrong CID fails resolution loudly.

---

## 4. Repo generation & key custody

### 4.1 Deterministic offline build

The publish tooling (`packages/lexicons/scripts/authority.ts`, run via `tsx`)
builds the repo with `@atproto/repo` + `@atproto/crypto`, all already in the
tree:

1. For each NSID: `record = buildLexiconSchemaRecord(nsid)`,
   `cid = cidForCbor(dagCbor(record))`, add block.
2. `MST.create(blockstore)` then `.add("com.atproto.lexicon.schema/<nsid>", cid)`
   for all 7, in sorted key order (MST is deterministic).
3. `commit = { did: "did:web:foryour.fans", version: 3, data: <mst root>,
   rev: <TID>, prev: null }`, `signCommit(commit, keypair)`.
4. `blocksToCarFile(commitCid, blocks)` → `authority-repo.car`.

`rev` is a TID. To keep the artifact **byte-stable** across rebuilds when
nothing changed, `rev` is derived deterministically from the set of record CIDs
(a hash → TID), not wall-clock time. A schema change changes a record CID →
changes `rev` → new CAR. This makes the drift test (below) a pure equality
check.

The generated `authority-repo.car` and `did.json` are **committed** to the repo
(`packages/lexicons/authority/`). They are public artifacts; committing them
lets `apps/web` serve them with no build-time signing and lets CI verify them
without the private key.

### 4.2 Signing key

- **Type:** secp256k1 (`Secp256k1Keypair`, `@atproto/crypto`). atproto's most
  widely supported curve.
- **Public half:** `formatMultikey` → `did.json` `#atproto` verification method.
- **Private half:** environment variable `LEXICON_AUTHORITY_SIGNING_KEY`
  (multibase/hex export), stored in the deploy secret backend. Consumed **only**
  by `pnpm --filter @foryour-fans/lexicons authority:regen` (an operator step),
  never by `apps/web` or `apps/api` at runtime — they only ever read the
  committed CAR.
- **Who can rotate:** whoever holds deploy access to the secret store and can
  merge a change to `packages/lexicons/authority/did.json`.

### 4.3 Key loss / compromise — disaster recovery

`did:web` makes this comparatively benign because we control the DID document:

1. Generate a new `Secp256k1Keypair`.
2. Replace the `#atproto` verification method in
   `packages/lexicons/authority/did.json`.
3. `authority:regen` with the new key → new `authority-repo.car`.
4. Deploy `apps/web`. The TXT records are unchanged (they name the DID, not the
   key).
5. Resolvers that cached the old DID document keep failing signature
   verification until their DID cache expires (`@atproto-labs/did-resolver`
   default TTL is minutes–hours). This is an availability blip, not a
   confidentiality problem — the schemas are public.

There is **no** equivalent of a stolen PLC rotation key here: an attacker who
steals `LEXICON_AUTHORITY_SIGNING_KEY` can sign an *alternate* schema repo, but
cannot serve it as `did:web:foryour.fans` without also compromising the
`foryour.fans` web deploy or its DNS. The DNS/deploy control **is** the trust
root; the signing key is downstream of it.

---

## 5. DNS

### 5.1 Where `foryour.fans` DNS lives [OBSERVED]

`infrastructure/gcp/terraform/dns.tf` already manages records for the web
custom domain in **Cloudflare** (`cloudflare_dns_record`, gated on
`var.manage_dns`, zone `var.cloudflare_zone_id`). `_lexicon.*` records go in the
same zone, the same way.

### 5.2 Records

```
_lexicon.foryour.fans.        300  IN  TXT  "did=did:web:foryour.fans"
_lexicon.embed.foryour.fans.  300  IN  TXT  "did=did:web:foryour.fans"
```

Added to `dns.tf` as `cloudflare_dns_record.lexicon_authority` (a `for_each`
over a `locals` list), gated on a new `var.manage_lexicon_authority_dns`
(default `false`, independent of `var.manage_dns` so the Lexicon authority can
be cut over on its own schedule). TTL **300s** per §6.

The `locals` list is two literal names. A test
(`packages/lexicons/src/authority.terraform.test.ts`) parses `dns.tf` and
asserts the `_lexicon.*` names it declares are exactly
`LEXICON_AUTHORITIES.map(a => a.txtRecordName)` — so a new authority in
`nsids.ts` fails CI until `dns.tf` is updated (Non-negotiable Rule 1, "a test,
not a convention").

### 5.3 If Terraform can't reach the zone

Fallback runbook (§7) plus `pnpm --filter @foryour-fans/lexicons authority:check`,
which resolves every NSID over real DNS + HTTP and exits non-zero on any missing
/ wrong TXT record or schema drift.

---

## 6. Cache & rotation semantics

**[SPEC]** > "Resolving services should not cache DNS resolution results for
long time periods" — a changed TXT record silently redirects schema resolution
to a different repo.

- **TTL:** `_lexicon.*` TXT records are published at **300s**. Long enough to
  spare recursive resolvers, short enough that a rotation or an incident
  response propagates in minutes.
- **Migrating the authority to a new DID** (e.g. moving off `did:web` one day):
  1. Stand up the new authority repo (new DID) serving the identical schema set.
  2. Verify it resolves independently (`authority:check --did <newdid>`).
  3. Change both `_lexicon.*` TXT records to the new DID in one Terraform apply.
  4. Keep the **old** `did:web:foryour.fans` surface (`/.well-known/did.json`
     and the sync XRPC) serving for a grace period ≥ 1 hour (≫ the 300s TTL +
     DID-doc cache) so in-flight resolvers that already resolved the old DID
     still complete.
  5. Retire the old surface.
- **Schema update (same DID):** `authority:regen`, commit the new CAR, deploy
  `apps/web`. Resolvers pick it up on their next fetch (subject to their own
  cache). This is a normal deploy, not a DNS change.

---

## 7. Relationship to `_atproto` / handle resolution

`_lexicon.foryour.fans` (this phase) and `_atproto.foryour.fans` (handle
resolution, only if `foryour.fans` were ever *also* used as a handle) are
**independent DNS records with independent meaning** [SPEC]. This phase:

- adds only `_lexicon.*` records,
- does not read, write, or depend on any `_atproto` record,
- does not touch per-creator handle/DID resolution (`packages/atproto`
  `identity.ts`, the app's OAuth login), which continues to resolve creator
  handles exactly as before,
- introduces a DID (`did:web:foryour.fans`) that is a **schema authority only**
  — it has no `alsoKnownAs`, is never logged in, never owns creator content,
  and must never be confused with a creator DID.

`foryour.fans` is not currently used as an atproto handle; nothing here changes
that either way.

---

## 8. Manual runbook (operator)

Pre-req: `LEXICON_AUTHORITY_SIGNING_KEY` available locally (first run:
`pnpm --filter @foryour-fans/lexicons authority:keygen` prints a fresh keypair;
put the private half in the secret store and the `did.json` update through
review).

1. **Generate / refresh the repo artifact**
   `pnpm --filter @foryour-fans/lexicons authority:regen`
   → rewrites `packages/lexicons/authority/authority-repo.car` (+ `did.json` if
   the key changed). Commit it. CI's drift test must pass.
2. **Deploy `apps/web`** so `https://foryour.fans/.well-known/did.json` and
   `/xrpc/com.atproto.sync.getRecord` serve the new artifact.
3. **Publish DNS**
   - Terraform: set `manage_lexicon_authority_dns = true`, `terraform apply`.
   - Manual: in Cloudflare, add two TXT records per §5.2, TTL 300.
4. **Verify**
   `pnpm --filter @foryour-fans/lexicons authority:check`
   (resolves `_lexicon.foryour.fans` + `_lexicon.embed.foryour.fans` over real
   DNS, fetches every schema through `@atproto/lex-resolver`, deep-equals
   against the local compiled schemas). Exit 0 = done.
   Optional independent check: `goat lex resolve fans.foryour.post`.
5. **Rotation / DR:** §4.3 and §6.

---

## 9. Open assumptions to re-verify

- **[ASSUMPTION]** `goat lex resolve` performs the same proof-checked flow as
  `@atproto/lex-resolver`. Not run here. The deployed authority is checked with
  `lex install`; run `goat` once by hand after cutover.
- **[ASSUMPTION]** `@atproto-labs/did-resolver` resolves `did:web` the same way
  in-browser tools and third-party services do (fetch `/.well-known/did.json`,
  no PLC). True for the pinned version; re-check if a consumer reports
  otherwise.
- **[ASSUMPTION]** A single whole-repo CAR is an acceptable
  `com.atproto.sync.getRecord` response. The spec allows a proof subset;
  `verifyRecordProof` only requires that the requested `collection/rkey` is
  reachable from the signed root, which a full CAR satisfies. If a stricter
  resolver rejects extra blocks, switch to a per-record proof slice
  (`@atproto/repo` `MST` path export) — the builder already has the MST.
- **[ASSUMPTION]** `com.atproto.sync.getRecord` (not `getRecords`) is the
  current resolver call. True in `@atproto/lex-resolver@0.2.10`; bump-check on
  every `@atproto/lex*` upgrade — this doc and `authority.ts` must move together
  with that dependency.
