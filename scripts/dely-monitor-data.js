"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");
const { execFile } = require("node:child_process");
const { taskKey, runtimeFingerprint } = require("../skills/delivery/scripts/usage.js");
const crypto = require("node:crypto");
const { createJevReader } = require("./dely-monitor-jev.js");
const readJev = createJevReader();

const GRADES = ["easy", "medium_minus", "medium_plus", "hard"];
const ROOTS = [path.join(os.homedir(), ".codex"), process.env.CODEX_HOME,
  path.join(process.env.APPDATA || "", "orca", "codex-runtime-home", "home")].filter(Boolean);
const sourceLabel = (repo) => String(repo || "").replace(/\\/g, "/");
const snapshotKey = (policy, key) => JSON.stringify([policy || null, key]);
const isProbe = (repo) => /(?:\.tmp-dely|dely-probe|routing-tests-|jev-agent-)/i.test(sourceLabel(repo));
function instant(value) {
  if (typeof value !== "string") return null;
  const normalized = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(" ", "T") + "Z" : value;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const basisKey = (e) => JSON.stringify([e.policy, e.taskKey, e.assessment_basis_sha256]);
const validIdentity = (e) => typeof e.policy === "string" && !!e.policy.trim() &&
  e.policy === e.policy.trim() && digest(e.taskKey) && digest(e.assessment_basis_sha256);
const lowTier = (e) => ["easy", "medium_minus"].includes(e.difficulty);
function validNetwork(dispatch) {
  try {
    require("../skills/delivery/scripts/network-fallback.js").validate(dispatch.networkEvidence, {
      specSha256: dispatch.promptSha256, contextSha256: dispatch.contextSha256,
      assessmentBasisSha256: dispatch.assessmentBasisSha256,
    });
    return true;
  } catch (_) { return false; }
}
// Effective time is authoritative; journal append order cannot resolve a review.
function effectiveDecision(rows, asOf, signature) {
  const dated = rows.filter((e) => instant(e.reviewed_at) != null && instant(e.reviewed_at) <= asOf);
  if (!dated.length) return null;
  const latest = Math.max(...dated.map((e) => instant(e.reviewed_at)));
  const current = dated.filter((e) => instant(e.reviewed_at) === latest);
  if (rows.some((e) => instant(e.reviewed_at) == null && signature(e) !== signature(current[0]))) return null;
  return new Set(current.map(signature)).size === 1 ? current[0] : null;
}

function independentMeasures(rows, options, visible, cohort, launches, fallback) {
  const asOf = options.asOf ?? Date.now(), since = options.since || 0, end = options.end ?? asOf;
  const window = { start: new Date(since).toISOString(), end: new Date(end).toISOString(), as_of: new Date(asOf).toISOString() };
  const reviews = new Map();
  for (const e of rows) if (e.event === "task_assessment" && e.status === "APPROVED" &&
      e.reviewer === "codex-control" && validIdentity(e) && visible({ ...e, ts: null })) {
    const list = reviews.get(basisKey(e)) || []; list.push(e); reviews.set(basisKey(e), list);
  }
  const decisionSignature = (e) => JSON.stringify([e.decision_sha256, e.difficulty, e.workflow, e.primary,
    e.decision_source, e.correction_sha256 || null]);
  const effective = (list) => {
    const decision = effectiveDecision(list, asOf, decisionSignature);
    return decision && digest(decision.decision_sha256) && GRADES.includes(decision.difficulty) &&
      ["dely", "direct"].includes(decision.workflow) &&
      ["antigravity", "codex"].includes(decision.primary?.harness) &&
      typeof decision.primary.model === "string" && !!decision.primary.model &&
      typeof decision.primary.effort === "string" && !!decision.primary.effort ? decision : null;
  };
  const populations = [...reviews.values()].filter((list) => {
    const first = Math.min(...list.map((e) => instant(e.reviewed_at) ?? instant(e.ts) ?? Infinity));
    return first >= since && first < end;
  });
  const measure = (numerator, denominator, pending, total) => ({ numerator, denominator,
    rate: denominator ? numerator / denominator : null, pending, coverage: { evaluated: denominator, total },
    status: denominator ? "EVALUATED" : "NOT_EVALUATED", window, as_of: window.as_of });
  const snapshots = new Map();
  for (const list of reviews.values()) for (const e of list) {
    const key = snapshotKey(e.policy, e.taskKey), entries = snapshots.get(key) || [];
    entries.push(e); snapshots.set(key, entries);
  }
  const low = [...snapshots.values()].filter((list) => {
    const first = Math.min(...list.map((e) => instant(e.reviewed_at) ?? instant(e.ts) ?? Infinity));
    return first >= since && first < end && (lowTier(effective(list) || {}) || (!effective(list) && list.some(lowTier)));
  });
  const lowKnown = low.map(effective).filter(Boolean);
  const compliance = lowKnown.filter((e) => e.workflow === "dely" && e.primary?.harness === "antigravity" &&
    e.primary.model === "gemini-3.8-flash-medium" && e.primary.effort === "default");
  const candidates = populations.filter((list) => list.some((e) => e.correction_candidate));
  const candidatesKnown = candidates.map(effective).filter(Boolean);
  const corrections = candidatesKnown.filter((e) => e.difficulty === "medium_minus" &&
    e.decision_source === "control-override-justified" && digest(e.correction_sha256));
  const controls = rows.filter((e) => e.event === "task_control_result");
  const accepted = [], starts = cohort.filter((l) => l.launch.effective.agent === "antigravity"), boundControls = new Set();
  let finalResults = 0;
  for (const l of starts) {
    const records = controls.filter((e) => {
      const d = launches.get(e.dispatchId);
      return e.reviewer === "codex-control" && validIdentity(e) && d?.assessment && d.taskKey === l.taskKey && e.run === d.run &&
        e.policy === d.assessment.policy && e.taskKey === d.assessment.taskKey &&
        e.assessment_basis_sha256 === d.assessment.assessment_basis_sha256 &&
        (instant(e.reviewed_at) == null || instant(e.reviewed_at) >= instant(d.ts));
    });
    records.forEach((e) => boundControls.add(e));
    const result = effectiveDecision(records, asOf, (e) => JSON.stringify([e.verdict, e.dispatchId, e.evidence_sha256]));
    if (result && digest(result.evidence_sha256) && ["accepted", "rejected"].includes(result.verdict)) {
      finalResults++; if (result.verdict === "accepted" &&
        launches.get(result.dispatchId).launch.effective.agent === "antigravity" &&
        !fallback.some((f) => f.taskKey === l.taskKey)) accepted.push(l);
    }
  }
  const audits = new Map();
  for (const e of rows) if (e.event === "task_reference_audit" && e.reviewer === "codex-control" &&
      validIdentity(e) && typeof e.case_id === "string" && e.case_id.trim() &&
      reviews.has(basisKey(e))) {
    const key = JSON.stringify([e.case_id, basisKey(e)]), list = audits.get(key) || [];
    list.push(e); audits.set(key, list);
  }
  let auditPending = 0, auditDenominator = 0, leakage = 0;
  for (const list of audits.values()) {
    const audit = effectiveDecision(list, asOf, (e) => JSON.stringify([e.reference_difficulty, e.evidence_sha256]));
    const system = audit && effective(reviews.get(basisKey(audit)));
    if (!audit || !system || !digest(audit.evidence_sha256) || !GRADES.includes(audit.reference_difficulty)) { auditPending++; continue; }
    if (instant(audit.reviewed_at) < since || instant(audit.reviewed_at) >= end) continue;
    if (["easy", "medium_minus"].includes(audit.reference_difficulty)) {
      auditDenominator++; if (["medium_plus", "hard"].includes(system.difficulty)) leakage++;
    }
  }
  const reviewCoverage = { missingEffectiveEvents: rows.filter((e) => e.event === "task_assessment" &&
    e.status === "APPROVED" && visible({ ...e, ts: null }) &&
    (instant(e.reviewed_at) == null || !digest(e.decision_sha256))).length,
    invalidIdentityEvents: rows.filter((e) => e.event === "task_assessment" && e.status === "APPROVED" &&
      visible({ ...e, ts: null }) && !validIdentity(e)).length };
  const acceptance = measure(accepted.length, finalResults, starts.length - finalResults, starts.length);
  acceptance.coverage.unboundEvents = controls.filter((e) => !boundControls.has(e) && visible({ ...e, ts: null })).length;
  acceptance.coverage.missingEffectiveEvents = controls.filter((e) => visible({ ...e, ts: null }) &&
    (instant(e.reviewed_at) == null || !digest(e.evidence_sha256))).length;
  const auditMeasure = measure(leakage, auditDenominator, auditPending, audits.size);
  const boundAudits = new Set([...audits.values()].flat());
  auditMeasure.coverage.unboundEvents = rows.filter((e) => e.event === "task_reference_audit" &&
    !boundAudits.has(e) && visible({ ...e, ts: null })).length;
  return {
    lowTierPrimaryCompliance: measure(compliance.length, lowKnown.length, low.length - lowKnown.length, low.length),
    correctionUtilization: measure(corrections.length, candidatesKnown.length, candidates.length - candidatesKnown.length, candidates.length),
    agyAcceptedWithoutFallback: acceptance,
    upwardLeakage: auditMeasure,
    decisionEvidenceCoverage: reviewCoverage,
  };
}

function snapshotCohort(events, options, visible) {
  const asOf = options.asOf ?? Date.now(), end = options.end ?? asOf, since = options.since || 0;
  const approved = new Map(), routes = new Map(), first = new Map(), launches = new Map(), conflicts = new Set();
  const signature = (e) => JSON.stringify([e.run, e.repo, e.phase, e.assessmentBasisSha256, e.contextSha256,
    e.promptSha256, e.correctionSha256 || null, e.agent, e.launch?.effective, e.fallbackReason, e.fallbackStage, e.runtime, e.networkEvidence]);
  const decisions = (e) => JSON.stringify([e.assessment_basis_sha256, snapshotKey(e.policy, e.taskKey),
    e.difficulty, e.decision_source, e.correction_sha256 || null]);
  const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const rows = events.filter((e) => instant(e.ts) == null || instant(e.ts) <= asOf)
    .slice().sort((a, b) => (instant(a.ts) || 0) - (instant(b.ts) || 0));
  for (const e of rows) if (e.event === "dispatch" && e.dispatchId) {
    const prior = launches.get(e.dispatchId);
    if (prior && signature(prior) !== signature(e)) conflicts.add(e.dispatchId);
    if (!prior) launches.set(e.dispatchId, e);
  }
  const coverage = { confirmed: 0, bound: 0, unbound: 0, conflicting: conflicts.size,
    unidentified: rows.filter((e) => e.event === "dispatch" && !e.dispatchId && visible({ ...e, ts: null })).length,
    unknownPhase: rows.filter((e) => e.event === "dispatch" && !e.phase && visible({ ...e, ts: null })).length,
    history: options.historyComplete === true ? "COMPLETE" : "NOT_EVALUATED", runtimeUnknown: 0 };
  const boundLaunches = new Map(), visited = new Set();
  for (const e of rows) {
    if (e.event === "task_assessment" && e.status === "APPROVED" && e.reviewer === "codex-control" &&
        e.workflow === "dely" && digest(e.assessment_basis_sha256)) approved.set(decisions(e), e);
    if (e.event === "task_route" && e.run && e.policy && e.repo && digest(e.specSha256) && digest(e.contextSha256)) {
      const key = snapshotKey(e.policy, taskKey(e.repo, e.specSha256, e.contextSha256));
      const assessment = approved.get(decisions({ assessment_basis_sha256: e.assessmentBasisSha256,
        policy: e.policy, taskKey: taskKey(e.repo, e.specSha256, e.contextSha256), difficulty: e.difficulty,
        decision_source: e.reviewSource, correction_sha256: e.correctionSha256 }));
      const list = routes.get(e.run) || [];
      list.push({ ...e, key, assessment }); routes.set(e.run, list);
    }
    if (e.event !== "dispatch" || !e.dispatchId || e.phase !== "implement" ||
        launches.get(e.dispatchId) !== e || visited.has(e.dispatchId)) continue;
    visited.add(e.dispatchId);
    if (visible({ ...e, ts: null })) coverage.confirmed++;
    const route = (routes.get(e.run) || []).findLast((r) => r.repo === e.repo &&
      r.assessmentBasisSha256 === e.assessmentBasisSha256 && r.contextSha256 === e.contextSha256 &&
      r.specSha256 === e.promptSha256 && (r.correctionSha256 || null) === (e.correctionSha256 || null));
    const reviewRows = route?.assessment && rows.filter((r) => r.event === "task_assessment" &&
      r.status === "APPROVED" && r.reviewer === "codex-control" && basisKey(r) === basisKey(route.assessment) &&
      ((instant(r.reviewed_at) != null && instant(r.reviewed_at) <= instant(e.ts)) ||
        (instant(r.reviewed_at) == null && digest(r.decision_sha256))));
    const currentReview = reviewRows?.length && effectiveDecision(reviewRows, instant(e.ts),
      (r) => JSON.stringify([r.decision_sha256, r.difficulty, r.primary, r.decision_source, r.correction_sha256 || null]));
    const reviewConflict = reviewRows?.length && (!currentReview || decisions(currentReview) !== decisions(route.assessment) ||
      JSON.stringify(currentReview.primary) !== JSON.stringify(route.assessment.primary));
    const bound = !conflicts.has(e.dispatchId) && !reviewConflict && route?.assessment && route.assessment.repo === e.repo && instant(e.ts) != null &&
      ["antigravity", "codex"].includes(route.assessment.primary?.harness) &&
      typeof route.assessment.primary.model === "string" && typeof route.assessment.primary.effort === "string" &&
      ["antigravity", "codex"].includes(e.launch?.effective?.agent) &&
      typeof e.launch.effective.model === "string" && typeof e.launch.effective.effort === "string";
    if (visible({ ...e, ts: null })) coverage[bound ? "bound" : "unbound"]++;
    const launch = { ...e, taskKey: route?.key || null, assessment: bound ? route.assessment : null };
    if (!conflicts.has(e.dispatchId)) boundLaunches.set(e.dispatchId, launch);
    if (route && !first.has(route.key)) first.set(route.key, launch);
  }
  const cohort = [...first.values()].filter((l) => l.assessment && visible({ ...l, ts: null }) &&
    instant(l.ts) >= since && instant(l.ts) < end);
  const fraction = (numerator, denominator) => ({ numerator, denominator, rate: denominator ? numerator / denominator : null });
  const primary = cohort.filter((l) => l.assessment.primary?.harness === "antigravity");
  const start = cohort.filter((l) => l.launch.effective.agent === "antigravity");
  const fallback = cohort.filter((l) => [...boundLaunches.values()].some((next) =>
    next.taskKey === l.taskKey && next.assessment && next.launch?.effective?.agent === "codex" &&
    ["easy", "medium_minus"].includes(next.assessment.difficulty) && next.assessment.primary?.harness === "antigravity" &&
    next.launch.effective.model === "gpt-6-luna" && next.launch.effective.effort === "max" &&
    ((next.fallbackReason === "quota" && next.fallbackStage === 1) ||
      (next.fallbackReason === "model_unavailable" && next.fallbackStage === null && next.pinPhase === "implement_backup_2") ||
      (next.fallbackReason === "network" && next.fallbackStage === 1 && validNetwork(next)))));
  const runtimeCohorts = new Map();
  for (const l of cohort) {
    const recorded = l.runtime;
    const runtime = recorded && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(recorded.version) &&
      ["router", "dispatcher", "usage", ...(Object.hasOwn(recorded, "network") ? ["network"] : [])].every((field) => digest(recorded[field])) &&
      JSON.stringify(recorded) === JSON.stringify(l.assessment.runtime) ?
      Object.fromEntries(["version", "router", "dispatcher", "usage", ...(Object.hasOwn(recorded, "network") ? ["network"] : [])].map((field) => [field, recorded[field]])) : null;
    const verified = runtime && (options.runtimes || []).some((r) => r.verified && JSON.stringify(r.fingerprint) === JSON.stringify(runtime));
    if (!verified) coverage.runtimeUnknown++;
    const key = JSON.stringify([l.assessment.policy, runtime]);
    const row = runtimeCohorts.get(key) || { policy: l.assessment.policy, fingerprint: runtime,
      verification: verified ? "VERIFIED" : "NOT_EVALUATED", snapshots: 0 };
    row.snapshots++; runtimeCohorts.set(key, row);
  }
  return { launches: boundLaunches, cohort, first,
    metrics: { agyPrimary: fraction(primary.length, cohort.length), agyStart: fraction(start.length, cohort.length),
      lunaFallback: fraction(fallback.filter((l) => l.assessment.primary?.harness === "antigravity").length, primary.length),
      ...independentMeasures(rows, options, visible, cohort, boundLaunches, fallback) },
    coverage, runtimeCohorts: [...runtimeCohorts.values()],
    window: { start: new Date(since).toISOString(), end: new Date(end).toISOString(), as_of: new Date(asOf).toISOString() } };
}

function summarize(events, workers, conversations, options = {}) {
  const since = options.since || 0;
  const repo = sourceLabel(options.repo);
  const visible = (r) => (!repo || sourceLabel(r.repo) === repo) &&
    (options.probes || !isProbe(r.repo)) && (instant(r.ts) == null ||
      (instant(r.ts) >= since && instant(r.ts) <= (options.asOf ?? Date.now())));
  const filtered = events.filter((e) => visible(e) && (instant(e.ts) == null || instant(e.ts) <= (options.asOf ?? Date.now())));
  const tasks = new Map();
  const snapshots = snapshotCohort(events, options, visible);
  const launches = new Map([...snapshots.launches].filter(([, l]) => visible(l)));
  for (const e of filtered) {
    if (e.event === "task_assessment" && e.taskKey) {
      const key = snapshotKey(e.policy, e.taskKey);
      const prior = tasks.get(key);
      if (!prior || (instant(e.ts) || 0) >= (instant(prior.ts) || 0)) tasks.set(key, e);
    }
  }
  const known = [...tasks.values()].filter((t) => t.status === "APPROVED" && GRADES.includes(t.difficulty));
  const eligible = known.filter((t) => t.workflow === "dely");
  const launchedTasks = new Set(snapshots.cohort.map((l) => l.taskKey));
  const adopted = eligible.filter((t) => launchedTasks.has(snapshotKey(t.policy, t.taskKey))).length;
  const models = new Map();
  for (const l of launches.values()) {
    const model = l.launch?.effective?.model || "Unknown";
    const m = models.get(model) || { model, launches: 0, fallbacks: 0 };
    m.launches++; if (l.fallbackReason) m.fallbacks++; models.set(model, m);
  }
  const workerById = new Map(workers.filter(visible).map((w) => [w.id, w]));
  const jobs = [...workerById.values()];
  const activity = [...launches.values()].map((l) => ({
    id: l.dispatchId, run: l.run, repo: l.repo, ts: l.ts,
    task_title: l.assessment?.task_title || null, domain: l.assessment?.domain || null,
    grade: l.assessment?.difficulty || null,
    model: l.launch?.effective?.model || null, effort: l.launch?.effective?.effort || null,
    snapshotId: l.taskKey, bound: !!l.assessment, requestedModel: l.launch?.requested?.model || null,
    status: workerById.get(l.dispatchId)?.status || "Not observed", fallback: l.fallbackReason || null,
    source: "Dely log",
  }));
  const launchIds = new Set(activity.map((l) => l.id));
  for (const w of jobs) if (!launchIds.has(w.id)) activity.push({
    ...w, grade: null, model: w.model || null, fallback: null, source: "Orca",
  });
  const sessions = conversations.filter(visible);
  const conversationModels = new Map();
  for (const c of sessions) {
    const model = c.model || "Unknown";
    const row = conversationModels.get(model) || { model, turns: 0, sessions: new Set() };
    row.turns++; row.sessions.add(c.session); conversationModels.set(model, row);
  }
  const detailTasks = new Map();
  for (const [id, t] of tasks) detailTasks.set(id, { id, repo: sourceLabel(t.repo),
    task_title: t.task_title || null, domain: t.domain || null, grade: t.status === "APPROVED" ? t.difficulty || null : null,
    latestApproval: { grade: t.difficulty || null, status: t.status || null, ts: t.ts },
    ts: t.ts, status: t.status !== "APPROVED" ? t.status || "NOT_EVALUATED" :
      t.workflow === "dely" ? "Awaiting dispatch" : t.workflow === "direct" ? "Direct Control work / no Dely dispatch expected" : "Unknown workflow", attempts: [] });
  for (const [id, task] of detailTasks) {
    const first = snapshots.first.get(id);
    if (!first?.assessment) continue;
    task.task_title = first.assessment.task_title || null; task.domain = first.assessment.domain || null;
    task.grade = first.assessment.difficulty || null; task.ts = first.ts;
    task.confirmedSnapshot = true; task.inSnapshotWindow = snapshots.cohort.some((s) => s.taskKey === id);
    task.status = "First implementation confirmed / no attempts in this window";
    task.firstImplementation = { model: first.launch.effective.model, effort: first.launch.effective.effort };
  }
  for (const t of filtered.filter((e) => e.event === "task_assessment" && !e.taskKey)) {
    const id = `unidentified:${crypto.createHash("sha256").update(JSON.stringify(t)).digest("hex")}`;
    detailTasks.set(id, { id, repo: sourceLabel(t.repo), task_title: null, grade: null,
      ts: t.ts, status: "Missing task identity / unconfirmed assessment", attempts: [] });
  }
  for (const l of launches.values()) {
    const first = snapshots.first.get(l.taskKey);
    const frozen = first?.assessment;
    const id = l.taskKey || `dispatch:${l.dispatchId}`;
    const task = detailTasks.get(id) || { id, repo: sourceLabel(l.repo), latestApproval: null, attempts: [] };
    // Full-history first confirmation owns snapshot metadata, even outside the reset window.
    const metadata = frozen || l.assessment;
    task.task_title = metadata?.task_title || null; task.domain = metadata?.domain || null;
    task.grade = metadata?.difficulty || null; task.ts = first?.ts || l.ts;
    task.status = "Launch observed"; task.confirmedSnapshot = !!frozen;
    task.firstImplementation = frozen ? { model: first.launch.effective.model, effort: first.launch.effective.effort } : null;
    task.inSnapshotWindow = snapshots.cohort.some((s) => s.taskKey === l.taskKey);
    task.attempts.push(activity.find((a) => a.id === l.dispatchId));
    detailTasks.set(id, task);
  }
  for (const w of activity.filter((a) => a.source === "Orca")) detailTasks.set(`worker:${w.id}`, {
    id: `worker:${w.id}`, repo: sourceLabel(w.repo), task_title: null, grade: null,
    ts: w.ts, status: w.status || "Unknown", attempts: [w] });
  const result = {
    metrics: snapshots.metrics, coverage: snapshots.coverage, window: snapshots.window,
    runtimeCohorts: snapshots.runtimeCohorts,
    pending: eligible.filter((t) => !snapshots.first.has(snapshotKey(t.policy, t.taskKey))).length,
    tasks: { recorded: tasks.size, events: filtered.filter((e) => e.event === "task_assessment").length, approved: known.length, eligible: eligible.length,
      dispatched: adopted, rate: snapshots.metrics.agyStart.rate,
      unknown: [...tasks.values()].filter((t) => !GRADES.includes(t.difficulty)).length,
      grades: GRADES.map((grade) => ({ grade, count: known.filter((t) => t.difficulty === grade).length })) },
    models: [...models.values()].sort((a, b) => b.launches - a.launches),
    jobs: { count: jobs.length, succeeded: jobs.filter((w) => w.status === "succeeded").length,
      states: [...new Set(jobs.map((w) => w.status || "Unknown"))].map((status) => ({ status,
        count: jobs.filter((w) => (w.status || "Unknown") === status).length })),
      failed: jobs.filter((w) => w.status === "failed").length,
      active: jobs.filter((w) => ["running", "queued", "starting"].includes(w.status)).length,
      unknownModel: jobs.filter((w) => !w.model && !launches.has(w.id)).length },
    conversations: { sessions: new Set(sessions.map((c) => c.session)).size, turns: sessions.length,
      models: [...conversationModels.values()].map((r) => ({ model: r.model, turns: r.turns, sessions: r.sessions.size })) },
    activity: activity.sort((a, b) => (instant(b.ts) || 0) - (instant(a.ts) || 0)),
    taskDetails: [...detailTasks.values()].sort((a, b) => (instant(b.ts) || 0) - (instant(a.ts) || 0)),
    approvals: known.map((t) => ({ id: t.taskKey, repo: t.repo, ts: t.ts, grade: t.difficulty,
      task_title: t.task_title || null, domain: t.domain || null,
      model: t.primary?.model || null, workflow: t.workflow, policy: t.policy || null,
      dispatched: launchedTasks.has(snapshotKey(t.policy, t.taskKey)) })),
    repos: [...new Set([...events, ...workers, ...conversations].map((r) => sourceLabel(r.repo)).filter(Boolean))].sort(),
  };
  if (!options.projectSummary) {
    const allOptions = { ...options, repo: "", projectSummary: true };
    const allVisible = (r) => (options.probes || !isProbe(r.repo)) && (instant(r.ts) == null ||
      (instant(r.ts) >= since && instant(r.ts) <= (options.asOf ?? Date.now())));
    const rows = [...events, ...workers, ...conversations].filter(allVisible);
    const paths = [...new Set(rows.map((r) => sourceLabel(r.repo)).filter(Boolean))].sort();
    const project = (path, summary) => ({ repo: path, name: path.split("/").filter(Boolean).pop(),
      snapshots: summary.metrics.agyStart.denominator, agyStart: summary.metrics.agyStart,
      tasks: summary.tasks, pending: summary.pending, models: summary.models,
      jobs: summary.jobs, conversations: summary.conversations,
      launches: summary.activity.filter((a) => a.source === "Dely log").length,
      coverage: summary.coverage });
    result.projects = paths.map((path) => project(path, summarize(events, workers, conversations, { ...allOptions, repo: path })));
    const unknown = (r) => !sourceLabel(r.repo);
    result.unassigned = { records: rows.filter(unknown).length,
      ...project("", summarize(events.filter(unknown), workers.filter(unknown), conversations.filter(unknown), allOptions)) };
  }
  return result;
}

async function jsonLines(file, visit) {
  let malformed = 0;
  const input = fs.createReadStream(file, { encoding: "utf8" });
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let item;
    try { item = JSON.parse(line); } catch (_) { malformed++; continue; }
    visit(item);
  }
  return malformed;
}

function createConversationReader({ roots = ROOTS, readLines = jsonLines, now = Date.now } = {}) {
  const cache = new Map();
  return async function readConversations(since) {
    const files = new Map();
    for (const root of [...new Set(roots)]) {
      const sessions = path.join(root, "sessions");
      if (!fs.existsSync(sessions)) continue;
      for (let time = now(); time >= since - 86400000; time -= 86400000) {
        const date = new Date(time).toISOString().slice(0, 10).split("-");
        const folder = path.join(sessions, ...date);
        if (!fs.existsSync(folder)) continue;
        for (const name of fs.readdirSync(folder)) if (name.endsWith(".jsonl")) {
          const file = path.join(folder, name), stat = fs.statSync(file);
          const signature = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
          if (!files.has(name) || files.get(name).size < stat.size) files.set(name, { file, size: stat.size, signature });
        }
      }
    }
    const turns = new Map(); let malformed = 0, hits = 0, parsed = 0;
    for (const file of cache.keys()) if (!fs.existsSync(file)) cache.delete(file);
    for (const { file, signature } of files.values()) {
      let entry = cache.get(file);
      if (entry?.signature === signature) hits++;
      else {
        let session = null, root = true;
        const rows = [];
        const errors = await readLines(file, (item) => {
          if (item.type === "session_meta") {
            session = item.payload.id; root = !JSON.stringify(item.payload.source || "").includes("subagent");
          }
          if (root && session && item.type === "turn_context") {
            const p = item.payload, id = p.turn_id || item.timestamp;
            rows.push({ id, session, model: p.model || null, repo: p.cwd, ts: item.timestamp });
          }
        });
        entry = { signature, rows, malformed: errors }; cache.set(file, entry); parsed++;
      }
      malformed += entry.malformed;
      for (const { id, ...row } of entry.rows) if (instant(row.ts) >= since) turns.set(row.session + ":" + id, row);
    }
    return { rows: [...turns.values()], files: files.size, malformed,
      cache: { hits, parsed }, available: roots.some((root) => fs.existsSync(path.join(root, "sessions"))) };
  };
}

const readConversations = createConversationReader();

function orca(args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }; delete env.ORCA_RUN_ID; delete env.ORCA_TERMINAL_HANDLE;
    const argv = process.platform === "win32" ? ["/d", "/s", "/c", "orca " + args.join(" ")] : args;
    execFile(process.platform === "win32" ? "cmd.exe" : "orca", argv,
      { env, timeout: 8000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
        if (error) return reject(new Error("Orca worker records are currently unavailable"));
        try { resolve(JSON.parse(stdout)); } catch (_) { reject(new Error("Orca returned an unreadable record")); }
      });
  });
}

async function readWorkers() {
  const rows = []; let cursor = null, total = null, pages = 0, scope = null;
  do {
    if (cursor && !/^[A-Za-z0-9_-]+={0,2}$/.test(cursor)) throw new Error("Unexpected Orca cursor");
    const result = (await orca(["orchestration", "worker-list", "--limit", "100", "--json", ...(cursor ? ["--cursor", cursor] : [])])).result;
    if (!result) throw new Error("Orca worker source is unavailable");
    total = result.page?.total ?? total; scope = result.scope?.source || scope;
    for (const w of result.workers || []) rows.push({
      id: w.dispatchId, run: w.runId, repo: w.resource?.worktreeId?.split("::").slice(1).join("::") || null,
      ts: w.projection?.evidence?.lastObservedAt || null, status: w.workerState || "Unknown",
      model: typeof w.projection?.provider?.model === "string" ? w.projection.provider.model : null,
    });
    cursor = result.page?.hasMore ? result.page.nextCursor : null; pages++;
  } while (cursor && pages < 10);
  return { rows, total, pages, complete: !cursor, scope };
}

async function collect(options = {}) {
  const file = options.journal || path.join(os.homedir(), ".dely", "log.jsonl"), events = [];
  const sources = { log: { file, enabled: fs.existsSync(path.dirname(file)), present: fs.existsSync(file), malformed: 0 } };
  if (sources.log.present) sources.log.malformed = await jsonLines(file, (e) => {
    if (e && ["task_assessment", "task_route", "dispatch", "task_control_result", "task_reference_audit"].includes(e.event)) events.push(e);
  });
  let workers = [], conversations = [], jev = [];
  const collectedAt = new Date().toISOString();
  sources.orca = { available: false, state: "loading", total: null, loaded: 0, complete: false, scope: null };
  sources.codex = { available: false, state: "loading", files: null, malformed: null };
  sources.jev = { available: false, state: "loading", coverage: [] };
  sources.runtimes = readRuntimes();
  const snapshot = () => ({ events, workers, conversations, jev, sources: { ...sources }, collectedAt });
  const publish = () => options.onUpdate?.(snapshot());
  publish();
  await Promise.all([
    (async () => {
      try {
        const result = await (options.readJev || readJev)();
        jev = result.rows;
        sources.jev = { available: result.coverage.some((s) => ["ready", "partial"].includes(s.state)),
          state: result.coverage.every((s) => s.state === "ready") ? "ready" : "partial",
          asOf: new Date().toISOString(), coverage: result.coverage, cache: result.cache };
      } catch (_) { sources.jev = { ...sources.jev, state: "error" }; }
      publish();
    })(),
    (async () => {
      try {
        const result = await (options.readWorkers || readWorkers)();
        workers = result.rows;
        sources.orca = { available: true, state: "ready", asOf: new Date().toISOString(),
          total: result.total ?? null, loaded: workers.length, complete: result.complete || false, scope: result.scope || null };
      } catch (_) { sources.orca = { ...sources.orca, state: "error" }; }
      publish();
    })(),
    (async () => {
      try {
        const result = await (options.readConversations || readConversations)(Date.now() - 30 * 86400000);
        conversations = result.rows;
        sources.codex = { available: !!result.available, state: result.available ? "ready" : "unavailable",
          asOf: new Date().toISOString(), files: result.files ?? null, malformed: result.malformed ?? null, cache: result.cache || null };
      } catch (_) { sources.codex = { ...sources.codex, state: "error" }; }
      publish();
    })(),
  ]);
  return snapshot();
}

function readRuntimes(homes = ROOTS) {
  return [...new Set(homes)].map((home) => {
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(home, "dely-compliance/settings.json"), "utf8"));
      const directory = path.dirname(settings.routing), dependencies = settings.dependencies || {};
      const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      const required = [settings.routing, settings.dely, settings.advisor, path.join(directory, "usage.js")];
      if (fs.existsSync(path.join(directory, "network-fallback.js"))) required.push(path.join(directory, "network-fallback.js"));
      const verified = settings.dely === path.join(directory, "dely.js") && required.every((file) => dependencies[file]) &&
        Object.entries(dependencies).every(([file, value]) => hash(file) === value);
      return { home, verified, fingerprint: runtimeFingerprint(directory) };
    } catch (_) { return { home, verified: false, fingerprint: null }; }
  });
}

module.exports = { GRADES, instant, isProbe, summarize, jsonLines, createConversationReader, readConversations, readRuntimes, collect };
