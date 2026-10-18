"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { summarize, jsonLines } = require("./dely-monitor-data.js");
const { createMonitor } = require("./dely-monitor.js");
const { taskKey, taskMetadata, recordTask } = require("../skills/delivery/scripts/usage.js");
const ts = "2026-10-09T01:00:00Z", repo = "D:/project";
const specHash = "a".repeat(64), contextHash = "b".repeat(64), basis = "c".repeat(64);
const key = taskKey(repo, specHash, contextHash);
const approval = { event: "task_assessment", taskKey: key, ts, repo,
  policy: "jev-task-routing-v4", reviewer: "codex-control", decision_source: "jev-reviewed", assessment_basis_sha256: basis,
  status: "APPROVED", difficulty: "medium_minus", workflow: "dely",
  primary: { harness: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" } };
const route = { event: "task_route", run: "run-one", ts, repo, policy: approval.policy, difficulty: "medium_minus",
  specSha256: specHash, contextSha256: contextHash, assessmentBasisSha256: basis, reviewSource: approval.decision_source };
const launch = { event: "dispatch", run: "run-one", ts, repo, dispatchId: "first", phase: "implement",
  promptSha256: specHash, contextSha256: contextHash, assessmentBasisSha256: basis,
  launch: { requested: { model: "gemini-3.8-flash-medium" }, effective: { agent: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" } } };

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
