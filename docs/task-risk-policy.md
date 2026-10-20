# Task risk policy

Policy `jev-task-routing-v4` classifies changed behavior and consequences.
Codex Control reviews every decision. A repository name, small diff, confidence
score or routine delivery step does not authorize a lower grade.

## Precedence and ownership

| Final difficulty | Workflow | Primary | Fallback |
| --- | --- | --- | --- |
| Easy | Dely | AGY `gemini-3.8-flash-medium/default` | Existing Luna/max exception |
| Medium- | Dely | AGY `gemini-3.8-flash-medium/default` | Existing Luna/max exception |
| Medium+ | Dely | Codex `gpt-6.1-sol/medium` | None |
| Hard | Direct | Codex `gpt-6.1-sol/xhigh` | None |

Only Easy/Medium- permit one explicit provider-quota or reconciled transport fallback to Codex
`gpt-6-luna/max` at stage 1, after the prior attempt is inactive and released
when required. A successful nonempty AGY catalog proving the requested model
absent also permits that pin. Authentication, discovery failures, unclassified
timeouts, unknown outcomes and unapplied live model/level evidence stop. A
classified adapter transport timeout is eligible only after reconciliation;
timeout alone never proves that a worker stopped. Medium+ waits or stops
when Sol is unavailable; provider failure never changes difficulty.

For `--fallback network --fallback-stage 1`, the recorded original AGY pin,
Run and frozen assessment hashes must match. A completed successful result is
retrieved, not replaced. A submitted attempt needs exact native identity,
failed/canceled settlement, inactivity and confirmed release. Before submission,
an owned terminal must be closed and observed exited; a lost terminal-create
response remains unknown. Auth/config/catalog failures do not classify as
transport evidence. Each snapshot claims stage one once and each Run serializes
dispatch/recovery. A stale crash lock requires Control to verify the original
process and owned workers are inactive before removing that exact lock.

Known consequential risk in one of the five automatic exclusions selects Hard
before missing-input checks or Jev. `production` alone is context for Jev,
not an automatic exclusion.
Without known Hard, incomplete or unconfirmed evidence stays
`NOT_EVALUATED`. Native preparation still requires complete inputs even
when core classification has already identified Hard.

Jev retains five fixed dimensions: scope, uncertainty, risk, verification and
coordination. Its original difficulty is their **maximum**, never a vote.
An `insufficient_evidence` answer leaves `jev_difficulty=null` and blocks
non-Hard approval. A simultaneous Hard answer remains a veto. Every raw Hard
answer vetoes correction, including at low confidence. No confidence cutoff
is assumed calibrated.

## Consequential risks

Supply strings `scope`, `coupling`, `acceptance`, `evidence`,
`requirements_confirmed: true`, and all six boolean risks in the context.

| Flag | Routing effect | When false can be supported |
| --- | --- | --- |
| `security` | Authentication, authorization, trust boundary, secret access or permission enforcement changes | Internal display preserves permissions, data visibility and access capabilities |
| `data` | Authoritative data changes, sensitive-data exposure, persisted schema/manifest compatibility or business meaning | Known rendering/filtering preserves meaning, persistence and exposure |
| `public_contract` | A consumer interface or compatibility guarantee changes | A private helper preserves its callers' contract and trust boundary |
| `architecture` | System boundaries change or consequential architecture remains unresolved | Internal extraction preserves known boundaries, owners and dependencies |
| `production` | Required production context; does not automatically select Hard | The task has no production context |
| `routing` | Delegation policy, admission, fallback authority or worker ownership changes | Ordinary dispatch applies the existing reviewed policy |

Only `security`, `data`, `public_contract`, `architecture` and `routing` are
automatic Hard exclusions. With only `production=true`, complete evidence
reaches Jev and normal Control review, retaining its raw five-dimension maximum.
Production context neither forces Easy nor bypasses Dely admission. Missing or
malformed production context stays `NOT_EVALUATED`, like the other required keys.
Existing saved decisions remain historical evidence; assess a fresh snapshot
to use this rule. The six-key schema and v4 binding remain unchanged.

Control records the concrete effect behind every true exclusion and the context
behind production. Unknown is not
false. Read-only access can expose sensitive data; an internal endpoint can
change authorization or compatibility. Writing a consequential migration
retains data risk before deployment. Converting missing values to zero or
changing units/timezones can change business meaning without deleting data.
In the same data repository, rendering unchanged values can preserve it.
Evidence identifies the relevant file/function, schema, endpoint, contract or
requirement; before/after behavior; affected consumers; and a detector for a
wrong result. A destructive command or a line number for unwritten code is
not required. Missing facts require context before low-tier approval.

Resolve missing facts or incorrectly assigned Hard flags in a **new snapshot**
and assess again. Preserve the old record and explain the changed facts.
A reason string cannot downgrade known Hard on the same snapshot.

## Optional correction

Normal low tasks need no extra proof. A correction candidate requires complete
confirmed evidence, all six boolean values, five false automatic exclusions
(production may be true), and a valid Jev response with exactly one
Medium+ dimension: verification or coordination. Every other dimension must
be at most Medium-. Candidate metadata grants no route change: normal review
retains Medium+/Sol until Control explicitly approves a valid correction.
Control reads all five stored answers and records its decision against the
rubric and frozen snapshot. Retaining Medium+ with a reason is a valid normal
review without a proof file. Missing correction proof does not make otherwise
complete task evidence incomplete. Correct only when the proof establishes
the exception; otherwise retain Medium+ or assess a new, corrected snapshot.

Only that one dimension may change `medium_plus -> medium_minus`; recompute
the vector maximum and require final `medium_minus`. Scope, uncertainty,
risk, raw Hard, abstention and multiple high dimensions are outside this
exception. Use normal review without proof to retain or raise difficulty.

All three review CLIs accept optional `--review-evidence-json <JSON>`:
the router, `scripts/jev_agent.js`, and `scripts/codex-compliance.js`.
The API is `review(assessment, difficulty, reason, { correction: proof })`.
With proof, `--difficulty medium_minus` and `--reason` are required.

Proof is a JSON object of at most 8 KiB, with no unknown fields:

- `schema_version: 1`, `assessment_basis_sha256`, `dimension`,
  `reason_code`, `explanation`, `evidence_refs`, and `acceptance`.
- Reason `verification_instrument_available` applies to verification;
  `routine_coordination_only` applies to coordination.
- References are `{ "source": "context", "field": "scope" }`, with field
  limited to scope/coupling/acceptance/evidence, or
  `{ "source": "spec", "excerpt": "exact frozen text" }`.
- Acceptance contains nonempty strings `method`, `procedure`,
  `expected_result`, and `would_fail_if`.
- Coordination alone also requires `coordination_facts`: nonempty
  `changed_boundary`, `callers_callees`, `integration_obligations`, and
  a nonempty string array `counted_routine_steps`.

For example, this verification proof is parseable JSON. Replace the zero hash
with the candidate's actual basis. Its fixture and detector facts must already
be recorded in that snapshot.

```json
{
  "schema_version": 1,
  "assessment_basis_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "dimension": "verification",
  "reason_code": "verification_instrument_available",
  "explanation": "The frozen panel fixture and existing overflow detector cover the scoped CSS adjustment.",
  "evidence_refs": [
    { "source": "context", "field": "acceptance" },
    { "source": "context", "field": "evidence" }
  ],
  "acceptance": {
    "method": "browser_inspection",
    "procedure": "Open the agreed long-label fixture at 360px and 1280px and inspect panel, label and button bounds.",
    "expected_result": "The label is visible, the button remains inside the panel, and content does not overflow.",
    "would_fail_if": "An incorrect fixed width or missing wrap clips the long label or overflows the panel."
  }
}
```

Control checks the meaning, sufficiency and consistency of the evidence.
Schema validation and exact references cannot prove those semantic judgments.
A nonempty generic explanation is not authorization to approve a correction.
Do not infer a rationale Jev did not return. Before dispatch, establish an
available detector for a plausible wrong implementation; run feature
acceptance after implementation. A missing test runner alone does not make
verification complex, while unresolved race/state oracles can require Sol.

## Evidence and migration

Keep raw answers, confidence and probabilities in `assessment.jev`.
`advisor_state` records EVALUATED or NOT_EVALUATED; `jev_difficulty` is the
raw maximum; `difficulty` remains the current/final reviewed decision.
`correction_candidate` is recomputed from raw evidence.

The SHA-256 basis uses canonical JSON: sorted object keys, preserved array
order, finite JSON values only. It binds policy, canonical task paths, content
hashes, advisor state, model and all original answers. Timestamps, final
difficulty and route are excluded. An approved correction preserves its proof,
from/to and effective labels under `review.correction`, with a separate
`correction_sha256` and source `control-override-justified`.

Approval validation is read-only: it recomputes eligibility, basis, decision,
source, correction hash and route without changing `reviewed_at`. Native
admission freezes original `assessment.json`, compares raw evidence to it,
and fingerprints the persisted reviewed artifact. Mutable implementation files
are outside the immutable task inputs. Hashes detect mismatches; they do not
authenticate Control or prove evidence semantics.

No-Jev complete-evidence review remains `control-evidence`; API failures
never automatically supply a low grade. Valid Jev results cannot be erased to
take that path. New admission requires v4 assessments and native state
`native-skills-v4`; v3 remains historical and requires fresh prepare/review.
Refresh installed software between plans, preserving active frozen versions
and native hook definitions/trust.

## Independent slices and measurement

Prefer independent outcomes and acceptance over splitting by file type.
Each slice names outcome, boundary, owner/callers/callees, input contract,
acceptance, handoff and remaining integration dependencies. Assess it anew.
A UI component and CSS sharing one acceptance may belong in one slice.
Local implementation and integration do not have predetermined grades.
Optional domain (`ui_frontend`, `backend_api`, `data_pipeline`, `other`) and
blast-radius labels describe work; neither these labels nor file counts
select difficulty, workers or fallback authority.

For a report feedback task with live delivery, implementation can own a local
UI fixture and focused detector; integration owns report-flow acceptance;
rollout owns live activation, smoke checks, rollback and retention. Rollout
retains production context, which Jev assesses rather than automatically
selecting Hard. A security change or consequential migration retains
its own risk even in an implementation-only child. The parent stays open until
integration and rollout acceptance finish; worker completion is not parent
completion. Use existing task/run links; no planner or DAG engine is added.

Journal metadata includes raw/final grades, basis, known Hard flags, decision
source, candidate/correction dimension, reason code and correction hash.
Optional `task_title` comes from the first level-one heading outside fenced code in the frozen
spec, normalized to one line and limited to 60 Unicode graphemes; no heading gives
null. Optional `domain` comes from the frozen context and is null when invalid.
These fields cannot block admission or change routing. Metadata extraction
failure retains the basic event. Runtime metadata records the bundle version
and router/dispatcher/usage hashes, with null when unavailable.
Full prompts, context bodies and explanations stay out of the journal. Logging
failure never changes routing. Separate events from policy+taskKey snapshots,
and snapshots from parent/child tasks. Mock/replay results are not classifier
calibration or proof of increased AGY adoption.
See [usage measurement](usage-monitor.md) for confirmed-dispatch cohorts and
coverage. The 35–50% expectation is observational, never a classifier gate.
