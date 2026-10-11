"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const routing = require("../skills/delivery/scripts/task-routing.js");

const root = path.resolve(__dirname, "../.tmp-dely", "routing-tests-" + process.pid);
fs.mkdirSync(root, { recursive: true });
after(() => {
  const resolved = fs.realpathSync(root);
  const workspace = fs.realpathSync(path.resolve(__dirname, ".."));
  assert.ok(resolved.startsWith(workspace + path.sep) && path.basename(resolved).startsWith("routing-tests-"));
  fs.rmSync(resolved, { recursive: true, force: true });
});
let counter = 0;
function task(change = {}) {
  const repo = path.join(root, String(++counter));
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "spec.md"), "Correct the private helper's empty-input branch; preserve its callers and public behavior.");
  const context = { scope: "One private helper in helper.js", coupling: "Known internal caller only",
    acceptance: "Existing empty-input regression must reject the previous wrong value",
    evidence: "helper.js and its caller/test inspected", requirements_confirmed: true,
    risks: Object.fromEntries(routing.RISK_KEYS.map((key) => [key, false])), ...change };
  fs.writeFileSync(path.join(repo, "context.json"), JSON.stringify(context));
  return routing.loadTask(repo, "spec.md", "context.json");
}

function answer(label, confidence = 1) {
  return { type: "choice", choice: label, confidence,
    probabilities: Object.fromEntries(["hard", "insufficient_evidence", "medium_plus", "medium_minus", "easy"].map((key) => [key, key === label ? 1 : 0])) };
}
function result(changes = {}) {
  return { model: routing.MODEL, answers: Object.fromEntries(Object.keys(routing.questions()).map((name) => [name, answer(changes[name] || "easy")])),
    usage: { input_tokens: 500, output_tokens: 0 } };
}
const mock = (body) => ({ apiKey: "test-key", fetch: async () => ({ ok: true, json: async () => body }) });
function approvedFile(record) {
  const file = path.join(record.task.repo, "assessment.json");
  fs.writeFileSync(file, JSON.stringify(record));
  return file;
}
const flags = (record) => ({ repo: record.task.repo, "spec-file": "spec.md", "assessment-file": approvedFile(record) });

test("verified missing-model route is Luna/max for every delegated grade, never Hard", () => {
  for (const difficulty of ["easy", "medium_minus", "medium_plus"]) {
    const assessment = { difficulty, route: routing.route(difficulty) };
    routing.verifyUnavailablePin(assessment, { agent: "codex", model: "gpt-6-luna", effort: "max" });
    assert.throws(() => routing.verifyUnavailablePin(assessment, { agent: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" }));
    assert.throws(() => routing.verifyUnavailablePin(assessment, { agent: "codex", model: "gpt-6-luna", effort: "default" }));
  }
  assert.throws(() => routing.verifyUnavailablePin({ difficulty: "hard", route: routing.route("hard") },
    { agent: "codex", model: "gpt-6-luna", effort: "max" }));
});

test("Jev client sends the documented HTTP wire format and exact model", async () => {
  let request;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    request = { method: req.method, path: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const t = task();
    const assessed = await routing.assess(t, { apiKey: "test-key", fetch: (url, options) => {
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.ok(options.signal instanceof AbortSignal);
      return fetch("http://127.0.0.1:" + server.address().port + "/v1/systemone", options);
    } });
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/v1/systemone");
    assert.equal(request.auth, "Bearer test-key");
    assert.equal(request.body.model, routing.MODEL);
    assert.equal(request.body.state.spec, t.spec);
    assert.equal(Object.keys(request.body.questions).length, 5);
    assert.equal(assessed.status, "REVIEW_REQUIRED");
    assert.equal(assessed.difficulty, "easy");
  } finally { server.close(); await once(server, "close"); }
});

test("Easy and Medium- start Flash, Medium+ starts Sonnet, Hard bypasses Dely", async () => {
  const easy = await routing.assess(task(), mock(result()));
  const minus = await routing.assess(task(), mock(result({ scope: "medium_minus" })));
  const plus = await routing.assess(task(), mock(result({ scope: "medium_minus", coordination: "medium_plus" })));
  const hard = await routing.assess(task(), mock(result({ risk: "hard" })));
  for (const a of [easy, minus]) {
    assert.equal(a.route.primary.model, "gemini-3.8-flash-medium");
    assert.equal(routing.selectedPhase(a, {}), "implement_backup");
  }
  assert.equal(minus.difficulty, "medium_minus");
  assert.equal(plus.difficulty, "medium_plus");
  assert.equal(plus.route.primary.model, "claude-sonnet-5-5-high");
  assert.equal(routing.selectedPhase(plus, {}), "implement");
  for (const a of [easy, minus, plus]) {
    assert.deepEqual(a.route.fallback, [{ harness: "codex", model: "gpt-6-luna", effort: "max" }]);
    assert.equal(routing.selectedPhase(a, { fallback: "quota" }), "implement_backup_2");
  }
  assert.equal(hard.route.workflow, "direct");
  assert.deepEqual(hard.route.primary, { harness: "codex", model: "gpt-6.1-sol", effort: "xhigh" });
  assert.throws(() => routing.review(hard, "medium_plus", "Only one line"), /higher-risk/);
  assert.throws(() => routing.review(plus, "medium_minus", "Small diff"), /higher-risk/);
  assert.throws(() => routing.route("medium"), /Invalid difficulty/);
});

test("known security/data exclusions cannot be cleared by Jev or Control", async () => {
  for (const key of routing.RISK_KEYS) {
    const t = task({ risks: { [key]: true } });
    const assessed = await routing.assess(t, { apiKey: "test-key", fetch: async () => { assert.fail("Hard risk must not call Jev"); } });
    assert.equal(assessed.status, "DIRECT_CODEX");
    assert.equal(assessed.difficulty, "hard");
    assert.throws(() => routing.review(assessed, "easy", "Small edit"), /missing evidence|Hard exclusion/);
    assert.throws(() => routing.requireApprovedRoute(flags(assessed)), /HARD_DIRECT_CODEX/);
  }
});

test("missing, null, numeric and string risk flags stay unknown and never call Jev", async () => {
  for (const risks of [{}, { security: null }, { security: 0 }, { security: "false" }]) {
    const assessed = await routing.assess(task({ risks }), { apiKey: "test-key", fetch: async () => assert.fail("Missing evidence must not call Jev") });
    assert.equal(assessed.status, "NOT_EVALUATED");
    assert.equal(assessed.route, null);
    assert.throws(() => routing.review(assessed, "medium_plus", "Probably safe"), /missing evidence/);
  }
});

test("Jev abstention is retained and cannot become an approved AGY task", async () => {
  const assessed = await routing.assess(task(), mock(result({ verification: "insufficient_evidence" })));
  assert.equal(assessed.status, "NOT_EVALUATED");
  assert.equal(assessed.difficulty, null);
  assert.throws(() => routing.review(assessed, "easy", "Looks fine"), /missing evidence/);
});

test("missing key, auth, rate limit and overload do not choose an implementation route", async () => {
  const t = task();
  const noKey = await routing.assess(t, { apiKey: "", fetch: async () => assert.fail("No key means no API call") });
  assert.equal(noKey.status, "NOT_EVALUATED");
  assert.equal(noKey.route, null);
  for (const status of [401, 429, 529]) {
    let calls = 0;
    const assessed = await routing.assess(t, { apiKey: "test-key", fetch: async () => { calls++; return { ok: false, status }; } });
    assert.equal(calls, 1);
    assert.equal(assessed.status, "NOT_EVALUATED");
    assert.equal(assessed.route, null);
  }
});

test("timeout and malformed answers fail without exposing API exception text", async () => {
  const bad = result();
  bad.answers.risk.probabilities.hard = 0.5;
  const wrongModel = { ...result(), model: "unexpected-model" };
  const wrongType = result(); wrongType.answers.risk.type = "score";
  for (const body of [bad, wrongModel, wrongType, { model: routing.MODEL, answers: {} }]) {
    const assessed = await routing.assess(task(), mock(body));
    assert.equal(assessed.status, "NOT_EVALUATED");
    assert.equal(assessed.route, null);
  }
  const assessed = await routing.assess(task(), { apiKey: "test-key", fetch: async () => { throw new Error("secret-key-in-upstream-error"); } });
  assert.equal(assessed.status, "NOT_EVALUATED");
  assert.ok(!JSON.stringify(assessed).includes("secret-key-in-upstream-error"));
});

test("flat probabilities require Control review without inventing a confidence threshold", async () => {
  const body = result();
  for (const a of Object.values(body.answers)) { a.confidence = 0; a.probabilities = { hard: 0.2, insufficient_evidence: 0.2, medium_plus: 0.2, medium_minus: 0.2, easy: 0.2 }; }
  const assessed = await routing.assess(task(), mock(body));
  assert.equal(assessed.status, "REVIEW_REQUIRED");
  assert.throws(() => routing.requireApprovedRoute(flags(assessed)), /must review/);
  const reviewed = routing.review(assessed, "easy", "Inspected helper/caller/regression; all policy gates hold");
  assert.equal(reviewed.review.confidence_threshold, "NOT_EVALUATED");
});

test("stale spec/context and modified snapshots are rejected before dispatch", async () => {
  for (const name of ["spec.md", "context.json"]) {
    const approved = routing.review(await routing.assess(task(), mock(result())), "easy", "Source and acceptance inspected");
    const f = flags(approved);
    fs.appendFileSync(path.join(approved.task.repo, name), " ");
    assert.throws(() => routing.requireApprovedRoute(f), /stale/);
  }
  const approved = routing.review(await routing.assess(task(), mock(result())), "easy", "Source and acceptance inspected");
  approved.task.context.risks.security = true;
  assert.throws(() => routing.requireApprovedRoute(flags(approved)), /snapshot was modified/);
});

test("approval cannot be reused for a different repo/spec or a modified route", async () => {
  const approved = routing.review(await routing.assess(task(), mock(result())), "easy", "Source and acceptance inspected");
  const f = flags(approved);
  fs.writeFileSync(path.join(approved.task.repo, "another.md"), approved.task.spec);
  assert.throws(() => routing.requireApprovedRoute({ ...f, "spec-file": "another.md" }), /another repo or spec/);
  approved.route.primary.model = "different-model";
  assert.throws(() => routing.requireApprovedRoute(flags(approved)), /route does not match/);
});

test("quota is the only fallback trigger and no delegated grade advances beyond Luna", async () => {
  for (const difficulty of ["easy", "medium_minus", "medium_plus"]) {
    const approved = routing.review(await routing.assess(task(), mock(result({ scope: difficulty }))), difficulty, "Internal scope and acceptance reviewed");
    const f = flags(approved);
    assert.equal(routing.requireApprovedRoute(f).difficulty, difficulty);
    const quota = { ...f, fallback: "quota" };
    assert.equal(routing.selectedPin(routing.requireApprovedRoute(quota), quota).model, "gpt-6-luna");
    assert.throws(() => routing.requireApprovedRoute({ ...quota, "fallback-stage": "2" }), /No such fallback/);
    for (const fallback of ["auth", "timeout", "unknown"]) assert.throws(() => routing.requireApprovedRoute({ ...f, fallback }), /Only explicit/);
    assert.throws(() => routing.requireApprovedRoute({ ...f, "fallback-stage": "1" }), /requires/);
  }
});

test("assessments under the previous policy cannot launch or be silently regraded", async () => {
  const approved = routing.review(await routing.assess(task(), mock(result())), "easy", "Source inspected");
  approved.policy = "jev-task-routing-v1";
  assert.throws(() => routing.requireApprovedRoute(flags(approved)), /unsupported task assessment/);
  assert.throws(() => routing.review(approved, "medium_minus", "Reuse old classification"), /unsupported task assessment/);
});

test("explicit Control fallback retains missing Jev evaluation, never masquerades as a model result", async () => {
  const assessed = await routing.assess(task(), { apiKey: "" });
  const approved = routing.review(assessed, "medium_plus", "Control inspected the bounded internal integration and agreed acceptance");
  assert.equal(approved.jev, null);
  assert.equal(approved.review.source, "control-evidence");
  assert.equal(routing.requireApprovedRoute(flags(approved)).difficulty, "medium_plus");
});

test("large staged prompts keep their full hash and can be explicitly reviewed without truncating Jev input", async () => {
  const initial = task();
  const spec = "Preserve this exact worker handoff.\n" + "source evidence\n".repeat(10000);
  fs.writeFileSync(initial.spec_file, spec);
  const t = routing.loadTask(initial.repo, "spec.md", "context.json");
  assert.equal(t.spec, spec);
  const assessed = await routing.assess(t, { apiKey: "test-key", fetch: async () => assert.fail("Do not silently truncate a large task into Jev") });
  assert.equal(assessed.status, "NOT_EVALUATED");
  const approved = routing.review(assessed, "easy", "Control inspected the full staged prompt and all effects");
  assert.equal(routing.requireApprovedRoute(flags(approved)).task.spec, spec);
});

test("workspace .env supplies the key without loading unrelated variables or exposing the key", async () => {
  const t = task();
  const oldKey = process.env.TYPESAFE_API_KEY;
  try {
    delete process.env.TYPESAFE_API_KEY;
    fs.writeFileSync(path.join(t.repo, ".env"), '# Credentials\nTYPESAFE_API_KEY="dotenv-fixture-key"\nJEV_UNRELATED_FIXTURE=ignored\n');
    let auth;
    const assessed = await routing.assess(t, { fetch: async (_url, options) => {
      auth = options.headers.Authorization;
      return { ok: true, json: async () => result() };
    } });
    assert.equal(auth, "Bearer dotenv-fixture-key");
    assert.equal(assessed.status, "REVIEW_REQUIRED");
    assert.equal(process.env.JEV_UNRELATED_FIXTURE, undefined);
    assert.ok(!JSON.stringify(assessed).includes("dotenv-fixture-key"));
  } finally {
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = oldKey;
  }
});

test("an explicit credential root supplies routing advice without copying its key", async () => {
  const t = task();
  const credentialRoot = task().repo;
  const oldKey = process.env.TYPESAFE_API_KEY;
  try {
    delete process.env.TYPESAFE_API_KEY;
    fs.writeFileSync(path.join(credentialRoot, ".env"), "TYPESAFE_API_KEY=original-root-fixture-key\n");
    const assessed = await routing.assess(t, { credentialRoot, fetch: async (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer original-root-fixture-key");
      return { ok: true, json: async () => result() };
    } });
    assert.equal(assessed.status, "REVIEW_REQUIRED");
    assert.ok(!JSON.stringify(assessed).includes("original-root-fixture-key"));
    assert.equal(fs.existsSync(path.join(t.repo, ".env")), false);
  } finally {
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = oldKey;
  }
});

test("an explicit process key takes precedence over .env", async () => {
  const t = task();
  const oldKey = process.env.TYPESAFE_API_KEY;
  try {
    process.env.TYPESAFE_API_KEY = "process-fixture-key";
    fs.writeFileSync(path.join(t.repo, ".env"), "TYPESAFE_API_KEY=dotenv-fixture-key\n");
    await routing.assess(t, { fetch: async (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer process-fixture-key");
      return { ok: true, json: async () => result() };
    } });
  } finally {
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = oldKey;
  }
});
