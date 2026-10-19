"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const advisor = require("./jev_agent.js");

function fixtureCLI(directory) {
  const local = path.resolve(__dirname, "../skills/delivery/scripts/task-routing.js");
  if (fs.existsSync(local)) return path.resolve(__dirname, "jev_agent.js");
  // These source files also run in an isolated checkout that excludes the machine-local routing module.
  const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".codex", "dely-compliance", "settings.json"), "utf8"));
  const source = fs.readFileSync(path.resolve(__dirname, "jev_agent.js"), "utf8");
  const cli = path.join(directory, "jev-cli.cjs");
  fs.writeFileSync(cli, source.replace('require("../skills/delivery/scripts/task-routing.js")', "require(" + JSON.stringify(settings.routing) + ")")
    .replace('require("../skills/delivery/scripts/usage.js")', "require(" + JSON.stringify(path.join(path.dirname(settings.routing), "usage.js")) + ")"));
  return cli;
}

const context = { request: "Review the weekly cost report code.",
  candidates: [
    { id: "old", path: "legacy.py", source: "print('old')", line_start: 1, line_end: 1, sha256: "a".repeat(64) },
    { id: "cell", path: "report.ipynb", source: "cm = revenue - vcost", cell_id: "cell_real", cell_index: 7,
      line_start: 1, line_end: 1, sha256: "b".repeat(64) },
    { id: "rule", path: "AGENTS.md", source: "Keep provenance.", required: true },
  ] };
const skills = { request: "Diagnose the export bug.", skills: [
  { name: "diagnosing-bugs", path: "skills/diagnosing-bugs/SKILL.md", description: "Diagnosis loop for failing code." },
  { name: "slides", path: "skills/slides/SKILL.md", description: "Build slide presentations." },
] };

function answer(options, choice) {
  return { type: "choice", choice, confidence: 1,
    probabilities: Object.fromEntries(options.map((id) => [id, Number(id === choice)])) };
}
function transport(choices, change = () => {}) {
  return async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer TEST_KEY");
    const sent = JSON.parse(options.body);
    const reply = { model: advisor.MODEL, answers: Object.fromEntries(Object.entries(sent.questions)
      .map(([id, q]) => [id, answer(Object.keys(q.criteria), choices[id])])) };
    change(reply, sent);
    return { ok: true, json: async () => reply };
  };
}
const run = (input, mode, fetch) => advisor.advise(input, mode, { apiKey: "TEST_KEY", fetch });
test("frozen installed advisor preserves safe stages and incomplete skill batches", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "jev-installed-test-"));
  t.after(() => fs.rmSync(home, { recursive: true }));
  require("./codex-compliance.js").install({
    routing: path.resolve(__dirname, "../skills/delivery/scripts/task-routing.js"),
    advisor: require.resolve("./jev_agent.js"),
  }, home);
  const installedPath = path.join(home, "dely-compliance", "jev-advisor.js");
  const source = fs.readFileSync(require.resolve("./jev_agent.js"), "utf8");
  const declaration = 'const ROOT = path.resolve(__dirname, "..");';
  const installedSource = fs.readFileSync(installedPath, "utf8");
  const settings = JSON.parse(fs.readFileSync(path.join(home, "dely-compliance", "settings.json"), "utf8"));
  assert.equal(installedSource, source.replace(declaration,
    "const ROOT = " + JSON.stringify(settings.credential_root) + ";\n"), "installer froze current advisor bytes");
  assert.ok(!installedSource.includes(declaration));
  assert.ok(!fs.existsSync(path.join(home, "skills")), "no checkout dependency beside frozen advisor");
  const installed = require(installedPath);
  const failures = [
    ["transport", "TRANSPORT_ERROR", async () => { throw Error("PRIVATE_SENTINEL"); }],
    ...["AbortError", "TimeoutError"].map((name) => ["timeout", "REQUEST_TIMEOUT", async () => {
      throw Object.assign(Error("PRIVATE_SENTINEL"), { name });
    }]),
    ["http", "HTTP_ERROR", async () => ({ ok: false, status: 429 })],
    ["json", "JSON_DECODE_ERROR", async () => ({ ok: true, status: 200, json: async () => { throw Error("PRIVATE_SENTINEL"); } })],
    ["schema", "SCHEMA_INVALID", async () => ({ ok: true, status: 200, json: async () => ({ model: "PRIVATE_SENTINEL" }) })],
  ];
  for (const api of [advisor, installed]) {
    const call = (input, mode, fetch) => api.advise(input, mode, { apiKey: "TEST_KEY", fetch });
    for (const [input, mode] of [[context, "context"], [skills, "skill"]]) {
      for (const [stage, code, fetch] of failures) {
        const result = await call(input, mode, fetch);
        assert.equal(result.status, "NOT_EVALUATED");
        assert.equal(result.request_diagnostics.stage, stage);
        assert.equal(result.request_diagnostics.code, code);
        assert.equal(result.request_diagnostics.requested_model, advisor.MODEL);
        assert.equal(result.request_diagnostics.http_status, stage === "http" ? 429 : ["json", "schema"].includes(stage) ? 200 : null);
        assert.equal(result.request_diagnostics.provider_model, null);
        assert.ok(result.request_diagnostics.duration_ms >= 0);
        assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
        if (mode === "skill") {
          assert.deepEqual(result.suggestions, []); assert.equal(result.suggestion, null);
        }
      }
      const success = await call(input, mode, transport({ c0: "direct", c1: "direct", c2: "direct", s0: "direct", s1: "direct" }));
      assert.equal(success.status, "REVIEW_REQUIRED");
      assert.equal(success.request_diagnostics.stage, "complete");
      assert.equal(success.request_diagnostics.code, "OK");
      assert.equal(success.request_diagnostics.provider_model, advisor.MODEL);
    }
    const many = { request: skills.request, skills: Array.from({ length: 500 }, (_, i) => ({
      name: "skill-" + i, path: "skills/skill-" + i + "/SKILL.md", description: "documented procedure ".repeat(10),
    })) };
    for (const [stage, code, fail] of failures) {
      let calls = 0;
      const result = await call(many, "skill", async (...args) => ++calls === 2 ? fail(...args) : transport({}, (reply) => {
        for (const answer of Object.values(reply.answers)) {
          answer.choice = "direct";
          for (const key of Object.keys(answer.probabilities)) answer.probabilities[key] = Number(key === "direct");
        }
      })(...args));
      assert.equal(calls, 2);
      assert.equal(result.status, "NOT_EVALUATED");
      assert.deepEqual(result.suggestions, []); assert.equal(result.suggestion, null);
      assert.deepEqual(result.evaluations, []);
      const progress = result.incomplete_batch_progress;
      assert.equal(progress.input_sha256, result.input_sha256);
      assert.equal(progress.batch_index, 1); assert.equal(progress.completed_batches, 1);
      assert.ok(progress.completed_evaluations > 0);
      assert.equal(progress.evaluations.length, progress.completed_evaluations);
      assert.ok(progress.batch_count > 1);
      assert.equal(progress.requests.length, 2);
      assert.equal(progress.requests[0].stage, "complete");
      assert.equal(progress.requests[1].stage, stage); assert.equal(progress.requests[1].code, code);
      assert.equal(progress.requests[1].provider_model, null);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
    }
  }
});
test("both advice modes record bounded request failure stages and no raw provider content", async () => {
  for (const [stage, fetch] of [
    ["transport", async () => { throw Error("PRIVATE_SENTINEL"); }],
    ["timeout", async () => { throw Object.assign(Error("PRIVATE_SENTINEL"), { name: "AbortError" }); }],
    ["http", async () => ({ ok: false, status: 429 })],
    ["json", async () => ({ ok: true, status: 200, json: async () => { throw Error("PRIVATE_SENTINEL"); } })],
    ["schema", async () => ({ ok: true, status: 200, json: async () => ({ model: "PRIVATE_SENTINEL" }) })],
  ]) {
    for (const [input, mode] of [[context, "context"], [skills, "skill"]]) {
      const result = await run(input, mode, fetch);
      assert.equal(result.status, "NOT_EVALUATED");
      assert.equal(result.request_diagnostics.stage, stage);
      assert.equal(result.request_diagnostics.provider_model, null);
      assert.ok(result.request_diagnostics.duration_ms >= 0);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
      if (mode === "skill") {
        assert.deepEqual(result.suggestions, []); assert.equal(result.suggestion, null);
        assert.equal(result.incomplete_batch_progress.completed_batches, 0);
        assert.deepEqual(result.incomplete_batch_progress.evaluations, []);
      }
    }
  }
});

test("context ranks relevant code, pins requirements and retains all original provenance", async () => {
  const before = structuredClone(context);
  const result = await run(context, "context", transport({ c0: "unrelated", c1: "direct", c2: "unknown" }));
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.ranked_context.map((c) => c.id), ["rule", "cell", "old"]);
  for (const original of context.candidates) {
    const ranked = result.ranked_context.find((c) => c.id === original.id);
    for (const [key, value] of Object.entries(original)) assert.deepEqual(ranked[key], value);
  }
  assert.deepEqual(context, before);
});

test("skill suggests supplied records or an empty list, never loads them", async () => {
  const chosen = await run(skills, "skill", transport({ s0: "direct", s1: "unrelated" }));
  assert.deepEqual(chosen.suggestion, skills.skills[0]);
  assert.equal(chosen.status, "REVIEW_REQUIRED");
  assert.deepEqual(chosen.suggestions, [skills.skills[0]]);
  const none = await run(skills, "skill", transport({ s0: "unrelated", s1: "unrelated" }));
  assert.equal(none.suggestion, null);
  assert.deepEqual(none.suggestions, []);
});

test("same skill name at distinct paths remains distinguishable", () => {
  advisor.validateInput({ request: "test", skills: [skills.skills[0],
    { ...skills.skills[0], path: "another/SKILL.md" }] }, "skill");
  assert.throws(() => advisor.validateInput({ request: "test", skills: [skills.skills[0], skills.skills[0]] }, "skill"));
});

test("invalid skill identities and top-level outputs are rejected; empty roster needs no API", async () => {
  for (const bad of [{ ...skills.skills[0], name: "" }, { ...skills.skills[0], name: undefined },
    { ...skills.skills[0], output: "do not send" }]) {
    assert.throws(() => advisor.validateInput({ request: "test", skills: [bad] }, "skill"));
  }
  assert.throws(() => advisor.validateInput({ ...context, outputs: ["do not send"] }, "context"));
  const empty = await advisor.advise({ request: "test", skills: [] }, "skill", {
    fetch: () => assert.fail("No API call"),
  });
  assert.equal(empty.status, "NOT_APPLICABLE");
  assert.equal(empty.suggestion, null);
});

test("missing key does not call API and preserves context order", async () => {
  const result = await advisor.advise(context, "context", {
    apiKey: "", fetch: () => { throw Error("Must not call"); },
  });
  assert.equal(result.status, "NOT_EVALUATED");
  assert.equal(result.reason, "TYPESAFE_API_KEY_MISSING");
  assert.deepEqual(result.ranked_context, context.candidates);
});

test("provider failures retain context and do not leak an exception containing secrets", async () => {
  for (const fetch of [
    async () => ({ ok: false, status: 429 }),
    async () => { throw Error("TEST_SECRET should never be printed"); },
    async () => ({ ok: true, json: async () => { throw Error("TEST_SECRET"); } }),
  ]) {
    const result = await run(context, "context", fetch);
    assert.equal(result.status, "NOT_EVALUATED");
    assert.deepEqual(result.ranked_context, context.candidates);
    assert.ok(!JSON.stringify(result).includes("TEST_SECRET"));
  }
});

test("invalid replies cannot turn into useful advice", async () => {
  const changes = [
    (r) => { r.model = "other"; },
    (r) => { delete r.answers.c1; },
    (r) => { r.answers.extra = r.answers.c0; },
    (r) => { r.answers.c0.choice = "injected"; },
    (r) => { r.answers.c0.probabilities.direct = 0.6; },
    (r) => { r.answers.c0.probabilities.direct = -1; },
    (r) => { r.answers.c0.confidence = null; },
    (r) => { r.answers.c0.type = "noul"; },
    (r) => { r.answers.c0.choice = "direct"; },
  ];
  for (const change of changes) {
    const result = await run(context, "context", transport({ c0: "unrelated", c1: "direct", c2: "unknown" }, change));
    assert.equal(result.status, "NOT_EVALUATED");
    assert.deepEqual(result.ranked_context, context.candidates);
  }
  const skill = await run(skills, "skill", transport({ s0: "direct", s1: "unrelated" }, (r) => { r.answers.s0.choice = "injected"; }));
  assert.equal(skill.status, "NOT_EVALUATED");
  assert.equal(skill.suggestion, null);
});

test("snapshot bound stops before network; output/image fields and missing notebook cell IDs are rejected", async () => {
  const big = { ...context, request: "x".repeat(64000) };
  const result = await advisor.advise(big, "context", { apiKey: "TEST_KEY", fetch: () => assert.fail("No API call") });
  assert.equal(result.reason, "SNAPSHOT_TOO_LARGE");
  for (const bad of [
    { ...context.candidates[0], outputs: ["image"] },
    { ...context.candidates[1], cell_id: null },
    { ...context.candidates[0], line_end: 0 },
    { ...context.candidates[0], sha256: "fake" },
  ]) assert.throws(() => advisor.validateInput({ request: "test", candidates: [bad] }, "context"));
});

test("CLI delegates Hard and review to local policy, rejects downgrade/staleness/overwrite", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "jev-agent-test-"));
  const cli = fixtureCLI(temp);
  const file = (name) => path.join(temp, name);
  const call = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, HOME: temp, USERPROFILE: temp } });
  try {
    fs.writeFileSync(file("spec.md"), "Change agent routing.");
    fs.writeFileSync(file("context.json"), JSON.stringify({
      scope: "internal", coupling: "known", acceptance: "focused checks", evidence: "verified",
      requirements_confirmed: true,
      risks: { security: false, data: false, public_contract: false, architecture: false, production: false, routing: true },
    }));
    assert.equal(call("assess", "--spec-file", file("spec.md"), "--context-file", file("context.json"), "--out", file("a.json")).status, 0);
    const assessment = JSON.parse(fs.readFileSync(file("a.json"), "utf8"));
    assert.equal(assessment.difficulty, "hard");
    assert.equal(assessment.route.workflow, "direct");
    assert.equal(assessment.jev, null);
    const reviewArgs = ["review", "--input", file("a.json"), "--reason", "Source reviewed"];
    assert.equal(call(...reviewArgs, "--difficulty", "easy", "--out", file("bad.json")).status, 2);
    assert.ok(!fs.existsSync(file("bad.json")));
    assert.equal(call(...reviewArgs, "--difficulty", "hard", "--out", file("review.json")).status, 0);
    const saved = fs.readFileSync(file("review.json"));
    assert.equal(call(...reviewArgs, "--difficulty", "hard", "--out", file("review.json")).status, 2);
    assert.deepEqual(fs.readFileSync(file("review.json")), saved);
    fs.appendFileSync(file("spec.md"), " changed");
    assert.equal(call(...reviewArgs, "--difficulty", "hard", "--out", file("stale.json")).status, 2);
    assert.ok(!fs.existsSync(file("stale.json")));
    assert.equal(call("skill", "--unknown", "flag", "--out", file("none.json")).status, 2);
  } finally {
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


test("target workspace controls relative inputs, outputs, credentials and review ownership", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "jev-agent-workspace-"));
  const cli = fixtureCLI(temp);
  const call = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, HOME: temp, USERPROFILE: temp } });
  try {
    fs.writeFileSync(path.join(temp, "spec.md"), "Routing probe.");
    fs.writeFileSync(path.join(temp, "context.json"), JSON.stringify({
      scope: "one area", coupling: "known", acceptance: "checks", evidence: "source",
      requirements_confirmed: true,
      risks: { security: false, data: false, public_contract: false, architecture: false, production: false, routing: true },
    }));
    assert.equal(call("assess", "--repo", temp, "--spec-file", "spec.md", "--context-file", "context.json", "--out", "assessment.json").status, 0);
    const a = JSON.parse(fs.readFileSync(path.join(temp, "assessment.json"), "utf8"));
    assert.equal(a.task.repo, fs.realpathSync(temp));
    assert.equal(call("review", "--repo", temp, "--input", "assessment.json", "--difficulty", "hard", "--reason", "Source checked", "--out", "reviewed.json").status, 0);
    const other = path.join(temp, "other");
    fs.mkdirSync(other);
    const assessmentPath = path.join(temp, "assessment.json");
    assert.equal(call("review", "--repo", other, "--input", assessmentPath, "--difficulty", "hard", "--reason", "Wrong repo", "--out", "wrong.json").status, 2);
    assert.ok(!fs.existsSync(path.join(other, "wrong.json")));
    fs.writeFileSync(path.join(temp, "skills.json"), JSON.stringify({ request: "No skill candidates", skills: [] }));
    assert.equal(call("skill", "--repo", temp, "--input", "skills.json", "--out", "skill.json").status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp, "skill.json"), "utf8")).status, "NOT_APPLICABLE");
  } finally {
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

