"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const advisor = require("./jev_agent.js");

const catalog = (count) => ({ request: "Fix a UI bug, add integration tests and update the agent guide.",
  skills: Array.from({ length: count }, (_, i) => ({ name: "workflow-" + i, path: "skills/workflow-" + i + "/SKILL.md", description: "Documented capability " + i })) });

function provider(input, relations, calls) {
  return async (_, options) => {
    const sent = JSON.parse(options.body);
    calls.push(sent);
    const answers = Object.fromEntries(Object.entries(sent.questions).map(([id, question]) => {
      const ids = Object.keys(question.criteria);
      // The existing single-winner implementation gets a valid reply so the counterexample tests its behavior.
      const choice = id === "skill" ? ids.find((key) => ["direct", "supporting"].includes(relations[key])) || "none" : relations[id] || "unrelated";
      return [id, { type: "choice", choice, confidence: 1,
        probabilities: Object.fromEntries(ids.map((key) => [key, Number(key === choice)])) }];
    }));
    return { ok: true, json: async () => ({ model: advisor.MODEL, answers }) };
  };
}

test("one task receives multiple complementary original skills and keeps uncertainty separate", async () => {
  const input = catalog(5);
  const calls = [];
  const original = JSON.stringify(input);
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(input,
    { s0: "direct", s1: "supporting", s2: "direct", s3: "unrelated", s4: "unknown" }, calls) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.suggestions, [input.skills[0], input.skills[2], input.skills[1]]);
  assert.deepEqual(result.suggestion, result.suggestions[0], "leading-record legacy alias");
  assert.equal(result.evaluations.find((e) => e.id === "s4").relevance, "unknown");
  assert.ok(!result.suggestions.includes(input.skills[4]));
  assert.equal(JSON.stringify(input), original);
  assert.equal(result.input_sha256, crypto.createHash("sha256").update(original).digest("hex"));
});

test("a useful explicit-only skill is suggested with its policy visible without enabling it", async () => {
  const input = catalog(3);
  input.skills[0].allow_implicit_invocation = false;
  input.skills[1].enabled = false;
  const original = JSON.stringify(input);
  const calls = [];
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(input,
    { s0: "direct", s1: "direct", s2: "supporting" }, calls) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(calls.flatMap((packet) => Object.keys(packet.questions)), ["s0", "s2"]);
  assert.deepEqual(result.suggestions, [{ ...input.skills[0], requires_explicit_invocation: true }, input.skills[2]]);
  assert.equal(result.selection.explicit_count, 1);
  assert.equal(result.selection.disabled_count, 1);
  assert.equal(result.selection.evaluated_count, 2);
  assert.equal(JSON.stringify(input), original);
});

test("152 skills share their task rules and fit two requests without a shortlist", async () => {
  const input = catalog(152);
  input.skills.slice(0, 63).forEach((skill) => { skill.allow_implicit_invocation = false; });
  const calls = [];
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(input,
    { s0: "direct", s151: "supporting" }, calls) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(calls.length, 2);
  assert.equal(calls.flatMap((packet) => Object.keys(packet.questions)).length, 152);
  assert.equal(calls[0].state.request, input.request);
  assert.match(calls[0].state.selection_rules, /independently/);
  assert.match(calls[0].state.rubric.supporting, /materially needed/);
  assert.ok(!calls[0].state.skills, "metadata stays in its individual question");
  for (const question of calls.flatMap((packet) => Object.values(packet.questions))) {
    assert.match(question.instructions.question, /state.rubric/);
    assert.deepEqual(question.criteria, { direct: "Primary requested workflow", supporting: "Materially needed complementary workflow",
      unrelated: "Not useful for the requested actions", unknown: "Insufficient task or skill evidence" });
  }
  assert.equal(result.suggestions.length, 2);
  assert.equal(result.selection.explicit_count, 63);
});

test("the shared state plus one UTF-8 question is bounded separately from the whole packet", async () => {
  for (const [request, description] of [["x".repeat(29000), "x".repeat(1000)], ["Task", "界".repeat(10000)]]) {
    const input = catalog(1);
    input.request = request;
    input.skills[0].description = description;
    const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: () => assert.fail("oversized pair must stop before network") });
    assert.equal(result.status, "NOT_EVALUATED");
    assert.equal(result.reason, "SKILL_REQUEST_TOO_LARGE");
  }
});

for (const count of [500, 1000]) {
  test("all " + count + " candidates are independently evaluated without cutting 30 late recommendations", async () => {
    const input = catalog(count);
    const relations = Object.fromEntries(Array.from({ length: 30 }, (_, i) => ["s" + (count - 30 + i), "direct"]));
    const calls = [];
    const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(input, relations, calls) });
    assert.equal(result.status, "REVIEW_REQUIRED");
    assert.deepEqual(result.suggestions, input.skills.slice(count - 30));
    const ids = calls.flatMap((packet) => Object.keys(packet.questions));
    assert.equal(ids.length, count, "each skill is evaluated once rather than eliminated by a shortlist");
    assert.equal(new Set(ids).size, count);
    assert.ok(calls.every((packet) => Buffer.byteLength(JSON.stringify(packet)) <= 60000));
    assert.equal(result.selection.evaluated_count, count);
  });
}

test("zero useful skills is a valid empty list, while a provider failure is unevaluated", async () => {
  const input = catalog(2);
  const none = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(input, {}, []) });
  assert.equal(none.status, "REVIEW_REQUIRED");
  assert.deepEqual(none.suggestions, []);
  assert.equal(none.suggestion, null);
  const failed = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: async () => ({ ok: false, status: 503 }) });
  assert.equal(failed.status, "NOT_EVALUATED");
  assert.deepEqual(failed.suggestions, []);
  assert.equal(failed.suggestion, null);
});

test("two-decimal provider rounding is normalized with its original probabilities retained", async () => {
  const input = catalog(1);
  const raw = { direct: 0.55, supporting: 0.32, unrelated: 0.1, unknown: 0.02 };
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: async () => ({ ok: true, json: async () => ({
    model: advisor.MODEL, answers: { s0: { type: "choice", choice: "direct", confidence: 0.42, probabilities: raw } },
  }) }) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.suggestions, input.skills);
  assert.deepEqual(result.evaluations[0].raw_probabilities, raw);
  assert.ok(Math.abs(Object.values(result.evaluations[0].probabilities).reduce((a, b) => a + b, 0) - 1) < 0.000001);
  assert.equal(result.evaluations[0].confidence, 0.42, "provider confidence is never invented or recalibrated");
});

test("rounding support does not admit arbitrary missing probability mass or a wrong chosen label", async () => {
  for (const probabilities of [
    { direct: 0.55, supporting: 0.1, unrelated: 0.05, unknown: 0.01 },
    { direct: 0.554, supporting: 0.3, unrelated: 0.12, unknown: 0.016 },
    { direct: 0.32, supporting: 0.55, unrelated: 0.1, unknown: 0.02 },
  ]) {
    const result = await advisor.advise(catalog(1), "skill", { apiKey: "TEST_KEY", fetch: async () => ({ ok: true, json: async () => ({
      model: advisor.MODEL, answers: { s0: { type: "choice", choice: "direct", confidence: 0.42, probabilities } },
    }) }) });
    assert.equal(result.status, "NOT_EVALUATED");
    assert.deepEqual(result.suggestions, []);
  }
});

test("an observed low-confidence label conflicting with probabilities remains unevaluated", async () => {
  const result = await advisor.advise(catalog(1), "skill", { apiKey: "TEST_KEY", fetch: async () => ({ ok: true,
    json: async () => ({ model: advisor.MODEL, answers: { s0: { type: "choice", choice: "unknown", confidence: 0.2,
      probabilities: { direct: 0.06, supporting: 0.15, unrelated: 0.4, unknown: 0.39 } } } }) }) });
  assert.equal(result.status, "NOT_EVALUATED");
  assert.deepEqual(result.suggestions, []);
});

test("unknown top-level and answer fields fail before normalization, while documented usage is accepted", async () => {
  const response = () => ({ model: advisor.MODEL, answers: { s0: { type: "choice", choice: "direct", confidence: 0.42,
    probabilities: { direct: 0.55, supporting: 0.32, unrelated: 0.1, unknown: 0.02 } } }, usage: { input_tokens: 100, output_tokens: 20 } });
  const call = (reply) => advisor.advise(catalog(1), "skill", { apiKey: "TEST_KEY", fetch: async () => ({ ok: true, json: async () => reply }) });
  assert.equal((await call(response())).status, "REVIEW_REQUIRED");
  const top = response(); top.extra = 1;
  const answer = response(); answer.answers.s0.extra = "unexpected";
  const reserved = response(); reserved.answers.s0.raw_probabilities = { injected: 1 };
  for (const invalid of [top, answer, reserved]) {
    const result = await call(invalid);
    assert.equal(result.status, "NOT_EVALUATED");
    assert.deepEqual(result.suggestions, []);
  }
});
