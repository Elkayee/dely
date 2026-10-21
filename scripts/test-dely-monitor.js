"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { instant, isProbe, summarize, jsonLines, collect, readRuntimes, createConversationReader, readWorkerDiagnostic } = require("./dely-monitor-data.js");
const { createMonitor } = require("./dely-monitor.js");
const { createJevReader } = require("./dely-monitor-jev.js");
const { taskKey, taskMetadata, runtimeFingerprint, recordTask } = require("../skills/delivery/scripts/usage.js");
const ts = "2026-10-09T01:00:00Z", repo = "D:/project";

// Run the production render call, including its source panel, without HTML writes.
function sourcePanel(data, source = fs.readFileSync(path.join(__dirname, "../ui/monitor/monitor.js"), "utf8"), target = "sources") {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.value = ""; this.open = false; this.classList = { toggle() {} }; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || "") + this.children.map((c) => c.textContent).join(" "); }
    set innerHTML(_) { throw Error("HTML writes are forbidden"); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    get firstElementChild() { return this.children[0]; }
  }
  const nodes = {};
  const get = (id) => nodes[id] ||= new Element("div");
  const helper = source.slice(source.indexOf("const element ="), source.indexOf("\n", source.indexOf("const element =")));
  const functions = source.slice(source.indexOf("function sourceRow("), source.indexOf("function renderMeasure("));
  const renderer = source.slice(source.indexOf("function render(data)"), source.indexOf("function renderProjects("));
  require("node:vm").runInNewContext(helper + functions + renderer + "\nrender(data);", {
    document: { createElement: (tag) => new Element(tag) }, $: get, data,
    renderJev() {}, observationStatus() {}, renderProjects() {}, renderMeasure() { return new Element("article"); },
    bars() {}, showRows() {}, number: (n) => n == null ? "—" : String(n), names: {},
    observationStart: null, displayedScope: "", visibleRows: 25, taskRowsShown: 20, activity: [],
  });
  return get(target);
}

function sourceFixture(workers = [], conversations = [], events = [], options = {}) {
  return { ...summarize(events, workers, conversations, { asOf: Date.parse(ts) + 1000, ...options }), collectedAt: ts,
    sources: { log: { present: true, enabled: true, malformed: 3 },
      orca: { available: true, complete: true, loaded: 459, total: 459, scope: "all" },
      codex: { available: true, files: 497, malformed: 4 } } };
}

test("operations overview keeps independent KPIs and visible worker/source alerts", () => {
  const data = sourceFixture();
  Object.assign(data.jobs, { active: 2, failed: 3, succeeded: 19 });
  data.pending = 4;
  data.metrics.agyStart = { rate: 0.25, numerator: 1, denominator: 4 };
  const text = (id) => sourcePanel(data, undefined, id).textContent;
  assert.equal(text("active-count"), "2");
  assert.equal(text("failed-count"), "3");
  assert.equal(text("pending-count"), "4");
  assert.equal(text("adoption"), "25.0%");
  assert.equal(text("adoption-detail"), "1 / 4 confirmed snapshots");
  assert.match(text("attention-list"), /3 failed workers.*operator interruptions/);
  data.sources.orca.complete = false;
  assert.match(text("attention-list"), /Coverage · Orca inventory partial/);
  assert.match(text("notice"), /Orca inventory is partial/);
  data.sources.orca.available = false;
  data.sources.log.present = false;
  data.sources.codex.available = false;
  for (const id of ["active-count", "failed-count", "pending-count"]) assert.equal(text(id), "—");
  assert.match(text("attention-list"), /Source · Orca unavailable.*Source · Dely log unavailable.*Source · Codex unavailable/);
  assert.doesNotMatch(text("attention-list"), /No observed alerts|3 failed workers/);
});

test("overview preserves unknown, loading, stale and refresh-error evidence", () => {
  const data = sourceFixture();
  data.jobs.active = null; data.jobs.failed = undefined; data.pending = null;
  const text = (id) => sourcePanel(data, undefined, id).textContent;
  for (const id of ["active-count", "failed-count", "pending-count"]) assert.equal(text(id), "—");
  data.sources.orca.state = "loading";
  assert.match(text("attention-list"), /Source · Orca reading/);
  data.stale = true;
  assert.match(text("attention-list"), /Stale snapshot/);
  assert.match(text("notice"), /snapshot is stale/);
  data.refreshError = "fixture refresh failure";
  assert.match(text("attention-list"), /Refresh failed; previous snapshot/);
  assert.match(text("notice"), /fixture refresh failure/);
  data.repos = ["D:/" + "long-workspace-name-".repeat(30)];
  assert.equal(text("active-count"), "—");
});

test("overview detectors reject plausible wrong values and hidden-alert counterexamples", () => {
  const source = fs.readFileSync(path.join(__dirname, "../ui/monitor/monitor.js"), "utf8");
  const data = sourceFixture(); data.jobs.active = 7; data.jobs.failed = 2; data.jobs.succeeded = 8;
  const mutations = [
    ["wrong worker population", source.replace('number(orca.available ? data.jobs.failed : null)', 'number(orca.available ? data.jobs.succeeded : null)'), "failed-count", (node) => assert.equal(node.textContent, "2")],
    ["present but healthy attention", source.replace('$("attention-list").replaceChildren(...attention);', '$("attention-list").replaceChildren(element("li", "All healthy"));'), "attention-list", (node) => assert.match(node.textContent, /2 failed workers/)],
    ["unknown zero-filled", source.replace('number(orca.available ? data.jobs.active : null)', 'number(orca.available ? data.jobs.active : 0)'), "active-count", (node) => assert.equal(node.textContent, "—")],
  ];
  for (const [label, wrong, target, detect] of mutations) {
    assert.notEqual(wrong, source, label);
    data.sources.orca.available = label !== "unknown zero-filled";
    detect(sourcePanel(data, source, target));
    assert.throws(() => detect(sourcePanel(data, wrong, target)), { name: "AssertionError" }, label);
  }
});

function assertSourceActivity(panel, workers, sessions, turns) {
  assert.match(panel.children[1].textContent, new RegExp(`${workers} workers`));
  assert.match(panel.children[2].textContent, new RegExp(`${sessions} sessions · ${turns} turns`));
  assert.doesNotMatch(panel.children.slice(0, 3).map((r) => r.textContent).join(" "), /459|497|unreadable lines/);
  const coverage = panel.children[3];
  assert.equal(coverage?.tagName, "details"); assert.equal(coverage.open, false);
  assert.ok(!coverage.hidden);
  assert.equal(coverage.children[0].tagName, "summary");
  assert.equal(coverage.children[0].textContent, "Retained source coverage (not reset statistics)");
  assert.match(coverage.textContent, /459 \/ 459 total source records/);
  assert.match(coverage.textContent, /497 total local rollout files/);
  assert.match(coverage.textContent, /3 unreadable lines/); assert.match(coverage.textContent, /4 unreadable lines/);
}

test("source health projects the selected reset window and retains closed full-source coverage", () => {
  const empty = sourcePanel(sourceFixture());
  assertSourceActivity(empty, 0, 0, 0);
  assert.match(empty.children[1].textContent, /Complete page set/);
  assert.match(empty.children[2].textContent, /Available/);
  const workers = [{ id: "one", ts, repo }];
  const conversations = [{ session: "one", ts, repo }, { session: "one", ts, repo }];
  assertSourceActivity(sourcePanel(sourceFixture(workers, conversations)), 1, 1, 2);
  for (const options of [{ repo: "D:/other" }, { since: Date.parse(ts) + 1, explicitReset: true }]) {
    assertSourceActivity(sourcePanel(sourceFixture(workers, conversations, [], options)), 0, 0, 0);
  }
  const probe = "D:/.tmp-dely/probe";
  const probeData = (probes) => sourceFixture([{ ...workers[0], repo: probe }], conversations.map((c) => ({ ...c, repo: probe })), [], { probes });
  assertSourceActivity(sourcePanel(probeData(false)), 0, 0, 0);
  assertSourceActivity(sourcePanel(probeData(true)), 1, 1, 2);
  const html = fs.readFileSync(path.join(__dirname, "../ui/monitor/index.html"), "utf8");
  assert.doesNotMatch(html, /Orca inventory rows without a timestamp remain a current snapshot/);
  assert.match(html, /Activity counts follow the selected date, workspace, probe and reset window/);
});

test("source health preserves missing, partial, loading, refreshing and error evidence", () => {
  for (const state of ["unavailable", "loading", "error"]) {
    const data = sourceFixture();
    for (const name of ["orca", "codex"]) Object.assign(data.sources[name], { available: false, state });
    const rows = sourcePanel(data).children;
    for (const row of rows.slice(1, 3)) {
      assert.match(row.textContent, /N\/A/); assert.doesNotMatch(row.textContent, /0 workers|0 sessions/);
      assert.match(row.textContent, state === "loading" ? /Reading…/ : state === "error" ? /Error/ : /Unavailable/);
    }
  }
  const partial = sourceFixture(); partial.sources.orca.complete = false; partial.sources.codex.state = "partial";
  for (const row of sourcePanel(partial).children.slice(1, 3)) assert.match(row.textContent, /Partial/);
  const refreshing = sourceFixture();
  refreshing.sources.orca.state = refreshing.sources.codex.state = "refreshing";
  for (const row of sourcePanel(refreshing).children.slice(1, 3)) assert.match(row.textContent, /retained\/stale values.*Updating…/);
  const stale = sourceFixture(); stale.refreshError = "Source refresh failed";
  for (const row of sourcePanel(stale).children.slice(0, 3)) assert.match(row.textContent, /retained\/stale values/);
  const unknown = sourceFixture(); unknown.jobs.count = null; unknown.conversations.sessions = undefined; unknown.conversations.turns = null;
  const unknownRows = sourcePanel(unknown).children;
  assert.match(unknownRows[1].textContent, /N\/A workers/); assert.match(unknownRows[2].textContent, /N\/A sessions · N\/A turns/);
  const logged = sourceFixture(); logged.models = [{ model: "test", launches: 2 }];
  assert.match(sourcePanel(logged).children[0].textContent, /2 logged launches/);
  logged.sources.log.present = false;
  assert.match(sourcePanel(logged).children[0].textContent, /N\/A.*Waiting for events/);
  logged.sources.log.enabled = false;
  assert.match(sourcePanel(logged).children[0].textContent, /Not enabled/);
  logged.sources.orca.scope = "<img src=x onerror=alert(1)>";
  assert.match(sourcePanel(logged).children[3].textContent, /<img src=x onerror=alert\(1\)>/);
});

test("source DOM assertions reject wrong inventory counters, hardcoded zero and dropped coverage", () => {
  const source = fs.readFileSync(path.join(__dirname, "../ui/monitor/monitor.js"), "utf8");
  const fresh = sourceFixture([{ id: "one", ts, repo }], [{ session: "one", ts, repo }, { session: "one", ts, repo }]);
  const mutations = [
    ["raw Orca inventory", source.replace("count(data.jobs?.count)", "count(orca.loaded)")],
    ["rollout files as sessions", source.replace("count(data.conversations?.sessions)", "count(codex.files)")],
    ["hardcoded zero", source.replace("count(data.jobs?.count)", "count(0)")],
    ["dropped coverage", source.replace("    coverage);", "    element(\"div\"));")],
    ["hidden coverage", source.replace('const coverage = element("details");', 'const coverage = element("details"); coverage.hidden = true;')],
  ];
  for (const [name, wrong] of mutations) {
    assert.notEqual(wrong, source, name);
    assert.throws(() => assertSourceActivity(sourcePanel(fresh, wrong), 1, 1, 2), { name: "AssertionError" }, name);
  }
});
test("observation times accept milliseconds and legacy SQL without guessing seconds or missing time", () => {
  assert.equal(instant(Date.parse(ts)), Date.parse(ts));
  assert.equal(instant("2026-10-09 01:00:00"), Date.parse(ts));
  assert.equal(instant(1234), 1234); assert.equal(instant(0), 0);
  for (const value of [null, undefined, "invalid", Infinity, NaN, 9e20, {}, false]) assert.equal(instant(value), null);
});
test("explicit reset bounds every population while rolling retains undated coverage", async () => {
  const old = "2026-10-19T23:00:00Z", mark = "2026-10-19T23:56:56.122Z", fresh = "2026-10-20T00:00:00Z";
  const workers = [
    { id: "old-iso", repo: "D:/old-only", ts: old },
    { id: "old-ms", repo: "D:/old-only", ts: Date.parse(old) },
    { id: "fresh", repo, ts: Date.parse(fresh) },
    { id: "null", repo: "D:/undated", ts: null },
    { id: "invalid", repo: null, ts: "invalid" },
    { id: "probe", repo: "D:/.tmp-dely/probe", ts: fresh },
  ];
  const events = workers.map((w) => ({ ...w, event: "task_assessment", taskKey: w.id }));
  const conversations = workers.map((w) => ({ ...w, session: w.id }));
  const jev = workers.map((w) => ({ ...w, mode: "context", category: "unknown" }));
  const options = { since: Date.parse(mark), asOf: Date.parse(fresh), explicitReset: true };
  const checkReset = (result) => {
    assert.equal(result.jobs.count, 1); assert.equal(result.tasks.recorded, 1);
    assert.equal(result.conversations.turns, 1); assert.deepEqual(result.activity.map((r) => r.id), ["fresh"]);
    assert.deepEqual(result.projects.map((p) => p.repo), [repo]); assert.equal(result.unassigned.records, 0);
    assert.deepEqual(result.coverage.excludedUnknownTime, { events: 2, workers: 2, conversations: 2 });
    assert.equal(result.metrics.agyStart.rate, null);
    assert.ok(result.repos.includes("D:/old-only"));
  };
  checkReset(summarize(events, workers, conversations, options));
  assert.equal(summarize(events, workers, conversations, { ...options, explicitReset: false }).jobs.count, 3);
  assert.equal(summarize(events, workers, conversations, { ...options, probes: true }).jobs.count, 2);
  assert.equal(summarize(events, workers, conversations, { ...options, repo: "D:/old-only" }).jobs.count, 0);
  assert.equal(summarize(events, workers, conversations, { asOf: Date.parse(fresh) }).jobs.count, 5);
  let clock = Date.parse(old), calls = 0;
  const sources = { orca: { available: true, loaded: workers.length, complete: true }, jev: { available: true, loaded: jev.length } };
  const server = createMonitor({ now: () => clock, collect: async () => {
    calls++; return { events, workers, conversations, jev, sources, collectedAt: new Date(clock).toISOString() };
  } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/usage?days=7`;
  try {
    await fetch(url); clock = Date.parse(fresh);
    const reset = await (await fetch(url + "&since=" + mark)).json();
    checkReset(reset); assert.equal(calls, 2); assert.equal(reset.jev.recorded, 1);
    assert.equal(reset.jev.excludedUnknownTime, 2); assert.equal(reset.sources.orca.loaded, 6);
    const selected = await (await fetch(url + "&since=" + mark + "&repo=" + encodeURIComponent(repo) + "&jevMode=skill")).json();
    assert.equal(selected.jobs.count, 1); assert.equal(selected.jev.recorded, 0);
    const probes = await (await fetch(url + "&since=" + mark + "&probes=true")).json();
    assert.equal(probes.jobs.count, 2); assert.equal(probes.jev.recorded, 2);
    const resumed = await (await fetch(url)).json();
    assert.equal(resumed.jobs.count, 5); assert.equal(resumed.jev.recorded, 5); assert.equal(calls, 2);
    assert.equal((await fetch(url.replace("/api/usage?days=7", "/monitor.js"))).status, 200);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
const specHash = "a".repeat(64), contextHash = "b".repeat(64), basis = "c".repeat(64);
const key = taskKey(repo, specHash, contextHash);
test("worker diagnostics preserve raw outcomes, structured cause and missing evidence", async () => {
  const id = "ctx_123456abcdef";
  const read = (dispatch, projection = {}) => readWorkerDiagnostic(id, async () => ({ result: {
    dispatch: { id, status: "failed", ...dispatch }, projection,
  } }));
  const closed = await read({ terminationReason: "operator_close", depth: 1 },
    { outcome: "failed", liveness: { verdict: "exited", source: "terminal" } });
  assert.equal(closed.status, "failed"); assert.equal(closed.outcome, "failed");
  assert.equal(closed.failure.kind, "operator_close");
  assert.equal(closed.failure.source, "dispatch.terminationReason");
  assert.equal(closed.depth, 1); assert.equal(closed.liveness.verdict, "exited");
  for (const lastFailure of [null, "malformed", { body: "operator closed PRIVATE_SECRET" }]) {
    const unknown = await read({ lastFailure });
    assert.equal(unknown.failure.kind, "unknown"); assert.equal(unknown.terminationReason, null);
    assert.equal(unknown.depth, null); assert.equal(unknown.liveness.verdict, "unknown");
    assert.doesNotMatch(JSON.stringify(unknown), /PRIVATE_SECRET|operator closed/);
  }
  const report = (body, extra = {}) => JSON.stringify({ provenance: "worker_report", outcome: "failed", body, ...extra });
  const nested = await read({ depth: 1, lastFailure: report("actual Dely preflight failed because nested dispatch depth 2 exceeds max 1. PRIVATE_BODY") }, { outcome: "failed" });
  assert.equal(nested.depth, 1); assert.equal(nested.status, "failed"); assert.equal(nested.outcome, "failed");
  assert.deepEqual(nested.failure, { kind: "reported_depth_limit", source: "dispatch.lastFailure.worker_report", reportedDepth: 2, maxDepth: 1 });
  assert.equal(nested.terminationReason, null); assert.doesNotMatch(JSON.stringify(nested), /PRIVATE_/);
  for (const body of ["operator interrupted PRIVATE_BODY", "nested dispatch depth x exceeds max 1",
    "nested dispatch depth 1 exceeds max 2", "nested dispatch depth 2 exceeds max 1; nested dispatch depth 3 exceeds max 1"]) {
    const ordinary = await read({ lastFailure: report(body) });
    assert.equal(ordinary.failure.kind, "worker_report"); assert.equal(ordinary.terminationReason, null);
    assert.equal(ordinary.failure.reportedDepth, null); assert.equal(ordinary.depth, null);
  }
  for (const lastFailure of [report("nested dispatch depth 2 exceeds max 1", { provenance: "exception" }),
    report(null), report("x".repeat(16385)), "null"]) assert.equal((await read({ lastFailure })).failure.kind, "unknown");
  const precedence = await read({ terminationReason: "operator_close", depth: 0, lastFailure: report("nested dispatch depth 2 exceeds max 1") });
  assert.equal(precedence.failure.kind, "operator_close"); assert.equal(precedence.depth, 0);
  let invalidCalls = 0;
  for (const bad of ["ctx_123456abcdef&whoami", "ctx_123456abcdef\n", "ctx_123456abcdef\r\n", "ctx_123456abcdeF"])
    await assert.rejects(readWorkerDiagnostic(bad, async () => { invalidCalls++; }));
  assert.equal(invalidCalls, 0);
  await assert.rejects(readWorkerDiagnostic(id, async () => ({ result: { dispatch: { id: "ctx_ffffffffffff" } } })));
});

test("worker diagnostics preserve native unverifiable verdict and execution_host evidence source", async () => {
  const id = "ctx_123456abcdef";
  const read = (dispatch, projection = {}) => readWorkerDiagnostic(id, async () => ({ result: {
    dispatch: { id, status: "failed", ...dispatch }, projection,
  } }));

  const unverifiable = await read({ depth: 0 }, {
    outcome: "failed",
    liveness: { verdict: "unverifiable", source: "execution_host" },
  });
  assert.equal(unverifiable.status, "failed");
  assert.equal(unverifiable.outcome, "failed");
  assert.equal(unverifiable.depth, 0);
  assert.equal(unverifiable.failure.kind, "unknown");
  assert.deepEqual(unverifiable.liveness, {
    verdict: "unverifiable",
    source: "projection.liveness",
    evidenceSource: "execution_host",
  });

  for (const verdict of ["live", "unverifiable", "exited", "unknown"]) {
    const res = await read({}, { liveness: { verdict } });
    assert.equal(res.liveness.verdict, verdict);
  }
  for (const source of ["agent_status", "terminal", "terminal_status", "process", "durable", "execution_host"]) {
    const res = await read({}, { liveness: { verdict: "live", source } });
    assert.equal(res.liveness.evidenceSource, source);
  }

  for (const badVerdict of [null, undefined, "secret", "PRIVATE_VERDICT", 42, {}]) {
    const res = await read({}, { liveness: { verdict: badVerdict } });
    assert.equal(res.liveness.verdict, "unknown");
    assert.doesNotMatch(JSON.stringify(res), /PRIVATE_VERDICT/);
  }
  for (const badSource of [null, undefined, "secret", "PRIVATE_SOURCE", "unknown", 42, {}]) {
    const res = await read({}, { liveness: { verdict: "live", source: badSource } });
    assert.equal(res.liveness.evidenceSource, null);
    assert.doesNotMatch(JSON.stringify(res), /PRIVATE_SOURCE/);
  }

  const structured = await read(
    { terminationReason: "operator_close", depth: 2 },
    { outcome: "succeeded", liveness: { verdict: "unverifiable", source: "execution_host" } }
  );
  assert.equal(structured.status, "failed");
  assert.equal(structured.outcome, "succeeded");
  assert.equal(structured.depth, 2);
  assert.equal(structured.failure.kind, "operator_close");
  assert.equal(structured.failure.source, "dispatch.terminationReason");
  assert.deepEqual(structured.liveness, {
    verdict: "unverifiable",
    source: "projection.liveness",
    evidenceSource: "execution_host",
  });
});

test("diagnostic API only reads observed ids on demand, deduplicates and strips private fields", async () => {
  const id = "ctx_123456abcdef", failedId = "ctx_000000000001";
  let calls = 0, release, started;
  const held = new Promise((resolve) => { release = resolve; });
  const reading = new Promise((resolve) => { started = resolve; });
  const data = { events: [], workers: [id, failedId].map((id) => ({ id, ts, repo, status: "failed" })),
    conversations: [], sources: {}, collectedAt: ts };
  const server = createMonitor({ now: () => Date.parse(ts), collect: async () => data, orca: async (args) => {
    calls++; started(); assert.deepEqual(args.slice(0, 3), ["orchestration", "worker-show", "--dispatch"]);
    if (args[3] === failedId) throw Error("PRIVATE_STACK");
    await held;
    return { result: { dispatch: { id, status: "failed", depth: 1, terminationReason: "operator_close",
      prompt: "PRIVATE_PROMPT", lastFailure: { body: "PRIVATE_BODY", path: "PRIVATE_PATH" } },
      projection: { outcome: "failed", liveness: { verdict: "exited", source: "PRIVATE_SECRET" } },
      terminal: { argv: "PRIVATE_ARGV" } } };
  } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/workers/${id}`)).status, 404);
    const before = await (await fetch(`${base}/api/usage?days=30`)).json();
    for (const invalid of ["ctx_ffffffffffff", "ctx_123456abcdef%26whoami", "bad"]) {
      assert.ok([400, 404].includes((await fetch(`${base}/api/workers/${invalid}`)).status));
    }
    assert.equal(calls, 0);
    const a = fetch(`${base}/api/workers/${id}`), b = fetch(`${base}/api/workers/${id}`);
    await reading; assert.equal(calls, 1);
    release();
    for (const response of await Promise.all([a, b])) {
      assert.equal(response.status, 200);
      const detail = await response.json(); assert.equal(detail.failure.kind, "operator_close");
      assert.doesNotMatch(JSON.stringify(detail), /PRIVATE_/);
    }
    await fetch(`${base}/api/workers/${id}`); assert.equal(calls, 1);
    const unavailable = await fetch(`${base}/api/workers/${failedId}`);
    assert.equal(unavailable.status, 503); assert.doesNotMatch(await unavailable.text(), /PRIVATE_/);
    assert.equal((await fetch(`${base}/api/workers/${failedId}`)).status, 503);
    assert.deepEqual(await (await fetch(`${base}/api/usage?days=30`)).json(), before);
    assert.equal(calls, 2);
  } finally { release(); server.close(); await once(server, "close"); }
});

test("diagnostic cache expires and evicts without exceeding its bounded entry set", async () => {
  let clock = Date.parse(ts), calls = 0;
  const ids = Array.from({ length: 34 }, (_, i) => `ctx_${i.toString(16).padStart(12, "0")}`);
  const server = createMonitor({ now: () => clock, collect: async () => ({ events: [],
    workers: ids.map((id) => ({ id, ts, repo, status: "failed" })), conversations: [], sources: {}, collectedAt: ts }),
  orca: async (args) => { calls++; return { result: { dispatch: { id: args[3], status: "failed" } } }; } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/api/usage`);
    for (const id of ids.slice(0, 33)) assert.equal((await fetch(`${base}/api/workers/${id}`)).status, 200);
    assert.equal(calls, 33);
    await fetch(`${base}/api/workers/${ids[1]}`); assert.equal(calls, 33);
    await fetch(`${base}/api/workers/${ids[0]}`); assert.equal(calls, 34);
    clock += 30000;
    await fetch(`${base}/api/workers/${ids[0]}`); assert.equal(calls, 35);
  } finally { server.close(); await once(server, "close"); }
});
test("Jev loading stays progressive, API projections respect every filter and source failures stay visible", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-jev-api-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const taskDir = path.join(dir, "dely-compliance/tasks/one"); fs.mkdirSync(taskDir, { recursive: true });
  const artifact = { policy: "jev-task-routing-v4", assessed_at: ts, status: "NOT_EVALUATED", jev: null,
    reason: "Jev HTTP 503", task: { repo, spec: "PRIVATE_SPEC", context: { secret: "PRIVATE_CONTEXT" } },
    request_diagnostics: { stage: "http", code: "HTTP_ERROR", duration_ms: 14.25, http_status: 503,
      requested_model: "jev-1.13.0", provider_model: null, body: "PRIVATE_PROVIDER_BODY", message: "PRIVATE_ERROR" } };
  fs.writeFileSync(path.join(taskDir, "assessment.json"), JSON.stringify(artifact));
  const probeDir = path.join(dir, "dely-compliance/tasks/probe"); fs.mkdirSync(probeDir);
  fs.writeFileSync(path.join(probeDir, "assessment.json"), JSON.stringify({ ...artifact, task: { ...artifact.task, repo: "D:/.tmp-dely/probe" } }));
  const reader = createJevReader({ homes: [dir] });
  let finish;
  const held = new Promise((resolve) => { finish = resolve; });
  const server = createMonitor({ now: () => Date.parse(ts) + 3600000, collect: (options) => collect({ ...options,
    journal: path.join(dir, "absent.jsonl"), readJev: () => held,
    readWorkers: async () => ({ rows: [], complete: true }), readConversations: async () => ({ rows: [], available: true }) }) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/usage?days=30`;
  try {
    const partial = await (await fetch(url + "&progressive=true")).json();
    assert.equal(partial.sources.jev.state, "loading"); assert.equal(partial.refreshing, true);
    assert.equal(partial.jev.recorded, 0);
    finish(await reader());
    const data = await (await fetch(url)).json();
    assert.equal(data.jev.errors, 1); assert.equal(data.jev.evaluations, 1);
    assert.equal(data.sources.jev.state, "ready"); assert.equal(data.sources.jev.coverage[0].modes.task, 2);
    assert.ok(data.repos.includes(repo)); assert.doesNotMatch(JSON.stringify(data.jev), /PRIVATE_/);
    assert.equal(data.jev.rows[0].task, undefined); assert.equal(data.jev.rows[0].context, undefined);
    assert.equal(data.jev.rows[0].request_diagnostics.stage, "http");
    assert.equal(data.jev.rows[0].request_diagnostics.http_status, 503);
    assert.equal((await (await fetch(url + "&probes=true")).json()).jev.recorded, 2);
    assert.equal((await (await fetch(url + "&repo=D:/other")).json()).jev.recorded, 0);
    assert.equal((await (await fetch(url + "&since=2026-10-10T00:00:00Z")).json()).jev.recorded, 0);
    assert.equal((await (await fetch(url.replace("days=30", "days=1"))).json()).jev.recorded, 0);
    const tasks = await (await fetch(url + "&jevMode=task")).json();
    assert.equal(tasks.jev.recorded, 1); assert.equal(tasks.jev.reasons[0].reason, "JEV_HTTP_503");
    assert.equal(tasks.jev.reasons[0].count, 1);
    const skills = await (await fetch(url + "&jevMode=skill")).json();
    assert.equal(skills.jev.recorded, 0); assert.deepEqual(skills.jev.reasons, []);
    assert.deepEqual(skills.metrics, tasks.metrics, "advisor mode does not filter other dashboard populations");
    assert.equal((await fetch(url + "&jevMode=invalid")).status, 400);
    assert.equal((await fetch(url.replace(/\/api\/usage.*/, "/jev-view.js"))).status, 200);
  } finally { finish({ rows: [], coverage: [], cache: {} }); await new Promise((resolve) => server.close(resolve)); }
  const failed = await collect({ journal: path.join(dir, "absent.jsonl"), readJev: async () => { throw Error("PRIVATE_ERROR"); },
    readWorkers: async () => ({ rows: [] }), readConversations: async () => ({ rows: [] }) });
  assert.equal(failed.sources.jev.state, "error"); assert.equal(failed.sources.jev.available, false);
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_ERROR/);
});
const approval = { event: "task_assessment", taskKey: key, ts, repo,
  policy: "jev-task-routing-v4", reviewer: "codex-control", decision_source: "jev-reviewed", assessment_basis_sha256: basis,
  status: "APPROVED", difficulty: "medium_minus", workflow: "dely",
  primary: { harness: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" } };
const route = { event: "task_route", run: "run-one", ts, repo, policy: approval.policy, difficulty: "medium_minus",
  specSha256: specHash, contextSha256: contextHash, assessmentBasisSha256: basis, reviewSource: approval.decision_source };
const launch = { event: "dispatch", run: "run-one", ts, repo, dispatchId: "first", phase: "implement",
  promptSha256: specHash, contextSha256: contextHash, assessmentBasisSha256: basis,
  launch: { requested: { model: "gemini-3.8-flash-medium" }, effective: { agent: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" } } };

const reviewed = { ...approval, reviewed_at: ts, decision_sha256: "d".repeat(64), correction_candidate: "coordination" };
const later = "2026-10-10T01:00:00Z", last = "2026-10-11T01:00:00Z";
const control = { event: "task_control_result", ts: later, reviewed_at: later, reviewer: "codex-control",
  verdict: "accepted", run: launch.run, dispatchId: launch.dispatchId, policy: approval.policy,
  taskKey: key, assessment_basis_sha256: basis, evidence_sha256: "e".repeat(64) };
const metrics = (events, options = {}) => summarize(events, [], [], options).metrics;

test("diagnostic reads preserve populated Dely, worker, Codex and Jev denominators", async () => {
  const id = "ctx_123456abcdef";
  const data = { events: [reviewed, route, { ...launch, dispatchId: id }],
    workers: ["failed", "running", "succeeded"].map((status, i) => ({ id: i ? `ctx_${String(i).padStart(12, "0")}` : id, status, repo, ts })),
    conversations: [{ session: "one", ts, repo, model: "gpt-6.1-sol" }], jev: [], sources: {}, collectedAt: last };
  const server = createMonitor({ collect: async () => data, now: () => Date.parse(last),
    orca: async () => ({ result: { dispatch: { id, status: "failed", terminationReason: "operator_close" }, projection: { outcome: "failed" } } }) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const before = await (await fetch(`${base}/api/usage`)).json();
    assert.equal(before.jobs.count, 3); assert.equal(before.jobs.failed, 1);
    assert.equal(before.jobs.active, 1); assert.equal(before.jobs.succeeded, 1);
    assert.equal(before.metrics.agyStart.denominator, 1); assert.equal(before.conversations.sessions, 1);
    assert.equal((await fetch(`${base}/api/workers/${id}`)).status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/usage`)).json(), before);
  } finally { server.close(); await once(server, "close"); }
});

test("conversation projections reuse unchanged files and invalidate changed, replaced, truncated and deleted sources", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-conversation-cache-"));
  const roots = [path.join(dir, "one"), path.join(dir, "two")];
  const folders = roots.map((root) => path.join(root, "sessions/2026/10/11"));
  folders.forEach((folder) => fs.mkdirSync(folder, { recursive: true }));
  const meta = (id, source = "cli") => ({ type: "session_meta", payload: { id, source } });
  const turn = (id, timestamp, model) => ({ type: "turn_context", timestamp, payload: { turn_id: id, model, cwd: repo } });
  const write = (file, rows) => fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const small = path.join(folders[0], "same.jsonl"), large = path.join(folders[1], "same.jsonl");
  write(small, [meta("shared"), turn("only-small", later, "smaller-copy")]);
  write(large, [meta("shared"), turn("first", later, "m1"), turn("second", last, "m2"),
    turn("second", last, "m2-latest"), { type: "response_item", payload: "never-cache-this-".repeat(100) }]);
  write(path.join(folders[0], "subagent.jsonl"), [meta("child", { subagent: {} }), turn("child", last, "excluded")]);
  let reads = 0;
  const read = createConversationReader({ roots, now: () => Date.parse(last),
    readLines: (file, visit) => { reads++; return jsonLines(file, visit); } });
  try {
    const initial = await read(Date.parse(ts));
    assert.equal(initial.rows.length, 2); assert.equal(reads, 2);
    assert.equal(initial.rows.find((r) => r.ts === last).model, "m2-latest");
    assert.equal(JSON.stringify(initial).includes("never-cache-this"), false);
    initial.rows[0].model = "caller-mutation";
    const narrower = await read(Date.parse(last));
    assert.equal(narrower.rows.length, 1); assert.equal(reads, 2); assert.equal(narrower.cache.hits, 2);
    const wider = await read(Date.parse(ts));
    assert.equal(wider.rows.length, 2); assert.equal(reads, 2);
    assert.equal(wider.rows.some((r) => r.model === "caller-mutation"), false);

    fs.appendFileSync(large, '{"type":"turn_');
    const partial = await read(Date.parse(ts));
    assert.equal(partial.rows.length, 2); assert.equal(partial.malformed, 1); assert.equal(partial.cache.parsed, 1);
    fs.appendFileSync(large, 'context","timestamp":"2026-10-11T00:10:00Z","payload":{"turn_id":"third","model":"m3","cwd":"D:/project"}}\n');
    const appended = await read(Date.parse(ts));
    assert.equal(appended.rows.length, 3); assert.equal(appended.malformed, 0); assert.equal(appended.cache.parsed, 1);

    const before = fs.statSync(large), replacement = path.join(dir, "replacement.jsonl");
    fs.writeFileSync(replacement, fs.readFileSync(large, "utf8").replace('"model":"m3"', '"model":"m4"'));
    fs.utimesSync(replacement, before.atime, before.mtime);
    fs.renameSync(replacement, large);
    const replaced = await read(Date.parse(ts));
    assert.equal(replaced.rows.some((r) => r.model === "m4"), true); assert.equal(replaced.cache.parsed, 1);
    fs.writeFileSync(large, fs.readFileSync(large, "utf8").replace('"model":"m4"', '"model":"m5"'));
    fs.utimesSync(large, before.atime, new Date(before.mtimeMs + 1000));
    assert.equal((await read(Date.parse(ts))).rows.some((r) => r.model === "m5"), true);

    fs.writeFileSync(large, "{}\n");
    assert.equal((await read(Date.parse(ts))).rows[0].model, "smaller-copy");
    fs.unlinkSync(small); fs.unlinkSync(large);
    assert.equal((await read(Date.parse(ts))).rows.length, 0);
    write(path.join(folders[0], "new.jsonl"), [meta("new"), turn("new", last, "new-file")]);
    const added = await read(Date.parse(ts));
    assert.equal(added.rows.length, 1); assert.equal(added.rows[0].model, "new-file");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("progressive API serves confirmed Dely data while a slow optional source is unresolved", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-progressive-")), journal = path.join(dir, "journal.jsonl");
  fs.writeFileSync(journal, [reviewed, route, launch].map((r) => JSON.stringify(r)).join("\n") + "\n");
  let release, calls = 0, completed = false;
  const held = new Promise((resolve) => { release = resolve; });
  const server = createMonitor({ collect: (options) => {
    calls++;
    return collect({ ...options, journal, readWorkers: async () => ({ rows: [], complete: true }),
      readConversations: () => held }).then((result) => { completed = true; return result; });
  } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port + "/api/usage?days=30";
  const completeRequest = fetch(url);
  try {
    const partial = await (await fetch(url + "&progressive=true", { signal: AbortSignal.timeout(5000) })).json();
    assert.equal(completed, false); assert.equal(calls, 1);
    assert.equal(partial.metrics.agyStart.denominator, 1);
    assert.equal(partial.sources.codex.available, false); assert.equal(partial.sources.codex.state, "loading");
    assert.equal(partial.refreshing, true);
    const selected = await (await fetch(url + "&progressive=true&repo=" + encodeURIComponent(repo))).json();
    assert.equal(selected.taskDetails.every((t) => t.repo === repo), true); assert.equal(calls, 1);
    const mark = new Date().toISOString();
    const reset = await (await fetch(url + "&progressive=true&since=" + encodeURIComponent(mark))).json();
    assert.equal(reset.metrics.agyStart.denominator, 0); assert.equal(reset.metrics.agyStart.rate, null);
    assert.equal(reset.window.start, mark); assert.equal(calls, 1);
    release({ available: true, files: 1, malformed: 0, rows: [{ session: "one", repo, ts, model: "observed" }] });
    const final = await (await completeRequest).json();
    assert.equal(final.conversations.sessions, 1); assert.equal(final.sources.codex.state, "ready");
    assert.equal(final.refreshing, false); assert.equal(final.metrics.agyStart.denominator, 1);
    assert.equal(final.collectedAt, partial.collectedAt);
  } finally {
    release({ rows: [], available: false }); await completeRequest;
    await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("expired progressive cache is single-flight, marks retained sources stale and backs off collection errors", async () => {
  let clock = Date.now(), calls = 0, finish, reject;
  const held = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
  const data = { events: [reviewed, route, launch], workers: [],
    conversations: [{ session: "old", repo, ts, model: "old" }], collectedAt: new Date(clock).toISOString(),
    sources: { log: { present: true }, orca: { available: true, state: "ready" }, codex: { available: true, state: "ready", asOf: ts } } };
  const server = createMonitor({ now: () => clock, collect: async ({ onUpdate }) => {
    calls++;
    if (calls !== 2) return data;
    onUpdate({ ...data, conversations: [], sources: { ...data.sources, codex: { available: false, state: "loading" } } });
    return held;
  } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port + "/api/usage?days=30";
  try {
    await fetch(url); assert.equal(calls, 1);
    clock += 31000;
    const refreshing = await (await fetch(url + "&progressive=true")).json();
    assert.equal(refreshing.refreshing, true); assert.equal(refreshing.stale, true);
    const retained = await (await fetch(url + "&progressive=true")).json();
    assert.equal(retained.sources.codex.state, "refreshing"); assert.equal(retained.conversations.sessions, 1);
    assert.equal(retained.sources.codex.asOf, ts); assert.equal(calls, 2);
    reject(Error("private source failed"));
    // The complete endpoint observes the same rejection, rather than starting another collector.
    assert.equal((await fetch(url)).status, 503);
    const failed = await (await fetch(url + "&progressive=true")).json();
    assert.equal(failed.refreshing, false); assert.equal(failed.stale, true);
    assert.equal(failed.sources.codex.state, "ready");
    assert.ok(failed.refreshError); assert.equal(failed.collectedAt, data.collectedAt); assert.equal(calls, 2);
    clock += 31000;
    const recovered = await (await fetch(url)).json();
    assert.equal(calls, 3); assert.equal(recovered.refreshError, null);
  } finally { finish(data); await new Promise((resolve) => server.close(resolve)); }
});

test("optional collection errors settle as unavailable instead of remaining pending", async () => {
  const updates = [];
  const result = await collect({ journal: path.join(os.tmpdir(), "missing-observer-journal"),
    onUpdate: (data) => updates.push(data), readWorkers: async () => { throw Error("offline"); },
    readConversations: async () => ({ available: false, rows: [] }) });
  assert.equal(updates[0].sources.orca.state, "loading");
  assert.equal(result.sources.orca.state, "error"); assert.equal(result.sources.orca.available, false);
  assert.equal(result.sources.codex.state, "unavailable"); assert.equal(result.sources.codex.available, false);
});

test("project overview keeps same-name paths and independent populations under selection and filters", () => {
  const second = "E:/else/project", worker = "D:/worker-only", chat = "D:/chat-only";
  const events = [approval, route, launch, { ...approval, repo: second, taskKey: "pending", task_title: "Pending task" },
    { ...approval, repo: null, taskKey: "unknown", difficulty: null },
    { ...approval, repo: "D:/project/.tmp-dely/probe", taskKey: "probe" }];
  const workers = [{ id: "worker", repo: worker, ts, status: "ready" }, { id: "unassigned", ts, status: "failed" }];
  const conversations = [{ repo: chat, ts, session: "chat", model: null }];
  const result = summarize(events, workers, conversations, { repo: "D:\\project", asOf: Date.parse(last) });
  assert.deepEqual(result.projects.map((p) => p.repo), [chat, repo, worker, second]);
  const a = result.projects.find((p) => p.repo === repo), b = result.projects.find((p) => p.repo === second);
  assert.equal(a.name, b.name);
  assert.equal(a.snapshots, 1); assert.equal(b.snapshots, 0);
  assert.equal(a.agyStart.numerator, 1); assert.equal(b.agyStart.rate, null);
  assert.equal(b.pending, 1); assert.equal(b.tasks.recorded, 1);
  assert.equal(result.taskDetails.length, 1); assert.equal(result.unassigned.records, 2);
  assert.deepEqual(result.projects.find((p) => p.repo === worker).jobs.states, [{ status: "ready", count: 1 }]);
  assert.equal(result.projects.find((p) => p.repo === chat).conversations.sessions, 1);
  assert.equal(result.projects.find((p) => p.repo === chat).tasks.recorded, 0);
  assert.equal(summarize(events, workers, conversations, { since: Date.parse(later) }).projects.length, 0);
  assert.equal(summarize(events, workers, conversations, { probes: true }).projects.length, 5);
  assert.equal(summarize([], [], []).projects.length, 0);
});

test("project details freeze the original snapshot across current reviews, retries, fallback and reset", () => {
  const first = { ...approval, task_title: "Frozen task", domain: "Monitor" };
  const current = { ...first, ts: later, difficulty: "medium_plus", task_title: "Changed review title", primary: { harness: "codex", model: "gpt-6.1-sol", effort: "medium" } };
  const retry = { ...launch, ts: later, dispatchId: "retry", fallbackReason: "quota", fallbackStage: 1,
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  const events = [first, route, launch, retry, current, current];
  const result = summarize(events, [], [], { asOf: Date.parse(last) });
  assert.equal(result.projects[0].snapshots, 1);
  assert.equal(result.projects[0].launches, 2);
  assert.equal(result.taskDetails.length, 1);
  const task = result.taskDetails[0];
  assert.equal(task.task_title, "Frozen task"); assert.equal(task.grade, "medium_minus");
  assert.equal(task.latestApproval.grade, "medium_plus"); assert.equal(task.attempts.length, 2);
  assert.equal(task.attempts[1].effort, "max");
  const reset = summarize(events, [], [], { since: Date.parse(later), asOf: Date.parse(last), explicitReset: true });
  assert.equal(reset.projects[0].snapshots, 0); assert.equal(reset.projects[0].launches, 1);
  assert.equal(reset.taskDetails[0].task_title, "Frozen task");
  assert.equal(reset.taskDetails[0].inSnapshotWindow, false);
  const reviewOnly = summarize([first, route, launch, current], [], [], { since: Date.parse(later), asOf: Date.parse(last) });
  assert.equal(reviewOnly.taskDetails[0].grade, "medium_minus");
  assert.equal(reviewOnly.taskDetails[0].task_title, "Frozen task");
  assert.match(reviewOnly.taskDetails[0].status, /no attempts in this window/);
  assert.equal(reviewOnly.taskDetails[0].firstImplementation.model, "gemini-3.8-flash-medium");
  assert.equal(reviewOnly.pending, 0);
});

test("task detail distinguishes proposed reviews, unknown states and approved direct Control work", () => {
  const events = [
    { ...approval, taskKey: "review", status: "REVIEW_REQUIRED", difficulty: "hard" },
    { ...approval, taskKey: "unknown", status: "NOT_EVALUATED", difficulty: null },
    { ...approval, taskKey: "direct", difficulty: "hard", workflow: "direct" },
    { ...approval, taskKey: "pending" }, { event: "task_assessment", repo, ts },
  ];
  const result = summarize(events, [], []);
  const details = result.taskDetails;
  assert.equal(details.find((t) => t.id.endsWith('"review"]')).grade, null);
  assert.equal(details.find((t) => t.id.endsWith('"review"]')).status, "REVIEW_REQUIRED");
  assert.equal(details.find((t) => t.id.endsWith('"unknown"]')).status, "NOT_EVALUATED");
  assert.match(details.find((t) => t.grade === "hard").status, /Direct Control/);
  assert.equal(details.filter((t) => t.status === "Awaiting dispatch").length, 1);
  assert.equal(details.filter((t) => t.id.startsWith("unidentified:")).length, 1);
  assert.equal(details.filter((t) => !t.task_title).length, 5);
});

test("independent decision cohorts deduplicate bases and keep missing and contradictory effective reviews pending", () => {
  const m = metrics([reviewed, reviewed, { ...reviewed, ts: later }]);
  assert.equal(m.lowTierPrimaryCompliance.denominator, 1);
  assert.equal(m.correctionUtilization.denominator, 1);
  assert.equal(m.correctionUtilization.numerator, 0);
  const mismatch = { ...reviewed, primary: { harness: "codex", model: "gpt-6-luna", effort: "max" } };
  assert.equal(metrics([mismatch]).lowTierPrimaryCompliance.rate, 0);
  const unknown = metrics([approval]);
  assert.equal(unknown.lowTierPrimaryCompliance.pending, 1);
  assert.equal(unknown.lowTierPrimaryCompliance.rate, null);
  assert.equal(unknown.decisionEvidenceCoverage.missingEffectiveEvents, 1);
  const contradiction = { ...reviewed, decision_sha256: "f".repeat(64), difficulty: "medium_plus" };
  for (const rows of [[reviewed, contradiction], [contradiction, reviewed]]) {
    assert.equal(metrics(rows).correctionUtilization.pending, 1);
    assert.equal(summarize([...rows, route, launch], [], []).coverage.bound, 0);
  }
  const correction = { ...reviewed, ts: later, reviewed_at: later, decision_sha256: "f".repeat(64),
    decision_source: "control-override-justified", correction_sha256: "a".repeat(64) };
  assert.equal(metrics([reviewed, correction], { asOf: Date.parse(later) }).correctionUtilization.rate, 1);
  assert.equal(metrics([reviewed, correction], { asOf: Date.parse(ts) + 1 }).correctionUtilization.rate, 0);
  const retained = { ...correction, difficulty: "medium_plus", decision_source: "jev-and-control", correction_sha256: null };
  assert.equal(metrics([reviewed, retained]).correctionUtilization.rate, 0);
  const repeatedSnapshot = metrics([reviewed, { ...reviewed, assessment_basis_sha256: "a".repeat(64) }]);
  assert.equal(repeatedSnapshot.lowTierPrimaryCompliance.denominator, 1);
  assert.equal(repeatedSnapshot.correctionUtilization.denominator, 2);
});

test("Control acceptance is bound to dispatch evidence, effective at as_of and independent of worker done", () => {
  const base = [reviewed, route, launch];
  assert.equal(metrics([...base, { ...control, event: "worker_done" }]).agyAcceptedWithoutFallback.status, "NOT_EVALUATED");
  for (const patch of [{ reviewer: "worker" }, { evidence_sha256: null }, { run: "other" },
    { assessment_basis_sha256: "f".repeat(64) }, { reviewed_at: null }]) {
    const m = metrics([...base, { ...control, ...patch }]).agyAcceptedWithoutFallback;
    assert.equal(m.rate, null); assert.equal(m.pending, 1);
  }
  assert.equal(metrics([...base, control, control]).agyAcceptedWithoutFallback.rate, 1);
  const rejection = { ...control, ts: last, reviewed_at: last, verdict: "rejected" };
  assert.equal(metrics([...base, control, rejection], { asOf: Date.parse(later) }).agyAcceptedWithoutFallback.rate, 1);
  assert.equal(metrics([...base, rejection, control]).agyAcceptedWithoutFallback.rate, 0);
  assert.equal(metrics([...base, control, { ...control, verdict: "rejected" }]).agyAcceptedWithoutFallback.pending, 1);
  assert.equal(metrics([...base, control, { ...control, ts: last, reviewed_at: last, evidence_sha256: null }]).agyAcceptedWithoutFallback.pending, 1);
  const fallback = { ...launch, ts: last, dispatchId: "fallback", fallbackReason: "quota", fallbackStage: 1,
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  assert.equal(metrics([...base, control, fallback], { asOf: Date.parse(later) }).agyAcceptedWithoutFallback.rate, 1);
  assert.equal(metrics([...base, control, fallback]).agyAcceptedWithoutFallback.rate, 0);
  const retry = { ...fallback, fallbackReason: null, fallbackStage: null };
  const retryAcceptance = { ...control, dispatchId: retry.dispatchId, ts: last, reviewed_at: last };
  assert.equal(metrics([...base, control, retry, retryAcceptance]).agyAcceptedWithoutFallback.rate, 0);
  assert.equal(metrics([...base, control, { ...control, reviewed_at: null, verdict: "rejected" }]).agyAcceptedWithoutFallback.pending, 1);
});

test("malformed snapshot identities and undated contradictory decisions remain coverage", () => {
  for (const patch of [{ policy: null }, { policy: {} }, { policy: " " }, { taskKey: null }, { taskKey: {} }]) {
    const m = metrics([{ ...reviewed, ...patch }]);
    assert.equal(m.lowTierPrimaryCompliance.denominator, 0);
    assert.equal(m.correctionUtilization.denominator, 0);
    assert.equal(m.decisionEvidenceCoverage.invalidIdentityEvents, 1);
  }
  const undated = { ...reviewed, reviewed_at: null, difficulty: "medium_plus", decision_sha256: "f".repeat(64) };
  for (const rows of [[reviewed, undated], [undated, reviewed]]) {
    assert.equal(metrics(rows).correctionUtilization.pending, 1);
    assert.equal(summarize([...rows, route, launch], [], []).coverage.bound, 0);
  }
  assert.equal(metrics([{ ...reviewed, primary: null }]).lowTierPrimaryCompliance.pending, 1);
});

test("reference audits require evidence, deduplicate case/basis and preserve conflicts and absence", () => {
  const system = { ...reviewed, difficulty: "medium_plus", workflow: "dely" };
  const audit = { ...control, event: "task_reference_audit", case_id: "synthetic-case", reference_difficulty: "easy" };
  assert.equal(metrics([system]).upwardLeakage.status, "NOT_EVALUATED");
  assert.equal(metrics([system, audit, audit]).upwardLeakage.rate, 1);
  assert.equal(metrics([system, { ...audit, evidence_sha256: null }]).upwardLeakage.pending, 1);
  assert.equal(metrics([system, audit, { ...audit, reference_difficulty: "hard" }]).upwardLeakage.pending, 1);
  const laterAudit = { ...audit, ts: last, reviewed_at: last, reference_difficulty: "hard" };
  assert.equal(metrics([system, laterAudit, audit]).upwardLeakage.denominator, 0);
  assert.equal(metrics([system, laterAudit, audit], { asOf: Date.parse(later) + 1 }).upwardLeakage.denominator, 1);
  assert.equal(metrics([system, audit], { asOf: Date.parse(ts) + 1 }).upwardLeakage.rate, null);
  assert.equal(metrics([system, { ...audit, taskKey: "foreign" }]).upwardLeakage.rate, null);
  assert.equal(metrics([system, { ...audit, taskKey: "foreign" }]).upwardLeakage.coverage.unboundEvents, 1);
  assert.equal(metrics([{ ...system, reviewed_at: null }, audit]).upwardLeakage.pending, 1);
});

test("network fallback requires validated transport binding and a low-tier stage-one self-bound decision", () => {
  const evidence = { source: "orca_adapter", code: "ECONNRESET", operation: "repo add",
    specSha256: specHash, contextSha256: contextHash, assessmentBasisSha256: basis,
    noWorkerCreated: true, submissionAttempted: false, failed: true };
  const fallback = { ...launch, dispatchId: "network", ts: later, fallbackReason: "network", fallbackStage: 1,
    networkEvidence: evidence, launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  assert.equal(metrics([reviewed, route, launch, fallback]).lunaFallback.rate, 1);
  for (const patch of [{ networkEvidence: null }, { fallbackStage: 0 },
    { networkEvidence: { ...evidence, contextSha256: "f".repeat(64) } },
    { networkEvidence: { ...evidence, code: "TIMEOUT" } },
    { networkEvidence: { ...evidence, noWorkerCreated: false, inactive: true, failed: true } }]) {
    assert.equal(metrics([reviewed, route, launch, { ...fallback, ...patch }]).lunaFallback.rate, 0);
  }
  const reconciled = { ...evidence, noWorkerCreated: false, submissionAttempted: true, dispatchId: "failed-agy",
    inactive: true, failed: true, released: true };
  assert.equal(metrics([reviewed, route, launch, { ...fallback, networkEvidence: reconciled }]).lunaFallback.rate, 1);
  assert.equal(metrics([reviewed, route, launch, { ...fallback, networkEvidence: { ...reconciled, released: false } }]).lunaFallback.rate, 0);
});

test("new runtime fingerprints include the helper hash without fabricating it in history", () => {
  const runtime = runtimeFingerprint();
  assert.match(runtime.network, /^[a-f0-9]{64}$/);
  const events = [{ ...reviewed, runtime }, route, { ...launch, runtime }];
  assert.equal(summarize(events, [], [], { runtimes: [{ verified: true, fingerprint: runtime }] }).runtimeCohorts[0].verification, "VERIFIED");
  const { network, ...historical } = runtime;
  assert.equal(summarize(events, [], [], { runtimes: [{ verified: true, fingerprint: historical }] }).runtimeCohorts[0].verification, "NOT_EVALUATED");
  const old = summarize([{ ...reviewed, runtime: historical }, route, { ...launch, runtime: historical }], [], []);
  assert.equal(Object.hasOwn(old.runtimeCohorts[0].fingerprint, "network"), false);
});

test("configured runtime verification checks the actual network helper dependency", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dely-runtime-test-"));
  try {
    const directory = path.join(dir, "plugin/skills/delivery/scripts");
    fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(path.join(dir, "dely-compliance"));
    fs.writeFileSync(path.join(dir, "plugin/package.json"), JSON.stringify({ version: "0.27.6" }));
    const dependencies = {};
    for (const name of ["task-routing.js", "dely.js", "jev_agent.js", "usage.js", "network-fallback.js"]) {
      const file = path.join(directory, name);
      fs.writeFileSync(file, name);
      dependencies[file] = require("node:crypto").createHash("sha256").update(name).digest("hex");
    }
    const settings = { routing: path.join(directory, "task-routing.js"), dely: path.join(directory, "dely.js"),
      advisor: path.join(directory, "jev_agent.js"), dependencies };
    const file = path.join(dir, "dely-compliance/settings.json");
    fs.writeFileSync(file, JSON.stringify(settings));
    assert.equal(readRuntimes([dir])[0].verified, true);
    fs.writeFileSync(path.join(directory, "network-fallback.js"), "changed helper");
    assert.equal(readRuntimes([dir])[0].verified, false);
    fs.writeFileSync(path.join(directory, "network-fallback.js"), "network-fallback.js");
    delete dependencies[path.join(directory, "network-fallback.js")];
    fs.writeFileSync(file, JSON.stringify(settings));
    assert.equal(readRuntimes([dir])[0].verified, false);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("journal collection exposes bound Control and audit aggregation through the API", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dely-monitor-api-"));
  let server;
  try {
    const journal = path.join(dir, "log.jsonl");
    const audit = { ...control, event: "task_reference_audit", case_id: "synthetic-api-case", reference_difficulty: "easy" };
    const fixture = [reviewed, route, launch, control, audit].map((e) => ({ ...e, secret: "PRIVATE EVIDENCE" }));
    fs.writeFileSync(journal, fixture.map(JSON.stringify).join("\n") + "\n");
    server = createMonitor({ collect: async () => ({ ...await collect({ journal,
      readWorkers: async () => ({ rows: [] }), readConversations: async () => ({ rows: [] }) }), collectedAt: last }) });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/usage?days=30");
    assert.equal(response.status, 200);
    const raw = await response.text(), result = JSON.parse(raw);
    assert.equal(result.metrics.agyAcceptedWithoutFallback.numerator, 1);
    assert.equal(result.metrics.upwardLeakage.denominator, 1);
    assert.equal(result.metrics.upwardLeakage.numerator, 0);
    assert.equal(raw.includes("PRIVATE EVIDENCE"), false);
    assert.equal(raw.includes(control.evidence_sha256), false);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("review logging preserves effective time and a stable frozen decision fingerprint", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dely-monitor-review-"));
  try {
    const file = path.join(dir, "log.jsonl");
    const assessment = { ...approval, task: { repo, spec_sha256: specHash, context_sha256: contextHash, context: {} },
      route: { workflow: "dely", primary: approval.primary }, review: { by: "codex-control", reviewed_at: ts, source: "jev-reviewed", reason: "test fixture" } };
    recordTask(assessment, "review", file); recordTask(assessment, "review", file);
    const rows = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(rows[0].reviewed_at, ts); assert.match(rows[0].decision_sha256, /^[a-f0-9]{64}$/);
    assert.equal(rows[0].decision_sha256, rows[1].decision_sha256);
    assert.equal(metrics(rows).lowTierPrimaryCompliance.denominator, 1);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a task and duplicate receipts count once; fallback launches remain separate", () => {
  const fallback = { ...launch, dispatchId: "second", fallbackReason: "quota", fallbackStage: 1,
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  const result = summarize([approval, approval, route, launch, launch, fallback], [], [], { since: 0 });
  assert.equal(result.tasks.approved, 1); assert.equal(result.tasks.eligible, 1);
  assert.equal(result.tasks.dispatched, 1); assert.equal(result.tasks.rate, 1);
  assert.equal(result.models.reduce((sum, r) => sum + r.launches, 0), 2);
  assert.equal(result.models.find((r) => r.model === "gpt-6-luna").fallbacks, 1);
  assert.deepEqual(result.metrics.agyStart, { numerator: 1, denominator: 1, rate: 1 });
  assert.equal(result.metrics.lunaFallback.rate, 1);
  assert.equal(result.coverage.confirmed, 2);
  assert.equal(result.metrics.agyAcceptedWithoutFallback.rate, null);
});

test("case36 events/retries remain distinct from snapshots keyed by policy and taskKey", () => {
  const v3 = { ...approval, policy: "jev-task-routing-v3" };
  const v4 = { ...approval, policy: "jev-task-routing-v4" };
  const result = summarize([v3, v4, v4, { ...route, policy: v4.policy }, launch], [], []);
  assert.equal(result.tasks.events, 3);
  assert.equal(result.tasks.recorded, 2);
  assert.equal(result.tasks.dispatched, 1);
  assert.equal(result.approvals.find((r) => r.policy === v3.policy).dispatched, false);
  assert.equal(result.approvals.find((r) => r.policy === v4.policy).dispatched, true);
});

test("Hard and missing grades never enter the Dely denominator", () => {
  const hard = { ...approval, taskKey: "hard", difficulty: "hard", workflow: "direct" };
  const unknown = { ...approval, taskKey: "unknown", difficulty: null };
  const result = summarize([hard, unknown], [], []);
  assert.equal(result.tasks.approved, 1); assert.equal(result.tasks.unknown, 1);
  assert.equal(result.tasks.eligible, 0); assert.equal(result.tasks.rate, null);
});

test("an approved eligible task without a launch is visible as not observed", () => {
  const result = summarize([approval], [], []);
  assert.equal(result.tasks.rate, null); assert.equal(result.approvals[0].dispatched, false);
  assert.equal(result.pending, 1);
});

test("codex-compliance-test-* fixture directory components are recognized as probes while preserving genuine repos", () => {
  const fixturePaths = [
    "/tmp/codex-compliance-test-12345/repo",
    "C:\\Users\\User\\AppData\\Local\\Temp\\codex-compliance-test-123456\\repo",
    "C:/temp/CODEX-COMPLIANCE-TEST-XYZ/repo",
    "codex-compliance-test-standalone",
    "D:/tmp/codex-compliance-test-end",
    "/tmp/codex-compliance-test-/repo",
  ];
  for (const p of fixturePaths) {
    assert.equal(isProbe(p), true, `Fixture path should be probe: ${p}`);
  }

  for (const p of ["D:/.tmp-dely/fixture", "D:/dely-probe/test", "D:/routing-tests-1", "D:/jev-agent-1"]) {
    assert.equal(isProbe(p), true, `Existing probe class should be preserved: ${p}`);
  }

  const genuineRepos = [
    "D:/projects/my-codex-compliance-test-suite",
    "C:\\projects\\my-codex-compliance-test-suite",
    "D:/projects/codex-compliance-test",
    "C:\\projects\\codex-compliance-test",
    "D:/projects/codex-compliance-testing",
    "D:/projects/foo-codex-compliance-test-bar/repo",
    "D:/projects/ordinary-repo",
  ];
  for (const p of genuineRepos) {
    assert.equal(isProbe(p), false, `Genuine repo should not be probe: ${p}`);
  }

  const posixFixture = "/tmp/codex-compliance-test-abc/repo";
  const winFixture = "C:\\temp\\codex-compliance-test-def\\repo";
  const genuineRepo = "D:/projects/my-codex-compliance-test-suite";

  const events = [
    approval,
    { ...approval, taskKey: "genuine", repo: genuineRepo, difficulty: "easy" },
    { ...approval, taskKey: "fixture-posix", repo: posixFixture, difficulty: "hard" },
    { ...approval, taskKey: "fixture-win", repo: winFixture, difficulty: "medium_plus" },
  ];
  const workers = [
    { id: "w-ordinary", repo, ts, status: "succeeded" },
    { id: "w-genuine", repo: genuineRepo, ts, status: "succeeded" },
    { id: "w-posix", repo: posixFixture, ts, status: "failed" },
    { id: "w-win", repo: winFixture, ts, status: "failed" },
  ];
  const conversations = [
    { session: "c-ordinary", repo, ts, model: "sol" },
    { session: "c-genuine", repo: genuineRepo, ts, model: "sol" },
    { session: "c-posix", repo: posixFixture, ts, model: "sol" },
    { session: "c-win", repo: winFixture, ts, model: "sol" },
  ];

  const defaultSummary = summarize(events, workers, conversations);
  assert.equal(defaultSummary.tasks.approved, 2);
  assert.equal(defaultSummary.tasks.grades.find((g) => g.grade === "hard").count, 0);
  assert.equal(defaultSummary.tasks.grades.find((g) => g.grade === "medium_plus").count, 0);
  assert.equal(defaultSummary.tasks.grades.find((g) => g.grade === "easy").count, 1);
  assert.equal(defaultSummary.tasks.grades.find((g) => g.grade === "medium_minus").count, 1);
  assert.equal(defaultSummary.jobs.count, 2);
  assert.equal(defaultSummary.conversations.turns, 2);
  const projectPaths = defaultSummary.projects.map((p) => p.repo);
  assert.ok(projectPaths.includes(repo));
  assert.ok(projectPaths.includes(genuineRepo));
  assert.ok(!projectPaths.includes(posixFixture));
  assert.ok(!projectPaths.includes("C:/temp/codex-compliance-test-def/repo"));

  const probeSummary = summarize(events, workers, conversations, { probes: true });
  assert.equal(probeSummary.tasks.approved, 4);
  assert.equal(probeSummary.tasks.grades.find((g) => g.grade === "hard").count, 1);
  assert.equal(probeSummary.tasks.grades.find((g) => g.grade === "medium_plus").count, 1);
  assert.equal(probeSummary.jobs.count, 4);
  assert.equal(probeSummary.conversations.turns, 4);
  const probeProjectPaths = probeSummary.projects.map((p) => p.repo);
  assert.ok(probeProjectPaths.includes(posixFixture));
  assert.ok(probeProjectPaths.includes("C:/temp/codex-compliance-test-def/repo"));
});

test("repo, date and probe filters use the same cohort for approvals and launches", () => {
  const old = { ...approval, taskKey: "old", ts: "2026-09-01T01:00:00Z" };
  const probe = { ...approval, taskKey: "probe", repo: "D:/project/.tmp-dely/fixture" };
  const other = { ...approval, taskKey: "other", repo: "D:/other" };
  const result = summarize([approval, old, probe, other, route, launch], [], [], { since: Date.parse("2026-10-01T00:00:00Z"), repo });
  assert.equal(result.tasks.approved, 1); assert.equal(result.tasks.dispatched, 1);
});

test("Orca outcomes and unknown models are never replaced by expected pins", () => {
  const workers = [{ id: "unknown", repo, ts, status: "succeeded", model: null }];
  const result = summarize([approval], workers, []);
  assert.equal(result.jobs.succeeded, 1); assert.equal(result.jobs.unknownModel, 1);
  assert.equal(result.activity[0].model, null); assert.equal(result.activity[0].grade, null);
  assert.equal(result.models.length, 0);
});

test("conversation model activity stays separate from implementation models", () => {
  const result = summarize([route, launch], [], [{ session: "control", model: "gpt-6.1-sol", repo, ts }]);
  assert.equal(result.models[0].model, "gemini-3.8-flash-medium");
  assert.equal(result.conversations.models[0].model, "gpt-6.1-sol");
});

test("first confirmed dispatch fixes the decision, window and runtime cohort across later reviews", () => {
  const runtime = { version: "0.27.6", router: "1".repeat(64), dispatcher: "2".repeat(64), usage: "3".repeat(64) };
  const later = "2026-10-10T01:00:00Z";
  const changed = { ...approval, ts: later, difficulty: "medium_plus", primary: { harness: "codex", model: "gpt-6.1-sol", effort: "medium" } };
  const events = [{ ...approval, runtime }, { ...route, runtime }, { ...launch, runtime }, changed,
    { ...route, ts: later, difficulty: "medium_plus" },
    { ...launch, ts: later, dispatchId: "retry", launch: { effective: { agent: "codex", model: "gpt-6.1-sol", effort: "medium" } } }];
  const result = summarize(events, [], [], { runtimes: [{ verified: true, fingerprint: runtime }] });
  assert.equal(result.metrics.agyPrimary.rate, 1); assert.equal(result.metrics.agyStart.rate, 1);
  assert.equal(result.runtimeCohorts[0].verification, "VERIFIED");
  assert.equal(result.runtimeCohorts[0].snapshots, 1);
  assert.equal(summarize(events, [], [], { since: Date.parse(later) }).metrics.agyStart.denominator, 0);
  const early = summarize(events, [], [], { asOf: Date.parse(ts) + 1, end: Date.parse(ts) + 1 });
  assert.equal(early.tasks.approved, 1); assert.equal(early.models.length, 1);
  const extra = { ...runtime, privateExtra: "DO NOT EXPOSE" };
  assert.ok(!JSON.stringify(summarize([{ ...approval, runtime: extra }, route, { ...launch, runtime: extra }], [], [])).includes("DO NOT EXPOSE"));
});

test("a confirmed Luna-first launch is a single AGY-primary snapshot, not an AGY start", () => {
  const luna = { ...launch, fallbackStage: null, pinPhase: "implement_backup_2", fallbackReason: "model_unavailable",
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  const result = summarize([approval, route, luna], [], []);
  assert.equal(result.metrics.agyPrimary.rate, 1); assert.equal(result.metrics.agyStart.rate, 0);
  assert.equal(result.metrics.lunaFallback.rate, 1);
});

test("missing or mismatched bindings, conflicting receipts and incomplete history report coverage", () => {
  for (const changed of [{ assessmentBasisSha256: "d".repeat(64) }, { contextSha256: "d".repeat(64) },
    { promptSha256: "d".repeat(64) }, { correctionSha256: "d".repeat(64) }, { launch: {} }]) {
    const result = summarize([approval, route, { ...launch, ...changed }], [], []);
    assert.equal(result.metrics.agyStart.rate, null); assert.equal(result.coverage.unbound, 1);
    assert.equal(result.coverage.history, "NOT_EVALUATED");
  }
  const conflict = summarize([approval, route, launch, { ...launch, contextSha256: "d".repeat(64) }], [], []);
  assert.equal(conflict.metrics.agyStart.rate, null); assert.equal(conflict.coverage.conflicting, 1);
  const empty = summarize([], [], []);
  assert.equal(empty.metrics.agyStart.rate, null); assert.equal(empty.metrics.agyPrimary.rate, null);
  assert.equal(empty.metrics.agyAcceptedWithoutFallback.status, "NOT_EVALUATED");
  assert.equal(summarize([approval, route], [], []).metrics.agyStart.denominator, 0);
});

test("fallback after the cohort window counts only through as_of and worker success is not acceptance", () => {
  const later = "2026-10-11T01:00:00Z", end = Date.parse("2026-10-10T00:00:00Z");
  const fallback = { ...launch, ts: later, dispatchId: "fallback", fallbackReason: "quota", fallbackStage: 1,
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  const events = [approval, route, launch, fallback];
  assert.equal(summarize(events, [], [], { end, asOf: end }).metrics.lunaFallback.rate, 0);
  const result = summarize(events, [{ id: launch.dispatchId, repo, ts, status: "succeeded" }], [], { end });
  assert.equal(result.metrics.lunaFallback.rate, 1); assert.equal(result.metrics.agyStart.denominator, 1);
  assert.equal(result.metrics.agyAcceptedWithoutFallback.rate, null);
});

test("a later approved basis can add a valid fallback to the original snapshot cohort", () => {
  const later = "2026-10-11T01:00:00Z", nextBasis = "d".repeat(64);
  const next = { ...approval, ts: later, assessment_basis_sha256: nextBasis };
  const nextRoute = { ...route, ts: later, assessmentBasisSha256: nextBasis };
  const fallback = { ...launch, ts: later, dispatchId: "new-basis-fallback", assessmentBasisSha256: nextBasis,
    fallbackReason: "quota", fallbackStage: 1,
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  const result = summarize([approval, route, launch, next, nextRoute, fallback], [], []);
  assert.equal(result.metrics.agyStart.denominator, 1); assert.equal(result.metrics.agyStart.rate, 1);
  assert.equal(result.metrics.lunaFallback.rate, 1);
  const sol = { harness: "codex", model: "gpt-6.1-sol", effort: "medium" };
  const invalid = summarize([approval, route, launch, { ...next, difficulty: "medium_plus", primary: sol },
    { ...nextRoute, difficulty: "medium_plus" }, fallback], [], []);
  assert.equal(invalid.metrics.agyPrimary.rate, 1);
  assert.equal(invalid.metrics.lunaFallback.rate, 0);
});

test("titles use frozen headings outside fences, preserving Unicode graphemes and optional domains", () => {
  const grapheme = "e\u0302\u0301", emoji = "👩🏽‍💻";
  const task = { spec: "```md\n# Hidden\n~~~\n```\n~~~md\n# Also hidden\n~~~\n#   " + grapheme.repeat(59) + emoji + "extra  ###\n",
    spec_file: "must-not-be-read.md", context: { domain: "ui_frontend" } };
  const original = task.spec;
  assert.equal(taskMetadata(task).task_title, grapheme.repeat(59) + emoji);
  assert.equal(task.spec, original); assert.equal(taskMetadata(task).domain, "ui_frontend");
  assert.equal(taskMetadata({ spec: "## No heading\n```\n# Hidden", context: { domain: "bugfix" } }).task_title, null);
  assert.equal(taskMetadata({ spec: "# ###" }).task_title, null);
  assert.equal(taskMetadata({ spec: "# Real\n# Later", context: { domain: "bugfix" } }).domain, null);
  assert.equal(taskMetadata({ spec: "#  Real\t title  ###" }).task_title, "Real title");
});

test("metadata failure retains the basic assessment event without changing its decision", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dely-monitor-metadata-")), file = path.join(dir, "log.jsonl");
  try {
    const task = { repo, spec_sha256: specHash, context_sha256: contextHash, context: {} };
    Object.defineProperty(task, "spec", { get() { throw Error("metadata unavailable"); } });
    recordTask({ ...approval, task, route: { workflow: "dely", primary: approval.primary } }, "review", file);
    const row = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(row.difficulty, approval.difficulty); assert.equal(row.task_title, null); assert.equal(row.domain, null);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an incomplete JSONL tail does not discard complete metadata records", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dely-monitor-test-"));
  try {
    const file = path.join(dir, "log.jsonl"); fs.writeFileSync(file, JSON.stringify(approval) + "\n{unfinished");
    const rows = []; const malformed = await jsonLines(file, (r) => rows.push(r));
    assert.equal(rows.length, 1); assert.equal(malformed, 1);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("task observation is opt-in and never records raw source or credentials", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dely-monitor-observer-"));
  const original = os.homedir;
  try {
    os.homedir = () => dir;
    const a = { task: { repo, spec_sha256: "spec", context_sha256: "context", spec: "PRIVATE SOURCE", context: { secret: "PRIVATE KEY" } },
      policy: "jev-task-routing-v2", status: "APPROVED", difficulty: "hard", route: { workflow: "direct", primary: { model: "gpt-6.1-sol", unrecognized: "PRIVATE EXTRA" } }, review: { by: "codex-control" } };
    recordTask(a, "review"); assert.equal(fs.existsSync(path.join(dir, ".dely")), false);
    fs.mkdirSync(path.join(dir, ".dely")); recordTask(a, "review");
    const raw = fs.readFileSync(path.join(dir, ".dely/log.jsonl"), "utf8");
    assert.ok(!raw.includes("PRIVATE")); assert.equal(JSON.parse(raw).difficulty, "hard");
  } finally {
    os.homedir = original;
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loopback API exposes only sanitized metadata and rejects write/path/host requests", async () => {
  const privateEvent = { ...approval, secret: "DO NOT EXPOSE" };
  const server = createMonitor({ collect: async () => ({ events: [privateEvent], workers: [], conversations: [], sources: {}, collectedAt: ts }) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const url = "http://127.0.0.1:" + server.address().port;
    const response = await fetch(url + "/api/usage?days=30");
    assert.equal(response.status, 200); assert.ok(!(await response.text()).includes("DO NOT EXPOSE"));
    assert.equal((await fetch(url + "/api/usage?days=999")).status, 400);
    assert.equal((await fetch(url + "/api/usage", { method: "POST" })).status, 405);
    assert.equal((await fetch(url + "/package.json")).status, 404);
    const foreign = await new Promise((resolve) => {
      http.get(url, { headers: { Host: "foreign.example" } }, (r) => { r.resume(); resolve(r.statusCode); });
    });
    assert.equal(foreign, 403);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("since intersects the rolling window without letting historical snapshots re-enter through retries", async () => {
  const nextContext = "f".repeat(64), nextBasis = "e".repeat(64);
  const nextApproval = { ...reviewed, ts: later, reviewed_at: later, context_sha256: nextContext,
    taskKey: taskKey(repo, specHash, nextContext), assessment_basis_sha256: nextBasis };
  const nextRoute = { ...route, ts: later, run: "new-snapshot", contextSha256: nextContext, assessmentBasisSha256: nextBasis };
  const nextLaunch = { ...launch, ts: later, run: nextRoute.run, dispatchId: "new-first",
    contextSha256: nextContext, assessmentBasisSha256: nextBasis };
  const retry = { ...launch, ts: later, dispatchId: "old-retry" };
  const fallback = { ...retry, dispatchId: "old-fallback", fallbackReason: "quota", fallbackStage: 1,
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  const events = [reviewed, route, launch, retry, fallback, nextApproval, nextRoute, nextLaunch];
  const original = JSON.stringify(events);
  const probeRepo = "D:/.tmp-dely-probe";
  const workers = [{ id: "old-worker", repo, ts }, { id: "new-worker", repo, ts: later },
    { id: "probe-worker", repo: probeRepo, ts: later }];
  const conversations = [{ session: "old", repo, ts }, { session: "new", repo, ts: later },
    { session: "probe", repo: probeRepo, ts: later }];
  const server = createMonitor({ collect: async () => ({ events, workers, conversations, sources: {}, collectedAt: last }) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port + "/api/usage";
  const get = async (query = "") => (await fetch(url + query)).json();
  try {
    assert.equal((await get()).metrics.agyStart.denominator, 2);
    const reset = await get("?since=" + encodeURIComponent(later));
    assert.equal(reset.window.start, new Date(later).toISOString());
    assert.equal(reset.metrics.agyStart.denominator, 1);
    assert.equal(reset.metrics.lunaFallback.numerator, 0);
    assert.equal(reset.jobs.count, 1); assert.equal(reset.conversations.turns, 1);
    const probes = await get("?probes=true&since=" + encodeURIComponent(later));
    assert.equal(probes.jobs.count, 2); assert.equal(probes.conversations.turns, 2);
    const scoped = await get("?probes=true&repo=" + encodeURIComponent(repo) + "&since=" + encodeURIComponent(later));
    assert.equal(scoped.jobs.count, 1); assert.equal(scoped.conversations.turns, 1);
    const after = await get("?since=" + encodeURIComponent("2026-10-10T01:00:00.001Z"));
    assert.equal(after.metrics.agyStart.denominator, 0);
    assert.equal(after.metrics.agyStart.rate, null);
    assert.equal(after.jobs.count, 0); assert.equal(after.conversations.turns, 0);
    const rolling = await get("?days=1&since=" + encodeURIComponent(ts));
    assert.equal(rolling.window.start, new Date(later).toISOString());
    assert.equal(rolling.metrics.agyStart.denominator, 1);
    const missingRepo = await get("?repo=D:/absent&since=" + encodeURIComponent(later));
    assert.equal(missingRepo.metrics.agyStart.denominator, 0); assert.equal(missingRepo.jobs.count, 0);
    assert.equal((await get("?since=" + encodeURIComponent("2026-10-10T03:00:00+02:00"))).window.start, reset.window.start);
    for (const invalid of ["", "yesterday", "2026-02-30T00:00:00Z", "2026-10-10", "2026-10-10T01:00:00", "Infinity"]) {
      assert.equal((await fetch(url + "?since=" + encodeURIComponent(invalid))).status, 400, invalid);
    }
    const future = await get("?since=" + encodeURIComponent("2026-10-12T01:00:00Z"));
    assert.equal(future.window.start, future.window.end);
    assert.equal(future.metrics.agyStart.denominator, 0);
    assert.equal((await get()).metrics.agyStart.denominator, 2);
    assert.equal(JSON.stringify(events), original);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("reset newer than the collector cache reloads sources before summarizing", async () => {
  let reads = 0;
  const server = createMonitor({ collect: async () => ({ events: [], workers: [], conversations: [], sources: {},
    collectedAt: ++reads === 1 ? ts : last }) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port + "/api/usage";
  try {
    await fetch(url); assert.equal(reads, 1);
    const response = await (await fetch(url + "?since=" + encodeURIComponent(later))).json();
    assert.equal(reads, 2); assert.equal(response.collectedAt, last);
    assert.equal(response.window.start, new Date(later).toISOString());
    assert.equal(response.window.end, new Date(last).toISOString());
  } finally { await new Promise((resolve) => server.close(resolve)); }
});


function runSidebarNavigation(initialHash, source = fs.readFileSync(path.join(__dirname, "../ui/monitor/monitor.js"), "utf8")) {
  class MockElement {
    constructor(tag, href = "", className = "") {
      this.tagName = tag;
      this.href = href;
      this.className = className;
      this.attributes = new Map();
      if (href) this.attributes.set("href", href);
      this.classes = new Set(className ? className.split(/\s+/).filter(Boolean) : []);
      this.classList = {
        add: (...cls) => cls.forEach((c) => this.classes.add(c)),
        remove: (...cls) => cls.forEach((c) => this.classes.delete(c)),
        toggle: (c, force) => {
          if (force === undefined) force = !this.classes.has(c);
          if (force) this.classes.add(c); else this.classes.delete(c);
          return force;
        },
        contains: (c) => this.classes.has(c),
      };
      this.open = false;
      this.parent = null;
      this.scrollIntoViewCalled = false;
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    hasAttribute(name) { return this.attributes.has(name); }
    closest(selector) {
      if (selector === ".advanced" && (this.className.includes("advanced") || this.parent?.className.includes("advanced"))) {
        return this.parent?.className.includes("advanced") ? this.parent : this;
      }
      return null;
    }
    scrollIntoView() { this.scrollIntoViewCalled = true; }
  }

  const navItems = [
    new MockElement("a", "#overview", "nav-item active"),
    new MockElement("a", "#models", "nav-item"),
    new MockElement("a", "#measures", "nav-item"),
    new MockElement("a", "#routing", "nav-item"),
    new MockElement("a", "#jev", "nav-item"),
    new MockElement("a", "#activity", "nav-item"),
  ];

  const advanced = new MockElement("details", "", "advanced");
  const targets = {
    overview: new MockElement("header"),
    models: new MockElement("section"),
    activity: new MockElement("section"),
    measures: new MockElement("section"),
    routing: new MockElement("section"),
    jev: new MockElement("section"),
    "observation-start": new MockElement("p"),
  };
  targets.measures.parent = advanced;
  targets.routing.parent = advanced;
  targets.jev.parent = advanced;
  targets["observation-start"].parent = advanced;

  const listeners = {};
  const windowObj = {
    addEventListener: (event, fn) => { (listeners[event] ||= []).push(fn); },
  };
  const locationObj = { hash: initialHash };
  const documentObj = {
    querySelectorAll: (sel) => {
      if (sel.includes(".sidebar .nav-item") || sel.includes(".nav-item")) return navItems;
      return [];
    },
    getElementById: (id) => targets[id] || null,
  };

  const navCode = source.slice(
    source.indexOf("function revealEvidence()"),
    source.lastIndexOf("observationStatus();")
  );

  require("node:vm").runInNewContext(navCode, {
    window: windowObj,
    document: documentObj,
    location: locationObj,
  });

  return {
    navItems,
    advanced,
    targets,
    location: locationObj,
    triggerHashChange: (newHash) => {
      locationObj.hash = newHash;
      for (const fn of (listeners["hashchange"] || [])) fn();
    },
    getActive: () => navItems.filter((item) => item.classList.contains("active")),
    getWithAriaCurrent: () => navItems.filter((item) => item.hasAttribute("aria-current")),
  };
}

function assertSidebarState(env, expectedHref, messagePrefix = "") {
  const active = env.getActive();
  assert.equal(active.length, 1, String(messagePrefix) + "Expected exactly one active sidebar link, found " + active.length);
  assert.equal(active[0].getAttribute("href"), expectedHref, String(messagePrefix) + "Expected active href to be " + expectedHref);
  const current = env.getWithAriaCurrent();
  assert.equal(current.length, 1, String(messagePrefix) + "Expected exactly one link with aria-current, found " + current.length);
  assert.equal(current[0].getAttribute("href"), expectedHref, String(messagePrefix) + "Expected aria-current on " + expectedHref);
  assert.equal(current[0].getAttribute("aria-current"), "location", String(messagePrefix) + "Expected aria-current=\"location\"");
}

test("sidebar synchronizes active link and aria-current on initial load, hashchange, history, and falls back to overview", () => {
  // 1. Initial page load with #models
  const env = runSidebarNavigation("#models");
  assertSidebarState(env, "#models", "Initial load: ");

  // 2. Each of the six known fragments
  const knownFragments = ["#overview", "#models", "#measures", "#routing", "#jev", "#activity"];
  for (const frag of knownFragments) {
    env.triggerHashChange(frag);
    assertSidebarState(env, frag, "Known fragment " + frag + ": ");
  }

  // 3. Hash changes representing click, advanced target revelation, and Back/Forward history navigation
  // Click #measures (inside advanced details)
  env.triggerHashChange("#measures");
  assertSidebarState(env, "#measures", "Click #measures: ");
  assert.equal(env.advanced.open, true, "Advanced details should be opened for #measures");
  assert.equal(env.targets.measures.scrollIntoViewCalled, true, "scrollIntoView called for #measures");

  // Click #activity (regular section)
  env.triggerHashChange("#activity");
  assertSidebarState(env, "#activity", "Click #activity: ");

  // Back button to #measures
  env.triggerHashChange("#measures");
  assertSidebarState(env, "#measures", "Back to #measures: ");

  // Back button to #models
  env.triggerHashChange("#models");
  assertSidebarState(env, "#models", "Back to #models: ");

  // 4. Missing or unknown fragments fall back to #overview
  // Empty fragment
  env.triggerHashChange("");
  assertSidebarState(env, "#overview", "Empty fragment: ");

  // Bare '#'
  env.triggerHashChange("#");
  assertSidebarState(env, "#overview", "Bare # fragment: ");

  // Unknown fragment
  env.triggerHashChange("#unknown-section");
  assertSidebarState(env, "#overview", "Unknown fragment: ");

  // Unknown fragment inside advanced (#observation-start is in DOM but not a sidebar link)
  env.advanced.open = false;
  env.targets["observation-start"].scrollIntoViewCalled = false;
  env.triggerHashChange("#observation-start");
  assertSidebarState(env, "#overview", "In-page target #observation-start should default sidebar to #overview: ");
  assert.equal(env.advanced.open, true, "Target in advanced details should still open advanced");
  assert.equal(env.targets["observation-start"].scrollIntoViewCalled, true, "Target scrollIntoView should be called");
});

test("sidebar detector rejects present-but-wrong handlers (static overview or missing updates)", () => {
  // Static overview / no-op handler that keeps #overview active regardless of location.hash
  const staticOverviewSource = `
function revealEvidence() {
  const target = document.getElementById(location.hash.slice(1));
  if (target?.closest(".advanced")) {
    target.closest(".advanced").open = true;
    target.scrollIntoView();
  }
}
window.addEventListener("hashchange", revealEvidence);
revealEvidence();
observationStatus();
`;
  assert.throws(() => {
    const env = runSidebarNavigation("#models", staticOverviewSource);
    assertSidebarState(env, "#models");
  }, /Expected active href to be #models/);
});
