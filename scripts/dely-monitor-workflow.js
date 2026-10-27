"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
const hazards = ["destructive_effects", "sensitive_data_access", "exfiltration", "elevated_privileges", "scope_mismatch"];
const signals = ["evidence", "conflict", "injection"];
const relevance = ["direct", "supporting", "unknown", "unrelated"];
const verdicts = ["supported", "unsupported", "contradicted"];
const reasons = new Set(["INVALID_GUARDRAILS_SNAPSHOT", "INVALID_CITATIONS_SNAPSHOT", "SNAPSHOT_TOO_LARGE",
  "CREDENTIALS_UNAVAILABLE", "TYPESAFE_API_KEY_MISSING", "private_or_unavailable_prompt", "private_command",
  "turn_budget", "duplicate_in_flight", "feedback_limit", "citation_count_limit", "INCOMPLETE_SOURCE", "INCOMPLETE_CONTEXT"]);

function probability(value) {
  if (value?.type === "noul" && unit(value.noul)) return { probability: value.noul };
  if (value?.status === "NOT_EVALUATED" && value.reason === "UNCONFIRMED_SCOPE") return { status: "NOT_EVALUATED", reason: "UNCONFIRMED_SCOPE" };
  return null;
}

function choice(value, labels, key) {
  if (!object(value) || !labels.includes(value[key]) || !unit(value.confidence) || !object(value.probabilities)) return null;
  const p = value.probabilities;
  if (Object.keys(p).length !== labels.length || labels.some(label => !unit(p[label])) ||
      Math.abs(labels.reduce((sum, label) => sum + p[label], 0) - 1) > 0.000001 ||
      p[value[key]] < Math.max(...labels.map(label => p[label])) - 0.000001) return null;
  return { choice: value[key], confidence: value.confidence, probabilities: Object.fromEntries(labels.map(label => [label, p[label]])) };
}

function project(value) {
  if (!object(value) || !["guardrails", "context", "citations"].includes(value.mode)) return null;
  const mode = value.mode === "context" ? "workflow_context" : value.mode;
  const status = ["REVIEW_REQUIRED", "NOT_EVALUATED"].includes(value.status) ? value.status : "unknown";
  const reason = value.reason === "JEV_UNAVAILABLE_OR_INVALID" ? value.reason : reasons.has(value.reason) ? value.reason :
    value.reason == null ? "NOT_RECORDED" : "UNRECOGNIZED_RECORDED_REASON";
  const row = { mode, origin: "workflow", status, reason, category: reason === "JEV_UNAVAILABLE_OR_INVALID" ? "error" :
    status === "NOT_EVALUATED" ? "not_evaluated" : "unknown", ts: null, timeSource: "not recorded",
    repo: null, workspaceSource: "not recorded", model: null, request_diagnostics: null, proposal: null,
    suggestions: null, output: null, control: [] };
  const values = value[mode === "guardrails" ? "commands" : mode === "workflow_context" ? "sources" : "citations"];
  if (!Array.isArray(values) || values.length < 1 || values.length > 32) return row;
  const output = values.map((item, index) => {
    if (!object(item)) return null;
    if (mode === "guardrails") {
      if (!object(item.hazards) || Object.keys(item.hazards).length !== hazards.length) return null;
      const projected = Object.fromEntries(hazards.map(key => [key, probability(item.hazards[key])]));
      return Object.values(projected).every(Boolean) ? { index, hazards: projected } : null;
    }
    if (mode === "workflow_context") {
      const ranked = choice(item, relevance, "relevance");
      if (!ranked) return null;
      const passage = item.passage_signals;
      if (passage === undefined) return { index, ...ranked };
      if (!object(passage) || Object.keys(passage).length !== signals.length) return null;
      const projected = Object.fromEntries(signals.map(key => [key, probability(passage[key])]));
      return Object.values(projected).every(Boolean) ? { index, ...ranked, passage_signals: projected } : null;
    }
    const judged = choice(item, verdicts, "judgment");
    const legacy = !Object.hasOwn(item, "evaluation_status");
    if ((item.evaluation_status === "EVALUATED" || legacy) && judged) return {
      index, ...judged, evidence: "recorded Jev reply",
      evaluationStatus: legacy ? "not recorded (legacy reply)" : "EVALUATED" };
    // Local quote checking is evidence, but not a Jev API reply or a prevented incident.
    if (item.evaluation_status === "EVALUATED" && item.judgment === "fabricated") return { index, choice: "fabricated", evidence: "local quote check" };
    if (item.evaluation_status === "NOT_EVALUATED" && item.judgment === "NOT_EVALUATED") return { index, choice: "NOT_EVALUATED" };
    return null;
  });
  if (output.some(item => !item)) {
    if (status === "REVIEW_REQUIRED") { row.category = "unknown"; row.reason = "INVALID_RECORDED_OUTPUT"; }
    return row;
  }
  row.output = output;
  const reply = mode === "guardrails" ? output.some(item => Object.values(item.hazards).some(v => unit(v.probability))) :
    mode === "citations" ? output.some(item => item.evidence === "recorded Jev reply") : true;
  if (status === "REVIEW_REQUIRED" && reply) row.category = "valid";
  else if (status === "REVIEW_REQUIRED" && mode === "citations") { row.category = "not_evaluated"; row.reason = "LOCAL_CHECK_ONLY"; }
  return row;
}

function createWorkflowReader(homes) {
  const cache = new Map();
  return async () => {
    const rows = new Map(), coverage = [], seen = new Set(), metrics = { hits: 0, parsed: 0 };
    for (const home of homes) {
      const source = { home, state: "ready", directories: 0, loaded: 0, malformed: 0, unreadable: 0,
        oversized: 0, excluded: 0, truncated: false, modes: { guardrails: 0, workflow_context: 0, citations: 0 } };
      coverage.push(source);
      const root = path.join(home, "dely-compliance", "jev-workflow");
      async function read(file, limit, projector) {
        seen.add(file);
        try {
          const stat = await fs.lstat(file);
          if (!stat.isFile() || stat.isSymbolicLink()) { cache.delete(file); source.excluded++; return null; }
          if (stat.size > limit) { cache.delete(file); source.oversized++; return null; }
          const signature = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
          if (cache.get(file)?.signature === signature) {
            metrics.hits++;
            if (!cache.get(file).item) source.malformed++;
            return cache.get(file).item;
          }
          const handle = await fs.open(file, "r");
          let item;
          try {
            const opened = await handle.stat();
            if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > limit) throw Error("Changed source");
            const buffer = Buffer.alloc(limit + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            if (bytesRead > limit) { source.oversized++; return null; }
            try { item = projector(JSON.parse(buffer.toString("utf8", 0, bytesRead))); } catch { item = null; }
          } finally { await handle.close(); }
          metrics.parsed++;
          cache.set(file, { signature, item }); // Projections only: never retain prompt or source bodies.
          if (!item) source.malformed++;
          return item;
        } catch (error) { cache.delete(file); if (error.code !== "ENOENT") source.unreadable++; return null; }
      }
      let entries;
      try {
        for (const directory of [home, path.join(home, "dely-compliance"), root]) {
          const stat = await fs.lstat(directory);
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Unsafe root");
        }
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch (error) { source.state = error.code === "ENOENT" ? "missing" : "unreadable"; continue; }
      source.excluded = entries.filter(entry => entry.isSymbolicLink()).length;
      const dirs = entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && /^[a-f0-9]{64}-[a-f0-9]{16}$/.test(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      source.truncated = dirs.length > 4096;
      let budget = 16384;
      for (const dir of dirs.slice(0, 4096)) {
        if (budget <= 0) { source.truncated = true; break; }
        source.directories++;
        const savedPointer = await read(path.join(root, dir.name.slice(0, 64) + ".json"), 16000, value => {
          if (!object(value) || typeof value.turn !== "string" || value.turn.length > 16000 ||
              typeof value.cwd !== "string" || value.cwd.length > 512 || !(path.isAbsolute(value.cwd) || path.win32.isAbsolute(value.cwd))) return null;
          return { repo: value.cwd.replace(/\\/g, "/"), turnHash: digest(value.turn).slice(0, 16) };
        });
        const pointer = savedPointer?.turnHash === dir.name.slice(65) ? savedPointer : null;
        if (savedPointer && !pointer) source.malformed++;
        let files;
        try {
          const stat = await fs.lstat(path.join(root, dir.name));
          if (!stat.isDirectory() || stat.isSymbolicLink()) { source.excluded++; continue; }
          files = await fs.readdir(path.join(root, dir.name));
        } catch { source.unreadable++; continue; }
        const names = files.filter(name => /^(cache|feedback)-[a-f0-9]{64}\.json$/.test(name)).sort();
        if (names.length > 256 || names.length > budget) source.truncated = true;
        for (const file of names.slice(0, Math.min(256, budget))) {
          budget--;
          const item = await read(path.join(root, dir.name, file), 32768, value => {
            const row = project(value);
            return row && { ...row, id: hash([dir.name, value]) };
          });
          if (!item) continue;
          source.loaded++; source.modes[item.mode]++;
          const row = { ...item, repo: pointer?.repo || null, workspaceSource: pointer ? "matching saved session pointer" : "not recorded",
            sources: [{ home, area: "jev-workflow", task: dir.name, file, workspaceSource: pointer ? "matching saved session pointer" : "not recorded" }] };
          const prior = rows.get(row.id);
          if (!prior) rows.set(row.id, row);
          else {
            prior.sources.push(...row.sources);
            if (!prior.repo && row.repo) { prior.repo = row.repo; prior.workspaceSource = row.workspaceSource; }
            else if (prior.repo && row.repo && prior.repo !== row.repo) {
              prior.repo = null; prior.workspaceSource = "conflicting saved session pointers"; prior.workspaceConflict = true;
            }
            if (prior.workspaceConflict) { prior.repo = null; prior.workspaceSource = "conflicting saved session pointers"; }
          }
        }
      }
      if (source.malformed || source.unreadable || source.oversized || source.excluded || source.truncated) source.state = "partial";
    }
    for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
    return { rows: [...rows.values()], coverage, cache: metrics };
  };
}

module.exports = { createWorkflowReader };
