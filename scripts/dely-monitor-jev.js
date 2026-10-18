"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const HOMES = [path.join(os.homedir(), ".codex"),
  path.join(process.env.APPDATA || "", "orca", "codex-runtime-home", "home")];
const FILES = ["assessment.json", "reviewed.json", "skill-advice.json", "context-advice.json"];
const DIMENSIONS = ["scope", "uncertainty", "risk", "verification", "coordination"];
const GRADES = ["easy", "medium_minus", "medium_plus", "hard"];
const LABELS = [...GRADES, "insufficient_evidence"];
const RELEVANCE = ["direct", "supporting", "unknown", "unrelated"];
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" && v.length > 0 && v.length <= 512 ? v : null;
const token = (v) => typeof v === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(v) ? v : null;
const hash = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v) ? v : null;
const stamp = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const repoPath = (v) => text(v)?.replace(/\\/g, "/") || null;
const probe = (v) => /(?:\.tmp-dely|dely-probe|routing-tests-|jev-agent-)/i.test(v || "");
const unit = (v) => Number.isFinite(v) && v >= 0 && v <= 1;

// Never echo exception messages or arbitrary recorded reason text.
function failure(reason) {
  const errors = {
    "Jev request timed out or returned an invalid response": "REQUEST_TIMEOUT_OR_INVALID_RESPONSE",
    JEV_UNAVAILABLE_OR_INVALID: "JEV_UNAVAILABLE_OR_INVALID",
  };
  const skipped = {
    "Missing task evidence": "MISSING_TASK_EVIDENCE",
    "Jev snapshot is too large; Control must review the full spec or prepare a smaller task": "SNAPSHOT_TOO_LARGE",
    "Could not read TypeSafe credentials; check .env access and format": "CREDENTIALS_UNAVAILABLE",
    "TYPESAFE_API_KEY is not configured": "TYPESAFE_API_KEY_MISSING",
    "Jev requires additional evidence": "ADDITIONAL_EVIDENCE_REQUIRED",
    TYPESAFE_API_KEY_MISSING: "TYPESAFE_API_KEY_MISSING", CREDENTIALS_UNAVAILABLE: "CREDENTIALS_UNAVAILABLE",
    SNAPSHOT_TOO_LARGE: "SNAPSHOT_TOO_LARGE", SKILL_REQUEST_TOO_LARGE: "SKILL_REQUEST_TOO_LARGE",
    NO_ELIGIBLE_SKILLS: "NO_ELIGIBLE_SKILLS",
  };
  if (typeof reason === "string" && /^(?:Jev HTTP |JEV_HTTP_)[1-5][0-9]{2}$/.test(reason)) {
    return { reason: "JEV_HTTP_" + reason.slice(-3), category: "error" };
  }
  if (typeof reason === "string" && Object.hasOwn(errors, reason)) return { reason: errors[reason], category: "error" };
  if (typeof reason === "string" && Object.hasOwn(skipped, reason)) return { reason: skipped[reason], category: "not_evaluated" };
  return { reason: reason == null ? "NOT_RECORDED" : "UNRECOGNIZED_RECORDED_REASON", category: "unknown" };
}

function answer(value, labels, choiceKey = "choice") {
  if (!object(value) || !labels.includes(value[choiceKey]) || !unit(value.confidence) || !object(value.probabilities)) return null;
  const probabilities = value.probabilities;
  if (Object.keys(probabilities).length !== labels.length || labels.some((k) => !unit(probabilities[k])) ||
      Math.abs(labels.reduce((sum, k) => sum + probabilities[k], 0) - 1) > 0.000001 ||
      probabilities[value[choiceKey]] < Math.max(...labels.map((k) => probabilities[k])) - 0.000001) return null;
  return { choice: value[choiceKey], confidence: value.confidence,
    probabilities: Object.fromEntries(labels.map((k) => [k, probabilities[k]])) };
}

function control(value) {
  if (!object(value.review) || value.review.by !== "codex-control") return [];
  return [{ reviewedAt: stamp(value.review.reviewed_at),
    status: ["APPROVED", "NOT_EVALUATED"].includes(value.status) ? value.status : "unknown",
    difficulty: GRADES.includes(value.difficulty) ? value.difficulty : null,
    workflow: ["dely", "direct"].includes(value.route?.workflow) ? value.route.workflow : null,
    source: ["jev-and-control", "jev-reviewed", "codex-control", "control-only", "control-correction"].includes(value.review.source) ? value.review.source : null,
    model: token(value.route?.primary?.model), effort: token(value.route?.primary?.effort) }];
}

function project(value, file) {
  if (!object(value)) return null;
  const taskMode = file === "assessment.json" || file === "reviewed.json";
  const mode = taskMode ? "task" : file === "skill-advice.json" ? "skill" : "context";
  if (taskMode ? !object(value.task) || !text(value.policy) : value.mode !== mode) return null;
  const status = ["REVIEW_REQUIRED", "NOT_EVALUATED", "DIRECT_CODEX", "APPROVED", "NOT_APPLICABLE"].includes(value.status) ? value.status : "unknown";
  const row = { ts: stamp(taskMode ? value.assessed_at : value.assessed_at || value.created_at),
    repo: taskMode ? repoPath(value.task.repo) : null, mode,
    policy: taskMode && /^jev-task-routing-v[1-4]$/.test(value.policy) ? value.policy : null,
    timeSource: taskMode ? "assessment" : "advisor",
    status: file === "reviewed.json" ? "ORIGINAL_UNAVAILABLE" : status,
    model: null, proposal: null, output: null, ...failure(value.reason), control: taskMode ? control(value) : [] };
  const model = taskMode ? value.jev?.model : value.model;
  // A model label alone is not evidence of a completed evaluation.
  row.model = typeof model === "string" && /^jev-[0-9]+\.[0-9]+\.[0-9]+$/.test(model) ? model : null;
  if (taskMode && object(value.jev) && row.model && object(value.jev.answers) &&
      Object.keys(value.jev.answers).length === DIMENSIONS.length) {
    const answers = Object.fromEntries(DIMENSIONS.map((key) => [key,
      value.jev.answers[key]?.type === "choice" ? answer(value.jev.answers[key], LABELS) : null]));
    if (Object.values(answers).every(Boolean)) {
      row.output = answers; row.category = "valid";
      row.proposal = Object.values(answers).some((a) => a.choice === "insufficient_evidence") ? "NOT_EVALUATED" :
        GRADES[Math.max(...Object.values(answers).map((a) => GRADES.indexOf(a.choice)))];
    }
  } else if (!taskMode && row.model) {
    const values = mode === "skill" ? value.evaluations : value.ranked_context;
    if (Array.isArray(values) && values.length > 0 && values.length <= 1024) {
      const output = values.map((v, i) => {
        if (!object(v)) return null;
        // Candidate content, ids, paths and skill descriptions are not result fields.
        if (mode === "skill" && v.relevance === "NOT_EVALUATED" && v.reason === "DISABLED") return { index: i, choice: "NOT_EVALUATED", reason: "DISABLED" };
        const projected = answer(v, RELEVANCE, "relevance");
        return projected && { index: i, ...projected };
      });
      if (output.every(Boolean) && output.some((a) => a.choice !== "NOT_EVALUATED")) {
        row.output = output; row.category = "valid";
      }
    }
  }
  if (taskMode && value.jev != null && row.output === null) {
    row.category = "unknown"; row.reason = "INVALID_RECORDED_OUTPUT";
  } else if (!taskMode && status === "REVIEW_REQUIRED" && row.output === null) {
    row.category = "unknown"; row.reason = "INVALID_RECORDED_OUTPUT";
  } else if (taskMode && value.jev === null && status === "DIRECT_CODEX") {
    row.category = "skipped"; row.reason = "HARD_DIRECT_SKIP";
  }
  // Exclude review fields, frozen content and copy locations from evaluation identity.
  const taskIdentity = taskMode && (digest(value.task.spec_sha256) && digest(value.task.context_sha256) ?
    [value.task.spec_sha256, value.task.context_sha256] : hash(value.task));
  row.id = hash(taskMode ? [mode, value.policy, row.repo, row.ts,
    taskIdentity, row.model, row.output] :
    [mode, digest(value.input_sha256), row.ts, row.model, row.output, row.reason]);
  return row;
}

function createJevReader(options = {}) {
  const homes = [...new Set(options.homes || HOMES)], cache = new Map();
  return async () => {
    const rows = new Map(), coverage = [], seen = new Set(), metrics = { hits: 0, parsed: 0 };
    for (const home of homes) {
      const root = path.join(home, "dely-compliance/tasks");
      const source = { home, state: "ready", directories: 0, loaded: 0, missing: 0, malformed: 0,
        unreadable: 0, oversized: 0, excluded: 0, truncated: false, modes: { task: 0, skill: 0, context: 0 } };
      coverage.push(source);
      let entries;
      try {
        const stat = await fs.lstat(root);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Unsafe root");
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch (error) { source.state = error.code === "ENOENT" ? "missing" : "unreadable"; continue; }
      const dirs = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name));
      source.excluded = entries.filter((e) => e.isSymbolicLink()).length;
      source.truncated = dirs.length > 4096;
      for (const dir of dirs.slice(0, 4096)) {
        source.directories++;
        let original = null;
        const taskRows = [];
        for (const file of FILES) {
          const target = path.join(root, dir.name, file); seen.add(target);
          let item;
          try {
            const stat = await fs.lstat(target);
            if (!stat.isFile() || stat.isSymbolicLink()) { source.excluded++; continue; }
            if (stat.size > 262144) { cache.delete(target); source.oversized++; continue; }
            const signature = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
            const prior = cache.get(target);
            if (prior?.signature === signature) { metrics.hits++; item = prior.item; }
            else {
              const handle = await fs.open(target, "r");
              try {
                const opened = await handle.stat();
                if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > 262144) throw Error("Changed source");
                const buffer = Buffer.alloc(262145);
                const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
                if (bytesRead > 262144) { source.oversized++; continue; }
                try { item = project(JSON.parse(buffer.toString("utf8", 0, bytesRead)), file); }
                catch (_) { item = null; }
                metrics.parsed++;
                // Retain projections only; parsed prompts/context/catalogs are discarded.
                cache.set(target, { signature, item });
              } finally { await handle.close(); }
            }
          } catch (error) {
            if (error.code === "ENOENT") { cache.delete(target); if (file === "assessment.json") source.missing++; }
            else source.unreadable++;
            continue;
          }
          if (!item) { source.malformed++; continue; }
          source.loaded++; source.modes[item.mode]++;
          const row = { ...item, control: [...item.control], sources: [{ home, task: dir.name, file }] };
          if (file === "assessment.json") original = row;
          taskRows.push(row);
        }
        // Advisor artifacts lack intrinsic time/workspace: use the co-located original only.
        for (const row of taskRows) {
          if (row.mode !== "task") {
            row.repo = original?.repo || null;
            if (!row.ts && original?.ts) { row.ts = original.ts; row.timeSource = "co-located assessment"; }
          }
          const identity = row.mode === "task" ? row.id : hash([row.id, row.repo, row.ts]);
          const prior = rows.get(identity);
          if (!prior) rows.set(identity, row);
          else {
            prior.sources.push(...row.sources);
            prior.control = [...new Map([...prior.control, ...row.control].map((d) => [JSON.stringify(d), d])).values()];
            if (prior.status === "ORIGINAL_UNAVAILABLE" && row.status !== "ORIGINAL_UNAVAILABLE") {
              prior.status = row.status; prior.category = row.category; prior.reason = row.reason;
            }
          }
        }
      }
      if (source.malformed || source.unreadable || source.oversized || source.excluded || source.missing || source.truncated) source.state = "partial";
    }
    for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
    return { rows: [...rows.values()], coverage, cache: metrics };
  };
}

function summarizeJev(rows = [], options = {}) {
  const repo = repoPath(options.repo), since = options.since || 0, end = options.asOf ?? Date.now();
  const visible = rows.filter((r) => (!repo || r.repo === repo) && (options.probes || !probe(r.repo)) &&
    (!r.ts || Date.parse(r.ts) >= since && Date.parse(r.ts) <= end));
  const count = (category) => visible.filter((r) => r.category === category).length;
  return { recorded: visible.length, evaluations: count("valid") + count("error"), valid: count("valid"),
    errors: count("error"), notEvaluated: count("not_evaluated"), skipped: count("skipped"), unknown: count("unknown"),
    unknownTime: visible.filter((r) => !r.ts).length, unknownWorkspace: visible.filter((r) => !r.repo).length,
    modes: Object.fromEntries(["task", "skill", "context"].map((mode) => [mode, visible.filter((r) => r.mode === mode).length])),
    rows: visible.slice().sort((a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0)) };
}

module.exports = { createJevReader, summarizeJev };
