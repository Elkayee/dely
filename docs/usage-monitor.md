# Local Dely usage monitor

Run from this checkout:

```powershell
node scripts/dely-monitor.js --enable-logging
```

Open http://127.0.0.1:8787. Use `--port` for another local port. The monitor
binds only to loopback and serves a metadata-only, read-only API. It has no
external assets, framework, database or scheduled automation.

`--enable-logging` explicitly creates the machine-local `~/.dely/` directory.
Dely itself still never creates this directory. Without it, logging remains
disabled. Existing prompt/source content and credentials are not copied into
assessment observations or the dashboard API.

## What the numbers mean

- **Dely adoption** is acknowledged launches divided by reviewed eligible
  policy/snapshot revisions in the recorded cohort. Easy, Medium- and Medium+
  are eligible; Hard is direct. Snapshots are keyed by policy plus the
  repo/spec/context taskKey, including across assess/review/retry events.
  Event counts remain separate. A snapshot is not necessarily an independent
  user task; parent/child lineage and probes need separate interpretation.
- **Effective model pins** count each acknowledged implementation launch.
  Primary and fallback launches are separate attempts. These are Dely's
  recorded pins, not estimated token costs or a universal model benchmark.
- **Codex conversation activity** uses observed turn metadata and stays
  separate from implementation model shares. It may contain Control, review,
  direct CLI work or otherwise unidentified CLI roles. Native/runtime copies
  and repeated turn IDs are deduplicated.
- **Orca workers** are a current inventory snapshot. Durable outcomes do not
  imply that model or classification evidence exists. Missing values remain
  unknown. Undated inventory rows are shown independently of the date window.

The installed routing CLI and this checkout's advisor record sanitized
assessment/review metadata when logging is enabled. Earlier work without
those records is not silently assigned to a difficulty or counted as a fully
observed task population. Adoption can therefore be unavailable even while
Orca and Codex history contain activity.

The dashboard reads up to ten Orca pages and states when inventory is partial.
Conversation metadata covers thirty days of locally available rollout files.
Time and workspace filters apply to the records that carry that evidence.
Probe runs are excluded by default; their filter can be enabled explicitly.

## Checks

```powershell
node --test scripts/test-dely-monitor.js scripts/test-task-routing.js scripts/test-jev-agent.js
```

Tests cover task/dispatch identity, retry/fallback counts, unknown data,
denominators, metadata redaction, partial JSONL tails and the loopback API.
Source and live UI verification are recorded in
`docs/_plans/2026-10-09-usage-monitor.md`.
