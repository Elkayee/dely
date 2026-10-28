# Jev cookbook alignment

The approved change keeps Jev advisory while correcting how citations and task
context are constructed. Native Dely admission, native denials, source privacy
boundaries and worker ownership remain unchanged. No confidence threshold has been
calibrated or activated.

## Source-backed design

The [citation cookbook](https://docs.typesafe.ai/cookbooks/citation_check) separates
normalized literal matching from the semantic relation between a claim and its
identified section. It supports section-only citations without a quotation. The
implementation accepts `quote: null`, never substitutes a source line for the
assistant's quotation, folds curly quotes and whitespace, and distinguishes a
missing literal in a complete source from incomplete evidence. Raw relation names
remain `supported`, `unsupported`, `contradicted` and deterministic `fabricated`.

Local adaptations are explicit: privacy-checked documents are bounded to 256 KiB;
exported contexts remain bounded to 12,000 UTF-8 bytes. Small documents can be used
in full. Long documents need a Markdown section or a recognized top-level
JavaScript declaration. Unanchored long documents, ambiguous literal locations,
oversized sections and compound references remain unevaluated. This is a bounded
locator, not general code analysis or multi-file proof. Instruction files,
credentials, linked paths and out-of-workspace files remain excluded.

The [guardrails cookbook](https://docs.typesafe.ai/cookbooks/llm_guardrails) separates
assessment from application policy. Here the policy stays advisory: Jev does not
create a Stop continuation/block or permission grant. Control reviews raw results.
The cookbook's example thresholds are not copied into native permissions.

The [state guide](https://docs.typesafe.ai/concepts/state) motivates supplying the
facts a question needs. The Codex adapter passes bounded objective, scope,
acceptance and spec/context hashes only after current immutable native-task
validation. Other providers or unreviewed turns have no confirmed scope;
scope-dependent hazard questions are not asked and their outputs stay
`NOT_EVALUATED`. Independent command hazards remain available. Cache identities
bind both the evaluated request/options and confirmed task hashes.

## Executed evidence

Before implementation, seven new isolated regressions failed on the original
source. Those seven passed after the core change. A subsequent focused run of
workflow, cookbook and shadow-evaluation tests passed 49 tests before the final
block-quotation regression was added. Final integration counts are recorded in the
delivery review artifact rather than inferred here.

An explicit live synthetic evaluation ran:

```powershell
node scripts/jev-shadow-eval.js --live --repeats 2 --out .dely/local/jev-shadow-20261027-01a17d9d.json
node scripts/jev-shadow-eval.js --replay .dely/local/jev-shadow-20261027-01a17d9d.json --out .dely/local/jev-shadow-replay-20261027-01a17d9d.json
```

Both commands completed. Eight labelled cases produced sixteen observations:
twelve semantic Jev evaluations matched the authored labels, two fabricated
quotations were handled locally, and two incomplete-source cases remained
unevaluated. Replay reproduced the metrics. Results retain raw answers, dataset
identity, requested model and fresh per-observation identifiers. Transport failure
stops the experiment without retry; output creation is exclusive.

These cases cover literal support/contradiction, unrelated sections, fabrication,
normalization, section-only evidence, incomplete sources and instructions embedded
in source text. They are a small synthetic acceptance set, not held-out user
traffic or proof of general accuracy. No production threshold was calibrated.

The [self-consistency cookbook](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook)
distinguishes repeatability from accuracy. Illustrative threshold replays in the
evaluation report are hypothetical and cannot activate policy. A larger labelled
holdout set and explicit Control review remain necessary before considering any
automatic action.

## Deployment boundary

Release pins advance together to 0.27.28. Synchronization must report `COHERENT`
for every selected home. A fresh native session must load the updated roster;
source tests and synthetic Jev evaluation do not certify ordinary provider-session
activation or a real database connection.
