# Task difficulty and worker routing research

**Date:** 2026-10-08  
**Type:** Spike / recommendation only  
**Question:** How should a task be classified as Easy, Medium, or Hard, and when may an implementation task be sent to AGY?  
**Scope:** General software-task routing. This note makes no capability or quality claim about AGY, Codex, Jev, or any other model. It does not change runtime configuration.

## Findings

The strongest evidence points to a risk-first classification rather than a score based on file count or lines changed.

* The repository's delivery contract already says that risk can promote a small change and that diff size cannot demote data-loss, security, permission, or public-compatibility risk. It also requires Control to surface uncertainty that could change intent, acceptance, authority, public contract, architecture, or consequential risk ([delivery contract, Shape and control-session rules](../../skills/delivery/SKILL.md#shape)).
* NASA's systems-engineering guidance treats complexity, uncertainty, cost, and criticality as reasons to increase the rigor of decision and risk management. It defines risk assessment in terms of what can go wrong, likelihood, consequences, and uncertainty, and says the rigor should be commensurate with program complexity, cost, and criticality ([NASA Systems Engineering Handbook, risk glossary](https://www.nasa.gov/reference/system-engineering-handbook-appendix/)). This supports using multiple dimensions and hard risk gates, rather than pretending that one numeric score is validated.
* NASA also distinguishes verification of conformance from validation in the intended environment. Its guidance includes inspection, analysis, demonstration, and test, and describes checks at component, assembly, integrated-system, and end-to-end levels ([NASA Verification and Validation Plan outline](https://www.nasa.gov/reference/system-engineering-handbook-appendix/)). A passing local test therefore does not by itself make an integration or public-contract change Easy.
* METR's HCAST report measures agent success as a function of human task time. In its benchmark, the best evaluated agents succeeded on roughly 70–80% of tasks taking humans under one hour and under 20% of tasks taking humans over four hours ([HCAST report, abstract and introduction](https://metr.org/hcast.pdf)). METR's later summary likewise reports that human task length predicts success and that the estimate depends on the selected tasks and human-time measurements ([METR time-horizon study](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/)). These are useful cautionary observations about long-horizon work; they are not measurements of AGY in this repository and must not become local thresholds.
* OpenAI's own Codex guidance recommends well-scoped tasks that take about an hour or a few hundred lines as a useful operating envelope, while also recommending explicit file, component, and context details ([How OpenAI uses Codex](https://openai.com/business/guides-and-resources/how-openai-uses-codex/)). This is vendor guidance, not a validated Easy/Medium/Hard boundary. Time, line count, and model name are therefore advisory signals only.
* OpenAI's Goals guidance requires an outcome, verification surface, constraints, boundaries, iteration policy, and a blocked stop condition, and says completion should be decided from concrete evidence rather than the model's confidence ([Using Goals in Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)). OpenAI's code-verification research similarly states that generated code cannot be assumed correct and that deployed review must handle ambiguous, incomplete, real-world specifications ([A Practical Approach to Verifying Code at Scale](https://alignment.openai.com/scaling-code-verification/)). This supports a mandatory acceptance instrument and Control-owned final review for worker output.

The result is a governance rule, not a model ranking: only a conservative subset of tasks is eligible for AGY, while all other work remains with Control until it is clarified, verified, or safely decomposed.

## Proposed classification rubric

Apply the hard exclusions first. Do not average a high-risk attribute away with several easy attributes.

| Dimension | Easy signal | Promote to Medium or Hard when |
| --- | --- | --- |
| Intent and scope | The desired behavior, allowed paths, ownership, and stop condition are explicit. | A material assumption is unresolved, discovery is part of the task, or the work may exceed the named paths or behavior. |
| Coupling | One known internal area with a local, understood dependency surface. | Multiple components, repositories, services, packages, generated artifacts, or interfaces must change together. |
| Contract | No public API, schema, protocol, permission model, or architectural decision changes. | Any public or cross-team contract, data meaning, architecture, or compatibility promise changes. |
| Uncertainty | Existing conventions and domain rules answer the implementation questions. | Requirements, ownership, expected semantics, or failure behavior need a design decision or user answer. |
| Consequence and authority | Reversible local change with no external side effect. | Security, authentication, authorization, secrets, data loss or migration, deployment, production behavior, CI/release, branch state, external service, or user-visible compatibility is involved. |
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

### Medium: Control-owned

Use Medium when the task is understandable and bounded enough to plan, but has material coupling, multiple components, a non-local test surface, or a design choice that Control must settle. Examples include a feature spanning a parser and consumer, a bug fix that crosses a service boundary, a dependency update that affects several packages, or a refactor whose callers and tests must be reconciled.

Control may split a Medium task into independently testable Easy leaves. That is allowed only after Control defines the parent contract and integration acceptance. Each leaf must independently satisfy every Easy gate, have an explicit path boundary, and avoid deciding public behavior, data semantics, security, permissions, or architecture. Control integrates and verifies the whole parent task.

### Hard: Control-owned and usually delivery-gated

Use Hard for architecture or public-contract changes, unresolved requirements, broad refactors or migrations, security or authorization work, data or schema changes, production/deployment/release changes, changes to Dely/Orca/worker routing, cross-system integrations, or any task whose correctness cannot be established by a discriminating instrument. A worker can investigate a bounded question, but implementation authority stays with Control until the risk and acceptance surface are resolved.

## Decomposition rule

Decomposition must reduce the risk of each leaf; it must not conceal the risk of the parent. The parent classification is retained for planning, review, and integration even when some leaves are delegated.

Before dispatching an Easy leaf, Control should record:

* the parent objective and the reason the leaf is independently safe;
* exact files or components in scope and explicit paths or effects out of scope;
* the invariant or contract the leaf must preserve;
* the command or inspection that distinguishes the intended result from a plausible wrong one; and
* the stop condition for ambiguity, unexpected coupling, changed contract, failed verification, or scope growth.

The worker must stop and return the work to Control when any of those conditions occurs. Serially assigning many "small" leaves that collectively implement a migration, redesign, public-contract change, or risky integration is still Medium or Hard work and is not an Easy route.

## Routing decision procedure

1. Write the intended behavior, affected surface, authority, consequential risks, and acceptance instrument.
2. Apply the hard exclusions. Any match routes to Control.
3. Assess scope, uncertainty, coupling, consequence, verification, and horizon. If any dimension is not clearly Easy, route to Control pending clarification or decomposition.
4. If all Easy gates hold, dispatch one bounded AGY task with the acceptance check and stop conditions.
5. Independently inspect the resulting diff and reproduce the acceptance instrument. Reclassify and return to Control if the worker reveals a new interface, dependency, risk, or ambiguity.

The conservative default is therefore **Easy -> AGY; Medium/Hard -> Control**. A separate classifier, including Jev if adopted, may propose a classification or identify evidence to collect, but its output must not override the hard exclusions or authorize a worker by itself. Control remains accountable for the route and for whole-task acceptance.

## Evaluation and calibration

The thresholds above are recommendations, not validated cutoffs. Do not claim that AGY is better or worse than Codex from this rubric, and do not turn the METR or OpenAI operating-envelope observations into an AGY success rate.

For later calibration, record per task: the pre-dispatch classification and evidence, affected paths and risk dimensions, worker and model identity, acceptance result, independent review findings, rework or escalation, out-of-scope edits, and any rollback or incident. Define success as the complete contract passing its discriminating checks and independent review, with no unresolved scope or risk finding. `DISPATCHED`, a worker's self-report, a green build, or a test that would pass for a plausible wrong implementation is insufficient.

Start with the conservative Easy boundary, collect representative outcomes, and change the boundary only after reviewing that evidence. Reassess classifications when the codebase, harness, model, permissions, or verification surface changes; current benchmark or vendor guidance does not establish a permanent local threshold.

