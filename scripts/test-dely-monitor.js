"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { summarize, jsonLines, collect, readRuntimes } = require("./dely-monitor-data.js");
const { createMonitor } = require("./dely-monitor.js");
const { taskKey, taskMetadata, runtimeFingerprint, recordTask } = require("../skills/delivery/scripts/usage.js");
const ts = "2026-10-09T01:00:00Z", repo = "D:/project";
const specHash = "a".repeat(64), contextHash = "b".repeat(64), basis = "c".repeat(64);
const key = taskKey(repo, specHash, contextHash);
const approval = { event: "task_assessment", taskKey: key, ts, repo,
  policy: "jev-task-routing-v4", reviewer: "codex-control", decision_source: "jev-reviewed", assessment_basis_sha256: basis,
  status: "APPROVED", difficulty: "medium_minus", workflow: "dely",
  primary: { harness: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" } };
const route = { event: "task_route", run: "run-one", ts, repo, policy: approval.policy, difficulty: "medium_minus",
  specSha256: specHash, contextSha256: contextHash, assessmentBasisSha256: basis, reviewSource: approval.decision_source };
const launch = { event: "dispatch", run: "run-one", ts, repo, dispatchId: "first", phase: "implement",
  promptSha256: specHash, contextSha256: contextHash, assessmentBasisSha256: basis,
  launch: { requested: { model: "gemini-3.8-flash-medium" }, effective: { agent: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" } } };

const reviewed = { ...approval, reviewed_at: ts, decision_sha256: "d".repeat(64), correction_candidate: "coordination" };
const later = "2026-10-10T01:00:00Z", last = "2026-10-11T01:00:00Z";
const control = { event: "task_control_result", ts: later, reviewed_at: later, reviewer: "codex-control",
  verdict: "accepted", run: launch.run, dispatchId: launch.dispatchId, policy: approval.policy,
  taskKey: key, assessment_basis_sha256: basis, evidence_sha256: "e".repeat(64) };
const metrics = (events, options = {}) => summarize(events, [], [], options).metrics;

test("independent decision cohorts deduplicate bases and keep missing and contradictory effective reviews pending", () => {
  const m = metrics([reviewed, reviewed, { ...reviewed, ts: later }]);
  assert.equal(m.lowTierPrimaryCompliance.denominator, 1);
  assert.equal(m.correctionUtilization.denominator, 1);
  assert.equal(m.correctionUtilization.numerator, 0);
  const mismatch = { ...reviewed, primary: { harness: "codex", model: "gpt-6-luna", effort: "max" } };
  assert.equal(metrics([mismatch]).lowTierPrimaryCompliance.rate, 0);
  const unknown = metrics([approval]);
  assert.equal(unknown.lowTierPrimaryCompliance.pending, 1);
  assert.equal(unknown.lowTierPrimaryCompliance.rate, null);
  assert.equal(unknown.decisionEvidenceCoverage.missingEffectiveEvents, 1);
  const contradiction = { ...reviewed, decision_sha256: "f".repeat(64), difficulty: "medium_plus" };
  for (const rows of [[reviewed, contradiction], [contradiction, reviewed]]) {
    assert.equal(metrics(rows).correctionUtilization.pending, 1);
    assert.equal(summarize([...rows, route, launch], [], []).coverage.bound, 0);
  }
  const correction = { ...reviewed, ts: later, reviewed_at: later, decision_sha256: "f".repeat(64),
    decision_source: "control-override-justified", correction_sha256: "a".repeat(64) };
  assert.equal(metrics([reviewed, correction], { asOf: Date.parse(later) }).correctionUtilization.rate, 1);
  assert.equal(metrics([reviewed, correction], { asOf: Date.parse(ts) + 1 }).correctionUtilization.rate, 0);
  const retained = { ...correction, difficulty: "medium_plus", decision_source: "jev-and-control", correction_sha256: null };
  assert.equal(metrics([reviewed, retained]).correctionUtilization.rate, 0);
  const repeatedSnapshot = metrics([reviewed, { ...reviewed, assessment_basis_sha256: "a".repeat(64) }]);
  assert.equal(repeatedSnapshot.lowTierPrimaryCompliance.denominator, 1);
  assert.equal(repeatedSnapshot.correctionUtilization.denominator, 2);
});

test("Control acceptance is bound to dispatch evidence, effective at as_of and independent of worker done", () => {
  const base = [reviewed, route, launch];
  assert.equal(metrics([...base, { ...control, event: "worker_done" }]).agyAcceptedWithoutFallback.status, "NOT_EVALUATED");
  for (const patch of [{ reviewer: "worker" }, { evidence_sha256: null }, { run: "other" },
    { assessment_basis_sha256: "f".repeat(64) }, { reviewed_at: null }]) {
    const m = metrics([...base, { ...control, ...patch }]).agyAcceptedWithoutFallback;
    assert.equal(m.rate, null); assert.equal(m.pending, 1);
  }
  assert.equal(metrics([...base, control, control]).agyAcceptedWithoutFallback.rate, 1);
  const rejection = { ...control, ts: last, reviewed_at: last, verdict: "rejected" };
  assert.equal(metrics([...base, control, rejection], { asOf: Date.parse(later) }).agyAcceptedWithoutFallback.rate, 1);
  assert.equal(metrics([...base, rejection, control]).agyAcceptedWithoutFallback.rate, 0);
  assert.equal(metrics([...base, control, { ...control, verdict: "rejected" }]).agyAcceptedWithoutFallback.pending, 1);
  assert.equal(metrics([...base, control, { ...control, ts: last, reviewed_at: last, evidence_sha256: null }]).agyAcceptedWithoutFallback.pending, 1);
  const fallback = { ...launch, ts: last, dispatchId: "fallback", fallbackReason: "quota", fallbackStage: 1,
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  assert.equal(metrics([...base, control, fallback], { asOf: Date.parse(later) }).agyAcceptedWithoutFallback.rate, 1);
  assert.equal(metrics([...base, control, fallback]).agyAcceptedWithoutFallback.rate, 0);
  const retry = { ...fallback, fallbackReason: null, fallbackStage: null };
  const retryAcceptance = { ...control, dispatchId: retry.dispatchId, ts: last, reviewed_at: last };
  assert.equal(metrics([...base, control, retry, retryAcceptance]).agyAcceptedWithoutFallback.rate, 0);
  assert.equal(metrics([...base, control, { ...control, reviewed_at: null, verdict: "rejected" }]).agyAcceptedWithoutFallback.pending, 1);
});

test("malformed snapshot identities and undated contradictory decisions remain coverage", () => {
  for (const patch of [{ policy: null }, { policy: {} }, { policy: " " }, { taskKey: null }, { taskKey: {} }]) {
    const m = metrics([{ ...reviewed, ...patch }]);
    assert.equal(m.lowTierPrimaryCompliance.denominator, 0);
    assert.equal(m.correctionUtilization.denominator, 0);
    assert.equal(m.decisionEvidenceCoverage.invalidIdentityEvents, 1);
  }
  const undated = { ...reviewed, reviewed_at: null, difficulty: "medium_plus", decision_sha256: "f".repeat(64) };
  for (const rows of [[reviewed, undated], [undated, reviewed]]) {
    assert.equal(metrics(rows).correctionUtilization.pending, 1);
    assert.equal(summarize([...rows, route, launch], [], []).coverage.bound, 0);
  }
  assert.equal(metrics([{ ...reviewed, primary: null }]).lowTierPrimaryCompliance.pending, 1);
});

test("reference audits require evidence, deduplicate case/basis and preserve conflicts and absence", () => {
  const system = { ...reviewed, difficulty: "medium_plus", workflow: "dely" };
  const audit = { ...control, event: "task_reference_audit", case_id: "synthetic-case", reference_difficulty: "easy" };
  assert.equal(metrics([system]).upwardLeakage.status, "NOT_EVALUATED");
  assert.equal(metrics([system, audit, audit]).upwardLeakage.rate, 1);
  assert.equal(metrics([system, { ...audit, evidence_sha256: null }]).upwardLeakage.pending, 1);
  assert.equal(metrics([system, audit, { ...audit, reference_difficulty: "hard" }]).upwardLeakage.pending, 1);
  const laterAudit = { ...audit, ts: last, reviewed_at: last, reference_difficulty: "hard" };
  assert.equal(metrics([system, laterAudit, audit]).upwardLeakage.denominator, 0);
  assert.equal(metrics([system, laterAudit, audit], { asOf: Date.parse(later) + 1 }).upwardLeakage.denominator, 1);
  assert.equal(metrics([system, audit], { asOf: Date.parse(ts) + 1 }).upwardLeakage.rate, null);
  assert.equal(metrics([system, { ...audit, taskKey: "foreign" }]).upwardLeakage.rate, null);
  assert.equal(metrics([system, { ...audit, taskKey: "foreign" }]).upwardLeakage.coverage.unboundEvents, 1);
  assert.equal(metrics([{ ...system, reviewed_at: null }, audit]).upwardLeakage.pending, 1);
});

test("network fallback requires validated transport binding and a low-tier stage-one self-bound decision", () => {
  const evidence = { source: "orca_adapter", code: "ECONNRESET", operation: "repo add",
    specSha256: specHash, contextSha256: contextHash, assessmentBasisSha256: basis,
    noWorkerCreated: true, submissionAttempted: false, failed: true };
  const fallback = { ...launch, dispatchId: "network", ts: later, fallbackReason: "network", fallbackStage: 1,
    networkEvidence: evidence, launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  assert.equal(metrics([reviewed, route, launch, fallback]).lunaFallback.rate, 1);
  for (const patch of [{ networkEvidence: null }, { fallbackStage: 0 },
    { networkEvidence: { ...evidence, contextSha256: "f".repeat(64) } },
    { networkEvidence: { ...evidence, code: "TIMEOUT" } },
    { networkEvidence: { ...evidence, noWorkerCreated: false, inactive: true, failed: true } }]) {
    assert.equal(metrics([reviewed, route, launch, { ...fallback, ...patch }]).lunaFallback.rate, 0);
  }
  const reconciled = { ...evidence, noWorkerCreated: false, submissionAttempted: true, dispatchId: "failed-agy",
    inactive: true, failed: true, released: true };
  assert.equal(metrics([reviewed, route, launch, { ...fallback, networkEvidence: reconciled }]).lunaFallback.rate, 1);
  assert.equal(metrics([reviewed, route, launch, { ...fallback, networkEvidence: { ...reconciled, released: false } }]).lunaFallback.rate, 0);
});

test("new runtime fingerprints include the helper hash without fabricating it in history", () => {
  const runtime = runtimeFingerprint();
  assert.match(runtime.network, /^[a-f0-9]{64}$/);
  const events = [{ ...reviewed, runtime }, route, { ...launch, runtime }];
  assert.equal(summarize(events, [], [], { runtimes: [{ verified: true, fingerprint: runtime }] }).runtimeCohorts[0].verification, "VERIFIED");
  const { network, ...historical } = runtime;
  assert.equal(summarize(events, [], [], { runtimes: [{ verified: true, fingerprint: historical }] }).runtimeCohorts[0].verification, "NOT_EVALUATED");
  const old = summarize([{ ...reviewed, runtime: historical }, route, { ...launch, runtime: historical }], [], []);
  assert.equal(Object.hasOwn(old.runtimeCohorts[0].fingerprint, "network"), false);
});

test("configured runtime verification checks the actual network helper dependency", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dely-runtime-test-"));
  try {
    const directory = path.join(dir, "plugin/skills/delivery/scripts");
    fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(path.join(dir, "dely-compliance"));
    fs.writeFileSync(path.join(dir, "plugin/package.json"), JSON.stringify({ version: "0.27.6" }));
    const dependencies = {};
    for (const name of ["task-routing.js", "dely.js", "jev_agent.js", "usage.js", "network-fallback.js"]) {
      const file = path.join(directory, name);
      fs.writeFileSync(file, name);
      dependencies[file] = require("node:crypto").createHash("sha256").update(name).digest("hex");
    }
    const settings = { routing: path.join(directory, "task-routing.js"), dely: path.join(directory, "dely.js"),
      advisor: path.join(directory, "jev_agent.js"), dependencies };
    const file = path.join(dir, "dely-compliance/settings.json");
    fs.writeFileSync(file, JSON.stringify(settings));
    assert.equal(readRuntimes([dir])[0].verified, true);
    fs.writeFileSync(path.join(directory, "network-fallback.js"), "changed helper");
    assert.equal(readRuntimes([dir])[0].verified, false);
    fs.writeFileSync(path.join(directory, "network-fallback.js"), "network-fallback.js");
    delete dependencies[path.join(directory, "network-fallback.js")];
    fs.writeFileSync(file, JSON.stringify(settings));
    assert.equal(readRuntimes([dir])[0].verified, false);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("journal collection exposes bound Control and audit aggregation through the API", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dely-monitor-api-"));
  let server;
  try {
    const journal = path.join(dir, "log.jsonl");
    const audit = { ...control, event: "task_reference_audit", case_id: "synthetic-api-case", reference_difficulty: "easy" };
    const fixture = [reviewed, route, launch, control, audit].map((e) => ({ ...e, secret: "PRIVATE EVIDENCE" }));
    fs.writeFileSync(journal, fixture.map(JSON.stringify).join("\n") + "\n");
    server = createMonitor({ collect: async () => ({ ...await collect({ journal,
      readWorkers: async () => ({ rows: [] }), readConversations: async () => ({ rows: [] }) }), collectedAt: last }) });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/usage?days=30");
    assert.equal(response.status, 200);
    const raw = await response.text(), result = JSON.parse(raw);
    assert.equal(result.metrics.agyAcceptedWithoutFallback.numerator, 1);
    assert.equal(result.metrics.upwardLeakage.denominator, 1);
    assert.equal(result.metrics.upwardLeakage.numerator, 0);
    assert.equal(raw.includes("PRIVATE EVIDENCE"), false);
    assert.equal(raw.includes(control.evidence_sha256), false);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("review logging preserves effective time and a stable frozen decision fingerprint", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dely-monitor-review-"));
  try {
    const file = path.join(dir, "log.jsonl");
    const assessment = { ...approval, task: { repo, spec_sha256: specHash, context_sha256: contextHash, context: {} },
      route: { workflow: "dely", primary: approval.primary }, review: { by: "codex-control", reviewed_at: ts, source: "jev-reviewed", reason: "test fixture" } };
    recordTask(assessment, "review", file); recordTask(assessment, "review", file);
    const rows = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(rows[0].reviewed_at, ts); assert.match(rows[0].decision_sha256, /^[a-f0-9]{64}$/);
    assert.equal(rows[0].decision_sha256, rows[1].decision_sha256);
    assert.equal(metrics(rows).lowTierPrimaryCompliance.denominator, 1);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a task and duplicate receipts count once; fallback launches remain separate", () => {
  const fallback = { ...launch, dispatchId: "second", fallbackReason: "quota", fallbackStage: 1,
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  const result = summarize([approval, approval, route, launch, launch, fallback], [], [], { since: 0 });
  assert.equal(result.tasks.approved, 1); assert.equal(result.tasks.eligible, 1);
  assert.equal(result.tasks.dispatched, 1); assert.equal(result.tasks.rate, 1);
  assert.equal(result.models.reduce((sum, r) => sum + r.launches, 0), 2);
  assert.equal(result.models.find((r) => r.model === "gpt-6-luna").fallbacks, 1);
  assert.deepEqual(result.metrics.agyStart, { numerator: 1, denominator: 1, rate: 1 });
  assert.equal(result.metrics.lunaFallback.rate, 1);
  assert.equal(result.coverage.confirmed, 2);
  assert.equal(result.metrics.agyAcceptedWithoutFallback.rate, null);
});

test("case36 events/retries remain distinct from snapshots keyed by policy and taskKey", () => {
  const v3 = { ...approval, policy: "jev-task-routing-v3" };
  const v4 = { ...approval, policy: "jev-task-routing-v4" };
  const result = summarize([v3, v4, v4, { ...route, policy: v4.policy }, launch], [], []);
  assert.equal(result.tasks.events, 3);
  assert.equal(result.tasks.recorded, 2);
  assert.equal(result.tasks.dispatched, 1);
  assert.equal(result.approvals.find((r) => r.policy === v3.policy).dispatched, false);
  assert.equal(result.approvals.find((r) => r.policy === v4.policy).dispatched, true);
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
  assert.equal(result.tasks.rate, null); assert.equal(result.approvals[0].dispatched, false);
  assert.equal(result.pending, 1);
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
  assert.equal(result.models[0].model, "gemini-3.8-flash-medium");
  assert.equal(result.conversations.models[0].model, "gpt-6.1-sol");
});

test("first confirmed dispatch fixes the decision, window and runtime cohort across later reviews", () => {
  const runtime = { version: "0.27.6", router: "1".repeat(64), dispatcher: "2".repeat(64), usage: "3".repeat(64) };
  const later = "2026-10-10T01:00:00Z";
  const changed = { ...approval, ts: later, difficulty: "medium_plus", primary: { harness: "codex", model: "gpt-6.1-sol", effort: "medium" } };
  const events = [{ ...approval, runtime }, { ...route, runtime }, { ...launch, runtime }, changed,
    { ...route, ts: later, difficulty: "medium_plus" },
    { ...launch, ts: later, dispatchId: "retry", launch: { effective: { agent: "codex", model: "gpt-6.1-sol", effort: "medium" } } }];
  const result = summarize(events, [], [], { runtimes: [{ verified: true, fingerprint: runtime }] });
  assert.equal(result.metrics.agyPrimary.rate, 1); assert.equal(result.metrics.agyStart.rate, 1);
  assert.equal(result.runtimeCohorts[0].verification, "VERIFIED");
  assert.equal(result.runtimeCohorts[0].snapshots, 1);
  assert.equal(summarize(events, [], [], { since: Date.parse(later) }).metrics.agyStart.denominator, 0);
  const early = summarize(events, [], [], { asOf: Date.parse(ts) + 1, end: Date.parse(ts) + 1 });
  assert.equal(early.tasks.approved, 1); assert.equal(early.models.length, 1);
  const extra = { ...runtime, privateExtra: "DO NOT EXPOSE" };
  assert.ok(!JSON.stringify(summarize([{ ...approval, runtime: extra }, route, { ...launch, runtime: extra }], [], [])).includes("DO NOT EXPOSE"));
});

test("a confirmed Luna-first launch is a single AGY-primary snapshot, not an AGY start", () => {
  const luna = { ...launch, fallbackStage: null, pinPhase: "implement_backup_2", fallbackReason: "model_unavailable",
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  const result = summarize([approval, route, luna], [], []);
  assert.equal(result.metrics.agyPrimary.rate, 1); assert.equal(result.metrics.agyStart.rate, 0);
  assert.equal(result.metrics.lunaFallback.rate, 1);
});

test("missing or mismatched bindings, conflicting receipts and incomplete history report coverage", () => {
  for (const changed of [{ assessmentBasisSha256: "d".repeat(64) }, { contextSha256: "d".repeat(64) },
    { promptSha256: "d".repeat(64) }, { correctionSha256: "d".repeat(64) }, { launch: {} }]) {
    const result = summarize([approval, route, { ...launch, ...changed }], [], []);
    assert.equal(result.metrics.agyStart.rate, null); assert.equal(result.coverage.unbound, 1);
    assert.equal(result.coverage.history, "NOT_EVALUATED");
  }
  const conflict = summarize([approval, route, launch, { ...launch, contextSha256: "d".repeat(64) }], [], []);
  assert.equal(conflict.metrics.agyStart.rate, null); assert.equal(conflict.coverage.conflicting, 1);
  const empty = summarize([], [], []);
  assert.equal(empty.metrics.agyStart.rate, null); assert.equal(empty.metrics.agyPrimary.rate, null);
  assert.equal(empty.metrics.agyAcceptedWithoutFallback.status, "NOT_EVALUATED");
  assert.equal(summarize([approval, route], [], []).metrics.agyStart.denominator, 0);
});

test("fallback after the cohort window counts only through as_of and worker success is not acceptance", () => {
  const later = "2026-10-11T01:00:00Z", end = Date.parse("2026-10-10T00:00:00Z");
  const fallback = { ...launch, ts: later, dispatchId: "fallback", fallbackReason: "quota", fallbackStage: 1,
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  const events = [approval, route, launch, fallback];
  assert.equal(summarize(events, [], [], { end, asOf: end }).metrics.lunaFallback.rate, 0);
  const result = summarize(events, [{ id: launch.dispatchId, repo, ts, status: "succeeded" }], [], { end });
  assert.equal(result.metrics.lunaFallback.rate, 1); assert.equal(result.metrics.agyStart.denominator, 1);
  assert.equal(result.metrics.agyAcceptedWithoutFallback.rate, null);
});

test("a later approved basis can add a valid fallback to the original snapshot cohort", () => {
  const later = "2026-10-11T01:00:00Z", nextBasis = "d".repeat(64);
  const next = { ...approval, ts: later, assessment_basis_sha256: nextBasis };
  const nextRoute = { ...route, ts: later, assessmentBasisSha256: nextBasis };
  const fallback = { ...launch, ts: later, dispatchId: "new-basis-fallback", assessmentBasisSha256: nextBasis,
    fallbackReason: "quota", fallbackStage: 1,
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  const result = summarize([approval, route, launch, next, nextRoute, fallback], [], []);
  assert.equal(result.metrics.agyStart.denominator, 1); assert.equal(result.metrics.agyStart.rate, 1);
  assert.equal(result.metrics.lunaFallback.rate, 1);
  const sol = { harness: "codex", model: "gpt-6.1-sol", effort: "medium" };
  const invalid = summarize([approval, route, launch, { ...next, difficulty: "medium_plus", primary: sol },
    { ...nextRoute, difficulty: "medium_plus" }, fallback], [], []);
  assert.equal(invalid.metrics.agyPrimary.rate, 1);
  assert.equal(invalid.metrics.lunaFallback.rate, 0);
});

test("titles use frozen headings outside fences, preserving Unicode graphemes and optional domains", () => {
  const grapheme = "e\u0302\u0301", emoji = "👩🏽‍💻";
  const task = { spec: "```md\n# Hidden\n~~~\n```\n~~~md\n# Also hidden\n~~~\n#   " + grapheme.repeat(59) + emoji + "extra  ###\n",
    spec_file: "must-not-be-read.md", context: { domain: "ui_frontend" } };
  const original = task.spec;
  assert.equal(taskMetadata(task).task_title, grapheme.repeat(59) + emoji);
  assert.equal(task.spec, original); assert.equal(taskMetadata(task).domain, "ui_frontend");
  assert.equal(taskMetadata({ spec: "## No heading\n```\n# Hidden", context: { domain: "bugfix" } }).task_title, null);
  assert.equal(taskMetadata({ spec: "# ###" }).task_title, null);
  assert.equal(taskMetadata({ spec: "# Real\n# Later", context: { domain: "bugfix" } }).domain, null);
  assert.equal(taskMetadata({ spec: "#  Real\t title  ###" }).task_title, "Real title");
});

test("metadata failure retains the basic assessment event without changing its decision", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dely-monitor-metadata-")), file = path.join(dir, "log.jsonl");
  try {
    const task = { repo, spec_sha256: specHash, context_sha256: contextHash, context: {} };
    Object.defineProperty(task, "spec", { get() { throw Error("metadata unavailable"); } });
    recordTask({ ...approval, task, route: { workflow: "dely", primary: approval.primary } }, "review", file);
    const row = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(row.difficulty, approval.difficulty); assert.equal(row.task_title, null); assert.equal(row.domain, null);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

test("since intersects the rolling window without letting historical snapshots re-enter through retries", async () => {
  const nextContext = "f".repeat(64), nextBasis = "e".repeat(64);
  const nextApproval = { ...reviewed, ts: later, reviewed_at: later, context_sha256: nextContext,
    taskKey: taskKey(repo, specHash, nextContext), assessment_basis_sha256: nextBasis };
  const nextRoute = { ...route, ts: later, run: "new-snapshot", contextSha256: nextContext, assessmentBasisSha256: nextBasis };
  const nextLaunch = { ...launch, ts: later, run: nextRoute.run, dispatchId: "new-first",
    contextSha256: nextContext, assessmentBasisSha256: nextBasis };
  const retry = { ...launch, ts: later, dispatchId: "old-retry" };
  const fallback = { ...retry, dispatchId: "old-fallback", fallbackReason: "quota", fallbackStage: 1,
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" } } };
  const events = [reviewed, route, launch, retry, fallback, nextApproval, nextRoute, nextLaunch];
  const original = JSON.stringify(events);
  const probeRepo = "D:/.tmp-dely-probe";
  const workers = [{ id: "old-worker", repo, ts }, { id: "new-worker", repo, ts: later },
    { id: "probe-worker", repo: probeRepo, ts: later }];
  const conversations = [{ session: "old", repo, ts }, { session: "new", repo, ts: later },
    { session: "probe", repo: probeRepo, ts: later }];
  const server = createMonitor({ collect: async () => ({ events, workers, conversations, sources: {}, collectedAt: last }) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port + "/api/usage";
  const get = async (query = "") => (await fetch(url + query)).json();
  try {
    assert.equal((await get()).metrics.agyStart.denominator, 2);
    const reset = await get("?since=" + encodeURIComponent(later));
    assert.equal(reset.window.start, new Date(later).toISOString());
    assert.equal(reset.metrics.agyStart.denominator, 1);
    assert.equal(reset.metrics.lunaFallback.numerator, 0);
    assert.equal(reset.jobs.count, 1); assert.equal(reset.conversations.turns, 1);
    const probes = await get("?probes=true&since=" + encodeURIComponent(later));
    assert.equal(probes.jobs.count, 2); assert.equal(probes.conversations.turns, 2);
    const scoped = await get("?probes=true&repo=" + encodeURIComponent(repo) + "&since=" + encodeURIComponent(later));
    assert.equal(scoped.jobs.count, 1); assert.equal(scoped.conversations.turns, 1);
    const after = await get("?since=" + encodeURIComponent("2026-10-10T01:00:00.001Z"));
    assert.equal(after.metrics.agyStart.denominator, 0);
    assert.equal(after.metrics.agyStart.rate, null);
    assert.equal(after.jobs.count, 0); assert.equal(after.conversations.turns, 0);
    const rolling = await get("?days=1&since=" + encodeURIComponent(ts));
    assert.equal(rolling.window.start, new Date(later).toISOString());
    assert.equal(rolling.metrics.agyStart.denominator, 1);
    const missingRepo = await get("?repo=D:/absent&since=" + encodeURIComponent(later));
    assert.equal(missingRepo.metrics.agyStart.denominator, 0); assert.equal(missingRepo.jobs.count, 0);
    assert.equal((await get("?since=" + encodeURIComponent("2026-10-10T03:00:00+02:00"))).window.start, reset.window.start);
    for (const invalid of ["", "yesterday", "2026-02-30T00:00:00Z", "2026-10-10", "2026-10-10T01:00:00", "Infinity"]) {
      assert.equal((await fetch(url + "?since=" + encodeURIComponent(invalid))).status, 400, invalid);
    }
    const future = await get("?since=" + encodeURIComponent("2026-10-12T01:00:00Z"));
    assert.equal(future.window.start, future.window.end);
    assert.equal(future.metrics.agyStart.denominator, 0);
    assert.equal((await get()).metrics.agyStart.denominator, 2);
    assert.equal(JSON.stringify(events), original);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("reset newer than the collector cache reloads sources before summarizing", async () => {
  let reads = 0;
  const server = createMonitor({ collect: async () => ({ events: [], workers: [], conversations: [], sources: {},
    collectedAt: ++reads === 1 ? ts : last }) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port + "/api/usage";
  try {
    await fetch(url); assert.equal(reads, 1);
    const response = await (await fetch(url + "?since=" + encodeURIComponent(later))).json();
    assert.equal(reads, 2); assert.equal(response.collectedAt, last);
    assert.equal(response.window.start, new Date(later).toISOString());
    assert.equal(response.window.end, new Date(last).toISOString());
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
