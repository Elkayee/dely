# Local Dely usage monitor

Run from this checkout:

```powershell
node scripts/dely-monitor.js --enable-logging
```

Open http://127.0.0.1:8787. Use `--port` for another local port. The monitor
binds only to loopback and serves a metadata-only, read-only API. It has no
external assets, framework, database or scheduled automation.

Activity rows observed in the Orca inventory have a **Worker details** button.
Opening it reads that dispatch through `orca orchestration worker-show`; normal
startup, refresh and filtering never request worker details. Only strictly valid,
already observed dispatch IDs are accepted. Concurrent reads of the same ID
share one request, with an eight-second CLI timeout and a 32-entry, 30-second
cache (including unavailable results). The browser retains at most 32 opened
detail records; another read requires an explicit open after cache expiry.

Details keep raw dispatch status and raw outcome separate from the observed
cause. Raw failed counts include operator interruptions and remain unchanged by
diagnostic reads, as do active/succeeded counts and all adoption denominators.
Only structured `dispatch.terminationReason=operator_close` establishes that
cause; the word “operator” in report text does not. A bounded, known nested
depth/max pattern from a failed `worker_report` is labeled **reported_depth_limit**
and attributed to that report, without independent verification of the nested
attempt. Actual `dispatch.depth` is shown separately, including unknown/null.
For a reported depth limit, use root Control at depth 0 and keep max depth
unchanged. Other recognized failed reports are **worker_report**; absent or
unreadable evidence is **unknown**. Missing liveness never proves inactivity.
Loading and unavailable details do not change the source outcome. Only a small
field allowlist is returned: no report bodies/paths, prompts, raw failure JSON,
stacks, argv or credentials. The monitor adds no lifecycle actions.

`--enable-logging` explicitly creates the machine-local `~/.dely/` directory.
Dely itself still never creates this directory. Without it, logging remains
disabled. Existing prompt/source content and credentials are not copied into
assessment observations or the dashboard API, except the explicitly requested
optional frozen level-one heading (at most 60 graphemes). Missing/invalid domain is null.

## What the numbers mean

- **AGY start share** counts snapshots whose first receipt-confirmed
  implementation dispatch used AGY, divided by the confirmed cohort. The key
  is `(policy, taskKey)`, where taskKey hashes repo/spec/context. This measures
  snapshots, not independent user tasks. Hard is direct and stays outside it.
- **AGY primary share** uses the approved decision bound to that first
  confirmed dispatch. Luna-first fallback still has AGY as its primary.
- **Luna fallback share** counts AGY-primary snapshots with a confirmed
  Luna/max stage-one quota or validated network fallback, or proven-model-absence fallback through `as_of`, divided by
  AGY-primary snapshots in the cohort. It does not add a snapshot.
  Model absence records the existing backup phase with a null quota stage.
- **Low-tier primary compliance** (`lowTierPrimaryCompliance`) uses approved
  low-tier snapshot decisions, including snapshots without any implementation.
  Its numerator requires the approved Flash/default AGY primary. A confirmed
  implementation cohort is not its denominator; each policy/taskKey counts once.
- **Correction utilization** (`correctionUtilization`) uses unique candidate
  assessment bases with an effective, evidence-backed Control decision. Only a
  justified Medium- correction with its proof hash enters the numerator.
  A candidate alone is not a correction; retaining Medium+ is a valid evaluated
  decision. Repeated logging does not add bases.
- **AGY accepted without fallback** (`agyAcceptedWithoutFallback`) requires a
  `task_control_result` journal record from `codex-control`, bound to the actual
  confirmed dispatch, run, policy, snapshot and assessment basis, with a valid
  evidence hash and effective review time. Its denominator is AGY-first
  snapshots with a final Control verdict; unresolved snapshots are pending.
  Accepted snapshots with any valid Luna fallback through `as_of` leave the
  numerator, even when the fallback occurs after acceptance. Worker done and
  worker success never supply Control acceptance. The accepted dispatch itself
  must use AGY; accepting a later Codex retry cannot supply AGY acceptance.
  No final records means
  `NOT_EVALUATED` and a null rate.
- **Upward leakage** (`upwardLeakage`) uses adjudicated `task_reference_audit`
  cases, deduplicated by case/basis. The denominator contains evidence-backed
  Easy/Medium- reference cases joined to the recorded system assessment; the
  numerator contains system Medium+/Hard decisions for those cases. Without
  an adjudicated source it remains `NOT_EVALUATED`. Candidates, adoption and
  synthetic test fixtures are not ordinary workload or reference evidence.

The journal collector includes both Control result and reference audit events.
Malformed snapshot identities are excluded from decision denominators and
reported in `decisionEvidenceCoverage.invalidIdentityEvents`. An undated
contradictory decision cannot supersede or confirm a dated decision; it leaves
the affected measure pending. Missing primary details also remain pending,
while a complete primary that disagrees with policy is an evaluated mismatch.
- **Effective model pins** count each acknowledged implementation launch.
  Primary and fallback launches are separate attempts. These are Dely's
  recorded pins, not estimated token costs or a universal model benchmark.
- **Codex conversation activity** uses observed turn metadata and stays
  separate from implementation model shares. It may contain Control, review,
  direct CLI work or otherwise unidentified CLI roles. Native/runtime copies
  and repeated turn IDs are deduplicated.
- **Orca workers** are a current inventory snapshot. Durable outcomes do not
  imply that model or classification evidence exists. Missing values remain
  unknown. Undated inventory rows remain visible in ordinary rolling windows;
  an explicit browser reset excludes them from statistics and project membership.
  Numeric Orca observation times are epoch milliseconds, never guessed seconds.

The installed routing CLI and this checkout's advisor record sanitized
assessment/review metadata when logging is enabled. Earlier work without
those records is not silently assigned to a difficulty or counted as a fully
observed task population. Adoption can therefore be unavailable even while
Orca and Codex history contain activity. Empty journal or empty confirmed
cohort produces N/A (`rate: null`), never an invented zero or historic rate.

The API returns numerators/denominators, UTC `[start,end)` and `as_of`, pending
approvals, binding/history coverage and runtime cohorts. It scans retained
history before window filtering: a pre-window first dispatch cannot become a
new snapshot when retried. Duplicate dispatch IDs count once; contradictory
receipts are excluded and reported. Preflight/task_route alone is not a start.
Assessment basis, repo, exact spec/context hashes, final grade, decision source
and correction hash bind the approval, route and dispatch. Missing bindings
are coverage gaps; a run name or title cannot supply the missing identity.
Later review/retry cannot relabel the first decision or runtime cohort.

Runtime events carry bundle version and router/dispatcher/usage SHA-256.
New bundles also include `network`, the network-fallback helper SHA-256 when
present. Configured runtime verification requires that actual helper dependency
hash; older historical fingerprints retain their original fields.
The monitor verifies both configured homes' dependency hashes before marking
a matching observed runtime fingerprint VERIFIED. Missing/different runtime
evidence remains NOT_EVALUATED; today's HEAD never labels historical events.
These checks cover the configured artifacts, not every living process.
Independent measures expose numerator, denominator, pending, coverage, window
and `as_of`. Effective reviews use `reviewed_at`, never journal append order;
the latest decision wins, while contradictory decisions at one effective time
remain pending/unbound. Missing review timestamps or decision fingerprints stay
in `decisionEvidenceCoverage`; historical records are not retroactively guessed.
The optional `decision_sha256` hashes the frozen approved review and route.
There is no quota-share or adoption-share target gate.
Journal completeness is NOT_EVALUATED unless the reporting caller supplies
independent archive evidence with `historyComplete: true`. Dashboard shares
therefore describe observed snapshots and always disclose that limit.

Keep the journal and any archives. Record a new measurement start only after
runtime verification; never reset history to improve the result. The 35–50%
expectation is observational and has no routing effect. Low-tier compliance,
correction utilization and upward-leakage audit are distinct questions; this
dashboard does not infer them from adoption or candidate counts.

The dashboard reads up to ten Orca pages and states when inventory is partial.
Conversation metadata covers thirty days of locally available rollout files.
Time and workspace filters apply to the records that carry that evidence.
Probe runs are excluded by default; their filter can be enabled explicitly.

## Saved Jev statistics

The Jev section loads in the background after the fast Dely overview. It reads
only immediate `assessment.json`, `reviewed.json`, `skill-advice.json` and
`context-advice.json` files under `dely-compliance/tasks/<task>/` in the native
`~/.codex` home and Orca's runtime Codex home. Each home is limited to 4096
task folders and each file to 256 KiB; links are excluded. Unchanged small JSON
files reuse cached projections. Missing, malformed, unreadable, oversized and
capped sources remain visible in source coverage. Other filenames/locations,
session transcripts and unsaved advisor calls are outside this coverage.

Unique recorded evaluations comprise valid structured output and recognized
recorded request errors. Missing credentials/evidence, hard skips and unknown
records are separate populations. Reviews and identical assessment copies do
not add evaluations. Original Jev proposals/answers and Control routing
decisions are displayed separately in expandable rows. A reviewed artifact
without its original is labeled `ORIGINAL_UNAVAILABLE`; its frozen answers can
still be inspected. Only result fields are projected; frozen specifications,
context, candidate bodies, skill catalogs and arbitrary error text are excluded.

Skill rows show only recorded suggestion names and boolean invocation policy,
in recorded order. Modern independent evaluations and legacy single-choice
replies are supported. Legacy `suggestion: null` with valid normalized `none` /
`sN` probabilities is an evaluated no-suggestion result. Probability ids never
identify skills in the UI. Disabled/empty advice, missing saved suggestions and
valid zero suggestions stay distinct. Expand a row for safe structured output,
recorded selection counts, suggestion policy and source locations; descriptions,
paths from catalogs and frozen request content are never projected.

Hard/direct skips say that Jev was not called and a proposal is not applicable.
The result cell also shows all six recorded task risk flags (`security`, `data`,
`public_contract`, `architecture`, `production`, `routing`) without expanding
details. Only saved booleans display as true/false; absent or malformed values
say unknown/not recorded. True flags have text and a highlighted tag. Hard/direct
skips name recorded true triggers and explain that consequential-risk gates
select Hard before Jev; missing triggers are never inferred from a Hard grade.
Risk provenance identifies the original assessment or a reviewed snapshot whose
original is unavailable, independently of Control decisions. Skill/context rows
say not applicable. The API projects only these six boolean-or-null risk values,
never arbitrary risk keys or the surrounding task context.
Request errors say no valid reply; missing models say model not recorded; absent
Control reviews say no saved review. A task answer containing
`insufficient_evidence` displays Needs evidence while retaining the original
`NOT_EVALUATED` proposal and answer in the API/evidence. The mode/source-status
column preserves recorded status. Historical missing-key, size-limit and request
failures are observations, never retried or rewritten by the monitor.

New request details show only whitelisted `request_diagnostics`: measured
duration, actual HTTP status, fixed stage/code, requested model and validated
provider model. Missing telemetry is labeled as unrecorded; older model labels
are labeled legacy. `incomplete_batch_progress` is shown separately as validated
observations bound to the input hash, with batch/completion counts and request
telemetry. It never becomes final output, suggested skills or authorization and
does not add an evaluation per completed batch. Original/Control choices and
population denominators retain their existing definitions. The historical 42
generic task errors and 9 generic skill errors cannot be retroclassified; the
32 genuinely unevaluated historical records remain unchanged. No provider logs
or additional source paths are read to infer missing stages.

The local Advisor mode selector filters Jev counts, reason groups, rows and
pagination together; other dashboard populations retain their own denominators.
Reasons by mode explains valid, error, skipped, not-applicable, not-evaluated and
unknown populations under the same filters. Source coverage still describes the
bounded read. Missing denominators in other dashboard measures retain their
existing unknown or NOT_EVALUATED states and explain the evidence gap.

The existing time, workspace, probe and browser observation-start filters apply
to Jev rows. Advisor artifacts without their own time/workspace use their
co-located original assessment; that attribution is labeled and is not request
timing. Unknown times remain visible in ordinary rolling windows. An explicit
browser reset (`/api/usage?since=...`) requires a valid in-window observation
time for every statistics population, including project/unassigned membership,
workers, assessments, conversations and Jev rows. Excluded unknown-time counts
describe the evidence gap under the workspace/probe/mode filters. Source coverage
describes the entire bounded read, while mode counts describe filtered rows.
The workspace dropdown remains a retained-source catalog, not the in-window
Projects count. Resuming the rolling view restores retained visibility; reset
does not delete history or change full-history snapshot/retry attribution.
An absent advisor mode has unknown API coverage. Latency, API-call counts and
unavailable output are never inferred from file timestamps or review counts.

## Checks

```powershell
node --test scripts/test-dely-monitor.js scripts/test-dely-monitor-jev.js scripts/test-task-routing.js scripts/test-jev-agent.js
```

Tests cover task/dispatch identity, retry/fallback counts, unknown data,
denominators, metadata redaction, partial JSONL tails and the loopback API.
Source and live UI verification are recorded in
`docs/_plans/2026-10-09-usage-monitor.md`.
