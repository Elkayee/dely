# Home skill advice for Codex

Codex compliance preparation discovers Jev's skill catalog only from the user's
`~/.agents/skills` directory. It reads each `SKILL.md` name and description,
`agents/openai.yaml` invocation policy, and disabled paths in the active Codex
home's `config.toml`. Nested skill folders and directory links are supported;
ancestor links cannot create an infinite scan. Unsupported metadata fails
closed rather than silently dropping skills.

The supplied session roster remains in `session-skills.json` for mandatory and
explicit Control selections. The separate `skills.json` contains the home
catalog. System, plugin, repository and `.codex/skills` entries from the session
roster are never added to Jev's skill request. Both snapshots, advice, catalog
source files, invocation policies and active configuration are fingerprinted.
Absent policy/configuration files are recorded explicitly; creating one or
changing a source during an API request requires fresh preparation and review.
Each Control selector must identify exactly one original record.

Only implicitly invocable, enabled catalog entries enter automatic advice.
Explicit-only records stay in the local catalog, and Control can select them
when required by the user's instruction or an applicable workflow. Jev's
suggestion cannot waive mandatory skills or authorize an implementation.

## Requests and selection

Each packet uses `state: { request }`. Every eligible skill gets its own Choice
question containing its name and complete description once, under an ID tied
to its original catalog index. The possible relations are `direct`,
`supporting`, `unrelated` and `unknown`. Skills are judged independently against
the actual requested actions; several complementary workflows can fit one task.
Paths and full instruction bodies stay local.

Every eligible skill is evaluated once, packed into a conservative 32,000-byte
transport budget. There is no catalog-size or top-k recommendation limit. Each
Choice has four options, so the provider's 255-option limit does not restrict
the number of skills across packets. The byte budget is not a measurement of
the provider's token limit. An individually oversized request/description is
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

Codex preparation prints every suggested name/path, selection counts and the
complete advice file path. Full metadata/evaluations remain in that file to
keep the CLI response compact. Control reviews all recommendations against
the actual task, combines accepted records with mandatory/user-selected skills,
and passes all chosen names or unambiguous paths to `review --skills`. Review
loads the selected instruction bodies; recommendations alone grant no authority.

## Verification and installation

Run `node --test scripts/test-jev-agent.js scripts/test-jev-skills.js
scripts/test-jev-multi.js scripts/test-codex-compliance.js` from this checkout.
Tests cover complete 106, 500 and 1,000-entry catalogs, 30 late recommendations
without a top-k cut, complementary workflows, uncertainty, provider rounding,
policy restrictions, home-only discovery, failures, mandatory Control selections
and immutable snapshots. CLI routing tests resolve the existing installed
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
