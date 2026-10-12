#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { parseArgs } = require("node:util");

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const hashFile = (file) => digest(fs.readFileSync(file));
const canonical = (file) => fs.realpathSync(file);
const samePath = (a, b) => {
  const normalize = (p) => process.platform === "win32" ? canonical(p).toLowerCase() : canonical(p);
  return normalize(a) === normalize(b);
};
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
};
const root = (home) => path.join(home, "dely-compliance");
const stateFile = (home, session) => path.join(root(home), "sessions", digest(session) + ".json");
const settingsFile = (home) => path.join(root(home), "settings.json");
const NATIVE_SCHEMA = "native-skills-v3";
const promptFile = (home, session) => path.join(root(home), "prompts", digest(session) + ".json");
const inputFile = (home, session, turn, nonce = "") => path.join(root(home), "inputs", digest(session + "\0" + turn + "\0" + nonce) + ".json");
const fingerprints = (files) => Object.fromEntries(files.map((file) =>
  [fs.existsSync(file) ? canonical(file) : path.resolve(file), fs.existsSync(file) ? hashFile(file) : null]));
const unchanged = (file, hash) => (fs.existsSync(file) ? hashFile(file) : null) === hash;
const pathBindings = (files) => Object.fromEntries(files.map((file) =>
  [path.resolve(file), fs.existsSync(file) ? canonical(file) : null]));
const checkCatalogPaths = (state) => {
  if (state.catalog_paths && JSON.stringify(pathBindings(Object.keys(state.catalog_paths))) !== JSON.stringify(state.catalog_paths)) {
    throw Error("Skill catalog path changed; prepare and review again.");
  }
};
const psQuote = (value) => "'" + value.replace(/'/g, "''") + "'";
const nodeCommand = (script) => process.platform === "win32" ?
  "& " + psQuote(process.execPath) + " " + psQuote(script) : 'node "' + script + '"';

function taskInputWrite(event, state, home) {
  if (event.tool_name !== "apply_patch" || !event.turn_id || state.session !== event.session_id ||
      state.turn !== event.turn_id || (!/^[a-f0-9]{24}$/.test(state.input_nonce || "") &&
        !(state.status === "PENDING" && state.input_nonce === undefined))) return false;
  try {
    checkPrompt(state, home);
    if (!samePath(state.repo, event.cwd)) return false;
    const payload = event.tool_input;
    const patch = typeof payload === "string" ? payload :
      payload && Object.keys(payload).length === 1 ? payload.input ?? payload.patch ?? payload.command : null;
    if (typeof patch !== "string" || Buffer.byteLength(patch, "utf8") > 256 * 1024) return false;
    const lines = patch.trimEnd().replace(/\r\n/g, "\n").split("\n");
    if (lines[0] !== "*** Begin Patch" || !lines[1]?.startsWith("*** Add File: ") ||
        lines.at(-1) !== "*** End Patch" || !lines.slice(2, -1).every((line) => line.startsWith("+"))) return false;
    const file = path.resolve(lines[1].slice("*** Add File: ".length));
    const expected = inputFile(home, event.session_id, event.turn_id, state.input_nonce);
    const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
    if (normalize(file) !== normalize(path.resolve(expected))) return false;
    for (let entry = file; ; entry = path.dirname(entry)) {
      const stat = fs.lstatSync(entry, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink() || (entry === file && stat)) return false;
      if (normalize(entry) === normalize(path.resolve(root(home)))) break;
      if (entry === path.dirname(entry)) return false;
    }
    const task = JSON.parse(lines.slice(2, -1).map((line) => line.slice(1)).join("\n"));
    if (!["implement", "advice"].includes(task.mode) || typeof task.request !== "string" || !task.request.trim() ||
        !Array.isArray(task.skills) || !Array.isArray(task.required_skills) ||
        task.skills.some((skill) => !skill || typeof skill.name !== "string" || !skill.name.trim() ||
          typeof skill.description !== "string" || !skill.description.trim() || !path.isAbsolute(skill.path)) ||
        task.required_skills.some((id) => !task.skills.some((skill) => skill.name === id || skill.path === id))) return false;
    return task.mode === "advice" || (typeof task.spec === "string" && task.spec.trim() &&
      task.context?.requirements_confirmed === true && ["scope", "coupling", "acceptance", "evidence"]
        .every((key) => typeof task.context[key] === "string" && task.context[key].trim()) &&
      ["security", "data", "public_contract", "architecture", "production", "routing"]
        .every((key) => typeof task.context.risks?.[key] === "boolean"));
  } catch (_) { return false; }
}

function checkPrompt(state, home) {
  const file = promptFile(home, state.session);
  if (!fs.existsSync(file)) return;
  const prompt = read(file);
  if (prompt.turn !== state.turn || prompt.input_nonce !== state.input_nonce || !samePath(prompt.repo, state.repo)) {
    throw Error("User prompt changed; prepare and review the current request.");
  }
}

function skillSnapshot(roster, selected, advisor, home) {
  const originalBindings = pathBindings(roster.map((skill) => skill.path));
  const keys = new Set(selected.map((skill) => advisor.skillKey(skill.path)));
  const sources = roster.filter((skill) => keys.has(advisor.skillKey(skill.path)));
  const files = [...sources.flatMap((skill) => [skill.path, canonical(skill.path), ...advisor.skillPolicyPaths(skill.path)]),
    path.join(home, "config.toml")];
  // A currently unrelated alias may later join a selected source's policy group.
  const snapshot = { fingerprints: fingerprints(files),
    catalog_paths: { ...pathBindings(files), ...originalBindings } };
  snapshot.skills = advisor.combineSkills(sources, [], home).skills;
  checkSnapshot(snapshot);
  return snapshot;
}

function checkSnapshot(snapshot) {
  checkCatalogPaths(snapshot);
  if (Object.entries(snapshot.fingerprints).some(([file, hash]) => !unchanged(file, hash))) {
    throw Error("Selected skill sources or policies changed; prepare and review again.");
  }
}

function instructions(cwd, home) {
  const files = new Set();
  for (const base of [home, path.join(os.homedir(), ".codex")]) {
    const file = path.join(base, "AGENTS.md");
    if (fs.existsSync(file)) files.add(canonical(file));
  }
  for (let directory = canonical(cwd); ; directory = path.dirname(directory)) {
    const file = path.join(directory, "AGENTS.md");
    if (fs.existsSync(file)) files.add(canonical(file));
    if (path.dirname(directory) === directory) break;
  }
  return fingerprints([...files]);
}

function checkedSettings(home) {
  const settings = read(settingsFile(home));
  for (const [file, hash] of Object.entries(settings.dependencies)) {
    if (hashFile(file) !== hash) throw Error("Installed advice/routing changed; reinstall between tasks.");
  }
  return settings;
}

function context(event, home, state = {}) {
  const script = path.join(root(home), "codex-compliance.js").replace(/\\/g, "/");
  const workerContext = state.worker_claim && (state.worker_claim.spec_sha256 || state.worker_claim.receipts.length) ?
    "Dely-dispatched Codex workers inherit Codex Control's reviewed admission only after current prompt, terminal, model, route, dispatch and owned-inventory checks pass. " +
    "Read the supplied task spec and send its heartbeat receipt first. Do not prepare or review a task as a worker; report an admission denial to Control. " +
    "The preparation procedure below is for Codex Control. " : "";
  return "Dely compliance is active. Follow the session's AGENTS.md and mandatory skills. " +
    workerContext +
    "Before implementation, supply the actual session skill roster and task evidence to: " + nodeCommand(script) +
    " prepare --session \"" + event.session_id + "\" --turn \"" + event.turn_id +
    "\" --repo \"" + event.cwd + "\" --home " + (process.platform === "win32" ? psQuote(home) : '"' + home + '"') +
    " --task-file \"" + inputFile(home, event.session_id, event.turn_id, state.input_nonce).replace(/\\/g, "/") + "\". " +
    "Use apply_patch to add only that current-turn JSON input file before review; it grants no implementation authority. " +
    "Choose skills from the actual native session roster, retain mandatory/user-selected skills, then explicitly review with this script's review command. " +
    "Skill advice is optional through the existing Jev CLI; task-difficulty assessment remains required. " +
    "Hard is direct; Easy/Medium-/Medium+ require an actual Dely Run ID on review --run and a matching Dely dispatch before edits. " +
    "Prefer reviewed Dely for reversible bounded internal changes. Hard flags describe consequential effects, not task topics; record concrete evidence for each exclusion. " +
    "Easy/Medium- use AGY gemini-3.8-flash-medium/default; Medium+ keeps claude-sonnet-5-5-high/default with verified-absence or explicit-quota Luna/max fallback. " +
    "A recommendation never overrides mandatory or user-selected skills. Missing evaluations stay NOT_EVALUATED. " +
    "See \"" + path.join(root(home), "guide.md").replace(/\\/g, "/") + "\". " +
    "Read-only inspection and Orca coordination remain available.";
}

// Conservative convenience classification, not a shell parser or security boundary.
function commandWords(command) {
  const words = command.match(/'(?:[^']|'')*'|"(?:[^"]|\x60")*"|[^\s]+/g) || [];
  return words.map((word) => /^['"]/.test(word) ? word.slice(1, -1) : word);
}

function needsReview(event, script) {
  const name = event.tool_name || "";
  if (/^(?:apply_patch|Edit|Write)$/.test(name)) return true;
  if (name !== "Bash") {
    return /(?:filesystem|fs_|file_|notebook|pycharm).*(?:write|edit|patch|delete|remove|create|rename|move|execute|insert|replace|append|set|run)/i.test(name);
  }
  const command = String(event.tool_input && (event.tool_input.command || event.tool_input.cmd) || "");
  let words = commandWords(command);
  if (words[0] === "&") words.shift();
  if (words[0] === "rtk") {
    words.shift();
    if (words[0] === "proxy") words.shift();
  }
  const executable = path.basename(words[0] || "").toLowerCase().replace(/\.exe$/, "");
  const unquoted = command.replace(/'(?:[^']|'')*'|"(?:\x60.|[^"\x60])*"/g, "");
  const chained = /[;|><\r\n]|\&\&|\$\(/.test(unquoted) ||
    words.some((word) => /^--(?:output|ext-diff)(?:=|$)/.test(word));
  if (executable === "node" && words[1] && !chained) {
    try {
      if (samePath(words[1], script) && ["prepare", "review", "status"].includes(words[2])) return false;
    } catch (_) { /* a missing script never grants an exemption */ }
  }
  if (chained) return true;
  if (executable === "orca") return false;
  if (["--help", "--version", "-h"].includes(words[1])) return false;
  if (["rg", "pwd", "get-location", "get-content", "get-childitem", "get-item", "test-path", "select-string", "get-filehash"].includes(executable)) return false;
  return !(executable === "git" && ["status", "diff", "log", "show", "ls-files", "rev-parse", "check-attr"].includes(words[1]));
}

function logRecords(file) {
  if (!fs.existsSync(file)) return [];
  // ponytail: cap the optional local journal at 16 MiB; rotate it before it exceeds this bound.
  if (fs.statSync(file).size > 16 * 1024 * 1024) throw Error("Dely journal exceeds the bounded scan limit.");
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function dispatchEvidence(state, settings) {
  const assessment = state.assessment;
  const rows = logRecords(settings.journal).filter((row) => row.run === state.run);
  const route = rows.find((row) => row.event === "task_route" && row.repo &&
    samePath(row.repo, state.repo) && row.specSha256 === assessment.task.spec_sha256 &&
    row.contextSha256 === assessment.task.context_sha256 && row.difficulty === assessment.difficulty);
  return route && rows.find((row) => row.event === "dispatch" && row.repo &&
    samePath(row.repo, state.repo) && row.phase === "implement" &&
    row.promptSha256 === assessment.task.spec_sha256 && row.dispatchId);
}

function verifiedWorker(event, settings, handle = process.env.ORCA_TERMINAL_HANDLE, claim = {}) {
  if (!handle) return false;
  const rows = logRecords(settings.journal);
  const dispatch = rows.findLast((row) => row.event === "dispatch" && row.repo && row.phase === "implement" &&
    row.terminalHandle === handle && samePath(row.repo, event.cwd) &&
    row.launch && row.launch.effective && row.launch.effective.agent === "codex" &&
    row.launch.effective.model === event.model && row.dispatchId);
  if (!dispatch || !/^[A-Za-z0-9_-]+$/.test(dispatch.run)) return false;
  if (!(claim.receipts || []).includes(dispatch.receiptMarker) && claim.spec_sha256 !== dispatch.promptSha256) return false;
  const route = rows.find((row) => row.event === "task_route" && row.run === dispatch.run &&
    row.repo && samePath(row.repo, event.cwd) && row.specSha256 === dispatch.promptSha256);
  if (!route) return false;
  const owned = path.join(os.tmpdir(), "dely-run-" + dispatch.run + ".jsonl");
  return logRecords(owned).some((row) => row.owned === true &&
    row.terminalHandle === handle && row.dispatchId === dispatch.dispatchId);
}

function validate(state, event, home, requireDispatch = true) {
  if (!state || state.session !== event.session_id || state.turn !== event.turn_id ||
      !samePath(state.repo, event.cwd) || state.status !== "REVIEWED") {
    throw Error("Current task has no reviewed native task and routing evidence. Run prepare, inspect results, then review.");
  }
  if (state.schema !== NATIVE_SCHEMA) throw Error("Legacy task evidence requires fresh prepare and review.");
  checkPrompt(state, home);
  const settings = checkedSettings(home);
  checkCatalogPaths(state);
  for (const [file, hash] of Object.entries(state.fingerprints)) {
    if (!unchanged(file, hash)) throw Error("Task, advice or loaded skill changed; prepare and review again.");
  }
  if (JSON.stringify(instructions(event.cwd, home)) !== JSON.stringify(state.instructions)) {
    throw Error("AGENTS.md changed; read the instructions and review the task again.");
  }
  if (state.mode !== "implement") throw Error("This task was reviewed for advice only; implementation needs a task assessment.");
  const routing = require(settings.routing);
  const checked = routing.review(state.assessment, state.assessment.difficulty, state.assessment.review.reason);
  if (JSON.stringify(checked.route) !== JSON.stringify(state.assessment.route)) throw Error("Reviewed route changed.");
  if (checked.route.workflow === "direct" && event.model !== checked.route.primary.model) {
    throw Error("The Hard route requires Codex " + checked.route.primary.model + "; current model evidence does not match.");
  }
  if (requireDispatch && checked.route.workflow === "dely" && !dispatchEvidence(state, settings)) {
    throw Error("This task requires Dely. No matching implementation dispatch exists for its exact spec/context.");
  }
  return state;
}

function hook(event, home, workerCheck = verifiedWorker) {
  if (!event.session_id || !event.cwd) throw Error("Hook requires a session and working directory.");
  const file = stateFile(home, event.session_id);
  const script = path.join(root(home), "codex-compliance.js");
  const type = event.hook_event_name;
  if (type === "SessionStart") {
    return { hookSpecificOutput: { hookEventName: type, additionalContext: context(event, home) } };
  }
  if (type === "UserPromptSubmit") {
    const prompt = typeof event.prompt === "string" ? event.prompt : "";
    const staged = prompt.match(/Task spec staged at \S+ \(\d+ bytes, SHA-256: ([a-f0-9]{64})\)/);
    const state = { session: event.session_id, turn: event.turn_id, repo: canonical(event.cwd), status: "PENDING",
      input_nonce: crypto.randomBytes(12).toString("hex"),
      worker_claim: { receipts: prompt.match(/rcpt_[a-f0-9]{16}/g) || [], spec_sha256: staged && staged[1] } };
    write(promptFile(home, event.session_id), { session: state.session, turn: state.turn,
      repo: state.repo, input_nonce: state.input_nonce });
    write(file, state);
    return { hookSpecificOutput: { hookEventName: type, additionalContext: context(event, home, state) } };
  }
  if (type !== "PreToolUse" && type !== "Stop") return {};
  if (type === "PreToolUse" && !needsReview(event, script)) return {};
  const state = fs.existsSync(file) ? read(file) : {};
  if (type === "PreToolUse" && taskInputWrite(event, state, home)) return {};
  try {
    checkPrompt(state, home);
    if (workerCheck(event, checkedSettings(home), process.env.ORCA_TERMINAL_HANDLE, state.worker_claim)) return {};
  } catch (_) { /* unknown worker identity never exempts a tool call */ }
  if (type === "Stop" && ((!state.attempted && state.mode !== "implement") || state.stop_reported)) return {};
  try {
    let coordinating = false;
    if (type === "PreToolUse" && event.tool_name === "Bash") {
      const command = String(event.tool_input && (event.tool_input.command || event.tool_input.cmd) || "");
      const words = commandWords(command);
      if (words[0] === "&") words.shift();
      if (words[0] === "rtk") {
        words.shift();
        if (words[0] === "proxy") words.shift();
      }
      const unquoted = command.replace(/'(?:[^']|'')*'|"(?:\x60.|[^"\x60])*"/g, "");
      const settings = checkedSettings(home);
      coordinating = !/[;|><\r\n]|\&\&|\$\(/.test(unquoted) &&
        path.basename(words[0] || "").replace(/\.exe$/i, "") === "node" && words[1] && !words[1].startsWith("-") &&
        fs.existsSync(words[1]) &&
        samePath(words[1], settings.dely) &&
        ["preflight", "dispatch", "wait", "wait-bg", "cleanup", "notify"].includes(words[2]);
    }
    validate(state, event, home, !coordinating);
    if (type === "PreToolUse" && !coordinating && (!state.attempted || state.stop_reported)) {
      write(file, { ...state, attempted: true, stop_reported: false });
    }
    return {};
  } catch (error) {
    const reason = error.message + " " + context(event, home, state);
    if (type === "Stop") {
      write(file, { ...state, stop_reported: true });
      return { decision: "block", reason: reason + " If blocked, report the limitation instead of claiming completion." };
    }
    write(file, { ...state, attempted: true, stop_reported: false });
    return { hookSpecificOutput: { hookEventName: type, permissionDecision: "deny", permissionDecisionReason: reason } };
  }
}

async function prepare(options, home) {
  const settings = checkedSettings(home);
  const sessionFile = stateFile(home, options.session);
  const pending = fs.existsSync(sessionFile) ? read(sessionFile) : {};
  const file = options["task-file"];
  if ((file !== undefined) === (options["task-json"] !== undefined)) {
    throw Error("Supply exactly one of --task-file or --task-json.");
  }
  const task = JSON.parse(file === undefined ? options["task-json"] :
    new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file)));
  if (!["implement", "advice"].includes(task.mode) || !task.request || !Array.isArray(task.skills)) {
    throw Error("Task JSON needs mode, request and the current session skills array.");
  }
  const repo = canonical(options.repo);
  if (task.skills.some((skill) => !path.isAbsolute(skill.path))) throw Error("Skill paths must come from the session's absolute catalog paths.");
  const directory = path.join(root(home), "tasks", crypto.randomBytes(12).toString("hex"));
  fs.mkdirSync(directory, { recursive: true });
  const skillInput = path.join(directory, "skills.json");
  const sessionRoster = path.join(directory, "session-skills.json");
  const sourceRoster = path.join(directory, "skill-sources.json");
  const taskInput = path.join(directory, "task.json");
  const advisor = require(settings.advisor);
  if (["combineSkills", "skillPolicyPaths", "skillKey", "validateInput"].some((name) => typeof advisor[name] !== "function")) throw Error("Reinstall the local skill policy helpers before preparing this task.");
  advisor.validateInput({ request: task.request, skills: task.skills }, "skill");
  const required = task.required_skills || [];
  if (!Array.isArray(required) || required.some((id) => !task.skills.some((skill) => skill.name === id || skill.path === id))) {
    throw Error("Every required skill must be in the supplied session roster.");
  }
  const selected = task.skills.filter((skill) => required.includes(skill.name) || required.includes(skill.path));
  const snapshot = skillSnapshot(task.skills, selected, advisor, home);
  const sources = task.skills.map((skill) => ({ ...skill, source: "session" }));
  write(taskInput, task);
  write(sessionRoster, { request: task.request, skills: task.skills });
  write(sourceRoster, { request: task.request, skills: sources });
  write(skillInput, { request: task.request, skills: task.skills });
  const state = {
    schema: NATIVE_SCHEMA,
    session: options.session, turn: options.turn, repo, mode: task.mode, status: "PREPARED",
    prepared_at: new Date().toISOString(), worker_claim: pending.worker_claim,
    task_input: taskInput, skill_input: skillInput, session_roster: sessionRoster,
    source_roster: sourceRoster, catalog_paths: snapshot.catalog_paths,
    skill_selection: { source: "native-session", advice_status: "NOT_REQUESTED" },
    required_skills: required, instructions: instructions(repo, home),
  };
  state.input_nonce = pending.turn === options.turn && /^[a-f0-9]{24}$/.test(pending.input_nonce || "") ?
    pending.input_nonce : crypto.randomBytes(12).toString("hex");
  if (task.mode === "implement") {
    if (typeof task.spec !== "string" || !task.context) throw Error("Implementation needs a spec and complete routing context.");
    const specFile = path.join(directory, "spec.md");
    const contextFile = path.join(directory, "context.json");
    fs.writeFileSync(specFile, task.spec, { flag: "wx", mode: 0o600 });
    write(contextFile, task.context);
    const routing = require(settings.routing);
    const loadedTask = routing.loadTask(repo, specFile, contextFile);
    if (routing.missingEvidence(loadedTask).length) throw Error("Complete and confirm the task context before implementation.");
    state.assessment = await routing.assess(loadedTask, { credentialRoot: settings.credential_root });
    write(path.join(directory, "assessment.json"), state.assessment);
  }
  checkSnapshot(snapshot);
  if (JSON.stringify(instructions(repo, home)) !== JSON.stringify(state.instructions)) throw Error("Instructions changed during preparation.");
  state.fingerprints = { ...fingerprints([taskInput, skillInput, sessionRoster, sourceRoster,
    ...(state.assessment ? [state.assessment.task.spec_file, state.assessment.task.context_file] : [])]), ...snapshot.fingerprints };
  const latest = fs.existsSync(sessionFile) ? read(sessionFile) : {};
  if (latest.turn !== pending.turn || latest.input_nonce !== pending.input_nonce) {
    throw Error("User prompt changed during preparation; prepare and review the current request.");
  }
  checkPrompt(state, home);
  write(stateFile(home, options.session), state);
  if (state.assessment) require(path.join(path.dirname(settings.routing), "usage.js")).recordTask(state.assessment, "assess", settings.journal);
  return { status: state.status, skill_selection: state.skill_selection, assessment: state.assessment, task_directory: directory };
}

function review(options, home) {
  if (!options.reason || !options["skill-reason"]) throw Error("Control must explain both routing and skill decisions.");
  const settings = checkedSettings(home);
  const file = stateFile(home, options.session);
  const state = read(file);
  if (state.schema !== NATIVE_SCHEMA) throw Error("Legacy task evidence requires fresh prepare and review.");
  if (state.turn !== options.turn || state.status !== "PREPARED") throw Error("Prepare this turn before reviewing.");
  checkCatalogPaths(state);
  for (const [p, hash] of Object.entries(state.fingerprints)) if (!unchanged(p, hash)) throw Error("Prepared inputs changed.");
  if (JSON.stringify(instructions(state.repo, home)) !== JSON.stringify(state.instructions)) throw Error("Instructions changed.");
  const input = read(state.skill_input);
  const roster = state.session_roster ? read(state.session_roster) : input;
  const advisor = require(settings.advisor);
  const key = advisor.skillKey;
  const originals = state.source_roster ? read(state.source_roster).skills : [...roster.skills, ...input.skills];
  const catalog = [...new Map(originals.map((skill) => {
    return [skill.name + "\0" + (process.platform === "win32" ? path.resolve(skill.path).toLowerCase() : path.resolve(skill.path)), skill];
  })).values()];
  const selected = JSON.parse(options.skills || "[]");
  if (!Array.isArray(selected) || selected.some((id) => !catalog.some((skill) => skill.name === id || skill.path === id))) {
    throw Error("Select supplied skills and retain every mandatory skill.");
  }
  const selectedSkills = [...new Set(selected.map((id) => {
    const matches = catalog.filter((skill) => skill.name === id || skill.path === id);
    if (matches.length !== 1) throw Error("Duplicate or ambiguous skill selectors require an exact catalog path or name matching one original record.");
    return matches[0];
  }))];
  if (state.required_skills.some((id) => !selectedSkills.some((skill) => skill.name === id || skill.path === id))) {
    throw Error("Select supplied skills and retain every mandatory skill.");
  }
  const snapshot = skillSnapshot(roster.skills, selectedSkills, advisor, home);
  const policies = new Map(snapshot.skills.map((skill) => [key(skill.path), skill]));
  for (const skill of selectedSkills) {
    const policy = policies.get(key(skill.path));
    if (policy.enabled === false) throw Error("Disabled skills cannot be loaded.");
    if (policy.allow_implicit_invocation === false && !roster.skills.some((record) =>
      record.name === skill.name && samePath(record.path, skill.path) &&
        (state.required_skills.includes(record.name) || state.required_skills.includes(record.path)))) {
      throw Error("Explicit-only skills must be required by the user's instruction or a mandatory workflow in the session roster.");
    }
  }
  const loaded = selectedSkills.map((skill) => {
    const file = snapshot.catalog_paths[path.resolve(skill.path)];
    const bytes = fs.readFileSync(file);
    if (digest(bytes) !== snapshot.fingerprints[file]) throw Error("Loaded skill source changed during review.");
    return { name: skill.name, path: file, text: bytes.toString("utf8") };
  });
  checkSnapshot(snapshot);
  checkSnapshot(state);
  checkedSettings(home);
  if (JSON.stringify(instructions(state.repo, home)) !== JSON.stringify(state.instructions)) throw Error("Instructions changed during review.");
  if (state.mode === "implement") {
    const routing = require(settings.routing);
    state.assessment = routing.review(state.assessment, options.difficulty, options.reason);
    if (state.assessment.route.workflow === "dely" && !loaded.some((skill) => samePath(skill.path, settings.delivery))) {
      throw Error("Delegated tasks must load the installed delivery skill.");
    }
    state.run = options.run ? options.run.trim() : null;
    if (state.assessment.route.workflow === "dely" && !state.run) {
      throw Error("Create an actual Dely Run, then review with --run <Run ID> before dispatching the reviewed task.");
    }
    write(path.join(path.dirname(state.skill_input), "reviewed.json"), state.assessment);
  }
  state.status = "REVIEWED";
  state.skill_review = { by: "codex-control", reason: options["skill-reason"], source: "native-session",
    evaluation_status: "NOT_REQUESTED", selected };
  state.catalog_paths = { ...state.catalog_paths, ...snapshot.catalog_paths };
  state.fingerprints = { ...state.fingerprints, ...snapshot.fingerprints };
  const latest = read(file);
  if (latest.turn !== state.turn || latest.input_nonce !== state.input_nonce) throw Error("User prompt changed during review.");
  checkPrompt(state, home);
  write(file, state);
  if (state.assessment) require(path.join(path.dirname(settings.routing), "usage.js")).recordTask(state.assessment, "review", settings.journal);
  return { status: state.status, route: state.assessment && state.assessment.route,
    skill_review: state.skill_review, loaded_skills: loaded };
}

function install(options, home) {
  const routing = canonical(options.routing);
  const advisor = canonical(options.advisor);
  const delivery = canonical(path.join(path.dirname(routing), "..", "SKILL.md"));
  const dely = canonical(path.join(path.dirname(routing), "dely.js"));
  const directory = root(home);
  const script = path.join(directory, "codex-compliance.js");
  const frozenAdvisor = path.join(directory, "jev-advisor.js");
  const advisorSource = fs.readFileSync(advisor, "utf8");
  const previous = fs.existsSync(settingsFile(home)) ? read(settingsFile(home)) : null;
  const credentialRoot = previous?.credential_root || path.dirname(path.dirname(previous?.advisor_source || advisor));
  const rootDeclaration = 'const ROOT = path.resolve(__dirname, "..");';
  if (!advisorSource.includes(rootDeclaration)) throw Error("Unrecognized advisor root; installation was not changed.");
  const hookCommand = nodeCommand(script) + " hook --home " +
    (process.platform === "win32" ? psQuote(home) : '"' + home + '"');
  const guide = path.resolve(__dirname, "../docs/codex-compliance.md");
  const manifestFile = path.join(home, "hooks.json");
  const manifest = fs.existsSync(manifestFile) ? read(manifestFile) : {};
  if (!manifest.hooks) manifest.hooks = {};
  const preserveHooks = options["preserve-hooks"] === true;
  for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "Stop"]) {
    const groups = manifest.hooks[event] || [];
    if (!Array.isArray(groups)) throw Error("Invalid existing hooks; nothing was installed.");
    if (preserveHooks) {
      if (groups.flatMap((group) => group.hooks || []).filter((item) =>
        item.statusMessage === "Checking Jev and Dely task evidence" && String(item.command || "").includes("codex-compliance.js")).length !== 1) {
        throw Error("Preserving hooks requires one existing compliance handler per event.");
      }
      continue;
    }
    manifest.hooks[event] = groups.map((group) => ({ ...group,
      hooks: (group.hooks || []).filter((item) => !(item.statusMessage === "Checking Jev and Dely task evidence" &&
        String(item.command || "").includes("codex-compliance.js"))),
    })).filter((group) => group.hooks.length);
    manifest.hooks[event].push({ hooks: [{
      type: "command", command: hookCommand,
      timeout: 15, statusMessage: "Checking Jev and Dely task evidence",
    }] });
  }
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(manifestFile)) fs.copyFileSync(manifestFile, path.join(directory,
    "hooks-before-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex") + ".json"));
  fs.copyFileSync(__filename, script);
  fs.copyFileSync(guide, path.join(directory, "guide.md"));
  const riskGuide = path.resolve(__dirname, "../docs/task-risk-policy.md");
  if (fs.existsSync(riskGuide)) fs.copyFileSync(riskGuide, path.join(directory, "task-risk-policy.md"));
  const adviceGuide = path.resolve(__dirname, "../docs/jev-skill-advice.md");
  if (fs.existsSync(adviceGuide)) fs.copyFileSync(adviceGuide, path.join(directory, "jev-skill-advice.md"));
  // Freeze advice code without moving its credential search root or copying any key.
  fs.writeFileSync(frozenAdvisor, advisorSource.replace(rootDeclaration,
    "const ROOT = " + JSON.stringify(credentialRoot) + ";\n"), { mode: 0o600 });
  write(settingsFile(home), { routing, advisor: frozenAdvisor, advisor_source: advisor, credential_root: credentialRoot, delivery, dely,
    dependencies: fingerprints([routing, path.join(path.dirname(routing), "usage.js"), frozenAdvisor, dely]), journal: path.join(os.homedir(), ".dely", "log.jsonl") });
  if (!preserveHooks) write(manifestFile, manifest);
  return { home, script, script_sha256: hashFile(script), configured_events: 4,
    trust: preserveHooks ? "UNCHANGED_REQUIRES_EXISTING_NATIVE_TRUST" : "REQUIRES_NATIVE_HOOK_REVIEW" };
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const { values } = parseArgs({ args: argv.slice(1), options: { ...Object.fromEntries(
    ["home", "session", "turn", "repo", "task-json", "task-file", "difficulty", "reason", "skill-reason", "skills", "run", "routing", "advisor"]
      .map((name) => [name, { type: "string" }])), "preserve-hooks": { type: "boolean" } } });
  const home = path.resolve(values.home || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  let result;
  if (command === "hook") result = hook(JSON.parse(fs.readFileSync(0, "utf8")), home);
  else if (command === "install") result = install(values, home);
  else if (command === "prepare" || command === "review") {
    if (!values.session || !values.turn) throw Error("Session and turn are required.");
    result = command === "prepare" ? await prepare(values, home) : review(values, home);
  } else if (command === "status") result = checkedSettings(home);
  else throw Error("Use install, prepare, review, status or hook; see docs/codex-compliance.md.");
  if (command === "prepare") {
    result = { status: result.status, task_directory: result.task_directory, skill_selection: result.skill_selection,
      ...(result.assessment ? { assessment: result.assessment } : {}) };
  }
  process.stdout.write(JSON.stringify(result) + "\n");
}

module.exports = { digest, fingerprints, stateFile, settingsFile, inputFile, taskInputWrite, instructions, needsReview, logRecords,
  dispatchEvidence, verifiedWorker, validate, hook, prepare, review, install };
if (require.main === module) main().catch(() => {
  console.error("Compliance check failed. Inspect the task inputs and installed hook guide; no source write was authorized.");
  process.exitCode = 2;
});
