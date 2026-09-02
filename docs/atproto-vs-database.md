# What lives in AT Protocol vs. our private database

Required reading before adding any field to a lexicon or a Prisma model: which store a piece of data belongs in isn't a style choice, it's a hard security/product boundary. Getting it backwards either leaks private data onto the open AT network permanently, or breaks portability promises the product is built on.

## The rule

**AT Protocol (the creator's own PDS, via the lexicons in `packages/lexicons/lexicons/`):** public information. Once published, treat it as public forever — deletion is best-effort propagation across the network (see "Hosting model" in `prompts/full.md`), not guaranteed removal. Only put something here if the creator publishing it publicly, permanently, is the intended behavior.

**Our private database (`packages/database`, Postgres):** everything else — anything with a subscriber-only audience, anything billing/payout/legal-shaped, anything we need to be able to actually delete or correct.

## Planned rearchitecture — this boundary moves

Two specs added after Phase 10 ([`prompts/creator-owned-pds.md`](../prompts/creator-owned-pds.md), [`prompts/bluesky-public-posts.md`](../prompts/bluesky-public-posts.md)) redraw the line below — they run next, before the remaining numbered phases (12–17; slot 11 is vacant, its Spaces work extracted to [`prompts/atproto-spaces.md`](../prompts/atproto-spaces.md)). The short version:

- **Creator-authored data stops being ours.** Profiles, tiers, posts, media blobs, and creator config become records/blobs in the *creator's own PDS*. The Postgres rows in the table below become a rebuildable cache/index, not a write-through mirror of our own writes.
- **Gated content moves too, encrypted.** `SUBSCRIBERS` / `TIER` post bodies and media are encrypted before they are written to the creator's PDS; foryour.fans coordinates payment → entitlement → key grants but holds no plaintext. The "explicitly, permanently forbidden" list below is unchanged — encryption is what lets private content be creator-owned without becoming public.
- **Public posts gain a second record.** Every `PUBLIC` post is dual-published as `app.bsky.feed.post` *and* `fans.foryour.post`.
- **New lexicons:** `fans.foryour.media`, `fans.foryour.accessPolicy`, `fans.foryour.serviceConfig`.

What stays in Postgres: OAuth sessions, app sessions, payment/subscription/provider state, webhook idempotency ledgers, entitlement/key-grant coordination, moderation queues, discovery indexes. Everything the "Explicitly, permanently forbidden" list already names stays exactly as forbidden on any public record.

## Field-by-field, this phase

| Concept | AT record | Field | Private DB (later phases) |
|---|---|---|---|
| Creator profile | `fans.foryour.profile` | `displayName`, `bio`, `avatar`, `banner`, `website`, `createdAt` | `Creator` holds `userId`, `did`, `status`, `verificationStatus` — operational/internal fields with no reason to be public AT data — **plus** a write-through cache of `displayName`/`bio`/`website`. `User.avatarUrl`/`bannerUrl` cache the user's public Bluesky images; `Creator.avatarUrl`/`bannerUrl` are foryour.fans-only overrides that win on local creator pages and are never written to the PDS. Public AT blob upload for the Lexicon `avatar`/`banner` fields is still not implemented. The profile cache is not a second source of truth: it's only ever written immediately after a successful write to the AT record itself. There is **no app-owned name** — no `slug`, no username: the public identity is the AT handle (cached on `User.handle`, keyed by `did`); `CreatorHandleHistory` records previous handles so old `/c/<oldhandle>` links redirect. No separate `CreatorProfile` table was needed — nothing arose that didn't fit on `Creator` directly; see `docs/architecture.md` |
| Subscription tier | `fans.foryour.tier` | `name`, `description`, `monthlyPrice` (integer minor units), `currency`, `sortOrder`, `createdAt` | `SubscriptionTier` (Phase 5) additionally holds `isActive`, `atRkey` (the tid rkey of the mirrored AT record, so updates/deactivation hit the same record), internal `id`/`creatorId` foreign keys |
| Public post | `fans.foryour.post` | `text`, `embed` (media refs), `labels` (content warnings), `createdAt` | `Post` (Phase 7) holds the body for every visibility, but is the AT record's write-through cache **only while `visibility` is `PUBLIC`** — `atRkey` tracks the mirrored record and is null otherwise. `SUBSCRIBERS`/`TIER` posts never get an AT record at all: Postgres is their only copy, full stop. A post crossing the `PUBLIC` boundary in either direction (via `ContentRepository.updatePost`) publishes or retracts the record accordingly — see `packages/content/src/repository.ts` and "Never accidentally publish subscriber-only content into a normal public AT repository" in `prompts/full.md` PHASE 7 |
| Public media | blobs referenced from `avatar`/`banner`/`fans.foryour.embed.images` | — | Private/paid media uses `MediaAsset` (Phase 8) + application-controlled S3-compatible storage, never a PDS blob. This wasn't a design question either — it followed directly from the same rule above once `Post` (Phase 7) established that a paid post's body is Postgres-only; media attached to one couldn't be a public blob without leaking the same content the text is deliberately kept off the AT network for. Avatar/banner blob upload (a genuinely public AT-blob use case) still doesn't exist — see docs/architecture.md's Phase 8 section |
| Subscriptions & payments | *(none — see below)* | — | `Subscription`, `PaymentEvent`, `PayoutAccount`, `User.paymentCustomerId` (Phase 6) exist entirely in Postgres. There was never a design question here — the "explicitly forbidden" list right below already named this exact data (customer IDs, billing history, payout information) before Phase 6 existed |

## Explicitly, permanently forbidden in any AT record (per `prompts/full.md`)

- Customer payment IDs
- Billing history
- Subscriber lists
- Legal names
- Tax information
- Payout information

None of these have a lexicon field for them anywhere in `packages/lexicons/lexicons/` — this isn't an oversight to fix later, it's the point. `packages/lexicons/src/lexicons.test.ts` includes a compile-time regression test (`@ts-expect-error` on an attempt to set a billing-shaped field) specifically so an accidental addition gets caught, not silently allowed. If a future phase seems to need one of these fields on a public record, that's a sign the design is wrong, not that this list needs an exception — flag it instead of adding the field.

## A third category, added in Phase 10: a derived index of what's already public

`IndexedCreatorProfile`/`IndexedPost`/`IndexedTier` (`packages/discovery`) live in Postgres but aren't "our private database" in the sense the rule above means — they're a read-only, eventually-consistent mirror of exactly the same public AT records the table above already lists, observed via Jetstream rather than read from our own writes. Nothing new is stored here that isn't already public on the open network; the point is discoverability (`/discover`, `/search`), not a new data category. See docs/architecture.md's Phase 10 section for why this index is never consulted for entitlement/access-control decisions (only `Creator`/`Subscription`/`SubscriptionTier` are) — it can lag the network by however long ingestion takes, and can include DIDs this app has no operational relationship with at all.

## Why `fans.foryour.tier.monthlyPrice` is an integer, not a decimal

Matches the private `SubscriptionTier.priceCents` convention (Phase 5, "prices stored as integer minor units") exactly, so there's one unit convention across both stores instead of two, and no float-rounding surface. The field is still named `monthlyPrice` (not `monthlyPriceCents`) to match `prompts/full.md`'s literal Phase 3 field list — the schema description clarifies the unit instead of renaming the field.
