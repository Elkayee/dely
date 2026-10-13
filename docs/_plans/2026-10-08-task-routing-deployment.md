# Task routing and Jev integration deployment

Date: 2026-10-08
Version: 0.24.4
Authority: user-approved implementation and subsequent confirmation to retain
Sonnet 5.5 and block when AGY does not expose it. This Hard implementation was
performed directly by Codex without a Dely delivery run.

## Result

The local TypeSafe client sends five narrow Choice questions to
`https://api.typesafe.ai/v1/systemone` using `jev-1.13.0`. Jev proposes a
difficulty; Codex Control reviews source evidence before AGY admission.
Missing evidence, API failures, and unknown confidence calibration remain
explicit. A known Hard exclusion cannot be downgraded. Approved decisions
bind the exact spec/context hashes; stale or modified records are refused.

| Difficulty | Primary | Explicit quota fallback | Workflow |
| --- | --- | --- | --- |
| Easy | AGY Sonnet 5.5 High/default | AGY Flash High/default, then Codex Luna/max | Dely; Codex Control reviews |
| Medium | AGY Sonnet 5.5 High/default | Codex Luna/max directly | Dely; Codex Control reviews |
| Hard | Codex gpt-6.1-sol/xhigh | None | Direct execution and verification; no Dely |

The actual AGY 1.3.1 catalog currently exposes Sonnet 4.6, not the requested
`claude-sonnet-5-5-high`. Sonnet 5.5 therefore remains blocked as the owner
requested. Missing availability is not quota and does not permit fallback.
The adapter also refuses to send a prompt when the live footer does not
confirm the requested model and High level.

The owner subsequently supplied a TypeSafe key after requesting `.env` support.
Version 0.24.4 reads the process environment, workspace `.env`, package `.env`,
then Windows User/Machine environment scopes. `.env` is ignored by Git;
`.env.example` is the empty template. Parsing reads only `TYPESAFE_API_KEY`
without applying unrelated file variables or persisting the key in assessments.

Two actual calls to `jev-1.13.0` succeeded: the explicit synthetic private-helper
case was proposed Easy, and the explicit synthetic parser/consumer case was
proposed Medium. Observed round-trip times were 570 ms and 316 ms respectively.
Both results were `REVIEW_REQUIRED`; no worker was dispatched. These two checks
establish connectivity, credential loading, response compatibility, and these
sample decisions. Representative accuracy, calibration, admission error rate,
and general latency/cost guarantees remain `NOT_EVALUATED`.

## Candidate and installation

- Frozen upstream patch base: `ce7a29cc0edb351c256162e8f5076f42ba69234f`.
- Current candidate git tree: `92c7c7e4aea5bc5ed03ae117bcf8949cc2c50c5d`.
- Candidate was installed from `git archive` of that tree. This is an explicit
  tree SHA, not a claimed branch-head commit.
- Helper SHA-256: `65e16d1a9b471276520f1f955fa19a2d10fd32f8bc32d7422dd1b544b81a7f7c`.
- Current source snapshot: `D:/orca/.tmp-dely/routing-package-deca23df-a416-4380-ae27-42c5ce50d230/snapshot`.
- Local POC: `D:/orca/.dely-poc`.
- Global source: `C:/Users/Home33/.codex/dely-orca-agy-global`.
- Native profile cache: `C:/Users/Home33/.codex/plugins/cache/dely-orca-agy-global/dely/0.24.4`.
- Orca runtime profile cache: `C:/Users/Home33/AppData/Roaming/orca/codex-runtime-home/home/plugins/cache/dely-orca-agy-global/dely/0.24.4`.

The native and runtime marketplaces were re-registered to the updated global
source instead of the previous probe snapshot. Existing installs were updated
by copying task-owned files with backups, without deleting or recloning them.
Previous cached versions and the initial candidate snapshot are retained.
No Git push was performed.

## Verification and limits

| Instrument | Result | What it establishes |
| --- | --- | --- |
| `scripts/test-task-routing.js` | 15 passed | HTTP request shape, typed response validation, unknown/error handling, review, hash binding, large staged prompts, and `.env` loading/precedence |
| `scripts/test-quota-backup.ps1` | 25 passed | Model/effort argv, difficulty-specific chains, fresh working evidence, blocked Hard/stale tasks, missing model and wrong footer rejection |
| `scripts/test-loop-guard.ps1` | PASS | Repeated-failure and bounded invocation guards |
| Structural closure instruments | 23 passed | JSON/schema, manifests/version, CommonJS, JS/shell syntax, absent rails, lexical gates, README role rows, and whitespace |
| Independent initial live probe | Model identity FAIL | Sentinel completed, but actual AGY footer was Flash/medium without quota despite requested Sonnet; success was not accepted as model proof |
| Independent corrected live probe | ACCEPT: BLOCKED_AS_REQUESTED | Missing Sonnet was refused before any new terminal/worker/prompt; no fallback occurred |

`jq` was not installed, so native `JSON.parse` plus the exact documented
predicates replaced those JSON gates. Git Bash ran the tracked shell syntax
gate. The live host was Orca 1.4.219, AGY 1.3.1, and Codex 0.160.0.

The independent reports are retained at
`D:/orca/.tmp-dely/task-routing-live-probe-report.md` and
`D:/orca/.tmp-dely/task-routing-live-probe-remediation-report.md`.
The corrected probe created no live worker resources. Its diagnostic staged
prompt remains at
`D:/orca/.tmp-dely/run_0153a50c3146-prompt-56272431f489c01c.txt`.
The worker-launch helper is unchanged from the independently verified 0.24.3
candidate, with the same SHA-256 above. The 0.24.4 change adds credential-file
reading only. Real Sonnet execution remains unverified and blocked as requested.
The actual Jev check is recorded at
`D:/orca/.tmp-dely/jev-live-50bd02b3-a944-4cdd-80e1-e9c097ad21e1/result.json`.
