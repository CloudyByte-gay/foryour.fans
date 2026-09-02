# HARDENING PHASE - Payment, Media, and Gated-Content Safety

Run this as a focused security hardening phase before any production deployment,
real payment provider rollout, real payout onboarding, or creator-owned gated
content rollout. It can run independently of the numbered phases, but it should
be completed before Phase 14/16 production-readiness work treats the app as
deployable.

Companion files: [`prompts/full.md`](./full.md), [`prompts/web.md`](./web.md),
[`prompts/creator-owned-pds.md`](./creator-owned-pds.md),
[`docs/architecture.md`](../docs/architecture.md), and
[`README.md`](../README.md).

## Why

A static security review found three concrete issues in the current tree:

1. `apps/api/src/server.ts` wires `FakePaymentProvider` unconditionally, while
   `packages/subscriptions/src/providers/fakePaymentProvider.ts` accepts
   unsigned arbitrary JSON webhooks. Any environment exposed to other users can
   have `PENDING` subscriptions activated by forged `/webhooks/fake` requests.
2. `GET /media/:id/access` authorizes by "any active subscription to the
   creator" because `PostMedia` has no writer yet. Once media IDs are surfaced,
   this is broader than post access and can bypass tier gates.
3. `CREATOR_OWNED_GATED_CONTENT_ENABLED` is documented as not production-safe,
   but `apps/api/src/config/env.ts` does not forbid it in production. The local
   Docker compose file may enable it with a static development wrap secret.

Fix these as security behavior, not as documentation-only warnings.

## Non-Negotiable Rules

1. Fake payment and payout providers must never be usable in production.
2. Every public webhook route must either perform real provider signature
   verification or be explicitly blocked outside local/test development.
3. A media download grant must be no broader than the content object that
   exposes that media.
4. Unattached private media must be creator-only until it is attached to a post
   or another explicit access policy.
5. Creator-owned gated content must remain disabled in production unless a
   later reviewed design explicitly changes the threat model and config guard.
6. Development secrets may exist only in local development configuration. They
   must not be represented as acceptable production defaults.

---

## Backend Work

### 1. Provider Selection and Production Guards

- Extend API environment configuration with explicit provider selection fields,
  for example:

  ```text
  PAYMENT_PROVIDER=fake | <real-provider>
  PAYOUT_PROVIDER=fake | <real-provider>
  ALLOW_FAKE_PROVIDERS=false
  ```

- Keep `fake` as the default only for `development` and `test`.
- In `NODE_ENV=production`, fail startup if either provider is `fake` unless
  there is a deliberately named break-glass variable. Prefer no break-glass
  variable unless deployment workflows genuinely require one.
- Add tests for `loadEnv` proving production rejects fake providers and dev/test
  still boot with fakes.
- Update `apps/api/src/server.ts` so provider construction is driven by the
  validated env object, not unconditional `new FakePaymentProvider()`.
- Update comments that currently say fake providers are the only implementation
  so the code cannot be mistaken for production-ready payments.

### 2. Fake Webhook Hardening

- Keep the fake webhook flow for unit/e2e tests, but prevent it from being a
  public unauthenticated status-mutation primitive in shared environments.
- Acceptable implementation options:
  - Make `/webhooks/fake` reject outside `development`/`test`.
  - Or require an HMAC signature/header for fake webhooks, with the secret
    required whenever fake webhooks are enabled.
- Tests must cover forged fake webhook rejection in a non-test-like env and the
  existing happy path in test/dev.
- Preserve raw-body parsing for real provider signatures.
- Do not add CSRF/session auth to real provider webhooks; real providers cannot
  send browser session cookies. The security boundary is provider signature
  verification.

### 3. Media Access Must Follow Post Entitlements

- Implement the missing writer that attaches `MediaAsset` rows to `Post` rows
  through `PostMedia`, or defer media exposure entirely until that writer exists.
- Extend post create/update schemas and repository calls to accept media asset
  IDs if that is the chosen implementation path.
- Validate on attach:
  - the media asset exists
  - it belongs to the creator
  - it is `READY`
  - it is not `REJECTED`
  - sort order is stable and bounded
- Change `GET /media/:id/access`:
  - creator owner can always access their own ready asset
  - if the asset is attached to one or more posts, authorize only when the
    viewer can access at least one attached post using the same entitlement
    logic as `GET /posts/:id`
  - if the asset is unattached, deny everyone except the creator
  - never return signed download URLs for `PENDING_UPLOAD`, `PROCESSING`, or
    `REJECTED`
- Add tests for:
  - anonymous denied
  - non-subscriber denied
  - low-tier subscriber denied for high-tier media
  - sufficient-tier subscriber allowed
  - creator allowed
  - unattached asset denied to subscribers
  - asset owned by another creator cannot be attached

### 4. Creator-Owned Gated Content Guard

- Add an env validation rule that rejects
  `CREATOR_OWNED_GATED_CONTENT_ENABLED=true` when `NODE_ENV=production`.
- If a later security review approves production gated-PDS mode, require a new
  prompt/update that documents:
  - the approved threat model
  - offline ciphertext exposure risk
  - key wrapping and rotation plan
  - how dev/test wrap secrets differ from production secret management
- Keep `CONTENT_KEY_WRAP_SECRET` required when gated content is enabled.
- Add tests for the new production rejection.

### 5. Docker and Local Config

- Keep any `CREATOR_OWNED_*` flags in `infrastructure/docker/docker-compose.yml`
  clearly local-only.
- If `CREATOR_OWNED_GATED_CONTENT_ENABLED=true` remains in compose, add a
  comment nearby stating it is a local proof-of-concept setting and must not be
  copied into production.
- Prefer `.env.example` style placeholders for sensitive production settings.
- Do not introduce real provider secrets into the repository.

---

## Prompt and Docs Work

- Update `README.md` known limitations so fake providers and gated-PDS mode are
  described as config-enforced safety boundaries, not just caveats.
- Update `docs/architecture.md`:
  - provider selection and production fake-provider guard
  - webhook verification boundary
  - media access model after `PostMedia` attachment
  - creator-owned gated-content production guard
- Update `docs/build-plan.md` to include this hardening phase and mark it
  complete only after tests/lint/typecheck pass.
- If `prompts/full.md` or `prompts/web.md` still imply media can be downloaded
  by any subscriber regardless of post tier, correct that language.

## Verification

Run:

```text
pnpm test
pnpm lint
pnpm typecheck
pnpm --filter @foryour-fans/api build
pnpm --filter @foryour-fans/web build
```

Also verify manually or with tests:

- production env rejects fake providers
- production env rejects creator-owned gated content
- unsigned fake webhooks cannot activate subscriptions outside dev/test
- media download access matches post entitlement rules

## Stop After

Stop after implementing and verifying the hardening changes above. Do not
continue into a real payment provider integration, Phase 14 moderation/KYC,
Phase 16 deployment, or AT Protocol Spaces work in the same session unless a
new prompt explicitly starts that phase.
