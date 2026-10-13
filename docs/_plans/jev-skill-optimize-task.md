# Native skills and optional Jev: task checklist

Updated: 2026-10-12 (+07:00).
Plan: [Jev skill-advice optimization](jev-skill-optimize.md), proposed follow-up dated 2026-10-12.
Status: RELEASED / VERIFIED, including worker admission follow-up.

The preceding planning turn authorized documentation only. The user has now requested implementation of this plan/task and repair of the blocking preparation defect. That authorization supersedes the planning-only restriction; deployment still requires the release gates below. Preserve standalone full-catalog advisor semantics while deliberately changing its compliance integration.

## Work items

| ID | Work and deliverable | Owner | Depends on | Status | Completion evidence |
| --- | --- | --- | --- | --- | --- |
| JEV-NATIVE-00 | Update the existing plan, preserve its prior contract, and create this checklist | Current coordinator | None | DONE | Readback, valid internal links, scoped diff check, unchanged runtime source hashes and pre-existing tracked diff |
| JEV-NATIVE-01 | Refresh baseline; characterize current native discovery, admission and deployed hook targets; add regression fixtures | Implementing Codex Control | 00 | DONE | HEAD f9dfa921; 26 baseline file copies/hashes; actual 105-skill roster and Control review; 109/109 baseline tests; five discriminating regressions observed failing |
| JEV-NATIVE-02 | Make native selection the default; separate optional advice from admission; scope selected-source snapshots and handle old state | Implementing Codex Control | 01 | DONE | Native schema v3; zero default advice calls; scoped body hashes and all roster alias bindings; same-turn nonce and independent prompt marker; 129/129 focused tests |
| JEV-NATIVE-03 | Retain on-demand advice using the existing CLI and caller-scoped candidates | Implementing Codex Control | 02 | DONE | Existing advisor source unchanged; HTTP/timeout/invalid advice failures remain independent; operational filtering and empty-input tests; full-catalog 106/500/1000 regressions pass |
| JEV-NATIVE-04 | Run integrated controls, update affected guides and review the exact candidate | Control and independent reviewer | 02, 03 | DONE | Exact HEAD 7a62b9d50da425c1c5c3457e7549f732580d7ded independently accepted; 129/129 tests and closure pass; prior review findings received discriminating regressions and fixes |
| JEV-NATIVE-05 | Compare current and candidate workflows on the agreed paired task set | Verifying Codex Control | 04 | DONE | Exact candidate 7a62b9d; eight cases, three paired repeats, 48 admission fixtures PASS; baseline 70 skill-advice calls versus native 0; both 21 task-assessment calls; zero required-set misses; median admission latency 2956ms versus 567ms; token/cost and stochastic agent quality NOT_MEASURED |
| JEV-NATIVE-06 | Release between tasks to the actual active Codex homes and verify rollback | Release operator under implementation authorization | 05 | DONE | Accepted HEAD 7a62b9d installed in both homes; source/installed SHA-256 f56d809e03e818a60ef7228c9835104841df4dcce578c201741d0e62b38352d6; hooks unchanged; fresh native CLI session PASS with 54,919-byte file input and actual pre/post-review denial/allowance; four isolated exact-bundle rollback rows PASS |
| JEV-NATIVE-07 | Repair worker claim loss during preparation and clarify inherited admission | Codex Control and independent reviewer | 06 | DONE | Exact HEAD 37378486489853424fec9c685ef5f2925bdaa42f independently accepted; two regressions red on 7a62b9d, 131/131 green including actual configured PowerShell hook command; both installed scripts match SHA-256 7a7baec997c2f3f4da2b30947e55b6e5eb01d273a07ff5cbffb1238a3c7398f5; hooks unchanged; actual worker's current Control review validates PASS and live terminal shows successful notebook cell operations |

Dependencies refer to the numeric suffix of JEV-NATIVE. Do not mark a task DONE merely because its test or rollout procedure has been written. Attach observed evidence and the candidate revision before closing implementation items.

## Execution boundaries

The future implementation changes the admission contract and must receive a fresh risk assessment under the existing project policy. Do not dispatch an implementation worker from this documentation turn. Native selection changes how skills are chosen, not whether Dely is required. Existing task-difficulty assessment, model pins, quota behavior, context ranking, approvals, worker identity and dispatch checks stay in force.

Expected implementation surface: `scripts/codex-compliance.js`, its focused tests, the smallest necessary advisor integration/tests, and affected usage guides. Do not refactor task-routing/dely modules, install skills, edit global skill policies, alter API keys, add a service, introduce top-k selection or implement a new catalog cache. Do not amend historical task/advice records to manufacture successful evaluation.

Before editing runtime, refresh the dirty-worktree baseline. Planning observed branch `master`, HEAD `f9dfa921a1d17385b072359c3afe826144f8e901`, with unrelated tracked and untracked changes. Keep those changes. Use the exact active hook home supplied by runtime evidence rather than assuming Orca's local directory is an independent hook target.

## Verification matrix

| Case | Expected candidate result | Required evidence |
| --- | --- | --- |
| Native preparation, key present or absent | No skill-advice provider call; routing assessment remains a separate operation | Per-purpose call counters, not a blanket assertion that Jev is never called |
| Known mandatory skills | Every required skill retained and instructions available; optional suggestions are not required | Selected source list and required-set assertion |
| Valid direct and Dely tasks | Same reviewed routing requirements as baseline | Matched direct/delegated fixtures and dispatch receipt |
| No remote advice file | Otherwise valid native admission proceeds without a fake provider status | Native prepare/review/validate fixture |
| Optional HTTP error, timeout or invalid reply | Honest failed-advice record; independent valid admission unaffected | Injected provider failures with route checks still active |
| Explicit-only policy | Unrequested selection denied; a genuinely explicit/mandatory selection accepted; advisory suggestion alone is insufficient | Positive and negative invocation fixtures |
| Disabled or ambiguous source | Disabled selection denied; duplicate-name selector requires an unambiguous original path | Source-policy and selector tests |
| Multiple useful candidates | No arbitrary top-k loss; every relevant required selection retained | Complementary-skill fixture and standalone advisor regression |
| Empty optional candidate set | No provider call; no invented recommendation | Empty-input test |
| Selected source, policy or alias changes | Admission invalidated, including alias retargeting and absent policy becoming present | Before/after source-binding tests |
| Unrelated skill-body changes | Native admission remains valid | Modify only a nonselected/nonrequired skill body in an isolated fixture |
| Task/spec/context/instruction/config changes | Existing review invalidated as required; conservative active-config check preserved | Frozen-evidence negative controls |
| Stale turn, wrong workspace/model | No write authorization from previous or mismatched evidence | Independent denial cases |
| Missing/wrong Dely run or dispatch | No authorization; valid matching dispatch still works | Wrong/missing receipt and valid receipt cases |
| Worker claim or later unrelated prompt | Text-only claims do not confer worker admission; unrelated prompt loses the exception | Worker identity and turn-binding fixtures |
| Native allowed read and Stop behavior | Existing read-only inspection works; unresolved Stop does not loop indefinitely | Fresh native-session and adapter tests |
| Prior-state migration | Old records cannot be silently marked reviewed under new semantics | Legacy fixture, explicit reprepare/review and preserved old artifact hashes |
| Deployment and rollback | Both actual hook targets behave correctly after release and restoration | Bundle hashes, native trust observation, deny/allow checks |

Do not treat native instruction loading as proof that a model understood every instruction. Do not widen shell exemptions while fixing advice coupling. Hook bypass limits and unsupported native event fields remain explicit limitations, not reasons to invent evidence.

## Baseline and focused tests

The commands below were executed for the accepted candidate using the available native Node executable. The focused set passed 129/129 tests; syntax and repository closure checks passed. Preserve pre-existing failures in the baseline; fix only regressions attributable to this change.

```powershell
node --check scripts/codex-compliance.js
node --check scripts/jev_agent.js
node --test scripts/test-jev-agent.js scripts/test-jev-skills.js scripts/test-jev-multi.js scripts/test-codex-compliance.js scripts/test-task-routing.js scripts/test-task-risk-cases.js
git diff --check
```

Run the relevant existing worker/quota regressions and repository closure gates as required by the final diff. A change to worker-launch behavior additionally triggers the repository's `probe/checklist.md` requirement; do not claim that syntax/unit checks substitute for it. The implementation should not need to change worker launching.

For native-path tests, isolate task assessment from skill-advice counters so the intended removal is measured accurately. Keep the current full-catalog advisor tests: only integration expectations that make its call mandatory are intentionally replaced. Add assertions for present, absent and changing selected-policy files before removing full-catalog snapshots.

## Paired evaluation and release gate

Use eight representative tasks with three paired repeats per configuration: simple edit, bounded bug fix, mandatory workflow, complementary skills, explicit-only request, discovery ambiguity, direct-route task and delegated task. Use safe fixture repos and match prompts, model/effort, catalog and initial data. Do not use production mutations as benchmark work.

Compare required-skill misses, task/test outcomes, unnecessary loaded skills, skill-advice API calls, task-assessment calls separately, time to first useful tool action, total time and prepare/review repetitions. Record real token/cost values only when exposed. The prior 169-record payload simulation is supporting evidence, not an end-to-end benchmark or a calibrated cost estimate.

All execution-control tests must pass. The default path must make zero skill-advice calls, mandatory skills must not be missed in the agreed set, and unresolved functional regressions prevent rollout. A reported latency saving requires observed paired results; do not substitute packet-size reduction for latency evidence.

Release from the accepted snapshot between active tasks. Preserve the actual hook definitions and native trust unless a separately reviewed change is necessary. Back up only owned adapter/frozen-advisor/guide/settings files without copying secrets into new packages. Verify both effective homes in fresh native sessions. Restore only the owned bundle for rollback, preserve unrelated later edits, then repeat review and denial/allowance checks.

## Historical planning evidence

Start future work at JEV-NATIVE-01 after implementation is requested. Re-read the proposed follow-up, current AGENTS.md, the effective hook guide and current source; do not treat this plan as permission to bypass their execution requirements. Reuse this checklist and attach results here rather than creating another tracking system.

Current document update: DONE. Readback and internal-link/format checks passed; the scoped plan `git diff --check` passed. The prior plan body was compared with HEAD and preserved. The pre-existing tracked diff retained SHA-256 `aa36990dea6afdc70185e6d2a69b8daf89c92853941da772e01a517504824011`; `scripts/codex-compliance.js`, `scripts/jev_agent.js` and `AGENTS.md` retained their before-edit hashes. The only writes in this turn are this checklist and the proposed follow-up in the existing plan. Native/default and optional/advisory responsibilities, implementation dependencies, acceptance, measurement and rollback are documented. No runtime tests, provider experiments, installations, commits or pushes have been performed in this planning turn.

## Initial release evidence (2026-10-12, 7a62b9d)

All JEV-NATIVE work items are complete. Source and affected guides are committed at `7a62b9d50da425c1c5c3457e7549f732580d7ded`; independent Codex Control review accepted that exact source. Both installed adapter copies match the source SHA-256 above. Both actual hook configurations still call the same central adapter with the same central effective home, so there is one active admission target. Hook configuration hashes were preserved byte-for-byte; credentials, model pins, routing modules and the standalone advisor source were preserved.

Fresh native Codex CLI session `01a12ec7-102f-7640-a2b5-fd6c13f5bb33` observed the actual tool gate: notebook Add File denied before review, exact current-turn input Add File allowed, installed prepare/review successful with all required skills retained and `advice_status: NOT_REQUESTED`, notebook Add File allowed after review. Input was 54,919 UTF-8 bytes, passed by `--task-file`. The live TUI showed Codex Sol/xhigh. Native tool events themselves do not independently expose reasoning effort. No second independent hook target or fresh session is claimed for the Orca-home copy; its matching bundle and shared central command were verified. PowerShell profile diagnostics and an unavailable hashing cmdlet were recorded; exact file hashes were obtained with native Node crypto.

Machine-local evidence: `.tmp-dely/native-skills-20261012-01a12e2a/native-cli/report.json`, `paired-results-v3.json`, and `release/rollback-proof.json`. Owned six-file backups are under `release/home-0` and `release/home-1`. Rollback was rehearsed in isolated homes using each exact backed-up bundle and actual PowerShell hook command, with fresh prepare/review and wrong-model/turn controls; four rows passed. Live homes retain the accepted release. Paired results measure admission fixtures with fixed Control selections, not stochastic agent task quality, tokens or cost; those remain NOT_MEASURED. PLAN/TASK edits remain in the worktree to preserve their pre-existing uncommitted content. No remote publication was performed.

## Worker follow-up (2026-10-12)

The user reported a real dispatched Luna worker receiving Control preparation guidance. Its actual native prompt contains the current staged spec hash and its dispatch/owned inventory match; read-only replay of `verifiedWorker` with the actual terminal succeeds. The worker nevertheless prepared its own task, and `prepare` discarded the native `worker_claim`. The resulting PREPARED state cannot inherit Control admission and pushes the worker toward self-review. A discriminating regression reproduces allowed mutation before prepare and denial afterward. The follow-up retains only the current prompt claim across preparation and clarifies worker versus Control instructions without weakening dispatch, model, terminal or prompt checks. The original 06 verification covered a direct native Control flow; this specific worker transition was omitted from that acceptance and is now repaired separately. Existing active All_Data work was not replayed or edited by this repair.

Final source `37378486489853424fec9c685ef5f2925bdaa42f` was independently accepted. Both installed script copies match SHA-256 `7a7baec997c2f3f4da2b30947e55b6e5eb01d273a07ff5cbffb1238a3c7398f5`; hook definitions remain unchanged and owned six-file before bundles are backed up. All 131 focused tests and closure checks pass. The worker-transition regression also invokes the actual configured PowerShell hook command in a private fixture and observes exit0/JSON{}. The actual worker's current Control-reviewed state validates PASS read-only, and its live terminal shows successful notebook cell operations. No fresh live worker or product job was launched; current worker activity alone is not proof of inheritance without its Control review. The separate discriminating regression proves preservation across prepare and the wrong-model/missing-handle/unrelated-prompt denials. Evidence: `.tmp-dely/worker-admission-20261012-01a12f02/report.json` and `before.json`. Historical paired measurements were not rerun or relabeled for this narrow correction.
