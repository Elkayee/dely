# Missing-model preflight fallback

Date: 2026-10-08
Version: 0.24.6
Authority: the owner's existing instruction to use Luna/max when the
requested AGY model is absent covers the preflight healthcheck too.

## Contract

After a successful nonempty AGY catalog proves the implementation model
absent, preflight uses Codex gpt-6-luna/max directly. Dispatch retains its
reviewed assessment and hash checks. Discovery/auth/timeout/unusable catalog
and an unapplied footer remain stop conditions. No prompt is replayed.

The task was assessed Hard due to production routing and implemented directly
by Codex Control without an implementation Dely Run.

## Verification

- The new preflight regression failed on 0.24.5: 33 passed, 1 failed.
- The first fixed helper passes 36 adapter cases, including preflight absence,
  authentication failure and a wrong Luna effort pin. Its live probe selected
  Luna/max and the worker succeeded, but the startup gate missed the fast
  completion and correctly left the overall result FAIL.
- The new completion regression fails that candidate: 39 passed, 1 failed.
  Startup may accept durable succeeded completion only for the exact Dispatch;
  wrong-dispatch, failed and nondurable completion remain blocked.
- Final source and installed adapter tests: 40 passed, including completion
  identity, failed outcome and nondurable evidence negatives. Node tests: 26
  passed. Loop guard and structural closure gates passed.
- Independent v02 live probe: PASS_AUTOMATIC_PREFLIGHT_V02 for tree
  1bc1035546235684dcc4dca864e428bcfd6764b8. Actual GPT-6-Luna max sent ack and
  succeeded worker_done; implementation preflight passed and helper exited 0.
  No manual Enter, replay, restart or override. Probe terminals were closed;
  the 46 tracked files were unchanged. Other checklist rows remain unevaluated.
- Activated global/POC and enabled plugin 0.24.6; all six protocol file hashes
  match the frozen candidate. Helper SHA-256:
  82129c6fe839aa6030f6225236369c19035ce308fb14f47a843be7fd05fe6068.
  Prior 0.24.4/0.24.5 cache contents were preserved for existing sessions.
- Evidence: .tmp-dely/preflight-missing-model-20261008/CONTROL_REVIEW.md,
  preflight-v02-live-results.json and final-verification.json. The healthcheck
  assessment retained Jev NOT_EVALUATED after HTTP 401 and used explicit
  Control review. No fabricated Jev result, commit or push.
