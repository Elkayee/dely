#!/usr/bin/env node
"use strict";

const { execFileSync, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const seconds = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
const ACK_S = seconds(process.env.DELY_ACK_S, process.platform === "win32" ? 180 : 60);
const POLL_S = Number(process.env.DELY_POLL_S || 15);
const PROGRESS_S = Number(process.env.DELY_PROGRESS_S || 60);
const PREFLIGHT_S = seconds(process.env.DELY_PREFLIGHT_S, 150);
const NOTIFY_RETRY_S = seconds(process.env.DELY_NOTIFY_RETRY_S, 30);
const NOTIFY_GIVEUP_S = seconds(process.env.DELY_NOTIFY_GIVEUP_S, 1800);
const positiveInt = (v, d) => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : d);
const CONTROL_STEP_LIMIT = positiveInt(process.env.DELY_CONTROL_STEP_LIMIT, 12);
const SAME_FAILURE_LIMIT = positiveInt(process.env.DELY_SAME_FAILURE_LIMIT, 2);

function orca(args) {
  const bin = process.env.ORCA_CLI_COMMAND || "orca";
  const isScript = /\.m?js$/i.test(bin);
  const argv = isScript ? [bin, ...args, "--json"] : [...args, "--json"];
  const cmd = isScript ? process.execPath : bin;
  const commandKind = args.slice(0, 2).filter((x) => x && !String(x).startsWith("-")).join(" ") || "orca";
  try {
    const out = execFileSync(cmd, argv, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 << 20,
      env: process.env,
    });
    return JSON.parse(out || "{}");
  } catch (e) {
    if (e.stdout && String(e.stdout).trim()) {
      try {
        const parsed = JSON.parse(String(e.stdout).trim());
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
          return parsed;
        }
      } catch (_) {}
    }
    const code = e.code || (e.status != null ? "EXIT_" + e.status : "SPAWN_ERROR");
    const stderrMsg = (e.stderr && String(e.stderr).trim()) || "";
    const msg = code + " executing " + commandKind + (stderrMsg ? ": " + stderrMsg : "");
    return {
      ok: false,
      error: {
        code,
        commandKind,
        message: msg,
      },
    };
  }
}

function flags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const n = argv[i + 1];
      if (n != null && !String(n).startsWith("--")) {
        f[argv[i].slice(2)] = n;
        i++;
      } else {
        f[argv[i].slice(2)] = true;
      }
    }
  }
  return f;
}

const PACKAGE_ROOT = path.resolve(__dirname, "../../..");
const HARNESSES_PATH = path.join(PACKAGE_ROOT, "harnesses.json");

let _harnesses;
function loadHarnesses() {
  if (_harnesses) return _harnesses;
  let raw;
  try {
    raw = fs.readFileSync(HARNESSES_PATH, "utf8");
  } catch (e) {
    fail("cannot read " + HARNESSES_PATH + ": " + (e.message || e));
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    fail("cannot parse " + HARNESSES_PATH + ": " + (e.message || e));
  }
  if (!data || !Array.isArray(data.harnesses)) {
    fail(HARNESSES_PATH + " has no harnesses array");
  }
  _harnesses = data.harnesses;
  return _harnesses;
}

function effortRequiresModel() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(HARNESSES_PATH, "utf8"));
  } catch (_) {
    return true;
  }
  return raw && raw.effortRequiresModel !== false;
}

function harnessById(id) {
  return loadHarnesses().find((h) => h.id === id);
}

function pin(repo, phase) {
  // Preserve the checkout's modern per-phase pins; quota rows remain local POC deployment choices.
  if (phase === "implement" || phase === "review") {
    let mainLocal = null;
    try {
      const common = String(execFileSync("git", ["-C", repo, "rev-parse", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).trim();
      mainLocal = path.join(path.dirname(path.resolve(repo, common)), ".dely", "local", "pins.json");
    } catch (_) { /* A non-Git workspace can still use its own pins. */ }
    const personal = path.join(repo, ".dely", "local", "pins.json");
    const files = [fs.existsSync(personal) ? personal : mainLocal, path.join(repo, ".dely", "pins.json")].filter(Boolean);
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const values = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Object.hasOwn(values, phase)) continue;
      const value = values[phase];
      const h = value && harnessById(value.harness);
      if (!h || typeof value.model !== "string" || !value.model || typeof value.effort !== "string" || !value.effort) throw new Error("invalid " + phase + " pin in " + file);
      return { phase, agent: h.id, model: value.model, effort: value.effort,
        modelFlag: h.modelFlag, effortFlag: h.effortFlag, effortInModel: h.effortInModel, modelPin: h.modelPin,
        source: file === path.join(repo, ".dely", "pins.json") ? "team" : "local", file };
    }
  }
  return legacyPin(repo, phase);
}

function legacyPin(repo, phase) {
  const re = new RegExp("^\\|\\s*`?" + phase + "`?\\s*\\|");
  const files = [
    path.join(repo, "AGENTS.md"),
    path.join(os.homedir(), ".codex", "AGENTS.md"),
  ];
  let row;
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch (e) {
      if (e && e.code === "ENOENT") continue;
      throw e;
    }
    row = content.split("\n").find((l) => re.test(l));
    if (row) break;
  }
  if (!row) throw new Error("no " + phase + " pin in project or global AGENTS.md");
  const [, harness, model, effort] = row.split("|").slice(1).map((c) => c.trim().replace(/`/g, ""));
  const h = loadHarnesses().find((x) => x.name === harness);
  if (!h) throw new Error("unknown harness " + harness);
  return { phase, agent: h.id, model, effort, modelFlag: h.modelFlag, effortFlag: h.effortFlag, effortInModel: h.effortInModel, modelPin: h.modelPin };
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let currentCommand = null;
let currentFlags = null;
const out = (line, code) => {
  console.log(typeof line === "string" ? line : JSON.stringify(line));
  if (code != null && currentCommand && currentFlags && currentFlags.run) {
    if (code === 0) guardSuccess(currentFlags.run, currentCommand);
    else guardFailure(currentFlags.run, currentCommand, line);
  }
  if (code != null) process.exit(code);
};

function guardPath(run) {
  if (!run) return null;
  const key = crypto.createHash("sha256").update(String(run)).digest("hex").slice(0, 24);
  return path.join(os.tmpdir(), "dely-loop-guard-" + key + ".json");
}

function readGuard(run) {
  try {
    const state = JSON.parse(fs.readFileSync(guardPath(run), "utf8"));
    return state && typeof state === "object" ? state : { steps: 0, failures: {} };
  } catch (_) {
    return { steps: 0, failures: {} };
  }
}

function writeGuard(run, state) {
  try {
    fs.writeFileSync(guardPath(run), JSON.stringify(state));
  } catch (_) {
    /* safety state is best-effort */
  }
}

function clearGuard(run) {
  try {
    fs.unlinkSync(guardPath(run));
  } catch (_) {
    /* absent */
  }
}

function guardFailure(run, command, line) {
  if (!run || !["dispatch", "wait", "wait-bg"].includes(command)) return;
  const state = readGuard(run);
  state.failures = state.failures || {};
  const fingerprint = String(typeof line === "string" ? line : JSON.stringify(line))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const prev = state.failures[command];
  const count = prev && prev.fingerprint === fingerprint ? Number(prev.count || 0) + 1 : 1;
  state.failures[command] = { fingerprint, count };
  if (count >= SAME_FAILURE_LIMIT) {
    state.blockedReason =
      command + " returned the same failure " + count + " times; automatic retry stopped";
  }
  writeGuard(run, state);
}

function guardSuccess(run, command) {
  if (!run) return;
  const state = readGuard(run);
  if (state.failures) delete state.failures[command];
  if (command === "wait") {
    state.steps = 0;
    delete state.blockedReason;
  }
  writeGuard(run, state);
}

function guardBefore(command, f) {
  if (!f || !f.run || !["preflight", "dispatch", "wait", "wait-bg"].includes(command)) return;
  if (process.env.DELY_LOOP_GUARD_OVERRIDE === "1") {
    clearGuard(f.run);
    return;
  }
  const state = readGuard(f.run);
  if (state.blockedReason) {
    console.log(
      "LOOP_GUARD " +
        state.blockedReason +
        ". Stop and report to the user. After explicit user direction, retry once with DELY_LOOP_GUARD_OVERRIDE=1."
    );
    process.exit(10);
  }
  state.steps = Number(state.steps || 0) + 1;
  if (state.steps > CONTROL_STEP_LIMIT) {
    state.blockedReason =
      "control step budget " + CONTROL_STEP_LIMIT + " exhausted before settlement";
    writeGuard(f.run, state);
    console.log(
      "LOOP_GUARD " +
        state.blockedReason +
        ". Stop and report to the user. After explicit user direction, retry once with DELY_LOOP_GUARD_OVERRIDE=1."
    );
    process.exit(10);
  }
  writeGuard(f.run, state);
}

let _sha;
function delySha() {
  if (_sha !== undefined) return _sha;
  try {
    _sha = String(
      execFileSync("git", ["-C", PACKAGE_ROOT, "rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
    ).trim();
    if (!_sha) _sha = null;
  } catch (_) {
    _sha = null;
  }
  return _sha;
}

let _orcaVer;
function orcaVersion() {
  if (_orcaVer !== undefined) return _orcaVer;
  try {
    _orcaVer = ((orca(["status"]).result || {}).runtime || {}).appVersion || null;
  } catch (_) {
    _orcaVer = null;
  }
  return _orcaVer;
}

// Append one JSON object to ~/.dely/log.jsonl when that directory already
// exists. Never mkdir. A write failure must not change exit, print, or flow.
function logEvent(event, extra) {
  extra = extra || {};
  try {
    if (!fs.statSync(path.join(os.homedir(), ".dely")).isDirectory()) return;
    const rec = {
      ts: new Date().toISOString(),
      run: extra.run == null ? null : extra.run,
      repo: extra.repo == null ? null : extra.repo,
      sha: delySha(),
      orca: orcaVersion(),
      event,
    };
    for (const k of Object.keys(extra)) {
      if (k in rec) continue;
      rec[k] = extra[k];
    }
    fs.appendFileSync(path.join(os.homedir(), ".dely", "log.jsonl"), JSON.stringify(rec) + "\n");
  } catch (_) {
    /* observer */
  }
}

function fail(reason, extra) {
  extra = extra || {};
  const text = orcaHint(reason, extra.run);
  logEvent("error", Object.assign({ reason: text }, extra));
  out("ERROR " + text, 9);
}

function printIdentity() {
  let version = "unknown";
  try {
    version = JSON.parse(
      fs.readFileSync(path.join(PACKAGE_ROOT, ".claude-plugin/plugin.json"), "utf8")
    ).version;
  } catch (_) {
    /* missing or unreadable */
  }
  let skill = "unreadable";
  try {
    skill = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(PACKAGE_ROOT, "skills/delivery/SKILL.md")))
      .digest("hex");
  } catch (_) {
    /* missing */
  }
  console.log("dely " + version + " sha " + (delySha() || "null") + " sha256 " + skill);
}

function ownedStatePath(run) {
  return path.join(os.tmpdir(), "dely-run-" + run + ".jsonl");
}

function legacyAgyStatePath(run) {
  return path.join(os.tmpdir(), "dely-agy-" + run + ".jsonl");
}

function recordOwnedTerminal(run, handle, dispatchId = null) {
  try {
    const rec = { terminalHandle: handle, dispatchId, owned: true, time: Date.now() };
    fs.appendFileSync(ownedStatePath(run), JSON.stringify(rec) + "\n");
    fs.appendFileSync(legacyAgyStatePath(run), JSON.stringify(rec) + "\n");
  } catch (_) {}
}

function recordOwnedSnapshot(run, snapshotPath, dispatchId = null) {
  try {
    const rec = { snapshotPath, dispatchId, owned: true, time: Date.now() };
    fs.appendFileSync(ownedStatePath(run), JSON.stringify(rec) + "\n");
    fs.appendFileSync(legacyAgyStatePath(run), JSON.stringify(rec) + "\n");
  } catch (_) {}
}

function getOwnedSnapshots(run) {
  const paths = new Map();
  for (const p of [ownedStatePath(run), legacyAgyStatePath(run)]) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      for (const line of raw.split("\n").filter(Boolean)) {
        try {
          const rec = JSON.parse(line);
          if (rec && rec.owned === true && rec.snapshotPath) {
            paths.set(rec.snapshotPath, rec);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  return Array.from(paths.values());
}

function getOwnedTerminals(run) {
  const handles = new Map();
  for (const p of [ownedStatePath(run), legacyAgyStatePath(run)]) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      for (const line of raw.split("\n").filter(Boolean)) {
        try {
          const rec = JSON.parse(line);
          if (rec && rec.owned === true && rec.terminalHandle) {
            handles.set(rec.terminalHandle, rec);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  return Array.from(handles.values());
}

function restoreControlFocus(run) {
  const me = process.env.ORCA_TERMINAL_HANDLE;
  if (me) {
    try { orca(["terminal", "switch", "--terminal", me]); } catch (_) {}
    return;
  }
  if (run) {
    try {
      const show = orca(["orchestration", "run-show", "--id", run]);
      const coord = show.result && show.result.run && show.result.run.coordinator_handle;
      if (coord) {
        orca(["terminal", "switch", "--terminal", coord]);
      }
    } catch (_) {}
  }
}

function isProvenDead(dispatchId, handle = null, run = null) {
  if (handle) {
    const tr = orca(["terminal", "read", "--terminal", handle]);
    const term = tr.result && tr.result.terminal;
    if (term && term.status === "exited") return true;
  }
  if (dispatchId) {
    const sw = orca(["orchestration", "worker-show", "--dispatch", dispatchId]);
    const res = sw.result || {};
    const proj = res.projection || {};
    const liveness = proj.liveness || {};
    const stage = proj.stage || {};
    if (liveness.verdict === "dead" || liveness.verdict === "exited" || stage.worker === "exited") {
      return true;
    }
    if (res.dispatchStatus === "failed" && (liveness.verdict === "dead" || liveness.verdict === "exited")) {
      return true;
    }
  }
  return false;
}

function startAgyWindows(repo, run, p, spec, title) {
  const agy = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "agy", "bin", "agy.exe"
  );
  if (!fs.existsSync(agy)) return { error: "Antigravity CLI is unavailable: " + agy };
  let modelLabel = null;
  if (p.model !== "default") {
    try {
      const catalog = String(execFileSync(agy, ["models"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 }));
      const rows = catalog.split(/\r?\n/).map((line) => line.trim().split("\t"))
        .filter((cols) => /^[a-z0-9][a-z0-9._-]*$/i.test(cols[0]) && cols.length > 1 && cols[1].trim());
      if (!rows.length) return { error: "AGY_MODEL_UNVERIFIED: model discovery returned no usable catalog" };
      const row = rows.find((cols) => cols[0] === p.model);
      if (!row) return { error: "AGY_MODEL_UNAVAILABLE: " + p.model + " is absent from the verified catalog", modelUnavailable: true };
      modelLabel = row.slice(1).join(" ").replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (!modelLabel) return { error: "AGY_MODEL_UNVERIFIED: advertised model has no display label" };
    } catch (_) {
      return { error: "AGY_MODEL_UNVERIFIED: model discovery failed; do not treat auth, timeout, or availability errors as provider quota" };
    }
  }
  const registered = orca(["repo", "add", "--path", repo]);
  if (registered.ok === false) {
    return { error: (registered.error && registered.error.message) || "workspace registration failed" };
  }

  let cmd = '& "' + agy + '" --dangerously-skip-permissions';
  if (p.model !== "default") {
    if (!/^[0-9a-zA-Z_.:@/-]+$/.test(p.model)) {
      return { error: "Invalid model name: " + p.model };
    }
    cmd += ' --model "' + p.model + '"';
  }

  const termRes = orca([
    "terminal", "create",
    "--worktree", "path:" + repo,
    "--shell", "powershell.exe",
    "--command", cmd,
    "--title", title || "Dely AGY Worker",
  ]);
  const handle = termRes.result && termRes.result.terminal && termRes.result.terminal.handle;
  if (!handle) {
    return { error: (termRes.error && termRes.error.message) || "antigravity terminal create failed" };
  }
  recordOwnedTerminal(run, handle);

  const switched = orca(["terminal", "switch", "--terminal", handle]);
  if (switched.ok === false) {
    if (isProvenDead(null, handle, run)) {
      try { orca(["terminal", "close", "--terminal", handle]); } catch (_) {}
    }
    restoreControlFocus(run);
    return {
      error: "Antigravity terminal switch failed: " + ((switched.error && switched.error.message) || "switch error"),
      terminalHandle: handle,
    };
  }

  const ready = orca([
    "terminal", "wait",
    "--terminal", handle,
    "--for", "tui-idle",
    "--timeout-ms", "30000",
  ]);
  if (!ready.result || !ready.result.wait || ready.result.wait.satisfied !== true) {
    const why = ((ready.result && ready.result.wait && ready.result.wait.blockedReason) ||
      (ready.error && ready.error.message) || "timeout");
    if (isProvenDead(null, handle, run)) {
      try { orca(["terminal", "close", "--terminal", handle]); } catch (_) {}
    }
    restoreControlFocus(run);
    return {
      error: "Antigravity terminal did not become idle: " + why,
      terminalHandle: handle,
    };
  }

  const deadline = Date.now() + 30000;
  let quietSince = 0;
  let lastCursor = null;
  let modelConfirmed = p.model === "default";
  while (Date.now() < deadline) {
    const screen = orca(["terminal", "read", "--terminal", handle, "--screen"]);
    const term = screen.result && screen.result.terminal;
    const lines = (term && term.tail) || [];
    const composer = lines.some((l) => l.trim() === ">");
    const effort = /-(high|medium|low)$/.exec(p.model);
    modelConfirmed = p.model === "default" || lines.some((line) => {
      const clean = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").toLowerCase();
      return clean.includes(modelLabel.toLowerCase()) && (!effort || new RegExp("·\\s*" + effort[1] + "\\b").test(clean));
    });
    if (term && term.status === "exited") {
      try { orca(["terminal", "close", "--terminal", handle]); } catch (_) {}
      restoreControlFocus(run);
      return { error: "Antigravity terminal disconnected before composer prompt: " + handle, terminalHandle: handle };
    }
    const cursor = term && term.latestCursor != null ? term.latestCursor : null;
    if (!composer || !term || cursor !== lastCursor) quietSince = 0;
    if (composer && term && !quietSince) quietSince = Date.now();
    lastCursor = cursor;
    if (quietSince && Date.now() - quietSince >= 3000) break;
    sleep(500);
  }
  if (!quietSince || Date.now() - quietSince < 3000) {
    if (isProvenDead(null, handle, run)) {
      try { orca(["terminal", "close", "--terminal", handle]); } catch (_) {}
    }
    restoreControlFocus(run);
    return { error: "Antigravity composer prompt was not quiet for 3 s in terminal " + handle, terminalHandle: handle };
  }
  if (!modelConfirmed) {
    try { orca(["terminal", "close", "--terminal", handle]); } catch (_) {}
    restoreControlFocus(run);
    return { error: "AGY_MODEL_NOT_APPLIED: expected " + p.model + "; live footer does not confirm the requested model/level; no prompt dispatched", terminalHandle: handle };
  }

  updatePendingStart(repo, run, { submissionAttempted: true });
  const started = orca([
    "orchestration", "worker-start",
    "--spec", spec,
    "--worktree", "path:" + repo,
    "--run", run,
    "--task-title", title,
    "--terminal", handle,
  ]);
  const result = started.result || {};
  const id = result.dispatchId;
  if (!id) {
    restoreControlFocus(run);
    return {
      error: "Antigravity worker-start " +
        (result.failedStage || result.state || (started.error && started.error.message) || "unknown") +
        "; dispatch=" + (id || "none") + "; terminal=" + handle,
      terminalHandle: handle,
    };
  }
  recordOwnedTerminal(run, handle, id);
  return { id, taskId: result.taskId || result.task_id || null, terminalHandle: handle, state: result.state };
}

function observedTurn(value, expectedDispatch, expectedModel) {
  const result = value || {};
  const projection = result.projection || {};
  const prompt = result.prompt || projection.prompt || {};
  const stages = Array.isArray(prompt.stages) ? prompt.stages : [];
  if (result.turnStart === "observed" || projection.turnStart === "observed" || stages.includes("turn_started")) {
    return "turn_started";
  }
  const observation = result.observation || {};
  const provider = projection.provider || {};
  const stage = projection.stage || {};
  const liveness = projection.liveness || {};
  const evidence = projection.evidence || {};
  const dispatch = result.dispatch || {};
  const worker = result.worker || {};
  if (
    expectedDispatch && dispatch.id === expectedDispatch &&
    worker.dispatchId === expectedDispatch && projection.dispatchId === expectedDispatch &&
    observation.exactWorker === true && evidence.durable === true &&
    dispatch.status === "completed" && worker.state === "succeeded" &&
    stage.worker === "succeeded" && stage.dispatch === "completed" &&
    projection.outcome === "succeeded"
  ) {
    return "worker_completed";
  }
  if (
    observation.status === "live" &&
    observation.exactWorker === true &&
    provider.id === "codex" &&
    provider.model === expectedModel &&
    stage.worker === "ready" &&
    stage.dispatch === "dispatched" &&
    stage.detail === "input_accepted" &&
    stage.activity === "working" &&
    liveness.verdict === "live" &&
    liveness.source === "agent_status" &&
    evidence.durable === true &&
    evidence.liveStatus === "fresh"
  ) {
    return "legacy_working_projection";
  }
  return null;
}

function startCodexQuotaTerminal(repo, run, p, spec, title) {
  if (process.platform !== "win32") {
    return { error: "Codex quota backup launch is verified only on Windows" };
  }
  const codex = path.join(
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    "npm", "node_modules", "@openai", "codex", "node_modules", "@openai",
    "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"
  );
  if (!fs.existsSync(codex)) return { error: "Native Codex CLI is unavailable: " + codex };

  const command = '& "' + codex + '" --model "' + p.model + '" -c "model_reasoning_effort=' + p.effort + '"';
  const terminal = orca([
    "terminal", "create", "--worktree", "path:" + repo,
    "--shell", "powershell.exe", "--command", command,
    "--title", title || "Dely Codex quota backup",
  ]);
  const handle = terminal.result && terminal.result.terminal && terminal.result.terminal.handle;
  if (!handle) {
    return { error: (terminal.error && terminal.error.message) || "Codex quota backup terminal create failed" };
  }
  recordOwnedTerminal(run, handle);

  updatePendingStart(repo, run, { terminalHandle: handle, launch: {
    requested: { agent: p.agent, model: p.model, effort: p.effort },
    effective: { agent: p.agent, model: p.model, effort: p.effort },
    source: "native_terminal_command", command,
  } });

  const ready = orca([
    "terminal", "wait", "--terminal", handle,
    "--for", "tui-idle", "--timeout-ms", "30000",
  ]);
  if (!ready.result || !ready.result.wait || ready.result.wait.satisfied !== true) {
    return {
      error: "Codex quota backup terminal did not become idle: " +
        ((ready.result && ready.result.wait && ready.result.wait.blockedReason) ||
          (ready.error && ready.error.message) || "timeout"),
      terminalHandle: handle,
    };
  }

  const started = orca([
    "orchestration", "worker-start", "--spec", spec,
    "--worktree", "path:" + repo, "--run", run,
    "--task-title", title, "--terminal", handle,
  ]);
  const result = started.result || {};
  const id = result.dispatchId;
  if (!["ready", "outcome_unknown"].includes(result.state) || !id) {
    if (id) {
      recordOwnedTerminal(run, handle, id);
      updatePendingStart(repo, run, { id, taskId: result.taskId || result.task_id || null });
    }
    return {
      error: "Codex quota backup worker-start " +
        (result.failedStage || result.state || (started.error && started.error.message) || "unknown") +
        "; dispatch=" + (id || "none") + "; terminal=" + handle,
      state: "outcome_unknown",
      id: id || null,
      terminalHandle: handle,
    };
  }
  // An uncertain receipt with a Dispatch is inspected in place, never relaunched.
  recordOwnedTerminal(run, handle, id);
  updatePendingStart(repo, run, { id, taskId: result.taskId || result.task_id || null, terminalHandle: handle });
  let startEvidence = observedTurn(result, id, p.model);
  if (!startEvidence) {
    const promptDeadline = Date.now() + 60000;
    let promptVisible = false;
    while (Date.now() < promptDeadline && !startEvidence && !promptVisible) {
      startEvidence = observedTurn(orca(["orchestration", "worker-show", "--dispatch", id]).result, id, p.model);
      if (startEvidence) break;
      const screen = orca(["terminal", "read", "--terminal", handle, "--screen"]);
      const terminalState = (screen.result || {}).terminal || {};
      const draft = terminalState.draft || "";
      const visible = (terminalState.tail || []).join("\n") + "\n" + JSON.stringify(draft);
      promptVisible = /Pasted Content/i.test(visible) || Boolean(String(draft).trim());
      if (!promptVisible) sleep(250);
    }
    if (!startEvidence && !promptVisible) {
      return {
        error: "Codex quota backup input was accepted but no started turn or visibly unsubmitted prompt was observed; dispatch=" + id + "; terminal=" + handle,
        state: "outcome_unknown",
        id,
        terminalHandle: handle,
      };
    }
    if (!startEvidence && promptVisible) {
      const enter = orca(["terminal", "send", "--terminal", handle, "--enter"]);
      if (enter.ok === false) {
        return {
          error: "Codex quota backup bare Enter failed after a visible unsubmitted prompt; dispatch=" + id + "; terminal=" + handle + "; " +
            ((enter.error && enter.error.message) || "terminal send failed"),
          state: "outcome_unknown",
          id,
          terminalHandle: handle,
        };
      }
      const startDeadline = Date.now() + 60000;
      while (Date.now() < startDeadline && !startEvidence) {
        startEvidence = observedTurn(orca(["orchestration", "worker-show", "--dispatch", id]).result, id, p.model);
        if (startEvidence) break;
        sleep(250);
      }
    }
  }
  if (!startEvidence) {
    return {
      error: "Codex quota backup prompt was submitted once but no working Codex turn evidence was observed; dispatch=" + id + "; terminal=" + handle,
      state: "outcome_unknown",
      id,
      terminalHandle: handle,
    };
  }
  recordOwnedTerminal(run, handle, id);
  const pins = { agent: p.agent, model: p.model, effort: p.effort };
  return {
    id,
    taskId: result.taskId || result.task_id || null,
    terminalHandle: handle,
    state: result.state,
    launch: {
      requested: pins,
      effective: pins,
      source: "native_terminal_command",
      command,
      startEvidence,
      workerStart: result.launch || null,
    },
  };
}

function start(repo, run, p, spec, title) {
  const wantsModel = p.modelFlag && p.model !== "default";
  const joinsEffort = wantsModel && p.effortInModel && p.effort !== "default";
  const wantsEffort = p.effortFlag && p.effort !== "default";
  const specPin = p.modelPin === "spec-unchecked";
  const specModel = specPin && p.model !== "default";
  const specEffort = specPin && p.effort !== "default";
  if (effortRequiresModel() && (wantsEffort || specEffort || (p.effortInModel && p.effort !== "default")) && !(wantsModel || specModel)) {
    return {
      error:
        "effort " + p.effort + " pinned with model default for " + p.agent +
        "; a pinned Effort requires a pinned Model",
    };
  }
  if (specModel) spec += "\ndely-pin: " + p.model + (specEffort ? " " + p.effort : "");

  if (process.platform === "win32" && p.agent === "antigravity") {
    return startAgyWindows(repo, run, p, spec, title);
  }

  if (p.fallbackReason === "quota" || p.fallbackReason === "model_unavailable") {
    return startCodexQuotaTerminal(repo, run, p, spec, title);
  }

  const args = [
    "orchestration",
    "worker-start",
    "--spec",
    spec,
    "--worktree",
    "path:" + repo,
    "--run",
    run,
    "--task-title",
    title,
    "--agent",
    p.agent,
  ];
  if (wantsModel) args.push("--model", joinsEffort ? p.model + p.effortInModel + p.effort : p.model);
  if (wantsEffort) args.push("--effort", p.effort);
  const r = orca(args);
  const id = r.result && r.result.dispatchId;
  if (!id) {
    return {
      error: orcaHint(
        (r.error && r.error.message) || String((r.result && r.result.failedStage) || "worker-start"),
        run
      ),
    };
  }
  return { id, taskId: r.result && (r.result.taskId || r.result.task_id || null), state: r.result && r.result.state };
}

function payloadOf(m) {
  const p = m && m.payload;
  if (p && typeof p === "object" && !Array.isArray(p)) return p;
  if (typeof p === "string") {
    try {
      const j = JSON.parse(p);
      return j && typeof j === "object" && !Array.isArray(j) ? j : {};
    } catch (_) {
      return {};
    }
  }
  return {};
}

function messageDispatchId(m) {
  if (!m || typeof m !== "object") return null;
  const p = payloadOf(m);
  const id = p.dispatchId || p.dispatch_id || m.dispatchId || m.dispatch_id || null;
  return id == null || id === "" ? null : String(id);
}

function namesDispatch(m, id) {
  if (!id) return false;
  const msgId = messageDispatchId(m);
  return msgId != null && msgId === String(id);
}

function isRejected(m) {
  if (!m) return false;
  return payloadOf(m)._orcaLifecycleRejection != null;
}

function liveNamesDispatch(m, id) {
  if (!m || typeof m !== "object") return false;
  if (isRejected(m)) return false;
  if (m.type === "status") return false;
  return namesDispatch(m, id);
}

function isDispatchReceipt(m, dispatchId, receiptMarker, terminalHandle = null, taskId = null) {
  if (!m || typeof m !== "object") return false;
  if (m.type !== "heartbeat") return false;
  if (isRejected(m)) return false;
  if (!namesDispatch(m, dispatchId)) return false;
  const p = payloadOf(m);
  if (terminalHandle) {
    const sender = m.from_handle || m.fromHandle || m.from || p.from_handle || p.fromHandle || p.from || null;
    if (!sender || String(sender) !== String(terminalHandle)) return false;
  }
  if (taskId) {
    const msgTaskId = p.taskId || p.task_id || m.taskId || m.task_id || null;
    if (!msgTaskId || String(msgTaskId) !== String(taskId)) return false;
  }
  const subj = (typeof m.subject === "string" ? m.subject : (typeof p.subject === "string" ? p.subject : "")).trim();
  if (
    subj === receiptMarker ||
    p.receipt === receiptMarker ||
    p.marker === receiptMarker ||
    p.receiptMarker === receiptMarker
  ) {
    return true;
  }
  return false;
}

function settling(m) {
  return !isRejected(m) && ["worker_done", "escalation", "question"].includes(m.type);
}

// Records what Orca printed for one release and never a state it did not. A
// failed release is an entry, not a failure: callers keep their exit code.
function releaseWorker(id) {
  const r = orca(["orchestration", "worker-release", "--dispatch", id]);
  if (r.ok === false) {
    const e = r.error || {};
    return { dispatchId: id, error: e.code || e.message || "release failed" };
  }
  const res = r.result || {};
  if (!res.state) return { dispatchId: id, error: "no state returned" };
  const entry = { dispatchId: id, state: res.state };
  if (res.reason) entry.reason = res.reason;
  return entry;
}

function releaseReclaimable(run) {
  const ids = [];
  let cursor = null;
  let releaseError = null;
  for (;;) {
    const r = orca([
      "orchestration",
      "worker-list",
      "--run",
      run,
      "--terminal-state",
      "reclaimable",
      ...(cursor ? ["--cursor", cursor] : []),
    ]);
    if (r.ok === false) {
      const e = r.error || {};
      releaseError = e.code || e.message || "worker-list failed";
      break;
    }
    const res = r.result || {};
    for (const w of res.workers || []) if (w.dispatchId && !ids.includes(w.dispatchId)) ids.push(w.dispatchId);
    const page = res.page || {};
    if (!page.hasMore || !page.nextCursor || page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }
  return { release: ids.map(releaseWorker), releaseError };
}

function orcaHint(msg, run) {
  const text = String(msg || "");
  if (text.includes("requires the coordinator terminal currently bound")) {
    return text + "\nrun orca orchestration run-use --id " + run + " from this terminal";
  }
  if (text.includes("already has an active actionable waiter")) {
    return text + "\na dely wait for this Run is still running";
  }
  return text;
}

function requireHandle(extra) {
  if (process.env.ORCA_TERMINAL_HANDLE) return;
  fail(
    "not inside an Orca terminal. Pass your own terminal's handle as ORCA_TERMINAL_HANDLE, never another pane's",
    extra
  );
}

function clip(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-400);
}

function messageText(m) {
  if (m == null) return "";
  if (typeof m === "string") return m;
  const blocks = Array.isArray(m.blocks) ? m.blocks : [];
  let last = "";
  let toolOut = "";
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) last = b.text;
    else if (!toolOut && b.type === "tool-result" && typeof b.output === "string" && b.output.trim()) {
      toolOut = b.output;
    }
  }
  return last || toolOut;
}

function screenLines(id) {
  const r = orca(["orchestration", "worker-read", "--dispatch", id, "--source", "auto", "--limit", "200"]);
  const res = r.result || {};
  if (res.terminal && Array.isArray(res.terminal.tail)) {
    return res.terminal.tail.filter((l) => String(l || "").trim());
  }
  const msgs = (res.transcript && res.transcript.messages) || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = messageText(msgs[i]);
    if (String(t).trim()) return [t];
  }
  return [];
}

function screenText(id) {
  return screenLines(id).join("\n");
}

function lastText(id) {
  return clip(screenText(id));
}

function unavailableModelPin(repo, phase) {
  const p = pin(repo, "implement_backup_2");
  if (p.agent !== "codex" || p.model !== "gpt-6-luna" || p.effort !== "max") {
    throw new Error("Missing-model fallback must be Codex gpt-6-luna/max");
  }
  return Object.assign({}, p, { phase, pinPhase: "implement_backup_2",
    fallbackReason: "model_unavailable", fallbackStage: null });
}

function preflight(f) {
  f.repo = path.resolve(f.repo);
  const taskRouting = require("./task-routing.js");
  let taskDecision = null;
  if (f["assessment-file"] || f["spec-file"]) {
    if (!f["assessment-file"] || !f["spec-file"]) out("ERROR task preflight requires both --assessment-file and --spec-file", 2);
    try { taskDecision = taskRouting.requireApprovedRoute(f); }
    catch (e) { out("ERROR " + e.message, 2); }
  }
  requireHandle({ run: f.run, repo: f.repo });
  let implPin;
  try {
    const pinPhase = taskDecision ? taskRouting.selectedPhase(taskDecision, f) : "implement";
    implPin = Object.assign({}, pin(f.repo, pinPhase), { phase: "implement", pinPhase });
    if (taskDecision) taskRouting.verifyPin(taskDecision, implPin, f);
  } catch (e) {
    fail((e && e.message) || String(e), { run: f.run, repo: f.repo });
  }
  const cli = process.env.ORCA_CLI_COMMAND || "orca";
  const spec =
    "Preflight only; no implementation. Do not read, edit or run anything in the repository. " +
    "The resolved Orca CLI is " + JSON.stringify(cli) + "; invoke it directly for skills get orchestration and orchestration send. " +
    "Use simple commands without shell conditionals, pipelines or wrappers. Read mandatory instruction files outside the repository with rtk proxy rg. " +
    "Send a heartbeat with subject `ack`, then send worker_done --outcome succeeded with subject `preflight ok`, then stop.";
  const open = {};
  let failed = 0;
  for (let p of [implPin]) {
    let s = start(f.repo, f.run, p, spec, "preflight-" + p.phase);
    if (s.modelUnavailable === true) {
      const requested = { agent: p.agent, model: p.model, effort: p.effort };
      try {
        p = unavailableModelPin(f.repo, p.phase);
        if (taskDecision) taskRouting.verifyUnavailablePin(taskRouting.requireApprovedRoute(f), p);
        logEvent("model_unavailable", { run: f.run, repo: f.repo, requested,
          effective: { agent: p.agent, model: p.model, effort: p.effort }, preflight: true });
        console.log("MODEL_UNAVAILABLE " + requested.model + " -> Codex gpt-6-luna/max");
        s = start(f.repo, f.run, p, spec, "preflight-" + p.phase);
      } catch (e) {
        s = { error: e.message };
      }
    }
    if (s.error) {
      logEvent("preflight", {
        run: f.run,
        repo: f.repo,
        phase: p.phase,
        agent: p.agent,
        result: "FAIL",
        seconds: 0,
        reason: "start: " + s.error,
      });
      out("PREFLIGHT " + p.phase + " " + p.agent + " FAIL start: " + s.error);
      failed++;
    } else {
      open[s.id] = Object.assign({ messaged: false, terminalHandle: s.terminalHandle || null }, p);
    }
  }
  const t0 = Date.now();
  const drop = (id, rec, line, canStopAndRelease = false) => {
    logEvent("preflight", {
      run: f.run,
      repo: f.repo,
      phase: rec.phase,
      agent: rec.agent,
      result: "FAIL",
      seconds: Math.round((Date.now() - t0) / 1000),
      reason: line.replace(/^PREFLIGHT \S+ \S+ FAIL /, ""),
    });
    out(line);
    if (canStopAndRelease) {
      try { orca(["orchestration", "worker-stop", "--dispatch", id]); } catch (_) {}
      try { orca(["orchestration", "worker-release", "--dispatch", id]); } catch (_) {}
      if (rec.terminalHandle) {
        try { orca(["terminal", "close", "--terminal", rec.terminalHandle]); } catch (_) {}
      }
    }
    delete open[id];
    failed++;
  };
  const pollDead = () => {
    const rows = ((orca(["orchestration", "worker-list", "--run", f.run]).result || {}).workers || []);
    for (const [id, rec] of Object.entries(open)) {
      if (rec.messaged) continue;
      const w = rows.find((x) => x.dispatchId === id);
      if (!w) continue;
      const stage = (w.projection || {}).stage || {};
      const liveness = (w.projection || {}).liveness || {};
      const dead = isProvenDead(id, rec.terminalHandle, f.run) ||
        (w.dispatchStatus === "failed" && (liveness.verdict === "dead" || liveness.verdict === "exited"));
      if (!dead) continue;
      drop(id, rec, "PREFLIGHT " + rec.phase + " " + rec.agent + " FAIL worker exited: " + (stage.detail || w.dispatchStatus || "dead") + "; last output: " + lastText(id), true);
    }
  };
  while (Object.keys(open).length && Date.now() - t0 < PREFLIGHT_S * 1000) {
    const r = orca([
      "orchestration",
      "check",
      "--wait",
      "--run",
      f.run,
      "--timeout-ms",
      String(Math.max(1, Math.floor(POLL_S * 1000))),
    ]);
    if (r.ok === false) {
      const why = orcaHint((r.error && r.error.message) || "check failed", f.run);
      for (const [id, rec] of Object.entries(open)) {
        const dead = isProvenDead(id, rec.terminalHandle, f.run);
        drop(id, rec, "PREFLIGHT " + rec.phase + " " + rec.agent + " FAIL " + why + (!dead ? " (retained dispatch=" + id + (rec.terminalHandle ? " terminal=" + rec.terminalHandle : "") + ")" : ""), dead);
      }
      restoreControlFocus(f.run);
      process.exit(failed ? 1 : 0);
    }
    const res = r.result || {};
    if (res.deliveryId) {
      for (const m of res.messages || []) {
        const hit = Object.keys(open).find((id) => liveNamesDispatch(m, id));
        if (hit) open[hit].messaged = true;
        if (hit && m.type === "worker_done") {
          const secs = Math.round((Date.now() - t0) / 1000);
          const pld = payloadOf(m);
          if (pld.outcome === "succeeded") {
            logEvent("preflight", {
              run: f.run,
              repo: f.repo,
              phase: open[hit].phase,
              agent: open[hit].agent,
              result: "PASS",
              seconds: secs,
            });
            out("PREFLIGHT " + open[hit].phase + " " + open[hit].agent + " PASS " + secs + "s");
            try { orca(["orchestration", "worker-release", "--dispatch", hit]); } catch (_) {}
            if (open[hit].terminalHandle) {
              try { orca(["terminal", "close", "--terminal", open[hit].terminalHandle]); } catch (_) {}
            }
            delete open[hit];
          } else {
            const why = "worker_done outcome was " + (pld.outcome == null ? "missing" : JSON.stringify(pld.outcome)) + " (expected succeeded)";
            logEvent("preflight", {
              run: f.run,
              repo: f.repo,
              phase: open[hit].phase,
              agent: open[hit].agent,
              result: "FAIL",
              seconds: secs,
              reason: why,
            });
            out("PREFLIGHT " + open[hit].phase + " " + open[hit].agent + " FAIL " + why + "; last output: " + lastText(hit));
            try { orca(["orchestration", "worker-release", "--dispatch", hit]); } catch (_) {}
            if (open[hit].terminalHandle) {
              try { orca(["terminal", "close", "--terminal", open[hit].terminalHandle]); } catch (_) {}
            }
            delete open[hit];
            failed++;
          }
        }
      }
      orca(["orchestration", "check", "--run", f.run, "--ack", res.deliveryId]);
    }
    pollDead();
  }
  for (const [id, rec] of Object.entries(open)) {
    const dead = isProvenDead(id, rec.terminalHandle, f.run);
    drop(
      id,
      rec,
      "PREFLIGHT " + rec.phase + " " + rec.agent + " FAIL no worker_done in " + PREFLIGHT_S + "s; " +
      (dead ? "worker exited" : "retained dispatch=" + id + (rec.terminalHandle ? " terminal=" + rec.terminalHandle : "")) +
      "; last output: " + lastText(id),
      dead
    );
  }
  restoreControlFocus(f.run);
  process.exit(failed ? 1 : 0);
}

function dropWorker(id, handle = null, run = null) {
  const dead = isProvenDead(id, handle, run);
  if (dead) {
    if (id) {
      try { orca(["orchestration", "worker-stop", "--dispatch", id]); } catch (_) {}
      try { orca(["orchestration", "worker-release", "--dispatch", id]); } catch (_) {}
    }
    if (handle) {
      try { orca(["terminal", "close", "--terminal", handle]); } catch (_) {}
    }
  }
}

function runFolder(repo, run) {
  return path.join(repo, ".dely", "local", "runs", run);
}

function pendingStartPath(repo, run) {
  return path.join(runFolder(repo, run), "pending-start.json");
}

function updatePendingStart(repo, run, fields) {
  const file = pendingStartPath(repo, run);
  if (!fs.existsSync(file)) return;
  const pending = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) pending[key] = value;
  fs.writeFileSync(file, JSON.stringify(pending));
}

function unknownStart(f, attempt, reason) {
  const identity = " dispatch=" + (attempt.id || "unknown") + " terminal=" + (attempt.terminalHandle || "unknown");
  logEvent("outcome_unknown", { run: f.run, repo: f.repo, dispatchId: attempt.id || null, terminalHandle: attempt.terminalHandle || null, reason });
  out("OUTCOME_UNKNOWN" + identity + "; " + reason + "; inspect the original attempt; do not resend its prompt", 8);
}

// Lists every file under dir. A missing dir is an empty listing; any other
// read failure sets err to {code, dir} and the listing is incomplete.
function listFiles(dir, top = true) {
  const r = { files: [], err: null };
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (!(top && e.code === "ENOENT")) r.err = { code: e.code || "ERROR", dir };
    return r;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = listFiles(p, false);
      r.files.push(...sub.files);
      r.err = r.err || sub.err;
    } else r.files.push(p);
  }
  return r;
}

function dispatch(f) {
  f.repo = path.resolve(f.repo);
  // jev-task-routing: dispatch admission
  if (f.phase !== "implement") out("ERROR AGY dispatch is implement-only; review is owned by Codex Control", 2);
  const taskRouting = require("./task-routing.js");
  let taskDecision;
  try { taskDecision = taskRouting.requireApprovedRoute(f); }
  catch (e) { out("ERROR " + e.message, 2); }
  let p;
  const fallbackStage = f.fallback === "quota" ? Number(f["fallback-stage"] || 1) : null;
  const pinPhase = taskRouting.selectedPhase(taskDecision, f);
  try {
    p = pin(f.repo, pinPhase);
  } catch (e) {
    fail((e && e.message) || String(e), { run: f.run, repo: f.repo });
  }
  p = Object.assign({}, p, {
    phase: f.phase,
    pinPhase,
    fallbackReason: f.fallback || null,
    fallbackStage,
  });
  if (p.fallbackReason === "quota") {
    if (p.agent !== "codex" || p.model !== "gpt-6-luna" || p.effort !== "max") {
      out("ERROR quota stage 1 pin must be Codex CLI / gpt-6-luna / max", 2);
    }
  }
  try { taskRouting.verifyPin(taskDecision, p, f); }
  catch (e) { out("ERROR " + e.message, 2); }
  logEvent("task_route", { run: f.run, repo: f.repo, difficulty: taskDecision.difficulty,
    specSha256: taskDecision.task.spec_sha256, contextSha256: taskDecision.task.context_sha256,
    jevModel: taskDecision.jev ? taskDecision.jev.model : "NOT_EVALUATED", reviewSource: taskDecision.review.source });

  requireHandle({ run: f.run, repo: f.repo });

  const specFile = path.resolve(f.repo, f["spec-file"]);
  let rawBytes;
  try {
    const st = fs.statSync(specFile);
    if (!st.isFile()) {
      fail("spec-file is not a regular file: " + specFile, { run: f.run, repo: f.repo });
    }
    rawBytes = fs.readFileSync(specFile);
  } catch (e) {
    fail("cannot read spec-file " + specFile + ": " + (e.message || e), { run: f.run, repo: f.repo });
  }

  if (!rawBytes || rawBytes.length === 0) {
    fail("spec-file is empty: " + specFile, { run: f.run, repo: f.repo });
  }
  if (crypto.createHash("sha256").update(rawBytes).digest("hex") !== taskDecision.task.spec_sha256) {
    out("ERROR task spec changed after assessment validation; no worker launched", 2);
  }
  if (rawBytes.includes(0)) {
    fail("spec-file contains NUL bytes: " + specFile, { run: f.run, repo: f.repo });
  }

  let originalSpec;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    originalSpec = decoder.decode(rawBytes);
  } catch (e) {
    fail("spec-file contains invalid UTF-8: " + specFile, { run: f.run, repo: f.repo });
  }

  if (!originalSpec || !originalSpec.trim()) {
    fail("spec-file is empty: " + specFile, { run: f.run, repo: f.repo });
  }

  const sourceBytes = rawBytes.length;
  const sourceSha256 = crypto.createHash("sha256").update(rawBytes).digest("hex");
  const pendingFile = pendingStartPath(f.repo, f.run);
  const requestKey = JSON.stringify([p.agent, p.model, p.effort, p.pinPhase, p.fallbackReason, p.fallbackStage]);
  let pending = fs.existsSync(pendingFile) ? JSON.parse(fs.readFileSync(pendingFile, "utf8")) : null;
  let resumed = null;
  if (pending) {
    if (pending.repo !== f.repo || pending.phase !== f.phase || pending.requestKey !== requestKey ||
        pending.sourceSha256 !== sourceSha256 || pending.contextSha256 !== taskDecision.task.context_sha256) {
      unknownStart(f, pending, "the pending attempt does not match the current reviewed task/pins");
    }
    if (!pending.id || !getOwnedTerminals(f.run).some((row) => row.terminalHandle === pending.terminalHandle && row.dispatchId === pending.id)) {
      unknownStart(f, pending, "owned dispatch identity is not proven");
    }
    const result = (orca(["orchestration", "worker-show", "--dispatch", pending.id]).result || {});
    const projection = result.projection || {};
    if (!result.observation || result.observation.exactWorker !== true || !result.dispatch ||
        result.dispatch.id !== pending.id || result.dispatch.runId !== f.run || result.dispatch.assigneeHandle !== pending.terminalHandle ||
        !result.worker || result.worker.dispatchId !== pending.id || result.worker.agentTerminalHandle !== pending.terminalHandle ||
        projection.dispatchId !== pending.id) {
      unknownStart(f, pending, "the original worker identity is not verifiable");
    }
    const inactive = result.observation.status === "exited" ||
      (projection.liveness || {}).verdict === "exited" || (projection.liveness || {}).verdict === "dead";
    if (inactive) {
      if (!result.dispatch.completedAt || !["completed", "failed", "abandoned"].includes(result.dispatch.status)) {
        unknownStart(f, pending, "the inactive worker has no accepted settlement; complete Orca recovery first");
      }
      const release = releaseWorker(pending.id);
      if (!["released", "already_released"].includes(release.state)) unknownStart(f, pending, "the inactive worker release is not confirmed");
      fs.unlinkSync(pendingFile);
      pending = null;
    } else {
      const provider = projection.provider || {};
      if (provider.id !== "codex" || provider.model !== pending.pin.model || !observedTurn(result, pending.id, pending.pin.model)) {
        unknownStart(f, pending, "the original Codex turn has not been proven with the requested model");
      }
      if (pending.pin.fallbackReason === "model_unavailable") taskRouting.verifyUnavailablePin(taskDecision, pending.pin);
      p = pending.pin;
      resumed = { id: pending.id, taskId: pending.taskId, terminalHandle: pending.terminalHandle, launch: pending.launch };
    }
  }
  const receiptMarker = pending ? pending.receiptMarker : "rcpt_" + crypto.randomBytes(8).toString("hex");

  let dispatchSpec;
  let snapshotPath = pending ? pending.snapshotPath : null;
  let snapshotBytes = pending ? pending.snapshotBytes : null;
  let snapshotSha256 = pending ? pending.snapshotSha256 : null;

  if (process.platform === "win32" && p.agent === "antigravity") {
    const tmpDelyDir = path.join(f.repo, ".tmp-dely");
    fs.mkdirSync(tmpDelyDir, { recursive: true });
    const snapshotToken = crypto.randomBytes(8).toString("hex");
    const snapshotName = f.run + "-prompt-" + snapshotToken + ".txt";
    snapshotPath = path.join(tmpDelyDir, snapshotName);

    const stagedFooter =
      "\n\n=== DELY PROMPT DELIVERY RECEIPT ===\n" +
      "First action, before anything else: send a heartbeat with subject `" + receiptMarker + "`.\n" +
      "The Orca preamble and this staged spec file are everything the worker needs; read no other skill.\n";
    const stagedContent = originalSpec + stagedFooter;
    snapshotBytes = Buffer.byteLength(stagedContent, "utf8");
    snapshotSha256 = crypto.createHash("sha256").update(stagedContent, "utf8").digest("hex");

    try {
      fs.writeFileSync(snapshotPath, stagedContent, { flag: "wx", encoding: "utf8" });
    } catch (e) {
      fail("cannot write snapshot file " + snapshotPath + ": " + (e.message || e), { run: f.run, repo: f.repo });
    }
    recordOwnedSnapshot(f.run, snapshotPath);

    const relSnapshot = path.join(".tmp-dely", snapshotName).replace(/\\/g, "/");
    dispatchSpec =
      "Task spec staged at " + relSnapshot + " (" + snapshotBytes + " bytes, SHA-256: " + snapshotSha256 + ").\n" +
      "Read the full task spec from " + relSnapshot + " before starting work.\n\n" +
      "First action: read the complete staged file from " + relSnapshot + ", then send the exact heartbeat receipt subject specified in that file's footer, then execute the task.\n" +
      "The Orca preamble and the staged spec file are everything the worker needs; read no other skill.";
  } else {
    dispatchSpec =
      originalSpec +
      "\n\nFirst action, before anything else: send a heartbeat with subject `" + receiptMarker + "`. " +
      "The Orca preamble and this spec file are everything the worker needs; read no other skill.";
  }

  const launch = () => {
    if (p.agent === "codex") {
      fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
      fs.writeFileSync(pendingFile, JSON.stringify({ repo: f.repo, phase: f.phase, requestKey, pin: p,
        sourceSha256, contextSha256: taskDecision.task.context_sha256, receiptMarker,
        snapshotPath, snapshotBytes, snapshotSha256 }), { flag: "wx" });
    }
    const result = start(f.repo, f.run, p, dispatchSpec, f.phase);
    if (p.agent === "codex") {
      updatePendingStart(f.repo, f.run, { id: result.id, taskId: result.taskId, terminalHandle: result.terminalHandle, launch: result.launch });
      if (result.error && !result.id && result.state !== "outcome_unknown") fs.unlinkSync(pendingFile);
    }
    return result;
  };
  let s = resumed || launch();
  if (s.modelUnavailable === true) {
    const requested = { agent: p.agent, model: p.model, effort: p.effort };
    try {
      taskDecision = taskRouting.requireApprovedRoute(f);
      p = unavailableModelPin(f.repo, f.phase);
      taskRouting.verifyUnavailablePin(taskDecision, p);
    } catch (e) {
      out("ERROR " + e.message, 2);
    }
    logEvent("model_unavailable", { run: f.run, repo: f.repo, requested,
      effective: { agent: p.agent, model: p.model, effort: p.effort } });
    console.log("MODEL_UNAVAILABLE " + requested.model + " -> Codex gpt-6-luna/max");
    s = launch();
    if (s.launch) {
      s.launch.requested = requested;
      updatePendingStart(f.repo, f.run, { launch: s.launch });
    }
  }
  if (s.error) {
    if (s.state === "outcome_unknown") unknownStart(f, s, s.error);
    logEvent("error", { run: f.run, repo: f.repo, reason: s.error });
    out("FAILED " + s.error, 5);
  }
  if (snapshotPath && s.id) {
    recordOwnedSnapshot(f.run, snapshotPath, s.id);
  }

  console.log(
    "dispatching " + s.id + (s.terminalHandle ? " (terminal " + s.terminalHandle + ")" : "") +
    "; prompt " + sourceBytes + " bytes sha256:" + sourceSha256.slice(0, 16)
  );

  const selectedPins = { agent: p.agent, model: p.model, effort: p.effort };
  s.launch = Object.assign(
    {
      pinPhase: p.pinPhase,
      fallbackStage: p.fallbackStage,
      requested: selectedPins,
      effective: selectedPins,
      source: p.agent === "antigravity" ? "agy_cli_model_flag" : "worker_start",
    },
    s.launch || {}
  );
  const interval = Math.max(20, Math.min(5000, Math.floor(POLL_S * 1000)));
  const t0 = Date.now();
  for (; Date.now() - t0 < ACK_S * 1000; sleep(interval)) {
    const peek = orca(["orchestration", "check", "--peek", "--run", f.run]);
    const msgs = (peek.result || {}).messages || [];
    const verifiedReceipt = msgs.some((m) => isDispatchReceipt(m, s.id, receiptMarker, s.terminalHandle, s.taskId));
    if (verifiedReceipt) {
      if (snapshotPath) {
        let currentSnapshotSha = null;
        let currentSnapshotBytes = null;
        try {
          const currentBytes = fs.readFileSync(snapshotPath);
          currentSnapshotBytes = currentBytes.length;
          currentSnapshotSha = crypto.createHash("sha256").update(currentBytes).digest("hex");
        } catch (e) {
          dropWorker(s.id, s.terminalHandle, f.run);
          restoreControlFocus(f.run);
          logEvent("snapshot_missing", {
            run: f.run,
            repo: f.repo,
            dispatchId: s.id,
            snapshotPath,
            error: (e && e.message) || String(e),
          });
          out("FAILED " + s.id + " staged snapshot missing or unreadable before confirmation: " + snapshotPath, 5);
        }
        if (currentSnapshotSha !== snapshotSha256) {
          dropWorker(s.id, s.terminalHandle, f.run);
          restoreControlFocus(f.run);
          logEvent("snapshot_corrupted", {
            run: f.run,
            repo: f.repo,
            dispatchId: s.id,
            snapshotPath,
            expectedSha: snapshotSha256,
            currentSha: currentSnapshotSha,
          });
          out(
            "FAILED " + s.id + " staged snapshot was modified before confirmation (expected sha " +
              snapshotSha256.slice(0, 16) + ", saw " + (currentSnapshotSha ? currentSnapshotSha.slice(0, 16) : "none") + ")",
            5
          );
        }
      }

      logEvent("dispatch", {
        run: f.run,
        repo: f.repo,
        phase: p.phase,
        agent: p.agent,
        pinPhase: p.pinPhase,
        fallbackReason: p.fallbackReason,
        fallbackStage: p.fallbackStage,
        launch: s.launch || null,
        dispatchId: s.id,
        terminalHandle: s.terminalHandle || null,
        promptBytes: sourceBytes,
        promptSha256: sourceSha256,
        snapshotBytes,
        snapshotSha256,
        receiptMarker,
        seconds: Math.round((Date.now() - t0) / 1000),
      });
      if (fs.existsSync(pendingFile)) fs.unlinkSync(pendingFile);
      restoreControlFocus(f.run);
      console.log("receipt confirmed for " + s.id + " [" + receiptMarker + "]");
      out("DISPATCHED " + s.id, 0);
    }
    const row = ((orca(["orchestration", "worker-list", "--run", f.run]).result || {}).workers || []).find((w) => w.dispatchId === s.id);
    if (row && row.dispatchStatus === "failed") break;
  }
  const raw = screenText(s.id);
  const secs = Math.round((Date.now() - t0) / 1000);
  const dead = isProvenDead(s.id, s.terminalHandle, f.run);
  if (dead) {
    dropWorker(s.id, s.terminalHandle, f.run);
    restoreControlFocus(f.run);
    logEvent("worker_dead", { run: f.run, repo: f.repo, dispatchId: s.id, seconds: secs, text: raw });
    out("FAILED " + s.id + " agent exited after " + secs + "s; last output: " + clip(raw), 4);
  } else {
    restoreControlFocus(f.run);
    logEvent("no_ack", { run: f.run, repo: f.repo, dispatchId: s.id, seconds: secs, text: raw, terminalHandle: s.terminalHandle });
    out("NO_ACK " + s.id + " unverified after " + secs + "s (retained dispatch=" + s.id + (s.terminalHandle ? " terminal=" + s.terminalHandle : "") + "); last output: " + clip(raw), 4);
  }
}

function advance(track, id) {
  const t = track[id] || (track[id] = { cursor: null, at: Date.now() });
  for (let page = 0; page < 20; page++) {
    const args = ["orchestration", "worker-read", "--dispatch", id, "--source", "auto", "--limit", "200"];
    if (t.cursor) args.push("--cursor", t.cursor);
    const r = orca(args);
    if (r.ok === false) {
      t.error = (r.error && r.error.message) || "worker-read failed";
      break;
    }
    const res = r.result || {};
    if (res.source) t.source = res.source;
    const body = res.transcript || res.terminal || {};
    const cursor = body.nextCursor || null;
    const n = Number(body.returnedMessageCount || body.returnedLineCount || 0);
    if (cursor && cursor !== t.cursor) t.at = Date.now();
    if (cursor) t.cursor = cursor;
    if (!body.limited || n === 0) break;
  }
  return (Date.now() - t.at) / 60000;
}

// Read a named terminal's harness, defaulting to the terminal that launched
// this process. --control is the caller's claim; agentIdentity is Orca's record.
// Measured on Orca 1.4.203: a Codex Control passed --control cursor and
// --control claude, naming the workers it waited on, and a guard that trusted
// the flag let a waker Control run a blocking wait. Null outside Orca.
function selfHarness(me = process.env.ORCA_TERMINAL_HANDLE) {
  if (!me) return null;
  const terms = ((orca(["terminal", "list"]).result || {}).terminals || []);
  const t = terms.find((x) => x && x.handle === me);
  return (t && t.agentIdentity) || null;
}

function validateAck(f) {
  if (f.ack != null && (typeof f.ack !== "string" || !f.ack.trim())) {
    fail("--ack requires a deliveryId", { run: f.run });
  }
}

function wait(f) {
  validateAck(f);
  const self = selfHarness();
  if (process.env.DELY_WAITER !== "1") {
    const who = self || f.control;
    const wake = (harnessById(who) || {}).controlWake || "unknown";
    if (wake !== "background") {
      const said = self && self !== f.control ? " (called with --control " + f.control + ")" : "";
      out("REFUSED " + who + " wakes by " + wake + said + "; use dely wait-bg", 3);
    }
  }
  const as = f.as ? ["--terminal", f.as] : [];
  const control = (f.as ? selfHarness(f.as) : self) || f.control || null;
  const deadline = Date.now() + Number(f["timeout-min"] || 55) * 60000;
  const stallMin = Number(f["stall-min"] || 10);
  const skip = String(f.skip || "").split(",").filter(Boolean);
  const track = {};
  let lastProgressCheck = 0;
  let pendingAck = typeof f.ack === "string" ? f.ack : null;
  let waiting = false;
  while (Date.now() < deadline) {
    const ack = pendingAck;
    pendingAck = null;
    const r = orca([
      "orchestration",
      "check",
      ...as,
      ...(ack ? ["--ack", ack] : []),
      "--wait",
      "--run",
      f.run,
      "--timeout-ms",
      String(Math.max(1, Math.floor(POLL_S * 1000))),
    ]);
    if (r.ok === false) fail((r.error && r.error.message) || (ack ? "check --ack failed" : "check failed"), { run: f.run });
    if (!waiting) {
      logEvent("wait", { run: f.run, control });
      waiting = true;
    }
    const res = r.result || {};
    if (res.deliveryId) {
      const msgs = res.messages || [];
      if (msgs.some(settling)) {
        // A worker that settled with an accepted worker_done is finished; an
        // escalation or question is alive and waiting for a reply.
        const done = msgs.filter((m) => !isRejected(m) && m.type === "worker_done").map(messageDispatchId);
        const release = [...new Set(done.filter(Boolean))].map(releaseWorker);
        logEvent("settled", {
          run: f.run,
          deliveryId: res.deliveryId,
          control,
          messages: msgs.map((m) => ({
            type: m.type,
            subject: m.subject,
            dispatchId: messageDispatchId(m),
          })),
          release,
        });
        out(
          {
            SETTLED: res.deliveryId,
            messages: msgs.map((m) => ({
              id: m.id,
              type: m.type,
              from: m.from_handle,
              subject: m.subject,
              payload: m.payload,
            })),
            release,
          },
          0
        );
      }
      if (msgs.some((m) => ["worker_done", "escalation", "question"].includes(m.type)) && !msgs.some(settling)) {
        logEvent("rejected", {
          run: f.run,
          deliveryId: res.deliveryId,
          control,
          messages: msgs.map((m) => ({
            type: m.type,
            subject: m.subject,
            dispatchId: messageDispatchId(m),
          })),
        });
      }
      orca(["orchestration", "check", ...as, "--run", f.run, "--ack", res.deliveryId]);
      continue;
    }
    const rows = ((orca(["orchestration", "worker-list", "--run", f.run]).result || {}).workers || []).filter(
      (w) => !skip.includes(w.dispatchId)
    );
    // dispatched is load-bearing: pending+requiresAction is the start
    // transient; completed+release is a settled worker awaiting release.
    const act = rows.filter((w) => {
      const proj = w.projection || {};
      // An absent optional field is an absent field, not a value: a row with
      // no projection, or a projection with no nextAction, is not attention.
      const kind = (proj.nextAction || {}).kind || "none";
      const needs = (proj.attention || {}).requiresAction === true;
      return w.dispatchStatus === "dispatched" && (kind !== "none" || needs);
    });
    if (act.length) {
      const payload = act.map((w) => ({
        dispatchId: w.dispatchId,
        liveness: (w.projection || {}).liveness,
        nextAction: (w.projection || {}).nextAction,
        attention: (w.projection || {}).attention,
      }));
      logEvent("attention", { run: f.run, workers: payload });
      out({ ATTENTION: payload }, 8);
    }
    if (Date.now() - lastProgressCheck < PROGRESS_S * 1000) continue;
    lastProgressCheck = Date.now();
    for (const w of rows.filter((w) => w.dispatchStatus === "dispatched")) {
      const idle = advance(track, w.dispatchId);
      const rec = track[w.dispatchId] || {};
      if (!rec.error && rec.source !== "transcript") continue;
      if (idle >= stallMin) {
        const raw = screenText(w.dispatchId);
        const why = rec.error ? rec.error : "no new output for " + Math.floor(idle) + " min";
        logEvent("stalled", {
          run: f.run,
          dispatchId: w.dispatchId,
          idleMinutes: Math.floor(idle),
          liveness: (w.projection || {}).liveness,
          text: raw,
        });
        out(
          "STALLED " +
            w.dispatchId +
            " " +
            why +
            "; liveness " +
            JSON.stringify((w.projection || {}).liveness) +
            "; last output: " +
            clip(raw),
          6
        );
      }
    }
  }
  logEvent("deadline", { run: f.run });
  out("DEADLINE", 7);
}

function waitBg(f) {
  validateAck(f);
  requireHandle({ run: f.run });
  const me = process.env.ORCA_TERMINAL_HANDLE;
  const file = path.resolve(f.out || path.join(os.tmpdir(), "dely-wait-" + f.run + ".out"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = file + ".lock";
  const recorded = () => {
    try {
      const j = JSON.parse(fs.readFileSync(lock, "utf8"));
      return (j && j.terminal) || "";
    } catch (_) {
      return "";
    }
  };
  const live = (handle) => {
    if (!handle) return false;
    const terms = ((orca(["terminal", "list"]).result || {}).terminals || []);
    return terms.some((t) => t && t.handle === handle);
  };
  const writeLock = (handle) => {
    try {
      fs.writeFileSync(lock, JSON.stringify({ terminal: handle || "" }));
    } catch (_) {
      /* vanished or unwritable */
    }
  };
  try {
    fs.writeFileSync(lock, JSON.stringify({ terminal: "" }), { flag: "wx" });
  } catch (_) {
    if (live(recorded())) {
      logEvent("wait_bg", { run: f.run, which: "ALREADY_WAITING", path: file, control: selfHarness() || f.control || null });
      out("ALREADY_WAITING: a dely wait is running for this Run; end your turn, it will wake you.", 0);
    }
    writeLock("");
  }
  try {
    fs.unlinkSync(file);
  } catch (_) {
    /* no prior output */
  }
  const q = JSON.stringify;
  const self = q(__filename);
  const bin = q(process.execPath);
  const extra = ["control", "skip", "stall-min", "timeout-min", "ack"]
    .filter((k) => f[k] && f[k] !== true)
    .map((k) => " --" + k + " " + q(f[k]))
    .join("");
  const posixCmd =
    "DELY_WAITER=1 " +
    bin +
    " " +
    self +
    " wait --run " +
    q(f.run) +
    " --as " +
    q(me) +
    extra +
    " > " +
    q(file) +
    " 2>&1; rm -f " +
    q(lock) +
    "; " +
    bin +
    " " +
    self +
    " notify --run " +
    q(f.run) +
    " --as " +
    q(me) +
    " --out " +
    q(file) +
    "; exit";
  const windows = process.platform === "win32";
  const quotePs = (value) => "'" + String(value).replace(/'/g, "''") + "'";
  const childArgs = [process.execPath, __filename, "_wait-bg-child",
    "--run", f.run, "--as", me, "--out", file];
  for (const k of ["control", "skip", "stall-min", "timeout-min", "ack"]) {
    if (f[k] && f[k] !== true) childArgs.push("--" + k, f[k]);
  }
  const cmd = windows
    ? "& " + childArgs.map(quotePs).join(" ") + "; exit $LASTEXITCODE"
    : posixCmd;
  const r = orca([
    "terminal", "create", "--worktree", "path:" + process.cwd(),
    ...(windows ? ["--shell", "powershell.exe"] : []),
    "--title", "dely-wait", "--command", cmd,
  ]);
  if (r.ok === false) {
    try {
      fs.unlinkSync(lock);
    } catch (_) {
      /* lock */
    }
    fail((r.error && r.error.message) || "terminal create failed", { run: f.run });
  }
  writeLock((r.result && r.result.terminal && r.result.terminal.handle) || "");
  logEvent("wait_bg", { run: f.run, which: "WAITING", path: file, control: selfHarness() || f.control || null });
  out("WAITING", 0);
}

function waitBgChild(f) {
  const file = path.resolve(f.out);
  const args = ["wait", "--run", f.run, "--as", f.as];
  for (const k of ["control", "skip", "stall-min", "timeout-min", "ack"]) {
    if (f[k] && f[k] !== true) args.push("--" + k, f[k]);
  }
  const fd = fs.openSync(file, "w");
  try {
    const child = spawnSync(process.execPath, [__filename, ...args], {
      env: { ...process.env, DELY_WAITER: "1" },
      stdio: ["ignore", fd, fd],
    });
    if (child.error) fs.writeSync(fd, "ERROR waiter launch: " + child.error.message + "\n");
  } finally {
    fs.closeSync(fd);
    try { fs.unlinkSync(file + ".lock"); } catch (_) { /* lock already gone */ }
  }
  notify(f);
}

function notify(f) {
  const run = (orca(["orchestration", "run-show", "--id", f.run]).result || {}).run || {};
  const to = run.coordinator_handle || f.as;
  const text = "dely wait finished for " + f.run + ". Finish your current step, then read " + f.out + " and continue.";
  const retryMs = Math.max(1, Math.floor(NOTIFY_RETRY_S * 1000));
  const giveUpMs = NOTIFY_GIVEUP_S * 1000;
  for (const t0 = Date.now(); ; ) {
    const r = orca(["terminal", "send", "--terminal", to, "--text", text, "--enter"]);
    if (r.ok !== false) {
      logEvent("notify", { run: f.run, target: to, result: "sent" });
      return;
    }
    const msg = (r.error && r.error.message) || "";
    if (!/agent_prompt_blocked/.test(msg)) {
      logEvent("notify", { run: f.run, target: to, result: "failed" });
      return;
    }
    const left = giveUpMs - (Date.now() - t0);
    if (left <= 0) {
      logEvent("notify", { run: f.run, target: to, result: "gave_up" });
      process.exit(1);
    }
    sleep(Math.min(retryMs, left));
  }
}

function cleanup(f) {
  const controlHandle = process.env.ORCA_TERMINAL_HANDLE ||
    (((orca(["orchestration", "run-show", "--id", f.run]).result || {}).run || {}).coordinator_handle) || null;

  const termsList = ((orca(["terminal", "list"]).result || {}).terminals || []);
  const wList = ((orca(["orchestration", "worker-list", "--run", f.run]).result || {}).workers || []);
  const ownedRecords = getOwnedTerminals(f.run);
  const ownedSnapshots = getOwnedSnapshots(f.run);

  let closed = 0;
  let retained = 0;
  const retainedHandles = [];

  for (const rec of ownedRecords) {
    const handle = rec.terminalHandle;
    if (!handle) continue;
    if (controlHandle && handle === controlHandle) continue;

    const termInfo = termsList.find((t) => t && t.handle === handle);
    if (!termInfo) {
      if (rec.dispatchId) {
        const worker = wList.find((w) => w && w.dispatchId === rec.dispatchId);
        const liveness = (worker && worker.projection && worker.projection.liveness) || {};
        if (worker && worker.dispatchStatus === "dispatched" && liveness.verdict !== "dead" && liveness.verdict !== "exited") {
          retained++;
          retainedHandles.push(handle);
          logEvent("terminal_retained", { run: f.run, handle, dispatchId: rec.dispatchId, reason: "live_dispatch_missing_term_inventory" });
          continue;
        }
      }
      continue;
    }

    const dead = isProvenDead(rec.dispatchId, handle, f.run);
    const worker = rec.dispatchId ? wList.find((w) => w && w.dispatchId === rec.dispatchId) : null;
    const proj = (worker && worker.projection) || {};
    const stage = proj.stage || {};
    const stageWorker = typeof stage === "string" ? stage : (stage.worker || "");
    const stageSettled = stageWorker === "settled" || stageWorker === "completed" || stage.detail === "settled" || stage.settled === true;
    const hasAcceptedSettlement = Boolean(
      proj.acceptedSettlement ||
      (worker && worker.acceptedSettlement) ||
      proj.settlement ||
      (worker && worker.settlement) ||
      stageSettled
    );
    const isSettled = Boolean(
      worker &&
      (worker.dispatchStatus === "settled" ||
       worker.dispatchStatus === "completed" ||
       hasAcceptedSettlement ||
       stageSettled)
    );

    if (dead || isSettled || (!rec.dispatchId && dead)) {
      try {
        orca(["terminal", "read", "--terminal", handle, "--screen"]);
      } catch (_) {}
      const r = orca(["terminal", "close", "--terminal", handle]);
      if (r.ok !== false) closed++;
    } else {
      retained++;
      retainedHandles.push(handle);
      logEvent("terminal_retained", { run: f.run, handle, dispatchId: rec.dispatchId, reason: "live_or_unsettled" });
    }
  }

  let artifacts = 0;
  let retainedArtifacts = 0;
  const cleanedDirs = new Set();

  for (const snap of ownedSnapshots) {
    if (!snap || !snap.snapshotPath) continue;
    const normPath = path.resolve(snap.snapshotPath);
    const dir = path.dirname(normPath);
    if (path.basename(dir) !== ".tmp-dely") {
      continue;
    }

    let canDelete = false;
    if (snap.dispatchId) {
      const worker = wList.find((w) => w && w.dispatchId === snap.dispatchId);
      const proj = (worker && worker.projection) || {};
      const stage = proj.stage || {};
      const stageWorker = typeof stage === "string" ? stage : (stage.worker || "");
      const stageSettled = stageWorker === "settled" || stageWorker === "completed" || stage.detail === "settled" || stage.settled === true;
      const hasAcceptedSettlement = Boolean(
        proj.acceptedSettlement ||
        (worker && worker.acceptedSettlement) ||
        proj.settlement ||
        (worker && worker.settlement) ||
        stageSettled
      );
      const isSettled = Boolean(
        worker &&
        (worker.dispatchStatus === "settled" ||
         worker.dispatchStatus === "completed" ||
         hasAcceptedSettlement ||
         stageSettled)
      );
      const dead = isProvenDead(snap.dispatchId, null, f.run);
      if (isSettled || dead) {
        canDelete = true;
      }
    } else {
      canDelete = false;
    }

    if (canDelete) {
      try {
        if (fs.existsSync(normPath)) {
          fs.unlinkSync(normPath);
          artifacts++;
          cleanedDirs.add(dir);
        }
      } catch (_) {}
    } else {
      retainedArtifacts++;
      logEvent("snapshot_retained", { run: f.run, path: normPath, dispatchId: snap.dispatchId, reason: "live_or_unsettled" });
    }
  }

  for (const dir of cleanedDirs) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    } catch (_) {}
  }

  if (retained === 0 && retainedArtifacts === 0) {
    try { fs.unlinkSync(ownedStatePath(f.run)); } catch (_) {}
    try { fs.unlinkSync(legacyAgyStatePath(f.run)); } catch (_) {}
  }

  logEvent("cleanup", { run: f.run, closed, retained, artifacts, retainedArtifacts });
  let outMsg = "CLEANED " + closed + " terminals " + artifacts + " artifacts";
  if (retained > 0 || retainedArtifacts > 0) {
    const details = [];
    if (retained > 0) details.push(retained + " retained: " + retainedHandles.join(", "));
    if (retainedArtifacts > 0) details.push(retainedArtifacts + " artifacts retained");
    outMsg += " (" + details.join("; ") + ")";
  }
  out(outMsg, 0);
}

function logCmd(f) {
  if (typeof f.repo === "string") f.repo = path.resolve(f.repo);
  else delete f.repo;
  let payload;
  try {
    payload = JSON.parse(f.json);
  } catch (e) {
    fail("cannot parse --json: " + (e.message || e), { run: f.run });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("--json must be an object", { run: f.run });
  }
  const repo = f.repo || payload.repo || null;
  const root = repo ? path.resolve(repo) : null;
  const listed = root ? listFiles(runFolder(root, f.run)) : null;
  const residue = listed && !listed.err ? listed.files.map((p) => path.relative(root, p)).sort() : null;
  const extra = listed && listed.err ? { residueError: listed.err.code + " " + path.relative(root, listed.err.dir) } : {};
  const swept = releaseReclaimable(f.run);
  const released = { release: swept.release };
  if (swept.releaseError != null) released.releaseError = swept.releaseError;
  logEvent("delivery", Object.assign({}, payload, { run: f.run, repo, residue }, extra, released));
  process.exit(0);
}

function pinsCmd(f) {
  const result = {};
  for (const phase of ["implement", "review"]) {
    const p = pin(path.resolve(f.repo), phase);
    result[phase] = { harness: p.agent, model: p.model, effort: p.effort, source: p.source || "AGENTS.md", file: p.file || null };
  }
  out(result, 0);
}

const COMMANDS = {
  pins: { required: [["repo", "PATH"]], optional: [] },
  preflight: { required: [["repo", "PATH"], ["run", "RUN"]], optional: [["assessment-file", "FILE"], ["spec-file", "FILE"]] },
  dispatch: {
    required: [
      ["repo", "PATH"],
      ["run", "RUN"],
      ["phase", "implement"],
      ["spec-file", "FILE"],
    ],
    optional: [["fallback", "quota"], ["fallback-stage", "1"], ["assessment-file", "FILE"]],
  },
  wait: {
    required: [["run", "RUN"], ["control", "HARNESS"]],
    optional: [
      ["as", "TERMINAL"],
      ["skip", "IDS"],
      ["stall-min", "N"],
      ["timeout-min", "N"],
      ["ack", "DELIVERY"],
    ],
  },
  "wait-bg": {
    required: [["run", "RUN"], ["control", "HARNESS"]],
    optional: [
      ["out", "FILE"],
      ["skip", "IDS"],
      ["stall-min", "N"],
      ["timeout-min", "N"],
      ["ack", "DELIVERY"],
    ],
  },
  notify: {
    required: [["run", "RUN"], ["out", "FILE"]],
    optional: [["as", "TERMINAL"]],
  },
  cleanup: {
    required: [["run", "RUN"]],
    optional: [],
  },
  log: {
    required: [["run", "RUN"], ["json", "OBJ"]],
    optional: [["repo", "PATH"]],
  },
};

function usageLine(name) {
  const spec = COMMANDS[name];
  const bits = spec.required.map(([k, v]) => "--" + k + " " + v);
  const opts = spec.optional.map(([k, v]) => "[--" + k + " " + v + "]");
  return "  dely " + name + " " + bits.concat(opts).join(" ");
}

function printUsage() {
  console.log("usage:");
  for (const name of Object.keys(COMMANDS)) console.log(usageLine(name));
  console.log("  dely <subcommand> --help");
}

const [cmd, ...rest] = process.argv.slice(2);
const table = { pins: pinsCmd, preflight, dispatch, wait, "wait-bg": waitBg, notify, cleanup, log: logCmd };
if (cmd === "_wait-bg-child") {
  const childFlags = flags(rest);
  if (!childFlags.run || !childFlags.as || !childFlags.out) process.exit(2);
  waitBgChild(childFlags);
  process.exit(0);
}
if (!cmd) {
  printIdentity();
  printUsage();
  process.exit(0);
}
if (!COMMANDS[cmd]) {
  printUsage();
  process.exit(2);
}
const f = flags(rest);
if (f.help === true) {
  const i = rest.indexOf("--help");
  if (!(i > 0 && String(rest[i - 1]).startsWith("--"))) {
    console.log(usageLine(cmd));
    process.exit(0);
  }
}
const missing = COMMANDS[cmd].required.filter(([k]) => !f[k]).map(([k]) => "--" + k);
if (missing.length) {
  console.log("missing " + missing.join(", "));
  console.log(usageLine(cmd));
  process.exit(2);
}
if (f.fallback != null && cmd !== "dispatch") {
  console.log("ERROR --fallback is supported only for implementation dispatch");
  console.log(usageLine(cmd));
  process.exit(2);
}
if (cmd === "dispatch" && f.phase !== "implement") {
  console.log("ERROR AGY dispatch is implement-only; review is owned by Codex Control");
  console.log(usageLine(cmd));
  process.exit(2);
}
if (cmd === "dispatch" && f.fallback != null && f.fallback !== "quota") {
  console.log("ERROR unknown fallback reason: " + f.fallback + " (supported: quota)");
  console.log(usageLine(cmd));
  process.exit(2);
}
if (f["fallback-stage"] != null && cmd !== "dispatch") {
  console.log("ERROR --fallback-stage is supported only for implementation dispatch");
  console.log(usageLine(cmd));
  process.exit(2);
}
if (f["fallback-stage"] != null && f.fallback !== "quota") {
  console.log("ERROR --fallback-stage requires --fallback quota");
  console.log(usageLine(cmd));
  process.exit(2);
}
if (f["fallback-stage"] != null && !["1", "2"].includes(String(f["fallback-stage"]))) {
  console.log("ERROR invalid fallback stage: " + f["fallback-stage"] + " (supported: 1, 2)");
  console.log(usageLine(cmd));
  process.exit(2);
}
currentCommand = cmd;
currentFlags = f;
guardBefore(cmd, f);
table[cmd](f);
