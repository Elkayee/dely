# Four-tier task routing

The owner requested Easy, Medium-, Medium+, and Hard, with Flash handling
Medium- and easier work. Medium+ retains Sonnet High/default; Hard retains
direct Sol/xhigh. Every delegated grade has one explicit quota fallback:
Luna/max. Proven model absence remains a separate Luna branch.

This change affects worker routing and is therefore implemented directly by
Codex Control as Hard work. No Dely delivery run is created for this change.

1. Record the source-backed Hard assessment and preserve the existing dirty files.
2. Update the four-tier policy, dispatch selection, instructions and regression fixtures.
3. Run focused routing/quota tests and the repository closure gates.
4. Verify an archived candidate in a separate probe session, review the final diff,
   and activate the verified plugin version with backups of replaced task files.

Medium- means a bounded internal adjustment with known ownership, low
coupling and focused existing acceptance. Medium+ coordinates known internal
components and integrated acceptance. Consequential security, data, public
contract, architecture, production or routing effects remain Hard.

Status: implemented, reviewed and activated at 0.24.7 in the native Codex
and Orca runtime profiles. Both registrations are enabled and their installed
runtime hashes match the independently verified archive. The profiles share
one physical plugin cache. Task-owned baseline and installation backups are
under `.tmp-dely/flash-tier-routing-20261009/`.

## Verification and activation

- Routing/advice tests: 27/27 passed.
- Quota/launch/preflight fixture checks: 46/46 passed, including all four grades,
  stale-policy rejection, primary/fallback model argv and task preflight.
- Independent archived-candidate live probe: PASS. AGY 1.3.2 displayed
  Gemini 3.8 Flash / high before dispatch; the Medium- task produced the exact
  LF sentinel and durable worker_done succeeded. Orca version: 1.4.219.
- Verified runtime tree: 6af31eb7632e263283e3e7591ff62aebffe8c9f4.
  The initial tree's only subsequent runtime-independent edit normalized empty
  installer-patch context prefixes. Helper SHA-256:
  5e28e61e828f76a3b38f4118263175efa1cbe8a459e35b99da6c3a2db0494722.
- The installer patch preserves the original dely-orca-agy-poc namespace;
  the global copy preserves dely-orca-agy-global. The namespace correction
  changes no worker-launch bytes. Cached patch application against the frozen
  upstream ce7a29cc0edb351c256162e8f5076f42ba69234f passed.
- The plugin manager removed old caches during add. Versions 0.24.4, 0.24.5
  and 0.24.6 were restored from their frozen snapshots. All recorded 0.24.6
  runtime hashes match their pre-update values. Agent instructions outside the
  managed global block remain byte-identical.
- The observer and worker terminals were closed. One staged prompt remains
  as intentional audit evidence. Detailed live evidence is in
  `.tmp-dely/flash-tier-routing-20261009/live-probe/`.

## Limits

git diff --check, JSON/shape/version gates, Node syntax and identifier/README
checks passed. Direct Bash syntax gates fail on pre-existing CRLF in
probe/mkrepo.sh, probe/trust.sh and skills/delivery/scripts/dely, including
their original archived blobs. Their LF-normalized stdin syntax passed; these
untouched files were preserved rather than reformatted outside this change.

Jev accepted the new five-label Choice wire format but abstained for missing
source evidence in the explicitly synthetic smoke case. That record remains
NOT_EVALUATED; no classification accuracy or confidence calibration is claimed.
The live result covers the local Windows AGY deployment and named applicable
rows, not a complete multi-harness release certification. There was no commit,
push or Dely delivery run for this Hard source change.
