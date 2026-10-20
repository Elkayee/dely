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
  const flags = row.mode === "task" ? ["security", "data", "public_contract", "architecture", "production", "routing"].map((key) => {
    const value = typeof row.risks?.[key] === "boolean" ? row.risks[key] : null;
    return { key, text: key + "=" + (value === null ? "unknown/not recorded" : value), active: value === true };
  }) : [];
  const riskSource = row.mode !== "task" ? "Risk flags: not applicable" : "Recorded risk flags: " +
    (row.riskSource === "assessment" ? "original assessment" : row.riskSource === "reviewed" ?
      "reviewed snapshot (original unavailable)" : "source not recorded");
  const riskContext = row.mode === "task" && row.risks?.production === true ?
    "production=true records context; it is not an automatic Hard exclusion for new assessments." : null;
  const exclusions = Array.isArray(row.hardExclusions) ? flags.filter((flag) => row.hardExclusions.includes(flag.key)) : [];
  const riskExplanation = hard && row.mode === "task" ? "Consequential-risk gates select Hard before Jev. Recorded Hard exclusions: " +
    (exclusions.map((flag) => flag.text + (flag.key === "production" ? " (historical automatic exclusion)" : "")).join(", ") || "not recorded") + "." : null;
  return { model: telemetry ? "Requested: " + telemetry.requested_model + "; Provider: " + (telemetry.provider_model || "not recorded") :
    row.model ? "Recorded model (legacy): " + row.model : (hard ? "Not called (Hard/direct)" : "Model not recorded"), proposal,
    flags, riskSource, riskContext, riskExplanation,
    review: row.control.length ? JSON.stringify(row.control, null, 2) : "No saved Control review" };
}

if (typeof module !== "undefined") module.exports = { jevPresentation };
