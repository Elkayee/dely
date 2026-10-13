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
const { taskKey, recordTask } = require("../skills/delivery/scripts/usage.js");
const ts = "2026-10-09T01:00:00Z", repo = "D:/project";
const key = taskKey(repo, "spec", "context");
const approval = { event: "task_assessment", taskKey: key, ts, repo,
  status: "APPROVED", difficulty: "medium_minus", workflow: "dely", primary: { model: "gemini-3.8-flash-high" } };
const route = { event: "task_route", run: "run-one", ts, repo, difficulty: "medium_minus", specSha256: "spec", contextSha256: "context" };
const launch = { event: "dispatch", run: "run-one", ts, repo, dispatchId: "first",
  launch: { requested: { model: "gemini-3.8-flash-high" }, effective: { model: "gemini-3.8-flash-high" } } };

test("a task and duplicate receipts count once; fallback launches remain separate", () => {
  const fallback = { ...launch, dispatchId: "second", fallbackReason: "quota", launch: { effective: { model: "gpt-6-luna" } } };
  const result = summarize([approval, approval, route, launch, launch, fallback], [], [], { since: 0 });
  assert.equal(result.tasks.approved, 1); assert.equal(result.tasks.eligible, 1);
  assert.equal(result.tasks.dispatched, 1); assert.equal(result.tasks.rate, 1);
  assert.equal(result.models.reduce((sum, r) => sum + r.launches, 0), 2);
  assert.equal(result.models.find((r) => r.model === "gpt-6-luna").fallbacks, 1);
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
  assert.equal(result.tasks.rate, 0); assert.equal(result.approvals[0].dispatched, false);
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
  assert.equal(result.models[0].model, "gemini-3.8-flash-high");
  assert.equal(result.conversations.models[0].model, "gpt-6.1-sol");
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
