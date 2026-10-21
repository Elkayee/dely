#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
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
const NATIVE_SCHEMA = "native-skills-v4";
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

function validTaskInput(task) {
  if (!["implement", "advice"].includes(task?.mode) || typeof task.request !== "string" || !task.request.trim() ||
      !Array.isArray(task.skills) || !Array.isArray(task.required_skills) ||
      task.skills.some((skill) => !skill || typeof skill.name !== "string" || !skill.name.trim() ||
        typeof skill.description !== "string" || !skill.description.trim() || !path.isAbsolute(skill.path)) ||
      task.required_skills.some((id) => !task.skills.some((skill) => skill.name === id || skill.path === id))) return false;
  return task.mode === "advice" || (typeof task.spec === "string" && task.spec.trim() &&
    task.context?.requirements_confirmed === true && ["scope", "coupling", "acceptance", "evidence"]
      .every((key) => typeof task.context[key] === "string" && task.context[key].trim()) &&
    ["security", "data", "public_contract", "architecture", "production", "routing"]
      .every((key) => typeof task.context.risks?.[key] === "boolean"));
}

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
    return validTaskInput(task);
  } catch (_) { return false; }
}

function runSpecWrite(event, state, home) {
  if (event.tool_name !== "apply_patch" || !/^[A-Za-z0-9_-]+$/.test(state.run || "") ||
      state.assessment?.route?.workflow !== "dely" || event.model !== state.native_model || state.worker_claim?.spec_sha256 ||
      state.worker_claim?.receipts?.length) return false;
  try {
    validate(state, event, home, false);
    const payload = event.tool_input;
    const patch = typeof payload === "string" ? payload :
      payload && Object.keys(payload).length === 1 ? payload.input ?? payload.patch ?? payload.command : null;
    if (typeof patch !== "string" || Buffer.byteLength(patch, "utf8") > 256 * 1024) return false;
    const lines = patch.trimEnd().replace(/\r\n/g, "\n").split("\n");
    if (lines[0] !== "*** Begin Patch" || !lines[1]?.startsWith("*** Add File: ") ||
        lines.at(-1) !== "*** End Patch" || !lines.slice(2, -1).every((line) => line.startsWith("+"))) return false;
    const repo = state.execution_repo || state.repo;
    const file = path.resolve(state.repo, lines[1].slice("*** Add File: ".length));
    const expected = path.join(repo, ".dely", "local", "runs", state.run, "spec.md");
    const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
    if (normalize(file) !== normalize(expected)) return false;
    for (let entry = file; ; entry = path.dirname(entry)) {
      const stat = fs.lstatSync(entry, { throwIfNoEntry: false });
      if (stat && (entry === file || stat.isSymbolicLink() || !stat.isDirectory())) return false;
      if (normalize(entry) === normalize(repo)) break;
      if (entry === path.dirname(entry)) return false;
    }
    const body = lines.slice(2, -1).map((line) => line.slice(1)).join("\n") + "\n";
    return digest(body) === state.assessment.task.spec_sha256;
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

function executionRepo(task, origin) {
  if (!Object.hasOwn(task, "execution_repo")) return origin;
  const target = task.execution_repo;
  if (typeof target !== "string" || !path.isAbsolute(target) || !fs.statSync(target).isDirectory()) {
    throw Error("execution_repo must be an existing absolute repository directory.");
  }
  const resolved = canonical(target);
  if (!samePath(resolved, origin)) {
    const common = (repo) => {
      const result = spawnSync("git", ["-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { encoding: "utf8", timeout: 10000, windowsHide: true });
      if (result.status !== 0 || !result.stdout.trim()) throw Error("Cannot verify the execution repository.");
      return canonical(result.stdout.trim());
    };
    if (!samePath(common(origin), common(resolved))) throw Error("execution_repo must belong to the Control repository.");
  }
  return resolved;
}

function checkExecutionRepo(state, home) {
  const task = read(state.task_input);
  if (!Object.hasOwn(task, "execution_repo")) {
    if (state.execution_repo) throw Error("Execution repository was not prepared.");
    return;
  }
  if (!state.execution_repo || state.execution_repo_path !== task.execution_repo ||
      !samePath(executionRepo(task, state.repo), state.execution_repo) ||
      (state.assessment && !samePath(state.assessment.task.repo, state.execution_repo))) {
    throw Error("Execution repository changed; prepare and review again.");
  }
  if (JSON.stringify(instructions(state.execution_repo, home)) !== JSON.stringify(state.execution_instructions)) {
    throw Error("Execution repository instructions changed; prepare and review again.");
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

function nativeModelContext(event) {
  const model = typeof event.model === "string" && event.model.trim() ? JSON.stringify(event.model) : "NOT_EVALUATED";
  return "Native Codex hook model: " + model + "; session: " + event.session_id +
    "; turn: " + event.turn_id + "; effort: NOT_EVALUATED (not supplied by the native hook). " +
    "This model evidence does not grant task admission. ";
}

function context(event, home, state = {}) {
  const script = path.join(root(home), "codex-compliance.js").replace(/\\/g, "/");
  const workerContext = state.worker_claim && (state.worker_claim.spec_sha256 || state.worker_claim.receipts.length) ?
    "Dely-dispatched Codex workers inherit Codex Control's reviewed admission only after current prompt, terminal, model, route, dispatch and owned-inventory checks pass. " +
    "Read the supplied task spec and send its heartbeat receipt first. Do not prepare or review a task as a worker; report an admission denial to Control. " +
    "The preparation procedure below is for Codex Control. " : "";
  return "Dely compliance is active. Follow the session's AGENTS.md and mandatory skills. " +
    nativeModelContext(event) +
    workerContext +
    "Before implementation, supply the actual session skill roster and task evidence to: " + nodeCommand(script) +
    " prepare --session \"" + event.session_id + "\" --turn \"" + event.turn_id +
    "\" --repo \"" + event.cwd + "\" --home " + (process.platform === "win32" ? psQuote(home) : '"' + home + '"') +
    " --task-file \"" + inputFile(home, event.session_id, event.turn_id, state.input_nonce).replace(/\\/g, "/") + "\". " +
    "Use apply_patch to add only that current-turn JSON input file before review; it grants no implementation authority. " +
    (!workerContext ? "For pre-assessment advisory, add the documented advisory envelope, then use advise instead of prepare with the same five arguments and absolute native Node executable. Read and settle that result before prepare; advice never grants implementation. " : "") +
    "Choose skills from the actual native session roster, retain mandatory/user-selected skills, then explicitly review with this script's review command. " +
    "Skill advice is optional through the existing Jev CLI; task-difficulty assessment remains required. " +
    "Before prepare/dispatch, require concrete verification evidence in existing context.acceptance and context.evidence fields: available method/command and fixture, procedure, expected_result, would_fail_if, and inspected source/caller/detector provenance. " +
    "Explicitly distinguish a planned detector before dispatch from executed acceptance after implementation. " +
    "For a valid insufficient_evidence response, inspect the gap, gather real new evidence and use a fresh task snapshot/assessment without overwriting raw Jev answers, old tasks or reviews. Unknowns remain NOT_EVALUATED. " +
    "Hard is direct; Easy/Medium-/Medium+ require an actual Dely Run ID on review --run and a matching Dely dispatch before edits. " +
    "Prefer reviewed Dely for reversible bounded internal changes. Hard flags describe consequential effects, not task topics; record concrete evidence for each exclusion. " +
    "Final Easy/Medium- use AGY gemini-3.8-flash-medium/default and retain one Luna/max exception for explicit quota, verified AGY model absence, or adapter-classified transport failure with reconciled bound evidence. Timeout alone never permits retry or fallback. Final Medium+ uses only Codex gpt-6.1-sol/medium; Hard uses only Codex Sol/xhigh. Neither has a fallback. " +
    "An eligible v4 candidate needs optional --review-evidence-json and a justified Control correction before it can become Medium-. " +
    "A recommendation never overrides mandatory or user-selected skills. Missing evaluations stay NOT_EVALUATED. " +
    "When changing the registered Dely authoring source, finish review and required verification, then run native Node scripts/sync-dely.js " +
    "and require COHERENT for every selected installation before claiming completion. Report NOT_SYNCED if blocked; open a fresh session after updating. " +
    (state.continuation_checkpoint ? "For an unchanged confirmed task, prepare may add --continue and its original --run for delegated work. This retains frozen evidence, not permission; current-turn input and explicit Control review remain required. " : "") +
    "See \"" + path.join(root(home), "guide.md").replace(/\\/g, "/") + "\". " +
    "Read-only inspection and Orca coordination remain available.";
}

// Conservative convenience classification, not a shell parser or security boundary.
function commandWords(command) {
  const words = command.match(/'(?:[^']|'')*'|"(?:[^"]|\x60")*"|[^\s]+/g) || [];
  return words.map((word) => /^['"]/.test(word) ? word.slice(1, -1) : word);
}

function compoundCommand(command) {
  const unquoted = command.replace(/'(?:[^']|'')*'|"(?:\x60.|[^"\x60])*"/g, "");
  return /[;|><\r\n]|\&\&|\$\(/.test(unquoted);
}

function denialReason(error, event, home, state) {
  const guide = 'See "' + path.join(root(home), "guide.md").replace(/\\/g, "/") + '".';
  if (state.worker_claim && (state.worker_claim.spec_sha256 || state.worker_claim.receipts.length)) {
    return error.message + " Dely worker: report the denial to Control. Do not prepare or review a task as a worker. " + guide;
  }
  const command = String(event.tool_input && (event.tool_input.command || event.tool_input.cmd) || "");
  const hint = event.tool_name === "Bash" && compoundCommand(command) ?
    "Compound shell commands require review. For read-only inspection, use one read command per tool call. " : "";
  return hint + error.message + " Before implementation, follow this turn's prepare/review instructions. " + guide;
}

function needsReview(event, script, home) {
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
  const chained = compoundCommand(command) ||
    words.some((word) => /^--(?:output|ext-diff)(?:=|$)/.test(word));
  if (executable === "node" && words[1] && !chained) {
    try {
      if (samePath(words[1], script) && ["prepare", "review", "status"].includes(words[2])) return false;
      if (home && samePath(words[0], process.execPath) && samePath(words[1], script) && words[2] === "advise") {
        const { values } = parseArgs({ args: words.slice(3), options: Object.fromEntries(
          ["session", "turn", "repo", "home", "task-file"].map((key) => [key, { type: "string" }])) });
        if (values.session !== event.session_id || values.turn !== event.turn_id || !samePath(values.home, home) ||
            !samePath(values.repo, event.cwd)) return true;
        const request = advisoryRequest(values, home);
        return request.binding.native_model !== event.model;
      }
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
  const repo = state.execution_repo || state.repo;
  const rows = logRecords(settings.journal).filter((row) => row.run === state.run);
  const route = rows.find((row) => row.event === "task_route" && row.repo &&
    samePath(row.repo, repo) && row.specSha256 === assessment.task.spec_sha256 &&
    row.contextSha256 === assessment.task.context_sha256 && row.difficulty === assessment.difficulty &&
    row.policy === assessment.policy && row.assessmentBasisSha256 === assessment.assessment_basis_sha256 &&
    row.correctionSha256 === (assessment.review.correction_sha256 || null) && row.reviewSource === assessment.review.source);
  return route && rows.find((row) => row.event === "dispatch" && row.repo &&
    samePath(row.repo, repo) && row.phase === "implement" &&
    row.promptSha256 === assessment.task.spec_sha256 && row.dispatchId && permittedDispatch(route, row, settings));
}

function continuationState(options, pending, task, repo, target, home, settings) {
  if (!options.continue) return null;
  const ref = pending.continuation_checkpoint;
  if (!ref || typeof ref.file !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256 || "")) {
    throw Error("No reviewed continuation checkpoint; prepare a fresh task.");
  }
  checkPrompt(pending, home);
  const relative = path.relative(canonical(path.join(root(home), "tasks")), canonical(ref.file));
  if (!/^[a-f0-9]{24}[\\/]continuation\.json$/.test(relative) || hashFile(ref.file) !== ref.sha256) {
    throw Error("Continuation checkpoint changed or escaped its native home.");
  }
  const prior = read(ref.file), owner = prior.continuation_owner;
  if (prior.schema !== NATIVE_SCHEMA || prior.status !== "REVIEWED" || prior.mode !== "implement" ||
      prior.session !== options.session || pending.session !== options.session || pending.turn !== options.turn ||
      !samePath(prior.repo, repo) || !samePath(prior.execution_repo || prior.repo, target) ||
      !owner || !samePath(owner.home, home) ||
      owner.thread !== (process.env.CODEX_THREAD_ID || null) ||
      owner.terminal !== (process.env.ORCA_TERMINAL_HANDLE || null) ||
      !pending.native_model || prior.native_model !== pending.native_model ||
      pending.worker_claim?.spec_sha256 || pending.worker_claim?.receipts?.length) {
    throw Error("Continuation owner, target or native model changed; prepare a fresh task.");
  }
  if (owner.adapter_sha256 !== hashFile(__filename) || owner.settings_sha256 !== hashFile(settingsFile(home))) {
    throw Error("Continuation software changed; prepare a fresh task.");
  }
  checkSnapshot(prior);
  checkExecutionRepo(prior, home);
  if (JSON.stringify(instructions(repo, home)) !== JSON.stringify(prior.instructions)) {
    throw Error("Continuation instructions changed; prepare a fresh task.");
  }
  const input = read(prior.task_input), routing = require(settings.routing);
  if (task.mode !== "implement" || task.spec !== prior.assessment.task.spec ||
      routing.canonicalJson(task.context) !== routing.canonicalJson(prior.assessment.task.context) ||
      routing.canonicalJson(task.skills) !== routing.canonicalJson(input.skills) ||
      routing.canonicalJson(task.required_skills || []) !== routing.canonicalJson(prior.required_skills) ||
      Object.hasOwn(task, "execution_repo") !== Object.hasOwn(input, "execution_repo") ||
      (task.execution_repo && task.execution_repo !== input.execution_repo)) {
    throw Error("Continuation task, roster or mandatory skills changed; prepare a fresh task.");
  }
  routing.validateApprovedAssessment(prior.assessment, read(prior.original_assessment));
  if ((options.run?.trim() || null) !== prior.run ||
      (prior.assessment.route.workflow === "dely" && !dispatchEvidence(prior, settings))) {
    throw Error("Continuation requires the original Run and matching dispatch evidence.");
  }
  return prior;
}

function continuationProof(state) {
  const marker = read(state.task_input).native_continuation;
  if (!marker) {
    if (state.continuation || state.continuation_source) throw Error("Continuation metadata changed.");
    return null;
  }
  if (!state.continuation || JSON.stringify(marker) !== JSON.stringify(state.continuation_source) ||
      hashFile(marker.file) !== marker.sha256) throw Error("Continuation metadata changed.");
  return read(marker.file);
}

function permittedDispatch(route, dispatch, settings) {
  try {
    const routing = require(settings.routing);
    if (route.policy !== routing.POLICY || !/^[a-f0-9]{64}$/.test(route.assessmentBasisSha256 || "") ||
        route.assessmentBasisSha256 !== dispatch.assessmentBasisSha256 ||
        route.contextSha256 !== dispatch.contextSha256 || route.correctionSha256 !== dispatch.correctionSha256) return false;
    const assessment = { difficulty: route.difficulty, route: routing.route(route.difficulty) };
    if (assessment.route.workflow !== "dely") return false;
    const pin = dispatch.launch && dispatch.launch.effective;
    if (!pin) return false;
    if (dispatch.fallbackReason === "model_unavailable") routing.verifyUnavailablePin(assessment, pin);
    else routing.verifyPin(assessment, pin, { fallback: dispatch.fallbackReason ?? undefined,
      "fallback-stage": dispatch.fallbackStage ?? undefined });
    if (dispatch.fallbackReason === "network") require(path.join(path.dirname(settings.routing), "network-fallback.js")).validate(dispatch.networkEvidence, {
      specSha256: dispatch.promptSha256, contextSha256: dispatch.contextSha256,
      assessmentBasisSha256: dispatch.assessmentBasisSha256 });
    return true;
  } catch (_) { return false; }
}

function verifiedWorker(event, settings, handle = process.env.ORCA_TERMINAL_HANDLE, claim = {}) {
  if (!handle) return false;
  const rows = logRecords(settings.journal);
  const dispatch = rows.findLast((row) => row.event === "dispatch" && row.repo && row.phase === "implement" &&
    row.terminalHandle === handle && samePath(row.repo, event.cwd) &&
    row.launch && row.launch.effective && row.launch.effective.agent === "codex" &&
    row.launch.effective.model === event.model && row.dispatchId);
  if (!dispatch || !/^[A-Za-z0-9_-]+$/.test(dispatch.run)) return false;
  const native = dispatch.launch.modelEvidence;
  if (!native || native.session !== event.session_id || native.turn !== event.turn_id ||
      native.model !== event.model || native.effort !== dispatch.launch.effective.effort) return false;
  const deliveredSha256 = dispatch.snapshotSha256 ?? dispatch.promptSha256;
  if (!(claim.receipts || []).includes(dispatch.receiptMarker) && claim.spec_sha256 !== deliveredSha256) return false;
  const route = rows.findLast((row) => row.event === "task_route" && row.run === dispatch.run &&
    row.repo && samePath(row.repo, event.cwd) && row.specSha256 === dispatch.promptSha256 &&
    row.assessmentBasisSha256 === dispatch.assessmentBasisSha256 &&
    row.contextSha256 === dispatch.contextSha256 && row.correctionSha256 === dispatch.correctionSha256);
  if (!route || !permittedDispatch(route, dispatch, settings)) return false;
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
  checkExecutionRepo(state, home);
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
  const checked = routing.validateApprovedAssessment(state.assessment, read(state.original_assessment));
  const continued = continuationProof(state);
  if (continued && (checked.assessment_basis_sha256 !== continued.assessment.assessment_basis_sha256 ||
      checked.difficulty !== continued.assessment.difficulty ||
      routing.canonicalJson(checked.route) !== routing.canonicalJson(continued.assessment.route) ||
      checked.review.source !== continued.assessment.review.source ||
      (checked.review.correction_sha256 || null) !== (continued.assessment.review.correction_sha256 || null) ||
      state.run !== continued.run || event.model !== state.native_model ||
      JSON.stringify([...state.skill_review.selected].sort()) !== JSON.stringify([...continued.skill_review.selected].sort()))) {
    throw Error("Continuation approval changed; prepare a fresh task.");
  }
  if (checked.route.workflow === "direct" && event.model !== checked.route.primary.model) {
    throw Error("The Hard route requires Codex " + checked.route.primary.model + "; current model evidence does not match.");
  }
  if (requireDispatch && checked.route.workflow === "dely" && !dispatchEvidence(state, settings)) {
    throw Error("This task requires Dely. No matching implementation dispatch exists for its exact spec/context.");
  }
  return state;
}

function requireSourceSync(state, home) {
  const settings = checkedSettings(home), repo = state.execution_repo || state.repo;
  if (!settings.sync_source || !fs.existsSync(settings.sync_source) || !samePath(repo, settings.sync_source)) return;
  try {
    const updater = path.resolve(path.dirname(settings.routing), "../../../scripts/sync-dely.js");
    if (!settings.updater || !settings.dependencies[settings.updater] || !samePath(settings.updater, updater)) {
      throw Error("installed updater is not pinned alongside the routing module");
    }
    if (!Array.isArray(settings.sync_homes) || !settings.sync_homes.length ||
        !settings.sync_homes.some((item) => typeof item === "string" && fs.existsSync(item) && samePath(item, home))) {
      throw Error("selected installation homes are missing or invalid");
    }
    const result = require(settings.updater).plan({ source: settings.sync_source, homes: settings.sync_homes });
    if (result.status !== "COHERENT") throw Error(result.status);
  } catch (error) {
    throw Error("Dely sync required: " + error.message + ". Finish review and verification, run native Node scripts/sync-dely.js " +
      "from the registered source, and require COHERENT for every selected home before claiming completion. " +
      "If synchronization fails, report NOT_SYNCED and the blocker; use a fresh session after updating.");
  }
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
    let previous = {};
    try { if (fs.existsSync(file)) previous = read(file); } catch (_) { /* A fresh prompt never inherits unreadable evidence. */ }
    const prompt = typeof event.prompt === "string" ? event.prompt : "";
    const staged = prompt.match(/Task spec staged at \S+ \(\d+ bytes, SHA-256: ([a-f0-9]{64})\)/);
    const state = { session: event.session_id, turn: event.turn_id, repo: canonical(event.cwd), status: "PENDING",
      native_model: event.model,
      mutation_admitted: false,
      input_nonce: crypto.randomBytes(12).toString("hex"),
      worker_claim: { receipts: prompt.match(/rcpt_[a-f0-9]{16}/g) || [], spec_sha256: staged && staged[1] } };
    if (previous?.session === state.session && previous.continuation_checkpoint) {
      state.continuation_checkpoint = previous.continuation_checkpoint;
    }
    write(promptFile(home, event.session_id), { session: state.session, turn: state.turn,
      repo: state.repo, input_nonce: state.input_nonce });
    write(file, state);
    return { hookSpecificOutput: { hookEventName: type, additionalContext: context(event, home, state) } };
  }
  if (type !== "PreToolUse" && type !== "Stop") return {};
  if (type === "PreToolUse" && !needsReview(event, script, home)) return {};
  const state = fs.existsSync(file) ? read(file) : {};
  // Legacy attempted evidence is ambiguous; retain its Stop check until the next prompt.
  const admitted = state.mutation_admitted ?? !!state.attempted;
  if (type === "PreToolUse" && taskInputWrite(event, state, home)) return {};
  if (type === "PreToolUse" && runSpecWrite(event, state, home)) return {};
  try {
    checkPrompt(state, home);
    if (workerCheck(event, checkedSettings(home), process.env.ORCA_TERMINAL_HANDLE, state.worker_claim)) {
      return type === "Stop" ? {} : { hookSpecificOutput: { hookEventName: type,
        additionalContext: "Dely inherited admission checks passed for this tool call. " + nativeModelContext(event) } };
    }
  } catch (_) { /* unknown worker identity never exempts a tool call */ }
  if (type === "Stop" && (!admitted || state.stop_reported)) return {};
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
      const settings = checkedSettings(home);
      coordinating = !compoundCommand(command) &&
        path.basename(words[0] || "").replace(/\.exe$/i, "") === "node" && words[1] && !words[1].startsWith("-") &&
        fs.existsSync(words[1]) &&
        samePath(words[1], settings.dely) &&
        [undefined, "pins", "preflight", "dispatch", "wait", "wait-bg", "cleanup", "notify"].includes(words[2]);
    }
    validate(state, event, home, !coordinating);
    if (type === "Stop") requireSourceSync(state, home);
    if (type === "PreToolUse" && !coordinating && (state.mutation_admitted !== true || state.stop_reported)) {
      write(file, { ...state, mutation_admitted: true, stop_reported: false });
    }
    return {};
  } catch (error) {
    const reason = denialReason(error, event, home, state);
    if (type === "Stop") {
      write(file, { ...state, stop_reported: true });
      return { decision: "block", reason: reason + " If blocked, report the limitation instead of claiming completion." };
    }
    write(file, { ...state, mutation_admitted: admitted });
    return { hookSpecificOutput: { hookEventName: type, permissionDecision: "deny", permissionDecisionReason: reason } };
  }
}

function advisoryPath(file, home) {
  const base = path.resolve(root(home)), target = path.resolve(file), relative = path.relative(base, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw Error("Advisory path escaped its home.");
  for (let entry = target; ; entry = path.dirname(entry)) {
    if (fs.lstatSync(entry, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error("Advisory paths cannot contain a link.");
    if (entry === base) break;
  }
  return target;
}

function advisoryRequest(options, home) {
  if (Object.keys(options).some((key) => !["home", "session", "turn", "repo", "task-file"].includes(key)) ||
      !options.session || !options.turn || !options.repo || !options["task-file"] ||
      (process.env.CODEX_THREAD_ID && process.env.CODEX_THREAD_ID !== options.session)) throw Error("Advisory requires the current native owner.");
  const state = read(advisoryPath(stateFile(home, options.session), home));
  if (state.session !== options.session || state.turn !== options.turn || !samePath(state.repo, options.repo) ||
      !["PENDING", "PREPARED", "REVIEWED"].includes(state.status) || !state.native_model ||
      !/^[a-f0-9]{24}$/.test(state.input_nonce || "") ||
      state.worker_claim?.spec_sha256 || state.worker_claim?.receipts?.length) throw Error("Advisory requires the current interactive prompt.");
  advisoryPath(promptFile(home, state.session), home);
  if (!fs.existsSync(promptFile(home, state.session))) throw Error("Advisory requires prompt evidence.");
  checkPrompt(state, home);
  const expected = advisoryPath(inputFile(home, state.session, state.turn, state.input_nonce), home);
  const normalize = (file) => process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
  if (normalize(options["task-file"]) !== normalize(expected)) throw Error("Advisory requires this prompt's exact task input.");
  const stat = fs.statSync(expected);
  if (!stat.isFile() || stat.size > 256 * 1024) throw Error("Advisory requires a bounded regular task file.");
  const bytes = fs.readFileSync(expected), task = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!validTaskInput(task) || Object.hasOwn(task, "native_continuation")) throw Error("Invalid advisory task input.");
  const envelope = task.advisory;
  if (!envelope || Object.keys(envelope).some((key) => !["mode", "input"].includes(key)) ||
      !["plan", "skill", "context"].includes(envelope.mode) || envelope.input?.request !== task.request ||
      (envelope.mode === "skill" && JSON.stringify(envelope.input.skills) !== JSON.stringify(task.skills))) throw Error("Invalid task-bound advisory envelope.");
  advisoryPath(settingsFile(home), home);
  const settings = checkedSettings(home);
  advisoryPath(settings.advisor, home);
  const advisor = require(settings.advisor);
  advisor.validateInput(envelope.input, envelope.mode);
  const binding = { schema: "native-advisory-v1", session: state.session, turn: state.turn, repo: canonical(state.repo),
    native_model: state.native_model, input_nonce: state.input_nonce, task_sha256: digest(bytes),
    mode: envelope.mode, input_sha256: digest(JSON.stringify(envelope.input)), advisor_sha256: hashFile(settings.advisor),
    adapter_sha256: hashFile(__filename), settings_sha256: hashFile(settingsFile(home)),
    instructions_sha256: digest(JSON.stringify(instructions(state.repo, home))) };
  const directory = advisoryPath(path.join(root(home), "tasks", "advisory-" + digest(state.session + "\0" + state.turn + "\0" + state.input_nonce).slice(0, 24)), home);
  return { binding, input: envelope.input, advisor, directory };
}

async function advisory(options, home) {
  const request = advisoryRequest(options, home);
  const { binding, input, advisor, directory } = request;
  fs.mkdirSync(directory, { recursive: true });
  const requestFile = advisoryPath(path.join(directory, "request.json"), home);
  const output = advisoryPath(path.join(directory, "result.json"), home);
  const frozen = { binding, input };
  const summary = (proof, reused) => ({ status: proof.result.status, reason: proof.result.reason,
    mode: binding.mode, output_file: output, reused });
  if (fs.existsSync(requestFile)) {
    if (JSON.stringify(read(requestFile)) !== JSON.stringify(frozen)) throw Error("Advisory request binding changed.");
    if (!fs.existsSync(output)) throw Error("Advisory attempt incomplete or in progress; do not retry automatically.");
    const proof = read(output);
    if (JSON.stringify(proof.binding) !== JSON.stringify(binding) || proof.result_sha256 !== digest(JSON.stringify(proof.result)) ||
        proof.result?.input_sha256 !== binding.input_sha256 || proof.result?.mode !== binding.mode ||
        !["REVIEW_REQUIRED", "NOT_EVALUATED", "NOT_APPLICABLE"].includes(proof.result?.status)) throw Error("Advisory result binding changed.");
    return summary(proof, true);
  }
  // Exclusive reservation survives a lost response. It is never silently cleared or retried.
  fs.writeFileSync(requestFile, JSON.stringify(frozen, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  let result;
  const unavailable = (reason) => ({ mode: binding.mode, status: "NOT_EVALUATED", input_sha256: binding.input_sha256, reason });
  try {
    result = await advisor.advise(input, binding.mode, { repo: binding.repo });
    if (!["REVIEW_REQUIRED", "NOT_EVALUATED", "NOT_APPLICABLE"].includes(result?.status) ||
        result.input_sha256 !== binding.input_sha256 || result.mode !== binding.mode) result = unavailable("ADVISOR_RESULT_INVALID");
  } catch (_) { result = unavailable("ADVISOR_UNAVAILABLE"); }
  if (JSON.stringify(advisoryRequest(options, home).binding) !== JSON.stringify(binding)) throw Error("Advisory binding changed during request.");
  advisoryPath(requestFile, home); advisoryPath(output, home);
  if (JSON.stringify(read(requestFile)) !== JSON.stringify(frozen)) throw Error("Advisory reservation changed during request.");
  const proof = { binding, result, result_sha256: digest(JSON.stringify(result)) };
  fs.writeFileSync(output, JSON.stringify(proof, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return summary(proof, false);
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
  if (Object.hasOwn(task, "native_continuation")) throw Error("Task input cannot supply native continuation metadata.");
  if (!["implement", "advice"].includes(task.mode) || !task.request || !Array.isArray(task.skills)) {
    throw Error("Task JSON needs mode, request and the current session skills array.");
  }
  if (task.mode === "implement" && typeof task.spec === "string") {
    task.spec = task.spec.replace(/\r\n/g, "\n");
    if (!task.spec.endsWith("\n")) task.spec += "\n";
  }
  const repo = canonical(options.repo);
  const target = executionRepo(task, repo);
  if (task.skills.some((skill) => !path.isAbsolute(skill.path))) throw Error("Skill paths must come from the session's absolute catalog paths.");
  const continued = continuationState(options, pending, task, repo, target, home, settings);
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
  write(taskInput, continued ? { ...task, native_continuation: pending.continuation_checkpoint } : task);
  write(sessionRoster, { request: task.request, skills: task.skills });
  write(sourceRoster, { request: task.request, skills: sources });
  write(skillInput, { request: task.request, skills: task.skills });
  const state = {
    schema: NATIVE_SCHEMA,
    session: options.session, turn: options.turn, repo, mode: task.mode, status: "PREPARED",
    prepared_at: new Date().toISOString(), worker_claim: pending.worker_claim,
    native_model: pending.native_model,
    mutation_admitted: pending.session === options.session && pending.turn === options.turn &&
      (pending.mutation_admitted ?? !!pending.attempted),
    stop_reported: pending.session === options.session && pending.turn === options.turn && !!pending.stop_reported,
    task_input: taskInput, skill_input: skillInput, session_roster: sessionRoster,
    source_roster: sourceRoster, catalog_paths: snapshot.catalog_paths,
    skill_selection: { source: "native-session", advice_status: "NOT_REQUESTED" },
    required_skills: required, instructions: instructions(repo, home),
  };
  if (Object.hasOwn(task, "execution_repo")) {
    state.execution_repo = target;
    state.execution_repo_path = task.execution_repo;
    state.execution_instructions = instructions(target, home);
  }
  state.input_nonce = pending.turn === options.turn && /^[a-f0-9]{24}$/.test(pending.input_nonce || "") ?
    pending.input_nonce : crypto.randomBytes(12).toString("hex");
  if (task.mode === "implement") {
    if (typeof task.spec !== "string" || !task.context) throw Error("Implementation needs a spec and complete routing context.");
    if (continued) {
      state.assessment = read(continued.original_assessment);
      state.original_assessment = continued.original_assessment;
      state.continuation = true;
      state.continuation_source = pending.continuation_checkpoint;
      state.continuation_checkpoint = pending.continuation_checkpoint;
      state.catalog_paths = { ...continued.catalog_paths, ...state.catalog_paths };
    } else {
      const specFile = path.join(directory, "spec.md");
      const contextFile = path.join(directory, "context.json");
      fs.writeFileSync(specFile, task.spec, { flag: "wx", mode: 0o600 });
      write(contextFile, task.context);
      const routing = require(settings.routing);
      const loadedTask = routing.loadTask(target, specFile, contextFile);
      if (routing.missingEvidence(loadedTask).length) throw Error("Complete and confirm the task context before implementation.");
      state.assessment = await routing.assess(loadedTask, { credentialRoot: settings.credential_root });
      state.original_assessment = path.join(directory, "assessment.json");
      write(state.original_assessment, state.assessment);
    }
  }
  checkSnapshot(snapshot);
  checkExecutionRepo(state, home);
  if (JSON.stringify(instructions(repo, home)) !== JSON.stringify(state.instructions)) throw Error("Instructions changed during preparation.");
  state.fingerprints = { ...(continued?.fingerprints || {}),
    ...(continued ? fingerprints([pending.continuation_checkpoint.file]) : {}),
    ...fingerprints([taskInput, skillInput, sessionRoster, sourceRoster,
    ...(state.assessment ? [state.assessment.task.spec_file, state.assessment.task.context_file, state.original_assessment] : [])]), ...snapshot.fingerprints };
  const latest = fs.existsSync(sessionFile) ? read(sessionFile) : {};
  if (latest.turn !== pending.turn || latest.input_nonce !== pending.input_nonce) {
    throw Error("User prompt changed during preparation; prepare and review the current request.");
  }
  checkPrompt(state, home);
  write(stateFile(home, options.session), state);
  if (state.assessment) require(path.join(path.dirname(settings.routing), "usage.js")).recordTask(state.assessment, continued ? "continue" : "assess", settings.journal);
  return { status: state.status, continuation: !!continued, skill_selection: state.skill_selection, assessment: state.assessment, task_directory: directory };
}

function review(options, home) {
  if (!options.reason || !options["skill-reason"]) throw Error("Control must explain both routing and skill decisions.");
  const settings = checkedSettings(home);
  const file = stateFile(home, options.session);
  const state = read(file);
  if (state.mode !== "implement" && options["review-evidence-json"] !== undefined) throw Error("Correction evidence requires an implementation assessment.");
  if (options.repo && !samePath(options.repo, state.repo)) throw Error("Review belongs to another Control repository.");
  if (state.schema !== NATIVE_SCHEMA) throw Error("Legacy task evidence requires fresh prepare and review.");
  if (state.turn !== options.turn || state.status !== "PREPARED") throw Error("Prepare this turn before reviewing.");
  if (verifiedWorker({ session_id: state.session, turn_id: state.turn, cwd: state.execution_repo || state.repo,
    model: state.native_model }, settings, process.env.ORCA_TERMINAL_HANDLE, state.worker_claim)) {
    throw Error("Dely workers cannot create Codex Control reviews; report to Control.");
  }
  checkExecutionRepo(state, home);
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
  const continued = continuationProof(state);
  if (continued && (options.difficulty !== continued.assessment.difficulty ||
      (options.run?.trim() || null) !== continued.run ||
      JSON.stringify([...selected].sort()) !== JSON.stringify([...continued.skill_review.selected].sort()))) {
    throw Error("Continuation review must retain the original route, Run and selected skills.");
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
  checkExecutionRepo(state, home);
  if (JSON.stringify(instructions(state.repo, home)) !== JSON.stringify(state.instructions)) throw Error("Instructions changed during review.");
  if (state.mode === "implement") {
    const routing = require(settings.routing);
    routing.validateOriginalAssessment(state.assessment, read(state.original_assessment));
    state.assessment = routing.review(state.assessment, options.difficulty, options.reason,
      routing.parseReviewEvidence(options["review-evidence-json"]));
    if (continued && (routing.canonicalJson(state.assessment.route) !== routing.canonicalJson(continued.assessment.route) ||
        state.assessment.review.source !== continued.assessment.review.source ||
        (state.assessment.review.correction_sha256 || null) !== (continued.assessment.review.correction_sha256 || null))) {
      throw Error("Continuation review changed the original route or correction; prepare a fresh task.");
    }
    if (state.assessment.route.workflow === "dely" && !loaded.some((skill) => samePath(skill.path, settings.delivery))) {
      throw Error("Delegated tasks must load the installed delivery skill.");
    }
    state.run = options.run ? options.run.trim() : null;
    if (state.assessment.route.workflow === "dely" && !state.run) {
      throw Error("Create an actual Dely Run, then review with --run <Run ID> before dispatching the reviewed task.");
    }
    const reviewedFile = path.join(path.dirname(state.skill_input), "reviewed.json");
    write(reviewedFile, state.assessment);
    Object.assign(state.fingerprints, fingerprints([reviewedFile]));
  }
  state.status = "REVIEWED";
  state.skill_review = { by: "codex-control", reason: options["skill-reason"], source: "native-session",
    evaluation_status: "NOT_REQUESTED", selected };
  state.catalog_paths = { ...state.catalog_paths, ...snapshot.catalog_paths };
  state.fingerprints = { ...state.fingerprints, ...snapshot.fingerprints };
  const latest = read(file);
  if (latest.turn !== state.turn || latest.input_nonce !== state.input_nonce) throw Error("User prompt changed during review.");
  checkPrompt(state, home);
  if (state.mode === "implement") {
    const checkpointFile = path.join(path.dirname(state.skill_input), "continuation.json");
    const checkpoint = { ...state, continuation_owner: { home: canonical(home),
      thread: process.env.CODEX_THREAD_ID || null, terminal: process.env.ORCA_TERMINAL_HANDLE || null,
      adapter_sha256: hashFile(__filename), settings_sha256: hashFile(settingsFile(home)) } };
    fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    state.continuation_checkpoint = { file: checkpointFile, sha256: hashFile(checkpointFile) };
  }
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
  const updaterFile = path.join(path.dirname(advisor), "sync-dely.js");
  const updater = fs.existsSync(updaterFile) ? canonical(updaterFile) : undefined;
  const syncSource = options.source ? canonical(options.source) : previous?.sync_source;
  const syncHomes = options.homes ? options.homes.map(canonical) : previous?.sync_homes;
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
    updater, sync_source: syncSource, sync_homes: syncHomes,
    dependencies: fingerprints([routing, path.join(path.dirname(routing), "usage.js"), frozenAdvisor, dely, ...[updater].filter(Boolean),
      ...[path.join(path.dirname(routing), "network-fallback.js")].filter((file) => fs.existsSync(file))]), journal: path.join(os.homedir(), ".dely", "log.jsonl") });
  if (!preserveHooks) write(manifestFile, manifest);
  return { home, script, script_sha256: hashFile(script), configured_events: 4,
    trust: preserveHooks ? "UNCHANGED_REQUIRES_EXISTING_NATIVE_TRUST" : "REQUIRES_NATIVE_HOOK_REVIEW" };
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const { values } = parseArgs({ args: argv.slice(1), options: { ...Object.fromEntries(
    ["home", "session", "turn", "repo", "task-json", "task-file", "difficulty", "reason", "skill-reason", "skills", "run", "routing", "advisor", "review-evidence-json"]
      .map((name) => [name, { type: "string" }])), "preserve-hooks": { type: "boolean" }, continue: { type: "boolean" } } });
  if (command !== "review" && values["review-evidence-json"] !== undefined) throw Error("Correction evidence is supported only by review.");
  if (command !== "prepare" && values.continue) throw Error("Continuation is supported only by prepare.");
  const home = path.resolve(values.home || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  let result;
  if (command === "hook") result = hook(JSON.parse(fs.readFileSync(0, "utf8")), home);
  else if (command === "install") result = install(values, home);
  else if (command === "prepare" || command === "review" || command === "advise") {
    if (!values.session || !values.turn) throw Error("Session and turn are required.");
    result = command === "advise" ? await advisory(values, home) : command === "prepare" ? await prepare(values, home) : review(values, home);
  } else if (command === "status") result = checkedSettings(home);
  else throw Error("Use install, advise, prepare, review, status or hook; see docs/codex-compliance.md.");
  if (command === "prepare") {
    result = { status: result.status, task_directory: result.task_directory, continuation: result.continuation, skill_selection: result.skill_selection,
      ...(result.assessment ? { assessment: result.assessment } : {}) };
  }
  process.stdout.write(JSON.stringify(result) + "\n");
}

module.exports = { digest, fingerprints, stateFile, settingsFile, inputFile, taskInputWrite, instructions, needsReview, logRecords,
  dispatchEvidence, verifiedWorker, validate, hook, advisory, prepare, review, install };
if (require.main === module) main().catch(() => {
  console.error("Compliance check failed. Inspect the task inputs and installed hook guide; no source write was authorized.");
  process.exitCode = 2;
});
