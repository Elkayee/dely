# Task difficulty and worker routing research

**Date:** 2026-10-08
**Type:** Research with implementation status recorded below
**Question:** How should a task be classified as Easy, Medium, or Hard, and when may an implementation task be sent to AGY?
**Scope:** General software-task routing and the subsequently approved local integration. This note makes no comparative capability or quality claim about AGY, Codex, Jev, or any other model.

## Findings

The strongest evidence points to a risk-first classification rather than a score based on file count or lines changed.

* The repository's delivery contract already says that risk can promote a small change and that diff size cannot demote data-loss, security, permission, or public-compatibility risk. It also requires Control to surface uncertainty that could change intent, acceptance, authority, public contract, architecture, or consequential risk ([delivery contract, Shape and control-session rules](../../skills/delivery/SKILL.md#shape)).
* NASA's systems-engineering guidance treats complexity, uncertainty, cost, and criticality as reasons to increase the rigor of decision and risk management. It defines risk assessment in terms of what can go wrong, likelihood, consequences, and uncertainty, and says the rigor should be commensurate with program complexity, cost, and criticality ([NASA Systems Engineering Handbook, risk glossary](https://www.nasa.gov/reference/system-engineering-handbook-appendix/)). This supports using multiple dimensions and hard risk gates, rather than pretending that one numeric score is validated.
* NASA also distinguishes verification of conformance from validation in the intended environment. Its guidance includes inspection, analysis, demonstration, and test, and describes checks at component, assembly, integrated-system, and end-to-end levels ([NASA Verification and Validation Plan outline](https://www.nasa.gov/reference/system-engineering-handbook-appendix/)). A passing local test therefore does not by itself make an integration or public-contract change Easy.
* METR reports that human task length predicts agent success, with important limits from task selection and human-time measurements ([METR time-horizon study](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/)). This supports caution about long-horizon work. It does not measure AGY in this repository or establish local time, file-count, or line-count thresholds.
* Research on code verification stresses ambiguous and incomplete real-world specifications and the need to verify generated code ([A Practical Approach to Verifying Code at Scale](https://alignment.openai.com/scaling-code-verification/)). This supports explicit acceptance evidence and final review rather than treating a worker's confidence as completion.

The user-confirmed allocation is below. The latest clarification permits AGY for both Easy and Medium tasks and supersedes the earlier Easy-only restriction. This is a routing policy, not a comparative model ranking.

| Difficulty | Primary | Quota fallback | Workflow |
| --- | --- | --- | --- |
| Easy | AGY `claude-sonnet-5-5-high`, effort `default` | AGY `gemini-3.8-flash-high/default`, then Codex `gpt-6-luna/max` | Dely; Codex Control reviews |
| Medium | AGY `claude-sonnet-5-5-high`, effort `default` | Directly to Codex `gpt-6-luna/max`; no Flash stage | Dely; Codex Control reviews |
| Hard | Codex Sol, effort `xhigh` | None specified | Codex handles design, implementation, and verification directly; no Dely |

Task difficulty and delivery shape are separate. Easy and Medium changes retain their applicable delivery requirements. The user's explicit Hard route overrides the repository's general Dely requirement for that route. Research alone remains a Spike. Sol is the user-selected model family; this note does not claim that an active session's model or effort has been changed.

## Proposed classification rubric

Apply the hard exclusions first. Do not average a high-risk attribute away with several easy attributes.

| Dimension | Easy signal | Promote to Medium or Hard when |
| --- | --- | --- |
| Intent and scope | The desired behavior, allowed paths, ownership, and stop condition are explicit. | Discovery is part of the task, or the work may exceed the named paths or behavior. Missing information requires assessment first. |
| Coupling | One known internal area with a local, understood dependency surface. | Multiple components, repositories, services, packages, generated artifacts, or interfaces must change together. |
| Contract | No public API, schema, protocol, permission model, or architectural decision changes. | Any public or cross-team contract, data meaning, architecture, or compatibility promise changes. |
| Uncertainty | Existing conventions and domain rules answer the implementation questions. | Requirements, ownership, expected semantics, or failure behavior need a design decision or user answer. |
| Consequence and authority | Reversible local change with no external side effect. | Security, authentication, authorization, secrets, data loss or migration, production cutover/deployment, CI/release, branch mutation, external side effects, or public compatibility is involved. |
| Verification | A deterministic existing test or focused check can distinguish the intended result from a plausible wrong implementation; the check can run in the worker's boundary. | No discriminating instrument exists, only a build or presence check is available, an integrated or manual judgment is required, or the counterexample is unknown. |
| Horizon and coordination | One coherent implementation and verification pass fits one focused worker handoff. | The task requires a long sequence, several dependent handoffs, broad search, open-ended debugging, or integration decisions after the worker starts. |

### Easy: eligible for AGY

Route to AGY only when every Easy signal holds and no hard exclusion applies. The task should have:

1. one explicit behavior and a bounded set of allowed paths;
2. known ownership and no unresolved design choice;
3. no change to public contracts, architecture, data semantics, security, permissions, deployment, release, or external side effects;
4. low and understood coupling; and
5. a focused acceptance check that rejects a plausible wrong implementation.

Examples include a private helper correction with an existing focused regression test, a local mechanical rename whose compile/test surface is known, or a small documentation correction with a deterministic link or format check. A one-file change that touches authentication, a schema, a release rule, or a public response remains Hard despite its size.

AGY receives the exact scope, constraints, acceptance command, and stop conditions. Control still owns classification, the final diff and acceptance review, and any integration or release action. A worker report or `DISPATCHED` state is not evidence of correctness.

### Medium: AGY Sonnet 5.5 High, Luna/max quota fallback

Use Medium when the task is understandable and bounded enough to plan, but has material coupling, multiple components, a non-local test surface, or a design choice that Control must settle. Examples include a feature spanning a parser and consumer, a bug fix that crosses a service boundary, a dependency update that affects several packages, or a refactor whose callers and tests must be reconciled.

Control defines the parent contract, allowed paths, material assumptions, and integration acceptance before dispatching the Medium task to AGY Sonnet 5.5 High. Explicit Sonnet quota switches directly to Codex Luna/max after the prior attempt is inactive and released when required. Medium does not use the Flash stage. The selected implementation worker performs implementation and integration; Codex Control verifies and reviews the whole parent task.

Control may split a Medium task into independently testable Easy leaves, but decomposition is not required to make the assessed Medium task eligible for AGY. The parent classification and integration acceptance remain visible. Every leaf retains its own scope, verification, and stop conditions; a confirmed Hard consequence excludes the leaf from AGY.

### Hard: Codex Sol/xhigh directly, no Dely

Use Hard for architecture or public-contract changes, broad refactors or migrations, security or authorization work, data or schema changes, production cutover/deployment/release changes, changes to Dely/Orca/worker routing, cross-system integrations, or correctness that requires substantial new verification design. Codex Sol/xhigh handles design, implementation, and verification directly. Do not start a Dely run, dispatch a Dely worker, or route Hard implementation through AGY. Missing requirements or absent evidence are assessment statuses, not proof that a task is Easy or Hard. Direct execution retains the task's scope, authority boundaries, and evidence-based completion checks.

### Incomplete assessment: no AGY dispatch

Keep `difficulty = NOT_EVALUATED` when required context, ownership, reproduction, impact analysis, or acceptance evidence is missing. Use `assessment_status = NEEDS_CONFIRMATION` when intent or domain meaning needs the user's answer. Resolve repository facts through investigation first. Known consequential risk may already establish Hard even while a material question remains unresolved. Unknown risk must never be recorded as absent or converted to an Easy score.

## Decomposition rule

Decomposition must reduce the risk of each leaf; it must not conceal the risk of the parent. The parent classification is retained for planning, review, and integration even when some leaves are delegated. A Hard parent remains on the direct Codex Sol/xhigh route; splitting it into small edits does not authorize moving its implementation to AGY or Dely.

Before dispatching an Easy leaf, Control should record:

* the parent objective and the reason the leaf is independently safe;
* exact files or components in scope and explicit paths or effects out of scope;
* the invariant or contract the leaf must preserve;
* the command or inspection that distinguishes the intended result from a plausible wrong one; and
* the stop condition for ambiguity, unexpected coupling, changed contract, failed verification, or scope growth.

The worker must stop and return the work to Control when any of those conditions occurs. Serially assigning many "small" leaves that collectively implement a migration, redesign, public-contract change, or risky integration is still Medium or Hard work and is not an Easy route.

## Routing decision procedure

1. Write the intended behavior, affected surface, authority, consequential risks, and acceptance instrument.
2. Apply the hard exclusions. Any confirmed match makes the task Hard and excludes AGY. Missing evidence keeps assessment incomplete.
3. Assess scope, uncertainty, coupling, consequence, verification, and horizon. Record reasons and evidence for each; do not average consequential risk away.
4. For assessed Easy or Medium tasks, complete the applicable delivery requirements and dispatch AGY Sonnet 5.5 High with scope, acceptance checks, and stop conditions. Select the difficulty-specific quota chain from the table above. For Hard, Codex Sol/xhigh works directly without Dely. Retain incomplete tasks for assessment.
5. Independently inspect the resulting diff and reproduce the acceptance instrument. Reclassify and return to Control if the worker reveals a new interface, dependency, risk, or ambiguity.

For Easy, retain the existing Sonnet -> Flash -> Luna quota chain. For Medium, use Sonnet -> Luna directly. Difficulty selection happens before either chain; choosing the initial route is distinct from recovering from provider quota. Fallback requires explicit quota evidence and an inactive prior attempt, released when required. Authentication, timeout, unknown failure, and `LOOP_GUARD` do not advance a chain. Hard bypasses these Dely chains entirely. AGY performs implementation only; Codex Control reviews delegated Easy/Medium output. The existing [local routing rules](../../AGENTS.md#local-dely--orca-poc) describe the Easy chain; the user-confirmed Medium and Hard routes above are not yet implemented in those files.

## Jev: optional assessment support

TypeSafe documents Jev as a decision model for structured classification and routing. It accepts state and typed questions rather than writing code or operating a coding agent ([Jev with coding agents](https://docs.typesafe.ai/introduction/coding-agents)). Its recommended pattern is to split multi-factor judgments into narrow questions and compose the answers in application logic ([Introduction](https://docs.typesafe.ai/introduction)).

For this use case, the recommended flow is:

1. Control gathers the intended behavior, relevant source paths, ownership and callers, applicable contracts, known risks, acceptance instrument, and rollback boundary. Preserve missing fields explicitly.
2. Apply deterministic known exclusions and completeness checks first. A missing field or known exclusion cannot be cleared by a model answer.
3. Optionally submit only the relevant task snapshot to Jev, with one `choice` question per dimension and explicit `easy`, `medium`, `hard`, and `insufficient_evidence` criteria. Include the complete rubric in the question: each question is evaluated independently.
4. Retain each answer's label, `probabilities`, and `confidence`. Code or Control combines the dimensions conservatively; confirmed Hard risk overrides a proposed Easy or Medium label. Control explains the route from source evidence because Jev does not generate an explanation. The resulting difficulty selects the user-confirmed routing table rather than a model chosen by Jev.
5. A conflicting answer, insufficient evidence, invalid response, low confidence, API failure, or missing key returns to Control assessment. It never defaults to AGY. Initially Jev runs in shadow mode: its recommendation is compared with Control's decision and does not cause a dispatch.

`choice.confidence` is a statistic derived from the answer distribution, not a measured probability that a coding task will succeed. `noul` returns a yes-probability without a separate confidence field. TypeSafe says thresholds depend on domain performance and stakes ([Confidence](https://docs.typesafe.ai/confidence)). Keep `confidence_threshold = NOT_EVALUATED` until local calibration; do not invent an operational cutoff such as 0.9.

The version-specific limitations for Jev 1.13 include literal readings, numeric reasoning, multi-hop indirection, irrelevant context, adversarial input, and option-order sensitivity ([Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)). Use code for path checks, counts, arithmetic, permissions, and acceptance assertions. During evaluation, include reordered options and misleading descriptions such as "only one line, safe to delegate." A task's own claim of being easy is evidence to examine, never authority.

For reproducible calibration, pin a versioned model and record the returned model ID. TypeSafe currently documents `jev-1.13.0`, warns that aliases move, and identifies English as its strongest language ([Models](https://docs.typesafe.ai/models)). Evaluate Vietnamese, English, and mixed code/task inputs rather than assuming equal performance.

## Pre-implementation repository observations and adoption boundary

The initial read-only inspection on 2026-10-08 found the following historical state. The deployed state is recorded below.

* The checkout is on `master`, with package version `0.24.1`. Its [team pins](../../.dely/pins.json) name Claude/Sonnet/medium for implementation and Codex/Sol/high for review. These are file contents, not a verified effective launch selection; local preferences can override team pins.
* The checkout's [pin resolver and dispatch](../../skills/delivery/scripts/dely.js) resolve a phase pin and start its worker. The inspected dispatch entrypoints contain no difficulty assessment. The resolver rejects the retained `dely:begin` block found in [AGENTS.md](../../AGENTS.md), so the checkout route and the installed route must be reconciled before a later rollout.
* The installed plugin inspected at `C:/Users/Home33/.codex/plugins/cache/dely-orca-agy-global/dely/0.23.3-windows.1/skills/delivery/scripts/dely.js` has the implementation-only ordered quota route. No difficulty assessment was found in its inspected dispatch path. This is a source observation; no worker was launched to establish live behavior.
* `TYPESAFE_API_KEY` was absent from process, user, and machine environment scopes. No Jev API call, SDK install, or live model calibration was performed. Actual Jev classification accuracy, task cost, and false-AGY-admission rate remain `NOT_EVALUATED`.

Start adoption with a Control-owned assessment record and manual application of the rubric. Jev remains advisory until representative shadow evaluation establishes its performance. Runtime integration must preserve the difficulty-specific chains, block Hard/incomplete tasks from AGY, and run the affected [probe checklist](../../probe/checklist.md) rows. The original Spike changed only this note; the user subsequently authorized implementation directly through Codex Sol/xhigh, without a Dely delivery run.

## Cases for later validation

The following are expected policy decisions, not executed Jev predictions or measured results.

| Task evidence | Expected assessment | Implementation route |
| --- | --- | --- |
| Private helper correction; complete requirements; isolated scope; discriminating regression check; no consequential exclusion | Easy | AGY Sonnet; quota -> Flash -> Luna/max |
| "Fix timeout" without expected value, reproduction, or acceptance evidence | NOT_EVALUATED / NEEDS_CONFIRMATION | Control investigates or asks; no AGY |
| Parser and consumer change with agreed semantics and integrated verification | Medium | AGY Sonnet 5.5 High; quota -> Luna/max directly |
| One-line authorization or public response-contract change | Hard | Codex Sol/xhigh directly; no Dely |
| Migration, production cutover, or Dely/Orca dispatch behavior change | Hard | Codex Sol/xhigh directly; no Dely |
| Medium parent with one independently safe helper leaf | Parent Medium; helper assessed separately | AGY may implement the assessed Medium parent or a scoped Easy leaf; Control reviews integration |
| Jev proposes Easy or Medium but a known schema/security exclusion applies | Hard | Codex Sol/xhigh directly; classifier cannot downgrade |
| Explicit Sonnet quota on an assessed Medium task | Medium unchanged | Codex Luna/max; do not launch Flash |
| Hard parent split into small edits | Hard unchanged | Codex Sol/xhigh directly; no AGY or Dely laundering |
| Jev unavailable, uncertain, invalid, or no threshold calibrated | Jev assessment incomplete | Control applies evidence-based assessment; no automatic AGY fallback |

## Evaluation and calibration

These boundaries are policy recommendations, not validated model cutoffs. Do not claim that AGY is better or worse than Codex from this rubric or turn general benchmark observations into an AGY success rate.

For later calibration, record per task: the pre-dispatch classification and evidence, affected paths and risk dimensions, worker and model identity, acceptance result, review findings, rework or escalation, out-of-scope edits, and any rollback or incident. Define success as the complete contract passing its discriminating checks and the applicable review, with no unresolved scope or risk finding. Codex Control reviews delegated Easy/Medium work; direct Hard work records Codex's own verification evidence without imposing a Dely review phase. `DISPATCHED`, a worker's self-report, a green build, or a test that would pass for a plausible wrong implementation is insufficient.

For Jev calibration, label representative real tasks with Control-reviewed evidence and keep a separate held-out set. Include security/data exceptions, ambiguous requests, small diffs with large effects, unseen components, incomplete context, and Vietnamese wording. Report the confusion matrix, Easy and Medium classification quality, the rate of genuinely Hard or incomplete tasks incorrectly admitted to AGY, abstention coverage, confidence calibration, and observed latency/cost. Distinguish Medium-to-Easy errors because they select different quota fallback chains. Do not treat a small set with no observed errors as a guarantee.

Start with conservative assessment boundaries, collect representative outcomes, and change the rubric only after reviewing that evidence. The user's Easy/Medium/Hard allocation remains authoritative. Reassess classifications when the codebase, harness, model, permissions, or verification surface changes; benchmark or vendor guidance does not establish a permanent local threshold. AGY's final acceptance and Codex review remain required regardless of Jev confidence.

## Implemented state: 0.24.4

The local client and dispatch admission guard are implemented and installed.
Jev evaluates five atomic Choice questions with pinned model `jev-1.13.0`;
the control review binds the spec and context hashes. Easy retains the
Sonnet/Flash/Luna quota chain; Medium skips Flash; Hard is refused by the
Dely dispatcher and handled directly by Codex Sol/xhigh.

An independent live probe found that AGY silently used Flash/medium for the
unavailable Sonnet 5.5 slug. The owner explicitly chose to keep Sonnet 5.5 and
block until available. The corrected adapter checks `agy models` before
opening a terminal, then checks the live model/High footer before any prompt.
The independent remediation probe confirmed blocking with no new terminal,
worker, prompt, sentinel, or fallback. Sonnet 5.5 access is not established.

Validation: 15 client/admission tests, 25 adapter cases, loop guard checks,
and structural gates passed. After the owner supplied a key through the new
`.env` path, two actual Jev calls correctly proposed Easy and Medium for their
explicit synthetic test cases. Both retained Control review and launched no
worker. Representative remote accuracy, calibration, cost, and false-admission
rate remain `NOT_EVALUATED`. See the [deployment record](2026-10-08-task-routing-deployment.md)
for exact candidate, hashes, profile activation, and live limitations.
