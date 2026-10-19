# Jev recovery follow-up verification record

Status: VERIFIED AND COMPLETED. Follow-up contract approved by user and coordinated under dispatch `ctx_5ec31d25f2c1`.

## 1. Disclosure-label cleanup

- **Target document**: `dely-agy-requirements-review-20261018.md`.
- **Reversible mapping**:
  - Reference labels: `S1`–`S9` mapped to `SRC-1`–`SRC-9`; `W1` mapped to `WEB-1`. All in-text citations (`[SRC-1]`, `[SRC-1, SRC-2]`, `[SRC-5–SRC-7]`, `[SRC-1]–[SRC-9]`) and target definitions at the end of the document (`- **[SRC-1] Source router:**`, etc.) were updated symmetrically.
  - Priority labels: `P0`, `P1`, `P2` mapped to `PRIO-0`, `PRIO-1`, `PRIO-2` (`**PRIO-0 — Runtime:**`, `### PRIO-0 —`, `PRIO-0/PRIO-1`, `ở PRIO-2`, etc.).
  - Other lexical hits: Normalized `V4` to `Policy v4` on line 177, and heading level 1 references `H1` to `tiêu đề h1` / `marker h1` on lines 282, 283, 285, and 428.
- **Verification**: Exactly 52 lines modified (52 insertions, 52 deletions). Before count was 70 matching tokens across 52 lines. After count is 0 matches.
- `git diff --check` passes cleanly with CRLF line endings preserved.
- Both lexical closure gate commands report zero hits outside `docs/_plans`:
  - `git grep -Ei 'pace.?id' -- . ':!docs/_plans'` -> 0 hits.
  - `git grep -E '(^|[^A-Za-z0-9])[A-Z][0-9]+[a-z]?([^A-Za-z0-9]|$)' -- . ':!docs/_plans'` -> 0 hits.

## 2. Windows jq installation & closure gates

- **Package**: Official `jq 1.8.2` Windows x64 binary (`jq-windows-amd64.exe`).
- **Source**: `https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-windows-amd64.exe`.
- **Integrity**: SHA-256 verified against official release checksum (`a6fc67fedaf9128a3309a1e2ebb8b986aeccf70122ee46d2cb4849e423f0c627`).
- **Location**: Installed to user-writable `C:\Users\Home33\.local\bin\jq.exe`. No administrator or system-wide modifications performed.
- **Discovery**: Verified in both PowerShell (`jq.exe`, version `jq-1.8.2`) and Git Bash (`/c/Users/Home33/.local/bin/jq`, version `jq-1.8.2`).
- **Closure gates executed with jq 1.8.2**:
  - `jq -e . harnesses.json plugin.json ...` -> PASS.
  - `jq -e '.harnesses | all(...)' harnesses.json` -> PASS.
  - Manifest version equality (`0.27.9`) and `has("type") == false` -> PASS.
  - README role row verification with jq against `README.md` (9 of 9 rows matched) -> PASS.

## 3. Native Codex advisory probe in Orca home

- **Execution**: Owned Orca terminal `term_80b7ee6b-a912-4473-8ab8-af05e8d9d9c9` was created in worktree `D:/orca`.
- **Environment**: Process-local `$env:CODEX_HOME` set to `C:/Users/Home33/AppData/Roaming/orca/codex-runtime-home/home`.
- **Session**: Native `codex exec` launched in this terminal, loading configuration from Orca home (`config.toml`), creating thread `01a15516-fbfe-7c30-b20d-3c2b6385c2f5` and generating rollout file `rollout-2026-10-19T23-55-32-01a15516-fbfe-7c30-b20d-3c2b6385c2f5.jsonl` under `C:\Users\Home33\AppData\Roaming\orca\codex-runtime-home\home\sessions\2026\10\19\`.
- **Wiring blocker analysis**:
  - The dely-compliance hooks did not execute because:
    1. Hook definition wiring: `C:/Users/Home33/AppData/Roaming/orca/codex-runtime-home/home/hooks.json` explicitly hardcodes `--home 'C:\Users\Home33\.codex'`.
    2. Hook trust state: `C:/Users/Home33/AppData/Roaming/orca/codex-runtime-home/home/config.toml` only has `[hooks.state]` trust entries for Orca hook commands (`0:0`) and Herdr agent state (`1:0`); compliance hooks (indices 1/2) have no trust entries and are skipped by native Codex.
- **Preservation & Cleanup**: Per contract, hook definitions, configuration, credential root, and existing sessions were strictly preserved without modifying trust or authority. The owned terminal was cleanly closed and verified exited.

## 4. Retained evidence

Private metadata-only evidence is retained under `.tmp-dely/jev-recovery-followup/`:
- `token-mapping.json`: Exact token replacement counts and before/after verification.
- `run-gates.sh`: Executable gate validation script.
- `check-readme.cjs`: README role row matcher against jq output.
- `verification-summary.json`: Machine-readable summary of all follow-up acceptance criteria.
