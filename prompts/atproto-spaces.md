# EXPERIMENTAL PHASE — AT Protocol Spaces Adapter

Runs **dead last** — after every numbered phase of [`prompts/full.md`](./full.md)
and [`prompts/web.md`](./web.md), and after both rearchitecture phases
([`prompts/creator-owned-pds.md`](./creator-owned-pds.md), then
[`prompts/bluesky-public-posts.md`](./bluesky-public-posts.md)). It was carved
out of the old `PHASE 11` / `WEB PHASE 11` so the main build sequence has no
experimental detour in the middle of it. Slot 11 in both plans is intentionally
left vacant (not renumbered) — every `Phase 12`–`Phase 17` cross-reference in
the specs and docs still resolves.

Run it as its own session(s), backend then web, with the same discipline as a
numbered phase: tests green, exit checklist, `Stop after` line.

Companion files: [`prompts/full.md`](./full.md), [`prompts/web.md`](./web.md),
[`prompts/creator-owned-pds.md`](./creator-owned-pds.md),
[`prompts/bluesky-public-posts.md`](./bluesky-public-posts.md),
[`docs/architecture.md`](../docs/architecture.md),
[`docs/atproto-vs-database.md`](../docs/atproto-vs-database.md).

## Why this is last and why it stays behind a flag

AT Protocol Spaces (proposal 0016 / Bulletin) is still experimental: proposal
stage, immature SDK support, no PDS in the wild serving it dependably. The
initial production architecture (`prompts/full.md`) explicitly forbids private
paid content from *depending* on Spaces for exactly this reason. So Spaces is
built only after the real product exists end-to-end, and every Spaces code path
ships behind `ATPROTO_SPACES_ENABLED=false`.

## Relationship to creator-owned PDS storage

By the time this phase runs, [`prompts/creator-owned-pds.md`](./creator-owned-pds.md)
has already moved creator content — including gated content — onto the creator's
own PDS, **encrypted**, with foryour.fans brokering payment → entitlement →
decryption-key grants. That changes what Spaces is *for* here:

- Spaces is **not** the private-content storage backend. Content stays encrypted
  and creator-PDS-owned regardless.
- Spaces (or a successor permissioned-content primitive) is at most a
  **key-grant / permission transport** layered over that encrypted storage —
  one interchangeable implementation behind the `ContentRepository` interface and
  the `SpaceAuthority` boundary.
- The entitlement decision still routes through `canAccess`. Spaces receives only
  the authorization *outcome*, never payment state.
- Treat protocol-native grants as an access layer, not a reason to publish paid
  content unencrypted (see `creator-owned-pds.md` → "Protocol-Native
  Permissioning"). Gated post bodies and media are still encrypted before they
  reach the PDS; a compatible fan-service app must still be able to verify access
  and issue keys from the creator-owned records plus its own payment
  relationship.

If this phase runs before `creator-owned-pds.md` has landed (not the confirmed
order), it operates against whatever `ContentRepository` implementation is
current and must not reintroduce app-owned authoritative content storage.

## Required Research Before Implementation

Before making changes, read:

- current AT Protocol Spaces documentation
- proposal 0016 or its successor
- current SDK implementation
- current Bulletin reference implementation

Do not assume APIs from earlier versions still exist. If official docs and live
behavior disagree, follow the live behavior and document it.

## Backend

Implement:

```text
AtprotoSpacesContentRepository
```

behind the existing `ContentRepository` interface. (The stub defined back in
`prompts/full.md` PHASE 7 — `packages/content/src/atprotoSpacesRepository.ts`,
every method throwing — is what becomes real here.)

The proposed mapping is:

```text
Creator
    │
    ├── Supporter Space
    ├── Premium Space
    └── VIP Space
```

Each paid tier may map to an AT Protocol Space.

Build:

```text
SpaceAuthority
```

which answers whether a requesting DID should be issued access credentials.

Its authorization decision MUST use the subscription entitlement system.

Conceptually:

```ts
authorizeSpaceAccess({
  requesterDid,
  creatorDid,
  space,
}) {
  return entitlementService.canAccess(...)
}
```

Do not duplicate payment state into AT Protocol.

AT Protocol should receive only the authorization outcome necessary to grant
access.

Place all Spaces functionality behind:

```text
ATPROTO_SPACES_ENABLED=false
```

by default.

Provide integration tests where practical.

Document experimental limitations.

Encrypted creator-owned PDS storage (per `creator-owned-pds.md`) remains the
default private-content implementation; Spaces is an alternative access/transport
layer, not a replacement for it.

**Stop after the backend adapter.** Verify: `pnpm build`, `pnpm lint`,
`pnpm typecheck`, `pnpm test` all green; the flag defaults `false` in every
environment config; the entitlement service remains the sole authority.

## Web

Consumes the backend above (`AtprotoSpacesContentRepository`, `SpaceAuthority`),
gated by `ATPROTO_SPACES_ENABLED=false` by default.

- **No user-facing feature ships in this phase.** Private content continues to
  render exactly as in `WEB PHASE 8` / `WEB PHASE 9` (and as amended by the
  rearchitecture phases) regardless of the storage backend — the UI must not
  know or care which `ContentRepository` implementation served a post.
- Optional: a dev-only `/dev/spaces` diagnostics page (excluded from the
  production build) that, when the flag is on, shows whether a given post was
  served from the Spaces adapter — for testing only.
- Add a note to `docs/ux.md` that Spaces is experimental and has no UI surface.

**Stop after the web changes.**

## Documentation Updates

- `README.md` — note Spaces is implemented as an experimental, flag-gated
  adapter, not the private-content backend.
- `docs/architecture.md` — the "Planned rearchitecture" / Spaces section: mark
  the adapter as built (behind the flag) and describe it as a key-grant
  transport over encrypted creator-owned storage.
- `docs/atproto-vs-database.md` — confirm no payment/entitlement state leaks into
  Spaces records.
- `docs/build-plan.md` — mark the extracted Spaces phase complete.

## Exit Checklist

1. `pnpm build`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. Docker stack starts cleanly
6. `ATPROTO_SPACES_ENABLED` defaults `false` in every environment config
7. With the flag on, `SpaceAuthority` grants access only when `canAccess` does
8. Gated content remains encrypted and creator-PDS-owned; Spaces carries the
   grant, not the plaintext
9. No app-owned authoritative content storage reintroduced
10. Experimental limitations documented without product overclaiming

**Stop after the Spaces adapter and its dev-only diagnostics. This is the last
phase; do not start new product work from here.**
