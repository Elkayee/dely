"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { spawnSync } = require("node:child_process");
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
test("request diagnostics distinguish safe failure stages without retaining provider secrets", async () => {
  const secret = "PRIVATE_SENTINEL_BODY_TOKEN";
  const cases = [
    ["transport", "TRANSPORT_ERROR", async () => { throw Error(secret); }],
    ["timeout", "REQUEST_TIMEOUT", async () => { throw Object.assign(Error(secret), { name: "TimeoutError" }); }],
    ["http", "HTTP_ERROR", async () => ({ ok: false, status: 503, body: secret })],
    ["json", "JSON_DECODE_ERROR", async () => ({ ok: true, status: 200, json: async () => { throw Error(secret); } })],
    ["schema", "SCHEMA_INVALID", async () => ({ ok: true, status: 200, json: async () => ({ model: secret }) })],
  ];
  for (const [stage, code, fetch] of cases) {
    const record = await routing.assess(task(), { apiKey: "test-key", fetch });
    assert.equal(record.status, "NOT_EVALUATED");
    assert.equal(record.request_diagnostics.stage, stage);
    assert.equal(record.request_diagnostics.code, code);
    assert.equal(record.request_diagnostics.requested_model, routing.MODEL);
    assert.equal(record.request_diagnostics.provider_model, null);
    assert.ok(record.request_diagnostics.duration_ms >= 0);
    assert.equal(record.request_diagnostics.http_status, ["http", "json", "schema"].includes(stage) ? (stage === "http" ? 503 : 200) : null);
    assert.doesNotMatch(JSON.stringify(record), /PRIVATE_SENTINEL/);
  }
});
test("success telemetry validates the provider model and does not change routing basis", async () => {
  const reply = result();
  reply.body = "PRIVATE_SENTINEL"; reply.usage = { secret: "PRIVATE_SENTINEL" };
  reply.answers.scope.message = "PRIVATE_SENTINEL";
  const record = await routing.assess(task(), mock(reply));
  assert.equal(record.request_diagnostics.stage, "complete");
  assert.equal(record.request_diagnostics.provider_model, routing.MODEL);
  assert.equal(record.request_diagnostics.http_status, null, "mock did not measure a status");
  const basis = routing.deriveAssessmentBasis(record);
  assert.deepEqual(routing.deriveAssessmentBasis({ ...record, request_diagnostics: null }), basis);
  assert.doesNotMatch(JSON.stringify(record), /PRIVATE_SENTINEL/);
});
function approvedFile(record) {
  const file = path.join(record.task.repo, "assessment.json");
  fs.writeFileSync(file, JSON.stringify(record));
  return file;
}
const flags = (record) => ({ repo: record.task.repo, "spec-file": "spec.md", "assessment-file": approvedFile(record) });

function proof(assessment, dimension = "verification") {
  return { schema_version: 1, assessment_basis_sha256: assessment.assessment_basis_sha256, dimension,
    reason_code: dimension === "verification" ? "verification_instrument_available" : "routine_coordination_only",
    explanation: "The frozen helper/caller evidence provides a focused empty-input regression; routine delivery steps do not add component ownership.",
    evidence_refs: [{ source: "context", field: "acceptance" }, { source: "spec", excerpt: "empty-input branch" }],
    acceptance: { method: "existing_regression", procedure: "Run the empty-input regression against the known internal caller",
      expected_result: "The caller receives the specified empty value", would_fail_if: "Returning the previous wrong value fails the regression" },
    ...(dimension === "coordination" ? { coordination_facts: { changed_boundary: "One private helper owned by the internal module",
      callers_callees: "The known internal caller keeps its contract", counted_routine_steps: ["planning", "control_review"],
      integration_obligations: "Run the caller regression in the same boundary; no separate owner handoff" } } : {}) };
}

test("case06-case11 exhaustive Max Rank and candidate eligibility across all 3125 vectors", () => {
  const t = task();
  const labels = ["easy", "medium_minus", "medium_plus", "hard", "insufficient_evidence"];
  const rank = ["easy", "medium_minus", "medium_plus", "hard"];
  for (let index = 0; index < 3125; index++) {
    let n = index;
    const choices = routing.DIMENSIONS.map(() => { const choice = labels[n % 5]; n = Math.floor(n / 5); return choice; });
    const jev = result(Object.fromEntries(routing.DIMENSIONS.map((name, i) => [name, choices[i]])));
    const expected = choices.includes("insufficient_evidence") ? null : rank[Math.max(...choices.map((choice) => rank.indexOf(choice)))];
    assert.equal(routing.rawDifficulty(jev.answers), expected);
    const high = choices.flatMap((choice, i) => choice === "medium_plus" ? [routing.DIMENSIONS[i]] : []);
    const eligible = expected === "medium_plus" && high.length === 1 && ["verification", "coordination"].includes(high[0]);
    const candidate = routing.findCorrectionCandidate({ task: t, jev });
    assert.equal(candidate?.dimension || null, eligible ? high[0] : null);
  }
});

for (const dimension of ["verification", "coordination"]) {
  test("case09-case14/case23 " + dimension + " correction is explicit, bound, raw-preserving and repeatable", async () => {
    const raw = await routing.assess(task(), mock(result({ [dimension]: "medium_plus" })));
    const before = JSON.stringify(raw);
    assert.equal(raw.advisor_state, "EVALUATED");
    assert.equal(raw.jev_difficulty, "medium_plus");
    assert.equal(raw.correction_candidate.dimension, dimension);
    assert.equal(routing.review(raw, "medium_plus", "The integrated burden remains").route.primary.model, "gpt-6.1-sol");
    assert.throws(() => routing.review(raw, "medium_minus", "Just a short change"), /higher-risk/);
    const p = proof(raw, dimension);
    const approved = routing.review(raw, "medium_minus", "Control checked the frozen instrument and boundaries", { correction: p });
    assert.equal(approved.difficulty, "medium_minus");
    assert.equal(approved.route.primary.model, "gemini-3.8-flash-medium");
    assert.equal(approved.review.source, "control-override-justified");
    assert.deepEqual(approved.jev, raw.jev);
    assert.equal(JSON.stringify(raw), before);
    const frozen = JSON.stringify(approved);
    const f = flags(approved);
    for (let i = 0; i < 3; i++) {
      assert.equal(routing.validateApprovedAssessment(approved, raw), approved);
      assert.deepEqual(routing.requireApprovedRoute(f), approved);
    }
    assert.equal(JSON.stringify(approved), frozen);
    p.explanation = "Changed caller object";
    assert.notEqual(approved.review.correction.proof.explanation, p.explanation);
  });
}

test("case03-case07 known Hard, unknown facts and every low-confidence raw Hard veto correction", async () => {
  for (const dimension of routing.DIMENSIONS) {
    const body = result({ [dimension]: "hard" });
    body.answers[dimension].confidence = 0;
    const assessed = await routing.assess(task(), mock(body));
    assert.equal(assessed.jev_difficulty, "hard");
    assert.equal(assessed.correction_candidate, null);
    assert.throws(() => routing.review(assessed, "medium_minus", "Low confidence", { correction: proof(assessed) }));
    assert.throws(() => routing.review(assessed, "medium_plus", "Only one Hard"), /higher-risk/);
  }
  const incomplete = await routing.assess(task({ requirements_confirmed: false }), mock(result()));
  assert.equal(incomplete.status, "NOT_EVALUATED");
  assert.equal(incomplete.jev_difficulty, null);
  const both = await routing.assess(task(), mock(result({ risk: "hard", verification: "insufficient_evidence" })));
  assert.equal(both.status, "NOT_EVALUATED");
  assert.equal(both.advisor_state, "EVALUATED");
  assert.equal(both.jev_difficulty, null);
  assert.throws(() => routing.review(both, "medium_minus", "Ignore abstention", { correction: proof(both) }));
  assert.throws(() => routing.review(both, "medium_plus", "Ignore abstention"), /missing evidence/);
  assert.equal(routing.review(both, "hard", "Retain the raw Hard veto").route.workflow, "direct");
});

test("case15-case17/case19 correction rejects malformed schema, missing detector, external refs and wrong requested level", async () => {
  const raw = await routing.assess(task(), mock(result({ verification: "medium_plus" })));
  const invalid = [
    null, { ...proof(raw), dimension: "scope" }, { ...proof(raw), reason_code: "routine_coordination_only" },
    { ...proof(raw), overall: "medium_minus" }, { ...proof(raw), schema_version: 2 },
    { ...proof(raw), coordination_facts: {} }, { ...proof(raw), explanation: " " },
    { ...proof(raw), evidence_refs: [] }, { ...proof(raw), evidence_refs: [{ source: "context", field: "risks" }] },
    { ...proof(raw), evidence_refs: [{ source: "spec", excerpt: "not in this snapshot" }] },
    { ...proof(raw), evidence_refs: [{ source: "file", path: raw.task.spec_file }] },
    { ...proof(raw), evidence_refs: [{ source: "url", url: "https://example.invalid/proof" }] },
    ...["method", "procedure", "expected_result", "would_fail_if"].map((key) => ({ ...proof(raw), acceptance: { ...proof(raw).acceptance, [key]: "" } })),
    { ...proof(raw), explanation: "x".repeat(8193) },
  ];
  for (const p of invalid) assert.throws(() => routing.review(raw, "medium_minus", "Control reason", { correction: p }));
  for (const difficulty of ["easy", "medium_plus", "hard"]) {
    assert.throws(() => routing.review(raw, difficulty, "Wrong requested level", { correction: proof(raw) }));
  }
  assert.throws(() => routing.parseReviewEvidence("{"));
  assert.throws(() => routing.parseReviewEvidence("[]"));
  assert.throws(() => routing.parseReviewEvidence(" ".repeat(8193)));
  const coordination = await routing.assess(task(), mock(result({ coordination: "medium_plus" })));
  for (const facts of [undefined, {}, { ...proof(coordination, "coordination").coordination_facts, counted_routine_steps: [] }]) {
    assert.throws(() => routing.review(coordination, "medium_minus", "Missing facts", { correction: { ...proof(coordination, "coordination"), coordination_facts: facts } }));
  }
});

test("case21-case22 original Jev, candidate, basis and approved correction tampering fail closed", async () => {
  const raw = await routing.assess(task(), mock(result({ verification: "medium_plus" })));
  const approved = routing.review(raw, "medium_minus", "Known instrument checked", { correction: proof(raw) });
  const mutations = [
    (a) => { a.jev.answers.verification.choice = "medium_minus"; },
    (a) => { a.jev.model = "different"; },
    (a) => { a.jev.answers.scope.confidence = 0.1; },
    (a) => { a.jev = null; },
    (a) => { a.advisor_state = "NOT_EVALUATED"; },
    (a) => { a.correction_candidate.dimension = "coordination"; },
    (a) => { a.review.correction.proof.explanation += " altered"; },
    (a) => { a.review.correction.effective_labels.scope = "medium_plus"; },
    (a) => { a.review.correction.from = "hard"; },
    (a) => { a.review.correction.to = "easy"; },
    (a) => { a.review.source = "control-evidence"; },
    (a) => { a.review.correction_sha256 = "0".repeat(64); },
    (a) => { a.review.correction.proof.assessment_basis_sha256 = "0".repeat(64); },
  ];
  for (const mutate of mutations) {
    const altered = structuredClone(approved);
    mutate(altered);
    assert.throws(() => routing.validateApprovedAssessment(altered, raw));
  }
  const erased = await routing.assess(raw.task, { apiKey: "" });
  assert.throws(() => routing.validateOriginalAssessment(erased, raw), /frozen original/);
  const other = await routing.assess(task(), mock(result({ verification: "medium_plus" })));
  assert.throws(() => routing.review(other, "medium_minus", "Reused proof", { correction: proof(raw) }), /different assessment basis/);
});

test("canonical basis uses stable JSON keys, ordered arrays and only finite JSON values", async () => {
  assert.equal(routing.canonicalJson({ b: 1, a: [2, 1] }), '{"a":[2,1],"b":1}');
  const cycle = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, 1n, cycle, new Date(), [undefined], new Array(1), { x: () => {} }]) {
    assert.throws(() => routing.canonicalJson(value));
  }
  const raw = await routing.assess(task(), mock(result({ verification: "medium_plus" })));
  const approved = routing.review(raw, "medium_minus", "Known instrument checked", { correction: proof(raw) });
  const reverse = (v) => Array.isArray(v) ? v.map(reverse) : v && typeof v === "object" ?
    Object.fromEntries(Object.entries(v).reverse().map(([k, entry]) => [k, reverse(entry)])) : v;
  assert.equal(routing.validateApprovedAssessment(reverse(approved)).assessment_basis_sha256, raw.assessment_basis_sha256);
});

test("case08/case11/case18 scope, design, risk and integrated verification retain Sol without a valid exception", async () => {
  for (const changes of [{ scope: "medium_plus" }, { uncertainty: "medium_plus" }, { risk: "medium_plus" },
    { verification: "medium_plus", coordination: "medium_plus" }]) {
    const raw = await routing.assess(task(), mock(result(changes)));
    assert.equal(raw.correction_candidate, null);
    assert.throws(() => routing.review(raw, "medium_minus", "Small scope", { correction: proof(raw) }));
    assert.equal(routing.review(raw, "medium_plus", "Integrated detector/dependencies still require Sol").route.primary.model, "gpt-6.1-sol");
  }
});

test("case15/case21 extra or missing answer dimensions are invalid responses, never low routes", async () => {
  for (const mutate of [(body) => { body.answers.extra = answer("easy"); }, (body) => { delete body.answers.scope; }]) {
    const body = result(); mutate(body);
    const raw = await routing.assess(task(), mock(body));
    assert.equal(raw.status, "NOT_EVALUATED");
    assert.equal(raw.advisor_state, "NOT_EVALUATED");
    assert.equal(raw.jev, null);
    assert.equal(raw.route, null);
  }
});

test("case32 router and Jev CLI review accept optional proof and reject malformed evidence", async () => {
  for (const script of ["skills/delivery/scripts/task-routing.js", "scripts/jev_agent.js"]) {
    for (const correction of [false, true]) {
      const raw = await routing.assess(task(), mock(result(correction ? { verification: "medium_plus" } : {})));
      const input = approvedFile(raw), output = path.join(raw.task.repo, "reviewed.json");
      const args = [path.resolve(__dirname, "..", script), "review",
        ...(script.includes("jev_agent") ? ["--repo", raw.task.repo, "--input", input] : ["--assessment-file", input]),
        "--difficulty", correction ? "medium_minus" : "easy", "--reason", "Control checked the frozen detector", "--out", output];
      const p = JSON.stringify(proof(raw));
      fs.mkdirSync(path.join(raw.task.repo, ".dely"));
      const childOptions = { cwd: path.resolve(__dirname, ".."), encoding: "utf8",
        env: { ...process.env, HOME: raw.task.repo, USERPROFILE: raw.task.repo } };
      const run = spawnSync(process.execPath, correction ? [...args, "--review-evidence-json", p] : args,
        childOptions);
      assert.equal(run.status, 0, run.stderr);
      const approved = JSON.parse(fs.readFileSync(output, "utf8"));
      routing.validateApprovedAssessment(approved, raw);
      assert.equal(approved.review.source, correction ? "control-override-justified" : "jev-and-control");
      fs.unlinkSync(output);
      for (const invalid of ["{", "[]", " ".repeat(8193)]) {
        const rejected = spawnSync(process.execPath, [...args, "--review-evidence-json", invalid],
          childOptions);
        assert.equal(rejected.status, 2);
        assert.equal(fs.existsSync(output), false);
      }
    }
  }
});

test("correction journal contains raw/final grades and hashes without proof bodies", async () => {
  const raw = await routing.assess(task(), mock(result({ verification: "medium_plus" })));
  const approved = routing.review(raw, "medium_minus", "Control detector checked", { correction: proof(raw) });
  const journal = path.join(raw.task.repo, "journal.jsonl");
  const usage = require("../skills/delivery/scripts/usage.js");
  usage.recordTask(raw, "assess", journal);
  usage.recordTask(approved, "review", journal);
  const bytes = fs.readFileSync(journal, "utf8"), rows = bytes.trim().split("\n").map(JSON.parse);
  assert.equal(rows[0].taskKey, rows[1].taskKey);
  assert.equal(rows[1].jev_difficulty, "medium_plus");
  assert.equal(rows[1].difficulty, "medium_minus");
  assert.equal(rows[1].assessment_basis_sha256, raw.assessment_basis_sha256);
  assert.equal(rows[1].correction_sha256, approved.review.correction_sha256);
  assert.equal(rows[1].decision_source, "control-override-justified");
  assert.equal(rows[1].correction_reason_code, "verification_instrument_available");
  assert.ok(!bytes.includes(approved.review.correction.proof.explanation));
  assert.ok(!bytes.includes(raw.task.spec));
});

test("case38 equivalent effects keep their route when the repository is named All_Data", async () => {
  const source = task();
  for (const name of ["ordinary-project", "All_Data"]) {
    const repo = path.join(source.repo, name);
    fs.mkdirSync(repo);
    fs.copyFileSync(source.spec_file, path.join(repo, "spec.md"));
    fs.copyFileSync(source.context_file, path.join(repo, "context.json"));
    const raw = await routing.assess(routing.loadTask(repo, "spec.md", "context.json"), mock(result({ scope: "medium_minus" })));
    assert.equal(raw.difficulty, "medium_minus");
    assert.equal(raw.route.primary.model, "gemini-3.8-flash-medium");
    const context = { ...source.context, risks: { ...source.context.risks, data: true } };
    fs.writeFileSync(path.join(repo, "context.json"), JSON.stringify(context));
    const consequential = await routing.assess(routing.loadTask(repo, "spec.md", "context.json"), {
      apiKey: "fixture", fetch: async () => assert.fail("A known data effect must veto before Jev") });
    assert.equal(consequential.difficulty, "hard");
  }
});

test("verified missing-model route is Luna/max only for Easy and Medium-", () => {
  for (const difficulty of ["easy", "medium_minus"]) {
    const assessment = { difficulty, route: routing.route(difficulty) };
    routing.verifyUnavailablePin(assessment, { agent: "codex", model: "gpt-6-luna", effort: "max" });
    assert.throws(() => routing.verifyUnavailablePin(assessment, { agent: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" }));
    assert.throws(() => routing.verifyUnavailablePin(assessment, { agent: "codex", model: "gpt-6-luna", effort: "default" }));
  }
  for (const difficulty of ["medium_plus", "hard"]) {
    const assessment = { difficulty, route: routing.route(difficulty) };
    assert.throws(() => routing.verifyUnavailablePin(assessment,
      { agent: "codex", model: "gpt-6-luna", effort: "max" }));
  }
});

test("final Medium+ and Hard retain Sol primary with an empty fallback chain", () => {
  for (const difficulty of ["medium_plus", "hard"]) {
    const assessment = { difficulty, route: routing.route(difficulty) };
    assert.deepEqual(assessment.route.fallback, []);
    assert.equal(assessment.route.modelUnavailable, undefined);
    assert.equal(routing.selectedPin(assessment, {}).model, "gpt-6.1-sol");
    assert.throws(() => routing.selectedPin(assessment, { fallback: "quota" }), /No such fallback/);
    assert.throws(() => routing.selectedPin(assessment, { fallback: "quota", "fallback-stage": "1" }), /No such fallback/);
  }
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

test("Easy and Medium- start Flash, Medium+ starts Sol/medium, Hard bypasses Dely", async () => {
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
  assert.deepEqual(plus.route.primary, { harness: "codex", model: "gpt-6.1-sol", effort: "medium" });
  routing.verifyPin(plus, { agent: "codex", model: "gpt-6.1-sol", effort: "medium" }, {});
  for (const pin of [
    { agent: "antigravity", model: "claude-sonnet-5-5-high", effort: "default" },
    { agent: "codex", model: "gpt-6.1-sol", effort: "high" },
    { agent: "codex", model: "gpt-6-luna", effort: "max" },
  ]) assert.throws(() => routing.verifyPin(plus, pin, {}), /reviewed difficulty route/);
  assert.equal(routing.selectedPhase(plus, {}), "implement");
  for (const a of [easy, minus]) {
    assert.deepEqual(a.route.fallback, [{ harness: "codex", model: "gpt-6-luna", effort: "max" }]);
    assert.equal(routing.selectedPhase(a, { fallback: "quota" }), "implement_backup_2");
  }
  assert.deepEqual(plus.route.fallback, []);
  assert.throws(() => routing.selectedPhase(plus, { fallback: "quota" }), /No such fallback/);
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

test("read-only semantics and leaf permissions retain consequential risk; metadata never selects a worker", async () => {
  for (const [flag, effect] of [["data", "Read-only reporting changes null to zero or the accounting timezone"],
    ["security", "One isolated leaf changes the caller permission check"]]) {
    const t = task({ scope: effect, domain: "ui_frontend", blast_radius: "isolated_leaf",
      risks: { ...Object.fromEntries(routing.RISK_KEYS.map((key) => [key, false])), [flag]: true } });
    const assessed = await routing.assess(t, mock(result()));
    assert.equal(assessed.difficulty, "hard");
    assert.equal(assessed.route.primary.model, "gpt-6.1-sol");
    assert.equal(assessed.jev, null);
  }
  for (const domain of ["ui_frontend", "backend_api", "data_pipeline", "other", "invalid", null]) {
    const assessed = await routing.assess(task({ domain, blast_radius: "isolated_leaf" }), mock(result({ scope: "medium_plus" })));
    assert.equal(assessed.difficulty, "medium_plus");
    assert.equal(routing.review(assessed, "medium_plus", "Frozen evidence retains the raw scope grade").route.primary.model, "gpt-6.1-sol");
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

test("quota is the only fallback trigger for low grades; Medium+ has none", async () => {
  for (const difficulty of ["easy", "medium_minus", "medium_plus"]) {
    const approved = routing.review(await routing.assess(task(), mock(result({ scope: difficulty }))), difficulty, "Internal scope and acceptance reviewed");
    const f = flags(approved);
    assert.equal(routing.requireApprovedRoute(f).difficulty, difficulty);
    const quota = { ...f, fallback: "quota" };
    if (difficulty === "medium_plus") assert.throws(() => routing.requireApprovedRoute(quota), /No such fallback/);
    else assert.equal(routing.selectedPin(routing.requireApprovedRoute(quota), quota).model, "gpt-6-luna");
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
