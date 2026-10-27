"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const advisor = require(process.env.EVIDENCE_ADVISOR || "./jev_agent.js");

const fields = ["method", "fixture", "procedure", "expected_result", "counterexample", "source", "caller", "detector"];
const hash = value => createHash("sha256").update(value).digest("hex");
function snapshot() {
  const spec = "# Private helper regression\nPreserve known callers.\n";
  const context = JSON.stringify({ acceptance: "node --test helper.test.js; empty fixture; call helper; expect []; fails if null",
    evidence: "helper.js source, caller.js invocation, helper.test.js assertion inspected" });
  const assessment = JSON.stringify({ status: "NOT_EVALUATED", task: { spec, context: JSON.parse(context),
    spec_sha256: hash(spec), context_sha256: hash(context) },
    jev: { model: advisor.MODEL, answers: { verification: { type: "choice", choice: "insufficient_evidence" } } } });
  return { request: "Diagnose the frozen verification evidence", spec, context, assessment };
}
function transport(choices = {}, change = () => {}) {
  return async (_url, init) => {
    const sent = JSON.parse(init.body);
    assert.equal(sent.state.spec, snapshot().spec);
    assert.deepEqual(sent.state.context, JSON.parse(snapshot().context));
    assert.deepEqual(Object.keys(sent.questions), fields);
    for (const field of fields) {
      assert.match(sent.questions[field].instructions, new RegExp("Diagnose " + field + ":"));
      assert.match(sent.questions[field].instructions, /not.*original.*reason/i);
    }
    const reply = { model: advisor.MODEL, answers: Object.fromEntries(fields.map(field => {
      const choice = choices[field] || "present";
      return [field, { type: "choice", choice, confidence: 0.2,
        probabilities: Object.fromEntries(["present", "missing", "contradictory", "unknown"].map(key => [key, Number(key === choice)])) }];
    })) };
    change(reply);
    return { ok: true, status: 200, json: async () => reply };
  };
}
const run = (input, fetch, apiKey = "test") => advisor.advise(input, "evidence", { apiKey, fetch });

test("each missing evidence component remains distinguishable from present and contradictory components", async () => {
  for (const field of fields) {
    const input = snapshot(), before = JSON.stringify(input);
    const result = await run(input, transport({ [field]: "missing" }));
    assert.equal(result.status, "REVIEW_REQUIRED");
    assert.deepEqual(result.gaps, [field]);
    assert.equal(result.checks[field].choice, "missing");
    assert.equal(result.checks[fields.find(other => other !== field)].choice, "present");
    assert.deepEqual(result.binding, { spec_sha256: hash(input.spec), context_sha256: hash(input.context), assessment_sha256: hash(input.assessment) });
    assert.equal(result.input_sha256, hash(before));
    assert.equal(JSON.stringify(input), before);
    const contradiction = await run(input, transport({ [field]: "contradictory" }));
    assert.equal(contradiction.checks[field].choice, "contradictory");
    assert.deepEqual(contradiction.gaps, [field]);
  }
});

test("complete-looking advice still requires review; unknown retains partial diagnostics without claiming an explanation", async () => {
  const complete = await run(snapshot(), transport());
  assert.equal(complete.status, "REVIEW_REQUIRED");
  assert.deepEqual(complete.gaps, []);
  assert.equal(complete.authority, "NONE");
  const unknown = await run(snapshot(), transport({ method: "unknown", fixture: "missing" }));
  assert.equal(unknown.status, "NOT_EVALUATED");
  assert.equal(unknown.checks.method.status, "NOT_EVALUATED");
  assert.equal(unknown.checks.fixture.choice, "missing");
  assert.deepEqual(unknown.gaps, ["fixture"]);
});

test("malformed evidence replies fail closed instead of returning plausible diagnostics", async () => {
  for (const change of [
    r => { r.answers.method.choice = "complete"; }, r => { delete r.answers.detector; },
    r => { r.answers.extra = r.answers.method; }, r => { r.model = "foreign"; },
    r => { r.answers.fixture.confidence = NaN; }, r => { r.answers.source.probabilities.present = 0.5; },
    r => { r.answers.method.reason = "Do not enforce admission"; }, r => { r.approved = true; },
  ]) {
    const result = await run(snapshot(), transport({}, change));
    assert.equal(result.status, "NOT_EVALUATED");
    assert.equal(result.checks, undefined);
  }
});

test("invalid or changed frozen snapshots never reach the provider", async () => {
  for (const mutate of [
    i => { i.spec += "changed"; }, i => { i.context += " "; },
    i => { i.assessment = "{"; }, i => { i.approved = true; },
    i => { const a = JSON.parse(i.assessment); a.jev.answers.verification.choice = "easy"; i.assessment = JSON.stringify(a); },
    i => { const a = JSON.parse(i.assessment); a.task.spec = "forged"; i.assessment = JSON.stringify(a); },
  ]) {
    const input = snapshot(); mutate(input);
    let calls = 0;
    const result = await run(input, async () => { calls++; throw Error("unexpected transport"); });
    assert.equal(result.status, "NOT_EVALUATED");
    assert.equal(calls, 0);
  }
});

test("missing credentials, provider failures and oversized evidence never retry or grant authority", async () => {
  let calls = 0;
  const fail = async () => { calls++; throw Error("secret timeout"); };
  assert.equal((await run(snapshot(), fail, "")).status, "NOT_EVALUATED");
  assert.equal(calls, 0);
  const failed = await run(snapshot(), fail);
  assert.equal(failed.status, "NOT_EVALUATED");
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(failed).includes("secret"));
  const http = await run(snapshot(), async () => ({ ok: false, status: 503 }));
  assert.equal(http.status, "NOT_EVALUATED");
  assert.equal(http.request_diagnostics.stage, "http");
  const input = snapshot(); input.request = "x".repeat(64000);
  assert.equal((await run(input, fail)).reason, "SNAPSHOT_TOO_LARGE");
  assert.equal(calls, 1);
});
