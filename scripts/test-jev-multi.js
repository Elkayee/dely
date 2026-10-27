"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const advisor = require("./jev_agent.js");
const skillReply = require("./fixtures/jev-skill-reply.js");

const catalog = (count) => ({ request: "Fix the export bug using the documented workflow.",
  skills: Array.from({ length: count }, (_, i) => ({ name: "workflow-" + i,
    path: "skills/workflow-" + i + "/SKILL.md", description: "Documented capability " + i, body: "Test instructions." })) });
function provider(change = () => {}) {
  return async (_, options) => {
    const packet = JSON.parse(options.body);
    const reply = { model: advisor.MODEL, answers: skillReply(packet) };
    change(reply, packet);
    return { ok: true, status: 200, json: async () => reply };
  };
}

test("a failed ranking packet retains validated evidence without a partial recommendation", async () => {
  const input = catalog(500);
  let calls = 0;
  const valid = provider();
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: async (...args) => {
    if (++calls === 2) return { ok: true, status: 200, json: async () => ({ model: "PRIVATE_SENTINEL", answers: "PRIVATE_SENTINEL" }) };
    return valid(...args);
  } });
  assert.equal(result.status, "NOT_EVALUATED");
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.suggestion, null);
  assert.deepEqual(result.evaluations, []);
  assert.equal(result.passes.length, 2);
  assert.equal(result.passes[0].request_diagnostics.stage, "complete");
  assert.equal(result.passes[1].request_diagnostics.stage, "schema");
  assert.ok(result.passes[0].answers.which);
  assert.ok(!result.passes[1].answers);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
});

test("two-decimal Choice rounding retains raw probabilities and unchanged confidence", async () => {
  const raw = { s0: 0.55, s1: 0.32, s2: 0.1, s3: 0.02 };
  const result = await advisor.advise(catalog(4), "skill", { apiKey: "TEST_KEY", fetch: provider((r, p) => {
    if (!p.questions["fits::s0"]) Object.assign(r.answers.which, { probabilities: raw, confidence: 0.42 });
  }) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.suggestions.length, 1);
  const answer = result.passes[0].answers.which;
  assert.deepEqual(answer.raw_probabilities, raw);
  assert.ok(Math.abs(Object.values(answer.probabilities).reduce((a, b) => a + b, 0) - 1) < 0.000001);
  assert.equal(answer.confidence, 0.42);
});

test("rounding rejects missing mass, a zero distribution and a mismatched selected label", async () => {
  for (const probabilities of [
    { s0: 0.55, s1: 0.1, s2: 0.05, s3: 0.01 },
    { s0: 0.554, s1: 0.3, s2: 0.12, s3: 0.016 },
    { s0: 0.32, s1: 0.55, s2: 0.1, s3: 0.02 },
  ]) {
    const result = await advisor.advise(catalog(4), "skill", { apiKey: "TEST_KEY", fetch: provider((r) => {
      r.answers.which.probabilities = probabilities;
    }) });
    assert.equal(result.status, "NOT_EVALUATED");
    assert.deepEqual(result.suggestions, []);
  }
  const zero = await advisor.advise(catalog(255), "skill", { apiKey: "TEST_KEY", fetch: provider((r) => {
    for (const id of Object.keys(r.answers.which.probabilities)) r.answers.which.probabilities[id] = 0;
  }) });
  assert.equal(zero.status, "NOT_EVALUATED");
});

test("unknown response fields fail while documented usage is accepted", async () => {
  const valid = await advisor.advise(catalog(4), "skill", { apiKey: "TEST_KEY", fetch: provider((r) => {
    r.usage = { input_tokens: 200, output_tokens: 50 };
  }) });
  assert.equal(valid.status, "REVIEW_REQUIRED");
  for (const change of [
    (r) => { r.reasoning = "PRIVATE_SENTINEL"; },
    (r) => { r.answers.which.reasoning = "PRIVATE_SENTINEL"; },
    (r) => { r.answers.which.raw_probabilities = r.answers.which.probabilities; },
  ]) {
    const invalid = await advisor.advise(catalog(4), "skill", { apiKey: "TEST_KEY", fetch: provider(change) });
    assert.equal(invalid.status, "NOT_EVALUATED");
    assert.doesNotMatch(JSON.stringify(invalid), /PRIVATE_SENTINEL/);
  }
});

test("shared state plus each UTF-8 question remains bounded before the network", async () => {
  for (const [request, description] of [["x".repeat(29000), "x".repeat(1000)], ["Task", "界".repeat(10000)]]) {
    const input = catalog(1);
    input.request = request;
    input.skills[0].description = description;
    const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: () => assert.fail("must not call") });
    assert.equal(result.reason, "SKILL_REQUEST_TOO_LARGE");
  }
});
