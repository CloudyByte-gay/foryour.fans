# Spaces 03 — permissioned content, encrypted media and private sync

Future implementation task. Read [the entry point](../atproto-spaces.md), both
Spaces docs, current readiness report and step 02 implementation evidence.
Require prerequisite GO and working authenticated protocol/policy boundaries.
Use synthetic staging data only; keep default and production behavior unchanged.

Replace the throwing `AtprotoSpacesContentRepository` with real permissioned
storage behind `ContentRepository`. Keep storage separate from viewer policy.
Introduce explicit per-object/cohort backend routing and full space/author/source
mapping using additive database migrations. Preserve existing IDs, URLs, feed
ordering, cursor behavior and public dual-publication. Do not use public URI
parsers or source references as proof that a private record is publicly readable.

Define one all-subscribers space and stable minimum-tier audience spaces per
creator using released type declarations. Extend `fans.foryour.*` Lexicons only
as necessary, validate compatibility and update Lexicon authority publishing.
Do not publish private policy, body, blob, label or key references publicly.
Support safe edits/deletes and visibility transitions with explicit intermediate
states; never assume atomic transactions across spaces or public/private stores.

Store application-encrypted bodies and media in **permissioned** repos/blobs.
Adapt `packages/media`, uploads/processing, originals, thumbnails/transcodes,
attachment references and delivery routes. Validate ownership, readiness,
file/range behavior and quotas. Manage interrupted uploads and safe orphan
cleanup. No permanent public URLs or use of public `sync.getBlob` for private
assets. Bound temporary delivery access and prevent cache leakage.

Reuse reviewed AES/envelope helpers as appropriate; version encrypted payloads,
handle key rotation and keep keys private. Implement creator export/recovery
or controlled key transfer and prove another authorized compatible service can
read exported bodies and playable media without private billing records. Do
not call storage portable while keys are irrecoverably platform-bound.

Add a separate authenticated private sync worker/read model: per-space/author
cursors, verified commits, duplicate/out-of-order events, incremental history
gaps/full recovery, private blob references and deletions. Follow the released
SDK, not the old draft's algorithm details. Handle credential renewal, lost
authorization, deleted spaces, PDS moves, keys and account lifecycle. Keep
public Jetstream and public `IndexedPost` untouched by gated data. Private cache
hits must still pass current authorization and the recorded freshness budget.

Verify on two staging PDS instances: create/edit/delete/read/feed, wrong-tier
and anonymous denial, direct private blob denial, encrypted derivatives,
revocation, missed sync history, source rebuild, account move and key recovery.
Probe public repo/blob/firehose/search/preview surfaces for private leakage.
Use meaningful integration tests plus required build/lint/typecheck/test checks.
Update implementation/readiness evidence. Stop before migrating real content.
