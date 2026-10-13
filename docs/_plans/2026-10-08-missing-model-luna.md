# Verified model absence to Luna/max

Date: 2026-10-08
Version: 0.24.5
Authority: the owner explicitly requested direct Luna/max when a model is
missing. This replaces the earlier stop-on-absence decision, preserving
the existing quota chain and other stop conditions.

## Contract

One automatic dispatch branch handles a successful, nonempty AGY catalog
that lacks the requested model. It chooses the approved Codex Luna/max pin,
skips Flash, rechecks the assessment and uses existing native startup proof.
Discovery/auth/timeout/unusable catalog/footer mismatch still stop.
Hard and stale assessments remain blocked. Requested/effective pins and
model_unavailable are auditable. There is no public flag to assert absence.

## Verification

- Source tests: 26 passed including 16 task-routing checks.
- Adapter fixture: 33 passed, including primary/Flash absence, authentication,
  unusable catalog, stale-during-discovery and wrong Luna effort cases.
- Startup discrimination: the old 30-second candidate fails the added late
  prompt case (30 pass / 1 fail); the fixed helper passes. A known uncertain
  receipt with a Dispatch is observed in place, never relaunched or replayed;
  a visible prompt permits one Enter, and fresh turn evidence remains required.
- Independent live probe: PASS_AUTOMATIC_V03 for frozen tree
  5e64d0ad1cfcc531a3f8f4e511fd450995b62414. Native GPT-6-Luna max completed
  the exact 53-byte sentinel and worker_done without manual recovery or replay.
- Global and POC copies plus current plugin cache: installed 0.24.5, helper
  SHA-256 f585d694a097f5bb3f45a29c35f8ac099c668473887b154a230c042edb5eacdd.
  Installed adapter 33/33 and loop guard PASS. Plugin readback is enabled 0.24.5.
- Old 0.24.4 caches were restored from the original frozen snapshot after the
  plugin manager removed them during add; the original helper hash matches.
- Control review: APPROVED. Probe worker/observer PTYs are closed. Orca retains
  historical external-terminal resource metadata, not live probe processes.

The original scratch Git-root probe was trust-blocked; no trust dialog was
answered. Subsequent probes used the already trusted root with an isolated
output scope and tracked-file hashes. Failed/recovered earlier rows remain
historical evidence. The live verdict applies to this Windows missing-model
branch; unrelated broad checklist rows remain NOT_EVALUATED as documented by
the independent verifier, so this is not a complete multi-harness release claim.

The frozen input/baseline and detailed evidence are under
.tmp-dely/model-unavailable-luna-20261008/. Existing changes stay preserved;
there is no Git push or Dely delivery run for this Hard implementation.
