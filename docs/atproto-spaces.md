# AT Protocol Spaces: future migration design

Reviewed **2026-10-31**. Status: **future plan; not implemented or enabled**.
Start with [the prompt sequence](../prompts/atproto-spaces.md). Operational gates
and cutover steps are in [the runbook](./atproto-spaces-readiness.md).

## Review of upstream material

The [August 20 alpha announcement][alpha] describes lightweight permissioned
networks: authors keep records in per-space repos on their own PDSs; a
DID-based authority decides access; apps sync directly from PDSs without the
public relay. Subscription-only publishing is an intended use. Spaces is
therefore more than a decryption-key transport.

The announcement explicitly says **“you absolutely should not run production
code against it.”** It warns of breaking changes, missing careful security
review, destructive migrations, no hosted-sandbox backups and deletion of the
sandbox after alpha. The alpha Docker image and `@alpha` SDK tags are for
experiments, not this project's production migration.

The [October 14 developer experience update][devex] still describes launch as
upcoming and reports breaking changes since August. Its **syndicated/gated
data** modality fits this project: publisher DID as authority, with credential
decisions delegated to an app. Per-Space Jetstream semantics are prototypes,
not a production dependency. Neither announcement proves production readiness.

The [proposal README][proposal] still calls itself non-final. Reviewed blob
SHA: `84027adde9a84ea75ad2963d47bfe6d9a0e18765`, retrieved through the GitHub
connector after the directory-page fetch was blocked by robots rules. The
[Bulletin README][bulletin] demonstrates managed spaces, not production paid
content security. No live Spaces PDS, credential flow or migration was tested
in this documentation review. All draft details below require revalidation.

| Draft observation | Project implication |
|---|---|
| Space identity is authority DID + type NSID + space key; record URI includes author DID | Persist complete identities; public-record URI parsing is insufficient |
| `managedspace` delegates independent read/write decisions to an authenticated managing app | Prefer creator-DID authority and our entitlement service as delegate; never assume custody of creator signing keys |
| Space credentials grant access to the whole space and are app-key-bound | Split audiences into separate spaces; verify user delegation, app identity, proof binding, issuer, audience, expiry and replay using released SDKs |
| Managed policy needs no materialized reader list; policy publication is opt-in | Never publish subscribers or billing; private policy by default |
| Credentials generally last about ten minutes; optional revocation notifications shorten access | Measure revocation bounds; no promise to erase downloaded data |
| Private sync has separate operations, commit verification, recovery and blob APIs | Separate authenticated worker/read model, outside public Jetstream |
| Identity/account events still come through public account events | Handle PDS moves, key changes, deactivation and deletion independently of private record sync |

## Starting point in this repository

| Area | Current state and migration seam |
|---|---|
| `packages/content/src/repository.ts` | Private content is Postgres-authoritative; public posts get AT records. Route backend selection through `ContentRepository` |
| `creatorOwnedRepository.ts` | Flag-gated public dual-publishing and encrypted gated public-repo PoC. Reuse suitable helpers, never its gated public writes |
| `atprotoSpacesRepository.ts` | All methods throw; not wired. This is not a functioning adapter |
| `packages/media`, API `routes/media.ts` | S3 assets and attachment-aware checks; need permissioned originals, derivatives and delivery |
| `packages/subscriptions/src/entitlements.ts`, `keyGrants.ts`, API `checkPostAccess` | Existing policy boundaries to consolidate before credential delegation |
| `packages/media/src/encryption.ts`, `ContentKey`/`ContentKeyGrant` | AES-256-GCM and envelope-wrapped keys; useful foundation, not portable key recovery by themselves |
| `packages/discovery`, API `ingest.ts` | Public Jetstream indexes; keep separate from private sync and private search |
| API `server.ts`, `config/env.ts` | No parsed/wired `ATPROTO_SPACES_ENABLED`; add actual disabled-by-default config in future work |

Inspect deployed flags and actual data before migrating; local overrides and
defaults do not establish the live storage state.

## Target ownership and first-release scope

| Data | Future authoritative home | Application role |
|---|---|---|
| Public profiles, tiers, posts, public media | Existing public creator PDS paths | Public indexing and existing Bluesky interoperability |
| Subscriber/tier bodies and attached originals/derivatives | Creator's permissioned space repos/blobs, application-encrypted | Entitlement-checked keys, delivery, rebuildable private caches |
| Billing, subscriptions, payouts, legal/verification data, OAuth/app sessions | Existing private database/secret storage | Remains authoritative; do not migrate to Spaces |
| Space mapping, cursors, migration checkpoints, audit/revocation state | Private operational database | No private payment/subscriber details in published policy |
| Comments, likes, drafts, bookmarks, settings | Existing stores for this migration | Separate future design; do not implicitly migrate fan-authored data |

Bodies and media move together. Migrated text pointing at an app-authoritative
S3 original does not meet the portability goal. Public storage changes are out
of scope. Previously public content cannot become retroactively secret.

Prefer the creator DID as authority and foryour.fans as delegated managing app.
Verify released delegation, recovery and account-migration support. Do not
default to one platform-owned authority DID: that centralizes control. This is
syndicated publishing, not a multi-writer group-host implementation.

### Audience boundaries

Proposed mapping: one all-subscribers space per creator, plus one space per
stable minimum-tier audience. Higher-tier subscribers gain access to every
lower-tier audience they qualify for. One creator-wide space for all tiers
would expose premium records to lower tiers despite API filtering.

Use opaque stable space keys, independent of prices, tier names/order and
subscriber DIDs. Reordering/deactivating tiers must reconcile credentials and
keys. Unknown audiences, missing mappings and cross-creator tier references
deny. Changing visibility across spaces requires verified copy, pointer
transition and source withdrawal, not an assumed cross-repo transaction.

### Encryption, authorization and portability

Spaces provides **access control, not confidentiality or E2EE**. Preserve the
existing application-encryption requirement *inside permissioned storage* so
ciphertext and metadata stay off the public firehose. Include thumbnails,
previews and transcodes. The current server-generated key model allows
foryour.fans to decrypt; describe that honestly. Dropping encryption requires
a separate threat-model decision, not an upstream launch announcement.

Creator ownership of bytes is incomplete if only our service can unwrap keys.
Before cutover, implement and exercise creator recovery/export or key transfer
to another compatible service without exporting billing or publishing keys.
Specify key custody, moderation access, rotation and retention. Revoking future
keys/credentials cannot recall plaintext or keys already downloaded.

Consolidate entitlement decisions through `canAccess`. Observed gap:
`canAccess` checks `ACTIVE` but not `currentPeriodEnd`; `KeyGrantService` also
checks expiry. Minimum-tier lookups need explicit creator ownership validation.
Resolve these differences before they become credential bypasses. Existing
moderation/block/age/verification restrictions must survive API, direct Spaces
and key-grant paths. Creator self-access must reflect that creators own their
repos and can remove our delegation; platform bans do not erase owned data.

Keep adapters storage-only. The managing-app endpoint must authenticate the
authority and resolve trusted mappings before policy evaluation; a submitted
DID, price or space name is not proof of access. Read admission never implies
write admission. Accept creator-authorized publishing only in this release;
the draft allows users to write their own repo even without writer admission.
No subscriber writer set or public membership records are needed.

### Private sync, media and operations

Implement an authenticated private sync worker with per-space/author cursors,
released-SDK integrity verification, duplicate/out-of-order handling, missing
history recovery and deletions. Verified private caches serve app scale; every
viewer still needs current authorization. Account/SpaceDeleted events stop
serving and expire/purge derived state as appropriate. Transient failures do
not authorize public fallback or imply deletion.

Keep private search, counts, metadata, content labels, notifications, Open Graph,
thumbnails and logs within the audience boundary. Private blob delivery must
not use public blob endpoints or permanent public URLs. Bound key, URL and
credential lifetimes, test cache isolation, and preserve SSRF protections when
resolving DID endpoints or following account migration.

## Decisions to resolve when production releases exist

- Exact specs/Lexicons/SDK/PDS versions, supported hosts, feature detection,
  OAuth scopes and re-consent. Upstream launch does not upgrade every PDS.
- Managed-policy service authentication, supported client apps, sustainable
  credential/sync load and measured revocation guarantees.
- Blob quotas, video size/range/streaming support, encrypted derivatives,
  provider costs and adult-content hosting policies.
- Key export/recovery format, rotation, moderation access and service portability.
- Measured sync freshness, outage/revocation budgets, backup/restore and PDS moves.

Unsupported creators stay on the current private backend with clear status.
Never move real accounts to an alpha PDS to obtain compatibility.

## Relationship to earlier plans

This design supersedes **Spaces-as-key-transport-only** passages in the old
prompt and historical architecture/build-plan notes. It does not change runtime
behavior or the production guard on the gated public-repo PoC. That deferred
implementation does not have to ship before safe permissioned-space storage.
Financial, legal and subscriber data remain private application data even when
content uses permissioned storage.

[alpha]: https://atproto.com/blog/atproto-spaces-alpha
[devex]: https://atproto.com/blog/devex-goals-for-spaces
[proposal]: https://github.com/bluesky-social/proposals/blob/main/0016-permissioned-data/README.md
[bulletin]: https://github.com/bluesky-social/bulletin
