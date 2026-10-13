# Staged spec delivery evidence

Scope: correct the file metadata sent to workers and the hash used for inherited
Codex admission. Keep original assessed task hashes, receipt handling, terminal,
model, repository, dispatch identity and owned inventory checks.

Control classified this as Hard because the admission predicate determines
whether a worker inherits reviewed authority. Jev was not evaluated under the
known security and admission exclusions. This is direct work, without a Dely
implementation run. The candidate uses the upstream merge `66d1116` as its base
and preserves unrelated work in the main checkout.

## Reproduction and fix

The focused admission test rejected a correct snapshot hash before the fix.
The dispatch test executed the helper's actual dispatch function and found
42 advertised bytes versus 270 staged bytes, including the receipt footer.
Both the AGY staging case and the verified-model-absence Codex fallback failed;
inline delivery passed. The test isolates provider and Orca I/O and uses a
private temporary repository, without real dispatches or global journal writes.

The worker pointer now uses `snapshotBytes` and `snapshotSha256`. Admission
uses the snapshot hash when present, otherwise the original prompt hash.
Route validation continues to use the original prompt hash. All 81 tests in
`scripts/test-codex-compliance.js` and `scripts/test-staged-dispatch.js` passed,
including wrong, stale and original-only staged claims and retained authority
checks. The software version and required manifest/version gates advance to
0.27.1 together.

## Verification boundary

Eleven of twelve structural checks passed. With `jq` unavailable on the Windows
PATH, Node performed the equivalent JSON, schema, version and README-row checks;
Git and Git Bash performed the actual lexical, whitespace and shell checks.
The retired-identifier gate fails on twelve pre-existing model-check references,
including `PIN_CHECK_DEFAULT_S`, `waitShownModel` and `pin_not_applied`. The same
twelve hits exist in base `66d1116`: its updated AGENTS gate forbids these names
while the local helper still contains them. This fix neither introduces those
references nor removes the model checks the owner required preserving.

The independent archived-candidate verification is pending. Runtime refresh is
blocked by that pre-existing closure inconsistency. Required live checklist rows
remain unevaluated; no structural check substitutes for them. Runtime changes
require a passing relevant probe and byte-for-byte preservation of both existing
hooks manifests. No native hook trust or model-routing policy change is part of
this fix.
