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

Only implicitly invocable, enabled catalog entries enter automatic advice.
Explicit-only records stay in the local catalog, and Control can select them
when required by the user's instruction or an applicable workflow. Jev's
suggestion cannot waive mandatory skills or authorize an implementation.

## Requests and selection

Each request uses `state: { request }`. Its single Choice question contains each
skill's name and complete description once, under an ID tied to its original
catalog index. Paths and full instruction bodies stay local.

The catalog has no 254-entry ceiling. Each packet has at most 254 skills plus
`none`, and uses a conservative 32,000-byte transport budget. This budget is
not a measurement of the provider's token limit. An individually oversized
request/description is reported as `NOT_EVALUATED`; it is never truncated.

Every eligible skill is evaluated in the first round. Each batch retains its
three strongest candidates, including candidates when `none` leads. The next
round compares retained candidates together; probabilities from different
batches are never compared directly. Further rounds must reduce the candidate
set, and eight rounds is the maximum. A nonshrinking shortlist, invalid response,
provider failure or missing credentials yields `NOT_EVALUATED` with no invented
suggestion. A valid final `none` yields `REVIEW_REQUIRED` and `suggestion: null`.

Successful advice retains the original input SHA, the original selected record,
final Choice probabilities/confidence, and selection counts for catalog entries,
eligible/evaluated entries, requests and rounds. Confidence has no automatic
approval threshold. Context advice retains its existing behavior.

## Verification and installation

Run `node --test scripts/test-jev-agent.js scripts/test-jev-skills.js
scripts/test-codex-compliance.js` from this checkout. Tests cover full-catalog
selection with 106, 500 and 1,000 entries, late candidates, policy restrictions,
home-only discovery, explicit `none`, failures, mandatory Control selections
and immutable snapshots. CLI routing tests resolve the existing installed
routing/usage modules when an isolated checkout lacks those machine-local files.

Install the adapter with the existing compliance installer and this checkout's
`scripts/jev_agent.js` as its advisor source in both Codex homes. Reinstallation
retains the existing credential search root and copies no API key. Preserve
trusted hook wiring, then prepare and explicitly review the current task again
under the new frozen fingerprints. Final acceptance requires a real provider
suggestion from the deployed Codex preparation flow, not only mock responses.

Provider references: [Choice](https://docs.typesafe.ai/primitives/choice),
[models and context limits](https://docs.typesafe.ai/models), and
[skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion).
