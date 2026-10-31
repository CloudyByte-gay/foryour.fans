# Future migration to AT Protocol Spaces

Status: **planning only; no implementation or rollout authorized by this document**.
Reviewed 2026-10-31. Start here when returning to this work.

Read [the research and target architecture](../docs/atproto-spaces.md) and
[the readiness and migration runbook](../docs/atproto-spaces-readiness.md).
The target is subscriber/tier bodies and media in creator-owned **permissioned
space repos** once Spaces is live and production ready. Public content keeps
its public-repo/Bluesky paths. Payments, legal data, sessions and entitlement
coordination remain private application data.

This replaces the previous prompt's key-grant-transport-only design. Spaces
can be the permissioned storage and sync backend. Encryption remains layered
inside it. Shipping the deferred encrypted-public-repo PoC is not a prerequisite.

## Future execution order

| Step | Prompt | Exit |
|---|---|---|
| 01 | [Verify readiness](./spaces/01-readiness.md) | Dated evidence and prerequisite GO/DEFER; documentation only |
| 02 | [Protocol and access](./spaces/02-protocol-and-access.md) | Pinned protocol adapter, OAuth/capabilities, canonical policy; disabled |
| 03 | [Content, media and sync](./spaces/03-content-media-sync.md) | Working permissioned storage and private view in staging |
| 04 | [Migration tooling](./spaces/04-migration.md) | Resumable migration and rollback rehearsed on synthetic data |
| 05 | [Product and verification](./spaces/05-product-and-verification.md) | Correct UI, security/access tests and operational evidence |
| 06 | [Rollout](./spaces/06-rollout.md) | Separately authorized production canary, rollout and later cleanup |

Each prompt is a **future task**, not an instruction to execute now. Run in
separate sessions. Step 01 can be repeated while upstream remains alpha.
Steps 02–05 need its prerequisite GO. Step 06 needs all production gates plus
explicit deployment authorization in that session. A calendar date never opens
the gate. Do not mark the migration complete when an adapter or mock works.

## Shared requirements

- Re-read the repository and upstream sources. Pin released specs, Lexicons,
  SDK and PDS versions; no invented endpoints or production `@alpha` tags.
- Keep current runtime behavior until cohort cutover. `ATPROTO_SPACES_ENABLED`
  is a **proposed future flag**, not a parsed/wired flag in today's code.
- Keep `CREATOR_OWNED_GATED_CONTENT_ENABLED` off in production and preserve its
  startup guard. Never route private writes through its public-repo PoC.
- Keep storage adapters separate from entitlement decisions. Use one canonical
  policy through `canAccess`, reconciling key-grant expiry checks and existing
  moderation/block/age/verification rules rather than duplicating decisions.
- No gated records, bytes, keys, metadata or labels in public repos, public
  blobs, Jetstream, public search/previews, logs or shared caches.
- Preserve creator ownership, stable app URLs, audience hierarchy, public
  dual-publishing, deletion semantics, unsupported-PDS behavior and rollback.
- Run meaningful tests and live staging checks for code steps, then required
  build/lint/typecheck/test checks. Record unavailable checks honestly. Docs-only
  work needs source/link consistency checks, not application test runs.
- Stop at each prompt's exit. Never silently deploy or delete legacy data.
