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

function recordTask(assessment, operation) {
  try {
    const directory = path.join(os.homedir(), ".dely");
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
    };
    fs.appendFileSync(path.join(directory, "log.jsonl"), JSON.stringify(record) + "\n", { mode: 0o600 });
  } catch (_) { /* Logging never changes routing, output or exit status. */ }
}

module.exports = { taskKey, recordTask };
