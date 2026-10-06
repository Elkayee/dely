# Dely + Orca POC

POC architecture:

```text
GPT / Codex Control + Review
       |
       | implementation only
       v
      Dely
       |
       v
      Orca
       |
       v
Antigravity CLI (agy) implement worker
```

## Current status

- Control and reviewer are GPT/Codex.
- Antigravity CLI (`agy`) is implementation-only worker.
- `agy 1.2.11` is installed and its model catalogue is reachable.
- Orca Desktop `1.4.210` is reachable.
- Direct `orca orchestration worker-start --agent antigravity` currently fails at Orca stage `agent_readiness` even though the AGY TUI is running.
- The working route is: create a fresh AGY terminal -> create an orchestration task -> `orchestration dispatch --inject`.
- E2E is verified PASS on 2026-09-26 after removing the standalone CLI: preflight passed, the Antigravity implement worker created the exact marker, Orca received durable `worker_done` with `outcome=succeeded`, Dely settled the Run, and the runner verified `AGY_WORKER_OK`.
- The local Dely adapter changes the Antigravity launch path and ignores Orca's informational `nextAction=inspect` when `requiresAction=false`; Claude/Codex/Cursor launch behavior remains upstream.
- Each Dely implementation dispatch uses a fresh AGY terminal. The POC records exact terminal handles in a temporary Run-scoped file and closes only those terminals during cleanup.
- `AGENTS.md` pins only `implement` to `Antigravity CLI`; review is performed directly by Codex Control.

Dely upstream currently marks Antigravity as deferred because its normal `worker-start` readiness path is not reliable. This POC restores an injected-terminal path only for AGY.

## Runaway-loop guardrails

The local/global Dely adapter now keeps a small Run-scoped guard file in the OS temp directory:

- Maximum 12 tracked control invocations before a successful `wait` settlement.
- Two identical failures from the same `dispatch` / `wait` / `wait-bg` command arm the guard; the next automatic retry exits with code 10 and `LOOP_GUARD`.
- `DELY_CONTROL_STEP_LIMIT` and `DELY_SAME_FAILURE_LIMIT` can override the defaults when a test needs a smaller budget.
- `DELY_LOOP_GUARD_OVERRIDE=1` clears the guard for one intentional command after explicit user direction.
- Codex instructions bound diagnostic reads to 4,000 characters and searches to 50 results, excluding large generated/cache trees by default.
- Dely already clips free-form worker terminal excerpts to 400 characters. Structured orchestration JSON is not truncated because doing so could corrupt `SETTLED` / action payloads.

Run the focused regression check with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-loop-guard.ps1
```

Run the quota-backup fixture against an installed helper path, for example:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-quota-backup.ps1 -HelperPath .\.dely-poc\skills\delivery\scripts\dely.js
```

## Files

- `AGENTS.md` — routes implementation to Antigravity CLI and keeps review with Codex Control.
- `patches/dely-agy.patch` — reproducible local Dely adapter.
- `scripts/setup-poc.ps1` — rebuilds the local Dely snapshot, applies the AGY adapter, and installs the local Codex plugin.
- `scripts/poc-preflight.ps1` — Dely preflight through Orca to AGY.
- `scripts/test-quota-backup.ps1` — black-box quota fallback and pin-propagation fixture.
- `scripts/poc-e2e.ps1` — deterministic Control -> Dely -> Orca -> AGY proof.
- `poc/agy-worker-spec.md` — worker task used by the E2E proof.
- `.dely-poc/` — generated local Dely snapshot; ignored by Git.

## Setup

From `D:\orca`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-poc.ps1
```

Expected final line:

```text
POC setup OK: Codex Control + Dely + Orca + Antigravity CLI worker.
```

The setup script rebuilds only `.dely-poc`; it does not modify AGY credentials or the upstream `dely@dely` installation.

## Global mode for all workspaces

Global mode is installed at:

```text
C:\Users\Home33\.codex\dely-orca-agy-global
```

The default Dely routing is stored in the existing user-level:

```text
C:\Users\Home33\.codex\AGENTS.md
```

with:

```text
implement        -> Antigravity CLI / claude-sonnet-5-5-high / default
implement_backup -> Antigravity CLI / gemini-3.8-flash-high / default
implement_backup_2 -> Codex CLI / gpt-6-luna / max
review           -> Codex Control (local review, no worker dispatch)
```

The patched Dely resolver checks the current workspace `AGENTS.md` first, then the user-level `~/.codex/AGENTS.md`. A project can override each pin independently. Ordinary implementation dispatch launches AGY with the Sonnet High model. Only an explicit Sonnet provider quota uses `dely dispatch --phase implement --fallback quota --fallback-stage 1` to launch AGY Flash High/default. Only an explicit Flash provider quota advances to `dely dispatch --phase implement --fallback quota --fallback-stage 2` after confirming the prior attempt is inactive and released when required. Stage 2 launches native Codex Luna/max, waits for `tui-idle`, and attaches the worker to that same terminal. Dely waits within a bounded deadline for fresh live working evidence or a visibly unsubmitted prompt; it sends one bare Enter only for the latter, then verifies fresh live working evidence. Authentication, timeout, unknown failures, and stage 2 do not advance the chain.

The Antigravity adapter also calls `orca repo add --path <workspace>` before launching a worker, so a normal new repository does not need a manual Orca registration step.

Install or rebuild global mode from `D:\orca`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-global.ps1
```

Expected final line:

```text
GLOBAL DELY OK
```

AGY workspace trust is intentionally not auto-confirmed. On a folder that Antigravity has never trusted, the first delivery stops with a message containing:

```text
antigravity workspace trust required in terminal term_...
```

Open that AGY terminal, review the folder, approve trust once if appropriate, then rerun the task. After trust is established, no per-workspace Dely configuration is required.

## Verify the integration

Run the verification commands from a live Orca Control terminal because orchestration needs the coordinator terminal identity.

Preflight:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:/orca/scripts/poc-preflight.ps1
```

Expected:

```text
PREFLIGHT implement antigravity PASS ...
```

Preflight checks only the Antigravity `implement` pin. Review is not a Dely worker phase.

Full proof:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:/orca/scripts/poc-e2e.ps1
```

Success criteria:

- Dely resolves `Antigravity CLI` from `AGENTS.md`.
- The local adapter starts `agy --dangerously-skip-permissions` in an Orca terminal.
- Orca creates the task and injects the worker preamble/spec into that terminal.
- AGY sends the required heartbeat and `worker_done` through Orca.
- Codex settles/acks/releases the implementation and performs review itself; `dely dispatch --phase review` is rejected.
- AGY creates only `poc/worker-output.txt`.
- The file contains exactly `AGY_WORKER_OK` plus one newline.
- The POC scripts close retained AGY worker terminals after the run.
- Final output is:

```text
POC PASS: Dely -> Orca -> Antigravity CLI produced AGY_WORKER_OK
```

## Worker model

AGY is the primary worker, pinned to `claude-sonnet-5-5-high` with default effort. Explicit Sonnet quota advances to AGY `gemini-3.8-flash-high` at stage 1; only explicit Flash quota advances to Codex `gpt-6-luna` at max effort in stage 2. Dely passes the selected AGY model to its native CLI and sets the Codex model and reasoning effort in the native terminal command; stage 2 keeps the existing idle and live-working startup checks.
