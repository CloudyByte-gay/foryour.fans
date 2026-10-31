# Spaces 01 — verify readiness before implementation

Future task; **documentation only**. Read [the entry point](../atproto-spaces.md),
[design](../../docs/atproto-spaces.md) and
[gates/runbook](../../docs/atproto-spaces-readiness.md). Do not implement,
install alpha packages, migrate accounts, enable flags or deploy.

Re-read current official announcements, final specification or proposal 0016's
successor, released Lexicons/SDK/PDS support matrix, security-review reports,
release notes, upgrade paths and current reference examples. Follow links from
the sources in the design; do not assume its October 2026 snapshot is current.
Pin exact versions/commits and distinguish documented, live-tested and assumed
behavior. Upstream release expectations are not a release announcement.

Inspect the current repository/runtime configuration, content/media/key paths,
OAuth scopes, provider adapters, tier behavior and deployment readiness. Record
what actually shipped since this plan was written. Resolve final protocol
questions: creator-authority managed policy, service authentication, read/write
separation, private blob endpoints, proof-bound credentials, bounded revocation,
OAuth re-consent, source addressing, export/import and account migration.

Write `docs/spaces-production-readiness.md` with:

- Dated source links, version compatibility matrix, production/security support
  evidence and known breaking changes. No claim that alpha is production-ready.
- Each runbook gate marked proven, unverified or failed, with evidence and
  responsible follow-up. Separate upstream readiness from project readiness.
- Selected initial hosts and their adult-content policies, quota/media limits,
  backup/restore, supported migration and operational constraints.
- A concrete staging acceptance plan, including at least two PDS instances,
  failure/revocation/privacy/portability tests and numerical freshness, latency,
  revocation, availability and load budgets to measure in later steps. Derive
  budgets from product needs and upstream guarantees, not this old draft.
- Threat model: encrypted content inside permissioned storage, server key
  custody/moderation, creator recovery, allowed apps, irreversible downloads.
- **Prerequisite GO/DEFER** for steps 02–05 and separate **production GO/DEFER**.
  Production remains DEFER until staging/rehearsal/product gates are evidenced.

If upstream remains alpha, lacks production support/security evidence, or
required contracts are uncertain, record DEFER and the exact missing evidence.
Do not build a fake protocol to progress. Verify links and repository claims,
update the entry point's status, then stop. No application tests are needed for
this documentation-only review.
