# Jev skill-advice optimization

Approved by the user on 2026-10-10 after the shared-state payload proposal and full-catalog clarification. Hard: public advisory output and the explicit-only loading boundary change; Codex Control implements directly and independently reviews the final HEAD.

## Contract

Evaluate every enabled record discovered under HOME/.agents/skills, including explicit-only skills. Preserve original names, complete descriptions, IDs and local paths. Return every direct/supporting recommendation; mark explicit-only suggestions as requiring explicit invocation. Disabled entries stay unevaluated. Control must retain mandatory/user-selected skills and may load explicit-only records only when the task's required_skills records that explicit or mandatory requirement. Never change skill policy files.

Store the common task rules and four relation definitions once in State. Keep each skill's metadata once in its own independent Choice. Use conservative UTF-8 bounds:60,000 bytes for a packet and30,000 for shared State plus an individual question, separately. These are transport guards, not tokenizer measurements. Keep sequential HTTP packets unless real measurements establish a need for added concurrency. No shortlist, top-k, catalog-only advice cache, new dependency, or changed context advice.

## Execution and acceptance

1. Existing public advise seam: red/green regression for enabled explicit-only evaluation, all useful suggestions, unchanged records, and disabled uncertainty; then compact payload/size-bound coverage for152/500/1000 catalogs.
2. Existing prepare/review seam: expose explicit flags in compact CLI output; reject unrequired explicit-only and disabled selection before reading instructions; accept recorded mandatory/user-selected explicit invocation. Keep snapshot and selector integrity.
3. Compare current and candidate requests against real Jev using only the actual home metadata. Record coverage, body bytes, call count, timing, all returned suggestions and reviewed decisions. Check useful complementary workflows and unrelated controls; do not invent calibration or deterministic result equivalence.
4. Run focused regressions and repository closure; fresh independent Codex exact-HEAD review. Install both Codex homes from accepted source, preserve trusted hooks byte-for-byte and credential_root D:/orca, then demonstrate full-catalog prepare and multiple accepted skills loaded through review.

Scope:advisor, focused compliance integration/tests, agent-facing guides and this plan. Leave D:/orca and unrelated Taniwha state untouched. No remote publication is requested.
