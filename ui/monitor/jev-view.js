"use strict";

function jevPresentation(row) {
  const hard = row.category === "skipped" && row.reason === "HARD_DIRECT_SKIP";
  let proposal = row.proposal === "NOT_EVALUATED" ? "Needs evidence" : row.proposal;
  if (!proposal) {
    if (hard) proposal = "Not applicable (Hard/direct)";
    else if (row.category === "error") proposal = "No valid reply";
    else if (row.category === "not_applicable") proposal = "Not applicable (advice disabled/empty)";
    else if (row.category === "not_evaluated") proposal = "Advice not evaluated";
    else if (row.category !== "valid") proposal = "Insufficient recorded evidence";
    else if (row.mode === "skill") proposal = row.suggestions === null ? "Suggestions not recorded" :
      row.suggestions.map((s) => s.name + (s.requires_explicit_invocation === true || s.allow_implicit_invocation === false ? " (explicit invocation only)" : "")).join(", ") ||
      (row.reason === "LEGACY_NO_SUGGESTION" ? "No suggestion (legacy none)" : "No suggested skills");
    else proposal = row.mode === "context" ? "Recorded context ranking" : "Proposal not recorded";
  }
  const telemetry = row.request_diagnostics;
  return { model: telemetry ? "Requested: " + telemetry.requested_model + "; Provider: " + (telemetry.provider_model || "not recorded") :
    row.model ? "Recorded model (legacy): " + row.model : (hard ? "Not called (Hard/direct)" : "Model not recorded"), proposal,
    review: row.control.length ? JSON.stringify(row.control, null, 2) : "No saved Control review" };
}

if (typeof module !== "undefined") module.exports = { jevPresentation };
