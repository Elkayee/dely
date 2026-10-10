# Complete session and home skill advice for Codex

Codex compliance preparation combines the complete supplied session roster with
the user's `~/.agents/skills` catalog. Session entries include available system,
plugin, repository and `.codex/skills` skills, including Dely's delivery skill.
It reads each home `SKILL.md` name and description,
`agents/openai.yaml` invocation policy, and disabled paths in the active Codex
home's `config.toml`. Nested skill folders and directory links are supported;
ancestor links cannot create an infinite scan. Unsupported metadata fails
closed rather than silently dropping skills.

The exact supplied session roster remains in `session-skills.json` for mandatory
and explicit Control selections. `skill-sources.json` retains every original
session/home name, path, description, policy and source. `skills.json` contains
one record per canonical source, preferring the session name/path/description.
Aliases retain the most restrictive supplied, source and configuration policy.
Skill instruction bodies are never sent to Jev.

The snapshots, advice, all catalog source files, invocation policies and active
configuration are fingerprinted. Original path bindings are checked separately,
so retargeting an alias invalidates admission even with identical source bytes.
Absent policy/configuration files are recorded explicitly; creating one or
changing a source during an API request requires fresh preparation and review.
Each Control selector must identify exactly one original record.

Every enabled combined skill enters advisory evaluation, including explicit-only
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

Codex preparation prints every suggested name/path, explicit-invocation flags,
selection counts and the
complete advice file path. Full metadata/evaluations remain in that file to
keep the CLI response compact. Control reviews all recommendations against
the actual task, combines accepted records with mandatory/user-selected skills,
and passes all chosen names or unambiguous paths to `review --skills`. Review
rejects disabled records and unrequired explicit-only records before reading
their instruction bodies. To use an explicit-only skill, the actual session
roster must contain that exact name/path and `required_skills` must record the
user's explicit request or an applicable mandatory workflow. Merely accepting
a Jev suggestion in `--skills` is insufficient. Review loads admitted instruction
bodies; recommendations alone grant no authority.

`selection.catalog_count` counts all discovered records; `eligible_count` counts
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
check combines a session Dely skill recommendation with eligible route selection
and verifies that mutation still requires a matching dispatch. CLI routing tests resolve the existing installed
routing/usage modules when an isolated checkout lacks those machine-local files.

Install the adapter with the existing compliance installer and this checkout's
`scripts/jev_agent.js` as its advisor source in both Codex homes. Reinstallation
retains the existing credential search root and copies no API key. Preserve
trusted hook wiring, then prepare and explicitly review the current task again
under the new frozen fingerprints. Final acceptance requires a real provider
multi-skill advice consumed by the deployed Codex prepare/review flow.

Provider references: [Choice](https://docs.typesafe.ai/primitives/choice),
[models and context limits](https://docs.typesafe.ai/models), and
[skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion).
