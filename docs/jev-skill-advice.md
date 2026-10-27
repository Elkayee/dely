# Native skills and optional Jev advice for Codex

Codex's native session roster and Control selection are the default.
Compliance `prepare` performs no skill-advice call or home catalog scan.
It preserves the exact supplied roster, mandatory and explicit selections,
selected-source fingerprints, alias policies and independent execution gates.
Optional advice never grants skill invocation, routing or implementation authority.

Use `jev_agent.js skill --repo ... --input ... --out ...` when requested,
when relevant candidates compete, or when targeted native discovery misses a
needed workflow. Operational callers use the existing `combineSkills` policy
helper on relevant supplied records and exclude disabled and unrequested
explicit-only sources. Full-catalog inspection may use the existing discovery
helpers; the advisor itself does not scan directories.

The input contains `request` and `skills`. Each skill retains `name`, `path`,
`description`, and its optional `enabled` and `allow_implicit_invocation` flags.
For a self-contained cookbook roster, optional string fields
`description_full` and `body` supply detailed evidence. Otherwise only the
shortlisted SKILL.md paths are opened, relative to `--repo` when not absolute.
Their frontmatter description and opening body supply the second pass.
A missing shortlisted source returns `SKILL_DETAILS_UNAVAILABLE`, never an
invented description. Input records and their snapshot hash remain unchanged.

## Two-pass selection

1. Wide ranking sends one Choice over the enabled supplied skills, with their
   names and index descriptions. Three companion Nouls ask whether the request
   acts on the user's system, calls for a documented procedure, or can be
   satisfied in prose. Invert `prose_suffices` and take the mean. A mean below
   0.30 yields no suggestion and skips all instruction reads and reranking.
2. Reranking sends a Choice over the top three, each with its full description
   and at most 700 Unicode characters from the opening instructions. Each
   candidate also gets an independent fit Noul. If their maximum is below
   0.30, return no suggestion. Otherwise return the Choice winner, even when
   another candidate has the highest fit Noul: Choice decides which, and
   the Nouls decide whether to suggest anything.

These thresholds reproduce the supplied recipe; they are not a calibrated
accuracy or admission guarantee. A similar but unsupported service can still
receive an incorrect suggestion. The agent reviews the result against the
actual request and retains its own full roster and mandatory workflows.

When the roster fits one bounded Choice, this uses two provider requests, or
one when the request gate rejects it. Each Choice has at most 255 options.
Larger rosters use bounded ranking chunks, retaining up to three candidates
per chunk, then compare the survivors in shrinking ranking rounds before the
single detailed rerank. Probabilities from separate chunks are never compared
as if they shared one distribution. Every enabled record enters the initial
ranking unless the request gate rejects the task. No description is silently
truncated. A non-shrinking reduction or oversized question returns
`SKILL_REQUEST_TOO_LARGE`.

Packets retain the existing conservative 60,000-byte total and 30,000-byte
State-plus-question guards. These are UTF-8 transport budgets, not token
counts. Paths remain local; skill names, descriptions and shortlisted
instruction excerpts are the provider evidence. Metadata and excerpts are
treated as data, never instructions to the advisor.

## Results and policy

`suggestions[]` contains zero or one original record. `suggestion` remains its
leading-record alias, or null. This intentionally replaces the earlier
independent direct/supporting multi-suggestion behavior. An explicit-only
winner retains `requires_explicit_invocation: true`; this does not authorize
its invocation. Disabled skills are excluded from provider packets and retain
local `NOT_EVALUATED` / `DISABLED` records.

`suggestion_block` provides an optional `<skill_relevance>` prompt block.
Append it after the unchanged roster to preserve the roster's prefix cache.
A winner is explicitly advisory and may be ignored. A valid no-fit result says
that no skill in the roster appears relevant. Failed calls produce no block
claiming that nothing fits.

`passes[]` retains validated Choice/Noul answers and request diagnostics for
each rank or rerank call. `selection` retains catalog, policy, coverage, request
and round counts plus the gate, shortlist and fit results. `evaluations[]`
records initial within-packet probabilities and disabled entries; it no longer
represents independent direct/supporting classifications. Rounded Choice
probabilities retain `raw_probabilities` when narrowly normalized. Confidence
is recorded without a cutoff. Noul values must be finite numbers in [0, 1].

A valid winner or empty result remains `REVIEW_REQUIRED`. Missing credentials,
invalid replies, HTTP failures, timeouts, unreadable details and oversized
packets remain `NOT_EVALUATED`, with no partial recommendation or retry.
Validated earlier passes remain evidence when a later call fails. The usage
monitor reads both historical results and the new typed passes, projecting
only validated numeric outputs and suggestion names, never instruction text.

Control combines an accepted optional suggestion with mandatory/user-selected
skills. Native review still rejects disabled or unrequired explicit-only
sources and loads only admitted instructions. Optional advice does not alter
task assessment, model selection, dispatch requirements or worker ownership.

## Verification and installation

Run the advisor suites `scripts/test-jev-agent.js`,
`scripts/test-jev-skills.js`, `scripts/test-jev-multi.js` and
`scripts/test-jev-suggestion.js` with Node's test runner. The deterministic
fixtures cover both gates, changed winners, top-three-only reads, excerpt
bounds, duplicate names, explicit-only/disabled policy, provider failures,
rounding and complete 106/500/1000-record ranking coverage.
`scripts/test-dely-monitor-jev.js` checks compatible sanitized monitoring.
The native advisory and compliance suites verify unchanged mandatory skill
selection and independent admission.

Synchronize the registered source through native Node `scripts/sync-dely.js`
after review and closure checks. A runtime change requires a new release
version because the synchronizer preserves installed version snapshots.
Require `COHERENT` for every selected home and start a fresh session.

Provider references: [Choice](https://docs.typesafe.ai/primitives/choice),
[Noul](https://docs.typesafe.ai/primitives/noul),
[models and context limits](https://docs.typesafe.ai/models), and
[skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion).
