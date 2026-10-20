"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const HOMES = [path.join(os.homedir(), ".codex"),
  path.join(process.env.APPDATA || "", "orca", "codex-runtime-home", "home")];
const FILES = ["assessment.json", "reviewed.json", "skill-advice.json", "context-advice.json"];
const DIMENSIONS = ["scope", "uncertainty", "risk", "verification", "coordination"];
const RISKS = ["security", "data", "public_contract", "architecture", "production", "routing"];
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
    NO_SKILLS: "NO_SKILLS", SKILL_SHORTLIST_TOO_LARGE: "SKILL_SHORTLIST_TOO_LARGE",
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
  const result = { choice: value[choiceKey], confidence: value.confidence,
    probabilities: Object.fromEntries(labels.map((k) => [k, probabilities[k]])) };
  if (object(value.raw_probabilities)) {
    const raw = value.raw_probabilities, sum = labels.reduce((total, key) => total + raw[key], 0);
    if (Object.keys(raw).length === labels.length && labels.every((key) => unit(raw[key])) && sum > 0 &&
        Math.abs(sum - 1) <= labels.length * 0.005 + 0.000001 &&
        labels.every((key) => Math.abs(raw[key] / sum - probabilities[key]) <= 0.000001)) {
      result.raw_probabilities = Object.fromEntries(labels.map((key) => [key, raw[key]]));
    }
  }
  return result;
}

function control(value) {
  if (!object(value.review) || value.review.by !== "codex-control") return [];
  return [{ reviewedAt: stamp(value.review.reviewed_at),
    status: ["APPROVED", "NOT_EVALUATED"].includes(value.status) ? value.status : "unknown",
    difficulty: GRADES.includes(value.difficulty) ? value.difficulty : null,
    workflow: ["dely", "direct"].includes(value.route?.workflow) ? value.route.workflow : null,
    source: ["jev-and-control", "jev-reviewed", "codex-control", "control-only", "control-correction",
      "control-evidence", "control-override-justified"].includes(value.review.source) ? value.review.source : null,
    model: token(value.route?.primary?.model), effort: token(value.route?.primary?.effort) }];
}

// Names and recorded policy only: never publish paths, descriptions or catalog bodies.
function suggestion(value) {
  if (!object(value) || typeof value.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(value.name)) return null;
  const safe = { name: value.name };
  for (const key of ["enabled", "allow_implicit_invocation", "requires_explicit_invocation"]) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== "boolean") return null;
      safe[key] = value[key];
    }
  }
  return safe;
}

function legacySkill(value) {
  if (!Object.hasOwn(value, "suggestion") || !unit(value.confidence) || !object(value.probabilities)) return null;
  const p = value.probabilities, keys = Object.keys(p);
  if (!Object.hasOwn(p, "none") || keys.length < 2 || keys.length > 1025 ||
      keys.some((key) => key !== "none" && !/^s(?:0|[1-9][0-9]{0,5})$/.test(key)) ||
      keys.some((key) => !unit(p[key])) || Math.abs(keys.reduce((sum, key) => sum + p[key], 0) - 1) > 0.000001) return null;
  const selected = value.suggestion === null ? null : suggestion(value.suggestion);
  if (value.suggestion !== null && !selected) return null;
  const best = Math.max(...keys.filter((key) => key !== "none").map((key) => p[key]));
  if (selected ? best < p.none - 0.000001 : p.none < best - 0.000001) return null;
  // The old producer discarded choice id. Do not reconstruct its candidate mapping.
  return { suggestion: selected, probabilities: Object.fromEntries(keys.map((key) => [key, p[key]])), confidence: value.confidence };
}

function requestDiagnostics(value) {
  const codes = { transport: "TRANSPORT_ERROR", timeout: "REQUEST_TIMEOUT", http: "HTTP_ERROR",
    json: "JSON_DECODE_ERROR", schema: "SCHEMA_INVALID", complete: "OK" };
  if (!object(value) || !Object.hasOwn(codes, value.stage) || value.code !== codes[value.stage] ||
      !Number.isFinite(value.duration_ms) || value.duration_ms < 0 || value.requested_model !== "jev-1.13.0" ||
      (value.http_status !== null && (!Number.isInteger(value.http_status) || value.http_status < 100 || value.http_status > 599)) ||
      value.provider_model !== (value.stage === "complete" ? "jev-1.13.0" : null)) return null;
  return Object.fromEntries(["stage", "code", "duration_ms", "http_status", "requested_model", "provider_model"].map((key) => [key, value[key]]));
}

function incompleteProgress(value, inputHash) {
  if (!object(value) || !digest(inputHash) || value.input_sha256 !== inputHash ||
      ![value.batch_index, value.batch_count, value.completed_batches, value.completed_evaluations]
        .every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 1024) ||
      value.batch_count < 1 || value.batch_index >= value.batch_count || value.completed_batches !== value.batch_index ||
      !Array.isArray(value.evaluations) || value.evaluations.length !== value.completed_evaluations ||
      !Array.isArray(value.requests) || value.requests.length !== value.batch_index + 1) return null;
  const ids = new Set();
  const evaluations = value.evaluations.map((v) => {
    if (!object(v) || !/^s(?:0|[1-9][0-9]{0,5})$/.test(v.id) || ids.has(v.id)) return null;
    ids.add(v.id);
    const projected = answer(v, RELEVANCE, "relevance");
    return projected && { index: Number(v.id.slice(1)), ...projected };
  });
  const requests = value.requests.map(requestDiagnostics);
  if (evaluations.some((v) => !v) || requests.some((v, i) => !v || (v.stage === "complete") !== (i < value.batch_index)) ||
      (value.completed_batches === 0 ? evaluations.length !== 0 : evaluations.length < value.completed_batches)) return null;
  return { input_sha256: inputHash, batch_index: value.batch_index, batch_count: value.batch_count,
    completed_batches: value.completed_batches, completed_evaluations: value.completed_evaluations, evaluations, requests };
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
    model: null, proposal: null, output: null, suggestions: null, ...failure(value.reason), control: taskMode ? control(value) : [] };
  const risks = taskMode && object(value.task.context) && object(value.task.context.risks) ? value.task.context.risks : {};
  row.risks = taskMode ? Object.fromEntries(RISKS.map((key) => [key, typeof risks[key] === "boolean" ? risks[key] : null])) : null;
  row.riskSource = taskMode ? (file === "assessment.json" ? "assessment" : "reviewed") : null;
  const model = taskMode ? value.jev?.model : value.model;
  // A model label alone is not evidence of a completed evaluation.
  row.model = typeof model === "string" && /^jev-[0-9]+\.[0-9]+\.[0-9]+$/.test(model) ? model : null;
  row.request_diagnostics = requestDiagnostics(value.request_diagnostics);
  row.incomplete_batch_progress = mode === "skill" && status === "NOT_EVALUATED" ?
    incompleteProgress(value.incomplete_batch_progress, value.input_sha256) : null;
  if (taskMode && object(value.jev) && object(value.jev.answers) &&
      Object.keys(value.jev.answers).length === DIMENSIONS.length) {
    const answers = Object.fromEntries(DIMENSIONS.map((key) => [key,
      value.jev.answers[key]?.type === "choice" ? answer(value.jev.answers[key], LABELS) : null]));
    if (Object.values(answers).every(Boolean)) {
      row.output = answers; row.category = "valid";
      row.proposal = Object.values(answers).some((a) => a.choice === "insufficient_evidence") ? "NOT_EVALUATED" :
        GRADES[Math.max(...Object.values(answers).map((a) => GRADES.indexOf(a.choice)))];
    }
  } else if (!taskMode) {
    const values = mode === "skill" ? value.evaluations : value.ranked_context;
    if (Array.isArray(values) && values.length > 0 && values.length <= 1024) {
      const output = values.map((v, i) => {
        if (!object(v)) return null;
        // Candidate content, ids, paths and skill descriptions are not result fields.
        if (mode === "skill" && v.relevance === "NOT_EVALUATED" && v.reason === "DISABLED") return { index: i, choice: "NOT_EVALUATED", reason: "DISABLED" };
        const projected = answer(v, RELEVANCE, "relevance");
        return projected && { index: i, ...projected };
      });
      if (output.every(Boolean)) {
        row.output = output;
        if (output.some((a) => a.choice !== "NOT_EVALUATED")) row.category = "valid";
      }
    }
    if (mode === "skill") {
      if (Array.isArray(value.suggestions) && value.suggestions.length <= 1024) {
        const suggestions = value.suggestions.map(suggestion);
        if (suggestions.every(Boolean)) row.suggestions = suggestions;
        else { row.output = null; row.reason = "INVALID_RECORDED_OUTPUT"; row.category = "unknown"; }
      } else if (Object.hasOwn(value, "suggestions")) {
        row.output = null; row.reason = "INVALID_RECORDED_OUTPUT"; row.category = "unknown";
      }
      if (!Object.hasOwn(value, "evaluations") && !Object.hasOwn(value, "suggestions") && status === "REVIEW_REQUIRED") {
        const legacy = legacySkill(value);
        if (legacy) {
          row.output = legacy; row.suggestions = legacy.suggestion ? [legacy.suggestion] : [];
          row.category = "valid"; row.reason = legacy.suggestion ? "LEGACY_SUGGESTION" : "LEGACY_NO_SUGGESTION";
        }
      }
      if (status === "NOT_APPLICABLE" && ["NO_SKILLS", "NO_ELIGIBLE_SKILLS"].includes(row.reason)) row.category = "not_applicable";
      const selection = value.selection;
      if (object(selection)) {
        row.selection = Object.fromEntries(["catalog_count", "eligible_count", "explicit_count", "disabled_count", "evaluated_count", "requests", "rounds"]
          .filter((key) => Number.isSafeInteger(selection[key]) && selection[key] >= 0 && selection[key] <= 1000000)
          .map((key) => [key, selection[key]]));
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
  if (row.incomplete_batch_progress) {
    // Partial observations cannot become final output, suggestions or valid evaluations.
    row.output = null; row.suggestions = []; row.category = "error";
  }
  // Exclude review fields, frozen content and copy locations from evaluation identity.
  const taskIdentity = taskMode && (digest(value.task.spec_sha256) && digest(value.task.context_sha256) ?
    [value.task.spec_sha256, value.task.context_sha256] : hash(value.task));
  row.id = hash(taskMode ? [mode, value.policy, row.repo, row.ts,
    taskIdentity, row.model, row.output] :
    [mode, digest(value.input_sha256), row.ts, row.model, row.output, row.suggestions, row.reason]);
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
              prior.risks = row.risks; prior.riskSource = row.riskSource;
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
  const time = (r) => {
    const value = typeof r.ts === "number" ? r.ts : typeof r.ts === "string" ? Date.parse(r.ts) : NaN;
    return Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
  };
  const scoped = rows.filter((r) => (!repo || r.repo === repo) && (options.probes || !probe(r.repo)) &&
    (!options.mode || r.mode === options.mode));
  const visible = scoped.filter((r) => time(r) == null ? !options.explicitReset : time(r) >= since && time(r) <= end);
  const count = (category) => visible.filter((r) => r.category === category).length;
  return { recorded: visible.length, evaluations: count("valid") + count("error"), valid: count("valid"),
    errors: count("error"), notEvaluated: count("not_evaluated"), skipped: count("skipped"), notApplicable: count("not_applicable"), unknown: count("unknown"),
    excludedUnknownTime: options.explicitReset ? scoped.filter((r) => time(r) == null).length : 0,
    unknownTime: visible.filter((r) => time(r) == null).length, unknownWorkspace: visible.filter((r) => !r.repo).length,
    modes: Object.fromEntries(["task", "skill", "context"].map((mode) => [mode, visible.filter((r) => r.mode === mode).length])),
    reasons: [...visible.reduce((groups, row) => {
      const reason = row.reason === "NOT_RECORDED" && row.category === "valid" ? "VALID_RECORDED_OUTPUT" : row.reason;
      const key = JSON.stringify([row.mode, row.category, reason]);
      const group = groups.get(key) || { mode: row.mode, category: row.category, reason, count: 0 };
      group.count++; groups.set(key, group); return groups;
    }, new Map()).values()].sort((a, b) => b.count - a.count || a.mode.localeCompare(b.mode)),
    rows: visible.slice().sort((a, b) => (time(b) || 0) - (time(a) || 0)) };
}

module.exports = { createJevReader, summarizeJev };
