# Local Dely usage monitor

The owner requested control of Dely/model usage and preferred a UI. This
delivery builds a local browser dashboard with Node and native web APIs.
Existing four-tier routing and all quota/availability guards remain in effect.

The monitoring/metadata surface is Hard work because it handles private local
activity and changes routing observation. Codex Control implements and verifies
it directly without creating a Dely delivery run.

1. Preserve the current dirty baseline and review the source-backed assessment.
2. Add metadata-only assessment observation and a loopback dashboard over local
   logs, Codex conversation metadata and read-only Orca worker records.
3. Test unknown/missing fields, stable task and dispatch IDs, filtered denominators
   and metadata redaction; verify desktop/mobile UI and functional filters.
4. Activate the reviewed local version with installation backups and preserve
   the physically shared native/runtime cache versions.

The UI distinguishes configured task routes, effective implementation pins,
Codex conversation models, attempted launches and durable outcomes. A missing
source or unknown classification must not turn into a numeric zero or assumed
model. No fixed aggregate model percentage is imposed on task difficulty.

Status: implemented, reviewed and activated at 0.24.8 in both Codex profiles.
The local monitor remains available at http://127.0.0.1:8787 and local opt-in
logging is enabled. Existing model routing and launch-helper bytes are unchanged.

## Verification

- Monitor, routing and advisor tests: 36/36 passed. The monitor's nine focused
  checks cover task/dispatch identity, fallback counts, correct denominators,
  unknown fields, opt-in behavior, redaction and loopback API boundaries.
- Desktop: 1440px; mobile: 375px. Real-source browser checks reported no page
  errors and no document horizontal overflow. Time-window filtering changed
  the conversation count; workspace filtering and manual refresh completed.
- The first observed dataset contained 296 Orca records and 79 filtered Codex
  conversations. Missing implementation models remained Unknown. One actual
  Hard approval was recorded; the eligible-task adoption denominator was empty,
  so adoption remained unavailable rather than zero.
- Candidate tree: b365b61b1a04e4fb21245327bd3eb31175082105, installed from its
  git archive. Cache/runtime hashes match, both profile registrations are enabled,
  and old cache versions were restored byte-identically from full backups.
- Installation patch applies against frozen upstream
  ce7a29cc0edb351c256162e8f5076f42ba69234f with the existing POC/global namespace.
- The helper that launches workers is byte-identical to the 0.24.7 verified
  deployment. No worker-launch rows are changed by this observer-only release.

The Orca browser connection closed during screenshot calls. The local UI
remained available and was independently verified using installed Edge through
Playwright. Browser evidence, API receipts, backups and activation records are
under `.tmp-dely/usage-monitor-20261009/`.

## Limits

Historical work without classification/log records is not a complete task
cohort. Actual model/role fields are often absent from older Orca records;
conversation turn counts are therefore not combined with worker model shares.
Undated Orca inventory is a current snapshot. The interface records and shows
these limits instead of assigning a model or grade by inference.

The unchanged Bash scripts retain the prior CRLF syntax-gate limitation.
This release creates no Git commit, push, remote site or scheduled task.
