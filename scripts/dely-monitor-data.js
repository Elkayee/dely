"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");
const { execFile } = require("node:child_process");
const { taskKey, runtimeFingerprint } = require("../skills/delivery/scripts/usage.js");
const crypto = require("node:crypto");

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

function snapshotCohort(events, options, visible) {
  const asOf = options.asOf ?? Date.now(), end = options.end ?? asOf, since = options.since || 0;
  const approved = new Map(), routes = new Map(), first = new Map(), launches = new Map(), conflicts = new Set();
  const signature = (e) => JSON.stringify([e.run, e.repo, e.phase, e.assessmentBasisSha256, e.contextSha256,
    e.promptSha256, e.correctionSha256 || null, e.agent, e.launch?.effective, e.fallbackReason, e.fallbackStage, e.runtime]);
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
    const bound = !conflicts.has(e.dispatchId) && route?.assessment && route.assessment.repo === e.repo && instant(e.ts) != null &&
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
  const fallback = primary.filter((l) => [...boundLaunches.values()].some((next) =>
    next.taskKey === l.taskKey && next.assessment && next.launch?.effective?.agent === "codex" &&
    next.assessment.assessment_basis_sha256 === l.assessment.assessment_basis_sha256 &&
    (next.assessment.correction_sha256 || null) === (l.assessment.correction_sha256 || null) &&
    next.launch.effective.model === "gpt-6-luna" && next.launch.effective.effort === "max" &&
    ((next.fallbackReason === "quota" && next.fallbackStage === 1) ||
      (next.fallbackReason === "model_unavailable" && next.fallbackStage === null && next.pinPhase === "implement_backup_2"))));
  const runtimeCohorts = new Map();
  for (const l of cohort) {
    const recorded = l.runtime;
    const runtime = recorded && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(recorded.version) &&
      ["router", "dispatcher", "usage"].every((field) => digest(recorded[field])) &&
      JSON.stringify(recorded) === JSON.stringify(l.assessment.runtime) ?
      Object.fromEntries(["version", "router", "dispatcher", "usage"].map((field) => [field, recorded[field]])) : null;
    const verified = runtime && (options.runtimes || []).some((r) => r.verified && JSON.stringify(r.fingerprint) === JSON.stringify(runtime));
    if (!verified) coverage.runtimeUnknown++;
    const key = JSON.stringify([l.assessment.policy, runtime]);
    const row = runtimeCohorts.get(key) || { policy: l.assessment.policy, fingerprint: runtime,
      verification: verified ? "VERIFIED" : "NOT_EVALUATED", snapshots: 0 };
    row.snapshots++; runtimeCohorts.set(key, row);
  }
  return { launches: boundLaunches, cohort, first,
    metrics: { agyPrimary: fraction(primary.length, cohort.length), agyStart: fraction(start.length, cohort.length),
      lunaFallback: fraction(fallback.length, primary.length),
      agyAcceptedWithoutFallback: { numerator: null, denominator: null, rate: null, pending: null, status: "NOT_EVALUATED" } },
    coverage, runtimeCohorts: [...runtimeCohorts.values()],
    window: { start: new Date(since).toISOString(), end: new Date(end).toISOString(), as_of: new Date(asOf).toISOString() } };
}

function summarize(events, workers, conversations, options = {}) {
  const since = options.since || 0;
  const repo = options.repo || "";
  const visible = (r) => (!repo || sourceLabel(r.repo) === repo) &&
    (options.probes || !isProbe(r.repo)) && (instant(r.ts) == null || instant(r.ts) >= since);
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
    model: l.launch?.effective?.model || null, requestedModel: l.launch?.requested?.model || null,
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
  return {
    metrics: snapshots.metrics, coverage: snapshots.coverage, window: snapshots.window,
    runtimeCohorts: snapshots.runtimeCohorts,
    pending: eligible.filter((t) => !snapshots.first.has(snapshotKey(t.policy, t.taskKey))).length,
    tasks: { recorded: tasks.size, events: filtered.filter((e) => e.event === "task_assessment").length, approved: known.length, eligible: eligible.length,
      dispatched: adopted, rate: snapshots.metrics.agyStart.rate,
      unknown: [...tasks.values()].filter((t) => !GRADES.includes(t.difficulty)).length,
      grades: GRADES.map((grade) => ({ grade, count: known.filter((t) => t.difficulty === grade).length })) },
    models: [...models.values()].sort((a, b) => b.launches - a.launches),
    jobs: { count: jobs.length, succeeded: jobs.filter((w) => w.status === "succeeded").length,
      failed: jobs.filter((w) => w.status === "failed").length,
      active: jobs.filter((w) => ["running", "queued", "starting"].includes(w.status)).length,
      unknownModel: jobs.filter((w) => !w.model && !launches.has(w.id)).length },
    conversations: { sessions: new Set(sessions.map((c) => c.session)).size, turns: sessions.length,
      models: [...conversationModels.values()].map((r) => ({ model: r.model, turns: r.turns, sessions: r.sessions.size })) },
    activity: activity.sort((a, b) => (instant(b.ts) || 0) - (instant(a.ts) || 0)),
    approvals: known.map((t) => ({ id: t.taskKey, repo: t.repo, ts: t.ts, grade: t.difficulty,
      task_title: t.task_title || null, domain: t.domain || null,
      model: t.primary?.model || null, workflow: t.workflow, policy: t.policy || null,
      dispatched: launchedTasks.has(snapshotKey(t.policy, t.taskKey)) })),
    repos: [...new Set([...events, ...workers, ...conversations].map((r) => sourceLabel(r.repo)).filter(Boolean))].sort(),
  };
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

async function readConversations(since) {
  const files = new Map();
  for (const root of [...new Set(ROOTS)]) {
    const sessions = path.join(root, "sessions");
    if (!fs.existsSync(sessions)) continue;
    for (let time = Date.now(); time >= since - 86400000; time -= 86400000) {
      const date = new Date(time).toISOString().slice(0, 10).split("-");
      const folder = path.join(sessions, ...date);
      if (!fs.existsSync(folder)) continue;
      for (const name of fs.readdirSync(folder)) if (name.endsWith(".jsonl")) {
        const file = path.join(folder, name), size = fs.statSync(file).size;
        if (!files.has(name) || files.get(name).size < size) files.set(name, { file, size });
      }
    }
  }
  const turns = new Map(); let malformed = 0;
  for (const { file } of files.values()) {
    let session = null, root = true;
    malformed += await jsonLines(file, (item) => {
      if (item.type === "session_meta") {
        session = item.payload.id; root = !JSON.stringify(item.payload.source || "").includes("subagent");
      }
      if (root && session && item.type === "turn_context" && instant(item.timestamp) >= since) {
        const p = item.payload, id = p.turn_id || item.timestamp;
        turns.set(session + ":" + id, { session, model: p.model || null, repo: p.cwd, ts: item.timestamp });
      }
    });
  }
  return { rows: [...turns.values()], files: files.size, malformed,
    available: ROOTS.some((root) => fs.existsSync(path.join(root, "sessions"))) };
}

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

async function collect() {
  const file = path.join(os.homedir(), ".dely", "log.jsonl"), events = [];
  const sources = { log: { file, enabled: fs.existsSync(path.dirname(file)), present: fs.existsSync(file), malformed: 0 } };
  if (sources.log.present) sources.log.malformed = await jsonLines(file, (e) => {
    if (e && ["task_assessment", "task_route", "dispatch"].includes(e.event)) events.push(e);
  });
  const outcomes = await Promise.allSettled([readWorkers(), readConversations(Date.now() - 30 * 86400000)]);
  const workers = outcomes[0].status === "fulfilled" ? outcomes[0].value : { rows: [], available: false };
  const conversations = outcomes[1].status === "fulfilled" ? outcomes[1].value : { rows: [], available: false };
  sources.orca = { available: outcomes[0].status === "fulfilled", total: workers.total ?? null,
    loaded: workers.rows.length, complete: workers.complete || false, scope: workers.scope || null };
  sources.codex = { available: outcomes[1].status === "fulfilled" && conversations.available, files: conversations.files ?? null,
    malformed: conversations.malformed ?? null };
  sources.runtimes = readRuntimes();
  return { events, workers: workers.rows, conversations: conversations.rows, sources, collectedAt: new Date().toISOString() };
}

function readRuntimes() {
  return [...new Set(ROOTS)].map((home) => {
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(home, "dely-compliance/settings.json"), "utf8"));
      const directory = path.dirname(settings.routing), dependencies = settings.dependencies || {};
      const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      const required = [settings.routing, settings.dely, settings.advisor, path.join(directory, "usage.js")];
      const verified = settings.dely === path.join(directory, "dely.js") && required.every((file) => dependencies[file]) &&
        Object.entries(dependencies).every(([file, value]) => hash(file) === value);
      return { home, verified, fingerprint: runtimeFingerprint(directory) };
    } catch (_) { return { home, verified: false, fingerprint: null }; }
  });
}

module.exports = { GRADES, instant, isProbe, summarize, jsonLines, readConversations, readRuntimes, collect };
