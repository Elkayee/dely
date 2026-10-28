# dely — Agent Instructions

This repository contains the `dely` package: the `delivery` skill and its
automation-first control protocol for coding agents, on Claude Code, Codex
CLI, Cursor Agent CLI and the other harnesses `harnesses.json` marks
`supported`.

## Source of truth

- The workflow contract is `skills/delivery/SKILL.md`.
- Settled, open, and rejected decisions are recorded in `docs/decisions.md`.
- Installation and onboarding instructions are in `README.md`.
- Tracked `scripts/test-*.js` use `node:test` as the test suite. There is no
  checked-in CI workflow; nothing runs on a pull request automatically.
  The closure gates below are the whole structural check.
- No `PLAN.md`, `TASK.md`, or `AGENT.md` exists in the repository convention;
  transient plans and handoffs live in `docs/_plans/`.
- Dated evidence plans and handoffs include
  `docs/_plans/2026-10-27-jev-cookbook-alignment.md` and the monitor handoff
  `docs/_plans/2026-10-27-jev-monitor-loading-handoff.md`.
- Current evidence and status distinctions:
  - Source state: Git reports external commit `9a4ab3d1b8016a309e588e7d8135dda78f48afc7`
    on `main`, while the local `origin/main` ref remains at `97fd926072cd98b8b0456708a351ddab09ad281f`.
    The package manifests and version gate specify 0.27.34.
  - Historical technical checks: existing handoff records report passing test
    suites and gates for specific scoped tasks; these are recorded historical
    technical checks, not whole-tree current acceptance.
  - Independent integration verification, business approval, release, and live
    user interface activation: `NOT_EVALUATED` for current whole-tree 0.27.29
    where no matching proof exists. Acceptance is planned, not yet executed.
  - Release and installation: historical handoff records `NOT_SYNCED` pending
    Control; historical local cookbook review and sync records cover older
    0.27.24 and 0.27.28 snapshots and do not constitute automatic proof of
    0.27.29 whole-tree acceptance.
- Live verification is `probe/checklist.md`, run by a separate agent session
  against a candidate installed from a `git archive` snapshot. When a delivery
  requires that checklist, it runs before the review dispatch, so the reviewed
  head is the verified head; if remediation changes what a worker launch does,
  the affected rows rerun before the re-review. This ordering is a project
  rule for this repository, not part of the portable protocol in `SKILL.md`.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `.github/`
  (issue and pull-request templates) own the human contribution, conduct,
  security, and PR contract; they need no Dely or Orca install to follow.

Repository artifacts are written in English.

## Jev agent advice

Use `scripts/jev_agent.js` with `--repo <target-workspace>` for the four
advisory steps in [agent-advice.md](docs/agent-advice.md): Codex-authored plan
review before per-task difficulty assessment, difficulty before implementation,
context ranking after Context Engine returns multiple
candidates, and skill suggestion when the session's skill catalog has
competing candidates. It reuses this checkout's task-routing policy.

Control reviews every result. Keep required instructions and all context
provenance; a skill suggestion does not override an explicit skill request.
Missing keys or unusable replies stay `NOT_EVALUATED`. The companion
workspace installation remains available and is not removed by this change.

## Workflow

- Default branch: `main`.
- Classify first using the Jev task-routing procedure below. Hard work is
  handled directly by Codex Sol/xhigh without Dely. Easy, Medium- or Medium+ Bounded
  or Architectural work invokes `delivery`; a Spike starts no delivery run.
- Durable decisions live in `docs/decisions.md`; transient plans live in
  `docs/_plans/`.
- Maintenance logging is machine-local and opt-in at `~/.dely/log.jsonl`
  (JSON Lines, one object per line); no project-owned log file is tracked.
  Dely never creates `~/.dely/`: a missing directory means nothing is
  written and nothing is created. The log records failed and abandoned
  deliveries too.
- A self-update runs its release phase through the frozen installed plugin
  version, because Control is already using it when the plan starts.
  Candidate changes in this checkout take effect for the next delivery, not
  the one shipping them. Plugin caches and any live worker hook wiring are
  refreshed only between plans.
- After a source change passes review, focused verification and the closure
  gates, Control must run native Node `scripts/sync-dely.js` before reporting
  completion. Require `COHERENT` for every selected home; if synchronization
  fails, report `NOT_SYNCED` with the blocker. Start a fresh session afterward.
- A delivery that changes anything under `skills/`, `harnesses.json`,
  `extensions/` or `package.json` advances the version in both plugin
  manifests, `package.json`, and the version gate below, within that same
  delivery.

## Phase dispatch

Name the model and reasoning effort on every dispatch.

## Dely

The local Orca POC instructions below take precedence for phase routing and
review ownership. The upstream package pins remain in `.dely/pins.json`.

Assess first. Hard work runs directly in Codex Sol/xhigh without Dely.
Easy/Medium-/Medium+ Bounded or Architectural work invokes `dely:delivery`; a Spike
starts no delivery run.

`.dely/pins.json` is this repository's deployment selection, not the portable
protocol. Per-harness facts — status, Control wake, trust, discovery,
model and effort flag support, permission defaults, forbidden headless
forms, the instructions-file rule, and measured notes including for
deferred harnesses — live in `harnesses.json` at the repository root.

This project adds no phase-implied sandbox. Native Internet access, closure
gates, result writes and coordinator completion stay available.

## Closure gates

Run from the repository root:

```bash
git diff --check
```

```bash
jq -e . harnesses.json plugin.json .claude-plugin/plugin.json .claude-plugin/marketplace.json .codex-plugin/plugin.json .cursor-plugin/plugin.json package.json >/dev/null
```

```bash
jq -e '.harnesses | all((.status == "supported" or .status == "deferred") and (.controlWake == "background" or .controlWake == "waker" or .controlWake == "unsupported") and ((has("modelPin") | not) or .modelPin == "spec-unchecked") and ((has("effortInModel") | not) or (((.effortInModel | type) == "string") and .effortInModel != "" and .modelFlag == true and .effortFlag == false and (has("modelPin") | not))))' harnesses.json >/dev/null
```

```bash
node --check skills/delivery/scripts/dely.js
git ls-files -z '*.sh' 'skills/delivery/scripts/dely' | xargs -0 -n1 bash -n
```

```bash
test "$(jq -r .version .claude-plugin/plugin.json)" = 0.27.34
test "$(jq -r .version .codex-plugin/plugin.json)" = 0.27.34
test "$(jq -r .version package.json)" = 0.27.34
```

```bash
test "$(jq -r 'has("type")' package.json)" = false
```

```bash
test ! -e skills/delivery/references/harnesses.md
```

```bash
git grep -nE 'adoptCommand|adoptedPermission|adoptPath|readAdopts|writeAdopts|recordAdopt|takeAdopt|closeAdopted|closeCreated|waitQuiet|lastOutputAt|launchKind|hasGate|GATES|pinWhy|ELECTRON|harnessCell|shownModel|waitShownModel|pinCheckMs|PIN_CHECK|pin_not_applied' -- skills/ && exit 1 || true
```

```bash
git grep -Ei 'pace.?id' -- . ':!docs/_plans' && exit 1 || true
git grep -E '(^|[^A-Za-z0-9])[A-Z][0-9]+[a-z]?([^A-Za-z0-9]|$)' -- . ':!docs/_plans' && exit 1 || true
```

```bash
rows=$(jq -r '.harnesses[] | . as $h | (if $h.status == "deferred" or $h.controlWake == "unsupported" then "✗" elif ($h.limits // "") | test("(^|[.] )As Control,") then "⚠" else "✓" end) as $c | (if $h.status == "deferred" then "✗" elif ($h.limits // "") | test("(^|[.] )As a worker,") then "⚠" else "✓" end) as $w | "| \($h.name) | \($c) | \($w) | \($w) | \(if ($h.limits // "") == "" then "—" else $h.limits end) |"' harnesses.json) || exit 1
printf '%s\n' "$rows" | while IFS= read -r row; do grep -qxF -- "$row" README.md || { echo "README lacks: $row"; exit 1; }; done && { test "$(grep -cE '^\| [^|]+ \| (✓|⚠|✗) \| (✓|⚠|✗) \| (✓|⚠|✗) \|' README.md)" = "$(jq '.harnesses | length' harnesses.json)" || { echo "README role rows ≠ harnesses.json entries"; exit 1; }; }
```

Control is ✗ when `status` is `deferred` or `controlWake` is `unsupported`, ⚠ when `limits` has a sentence starting "As Control,", otherwise ✓; Implementer and Reviewer are ✗ when `deferred`, ⚠ when `limits` has a sentence starting "As a worker,", otherwise ✓. A role sentence starts the `limits` value or follows ". ".

The first three gates prove repository shape and syntax only. A Bounded or
Architectural change to runtime behaviour must also name a focused instrument
that distinguishes the changed behaviour from its failure mode, and a change
to what a worker launch does is verified by running `probe/checklist.md`, not
by these gates.

The version gate is a literal pin and the only check that keeps the two
manifests from splitting: a `skills/` change that forgets one manifest ships
different protocol text under the same version string.

The absence command distinguishes a deleted rail from documentation that
merely says it is deleted: it fails if the retired
`skills/delivery/references/harnesses.md` returns. The identifier grep is
the same instrument applied to code: it fails on a deletion that removes a
definition and leaves a caller.

The disclosure grep is lexical. It catches named consumer identifiers; it does
not catch a quoted consumer path, a branch name, or a session id. A green result
is not a proof of non-disclosure.

---

# Local Dely + Orca POC

Codex is the interactive Control and reviewer. Orca is the execution plane. Antigravity CLI (`agy`) is implementation-only worker.

## Jev task routing

Assess before creating a Dely Run. Use `node skills/delivery/scripts/task-routing.js
assess --repo <workspace> --spec-file <spec> --context-file <context> --out
<assessment>` from this package, then review the evidence with the `review`
command shown by `--help`. Pass the reviewed file as `--assessment-file` on
every delegated `dely dispatch`, including quota fallbacks. Pass both
`--assessment-file` and `--spec-file` on task preflight too.

| Difficulty | Primary | Explicit quota fallback | Workflow |
| --- | --- | --- | --- |
| Easy | AGY Gemini 3.8 Flash Medium/default | Codex Luna/max at stage 1 | Dely; Codex Control reviews |
| Medium- | AGY Gemini 3.8 Flash Medium/default | Codex Luna/max at stage 1 | Dely; Codex Control reviews |
| Medium+ | Codex gpt-6.1-sol/medium | None | Dely; Codex Control reviews |
| Hard | Codex gpt-6.1-sol/xhigh | None | Direct implementation and verification; no Dely |

CLI labels are `easy`, `medium_minus`, `medium_plus`, and `hard`. Medium- is
bounded internal work with known ownership and low coupling; Medium+ coordinates
known internal components and integrated acceptance. Hard risk flags take
precedence. Old assessments must be rerun under the new policy.
`implement` supplies Codex Sol/medium, `implement_backup` supplies Flash even as a primary,
and `implement_backup_2` supplies the single Luna quota fallback for final Easy/Medium-.
Fresh low-tier approvals also permit `--fallback network --fallback-stage 1`
only with recorded adapter transport evidence bound to the original AGY pin,
Run and frozen hashes. Reconcile a submitted attempt as failed/canceled,
inactive and released before replacement; a successful result is retrieved.
Before submission, close any owned startup terminal and verify it exited.
Lost terminal-create responses, unknown identity/outcome and unclassified
timeouts stop. Stage one is claimed once per snapshot; concurrent recovery
is refused. Medium+/Hard never gain this exception. A crash lock is removed
only after Control verifies the original invocation and owned workers inactive.
Final Medium+ and Hard are Sol-only, including provider-quota and model-absence
failures. Policy `jev-task-routing-v4` keeps Jev's raw Max Rank; an eligible
single verification/coordination candidate needs optional
`--review-evidence-json` and a justified Control correction before becoming
Medium-. See [the proof contract](docs/task-risk-policy.md#optional-correction).
Normal reviews need no proof. Native v4 admission freezes the original
assessment and validates approval without changing `reviewed_at`.

The context contains `scope`, `coupling`, `acceptance`, and source `evidence`,
`requirements_confirmed: true`, and explicit boolean `risks` for `security`,
`data`, `public_contract`, `architecture`, `production`, and `routing`.
Missing facts stay `NOT_EVALUATED`; a known Hard risk cannot be downgraded.
Only `security`, `data`, `public_contract`, `architecture` and `routing` are
automatic Hard exclusions. `production` remains required context; by itself it
reaches Jev and Control review. Raw Jev Hard and unknown-evidence vetoes remain.
Preserve historical decisions; assess a fresh snapshot for this rule.
The five exclusions describe actual consequential effects in the scoped change,
not task topics. Prefer Dely for reversible bounded internal work. Apply
[docs/task-risk-policy.md](docs/task-risk-policy.md) and record the concrete
effect behind every true flag. Ordinary dispatch is not a routing-policy
change; working in a data/auth/production repository is not itself Hard.
Jev reads `TYPESAFE_API_KEY` from the process, workspace/package `.env`, or
Windows User/Machine environment and proposes a difficulty. Control reviews every
result; no confidence cutoff is assumed calibrated. If Jev is unavailable,
Control may explicitly review complete source evidence, retaining the missing
Jev evaluation. Never invent a Jev result or automatically default to AGY.
The reviewed spec/context hashes must still match at dispatch.
Before an AGY launch, its requested slug must be advertised by `agy models`.
Before the prompt is dispatched, the live footer must confirm the requested
model and requested level. A successful catalog proving the requested model absent
routes directly to Codex Luna/max, skipping Flash. Discovery/auth/timeout errors
and an unapplied live footer still stop; model absence is not a quota stage.

## Bounded Control

- Treat `LOOP_GUARD` as a hard stop and report the current result instead of retrying autonomously.
- The Dely control loop is limited to 12 tracked invocations before settlement; the same failing command may fail twice, then the next retry must stop.
- Bound diagnostic file/log reads to 4,000 characters and searches to 50 hits. Exclude `.git`, `node_modules`, `venv`, `artifacts`, and generated POC/temp trees unless the task targets them.
- Prefer one bounded search over opening files one by one. Narrow the path and query before expanding scope.
- Use `DELY_LOOP_GUARD_OVERRIDE=1` only for one intentional retry after explicit user direction.

<!-- dely:begin -->
## Dely

Assess first. Hard work runs directly in Codex Sol/xhigh without Dely.
Easy/Medium-/Medium+ Bounded or Architectural work invokes `dely:delivery`; a Spike
starts no delivery run.

| Phase | Harness | Model | Effort |
| --- | --- | --- | --- |
| `implement` | Codex CLI | gpt-6.1-sol | medium |
| `implement_backup` | Antigravity CLI | gemini-3.8-flash-medium | default |
| `implement_backup_2` | Codex CLI | gpt-6-luna | max |

Review is owned by Codex Control. Never dispatch a `review` phase to AGY.
<!-- dely:end -->
