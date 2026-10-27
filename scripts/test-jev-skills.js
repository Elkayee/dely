"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const advisor = require("./jev_agent.js");
const skillReply = require("./fixtures/jev-skill-reply.js");

function catalog(count, descriptionSize = 200) {
  return { request: "Diagnose a failing export and trace the cause.", skills: Array.from({ length: count }, (_, i) => ({
    name: "skill-" + i, path: "skills/skill-" + i + "/SKILL.md",
    description: "Capability " + i + ": " + "documented procedure ".repeat(descriptionSize / 20),
    body: "Documented test instructions.",
  })) };
}

function provider(input, target, calls, chooseNone = false) {
  return async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(options.redirect, "error");
    assert.ok(Buffer.byteLength(options.body) <= 60000, "bounded request bytes");
    const sent = JSON.parse(options.body);
    assert.equal(sent.state.request, input.request);
    assert.ok(!sent.state.skills, "catalog metadata is never duplicated in state");
    const ids = Object.keys(sent.questions.which.criteria);
    for (const id of ids) {
      const skill = input.skills[Number(id.slice(1))];
      const detail = sent.questions.which.criteria[id];
      assert.equal(detail.name, skill.name);
      assert.equal(detail.description, skill.description);
    }
    calls.push(ids);
    return { ok: true, json: async () => ({ model: advisor.MODEL, answers: skillReply(sent, { target, fits: chooseNone ? 0.1 : 0.8 }) }) };
  };
}

for (const [count, size] of [[106, 400], [500, 200], [1000, 200]]) {
  test("full " + count + "-skill catalog is ranked with late candidates selectable", async () => {
    const input = catalog(count, size);
    const before = JSON.stringify(input);
    const calls = [];
    const target = "s" + (count - 1);
    const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(input, target, calls) });
    assert.equal(result.status, "REVIEW_REQUIRED");
    assert.deepEqual(result.suggestion, input.skills[count - 1], "late candidates must be selectable");
    assert.equal(JSON.stringify(input), before, "original catalog is never pruned or mutated");
    assert.equal(result.input_sha256, crypto.createHash("sha256").update(before).digest("hex"));
    const seen = new Set(calls.flat().filter((id) => id !== "none"));
    assert.equal(seen.size, count, "every catalog entry reaches the provider");
    assert.ok(calls.length > 1, "must not truncate to one provider call");
    assert.ok(calls.at(-1).includes(target), "last packet contains the late target");
    assert.equal(result.selection.catalog_count, count);
    assert.equal(result.selection.evaluated_count, count);
    assert.equal(result.selection.requests, calls.length);
  });
}

test("a large catalog can return no useful skills after every candidate is evaluated", async () => {
  const input = catalog(500);
  const calls = [];
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(input, "s499", calls, true) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.suggestion, null);
  assert.equal(new Set(calls.flat().filter((id) => id !== "none")).size, 500);
});

test("enabled explicit-only metadata is evaluated while disabled skills stay unevaluated", async () => {
  const input = catalog(3);
  input.skills[0].allow_implicit_invocation = false;
  input.skills[1].enabled = false;
  const calls = [];
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: provider(input, "s2", calls) });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.suggestion, input.skills[2]);
    assert.deepEqual(calls, [["s0", "s2"], ["s2", "s0"]]);
  assert.equal(input.skills.length, 3);
  assert.equal(result.selection.catalog_count, 3);
  assert.equal(result.selection.eligible_count, 2);
  assert.equal(result.selection.evaluated_count, 2);
  assert.equal(result.evaluations.find((e) => e.id === "s1").relevance, "NOT_EVALUATED");
});

test("home discovery reads metadata, nested skills and policies without returning instruction bodies or sibling skills", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "jev-catalog-test-"));
  t.after(() => { assert.ok(fs.realpathSync(temp).startsWith(fs.realpathSync(os.tmpdir()) + path.sep)); fs.rmSync(temp, { recursive: true }); });
  const root = path.join(temp, ".agents", "skills");
  const home = path.join(temp, "codex-home");
  const put = (relative, text) => { const file = path.join(temp, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  put(".agents/skills/plain/SKILL.md", '---\nname: plain\ndescription: "Diagnose bugs: inspect the cause."\n---\nPRIVATE_INSTRUCTION_BODY\n');
  put(".agents/skills/nested/leaf/SKILL.md", "---\nname: 'leaf'\ndescription: >-\n  First line\n  second line\n---\nPRIVATE_INSTRUCTION_BODY\n");
  put(".agents/skills/nested/leaf/agents/openai.yaml", "policy:\n  allow_implicit_invocation: false\n");
  const disabled = put(".agents/skills/disabled/SKILL.md", "---\nname: disabled\ndescription: |\n  First line\n  second line\n---\nPRIVATE_INSTRUCTION_BODY\n");
  put("codex-home/config.toml", "[[skills.config]]\npath = " + JSON.stringify(disabled) + "\nenabled = false\n");
  put(".codex/skills/foreign/SKILL.md", "---\nname: foreign\ndescription: Must not be returned.\n---\n");
  const records = advisor.discoverSkills(root, home);
  assert.equal(records.length, 3);
  assert.ok(records.every((skill) => skill.path.startsWith(root + path.sep)));
  assert.equal(records.find((s) => s.name === "plain").description, "Diagnose bugs: inspect the cause.");
  assert.equal(records.find((s) => s.name === "leaf").description, "First line second line");
  assert.equal(records.find((s) => s.name === "leaf").allow_implicit_invocation, false);
  assert.equal(records.find((s) => s.name === "disabled").enabled, false);
  assert.equal(records.find((s) => s.name === "disabled").description, "First line\nsecond line\n");
  assert.ok(!JSON.stringify(records).includes("PRIVATE_INSTRUCTION_BODY"));
  put(".agents/skills/plain/agents/openai.yaml", "policy:\n  allow_implicit_invocation: yes\n");
  assert.throws(() => advisor.discoverSkills(root, home), /Invalid skill invocation policy/);
});

test("oversized metadata and non-shrinking ranking chunks fail closed", async () => {
  const huge = catalog(1);
  huge.skills[0].description = "x".repeat(32000);
  const oversized = await advisor.advise(huge, "skill", { apiKey: "TEST_KEY", fetch: () => assert.fail("must not call") });
  assert.equal(oversized.status, "NOT_EVALUATED");
  assert.equal(oversized.suggestion, null);
  const bulky = catalog(4);
  bulky.skills.forEach((skill) => { skill.description = "x".repeat(16000); });
  const calls = [];
  const result = await advisor.advise(bulky, "skill", { apiKey: "TEST_KEY", fetch: provider(bulky, "s3", calls) });
  assert.equal(result.status, "NOT_EVALUATED");
  assert.equal(result.reason, "SKILL_REQUEST_TOO_LARGE");
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.selection.evaluated_count, 4);
  assert.equal(calls.length, 4, "the bounded Choices cannot compare these oversized descriptions");
});

test("later batch failures and malformed answers invalidate the entire skill decision without exposing secrets", async () => {
  const input = catalog(500);
  const calls = [];
  const valid = provider(input, "s499", calls);
  let requests = 0;
  const result = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: async (...args) => {
    if (++requests === 2) return { ok: false, status: 429 };
    return valid(...args);
  } });
  assert.equal(result.status, "NOT_EVALUATED");
  assert.equal(result.reason, "JEV_HTTP_429");
  assert.equal(result.suggestion, null);
  assert.ok(result.selection.evaluated_count < 500);
  const invalid = await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch: async () => ({ ok: true, json: async () => { throw Error("SECRET_VALUE"); } }) });
  assert.equal(invalid.status, "NOT_EVALUATED");
  assert.ok(!JSON.stringify(invalid).includes("SECRET_VALUE"));
});
