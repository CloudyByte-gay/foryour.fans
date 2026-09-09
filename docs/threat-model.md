# Threat model

Updated 2026-09-09; originally a Phase 15 (Production Hardening) deliverable — companion to `docs/security.md` (what the system does) and `docs/production-readiness.md` (what's left). This document works through the actors, trust boundaries, assets, and threats a paid, adult-content-capable creator platform actually faces, and states which are mitigated, which are accepted trade-offs, and which are explicitly deferred.

## Actors and trust boundaries

| Actor | Trusted for | Not trusted for |
|---|---|---|
| Anonymous visitor | Nothing | Everything — every write route requires a session |
| Subscriber (authenticated, no subscriptions) | Their own session, CSRF token | Any gated content, any other user's data |
| Subscriber (with an ACTIVE subscription) | Access to the specific creator/tier they pay for | Any other creator's/tier's gated content, another subscriber's data |
| Creator | Their own `Creator`/`SubscriptionTier`/`Post`/`MediaAsset` rows | Any other creator's rows, admin actions, real money movement (no real `PayoutProvider` exists — see `docs/security.md`) |
| Admin (`User.role: "ADMIN"`) | Moderation actions logged to `AuditLog`, restricted/gated by `requireAdmin` | Nothing beyond the documented admin route surface — no route lets an admin move money or read plaintext of gated content they're not otherwise entitled to |
| Payment provider (webhook caller) | Only what a *verified-signature* delivery says, and only for `Subscription` status transitions | Not trusted with any browser-session capability — `/webhooks/:provider` is registered outside the session scope entirely and needs no cookie |
| Other AT Protocol network participants (via Jetstream ingestion, `packages/discovery`) | Public, portable identity-graph data only (profiles/posts/tiers a DID chose to publish) | Never consulted for `canAccess`/entitlement decisions — see `docs/atproto-vs-database.md` |

**Trust boundaries** (where untrusted input crosses into trusted processing):

1. Browser → API (every route) — the primary boundary; crossed via HTTP, guarded by session/CSRF/zod validation.
2. Payment provider → API (`POST /webhooks/:provider`) — crossed via HTTP with no cookie, guarded by signature verification (`paymentProvider.handleWebhook`) before any other processing.
3. API → creator's own PDS (OAuth-scoped writes) — crossed via the AT Protocol OAuth grant; the API can only write under the DID's own delegated authority, never impersonate an arbitrary DID.
4. Open AT network → `packages/discovery`'s ingestor — crossed via a public WebSocket firehose (Jetstream); treated as fully untrusted, eventually-consistent, and never authoritative for entitlement (see `docs/atproto-vs-database.md`'s "IndexedX tables... never consulted for canAccess" rule).

## Assets, ranked by sensitivity

1. **Gated (SUBSCRIBERS/TIER) post text and private media bytes** — the actual product subscribers pay for. Postgres-only for text (never an AT record — see `docs/atproto-vs-database.md`'s "explicitly, permanently forbidden" list); private media lives only in application-controlled S3-compatible storage, never on any PDS.
2. **AT OAuth session material** (`AtprotoOAuthSession`, Postgres) — DPoP-bound tokens that can act on a user's own PDS on their behalf. A leak here is a leak of a real AT Protocol account's write capability, not just this app's own session.
3. **Application session cookie** — access to everything a logged-in user/creator/admin can do inside this app.
4. **Billing state** (`Subscription`, `PaymentEvent`) — who owes/paid what; incorrect state here is either lost revenue (a paying subscriber wrongly denied) or free access (a lapsed subscriber wrongly granted).
5. **Moderation data** (`Report`, `ModerationCase`, `AuditLog`) — accusations against real people and who-did-what admin history; a leak here is itself a harm (outing a reporter, or a subject of a report).
6. **Public profile/post/tier data** — already public by the user's own choice (published to their own PDS); lowest sensitivity, but integrity still matters (nothing should let one DID write into another's repo).

## Threats and mitigations

### Spoofing (impersonation)

| Threat | Mitigation | Status |
|---|---|---|
| Attacker forges a session cookie to impersonate a user | Session ID is a 32-byte random value, unguessable; server-side lookup, no client-trusted claims | Mitigated |
| Attacker forces a victim to complete login bound to the attacker's own account ("login CSRF" / session fixation) | SDK transaction state plus the ten-minute HttpOnly `ff_oauth_state` cookie, matched against the SDK-returned application state; successful login replaces and revokes the old app session | Mitigated — see `docs/security.md` |
| Attacker forges a webhook delivery to move a subscription into `ACTIVE`/`CANCELED` without paying | `paymentProvider.handleWebhook` verifies a signature before any effect; `loadEnv` refuses to boot with `PAYMENT_PROVIDER=fake` under `NODE_ENV=production` (Phase 15), so the no-op-signature fake provider is structurally unreachable outside development/test | Mitigated in production; a residual, accepted gap in development/test only — see "Accepted risks" below |
| Attacker with a stolen/leaked signed media URL uses it after the entitled subscriber's session ends | URL is scoped to one S3 key, expires in 60 seconds, and required a real entitlement check to be issued at all | Mitigated |

### Tampering

| Threat | Mitigation | Status |
|---|---|---|
| Client tampers with a request body to grant itself higher tier/price/role | Every route validates with zod, then resolves entitlement server-side (`canAccess`) or ownership (`request.session!.did`) — never trusts a client-asserted price/tier/role | Mitigated |
| Client replays an old, now-stale webhook event to roll back a subscription's state | `Subscription.lastWebhookEventAt` rejects an event older than the last-applied one (new this phase) | Mitigated |
| Same-site attacker submits a state-changing request using the victim's ambient cookies (CSRF) | Double-submit `x-csrf-token` header, checked against the server-side session record | Mitigated |
| Attacker floods `POST /auth/atproto/start` to abuse this app as a proxy for attacking a third-party PDS | Route-specific rate limit (10/minute), far stricter than the global default | Mitigated |

### Repudiation

| Threat | Mitigation | Status |
|---|---|---|
| An admin denies having taken a moderation action | `AuditLog` — append-only by convention, one row per sensitive admin action, `actorRole` snapshotted at write time | Mitigated (convention-enforced, not DB-enforced — Postgres has no first-class immutable-table primitive this schema uses) |
| A creator disputes what price a subscriber agreed to after a later price change | `priceCentsAtSubscription`/`currencyAtSubscription` snapshotted once at subscribe time, never read live from the tier | Mitigated |

### Information disclosure

| Threat | Mitigation | Status |
|---|---|---|
| A `404` vs `403` distinction on an owned resource reveals whether a resource id exists at all | Every ownership-scoped lookup (`getOwnedTier`, `getOwnedMediaAsset`, `/creators/me/*`) returns the same `404` for "doesn't exist" and "exists but isn't yours" | Mitigated by design |
| A locked post's metadata response leaks its body/media to a non-entitled viewer | `toLockedStub` returns id/visibility/createdAt/requiredTier only — never `text` or media refs | Mitigated |
| Stack traces or internal error detail leak to the client on a 500 | `registerErrorHandler` sends a generic "Internal Server Error" message for any `statusCode >= 500`, with the real error going only to structured logs + the new `ErrorReporter` | Mitigated |
| `/ready`'s failure response reveals internal infrastructure detail | Response is `{status, reason: "database unreachable" \| "redis unreachable"}` only — no connection string, host, or stack trace | Mitigated |
| Gated media's storage key or bucket structure is guessable from a signed URL | Storage keys are random (asset creation, `packages/media`), never derived from user-controllable input | Mitigated |
| A cache reuses personalized content or signed grants for a different viewer | Session-aware responses use `Cache-Control: private, no-store`, including anonymous responses and errors | Mitigated |
| Routine API request logs expose OAuth codes/state | Request serializer omits query strings; external proxy/error logging needs its own controls | Mitigated for routine API request logs |

### Denial of service

| Threat | Mitigation | Status |
|---|---|---|
| A single client floods any route with requests | Global Redis-backed rate limit (300/minute per client) | Mitigated (basic; see "Accepted risks" below for limits) |
| A client rotates forged forwarding headers to evade rate limits | Rate limiter uses Fastify `request.ip`; only configured proxy IPs/CIDRs are trusted | Mitigated; deployment must configure the actual proxy chain |
| A large or malformed body ties up request parsing/memory | `bodyLimit: 256 KiB` on the Fastify instance | Mitigated |
| A flood of invalid webhook deliveries (bad signature) burns CPU on JSON parsing/signature checks | Falls under the same global rate limit as every other route; not given a special (lower) limit — see "Accepted risks" | Partially mitigated |
| Distributed flood across many IPs (a real DDoS) | Not mitigated at the application layer — this is normally a CDN/edge/network-layer concern (Cloudflare, a cloud load balancer's DDoS protection), out of scope for an application-level Phase 15 pass | Deferred — infrastructure-layer, see PHASE 16 |

### Elevation of privilege

| Threat | Mitigation | Status |
|---|---|---|
| A regular user calls an admin route | `requireAdmin` re-checks `User.role` from Postgres on every call, gates every route in `admin.ts` | Mitigated |
| A user self-promotes to `ADMIN` via some API path | There is no such path anywhere in this codebase — `ADMIN_DIDS` (an env var, operator-controlled) is the only way, applied idempotently at login | Mitigated by design |
| A restricted user routes around `requireNotRestricted` via a different endpoint that reaches the same effect | Every write capable of harming another user/the platform carries the check (verified this phase's route audit); reading/existing access is deliberately unaffected — see `docs/security.md`'s "Findings and fixes" | Mitigated (one gap found and fixed this phase) |
| A creator marks their own content as adult without verification, evading a compliance gate | `containsAdultContent` write path 403s unless `Creator.verificationStatus === "VERIFIED"` | Mitigated |

## Accepted risks / deliberate trade-offs

- **No IP/User-Agent session binding.** Rejected as a mitigation for session theft because it would break legitimate cross-device use of a portable AT Protocol identity while providing only weak protection against a real attacker (both signals are spoofable). See `docs/security.md`'s Authentication section.
- **`FakePaymentProvider`'s webhook signature check is a no-op in development/test, where it's the only place it can still run.** (`handleWebhook`'s own doc comment: "a real provider would verify a signature header against rawBody here".) No real payment processor has been selected (`prompts/full.md` Phase 6's own note: adult-content-compatible processor selection is a business decision, not a Codex phase), so this placeholder is intentional and cannot be otherwise today — but as of Phase 15, `loadEnv` refuses to boot with `PAYMENT_PROVIDER=fake` under `NODE_ENV=production` (see `docs/security.md`'s "Production deployment guards"), so this gap no longer reaches a real deployment. The *code path* that would verify a signature exists and is exercised (`processWebhookEvent` calls `handleWebhook` and rejects on any thrown error); only the concrete implementation is a placeholder. A real processor integration must implement real signature verification before real money moves through it.
- **Global rate limit is per-client-IP (Fastify `request.ip`, honoring only `TRUSTED_PROXIES`), not per-account.** A distributed attacker (many IPs, one stolen account's credentials aren't even needed) can still exceed the effective per-account request rate by spreading requests across IPs. Per-account rate limiting was considered out of scope for this pass — it requires resolving a session before the rate-limit check can even key on an account, which most of this app's routes don't need Redis for today (see `sessionPlugin`'s own encapsulation-for-performance rationale), and would be easy to add later behind the same `@fastify/rate-limit` `keyGenerator` hook.
- **Webhook deliveries share the same rate-limit budget as everything else**, rather than a dedicated, lower one. A real payment provider's webhook traffic volume and IP ranges aren't known (no real provider is integrated yet — see above), so a provider-specific limit would be guesswork; revisit once a real `PaymentProvider` is chosen.
- **No CAPTCHA or bot-detection anywhere** (login start, report filing, comments). Not requested by `prompts/full.md`, and inventing one risks colliding with a UX decision (`prompts/web.md`) that hasn't been made.

## Explicitly out of scope for this document

- Legal/compliance requirements (NCMEC/DMCA filing, age verification, consent records, geo-restriction) — see `docs/architecture.md`'s Phase 14 section and `docs/security.md`'s "Legal/compliance review required."
- Infrastructure/network-layer threats (DDoS at the edge, container escape, node compromise, secrets-at-rest encryption for the cluster) — `prompts/full.md` PHASE 16's job.
- A full risk register with likelihood/impact scoring and an MVP-readiness classification — `prompts/full.md` PHASE 17's job (`docs/final-architecture.md`).

## Dependency review status

Next.js was upgraded to 15.5.24 with React 19.2.8. The production audit reported zero known vulnerabilities on 2026-09-09; the previously deferred framework upgrade is resolved. See [2026-09-09 security and usability review](./security-usability-review-2026-09-09.md) for scope, regression coverage, and remaining deployment limits.
