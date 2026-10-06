# Dely + Orca POC

Codex is the interactive Control and reviewer. Orca is the execution plane. Antigravity CLI (`agy`) is implementation-only worker.

## Bounded Control

- Treat `LOOP_GUARD` as a hard stop and report the current result instead of retrying autonomously.
- The Dely control loop is limited to 12 tracked invocations before settlement; the same failing command may fail twice, then the next retry must stop.
- Bound diagnostic file/log reads to 4,000 characters and searches to 50 hits. Exclude `.git`, `node_modules`, `venv`, `artifacts`, and generated POC/temp trees unless the task targets them.
- Prefer one bounded search over opening files one by one. Narrow the path and query before expanding scope.
- Use `DELY_LOOP_GUARD_OVERRIDE=1` only for one intentional retry after explicit user direction.

<!-- dely:begin -->
## Dely

Bounded or Architectural work invokes `dely:delivery`; Spike starts no
delivery run.

| Phase | Harness | Model | Effort |
| --- | --- | --- | --- |
| `implement` | Antigravity CLI | claude-sonnet-5-5-high | default |
| `implement_backup` | Antigravity CLI | gemini-3.8-flash-high | default |
| `implement_backup_2` | Codex CLI | gpt-6-luna | max |

Review is owned by Codex Control. Never dispatch a `review` phase to AGY.
<!-- dely:end -->
