# Jev skill-advice optimization

> Release update, 2026-10-12: the native-skills follow-up, including the worker correction, is RELEASED / VERIFIED at source revision `37378486489853424fec9c685ef5f2925bdaa42f`. All items in its [task checklist](jev-skill-optimize-task.md) are complete. Both installed homes match the accepted source. Initial release `7a62b9d` included a fresh native Control CLI verification; the worker correction separately verifies preservation across prepare through the configured hook command. The 2026-10-10 contract and original planning restrictions below are retained as historical evidence.

Approved by the user on 2026-10-10 after the shared-state payload proposal and full-catalog clarification. Hard: public advisory output and the explicit-only loading boundary change; Codex Control implements directly and independently reviews the final HEAD.

## Contract

Evaluate every enabled record discovered under HOME/.agents/skills, including explicit-only skills. Preserve original names, complete descriptions, IDs and local paths. Return every direct/supporting recommendation; mark explicit-only suggestions as requiring explicit invocation. Disabled entries stay unevaluated. Control must retain mandatory/user-selected skills and may load explicit-only records only when the task's required_skills records that explicit or mandatory requirement. Never change skill policy files.

Store the common task rules and four relation definitions once in State. Keep each skill's metadata once in its own independent Choice. Use conservative UTF-8 bounds:60,000 bytes for a packet and30,000 for shared State plus an individual question, separately. These are transport guards, not tokenizer measurements. Keep sequential HTTP packets unless real measurements establish a need for added concurrency. No shortlist, top-k, catalog-only advice cache, new dependency, or changed context advice.

## Execution and acceptance

1. Existing public advise seam: red/green regression for enabled explicit-only evaluation, all useful suggestions, unchanged records, and disabled uncertainty; then compact payload/size-bound coverage for152/500/1000 catalogs.
2. Existing prepare/review seam: expose explicit flags in compact CLI output; reject unrequired explicit-only and disabled selection before reading instructions; accept recorded mandatory/user-selected explicit invocation. Keep snapshot and selector integrity.
3. Compare current and candidate requests against real Jev using only the actual home metadata. Record coverage, body bytes, call count, timing, all returned suggestions and reviewed decisions. Check useful complementary workflows and unrelated controls; do not invent calibration or deterministic result equivalence.
4. Run focused regressions and repository closure; fresh independent Codex exact-HEAD review. Install both Codex homes from accepted source, preserve trusted hooks byte-for-byte and credential_root D:/orca, then demonstrate full-catalog prepare and multiple accepted skills loaded through review.

Scope:advisor, focused compliance integration/tests, agent-facing guides and this plan. Leave D:/orca and unrelated Taniwha state untouched. No remote publication is requested.

---

## Native skills by default (2026-10-12)

Implementation update, 2026-10-12: the user requested continuation of this plan/task and explicitly requested repair of the blocking preparation defect. Implementation is now authorized; the planning-only restrictions below describe the preceding documentation turn. Runtime installation remains gated by accepted source, comparative checks, independent review and rollback proof. Control reviewed the actual 105-skill session roster and every Jev suggestion, recorded the concrete security/public-contract/routing admission effects as Hard, and retained the direct Codex Sol/xhigh route. No Dely implementation worker is launched for this Hard change.

Baseline: `f9dfa921a1d17385b072359c3afe826144f8e901`, branch `fix/native-skill-admission-20261012`; 109/109 focused baseline tests passed. The original 26-file workspace snapshot is machine-local under `.tmp-dely/native-skills-20261012-01a12e2a/`. Five focused regressions failed on the original implementation, covering native preparation, unrelated source edits, task-input staging, Node flag commands and legacy-state admission. Those five passed on the initial candidate; final integration and release gates subsequently passed as recorded below. The input staging defect was bootstrapped through the existing `prepare --task-file` console input surface and full Control review before source mutation; native hook definitions and trust were preserved.

Status: RELEASED / VERIFIED. User implementation authorization above superseded the earlier planning-only scope. Native preparation and local skill selection are now the installed default; standalone Jev skill advice remains optional through its existing CLI. Historical planning restrictions below describe the preceding documentation turn.

### Goal and boundary

Make Codex's native skill discovery and selection the default. Remove mandatory remote skill advice and whole-home catalog processing from the normal compliance path. Keep Jev skill advice available on demand through the existing command. Preserve task-difficulty assessment, Control review, Dely routing, worker identity and dispatch verification.

Native skill selection is not permission to implement directly. Easy/Medium routes still follow the reviewed Dely policy; Hard follows the existing direct-Codex route. Zero skill-advice API calls does not mean zero Jev calls: task assessment remains unchanged. Context Engine ranking and its provenance rules are outside this change.

Prefer this separation over either filtering the mandatory full-catalog call while retaining it, or uninstalling the four hooks. The first leaves duplicated selection in the critical path; the second removes unrelated execution controls. Add no new service, dashboard, dependency, semantic router, confidence threshold, automatic retry loop or catalog cache.

### Evidence and limits

The 2026-10-12 assessment inspected the session prepared at 2026-10-11T17:09:07.664Z (2026-10-12 00:09:07 +07:00). Its task directory is `C:/Users/Home33/.codex/dely-compliance/tasks/6052541eca3d6388bca4462b/`. The supplied roster had 106 skills; the combined roster had 169. The 63 added records were explicit-only and none was required for that task. Three provider calls evaluated 169 records; the final three selections exactly matched the pre-existing required set. This is one example of redundant work, not proof that advice never helps.

A local, no-network payload simulation produced 127,837 bytes in three packets; excluding the 63 unrequired explicit-only records produced 77,153 bytes in two packets. Those are payload measurements, not token, price, quality or end-to-end latency results. The approximately 18 ms fingerprint-read observation was one local sample, not a complete hook benchmark. Preserve these qualifications in subsequent reports.

Planning checkout: `D:/orca`, branch `master`, HEAD `f9dfa921a1d17385b072359c3afe826144f8e901`. Existing tracked and untracked work was present before this update. Refresh that baseline before implementation; do not switch branches, clean worktrees, commit unrelated files, or treat the older `main` label in AGENTS.md as the current branch.

Source anchors inspected: `scripts/codex-compliance.js` prepare/review/validate/hook/install and `scripts/jev_agent.js` adviseSkills. Current `prepare()` calls skill advice unconditionally; review expects its output; mutation validation checks the complete prepared fingerprints. Recheck symbol locations against the implementation HEAD instead of relying on stale line numbers.

OpenAI's [Build skills documentation](https://learn.chatgpt.com/docs/build-skills), checked 2026-10-12, describes native explicit/implicit selection, loading full instructions only when selected, and invocation-policy controls. It also warns that a large initial catalog may be shortened or partly omitted. Therefore the candidate must test native discovery with this machine's catalog rather than assuming perfect coverage.

### Target behavior

1. **Default preparation.** Use the actual native session roster and explicit/mandatory requirements already supplied by Control. Do not call `advisor.advise(..., "skill")` or automatically merge the entire home catalog. Preserve existing task assessment and its evidence-based failure handling. Record native selection provenance; a deliberate skipped advisor call must not be mislabeled as successful Jev evaluation or as a provider failure.
2. **Local review.** Codex chooses skills; the adapter validates admission, not semantic relevance. Keep unambiguous source selectors, required-skill retention, disabled-skill rejection and the explicit-only boundary. Control still records its selection reason. Retain the existing instruction-loading output where required by the contract; do not remove it merely because another component claims the instructions were read.
3. **Scoped integrity.** Freeze task/spec/context, required instructions, selected and required skill sources, their canonical path bindings, invocation-policy files (including absence), and existing executable dependencies. Preserve the current conservative active-config fingerprint initially. Stop fingerprinting unrelated skill bodies in the default admission path. An unrelated skill-body edit must not invalidate admission; a selected-source/policy/alias change must. A config change may still require review. Selected sources must be stable while being read and admitted.
4. **Optional advice.** Use the existing `jev_agent.js skill --repo ... --input ... --out ...` command only when the user asks, relevant candidates compete, or native discovery demonstrably misses a needed workflow. Control supplies current, task-relevant evidence and reviews the output. An optional-advice timeout, missing key or invalid response must not create an additional denial if all independent execution requirements are satisfied. Retain `NOT_EVALUATED` honestly for a failed call.
5. **Task-focused candidates.** For operational advice, the caller excludes disabled and unrequested explicit-only skills before sending metadata; retain every applicable required/explicit skill without changing its policy. An explicit request to inspect the entire catalog can still use the existing full-catalog command. Keep the public advisor rule of evaluating every enabled supplied record and returning every direct/supporting result; do not silently change it to top-k. Do not send paths, full instruction bodies or credentials as skill-selection payloads.
6. **No new authority.** Advice, native selection and selection provenance are never substitutes for reviewed execution evidence. Preserve session/turn/workspace identity, spec/context hashes, Hard-model validation, Dely Run/dispatch/receipt binding, worker evidence and current Stop behavior. Keep native permissions and hook trust unchanged. Preserve effort checks only where real evidence exists; never fabricate missing native-event fields.

Missing or changed selected-source policy fails closed. A mandatory skill not present in the verified native roster requires targeted discovery and a fresh explicit review, not a silent omission or expansion to every home skill. Old session records must not be silently promoted to the new reviewed state. Require a fresh prepare/review for affected sessions after a controlled update; do not rewrite historical advice or completed dispatch logs.

### Change surface and sequence

| Surface | Proposed change | Must remain unchanged |
| --- | --- | --- |
| `scripts/codex-compliance.js` | Separate mandatory admission from optional advice; scope source snapshots; make CLI output and legacy-state handling explicit | Routing, worker/dispatch checks, native hook trust, other hook handlers |
| `scripts/jev_agent.js` | Reuse existing standalone advisor and local policy helpers; change only if a focused integration test requires it | Full-catalog public semantics, context advice, provider validation, credential precedence |
| `scripts/test-codex-compliance.js` and focused Jev tests | Add native-path, optional-failure, policy and snapshot regressions | Valid coverage for standalone full-catalog behavior and existing Dely invariants |
| `docs/codex-compliance.md`, `docs/jev-skill-advice.md`, `docs/agent-advice.md`, affected `AGENTS.md` text | Update usage and claims to match the accepted implementation in the same release | Unrelated guidance and the historical decisions record |
| Two installed Codex homes | Release the accepted adapter bundle between tasks, with before/after hashes and rollback | Credentials, unrelated settings, hook definitions/trust unless a separately reviewed change requires them |

No change is planned to `task-routing.js`, `dely.js`, model pins or quota policy. Read their tests to preserve behavior; do not refactor them. Keep existing full-catalog regression tests for the standalone advisor, replacing only integration expectations that deliberately make remote advice mandatory. Follow the repository version rule if the eventual diff touches its version-triggering paths; do not bump versions for this planning-only update.

Implement in this order: freeze a fresh baseline and regression cases; add the native admission path with policy checks; scope snapshots and invalidate incompatible old state safely; retain/test optional consultation; run integration and comparative checks; update guides and release only the accepted snapshot. Concrete dependencies, owners and completion evidence are in the [task checklist](jev-skill-optimize-task.md).

This future adapter change affects the tool-admission contract. Assess its concrete routing/public-contract effects under the existing risk policy before implementation. The documentation-only turn is not an implementation dispatch, and a plan cannot downgrade the implementation risk or confer permission to deploy.

### Acceptance and measurement

The native path must make exactly zero skill-selection provider requests, including when a TypeSafe key is present. Instrument skill advice separately from task assessment and context advice. Preserve functional test results, mandatory skill loading and all negative execution-control tests. A missing optional-advice file or failed optional call cannot be the sole reason for denying a correctly reviewed task.

Verify both useful and adverse cases: an ordinary task; a task with known mandatory skills; multiple complementary skills; duplicate names; an explicitly requested explicit-only skill; an unrequested explicit-only or disabled selection; empty optional candidates; advisor failure; selected source/policy/alias mutation; an unrelated skill-body mutation; stale turn/spec/model; missing/wrong Dely dispatch; valid direct and delegated execution; and a later unrelated worker prompt. The hook's allowed read-only path and bounded Stop behavior must remain intact.

Use a small paired trial on eight representative tasks, three repeats per configuration, with matching task text, model/effort, catalog and fixture snapshots. Compare current mandatory advice against native selection plus on-demand advice only where justified. Record task test results, required-skill misses, unnecessary loaded skills, time to first useful tool action, end-to-end time, prepare/review repetitions and skill-advice request count. Record token/price data only when actually exposed; otherwise use NOT_MEASURED. Use median latency as a descriptive comparison, not a claim of calibrated performance from a small sample. No new permanent benchmark service is needed.

Release requires all execution-control and selected-policy cases to pass, no required-skill misses in the agreed cases, zero default skill-advice requests, and no unresolved functional regression. If paired measurements do not support the intended reduction in work/latency, report the outcome and review the proposal rather than claiming a saving. This turn runs document checks only; runtime tests and paired trials remain pending.

### Rollout and rollback

Before installing, inspect the effective home and actual hook target for both `C:/Users/Home33/.codex` and `C:/Users/Home33/AppData/Roaming/orca/codex-runtime-home/home`. Prior inspection found Orca's handlers targeting the central `.codex` adapter; do not assume two directories imply independent active installations. Recheck that relationship and native trust in fresh sessions.

Use an isolated fixture session first, then the accepted bundle between active tasks. Keep backups/hashes of the owned adapter, frozen advisor, guides and settings. Preserve unrelated hooks byte-for-byte and retain `credential_root`; do not copy keys. Demonstrate an unreviewed write denied, a correctly reviewed write allowed, wrong model/dispatch denied, and expected native skill invocation in each effective home. When definitions really change, use native hook review rather than fabricating trusted hashes.

Rollback restores only the owned accepted bundle and its matching dependency references, not the entire Codex home or user config. Preserve user edits, credentials and unrelated hook handlers. Start a fresh session, prepare/review again, and rerun the denial/allowance checks. Retain truthful historical records throughout. No installation, provider call, worker launch, branch cleanup, commit or push is performed by this planning update.

### Observed release result

Worker follow-up, 2026-10-12: JEV-NATIVE-07 is DONE at independently accepted source `37378486489853424fec9c685ef5f2925bdaa42f`. A real dispatched Codex worker followed Control preparation guidance and preparation lost its current native worker claim. Two focused regressions reproduced the guidance and inheritance defect; the narrow correction retains that claim and separates worker instructions from Control preparation. All 131 tests pass, including the actual configured PowerShell hook command after prepare; wrong-model, absent-handle and unrelated-prompt claims stay denied. Both installed scripts match SHA-256 `7a7baec997c2f3f4da2b30947e55b6e5eb01d273a07ff5cbffb1238a3c7398f5`, hooks are unchanged, and the actual worker's current Control review validates PASS. Live worker cell operations were observed; no active product job was replayed. The prior direct-Control verification remains recorded below; it did not exercise this transition.

Initial accepted source `7a62b9d50da425c1c5c3457e7549f732580d7ded` passed independent review, 129/129 focused tests and repository closure checks. At that release, both installed adapters had SHA-256 `f56d809e03e818a60ef7228c9835104841df4dcce578c201741d0e62b38352d6`; both existing hook configurations remained unchanged and resolved to one central effective home. A fresh native Codex CLI session passed the actual bootstrap sequence using a 54,919-byte input file: unreviewed notebook denied, exact review input accepted, prepare and explicit Control review completed, reviewed notebook accepted. Four isolated owned-bundle rollback rows passed. Credentials, task-routing/model pins, standalone advisor source and unrelated work were preserved.

The paired admission corpus passed 48 fixture runs: native skill-advice calls 0 versus baseline 70, task-assessment calls 21 in each configuration, required-set misses 0, median admission latency 567ms versus 2956ms. Control selections were fixed; agent coding quality, tokens and cost remain NOT_MEASURED. Detailed native-session, installed-hash, shared-target and rollback evidence is recorded in the linked task checklist and its machine-local artifacts. No remote publication was requested or performed.
