# Spaces 02 — protocol boundary and canonical authorization

Future implementation task. Read [the entry point](../atproto-spaces.md), its
shared requirements, both Spaces docs and `docs/spaces-production-readiness.md`.
Proceed only with a current prerequisite GO; otherwise update evidence and stop.
No production enabling or real-account migration.

Implement the smallest released-protocol boundary in `packages/atproto`, with
exact pinned stable SDK versions and injected transports for tests. Use SDK
credential/crypto/URI functions rather than hand-rolling protocol primitives.
Support capability checks, complete space/author identities, creator-authority
managed-policy configuration, least-privilege OAuth scopes/re-consent, protected
record/blob operations and lifecycle handling. No fallback to public APIs for
private content. Preserve SSRF protection when resolving PDS/service endpoints.

Wire actual `ATPROTO_SPACES_ENABLED=false` parsing/defaults and supported-host
and cohort controls in API config/server and relevant environment examples.
Audit existing misleading flag/stub comments. Keep the production guard on
`CREATOR_OWNED_GATED_CONTENT_ENABLED`; the new path must not require it.
Disabled behavior must match the existing application exactly.

Implement the managing-app access endpoint in `apps/api`, with domain policy
in `packages/subscriptions` and no app imports from packages. Authenticate the
space authority service request per released spec, validate replay/audience,
resolve a stored creator/audience mapping, and evaluate read and write separately.
Do not treat a submitted subscriber DID as authenticated. Preserve creator-DID
authority and legitimate creator self-access; do not take over creator keys.

Consolidate shared entitlement decisions across `canAccess`, key grants and
routes before reusing them: period expiry, tier ownership/hierarchy, inactive
creators, missing/deactivated tiers, blocks and applicable safety gates. Inspect
current code rather than assuming the gaps described in the design still exist.
All-subscribers and per-minimum-tier spaces must follow those same decisions.
Subscribers are readers, not admitted content writers, in the initial release.
No public subscriber lists or billing fields in policy or records.

Test unauthenticated/forged authority, wrong audience/user/app/space, expired
or replayed assertions, canceled/past-due/lapsed subscriptions, cross-creator
tiers, tier reordering and owner behavior. Include direct protocol/key paths,
disabled-path regression checks and live synthetic-user checks on the pinned
staging PDS. Measure credential expiry/revocation behavior rather than assuming
instant revocation. Record unavailable checks as blockers for production.

Write `docs/spaces-implementation.md` with actual contracts, versions, mappings,
delegation/recovery and policy decisions. Run relevant and repository-required
checks. Stop with the integration disabled and no content migration.
