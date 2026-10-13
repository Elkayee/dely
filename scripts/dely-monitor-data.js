"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");
const { execFile } = require("node:child_process");
const { taskKey } = require("../skills/delivery/scripts/usage.js");

const GRADES = ["easy", "medium_minus", "medium_plus", "hard"];
const ROOTS = [path.join(os.homedir(), ".codex"), process.env.CODEX_HOME,
  path.join(process.env.APPDATA || "", "orca", "codex-runtime-home", "home")].filter(Boolean);
const sourceLabel = (repo) => String(repo || "").replace(/\\/g, "/");
const isProbe = (repo) => /(?:\.tmp-dely|dely-probe|routing-tests-|jev-agent-)/i.test(sourceLabel(repo));
function instant(value) {
  if (typeof value !== "string") return null;
  const normalized = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(" ", "T") + "Z" : value;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

function summarize(events, workers, conversations, options = {}) {
  const since = options.since || 0;
  const repo = options.repo || "";
  const visible = (r) => (!repo || sourceLabel(r.repo) === repo) &&
    (options.probes || !isProbe(r.repo)) && (instant(r.ts) == null || instant(r.ts) >= since);
  const filtered = events.filter(visible);
  const tasks = new Map(), routes = new Map(), launches = new Map();
  for (const e of events) if (e.event === "task_route" && e.run) {
    routes.set(e.run, { key: taskKey(e.repo, e.specSha256, e.contextSha256), difficulty: e.difficulty, repo: e.repo });
  }
  for (const e of filtered) {
    if (e.event === "task_assessment" && e.taskKey) {
      const prior = tasks.get(e.taskKey);
      if (!prior || (instant(e.ts) || 0) >= (instant(prior.ts) || 0)) tasks.set(e.taskKey, e);
    }
    if (e.event === "dispatch" && e.dispatchId) launches.set(e.dispatchId, { ...e, taskKey: routes.get(e.run)?.key || null });
  }
  const known = [...tasks.values()].filter((t) => t.status === "APPROVED" && GRADES.includes(t.difficulty));
  const eligible = known.filter((t) => t.workflow === "dely");
  const launchedTasks = new Set([...launches.values()].map((l) => l.taskKey).filter(Boolean));
  const adopted = eligible.filter((t) => launchedTasks.has(t.taskKey)).length;
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
    grade: routes.get(l.run)?.difficulty || null,
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
    tasks: { recorded: tasks.size, approved: known.length, eligible: eligible.length,
      dispatched: adopted, rate: eligible.length ? adopted / eligible.length : null,
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
      model: t.primary?.model || null, workflow: t.workflow, dispatched: launchedTasks.has(t.taskKey) })),
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
    if (["task_assessment", "task_route", "dispatch"].includes(e.event)) events.push(e);
  });
  const outcomes = await Promise.allSettled([readWorkers(), readConversations(Date.now() - 30 * 86400000)]);
  const workers = outcomes[0].status === "fulfilled" ? outcomes[0].value : { rows: [], available: false };
  const conversations = outcomes[1].status === "fulfilled" ? outcomes[1].value : { rows: [], available: false };
  sources.orca = { available: outcomes[0].status === "fulfilled", total: workers.total ?? null,
    loaded: workers.rows.length, complete: workers.complete || false, scope: workers.scope || null };
  sources.codex = { available: outcomes[1].status === "fulfilled" && conversations.available, files: conversations.files ?? null,
    malformed: conversations.malformed ?? null };
  return { events, workers: workers.rows, conversations: conversations.rows, sources, collectedAt: new Date().toISOString() };
}

module.exports = { GRADES, instant, isProbe, summarize, jsonLines, readConversations, collect };
