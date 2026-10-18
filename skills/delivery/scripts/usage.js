"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

function taskKey(repo, spec, context) {
  const normalized = String(repo || "").replace(/\\/g, "/");
  return crypto.createHash("sha256").update(JSON.stringify([
    process.platform === "win32" ? normalized.toLowerCase() : normalized, spec, context,
  ])).digest("hex");
}

function taskMetadata(task) {
  let fence = null, title = null;
  for (const line of String(task.spec || "").split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    const heading = /^ {0,3}#(?:[\t ]+(.*)|[\t ]*)$/.exec(line);
    if (!heading) continue;
    const normalized = (heading[1] || "").replace(/(?:^|[\t ]+)#+[\t ]*$/, "").replace(/\s+/gu, " ").trim();
    title = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(normalized)]
      .slice(0, 60).map((part) => part.segment).join("") || null;
    break;
  }
  return { task_title: title, domain: ["ui_frontend", "backend_api", "data_pipeline", "other"].includes(task.context?.domain) ? task.context.domain : null };
}

function runtimeFingerprint(directory = __dirname) {
  try {
    const hash = (name) => crypto.createHash("sha256").update(fs.readFileSync(path.join(directory, name))).digest("hex");
    return { version: JSON.parse(fs.readFileSync(path.resolve(directory, "../../../package.json"), "utf8")).version,
      router: hash("task-routing.js"), dispatcher: hash("dely.js"), usage: hash("usage.js") };
  } catch (_) { return null; }
}

function recordTask(assessment, operation, journal = path.join(os.homedir(), ".dely", "log.jsonl")) {
  try {
    const directory = path.dirname(journal);
    if (!fs.statSync(directory).isDirectory()) return;
    const task = assessment.task;
    if (!task || !task.repo || !task.spec_sha256 || !task.context_sha256) return;
    const record = {
      ts: new Date().toISOString(), event: "task_assessment", operation,
      taskKey: taskKey(task.repo, task.spec_sha256, task.context_sha256),
      repo: task.repo, policy: assessment.policy, status: assessment.status,
      difficulty: assessment.difficulty, workflow: assessment.route?.workflow || null,
      primary: assessment.route?.primary ? {
        harness: assessment.route.primary.harness, model: assessment.route.primary.model,
        effort: assessment.route.primary.effort,
      } : null, reviewer: assessment.review?.by || null,
      jevStatus: assessment.jev ? "EVALUATED" : "NOT_EVALUATED",
      assessment_basis_sha256: assessment.assessment_basis_sha256 || null,
      jev_difficulty: assessment.jev_difficulty ?? null,
      known_hard_flags: require("./task-routing.js").knownHard({ context: task.context || {} }),
      decision_source: assessment.review?.source || null,
      correction_candidate: assessment.correction_candidate?.dimension || null,
      correction_dimension: assessment.review?.correction?.proof.dimension || null,
      correction_reason_code: assessment.review?.correction?.proof.reason_code || null,
      correction_sha256: assessment.review?.correction_sha256 || null,
      task_title: null, domain: null, runtime: runtimeFingerprint(),
    };
    try { Object.assign(record, taskMetadata(task)); } catch (_) { /* Optional metadata cannot discard the base event. */ }
    fs.appendFileSync(journal, JSON.stringify(record) + "\n", { mode: 0o600 });
  } catch (_) { /* Logging never changes routing, output or exit status. */ }
}

module.exports = { taskKey, taskMetadata, runtimeFingerprint, recordTask };
