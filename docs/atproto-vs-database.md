# What lives in AT Protocol vs. our private database

Required reading before adding any field to a lexicon or a Prisma model: which store a piece of data belongs in isn't a style choice, it's a hard security/product boundary. Getting it backwards either leaks private data onto the open AT network permanently, or breaks portability promises the product is built on.

## The rule

**AT Protocol (the creator's own PDS, via the lexicons in `packages/lexicons/lexicons/`):** public information. Once published, treat it as public forever — deletion is best-effort propagation across the network (see "Hosting model" in `prompts/full.md`), not guaranteed removal. Only put something here if the creator publishing it publicly, permanently, is the intended behavior.

**Our private database (`packages/database`, Postgres):** everything else — anything with a subscriber-only audience, anything billing/payout/legal-shaped, anything we need to be able to actually delete or correct.

## Field-by-field, this phase

| Concept | AT record | Field | Private DB (later phases) |
|---|---|---|---|
| Creator profile | `fans.foryour.profile` | `displayName`, `bio`, `avatar`, `banner`, `website`, `createdAt` | `Creator` (Phase 4) holds `userId`, `did`, `slug`, `status`, `verificationStatus` — operational/internal fields with no reason to be public AT data — **plus** a write-through cache of `displayName`/`bio`/`website` (not `avatar`/`banner` yet — those need Phase 8's blob upload). The cache is not a second source of truth: it's only ever written immediately after a successful write to the AT record itself. No separate `CreatorProfile` table was needed after all — nothing arose in Phase 4 that didn't fit on `Creator` directly; see `docs/architecture.md` |
| Subscription tier | `fans.foryour.tier` | `name`, `description`, `monthlyPrice` (integer minor units), `currency`, `sortOrder`, `createdAt` | `SubscriptionTier` (Phase 5) additionally holds `isActive`, `atRkey` (the tid rkey of the mirrored AT record, so updates/deactivation hit the same record), internal `id`/`creatorId` foreign keys |
| Public post | `fans.foryour.post` | `text`, `embed` (media refs), `labels` (content warnings), `createdAt` | `Post` (Phase 7) holds the actual body for `SUBSCRIBERS`/`TIER`-visibility posts — a paid post's content is **never** written as a `fans.foryour.post` record; see "Never accidentally publish subscriber-only content into a normal public AT repository" in `prompts/full.md` PHASE 7 |
| Public media | blobs referenced from `avatar`/`banner`/`fans.foryour.embed.images` | — | Private/paid media uses `MediaAsset` + application-controlled S3-compatible storage (Phase 8), never a PDS blob |

## Explicitly, permanently forbidden in any AT record (per `prompts/full.md`)

- Customer payment IDs
- Billing history
- Subscriber lists
- Legal names
- Tax information
- Payout information

None of these have a lexicon field for them anywhere in `packages/lexicons/lexicons/` — this isn't an oversight to fix later, it's the point. `packages/lexicons/src/lexicons.test.ts` includes a compile-time regression test (`@ts-expect-error` on an attempt to set a billing-shaped field) specifically so an accidental addition gets caught, not silently allowed. If a future phase seems to need one of these fields on a public record, that's a sign the design is wrong, not that this list needs an exception — flag it instead of adding the field.

## Why `fans.foryour.tier.monthlyPrice` is an integer, not a decimal

Matches the private `SubscriptionTier.priceCents` convention (Phase 5, "prices stored as integer minor units") exactly, so there's one unit convention across both stores instead of two, and no float-rounding surface. The field is still named `monthlyPrice` (not `monthlyPriceCents`) to match `prompts/full.md`'s literal Phase 3 field list — the schema description clarifies the unit instead of renaming the field.
