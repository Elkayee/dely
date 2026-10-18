"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const routing = require("../skills/delivery/scripts/task-routing.js");
const { taskKey } = require("../skills/delivery/scripts/usage.js");
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function native(args) {
  const bin = process.env.ORCA_CLI_COMMAND || "orca";
  const script = /\.m?js$/i.test(bin);
  const r = JSON.parse(execFileSync(script ? process.execPath : bin, [...(script ? [bin] : []), ...args, "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  if (r.ok !== true || !r.result) throw Error("Native Control evidence unavailable");
  return r.result;
}

function record(options, query = native, handle = process.env.ORCA_TERMINAL_HANDLE) {
  if (!["acceptance", "audit"].includes(options.kind)) throw Error("Expected acceptance or audit");
  if (!handle || !options.run) throw Error("An active Codex Control terminal and Run are required");
  const run = query(["orchestration", "run-show", "--id", options.run]).run;
  const terminal = (query(["terminal", "list"]).terminals || []).find((t) => t.handle === handle);
  if (!run || run.coordinator_handle !== handle || !terminal || terminal.agentIdentity !== "codex" ||
      terminal.connected !== true || terminal.writable !== true || terminal.orphaned !== false) {
    throw Error("Only the Run's native Codex Control may record this decision");
  }
  const a = routing.validateApprovedAssessment(JSON.parse(fs.readFileSync(options.assessmentFile, "utf8")));
  const bytes = fs.readFileSync(options.evidenceFile);
  if (bytes.length > 65536) throw Error("Control decision exceeds 64 KiB");
  const proof = JSON.parse(bytes.toString("utf8"));
  if (proof.schema_version !== 1 || proof.reviewer !== "codex-control" ||
      !Number.isFinite(Date.parse(proof.reviewed_at)) || Date.parse(proof.reviewed_at) > Date.now() ||
      !Array.isArray(proof.evidence_refs) || !proof.evidence_refs.length ||
      typeof proof.reason !== "string" || !proof.reason.trim() ||
      proof.assessment_basis_sha256 !== a.assessment_basis_sha256) throw Error("Invalid or foreign Control evidence");
  for (const ref of proof.evidence_refs) {
    if (typeof ref.file !== "string" || !path.isAbsolute(ref.file) || !/^[a-f0-9]{64}$/.test(ref.sha256 || "") ||
        !fs.statSync(ref.file).isFile() || hash(fs.readFileSync(ref.file)) !== ref.sha256) throw Error("Control evidence reference changed or is missing");
  }
  const key = taskKey(a.task.repo, a.task.spec_sha256, a.task.context_sha256);
  const journal = options.journal || path.join(os.homedir(), ".dely", "log.jsonl");
  if (!fs.statSync(path.dirname(journal)).isDirectory()) throw Error("Opt-in journal directory is missing");
  const event = { ts: new Date().toISOString(), reviewer: "codex-control", run: options.run,
    repo: a.task.repo, policy: a.policy, taskKey: key, assessment_basis_sha256: a.assessment_basis_sha256,
    reviewed_at: proof.reviewed_at, evidence_sha256: hash(bytes) };
  if (options.kind === "acceptance") {
    if (!["accepted", "rejected"].includes(proof.verdict) || proof.run !== options.run || proof.dispatchId !== options.dispatchId) throw Error("Acceptance must name the exact Run and dispatch");
    const rows = fs.readFileSync(journal, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const dispatch = rows.find((r) => r.event === "dispatch" && r.run === options.run && r.dispatchId === options.dispatchId &&
      r.repo === a.task.repo && r.promptSha256 === a.task.spec_sha256 && r.contextSha256 === a.task.context_sha256 &&
      r.assessmentBasisSha256 === a.assessment_basis_sha256 && r.phase === "implement");
    if (!dispatch) throw Error("No receipt-confirmed implementation dispatch bound to this assessment");
    const r = query(["orchestration", "worker-show", "--dispatch", options.dispatchId]);
    const d = r.dispatch || {}, w = r.worker || {}, p = r.projection || {}, o = r.observation || {};
    if (o.exactWorker !== true || d.id !== options.dispatchId || d.runId !== options.run ||
        d.assigneeHandle !== dispatch.terminalHandle || w.dispatchId !== options.dispatchId ||
        w.agentTerminalHandle !== dispatch.terminalHandle || p.dispatchId !== options.dispatchId ||
        !d.completedAt || !(p.evidence || {}).durable || !["completed", "failed", "abandoned", "canceled"].includes(d.status)) throw Error("Worker identity or final durable outcome is not proven");
    if (proof.verdict === "accepted" && (d.status !== "completed" || w.state !== "succeeded" || p.outcome !== "succeeded")) throw Error("Worker success is required before Control acceptance");
    Object.assign(event, { event: "task_control_result", verdict: proof.verdict, dispatchId: options.dispatchId });
  } else {
    if (typeof proof.case_id !== "string" || !proof.case_id.trim() || !["easy", "medium_minus", "medium_plus", "hard"].includes(proof.reference_difficulty)) throw Error("Audit requires an identified case and reference grade");
    Object.assign(event, { event: "task_reference_audit", case_id: proof.case_id, reference_difficulty: proof.reference_difficulty });
  }
  fs.appendFileSync(journal, JSON.stringify(event) + "\n", { mode: 0o600 });
  return event;
}

if (require.main === module) {
  const [kind, ...args] = process.argv.slice(2), flags = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith("--") || !args[i + 1]) throw Error("Expected --flag value pairs");
    flags[args[i].slice(2)] = args[i + 1];
  }
  try {
    const event = record({ kind, run: flags.run, dispatchId: flags.dispatch, assessmentFile: flags["assessment-file"], evidenceFile: flags["evidence-file"] });
    console.log(JSON.stringify(event));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}

module.exports = { record };
