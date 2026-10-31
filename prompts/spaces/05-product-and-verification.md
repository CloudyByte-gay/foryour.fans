# Spaces 05 — product behavior and production verification

Future implementation task. Read [the entry point](../atproto-spaces.md), both
Spaces docs and current readiness, implementation and rehearsal reports.
Require steps 02–04 complete in staging. No production rollout in this step.

Update creator onboarding/settings/portability, composer, posts, feeds and media
flows for supported, unsupported, permission-denied and migrating creators.
Explain where private content is stored, who can access/decrypt it and how to
recover/export it in plain language. OAuth consent/re-consent must reflect the
actual scopes. Preserve existing IDs, links, tier choices and subscriber views.
Expose useful migration/connection status and recovery actions without leaking
credentials, private space references or implementation jargon to viewers.

Audit all related copy including `lib/post.ts`, privacy/legal pages and older
docs. Do not claim content never leaves foryour.fans, Spaces encrypts by itself,
downloaded content is revocable, migration erases historical public records, or
all creators are portable while some remain on legacy storage. Keep unsupported
creators on the private legacy path; never encourage moving to alpha accounts.

Perform security/privacy verification across API, delegated policy, direct
protocol reads, private sync and key/media delivery. Cover anonymous, creator,
valid/wrong/lower/higher tier, expired/lapsed/past-due/canceled subscription,
blocked/suspended/deactivated actors, missing mappings, forged/replayed proofs,
deleted spaces, PDS moves and unavailable providers. Test private previews,
labels, notifications, exports, signed URL expiry, range/video and shared-cache
isolation. Verify protected data is absent from public repos/blobs/firehose,
search, Open Graph, logs and analytics. Include browser and relevant regression
checks; mocks alone cannot establish live interoperability or revocation.

Measure agreed acceptance budgets under expected load. Rehearse credentials/
keys rotation, sync recovery, backup restore, creator/service portability and
post-cutover rollback. Add private-safe observability and explicit alert/stop
thresholds. Record current upstream security/support evidence and project review
outcomes; resolve critical/high findings before production GO.

Update README, architecture, data-boundary, UX/security/deployment docs and
readiness matrix to describe what is actually built. All production runbook
gates need evidence, including independent real-money/product blockers. Mark
final production GO only when satisfied, otherwise DEFER with exact gaps.
Run required repository checks and record outcomes. Stop with a reviewable
canary configuration and operator runbook; do not deploy.
