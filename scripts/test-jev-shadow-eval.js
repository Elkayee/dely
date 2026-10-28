"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const benchmark = require("./jev-shadow-eval.js");
const advisor = require("./jev_agent.js");
const cases = require("./fixtures/jev-cookbook-cases.json");

test("shadow evaluation preserves labelled raw observations and never activates replay thresholds", async t => {
  const seen = new Set();
  const result = await benchmark.evaluate({ repeats: 2, advise: async (input, mode, options) => {
    assert.equal(mode, "citations");
    assert.ok(!seen.has(options.evaluationUid)); seen.add(options.evaluationUid);
    const item = cases.find(item => item.id === input.citations[0].id);
    return { authority: "NONE", model: advisor.MODEL, citations: [{ judgment: item.expected,
      evaluation_status: item.expected === "NOT_EVALUATED" ? "NOT_EVALUATED" : "EVALUATED", confidence: 0.46 }] };
  } });
  assert.equal(result.observations.length, cases.length * 2);
  assert.equal(result.summary.observed_semantic_accuracy, 1);
  assert.ok(result.summary.policy_replay.every(row => row.activated === false && row.calibrated === false));
  assert.equal(result.policy.calibration_status, "NOT_EVALUATED");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jev-shadow-test-"));
  t.after(() => { for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); });
  const file = path.join(directory, "results.json");
  fs.writeFileSync(file, JSON.stringify(result));
  assert.deepEqual(benchmark.replay(file).summary, result.summary);
  result.observations.push(result.observations[0]);
  fs.writeFileSync(file, JSON.stringify(result));
  assert.throws(() => benchmark.replay(file), /identity|observation/i);
});

test("shadow evaluation stops on transport failure without retry or invented coverage", async () => {
  let calls = 0;
  const result = await benchmark.evaluate({ repeats: 3, advise: async () => {
    calls++;
    return { authority: "NONE", status: "NOT_EVALUATED", request_diagnostics: { stage: "timeout", code: "REQUEST_TIMEOUT" } };
  } });
  assert.equal(calls, 1);
  assert.equal(result.observations.length, 1);
  assert.equal(result.summary.semantic_coverage, 0);
  assert.equal(result.summary.observed_semantic_accuracy, null);
});

test("shadow CLI requires an explicit mode before any evaluation", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "jev-shadow-eval.js")], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stdout + result.stderr, /Bearer|TYPESAFE_API_KEY=/);
  assert.equal(advisor.MODEL, "jev-1.13.0");
});
