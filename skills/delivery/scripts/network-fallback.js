"use strict";

// Only adapter error codes classify transport failures. UI/model discovery
// timeouts and provider prose do not prove either transport failure or outcome.
const CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN"]);
const OPERATIONS = new Set(["repo add", "terminal create", "terminal switch", "terminal wait", "terminal read", "worker-start"]);
function classify(response, operation) {
  const code = response && response.ok === false && response.error && response.error.code;
  return CODES.has(code) && OPERATIONS.has(operation) ? { source: "orca_adapter", code, operation } : null;
}

function validate(evidence, binding) {
  if (!evidence || evidence.source !== "orca_adapter" || !CODES.has(evidence.code) ||
      !OPERATIONS.has(evidence.operation) ||
      ![binding.specSha256, binding.contextSha256, binding.assessmentBasisSha256].every((s) => /^[a-f0-9]{64}$/.test(s || "")) ||
      evidence.specSha256 !== binding.specSha256 || evidence.contextSha256 !== binding.contextSha256 ||
      evidence.assessmentBasisSha256 !== binding.assessmentBasisSha256) throw Error("NETWORK_FALLBACK_UNPROVEN: transport evidence is not bound to this assessment");
  if (evidence.noWorkerCreated === true && evidence.submissionAttempted === false && evidence.failed === true &&
      !["worker-start", "terminal create"].includes(evidence.operation) && (!evidence.terminalHandle || evidence.terminalInactive === true)) return;
  if (!evidence.dispatchId || evidence.inactive !== true || evidence.failed !== true || evidence.released !== true) {
    throw Error("NETWORK_FALLBACK_UNPROVEN: reconcile the original attempt; timeout does not prove inactivity or failure");
  }
}

function reconcile(pending, binding, show, release, closeTerminal = () => false) {
  if (!pending || pending.pin.agent !== "antigravity" || !pending.transportFailure ||
      pending.sourceSha256 !== binding.specSha256 || pending.contextSha256 !== binding.contextSha256 ||
      pending.assessmentBasisSha256 !== binding.assessmentBasisSha256 || pending.run !== binding.run) throw Error("NETWORK_FALLBACK_UNPROVEN: no matching adapter-classified AGY failure");
  const evidence = { ...pending.transportFailure, ...binding,
    noWorkerCreated: pending.submissionAttempted === false && pending.failed === true, submissionAttempted: pending.submissionAttempted === true };
  if (evidence.noWorkerCreated) {
    evidence.failed = true;
    if (pending.terminalHandle) {
      evidence.terminalHandle = pending.terminalHandle;
      evidence.terminalInactive = closeTerminal(pending.terminalHandle) === true;
    }
    validate(evidence, binding); return evidence;
  }
  if (!pending.id || !pending.terminalHandle) throw Error("OUTCOME_UNKNOWN: original worker identity is unresolved; do not resend");
  const r = show(pending.id), d = r.dispatch || {}, w = r.worker || {}, o = r.observation || {}, p = r.projection || {};
  const exact = o.exactWorker === true && d.id === pending.id && d.runId === pending.run &&
    d.assigneeHandle === pending.terminalHandle && w.dispatchId === pending.id &&
    w.agentTerminalHandle === pending.terminalHandle && p.dispatchId === pending.id;
  const inactive = o.status === "exited" || ["dead", "exited"].includes((p.liveness || {}).verdict);
  // A successful, incomplete or contradictory settlement never permits rework.
  const failed = ["failed", "abandoned", "canceled"].includes(d.status) &&
    ["failed", "canceled", "cancelled", "abandoned"].includes(w.state) && !!d.completedAt && p.outcome !== "succeeded";
  if (!exact || !inactive || !failed) throw Error("OUTCOME_UNKNOWN: original AGY attempt is active, successful or not verifiably failed");
  const released = release(pending.id);
  evidence.dispatchId = pending.id;
  evidence.inactive = inactive;
  evidence.failed = failed;
  evidence.released = ["released", "already_released"].includes(released.state);
  validate(evidence, binding);
  return evidence;
}

module.exports = { classify, validate, reconcile };
