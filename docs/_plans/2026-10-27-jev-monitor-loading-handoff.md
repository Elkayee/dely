# Jev monitor loading repair: Control handoff

Task `task_f2a81547ad3b`, dispatch `ctx_3abf07926dca`, Run `run_fe1fb8e6d872`.

## Observed failure and scope

Control inspected the existing browser page without reloading it and reported notice `Cannot read properties of undefined (reading phases)` with 237 unique Jev records. Worker native HTTP GET `http://127.0.0.1:8787/api/usage?days=7&progressive=true` returned 200, JSON, no-store, nosniff and the existing restrictive CSP. The live Jev summary contained records, modes, reasons and rows but no `effectiveness`. The current disk renderer unconditionally read `stats.effectiveness.phases`, preventing the remainder of render and progressive refresh scheduling. This is a render exception after a successful fetch, not evidence that the source read failed.

The worker changed only `ui/monitor/monitor.js`, `scripts/test-dely-monitor.js`, and the version literals in `package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and `AGENTS.md`. Missing effectiveness now displays explicit unavailable statistics while retaining actual records, unknowns, reasons and source coverage. Present effectiveness uses the existing presentation. Fetch errors retain the existing warning and previous snapshot; subsequent success clears the warning.

## Integration baseline

The initial dirty checkout and prior assessments were preserved. Inspected existing monitor deltas: workflow reader integration and allowlisted projection, six-mode API filtering, statistics and telemetry denominators, unknown workspace/time handling, bounded source reads, deduplication, and regression coverage. These files were not rewritten: `scripts/dely-monitor-jev.js`, `scripts/dely-monitor-workflow.js`, `scripts/dely-monitor.js`, `scripts/test-dely-monitor-jev.js`, `ui/monitor/jev-view.js`, and `ui/monitor/index.html`. The new regression was appended to the existing monitor test file, preserving its earlier workflow/API test.

The hook footer fix in `docs/agent-advice.md`, `scripts/jev-workflow.js`, and `scripts/test-jev-workflow.js` was not edited. Other dirty compliance, advisor and sync changes were not edited, staged or committed. Control must retain its independent integration review of the existing baseline rather than treating the entire dirty diff as this worker's patch.

Version `0.27.29` had no matching Git tag and was absent from both registered homes' Dely cache directories; both stopped at `0.27.28`. The four release literals now agree on `0.27.29`. No skills, pins, sync tooling, authority or manifest settings changed in this task.

## Executed evidence

- Before behavior edits, the new isolated createMonitor/VM regression reached production `refresh()` -> `render()` -> `renderJev()` and failed with the exact `phases` exception and `updated = Refresh failed`.
- After the patch, that regression passed with a legacy response shape, an unknown record, HTTP failure retaining the summary, and recovery with the current response shape. Its collector and DOM remain isolated, with HTML writes forbidden.
- Native `node --test scripts/test-dely-monitor.js scripts/test-dely-monitor-jev.js`: **85 passed**, no failures. This includes actual progressive/source-error/backoff/recovery API tests, filters, unknowns, metadata boundaries and the existing workflow-effectiveness tests.
- Native `node --test scripts/test-jev-workflow.js`: **28 passed**, no failures.
- All **10** fenced repository closure gate blocks passed using Git Bash and native Node, including the updated literal version gate. An initial CRLF-sensitive gate extractor found zero blocks; this was corrected and all ten were actually executed.
- Native `node --check` passed for both monitor UI scripts and the three monitor server/reader scripts, in addition to the closure gate's delivery script check.
- The production refresh/render VM consumed the actual live HTTP payload: `324 unique records`, source state `partial`, absent effectiveness explicitly unavailable, `Updating` rather than generic failure, and another progressive refresh scheduled. Counts are a point-in-time observation, not a benchmark.

## Reproduce and release

From `D:\orca`, using native Node:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test --test-name-pattern='refresh renders legacy' scripts/test-dely-monitor.js
& 'C:\Program Files\nodejs\node.exe' --test scripts/test-dely-monitor.js scripts/test-dely-monitor-jev.js
& 'C:\Program Files\nodejs\node.exe' --test scripts/test-jev-workflow.js
```

For real-payload consumption without browser reload or touching the running process, reuse the test's production-script VM:

```javascript
// Run as native node -e, from the repository root.
const fs = require('node:fs');
const text = fs.readFileSync('scripts/test-dely-monitor.js', 'utf8');
const helper = text.slice(text.indexOf('function monitorPage('), text.indexOf('test("refresh renders legacy'));
const make = new Function('require', '__dirname', helper + ';return monitorPage;')(
  require('node:module').createRequire(process.cwd() + '/scripts/test-dely-monitor.js'), process.cwd() + '/scripts');
const page = make(url => fetch('http://127.0.0.1:8787' + url));
page.refresh().then(() => {
  const assert = require('node:assert/strict');
  assert.doesNotMatch(page.get('updated').textContent, /Refresh failed/);
  assert.doesNotMatch(page.get('attention-list').textContent, /Refresh failed/);
  console.log(page.get('updated').textContent, page.get('jev-count').textContent);
});
```

Control still owns independent review, exact local monitor service update if required, actual browser/UI verification, and native `node scripts/sync-dely.js` with **COHERENT for both registered homes**, followed by a fresh session. Worker did not restart the original monitor, reload the browser, synchronize installed software, investigate hooks, or publish externally. Installed release status remains **NOT_SYNCED (pending Control release)**. The original browser document has not acquired the patched JavaScript during worker work; VM execution is not a claim that the active document was updated.
