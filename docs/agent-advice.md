# Jev advice for coding agents

This repository provides `scripts/jev_agent.js` for task-plan advice,
task difficulty, context relevance and skill suggestions. It uses Node 24 and
standard HTTP; no service, package or worker launcher is added.

The companion workspace installation remains independent and unchanged.
The Orca CLI accepts `--repo` to select a target workspace. It defaults to the
current working directory. Relative input and output paths belong to that
workspace, not to the directory containing this script.

## Task plans before difficulty assessment

Codex translates the original free-form request into candidate tasks with
stable IDs. Codex authors all task prose; Jev answers typed atomic questions
about independent scope/need to split, duplicate outcomes and verifiable
acceptance. Jev generates neither tasks nor task IDs.

```json
{
  "request": "Remove PowerPoint export and add a DOO table.",
  "revision": 0,
  "tasks": [
    {
      "id": "remove-slides",
      "objective": "Remove PowerPoint export",
      "scope": "Remove export entry and implementation",
      "acceptance": "PowerPoint export is absent and other exports work",
      "depends_on": []
    },
    {
      "id": "doo-table",
      "objective": "Add DOO table",
      "scope": "Render DOO rows from existing data",
      "acceptance": "Known DOO fixture renders the expected rows",
      "depends_on": []
    }
  ]
}
```

```powershell
rtk proxy node scripts/jev_agent.js plan --repo D:/project --input plan.json --out plan_advice.json
```

All five task fields are required: `id`, `objective`, `scope` and `acceptance`
are nonempty strings, and `depends_on` is an array of distinct existing IDs.
The graph must contain 1–12 tasks with unique IDs, no unknown/self dependencies
and no cycles. Unknown fields are rejected. Graph validation precedes credential
lookup and transport. One invocation sends one request, bounded to 64,000 UTF-8
bytes including generated questions. `revision` is optional (initial round 0),
and when present must be 0, 1 or 2. Control may author at most two revisions,
retaining earlier results; the CLI has no autonomous decomposition/retry loop
or cross-invocation round tracker. Stop after that bound and settle unresolved
questions explicitly with the user rather than resubmitting indefinitely.

Results retain the exact parsed input in `submitted_plan`, including the
original request, IDs, dependencies and optional revision. `input_sha256` hashes
its `JSON.stringify` representation (not raw file whitespace). `provenance`
identifies the `jev-task-plan-v1` schema, Codex authorship contract and Jev
reviewer; it does not authenticate the caller. Every result, including invalid
graphs and unavailable advice, carries this identity and snapshot.

The provider sees `scope_<index>` and `acceptance_<index>` questions for each
submitted task and one `duplicate_<left-index>_<right-index>` per unordered
pair. Scope choices are `independent`, `split_required`, `unknown`; acceptance
choices are `verifiable`, `unverifiable`, `unknown`; pair choices are `distinct`,
`duplicate`, `unknown`. These internal indices map back to the submitted IDs in
`task_advice` and `duplicate_advice`. Complete typed replies include model,
choice, confidence and the exact probability keys. Partial replies, extra
instruction/prose fields, invalid probabilities, a choice contradicting the
probability maximum, unknown choices or a different model yield
`NOT_EVALUATED`. Missing credentials, transport/provider failures and oversized
payloads also remain `NOT_EVALUATED`. There is no confidence cutoff. A usable
reply is always `REVIEW_REQUIRED`, even if all outcomes appear independent,
distinct and verifiable; negative advice also requires Control review.

Control explicitly settles the candidate plan using the original request,
source evidence and any available advice, recording decisions and unresolved
facts. Advice cannot rewrite plans, complete tasks, assign models, lower risk,
grant admission or dispatch. Each settled task then receives a fresh existing
`assess` and explicit `review`, followed by unchanged Dely routing. Any scope
edit invalidates that task's prior assessment: regenerate its spec/context and
assessment before dispatch; never reuse an assessment for changed boundaries.

Draft independent outcomes, not slices by file type. Preserve consequential
risks in every affected task; splitting must not dilute them. A shared
implementation task must precede functional tasks whose acceptance requires
that implementation, never depend on those tasks and create a semantic cycle.
Keep parent acceptance open until all required outcomes and integration finish.
Plan advice does not assess semantic dependency correctness automatically;
Control checks it alongside the structural graph validation.

## Difficulty and review

```powershell
rtk proxy node scripts/jev_agent.js assess --repo D:/project --spec-file spec.md --context-file context.json --out assessment.json
rtk proxy node scripts/jev_agent.js review --repo D:/project --input assessment.json --difficulty medium_minus --reason "Control checked the bounded source and acceptance" --out reviewed.json
```

This calls the local `skills/delivery/scripts/task-routing.js` without copying
its policy. Use its existing context contract and pass the reviewed assessment
to Dely dispatch. Review is an explicit Control action. Hard risk, stale
spec/context and another workspace's assessment cannot be downgraded or approved.

The four labels are `easy`, `medium_minus`, `medium_plus`, and `hard`.
Final Easy/Medium- select Flash Medium/default and retain one Luna/max quota
fallback or verified absent-AGY-model exception. Final Medium+ selects only
Codex Sol/medium; Hard selects only direct Sol/xhigh. Neither permits fallback.
Old policy assessments require a fresh assessment and Control review.

Apply [the task risk policy](task-risk-policy.md) to consequential effects,
rather than task topics. Prefer Dely for known reversible bounded internal
work; keep concrete Hard exclusions and unresolved facts protected. Policy v4
keeps raw Jev Max Rank and adds an optional, evidence-bound correction of one
eligible verification/coordination dimension. All other high results retain
their vetoes. `review` accepts optional `--review-evidence-json <JSON>`;
normal reviews need no proof. See the policy's proof schema and decomposition
guidance; preserve historical records instead of changing their stored route.

## Context after retrieval

After Context Engine returns multiple candidates, the agent supplies the code
source and original provenance in this shape:

```json
{
  "request": "Review the report calculation",
  "candidates": [
    {
      "id": "report-cell",
      "path": "report.ipynb",
      "cell_id": "actual-cell-id-from-retrieval",
      "cell_index": 7,
      "line_start": 1,
      "line_end": 2,
      "source": "revenue = source_revenue\ncm = revenue - vcost"
    }
  ]
}
```

Keep `sha256` when retrieval provides it; missing provenance stays missing.
An entry with `required: true` stays first. Notebook candidates require a
real cell ID. Output/image fields are rejected; do not submit credentials,
raw data or notebook output.

```powershell
rtk proxy node scripts/jev_agent.js context --repo D:/project --input context.json --out context_advice.json
```

Every candidate survives, including unknown or unrelated records. Jev adds
relevance/probabilities/confidence and changes reading order. Required
instructions remain outside ranking. Control still checks registry/authority
and verifies current source in the relevant IDE.

## Skill suggestion

Codex uses native skill discovery and Control selection by default. Compliance
preparation performs no skill-advice call and no whole-home catalog scan.
Consult this CLI when requested, when relevant candidates compete or when
targeted native discovery demonstrably misses a needed workflow. Task assessment
and Context Engine ranking retain their separate contracts.

The agent builds the roster from the skills exposed in its current session.
Each item has `name`, absolute `path` to SKILL.md, and full `description`.
This CLI does not scan skill directories or automatically load a skill.
The session catalog may include .agents/skills, .codex/skills and installed
plugin skills; only the supplied roster can be selected.

```json
{
  "request": "Diagnose why the export fails",
  "skills": [
    {
      "name": "diagnosing-bugs",
      "path": "C:/Users/Home33/.agents/skills/diagnosing-bugs/SKILL.md",
      "description": "Diagnosis loop for broken, failing or slow code."
    }
  ]
}
```

```powershell
rtk proxy node scripts/jev_agent.js skill --repo D:/project --input skills.json --out skill_advice.json
```

Read every direct/supporting item in `suggestions[]`; `suggestion` is a legacy
leading-item alias. Operational callers supply only task-relevant candidates,
excluding disabled and unrequested explicit-only sources after local policy
checks. Keep applicable required/explicit records and their unchanged policy.
An explicit request to inspect a full catalog may still supply every enabled
record. The public advisor evaluates all enabled supplied records, with no top-k
cut. Explicit and mandatory skills retain precedence. Control reviews every
suggestion; independent native admission still checks policy and execution
evidence. An empty roster needs no model call. A failed optional call stays
`NOT_EVALUATED` without invalidating a correctly reviewed native task.

## Evidence and limits

Credentials come from the process, target workspace .env, this repository .env,
installed Dely .env, then Windows User/Machine environment. Only TYPESAFE_API_KEY
is used. Keys and raw API errors are never printed. Existing output files are
refused; use a fresh run directory.

Advice remains REVIEW_REQUIRED. Missing keys, HTTP failures, invalid replies,
timeouts and oversized snapshots remain NOT_EVALUATED (exit 3). Invalid
arguments/input return exit 2. No automatic retries or confidence threshold
are assumed. Context requests retain the 64 KB and 32-candidate guards. Skill
packets use 60,000-byte total and 30,000-byte shared-State-plus-question guards;
these measure UTF-8 transport bytes, not tokens. There is no skill-count cutoff.

New requests record `request_diagnostics`: fixed `stage` / `code` pairs
(`transport` / `TRANSPORT_ERROR`, `timeout` / `REQUEST_TIMEOUT`, `http` /
`HTTP_ERROR`, `json` / `JSON_DECODE_ERROR`, `schema` / `SCHEMA_INVALID`, and
`complete` / `OK`), measured `duration_ms`, actual `http_status` or null,
`requested_model`, and `provider_model` only after the entire reply validates.
No exception text, provider body, URL, prompt or catalog is saved in telemetry.
Existing generic failure reasons remain recognized; absent historical telemetry
is never reconstructed. Credentials and size guards do not invent request data.
The advisor and router keep self-contained request helpers with the same safe
diagnostics; the frozen installed advisor needs no sibling routing module for
context or skill advice.

An interrupted skill run records `incomplete_batch_progress`, bound to
`input_sha256`, with zero-based failed `batch_index`, planned `batch_count`,
`completed_batches`, `completed_evaluations`, validated `evaluations` and ordered
per-request `requests` telemetry. The first failed batch has no completed answers.
These observations do not populate final `evaluations` (except disabled records),
`suggestions` or `suggestion`; status stays `NOT_EVALUATED`. Invocation policy,
Control adoption, routing policy and approval basis are unchanged.

```powershell
rtk proxy node --test scripts/test-jev-agent.js scripts/test-task-routing.js
```

Live sample decisions prove wiring; representative accuracy and calibration
remain NOT_EVALUATED. Worker launch, quota transitions and the portable Dely
protocol are unchanged.

The initial local verification passed 10 advisor tests and 15 existing routing
tests. Actual CLI calls succeeded for all three modes, including a target
workspace different from this checkout. A synthetic skill check matched all
12 predeclared expectations against 15 actual installed skill descriptions,
including competing review/debug skills and a none case. This checks those
samples, not the full session catalog. Evidence is retained under
`.tmp-dely/jev-agent-orca-20261008/`.

API reference: [TypeSafe API](https://docs.typesafe.ai/api).
Agent usage: [Jev with coding agents](https://docs.typesafe.ai/introduction/coding-agents).
