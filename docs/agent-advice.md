# Jev advice for coding agents

This repository provides `scripts/jev_agent.js` for three narrow decisions:
task difficulty, context relevance and skill suggestions. It uses Node 24 and
standard HTTP; no service, package or worker launcher is added.

The companion workspace installation remains independent and unchanged.
The Orca CLI accepts `--repo` to select a target workspace. It defaults to the
current working directory. Relative input and output paths belong to that
workspace, not to the directory containing this script.

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
Easy/Medium- select Flash Medium/default; Medium+ selects Sonnet High/default.
Every delegated grade has one Luna/max quota fallback. Old three-grade
assessments require a new assessment and Control review.

Apply [the task risk policy](task-risk-policy.md) to consequential effects,
rather than task topics. Prefer Dely for known reversible bounded internal
work; keep concrete Hard exclusions and unresolved facts protected. Version
three clarifies these criteria and changes the Flash primary to Medium;
reassess version-two records instead of changing their stored route.

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
