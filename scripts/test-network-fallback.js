"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const network = require("../skills/delivery/scripts/network-fallback.js");
const routing = require("../skills/delivery/scripts/task-routing.js");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const binding = { specSha256: sha("spec"), contextSha256: sha("context"), assessmentBasisSha256: sha("basis") };
const transport = network.classify({ ok: false, error: { code: "ECONNRESET" } }, "worker-start");

test("network classification uses adapter codes, never timeout prose/auth/discovery", () => {
  for (const code of ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN"]) {
    assert.equal(network.classify({ ok: false, error: { code } }, "terminal read").code, code);
  }
  for (const code of ["AUTH_ERROR", "EXIT_1", "TIMEOUT", "UNKNOWN", undefined]) {
    assert.equal(network.classify({ ok: false, error: { code, message: "network timeout" } }, "worker-start"), null);
  }
  assert.equal(network.classify({ ok: true, error: { code: "ETIMEDOUT" } }, "worker-start"), null);
  assert.equal(network.classify({ ok: false, error: { code: "ETIMEDOUT" } }, "model discovery"), null);
});

test("network routes require fresh low-tier authority and never Sol-only or stage two", () => {
  for (const difficulty of ["easy", "medium_minus"]) {
    const a = { difficulty, route: routing.route(difficulty) };
    assert.equal(routing.selectedPin(a, { fallback: "network" }).model, "gpt-6-luna");
    assert.equal(routing.selectedPhase(a, { fallback: "network" }), "implement_backup_2");
    assert.throws(() => routing.selectedPin(a, { fallback: "network", "fallback-stage": 2 }));
    delete a.route.networkFallback;
    assert.throws(() => routing.selectedPin(a, { fallback: "network" }), /fresh low-tier/);
  }
  for (const difficulty of ["medium_plus", "hard"]) {
    assert.throws(() => routing.selectedPin({ difficulty, route: routing.route(difficulty) }, { fallback: "network" }));
  }
});

function fixture(t, state) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dely-network-")));
  t.after(() => { assert.ok(path.basename(repo).startsWith("dely-network-")); fs.rmSync(repo, { recursive: true }); });
  const spec = "Known bounded fixture; no real worker is launched.\n";
  fs.writeFileSync(path.join(repo, "spec.md"), spec);
  const decision = { difficulty: "medium_minus", route: routing.route("medium_minus"),
    task: { spec_sha256: sha(spec), context_sha256: binding.contextSha256 },
    assessment_basis_sha256: binding.assessmentBasisSha256, review: { source: "control-evidence" } };
  const helper = path.resolve(__dirname, "../skills/delivery/scripts/dely.js");
  const source = fs.readFileSync(helper, "utf8");
  const nativeRequire = createRequire(helper), exit = {}, calls = [], events = [];
  const c = vm.createContext({ require: (p) => p === "./task-routing.js" ? { ...routing, requireApprovedRoute: () => decision } : nativeRequire(p),
    __dirname: path.dirname(helper), __filename: helper, Buffer, TextDecoder,
    process: { platform: "win32", env: { CODEX_HOME: path.join(repo, "no-native-adapter") }, exit: (code) => { exit.code = code; throw exit; } }, console: { log: () => {} } });
  vm.runInContext(source.slice(0, source.indexOf("const [cmd, ...rest] = process.argv.slice(2);")), c);
  c.pin = (_, phase) => phase === "implement_backup_2" ? { agent: "codex", model: "gpt-6-luna", effort: "max" } :
    { agent: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" };
  c.requireHandle = c.restoreControlFocus = c.recordOwnedSnapshot = () => {};
  c.logEvent = (event, fields) => events.push({ event, ...fields });
  c.start = (_, run, pin, prompt) => {
    calls.push(pin.agent);
    if (pin.agent === "antigravity") {
      c.updatePendingStart(repo, run, { submissionAttempted: state !== "before", modelConfirmed: true });
      return { error: "classified transport failure", transportFailure: { ...transport, operation: state === "before" ? "repo add" : "worker-start" },
        ...(state === "before" ? {} : { state: "outcome_unknown", id: "ctx_primary", terminalHandle: "term_primary" }) };
    }
    c.receipt = prompt.match(/rcpt_[a-f0-9]{16}/)[0];
    return { id: "ctx_luna", terminalHandle: "term_luna" };
  };
  c.orca = (args) => {
    if (args[1] === "worker-show") return { result: {
      dispatch: { id: "ctx_primary", runId: "run_fixture", assigneeHandle: "term_primary", status: state === "success" ? "completed" : "failed", completedAt: "2026-10-18T00:00:00Z" },
      worker: { dispatchId: "ctx_primary", agentTerminalHandle: "term_primary", state: state === "success" ? "succeeded" : "failed" },
      observation: { exactWorker: state !== "identity", status: state === "active" ? "live" : "exited" },
      projection: { dispatchId: "ctx_primary", outcome: state === "success" ? "succeeded" : "failed" } } };
    if (args[1] === "worker-release") return { result: { state: state === "release" ? "blocked" : "released" } };
    return { result: { messages: [{ type: "heartbeat", dispatchId: "ctx_luna", from_handle: "term_luna", subject: c.receipt }] } };
  };
  const f = { repo, run: "run_fixture", phase: "implement", "spec-file": "spec.md" };
  const dispatch = (fallback) => { assert.throws(() => c.dispatch({ ...f, ...(fallback ? { fallback } : {}) }), (e) => e === exit); return exit.code; };
  return { c, f, calls, events, dispatch };
}

for (const state of ["before", "failed"]) test("dispatch reconciles " + state + " AGY failure and consumes exactly one fallback", (t) => {
  const f = fixture(t, state);
  assert.notEqual(f.dispatch(), 0);
  assert.equal(f.dispatch("network"), 0);
  assert.deepEqual(f.calls, ["antigravity", "codex"]);
  const e = f.events.find((e) => e.event === "dispatch");
  assert.equal(e.fallbackReason, "network");
  assert.equal(e.fallbackStage, 1);
  network.validate(e.networkEvidence, { ...binding, specSha256: sha(fs.readFileSync(path.join(f.f.repo, "spec.md"))) });
  assert.notEqual(f.dispatch("network"), 0);
  assert.deepEqual(f.calls, ["antigravity", "codex"]);
});

for (const state of ["active", "success", "identity", "release"]) test("dispatch never duplicates an AGY attempt with " + state + " outcome", (t) => {
  const f = fixture(t, state);
  assert.notEqual(f.dispatch(), 0);
  assert.notEqual(f.dispatch("network"), 0);
  assert.deepEqual(f.calls, ["antigravity"]);
});

test("foreign assessment and a still-running pre-submission launch do not authorize fallback", () => {
  const pending = { run: "run_fixture", pin: { agent: "antigravity" }, sourceSha256: binding.specSha256, contextSha256: binding.contextSha256,
    assessmentBasisSha256: binding.assessmentBasisSha256, transportFailure: transport, submissionAttempted: false };
  assert.throws(() => network.reconcile(pending, { ...binding, run: "run_fixture" }, () => ({}), () => ({})), /OUTCOME_UNKNOWN/);
  assert.throws(() => network.reconcile({ ...pending, failed: true, contextSha256: sha("other") }, binding), /matching/);
});

for (const operation of ["terminal switch", "terminal wait", "terminal read"]) test(operation + " requires owned terminal inactivity before fallback", () => {
  const pending = { run: "run_fixture", pin: { agent: "antigravity" }, sourceSha256: binding.specSha256,
    contextSha256: binding.contextSha256, assessmentBasisSha256: binding.assessmentBasisSha256,
    terminalHandle: "term_owned", submissionAttempted: false, failed: true,
    transportFailure: { ...transport, operation } };
  const b = { ...binding, run: "run_fixture" };
  assert.throws(() => network.reconcile(pending, b, null, null, () => false), /UNPROVEN/);
  assert.equal(network.reconcile(pending, b, null, null, () => true).terminalInactive, true);
  assert.throws(() => network.reconcile({ ...pending, run: "run_foreign" }, b), /matching/);
});

test("an arbitrary AGY primary cannot grant network fallback", (t) => {
  const f = fixture(t, "before");
  f.dispatch();
  const p = f.c.pendingStartPath(f.f.repo, f.f.run), pending = JSON.parse(fs.readFileSync(p, "utf8"));
  pending.pin.model = "unreviewed-model";
  fs.writeFileSync(p, JSON.stringify(pending));
  assert.notEqual(f.dispatch("network"), 0);
  assert.deepEqual(f.calls, ["antigravity"]);
});

test("a lost terminal-create response cannot prove no terminal or worker exists", () => {
  const e = { ...transport, operation: "terminal create", ...binding, noWorkerCreated: true, submissionAttempted: false, failed: true };
  assert.throws(() => network.validate(e, binding), /UNPROVEN/);
});

for (const release of ["retained", "release_pending", "release_unknown"]) test(release + " is not a released attempt", () => {
  const e = { ...transport, ...binding, noWorkerCreated: false, submissionAttempted: true,
    dispatchId: "ctx_failed", inactive: true, failed: true, released: false, releaseState: release };
  assert.throws(() => network.validate(e, binding), /UNPROVEN/);
});
