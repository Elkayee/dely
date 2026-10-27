# Jev advice for coding agents

This repository provides `scripts/jev_agent.js` for task-plan advice,
task difficulty, context relevance and skill suggestions. It uses Node 24 and
standard HTTP; no service, package or worker launcher is added.

The companion workspace installation remains independent and unchanged.
The Orca CLI accepts `--repo` to select a target workspace. It defaults to the
current working directory. Relative input and output paths belong to that
workspace, not to the directory containing this script.

## Automatic Orca workflow

`scripts/jev-workflow.js` connects the existing advisor to native Codex,
Claude and Antigravity lifecycle hooks. After operator installation, ordinary
Orca prompts initialize a private turn automatically. Eligible terminal tools
receive command hazard advice; observed source reads receive context relevance
and passage checks; local Markdown citations receive a final source check.
Users do not prepare JSON, run Jev commands or add special prompt text.

Codex reuses its four existing compliance definitions without changing native
trust. Claude uses UserPromptSubmit, PreToolUse, PostToolUse and Stop.
Antigravity uses its installed native contract: PreInvocation injectSteps with
ephemeralMessage, native toolCall args, PostToolUse queued feedback and advisory
Stop feedback. Queued advice reaches its next model invocation. Native
denials win; advice grants no execution permission and has no probability cutoff.

The versioned Dely sync installs and fingerprints the shared runtime in every
registered Codex home. Install the other providers against their actual active
configuration paths once, preserving existing settings and status hooks:

```powershell
node scripts/jev-workflow-install.js --home C:/Users/NAME/.codex --claude-config C:/Users/NAME/.claude/settings.json --antigravity-config C:/Users/NAME/.gemini/config/hooks.json
```

Start a new provider session after installation. A different Claude profile or
remote host needs installation into that profile/host; this local installer
does not claim to manage profiles it has not inspected. Existing sessions and
provider-native trust remain under their existing lifecycle rules.

Automation activates only with Orca session markers. It rereads bounded code
and documentation snapshots within the active workspace, retaining file,
line and SHA identity. Codex can recover source path headers from bounded
current-turn tool outputs when no PostToolUse callback is available. Raw
transcripts are never advisor inputs. Private paths, credentials, datasets,
unsupported formats, linked paths and oversized inputs remain NOT_EVALUATED.
Citation extraction covers local Markdown links, line/heading anchors and explicit
inline or Markdown block quotations. A small safe document can be checked in full;
a larger document needs a resolvable section. Long code sections are located only
at recognized top-level JavaScript declarations; other unresolved contexts remain
NOT_EVALUATED. Path-only references never default to the first line. Compound
references on one claim are left for Control to split. External URLs and
notebook/data files remain outside this local-source adapter.

For Codex, the native adapter supplies a bounded task objective, scope, acceptance
and exact spec/context hashes only after the existing immutable current-task
validator succeeds. This does not grant permission. Event-supplied scope is ignored.
Without verified scope, `scope_mismatch` and scope-dependent `exfiltration` remain
NOT_EVALUATED; independent command hazards still receive advice. Private or oversized
task context is not exported. Other providers retain unconfirmed scope until they
have an equivalent validated integration.

Private local state is under `dely-compliance/jev-workflow` in the selected
home. It contains the safe prompt, source identities and cached result summaries,
with per-turn request/count limits and replay locks. Feedback carries validated
labels, probabilities and provenance rather than command/source text. A failed
check stays NOT_EVALUATED. The uncalibrated advisory policy never creates a Stop
block/continue decision, including for low-confidence citation findings. Shared
feedback explicitly distinguishes citation-evaluation status from task completion:
agents continue outstanding authorized work and required checks without waiting
for the user to type continue, review accessible unsupported claims, split compound
claims as needed, disclose unavailable sources without presenting NOT_EVALUATED
as verification, identify the unfinished requirement and blocker if mandatory
evidence is unavailable, and otherwise finish with a self-contained result,
verification performed and remaining limitations without investigating hook
runtime as a detour. Existing native denials still win. Source redaction is
conservative pattern detection, not a general secret classifier; unsupported or
ambiguous source inputs are skipped.

Protocol references: [Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Claude hooks](https://code.claude.com/docs/en/hooks), and the installed
Antigravity `agy-customizations/docs/hooks.md` for the deployed AGY version.
Frozen CLI tests establish adapter behavior; separate ordinary-client checks
are required before claiming provider activation.

## Missing-evidence diagnostic advice

After an assessment returns raw `verification=insufficient_evidence`, the
optional native `advise` envelope supports `mode: "evidence"`. See the
[fresh-prompt procedure](codex-compliance.md#diagnose-a-frozen-insufficient-evidence-assessment).
It resolves a same-repository frozen native task by ID; it does not retry
assessment or amend the original answers, review or route.

The self-contained advisor also accepts `evidence --input FILE --out FILE`.
That JSON input has exactly four strings: `request`, `spec`, `context`, and
`assessment`, with the latter three containing the original files' exact UTF-8
text. The advisor validates the embedded spec/context hashes and insufficient
verification answer. The native adapter additionally validates the full original
assessment, target repository, managed paths, current owner and prompt. Direct
CLI advice grants no native admission exception or implementation authority.

Eight fixed choice questions inspect method, fixture, procedure, expected result,
counterexample, and source/caller/detector provenance across the supplied spec
and context. Each returns `present`, `missing`, `contradictory`, or `unknown`,
with validated confidence/probabilities. Results retain exact snapshot hashes,
per-element checks and a list of missing/contradictory elements. Unknown remains
`NOT_EVALUATED`; valid known advice remains `REVIEW_REQUIRED`. Provider/schema
failures stay unevaluated. No confidence threshold is assumed calibrated.

This fresh untrusted advice may help locate a gap, but cannot reveal a definitive
reason for the earlier model's answer. All-present results still require Control
review and grant no authority. Planned detectors are assessed as plans; the
diagnostic does not demand executed acceptance for an unimplemented change.

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

### Passage classification cookbook

The optional passage signals adapt the official
[classifying RAG passages cookbook](https://docs.typesafe.ai/cookbooks/classifying_rag_passages).
Set `"passage_checks": true` beside `request` and `candidates` in the same
context JSON, then use the existing CLI:

```powershell
rtk proxy node scripts/jev_agent.js context --repo D:/project --input context.json --out context_advice.json
```

Omitting `passage_checks` defaults to false and preserves the original request,
Choice questions and output shape; explicit false also disables the extension.
The field accepts only booleans. When true, the existing `c0`, `c1`, … relevance
Choices remain, with three Noul questions per candidate:
`c0::evidence`, `c0::conflict`, and `c0::injection` (and the corresponding next
indices). They ask whether the supplied passage supports the request, conflicts
with the request or another candidate, or attempts to redirect instructions or
actions. All questions share at most one request with the existing 10-second
timeout, no retries, 32-candidate limit and 64,000-byte serialized request limit.
Only caller-supplied snapshots enter the request; source paths are never read.

Each ranked candidate gains `passage_signals` with `evidence`, `conflict` and
`injection` keys, each retaining the raw `{ "type": "noul", "noul": 0.5 }`
answer. These probabilities do not determine source authority, remove candidates
or alter ordering. Relevance fields remain intact, required sources come first,
and equal-priority sources retain their input order. Every source/path/line/cell/hash
field survives. Missing credentials, oversized requests, provider failures and
any malformed or partial mixed reply return `NOT_EVALUATED` with all original
candidates in their original order and no partial signals.

```powershell
$env:ORCA_BACKGROUND_LAUNCH = '1'
node --test scripts/test-jev-cookbooks.js scripts/test-jev-agent.js
```

The passage fixtures cover mixed typed answers, raw conflict/injection values,
notebook provenance, stable required-first ordering, omitted/false compatibility,
missing credentials, oversized UTF-8 snapshots and malformed replies. An isolated
copy of the CLI verifies self-contained transport, no-clobber output and content-free
stdout/errors; injection-like source text remains data and is never executed.
These are mocked acceptance checks, not a live provider quality evaluation.

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

Skill advice follows the [two-pass suggestion recipe](https://docs.typesafe.ai/cookbooks/skill_suggestion):
rank the supplied roster with a Choice and three request Noul gates, then
rerank the top three with full descriptions, 700-character instruction excerpts
and independent fit Nouls. The oriented gate mean and maximum fit each require
0.30. These are recipe defaults, not calibrated task-admission thresholds.
`suggestions[]` contains at most one original record; `suggestion` is its alias
or null. `suggestion_block` is an optional prompt hint, including an explicit
no-fit sentence, appended after the unchanged roster. Mandatory and explicit
skills retain precedence. See [the detailed contract](jev-skill-advice.md).

Operational callers supply only task-relevant candidates,
excluding disabled and unrequested explicit-only sources after local policy
checks. Keep applicable required/explicit records and their unchanged policy.
An explicit request to inspect a full catalog may still supply every enabled
record. Every enabled supplied record enters wide ranking; only the final three
are read in detail. Catalogs exceeding the Choice or byte limits use bounded
ranking chunks and shrinking survivor rounds. Control reviews the suggestion;
independent native admission still checks policy and execution
evidence. An empty roster needs no model call. A failed optional call stays
`NOT_EVALUATED` without invalidating a correctly reviewed native task.

## Terminal guardrails cookbook

Explicit caller snapshots can request advisory terminal hazard probabilities:

```json
{
  "request": "Inspect repository status",
  "commands": [
    { "id": "status", "command": "git status --short", "shell": "powershell", "cwd": "D:/project" }
  ]
}
```

```powershell
node scripts/jev_agent.js guardrails --repo D:/project --input commands.json --out command_advice.json
```

The envelope accepts only `request` and `commands`; each command accepts exactly
`id`, `command`, `shell`, and `cwd`, all nonempty strings. Supply 1..32 commands
with distinct IDs. The complete serialized provider request has a 64,000-byte
UTF-8 limit. Shape, count and byte guards run before credential lookup or fetch.
Invalid shapes and oversized snapshots return `NOT_EVALUATED` (CLI exit 3).

Successful advice returns `REVIEW_REQUIRED`, `authority: "NONE"`, and `commands`
in submitted order with all four original fields. Each record adds `hazards`
containing `destructive_effects`, `sensitive_data_access`, `exfiltration`,
`elevated_privileges`, and `scope_mismatch`. Each hazard is a typed atomic
`{ "type": "noul", "noul": 0.25 }` probability in [0,1], copied without
rounding, aggregation or normalization. Hazards are independent and need not
sum to one. No cutoff, approval, denial, execution or routing decision follows.

Missing keys, provider failures and malformed replies return `NOT_EVALUATED`
with original command records and fixed failure diagnostics where available;
they never substitute zero probabilities. The snapshot is treated as untrusted
data, including instruction-like command text. This mode does not read command
targets, source files, shell history or secrets; only the existing credential
lookup and explicit CLI input are read. Native approval and execution authority
remain unchanged. Output creation stays exclusive; stdout contains only the
status, reason, count and output location, never commands, source or keys.

```powershell
node --test scripts/test-jev-cookbooks.js scripts/test-jev-agent.js
```

The guardrails fixtures use mocked fetch, including a standalone copy of the
advisor without sibling modules. They verify exact command identity and all
per-hazard values, closed shapes, duplicate IDs, empty/oversized lists, the byte
limit before credentials, missing keys, unavailable providers and malformed
replies. Injection-like text remains data; CLI checks cover a command execution
marker remaining absent, no-clobber output and no key/source/command content
in stdout or errors. These fixtures test wiring and validation, not provider
accuracy or probability calibration; no live provider call is required.

## Evaluate the advisory policy

Use the synthetic shadow harness to record model observations without activating
permission or Stop rules. Both modes require a new output file in an existing
directory; existing results are never overwritten:

```powershell
node scripts/jev-shadow-eval.js --live --repeats 2 --out .dely/local/jev-shadow-new.json
node scripts/jev-shadow-eval.js --replay .dely/local/jev-shadow-new.json --out .dely/local/jev-shadow-replayed.json
```

Live mode uses the existing TypeSafe credential lookup and sends only the committed
synthetic cases. It stops on the first provider/transport failure rather than
retrying. Repeats are bounded to 1..5 and have fresh evaluation identifiers; replay
performs no network requests and validates the dataset/model identity. The report
keeps raw answers, unknowns, semantic accuracy/coverage, confusion counts and
repeatability. Example confidence thresholds are replayed hypothetically with
`calibrated: false` and `activated: false`. Replay validates structure and identity,
not the authenticity of a manually edited result file.

The [self-consistency cookbook](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook)
explains why agreement is not correctness. Synthetic acceptance results and mocked
unit tests are not calibration on labelled representative user traffic. Control
must review a separate holdout evaluation before proposing automatic action.

## Citation verification cookbook

This adapts the official [double-checking citations cookbook](https://docs.typesafe.ai/cookbooks/citation_check)
with normalized literal matching, section-only citations and mandatory Control review.

Reviewers supply immutable snapshots explicitly; this mode never opens source
paths, histories or citation targets:

```json
{
  "request": "Check the review's export claim",
  "sources": [{ "id": "module", "path": "src/export.js", "source": "Exports are disabled." }],
  "citations": [{ "id": "review-claim", "source_id": "module", "claim": "Exports are enabled", "quote": "Exports are disabled." }]
}
```

```powershell
node scripts/jev_agent.js citations --repo D:/project --input citations.json --out citation_advice.json
node --test scripts/test-jev-cookbooks.js scripts/test-jev-agent.js
```

The envelope has exactly `request`, `sources`, and `citations`. Citation records
have exactly the fields shown above; `quote` may additionally be `null` for a
section-only reference. A source can add boolean `complete` and `context_complete`
plus a lowercase SHA-256 `document_sha256`. Legacy supplied snapshots default to
complete; a caller passing an excerpt must mark document completeness honestly.
All other shown fields are nonempty strings. Both lists contain 1..32
records with unique IDs within each list; every `source_id` must identify a
supplied source. The complete JSON snapshot and serialized provider request
each have a 64,000-byte UTF-8 ceiling. Shape, identity and snapshot size guards
run before credentials or transport; invalid inputs remain `NOT_EVALUATED`.

Literal quotation matching folds curly quotes and collapses whitespace, retaining
case. Absence from a complete supplied source deterministically produces
`judgment: "fabricated"`, `quote_present: false` and `REVIEW_REQUIRED`. An absent
quote in an incomplete source remains `NOT_EVALUATED` with `INCOMPLETE_SOURCE`;
incomplete semantic context remains `INCOMPLETE_CONTEXT`. A null quote bypasses
literal matching and uses the identified section for semantic checking. The hook
never synthesizes an assistant quotation from source lines. Only eligible citations and
their referenced source snapshots enter the semantic request. Each receives a
closed Choice of `supported`, `unsupported`, or `contradicted`; raw typed Choice,
confidence and probabilities are retained without normalization or thresholds.
All eligible citations share at most one provider request, with the existing
10-second timeout and no retries; an all-fabricated input sends zero requests.

Results preserve citation IDs, source IDs, claims, quotes, source paths and the
SHA-256 of each source's exact UTF-8 context, optional whole-document hash, plus the complete input hash. Source
text is not duplicated into results. Missing keys, transport errors, oversized
provider requests and malformed replies leave matching citations unevaluated
and the overall result `NOT_EVALUATED` (exit 3), while retaining deterministic
fabricated findings. Completed advice remains `REVIEW_REQUIRED`, with
`authority: "NONE"`; reviewers must inspect the bound snapshots and make the
acceptance decision themselves. Per-citation `evaluation_status` distinguishes
executed evaluation from unknowns; `auto_accept` is always false. The policy is
`advisory` with `calibration_status: "NOT_EVALUATED"`. No cookbook example threshold
is a calibrated permission or Stop rule. Output creation refuses existing files, and
stdout reports only status, fixed reason, count and output location.

Focused fixtures prove exact-source matching, fabricated quotes without any
API call, supported and contradicted claims, missing-key and failure retention,
closed schemas and replies, wrong source identities, duplicate IDs, count and
UTF-8 size limits, and injection-like text remaining data. A standalone frozen
CLI fixture proves no sibling import requirement, unsupported Choice handling,
no-clobber output and no key/source/command leakage in stdout or errors. These
mocked fixtures validate wiring and deterministic checks, not live semantic
accuracy or probability calibration.

## Evidence and limits

Credentials come from the process, target workspace .env, this repository .env,
installed Dely .env, then Windows User/Machine environment. Only TYPESAFE_API_KEY
is used. Keys and raw API errors are never printed. Existing output files are
refused; use a fresh run directory.

Advice remains REVIEW_REQUIRED. Missing keys, HTTP failures, invalid replies,
timeouts and oversized snapshots remain NOT_EVALUATED (exit 3). Invalid
arguments/input return exit 2. No automatic retries or confidence threshold
are assumed for task or context advice. Skill suggestion alone uses the recipe's
two Noul thresholds. Context requests retain the 64 KB and 32-candidate guards. Skill
packets use 60,000-byte total and 30,000-byte shared-State-plus-question guards;
these measure UTF-8 transport bytes, not tokens. Each skill Choice has at most
255 options; larger catalogs are chunked rather than truncated.

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
