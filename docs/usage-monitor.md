# Local Dely usage monitor

Run from this checkout:

```powershell
node scripts/dely-monitor.js --enable-logging
```

Open http://127.0.0.1:8787. Use `--port` for another local port. The monitor
binds only to loopback and serves a metadata-only, read-only API. It has no
external assets, framework, database or scheduled automation.

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
  unknown. Undated inventory rows are shown independently of the date window.

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

## Checks

```powershell
node --test scripts/test-dely-monitor.js scripts/test-task-routing.js scripts/test-jev-agent.js
```

Tests cover task/dispatch identity, retry/fallback counts, unknown data,
denominators, metadata redaction, partial JSONL tails and the loopback API.
Source and live UI verification are recorded in
`docs/_plans/2026-10-09-usage-monitor.md`.
