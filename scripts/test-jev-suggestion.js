"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const advisor = require("./jev_agent.js");

function roster(t, count = 5) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-suggestion-"));
  t.after(() => {
    assert.ok(fs.realpathSync(dir).startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { request: "Author a PowerPoint deck using the firm template.", skills: Array.from({ length: count }, (_, i) => {
    const file = path.join(dir, "skill-" + i, "SKILL.md");
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, "---\nname: skill-" + i + "\ndescription: Full capability " + i + "\n---\n" + "Instructions ".repeat(100) + i);
    return { name: "skill-" + i, description: "Index capability " + i, path: file };
  }) };
}

function provider(calls, { gate = [0.9, 0.9, 0.1], fits = 0.8, corrupt, target = "s4", winner = "s3" } = {}) {
  return async (_, options) => {
    const packet = JSON.parse(options.body);
    calls.push(packet);
    const answers = Object.fromEntries(Object.entries(packet.questions).map(([id, q]) => {
      if (q.type === "noul") return [id, { type: "noul", noul: id.startsWith("fits::") ?
        (typeof fits === "number" ? fits : fits[id.slice(6)]) : gate[["gate::acts_on_user_system", "gate::would_follow_documented_procedure", "gate::prose_suffices"].indexOf(id)] }];
      const ids = Object.keys(q.criteria);
      // Give the old independent evaluator valid replies so failure is behavioral.
      if (ids.includes("direct")) return [id, { type: "choice", choice: "direct", confidence: 1,
        probabilities: Object.fromEntries(ids.map((key) => [key, Number(key === "direct")])) }];
      const detailed = Object.keys(packet.questions).some((key) => key.startsWith("fits::"));
      const choice = (detailed ? winner : target);
      const selected = ids.includes(choice) ? choice : ids.at(-1);
      const ranked = [...new Set([selected, winner, ...ids].filter((key) => ids.includes(key)))].slice(0, 3);
      const weights = [0.6, 0.3, 0.1].slice(0, ranked.length), mass = weights.reduce((a, b) => a + b);
      return [id, { type: "choice", choice: selected, confidence: 1,
        probabilities: Object.fromEntries(ids.map((key) => [key, detailed ? Number(key === selected) :
          (ranked.includes(key) ? weights[ranked.indexOf(key)] / mass : 0)])) }];
    }));
    const reply = { model: advisor.MODEL, answers };
    if (corrupt) corrupt(reply, packet, calls.length);
    return { ok: true, status: 200, json: async () => reply };
  };
}

test("rank the full roster, then rerank only three detailed candidates and suggest one original record", async (t) => {
  const input = roster(t), before = JSON.stringify(input), calls = [];
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(calls) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(calls.length, 2, "wide rank and detailed verification are separate requests");
  assert.equal(Object.keys(calls[0].questions.which.criteria).length, 5);
  assert.equal(Object.values(calls[0].questions).filter((q) => q.type === "noul").length, 3);
  assert.equal(Object.keys(calls[1].questions.which.criteria).length, 3);
  assert.equal(Object.keys(calls[1].questions).filter((id) => id.startsWith("fits::")).length, 3);
  assert.ok(JSON.stringify(calls[1]).includes("Full capability"));
  assert.ok(!JSON.stringify(calls).includes(path.dirname(input.skills[0].path)), "paths remain local");
  assert.deepEqual(result.suggestions, [input.skills[3]], "detailed Choice may correct the first-ranked skill");
  assert.deepEqual(result.suggestion, result.suggestions[0]);
  assert.equal(JSON.stringify(input), before);
});

test("request gates invert prose_suffices and can stop before opening any skill", async (t) => {
  const input = roster(t), calls = [];
  input.skills.forEach((s) => { s.path += ".missing"; });
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(calls, { gate: [0.1, 0.1, 0.9] }) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(calls.length, 1);
  assert.ok(Math.abs(result.selection.gate_score - 0.1) < 1e-10);
  assert.deepEqual(result.suggestions, []);
  assert.match(result.suggestion_block, /No skill in the roster appears relevant/);
});

test("only the top three files are opened and body excerpts stop at 700 characters", async (t) => {
  const input = roster(t), calls = [];
  for (const i of [1, 2]) fs.unlinkSync(input.skills[i].path);
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(calls) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(Object.keys(calls[1].questions.which.criteria), ["s4", "s3", "s0"]);
  for (const detail of Object.values(calls[1].questions.which.criteria)) {
    assert.equal(Array.from(detail.body).length, 700);
    assert.ok(!detail.body.includes("description:"), "excerpt excludes frontmatter");
  }
});

test("absolute fits reject the shortlist but Choice, rather than highest fit, selects a passing winner", async (t) => {
  const input = roster(t);
  for (const [fits, expected] of [[0.29, []], [0.30, [input.skills[3]]], [{ s4: 0.9, s3: 0.4, s0: 0.1 }, [input.skills[3]]]]) {
    const calls = [];
    const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(calls, { fits }) });
    assert.equal(result.status, "REVIEW_REQUIRED");
    assert.deepEqual(result.suggestions, expected);
    assert.equal(calls.length, 2);
  }
});

test("disabled and explicit-only policy and duplicate skill names preserve original identity", async (t) => {
  const input = roster(t), calls = [];
  input.skills[1].enabled = false;
  input.skills[3].allow_implicit_invocation = false;
  input.skills[3].name = input.skills[4].name;
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(calls) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.suggestions, [{ ...input.skills[3], requires_explicit_invocation: true }]);
  assert.equal(result.selection.explicit_count, 1);
  assert.equal(result.selection.disabled_count, 1);
  assert.equal(result.evaluations.find((e) => e.id === "s1").reason, "DISABLED");
  assert.ok(calls.every((p) => !Object.hasOwn(p.questions.which.criteria, "s1")));
});

test("invalid Noul values, missing or extra answers and incorrect Choice labels fail without partial suggestions", async (t) => {
  const input = roster(t);
  for (const corrupt of [
    ...[-0.1, 1.1, "0.8", null].map((value) => (r) => { r.answers["gate::prose_suffices"].noul = value; }),
    (r) => { delete r.answers["gate::prose_suffices"]; },
    (r) => { r.answers.extra = { type: "noul", noul: 0.8 }; },
    (r) => { r.answers.which.choice = "s9000"; },
    (r) => { r.answers.which.probabilities.s4 = 0; },
  ]) {
    const calls = [];
    const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(calls, { corrupt }) });
    assert.equal(result.status, "NOT_EVALUATED");
    assert.deepEqual(result.suggestions, []);
    assert.equal(result.suggestion, null);
    assert.equal(calls.length, 1);
    assert.equal(result.request_diagnostics.code, "SCHEMA_INVALID");
  }
});

test("failure of the detailed request retains validated wide evidence without a recommendation or retry", async (t) => {
  const input = roster(t), calls = [];
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(calls, {
    corrupt: (r, _, n) => { if (n === 2) r.answers["fits::s4"].noul = "PRIVATE_SENTINEL"; },
  }) });
  assert.equal(calls.length, 2);
  assert.equal(result.status, "NOT_EVALUATED");
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.passes[0].request_diagnostics.stage, "complete");
  assert.ok(result.passes[0].answers.which);
  assert.ok(!result.passes[1].answers);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
});

test("missing shortlisted details fail safely; supplied cookbook details support a self-contained roster", async (t) => {
  const input = roster(t), calls = [];
  input.skills.forEach((s) => { s.path += ".missing"; });
  const missing = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(calls) });
  assert.equal(missing.reason, "SKILL_DETAILS_UNAVAILABLE");
  assert.equal(calls.length, 1);
  for (const s of input.skills) Object.assign(s, { description_full: "Full supplied description", body: "😀".repeat(800) });
  calls.length = 0;
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(calls) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(Array.from(calls[1].questions.which.criteria.s4.body).length, 700);
  assert.equal(calls[1].questions.which.criteria.s4.description, "Full supplied description");
});

test("a roster exceeding one Choice is ranked in bounded chunks without dropping late candidates", async (t) => {
  const input = roster(t, 1000), calls = [];
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(calls, { target: "s999", winner: "s999" }) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.suggestions, [input.skills[999]]);
  assert.equal(new Set(calls.flatMap((p) => Object.keys(p.questions.which.criteria))).size, 1000);
  assert.ok(calls.every((p) => Object.keys(p.questions.which.criteria).length <= 255));
  assert.equal(result.selection.evaluated_count, 1000);
  assert.equal(result.selection.requests, calls.length);
  assert.equal(calls.filter((p) => Object.keys(p.questions).some((id) => id.startsWith("fits::"))).length, 1);
});

test("suggestion block is advisory and never replaces mandatory skill selection", () => {
  assert.match(advisor.suggestionBlock([{ name: "slides" }]), /Ignore this if it does not fit/);
  assert.match(advisor.suggestionBlock([]), /No skill in the roster appears relevant/);
});
