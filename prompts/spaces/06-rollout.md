# Spaces 06 — separately authorized production rollout

Future operations task. Read [the entry point](../atproto-spaces.md),
[runbook](../../docs/atproto-spaces-readiness.md) and all preceding reports.
This file itself **does not authorize deployment, real-account migration or
data deletion**. Before executing those actions, require explicit authorization
in the implementation session and a current production GO with every gate met.
If absent, prepare the concrete version/cohort/config/dry-run evidence for review
and stop before production changes.

Revalidate upstream support/security, pinned versions, host capabilities,
creator opt-in/OAuth scopes, backups and key recovery. Confirm real-money and
other product launch blockers independently of Spaces. Record operator, initial
cohort, load and alert/stop thresholds, retention window and recovery owner in
`docs/spaces-rollout.md`; do not invent a universal canary size or soak duration.

Execute the rehearsed no-write inventory first, reconcile live counts/quotas,
then follow the runbook for selected creators: prepare, copy, journal/reconcile,
verify, fence/drain and switch authoritative routing. Test real entitlement
denials and playable media with approved test actors without exposing content.
Keep unsupported/unmigrated creators on their recorded backend. The global
enable flag permits routing, not a blind all-data switch.

Watch measured revocation, private sync, authorization/credential failures,
PDS/blob errors, queue lag, quota, latency and reconciliation. If a stop threshold
is crossed, halt cohort expansion and follow rehearsed recovery/rollback;
never public fallback or a flag-only rollback. Record actual post-cutover
mutations and ensure they survive any reverse migration. Widen only after
agreed evidence/soak criteria are met.

Update rollout/readiness/status docs with actual results and remaining cohorts.
Do not mark full migration complete until bodies and all media are portable,
private views rebuild without legacy sources, and recovery is proven.

Legacy cleanup is a **later, separately authorized operation** after retention
and recovery criteria: delete only verified redundant source bodies/objects,
retain required records/backups/keys, and remove obsolete code/flags after all
cohorts are accounted for. Preserve the guard against public gated-content writes
unless that entire PoC is deliberately removed. Record cleanup evidence and
post-cleanup recovery limits. Never equate deindexing with erasure from other apps.
