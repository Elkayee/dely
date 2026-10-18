"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const routing = require("../skills/delivery/scripts/task-routing.js");
const { record } = require("./dely-control-result.js");
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function fixture(t) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dely-control-result-")));
  t.after(() => { assert.ok(path.basename(repo).startsWith("dely-control-result-")); fs.rmSync(repo, { recursive: true }); });
  fs.writeFileSync(path.join(repo, "spec.md"), "Known fixture behavior and detector.");
  fs.writeFileSync(path.join(repo, "context.json"), JSON.stringify({ scope: "One fixture", coupling: "Known fixture caller",
    acceptance: "Known regression distinguishes wrong value", evidence: "Fixture source and caller inspected", requirements_confirmed: true,
    risks: Object.fromEntries(routing.RISK_KEYS.map((k) => [k, false])) }));
  const a = routing.review(await routing.assess(routing.loadTask(repo, "spec.md", "context.json"), { apiKey: "" }), "medium_plus", "Known integrated fixture acceptance");
  const assessmentFile = path.join(repo, "assessment.json"), evidenceFile = path.join(repo, "control.json"), journal = path.join(repo, "log.jsonl");
  fs.writeFileSync(assessmentFile, JSON.stringify(a));
  const artifact = path.join(repo, "review.md");
  fs.writeFileSync(artifact, "Control checked the scoped behavior against the detector.");
  const proof = { schema_version: 1, reviewer: "codex-control", reviewed_at: "2026-10-18T00:00:00Z", reason: "Scoped detector passed independent Control inspection",
    assessment_basis_sha256: a.assessment_basis_sha256, evidence_refs: [{ file: artifact, sha256: hash(fs.readFileSync(artifact)) }],
    verdict: "accepted", run: "run_fixture", dispatchId: "ctx_fixture", case_id: "reference-fixture", reference_difficulty: "medium_minus" };
  const dispatch = { event: "dispatch", run: "run_fixture", dispatchId: "ctx_fixture", terminalHandle: "term_worker", repo,
    promptSha256: a.task.spec_sha256, contextSha256: a.task.context_sha256, assessmentBasisSha256: a.assessment_basis_sha256, phase: "implement" };
  fs.writeFileSync(journal, JSON.stringify(dispatch) + "\n");
  const state = { coordinator: "term_control", harness: "codex", exact: true, worker: "succeeded", outcome: "succeeded", status: "completed", durable: true,
    connected: true, writable: true, orphaned: false };
  const query = (args) => args[1] === "run-show" ? { run: { coordinator_handle: state.coordinator } } : args[0] === "terminal" ?
    { terminals: [{ handle: "term_control", agentIdentity: state.harness, connected: state.connected, writable: state.writable, orphaned: state.orphaned }] } : {
      dispatch: { id: "ctx_fixture", runId: "run_fixture", assigneeHandle: "term_worker", completedAt: "2026-10-18T00:00:00Z", status: state.status },
      worker: { dispatchId: "ctx_fixture", agentTerminalHandle: "term_worker", state: state.worker },
      projection: { dispatchId: "ctx_fixture", outcome: state.outcome, evidence: { durable: state.durable } }, observation: { exactWorker: state.exact } };
  const run = (kind = "acceptance") => {
    fs.writeFileSync(evidenceFile, JSON.stringify(proof));
    return record({ kind, run: "run_fixture", dispatchId: "ctx_fixture", assessmentFile, evidenceFile, journal }, query, "term_control");
  };
  return { run, state, proof, journal, artifact, dispatch };
}

test("Control result requires native coordinator, bound receipt, durable success and immutable review artifacts", async (t) => {
  const f = await fixture(t), e = f.run();
  assert.equal(e.event, "task_control_result");
  assert.equal(e.verdict, "accepted");
  assert.match(e.evidence_sha256, /^[a-f0-9]{64}$/);
  fs.appendFileSync(f.artifact, "changed");
  assert.throws(() => f.run(), /reference changed/);
});

for (const [key, value] of [["coordinator", "term_other"], ["harness", "antigravity"], ["exact", false],
  ["worker", "ready"], ["outcome", "in_progress"], ["status", "dispatched"], ["durable", false],
  ["connected", false], ["writable", false], ["orphaned", true]]) {
  test("worker self-report cannot create acceptance with " + key + "=" + value, async (t) => {
    const f = await fixture(t);
    f.state[key] = value;
    assert.throws(() => f.run());
    assert.equal(fs.readFileSync(f.journal, "utf8").trim().split("\n").length, 1);
  });
}

test("Control rejection is final evidence, and reference audit is a separate event", async (t) => {
  const f = await fixture(t);
  f.proof.verdict = "rejected";
  assert.equal(f.run().verdict, "rejected");
  const e = f.run("audit");
  assert.equal(e.event, "task_reference_audit");
  assert.equal(e.reference_difficulty, "medium_minus");
  assert.equal(e.dispatchId, undefined);
});

test("foreign basis, unconfirmed dispatch, future review and no reference proof never count", async (t) => {
  const f = await fixture(t);
  f.proof.assessment_basis_sha256 = hash("foreign");
  assert.throws(() => f.run(), /foreign/);
  f.proof.assessment_basis_sha256 = f.dispatch.assessmentBasisSha256;
  f.proof.reviewed_at = "2999-01-01T00:00:00Z";
  assert.throws(() => f.run(), /Invalid/);
  f.proof.reviewed_at = "2026-10-18T00:00:00Z";
  fs.writeFileSync(f.journal, "");
  assert.throws(() => f.run(), /receipt-confirmed/);
  f.proof.evidence_refs = [];
  assert.throws(() => f.run("audit"), /Invalid/);
});
