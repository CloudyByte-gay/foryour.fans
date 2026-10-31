# Spaces readiness and migration runbook

Status on 2026-10-31: **DEFER production adoption**. This is a future runbook,
not evidence that a rehearsal or rollout occurred. Read [the design](./atproto-spaces.md)
and [the prompt sequence](../prompts/atproto-spaces.md).

## Evidence gates

All rows are **unverified** except the current alpha warning. The future report
must record dates, source/release links, versions, environment, results and open
issues. Unknown or failed gates mean DEFER; a calendar date does not mean GO.

| Gate | Required evidence |
|---|---|
| Upstream production release | Official production support, stable specs/Lexicons/SDK/PDS, supported upgrade/database migration paths; resolve alpha warning |
| Host compatibility | Capability probes on supported releases, at least two separate PDS instances; authority delegation, blobs, export/import and account migration |
| Security | Current upstream security-review evidence plus project review of OAuth, service auth, proof binding, crypto, SSRF and private caches; no unresolved critical/high findings |
| Paid access | Shared API/credential/key policy; expired/lapsed/past-due/canceled, wrong tier/creator/app, block and moderation denials |
| Revocation | Observed upper bounds for outstanding credentials, keys, URLs, caches and external syncers; accepted delay and retries documented |
| Portability | Creator recovery/export and another authorized service rebuilding bodies and playable media without billing export; PDS/key changes survive |
| Operations | Backup/restore, quotas/media limits, lifecycle events, sync gap recovery, load, alerting and incident response with measured budgets |
| Provider fit | Supported hosts permit adult creators and meet this project's moderation/retention requirements |
| Rehearsal | Synthetic migration, concurrent mutations, interruption/resume, rollback, no public leak, reconciled manifests |
| Product rollout | Project ready for intended real-user/paid operation independently of Spaces; compatible opt-in creators and explicit deployment authorization |

Step 01 establishes **prerequisite GO** for future staging implementation:
upstream release/security/support evidence and a concrete acceptance plan.
Steps 02–05 collect empirical evidence for remaining rows. **Production GO**
requires every row. GA alone satisfies only part of this checklist.

## Migration state and procedure

Persist per-creator/audience states, proposed as
`LEGACY → COPYING → VERIFIED → SPACES_PRIMARY → RETIRED`, with explicit retry
or blocked states. Preserve stable app post/media IDs and URLs. Record backend
choice and full source identities; never infer authority from a global flag
or a transient request failure.

1. **Inventory/dry run.** Count posts, attachments and all derivatives; collect
   revisions/hashes, keys, tier mappings, flags and quotas. Include any dev PoC
   records; already-public ciphertext remains historically exposed. Snapshot
   DB, object bytes and key recovery material. Produce a no-write manifest.
2. **Prepare.** Verify host support and creator consent/OAuth scopes. Provision
   creator-authority audience spaces with private managed policy. Record verified
   read/write admission. Install private sync and recovery before copying.
3. **Copy.** Idempotently encrypt/upload originals and derivatives into
   permissioned blobs, then write referencing records. Persist source revision,
   target references, hashes and checkpoints. Stable retry keys and host rate
   limits prevent duplicates; partial copies never become visible.
4. **Reconcile.** A durable journal/outbox captures concurrent edits, deletes,
   tier and visibility changes. Source revisions detect conflicts. Deletions
   win over retries. Verify audience access and detect unexpected target data.
5. **Verify.** Compare counts, fields, attachment order, byte hashes and policy.
   Rebuild from Spaces without legacy bodies/S3; test denial paths, key recovery
   and backup restore. A successful write response alone proves insufficient.
6. **Cut over.** Briefly fence cohort writes, drain the journal, verify the final
   revision, switch authoritative routing atomically, then resume. DB/S3 become
   private caches or explicitly retained rollback snapshots for migrated data.
   Unmigrated objects keep their persisted backend.
7. **Observe.** Opt-in canary before widening. Measure access denials, sync lag,
   media errors, latency, quotas, reconciliation and revocation against recorded
   budgets. No public diagnostic mirrors or fallback on outage.
8. **Retire.** After an agreed rollback window, successful recovery evidence and
   explicit cleanup authorization, delete redundant legacy bodies/objects and
   retire obsolete code. Preserve mappings, required operational records and
   backups/keys needed for recovery or retention obligations.

## Rollback and outages

Before cutover, stop copying and keep the unchanged legacy source. Clean up
only safe target orphans identified as belonging to the migration job.

After cutover, turning a flag off is **not rollback**: Spaces may hold new
posts, edits, bytes and deletions. Fence writes, export and verify changes
since the checkpoint back into the private legacy backend, reconcile keys and
tombstones, switch routing atomically, then resume. If integrity is uncertain,
hold affected operations unavailable rather than serve stale deleted or
unauthorized content. Rollback cannot undo historical public exposure.

Private-data outages fail closed. Authorized private-cache use must stay within
recorded freshness/policy budgets and must never override a current denial.
If a migrated host loses capability, surface recovery status rather than
silently changing ownership or directing users to experimental hosts.

## Future deliverables

- `docs/spaces-production-readiness.md`: dated evidence/version matrix,
  prerequisite and final production GO/DEFER, decisions and acceptance budgets.
- `docs/spaces-implementation.md`: implemented contracts, source mappings,
  OAuth, key custody/export, sync and authorization boundaries.
- `docs/spaces-migration-rehearsal.md`: manifests/counts, interruption,
  rollback and recovery evidence.
- `docs/spaces-rollout.md`: authorized operator/cohort, versions/checkpoints,
  alert thresholds, stop conditions, outcome and retention decision.

These reports do not exist yet. Never commit secrets, plaintext, subscriber
identities or credential payloads as evidence.
