# Native skills and optional Jev advice for Codex

Codex's native session roster and Control selection are the default. Compliance
`prepare` does not call the skill advisor or merge the whole home catalog.
It records `native-session` provenance and `NOT_REQUESTED` advice status while
preserving independent task assessment and reviewed execution requirements.
Missing optional advice is not missing execution evidence. Native discovery's
explicit and implicit invocation behavior is described in OpenAI's
[Build skills](https://learn.chatgpt.com/docs/build-skills) documentation.

The exact supplied session roster remains in `session-skills.json` for mandatory
and explicit Control selections. `skill-sources.json` retains every original
native name, path, description and source. `skills.json` preserves supplied
metadata without sending it to a provider. Required sources are frozen at
prepare and selected sources at review. Unrelated skill bodies are not read
for selection or added to admission fingerprints.
Aliases retain the most restrictive supplied, source and configuration policy,
including YAML at both the supplied path and the canonical target directory.
Skill instruction bodies are never sent to Jev.

The task/native metadata snapshots, selected and required sources, policies and active
configuration are fingerprinted, including both alias and canonical YAML paths
even when either policy file is absent. Original path bindings are checked separately,
so retargeting any supplied roster alias invalidates admission even with identical
source bytes. This also catches a previously unrelated restrictive alias joining
a selected policy group, without hashing that unrelated skill's body.
Absent policy/configuration files are recorded explicitly; creating one or
changing a protected source during assessment or local loading requires fresh preparation and review.
Each Control selector must identify exactly one original record.

Optional skill advice uses the existing `jev_agent.js skill --repo ... --input
... --out ...` command when requested, when relevant candidates compete, or
when targeted native discovery misses a needed workflow. Operational callers
choose relevant metadata first, use the existing `combineSkills` policy helper
on those supplied records, and exclude disabled and unrequested explicit-only
sources. An explicit full-catalog inspection can still use `discoverSkills`
and `combineSkills`; nested folders and links retain their existing behavior.
No automatic home scan, policy rewrite or top-k limit is introduced.

Every enabled supplied skill enters public advisory evaluation, including explicit-only
records. Useful explicit-only suggestions retain their policy and include
`requires_explicit_invocation: true`. Their suitability does not authorize
automatic invocation. Disabled records remain local with a `NOT_EVALUATED`
evaluation and reason `DISABLED`; they are not sent or suggested. Jev's
suggestion cannot waive mandatory skills or authorize an implementation.

## Requests and selection

Each packet uses `state: { request, selection_rules, rubric }`. Common rules and
the four relation definitions appear once per packet. Every enabled skill gets
its own Choice containing its name and complete description once, under an ID
tied to its original catalog index. Question instructions refer to the shared
rules and rubric; criteria use short self-contained descriptions to distinguish
the four options. Full applicability rules are shared rather than repeated.
The possible relations are `direct`,
`supporting`, `unrelated` and `unknown`. Skills are judged independently against
the actual requested actions; several complementary workflows can fit one task.
Paths and full instruction bodies stay local.

Every enabled skill is evaluated once, packed into a conservative 60,000-byte
transport budget. Shared State plus an individual question must separately fit
30,000 bytes, including JSON overhead; an oversized pair stops before any API
call. HTTP packets remain sequential; questions inside each packet are evaluated
in parallel by Jev. There is no catalog-size or top-k recommendation limit. Each
Choice has four options, so the provider's 255-option limit does not restrict
the number of skills across packets. These byte budgets are conservative guards
for the provider's distinct 64k total and 32k State-plus-longest-question token
limits, not tokenizer measurements. An individually oversized request/description is
reported as `NOT_EVALUATED`; it is never truncated.

Read `suggestions[]` for all records classified as direct or supporting. Direct
records precede supporting records, preserving catalog order within each group.
This order is not a confidence ranking. `suggestion` is only the leading-record
legacy alias. `evaluations[]` retains each skill ID, relation, probability
distribution and provider confidence, including unknown judgments for Control.
Unknown and unrelated entries are not automatically suggested. A valid empty
recommendation list has `REVIEW_REQUIRED` status. Provider/validation failures
have `NOT_EVALUATED` status and an empty list, without partial recommendations.

Live provider probabilities can be rounded to two decimals and sum to 0.99 or
1.01. Skill replies normalize only small errors within the four-value rounding
bound and retain `raw_probabilities` when normalization occurs. Arbitrary mass
loss, invalid values and mismatched chosen labels still fail validation.
Provider confidence is retained unchanged and has no approval cutoff. Context
advice retains its existing strict validation and behavior.

The standalone advisor prints every suggested name/path, explicit-invocation
flags and the complete advice file path. Full metadata/evaluations remain in
that file. Control reviews all optional recommendations against
the actual task, combines accepted records with mandatory/user-selected skills,
and passes all chosen names or unambiguous paths to `review --skills`. Review
rejects disabled records and unrequired explicit-only records before reading
their instruction bodies. To use an explicit-only skill, the actual session
roster must contain that exact name/path and `required_skills` must record the
user's explicit request or an applicable mandatory workflow. Merely accepting
a Jev suggestion in `--skills` is insufficient. Review loads admitted instruction
bodies; recommendations alone grant no authority. Native preparation creates no
advice file and reports local selection provenance. Failed optional HTTP calls,
timeouts or invalid responses remain `NOT_EVALUATED`, and a changed or missing
optional advice file adds no denial to independently valid admission.

For optional advice, `selection.catalog_count` counts supplied records; `eligible_count` counts
enabled records sent for evaluation; `explicit_count` counts their explicit-only
subset; `disabled_count` counts excluded records. `evaluated_count` records actual
provider coverage, and `requests` records the HTTP call count.

## Verification and installation

Run `node --test scripts/test-jev-agent.js scripts/test-jev-skills.js
scripts/test-jev-multi.js scripts/test-codex-compliance.js` from this checkout.
Tests cover complete 106, 500 and 1,000-entry catalogs, 30 late recommendations
without a top-k cut, complementary workflows, uncertainty, provider rounding,
policy restrictions, home discovery, session-only policy enforcement, aliases,
failures, mandatory Control selections and immutable snapshots. An integration
check combines native session skill selection with independent eligible route assessment
and verifies that mutation still requires a matching dispatch. CLI routing tests resolve the existing installed
routing/usage modules when an isolated checkout lacks those machine-local files.

Install the adapter with the existing compliance installer and this checkout's
`scripts/jev_agent.js` as its advisor source in both Codex homes. Reinstallation
retains the existing credential search root and copies no API key. Preserve
trusted hook wiring, then prepare and explicitly review the current task again
under the new frozen fingerprints. Existing records are not silently migrated.
Final acceptance checks zero default skill-advice calls, mandatory skill loading,
selected-policy/alias integrity, and unchanged direct/Dely/worker admission.
Deployment follows the plan's comparative and native-session release gates.

Provider references: [Choice](https://docs.typesafe.ai/primitives/choice),
[models and context limits](https://docs.typesafe.ai/models), and
[skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion).
