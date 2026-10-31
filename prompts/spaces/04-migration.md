# Spaces 04 — resumable migration and lossless rollback

Future implementation task. Read [the entry point](../atproto-spaces.md), the
[runbook](../../docs/atproto-spaces-readiness.md), design and steps 01–03 reports.
Require prerequisite GO and verified staging storage/sync/recovery. No live
account/content migration or destructive cleanup in this step.

Build CLI/job tooling under the repository's existing API script conventions,
with a no-write dry-run default, explicit cohort selection and durable job IDs.
Add operational migrations for manifests/checkpoints/backend states as needed.
Persist source revisions/hashes, full targets, blob/derivative mappings, keys,
policy versions and failures. Keep private data and subscriber identities out
of logs and committed reports. Do not reuse the public-PDS migration blindly.

Implement the runbook state machine and ordered inventory, provision, copy,
reconcile, verify and fenced cutover stages. Stable idempotent target keys,
bounded retries, per-host throttling and resume must survive crashes at every
stage. A durable journal/outbox captures edits, deletes, new uploads, tier and
visibility changes. Deletion wins over a stale retry; detect concurrent source
revisions. Never expose incomplete media or change ownership on an error.

Verification must compare body/field/attachment manifests and decrypted byte
hashes, validate audience admission/denial, rebuild without legacy bodies/S3,
and restore backups with keys. Include any PoC data in the inventory without
claiming to undo ciphertext already replicated on the public network.

Implement rollback before offering cutover. Pre-cutover: leave legacy source
authoritative. Post-cutover: fence writes, export/reconcile all Spaces changes
since checkpoint (including new posts, media and tombstones), then switch
routing back atomically. A global flag flip is insufficient. Reject rollback
if it would lose changes or restore deleted/unauthorized content.

Rehearse on synthetic data with text, images, video/derivatives and multiple
tiers: full migration, rerun, interrupted copy, partial blob writes, quota/outage,
OAuth expiry, concurrent edit/delete/tier/visibility changes, unexpected target
records, post-cutover new content, restore and rollback. Preserve stable URLs
and public post behavior. No source deletion in the migration command.

Write `docs/spaces-migration-rehearsal.md` with commands, sanitized manifests,
counts/hashes, checkpoints, timings, failure results and recovery/retention
procedure. Update readiness evidence, run meaningful integration and required
repository checks, then stop before production execution.
