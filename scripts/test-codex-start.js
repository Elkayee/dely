"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const helper = path.resolve(process.argv[2] || "skills/delivery/scripts/dely.js");
const source = fs.readFileSync(helper, "utf8").split("const [cmd, ...rest] = process.argv.slice(2);")[0];
const localRequire = createRequire(helper);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dely-start-check-"));
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
let passed = 0;
let failed = 0;

function fixture() {
  const repo = fs.mkdtempSync(path.join(root, "case-"));
  fs.writeFileSync(path.join(repo, "spec.md"), "fixture task\n");
  const codex = path.join(repo, "npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe");
  fs.mkdirSync(path.dirname(codex), { recursive: true });
  fs.writeFileSync(codex, "fixture");
  const state = { clock: 0, delay: 45000, enteredAt: null, starts: 0, enters: 0, events: [], dead: false, release: "released", wrongModel: false, wrongIdentity: false, receipt: true, calls: [] };
  const pin = { agent: "codex", model: "gpt-6-luna", effort: "max", harness: { id: "codex" } };
  const journal = path.join(repo, ".dely/log.jsonl");
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  fs.mkdirSync(path.join(repo, ".codex/dely-compliance"), { recursive: true });
  const adapterDir = path.join(repo, ".codex/dely-compliance"), configFile = path.join(adapterDir, "settings.json");
  fs.copyFileSync(path.resolve(__dirname, "codex-compliance.js"), path.join(adapterDir, "codex-compliance.js"));
  const adapterConfig = { routing: path.join(path.dirname(helper), "task-routing.js"), advisor: path.resolve(__dirname, "jev_agent.js"),
    delivery: path.resolve(path.dirname(helper), "../SKILL.md"), dely: helper, updater: path.resolve(__dirname, "sync-dely.js"), journal };
  adapterConfig.dependencies = Object.fromEntries([adapterConfig.routing, adapterConfig.advisor, helper, adapterConfig.updater,
    path.join(path.dirname(helper), "usage.js"), path.join(path.dirname(helper), "network-fallback.js")].map(file => [file, hash(fs.readFileSync(file))]));
  fs.writeFileSync(configFile, JSON.stringify(adapterConfig));
  state.adapterConfig = adapterConfig; state.configFile = configFile; state.adapterDir = adapterDir;
  state.setAdmission = (enabled) => {
    const parked = adapterDir + "-disabled";
    for (const target of [adapterDir, parked]) assert.ok(path.resolve(target).startsWith(path.resolve(repo) + path.sep));
    fs.renameSync(enabled ? parked : adapterDir, enabled ? adapterDir : parked);
  };
  const agy = path.join(repo, "AppData/Local/agy/bin/agy.exe");
  fs.mkdirSync(path.dirname(agy), { recursive: true }); fs.writeFileSync(agy, "fixture");
  const routing = {
    requireApprovedRoute: () => ({ difficulty: "easy", policy: localRequire("./task-routing.js").POLICY, assessment_basis_sha256: hash("basis"), task: { spec_sha256: hash(fs.readFileSync(path.join(repo, "spec.md"))), context_sha256: "context" }, jev: null, review: { source: "fixture" } }),
    selectedPhase: () => "implement_backup_2", verifyPin: () => {},
  };
  function orca(args) {
    state.calls.push(args);
    const kind = args.slice(0, 2).join(" ");
    const value = (key) => args[args.indexOf(key) + 1];
    if (kind === "terminal create") { state.handle = state.starts ? "term_probe_" + state.starts : "term_fixture"; return { ok: true, result: { terminal: { handle: state.handle } } }; }
    if (kind === "terminal wait") return { ok: true, result: { wait: { satisfied: true } } };
    if (kind === "terminal read") return { ok: true, result: { terminal: { status: state.dead ? "exited" : "connected", latestCursor: 1, tail: state.agy ? [">"] : state.enteredAt === null ? ["[Pasted Content]"] : [] } } };
    if (kind === "terminal send") { state.enters++; state.enteredAt = state.clock; return { ok: true, result: { accepted: true } }; }
    if (kind === "orchestration worker-start") {
      state.starts++;
      state.startedAt = state.clock;
      state.spec = value("--spec");
      state.id = "ctx_fixture_" + state.starts;
      return { ok: true, result: { dispatchId: state.missingId ? undefined : state.id, taskId: "task_fixture", state: state.agy ? "ready" : "outcome_unknown" } };
    }
    if (kind === "orchestration worker-show") {
      const id = state.wrongIdentity ? "ctx_other" : state.id;
      const working = state.enteredAt !== null && state.clock - state.enteredAt >= state.delay;
      if (working && state.scriptWorker && !state.workerStarted) {
        state.workerStarted = true;
        state.preJournalAdmission = state.nativeAdmission();
        if (!state.spec.includes("dely-admission ")) state.workerCalls.push(state.nativeAdmission());
      }
      if ((working || state.nativeForDead) && !state.nativeMissing) {
        const directory = path.join(repo, ".codex/sessions/1970/01/01");
        fs.mkdirSync(directory, { recursive: true });
        const model = state.wrongModel || state.nativeWrongModel ? "gpt-5.6-terra" : pin.model;
        const effort = state.nativeWrongEffort ? "low" : pin.effort;
        const stamp = new Date(state.clock + (state.nativeFuture ? 120000 : 0)).toISOString();
        const turn = state.nativeTurn || "turn_fixture", spec = state.nativeWrongPrompt ? "unrelated task" : state.id + " " + state.spec;
        const rows = [
          { type: "session_meta", payload: { id: state.nativeSession || "session_fixture", cwd: repo, timestamp: new Date(state.nativeStale ? -1 : state.startedAt).toISOString() } },
          { type: "response_item", payload: { role: "user", content: [{ text: spec }], internal_chat_message_metadata_passthrough: { turn_id: turn } } },
          { type: "turn_context", timestamp: stamp, payload: { cwd: repo, turn_id: state.nativeWrongTurn ? "turn_other" : turn, model, effort, collaboration_mode: { settings: { model, reasoning_effort: effort } } } },
        ];
        if (state.nativeWrongRepo) rows[2].payload.cwd = root;
        if (state.nativeConflict) rows.push({ ...rows[2], timestamp: new Date(state.clock - 1).toISOString() });
        const file = path.join(directory, "rollout-fixture.jsonl");
        fs.writeFileSync(file, rows.map(JSON.stringify).join("\n") + "\n");
        if (state.nativeDuplicate) {
          const copy = JSON.parse(JSON.stringify(rows));
          if (state.nativeDuplicate === "conflicting") copy[2].timestamp = new Date(state.clock - 1).toISOString();
          if (state.nativeDuplicate === "stale") copy[1].payload.content = [{ text: "A later unrelated user turn" }];
          fs.writeFileSync(path.join(directory, "rollout-copy.jsonl"), copy.map(JSON.stringify).join("\n") + "\n");
        }
      }
      return { ok: true, result: {
        turnStart: working && state.turnStart ? "observed" : undefined,
        dispatch: { id, runId: state.wrongRun ? "other_run" : "fixture", assigneeHandle: state.wrongHandle ? "term_other" : state.handle, status: state.dead && !state.unsettled ? (state.succeeded ? "completed" : "failed") : state.startUnobserved ? "pending" : "dispatched", completedAt: state.dead && !state.unsettled ? "2026-10-15T00:00:00Z" : null },
        worker: { dispatchId: id, agentTerminalHandle: state.handle, state: state.dead ? (state.succeeded ? "succeeded" : "failed") : state.startUnobserved ? "start_unknown" : "ready" },
        observation: { status: state.dead ? "exited" : "live", exactWorker: !state.wrongIdentity },
        projection: { dispatchId: id, provider: { id: "codex", model: state.wrongModel || state.clock < (state.projectionDelay || 0) ? "gpt-6.1-sol" : pin.model },
          stage: { worker: state.dead ? (state.succeeded ? "succeeded" : "failed") : state.startUnobserved ? "start_unknown" : "ready", dispatch: state.dead ? (state.succeeded ? "completed" : "failed") : state.startUnobserved ? "pending" : "dispatched", detail: state.startUnobserved ? "turn_start_unobserved" : "input_accepted", activity: working ? "working" : "idle" },
          outcome: state.succeeded ? "succeeded" : "in_progress",
          liveness: { verdict: state.dead ? "exited" : "live", source: "agent_status" }, evidence: { durable: true, liveStatus: "fresh" } },
      } };
    }
    if (kind === "orchestration worker-release") return { ok: true, result: { state: state.release } };
    if (kind === "orchestration check") {
      if (args.includes("--wait")) state.clock += Number(value("--timeout-ms")) || 20;
      const marker = (state.spec || "").match(/subject `([^`]+)`/)?.[1];
      const receipt = { type: "heartbeat", subject: marker, from_handle: state.handle, payload: { dispatchId: state.id, taskId: "task_fixture" } };
      if (state.foreignReceipt) receipt[state.foreignReceipt] = "foreign";
      if (state.dispatchReceipt) receipt.from_handle = "dispatch:" + state.id;
      if (state.wrongReceiptPayload) receipt.payload[state.wrongReceiptPayload] = "foreign";
      if (state.missingReceiptPayload) delete receipt.payload[state.missingReceiptPayload];
      if (state.rejectedReceipt) receipt.payload._orcaLifecycleRejection = "fixture rejection";
      const messages = state.receipt && !(state.receiptConsumed && args.includes("--peek")) ? [receipt] : [];
      if (state.spec.includes("dely-admission ") && state.question !== false) {
        // Orca ask uses a dispatch sender and JSON-string payload; heartbeat stays terminal-bound.
        const payload = { taskId: "task_fixture", dispatchId: state.id, question: "dely-admission " + marker, options: [] };
        const question = { type: "question", id: "question_fixture", subject: "Question",
          body: state.wrongQuestion ? "foreign" : payload.question, from_handle: state.foreignQuestion ? "foreign" : "dispatch:" + state.id };
        const variant = state.questionVariant;
        if (variant === "wrong-sender") question.from_handle = "dispatch:ctx_other";
        if (variant === "terminal-sender") question.from_handle = state.handle;
        if (variant === "forged-sender") { delete question.from_handle; payload.from_handle = "dispatch:" + state.id; }
        if (variant === "wrong-dispatch") payload.dispatchId = "ctx_other";
        if (variant === "wrong-task") payload.taskId = "task_other";
        if (variant === "wrong-body") question.body = "foreign";
        if (variant === "wrong-payload-question") payload.question = "foreign";
        if (variant === "missing-body") delete question.body;
        if (variant === "missing-payload-question") delete payload.question;
        if (variant === "rejected") payload._orcaLifecycleRejection = "fixture rejection";
        if (variant === "missing-id") delete question.id;
        question.payload = variant === "malformed" ? "{" : JSON.stringify(payload);
        if (state.decoyQuestion) messages.push({ ...question, id: "foreign_question", from_handle: "dispatch:ctx_other" });
        messages.push(question);
      }
      if (state.preflight) messages.push({ type: "worker_done", payload: { dispatchId: state.id, outcome: "succeeded" } });
      return { ok: true, result: { messages, deliveryId: state.preflight ? "delivery_fixture" : null } };
    }
    if (kind === "orchestration reply") {
      const expected = "dely-admitted " + (state.spec || "").match(/subject `([^`]+)`/)?.[1];
      const rows = fs.existsSync(journal) ? fs.readFileSync(journal, "utf8").trim().split("\n").map(JSON.parse) : [];
      state.replyAfterJournal = rows.some(row => row.event === "dispatch" && row.dispatchId === state.id);
      state.replyAfterReceipt = state.adapterConfig.receipts && require(state.adapterConfig.receipts).records(repo, "fixture").rows
        .some(row => row.event === "dispatch" && row.dispatchId === state.id);
      state.replyId = value("--id");
      state.workerAcknowledged = !state.wrongAcknowledgement && value("--body") === expected &&
        state.replyId === "question_fixture" && (state.adapterConfig.receipts ? state.replyAfterReceipt : state.replyAfterJournal);
      if (state.workerAcknowledged && state.scriptWorker) state.workerCalls.push(state.nativeAdmission());
      return { ok: true, result: {} };
    }
    if (kind === "orchestration worker-list") return { ok: true, result: { workers: [] } };
    return { ok: true, result: {} };
  }
  const context = vm.createContext({
    require: (name) => name === "./task-routing.js" ? routing : name === "os" ? { ...os, tmpdir: () => repo, homedir: () => repo } : name === "fs" ? { ...fs,
      statSync: (file, ...args) => { if (state.unreadableAdapter && file === adapterDir) throw Object.assign(Error("fixture access denied"), { code: "EACCES" }); return fs.statSync(file, ...args); },
      readFileSync: (file, ...args) => { if (state.unreadableConfig && file === configFile) throw Object.assign(Error("fixture access denied"), { code: "EACCES" }); return fs.readFileSync(file, ...args); },
    } : localRequire(name),
    process: { platform: "win32", env: { APPDATA: repo, CODEX_HOME: path.join(repo, ".codex"), ORCA_TERMINAL_HANDLE: "term_control", DELY_ACK_S: "1", DELY_POLL_S: ".02" }, argv: [], exit: (code) => { throw { exit: code }; } },
    console: { log: (line) => state.output.push(String(line)) }, Buffer, TextDecoder, SharedArrayBuffer,
    Atomics: { wait: (_a, _i, _v, ms) => { state.clock += ms; } },
    Date: class extends Date { static now() { return state.clock; } },
    __dirname: path.dirname(helper), __filename: helper,
    fixtureOrca: orca, fixturePin: pin, fixtureEvents: state.events,
    fixtureLog: (event, data) => { state.events.push({ event, ...data }); if (state.journalFailure) return false; fs.appendFileSync(journal, JSON.stringify({ event, ...data }) + "\n", { flush: event === "dispatch" }); return true; },
  });
  vm.runInContext(source + "\norca=fixtureOrca; pin=()=>fixturePin; requireHandle=()=>{}; logEvent=fixtureLog; globalThis.invoke=dispatch;", context);
  const guardFile = path.resolve(__dirname, "codex-compliance.js"), guardRequire = createRequire(guardFile);
  const guardContext = vm.createContext({ require: (name) => name === "os" ? { ...os, tmpdir: () => repo } : guardRequire(name),
    module: { exports: {} }, __dirname: path.dirname(guardFile), __filename: guardFile, process, Buffer, console });
  vm.runInContext(fs.readFileSync(guardFile, "utf8"), guardContext);
  state.nativeAdmission = () => guardContext.module.exports.verifiedWorker({ cwd: repo, session_id: "session_fixture", turn_id: "turn_fixture", model: pin.model },
    state.adapterConfig, "term_fixture", { receipts: [(state.spec || "").match(/subject `([^`]+)`/)?.[1]] });
  state.context = context; state.pin = pin; state.workerCalls = [];
  state.run = () => {
    state.output = [];
    try { context.invoke({ repo, run: "fixture", phase: "implement", "spec-file": "spec.md", "assessment-file": "assessment.json", fallback: "quota" }); }
    catch (error) { if (!Object.hasOwn(error, "exit")) throw error; state.exit = error.exit; }
    return state.output.join("\n");
  };
  state.repo = repo;
  return state;
}

function check(name, run) {
  try { run(); console.log("PASS " + name); passed++; }
  catch (error) { console.error("FAIL " + name + ": " + error.message); failed++; }
}

try {
  for (const before of [true, false]) check("recovery freezes adapter mode " + before + " -> " + !before + " without replay or false DISPATCHED", () => {
    const f = fixture(); f.delay = 0; f.question = false;
    if (before) f.scriptWorker = true; else { f.setAdmission(false); f.receipt = false; }
    assert.match(f.run(), /NO_ACK/);
    const pending = path.join(f.repo, ".dely/local/runs/fixture/pending-start.json"), bytes = fs.readFileSync(pending), starts = f.starts, enters = f.enters;
    f.setAdmission(!before); f.question = true; f.receipt = true;
    assert.match(f.run(), /OUTCOME_UNKNOWN/); assert.equal(f.starts, starts); assert.equal(f.enters, enters);
    assert.deepEqual(fs.readFileSync(pending), bytes); assert.equal(f.events.filter(e => e.event === "dispatch").length, 0);
    assert.equal(f.calls.filter(a => a[1] === "reply").length, 0); assert.deepEqual(f.workerCalls, []);
  });
  check("legacy pending mode is unknown even when the adapter remains present", () => {
    const f = fixture(); f.delay = 0; f.scriptWorker = true; f.question = false; f.run();
    const pending = path.join(f.repo, ".dely/local/runs/fixture/pending-start.json"), record = JSON.parse(fs.readFileSync(pending));
    delete record.nativeAdmission; delete record.admissionConfig; fs.writeFileSync(pending, JSON.stringify(record));
    const bytes = fs.readFileSync(pending), starts = f.starts, enters = f.enters; f.question = true;
    assert.match(f.run(), /OUTCOME_UNKNOWN/); assert.deepEqual(fs.readFileSync(pending), bytes);
    assert.equal(f.starts, starts); assert.equal(f.enters, enters); assert.deepEqual(f.workerCalls, []);
  });
  check("a valid but changed adapter configuration cannot change a waiting attempt", () => {
    const f = fixture(); f.delay = 0; f.scriptWorker = true; f.question = false; f.run();
    const pending = path.join(f.repo, ".dely/local/runs/fixture/pending-start.json"), bytes = fs.readFileSync(pending);
    f.adapterConfig.journal = path.join(f.repo, "different-journal.jsonl"); fs.writeFileSync(f.configFile, JSON.stringify(f.adapterConfig)); f.question = true;
    assert.match(f.run(), /OUTCOME_UNKNOWN/); assert.deepEqual(fs.readFileSync(pending), bytes); assert.deepEqual(f.workerCalls, []);
  });
  check("a valid adapter profile without an optional updater still admits through the native gate", () => {
    const f = fixture(); f.delay = 0; f.scriptWorker = true;
    delete f.adapterConfig.dependencies[f.adapterConfig.updater]; delete f.adapterConfig.updater;
    fs.writeFileSync(f.configFile, JSON.stringify(f.adapterConfig));
    assert.match(f.run(), /DISPATCHED/); assert.equal(f.preJournalAdmission, false); assert.deepEqual(f.workerCalls, [true]);
  });
  for (const variant of ["malformed", "array", "missing-dependencies", "empty-dependencies", "missing-pin", "missing-runtime-pin", "missing-updater-pin", "invalid-digest", "stale-digest", "relative-journal", "relative-updater", "missing-code", "missing-settings", "unreadable-settings", "unreadable-directory"]) check("existing invalid or stale adapter fails clearly before launch: " + variant, () => {
    const f = fixture(); f.delay = 0;
    const config = JSON.parse(JSON.stringify(f.adapterConfig));
    if (variant === "malformed") fs.writeFileSync(f.configFile, "{");
    else if (variant === "array") fs.writeFileSync(f.configFile, "[]");
    else if (variant === "missing-code") fs.unlinkSync(path.join(f.adapterDir, "codex-compliance.js"));
    else if (variant === "missing-settings") fs.unlinkSync(f.configFile);
    else if (variant === "unreadable-settings") f.unreadableConfig = true;
    else if (variant === "unreadable-directory") f.unreadableAdapter = true;
    else {
      if (variant === "missing-dependencies") delete config.dependencies;
      if (variant === "empty-dependencies") config.dependencies = {};
      if (variant === "missing-pin") delete config.dependencies[config.dely];
      if (variant === "missing-runtime-pin") delete config.dependencies[path.join(path.dirname(helper), "usage.js")];
      if (variant === "missing-updater-pin") delete config.dependencies[config.updater];
      if (variant === "invalid-digest") config.dependencies[config.dely] = "invalid";
      if (variant === "stale-digest") config.dependencies[config.dely] = "0".repeat(64);
      if (variant === "relative-journal") config.journal = "relative.jsonl";
      if (variant === "relative-updater") config.updater = "relative.js";
      fs.writeFileSync(f.configFile, JSON.stringify(config));
    }
    assert.match(f.run(), /ERROR.*native admission configuration (invalid|stale)/i); assert.equal(f.starts, 0); assert.equal(f.enters, 0);
  });
  check("invalid configuration during recovery retains pending bytes and waiting worker", () => {
    const f = fixture(); f.delay = 0; f.scriptWorker = true; f.question = false; f.run();
    const pending = path.join(f.repo, ".dely/local/runs/fixture/pending-start.json"), bytes = fs.readFileSync(pending), starts = f.starts;
    fs.writeFileSync(f.configFile, "{"); f.question = true;
    assert.match(f.run(), /OUTCOME_UNKNOWN.*native admission configuration invalid/i);
    assert.deepEqual(fs.readFileSync(pending), bytes); assert.equal(f.starts, starts); assert.deepEqual(f.workerCalls, []);
  });
  check("consumed exact receipt is recovered without consuming history", () => {
    const f = fixture(); f.delay = 0; f.receiptConsumed = true;
    assert.match(f.run(), /DISPATCHED/);
    assert.ok(f.calls.some((a) => a[1] === "check" && a.includes("--all")));
    assert.ok(!f.calls.some((a) => a[1] === "check" && (!a.includes("--all") || a.includes("--ack"))));
  });
  check("immediate worker tool waits for journal and exact coordinator acknowledgement", () => {
    const f = fixture(); f.delay = 0; f.scriptWorker = true;
    assert.match(f.run(), /DISPATCHED/);
    assert.deepEqual(f.workerCalls, [true]);
    assert.equal(f.preJournalAdmission, false);
    assert.equal(f.workerAcknowledged, true);
  });
  check("dispatch ask reply targets only the matched question after the durable journal", () => {
    const f = fixture(); f.delay = 0; f.scriptWorker = true; f.decoyQuestion = true;
    assert.match(f.run(), /DISPATCHED/);
    assert.equal(f.replyId, "question_fixture"); assert.equal(f.replyAfterJournal, true);
    assert.equal(f.calls.filter(a => a[1] === "reply").length, 1);
    assert.equal(f.preJournalAdmission, false); assert.deepEqual(f.workerCalls, [true]);
  });
  for (const variant of ["wrong-sender", "terminal-sender", "forged-sender", "wrong-dispatch", "wrong-task",
    "wrong-body", "wrong-payload-question", "missing-body", "missing-payload-question", "malformed", "rejected", "missing-id"]) check("dispatch ask rejects " + variant + " with a valid receipt", () => {
    const f = fixture(); f.delay = 0; f.scriptWorker = true; f.questionVariant = variant;
    assert.doesNotMatch(f.run(), /DISPATCHED/); assert.deepEqual(f.workerCalls, []);
    assert.equal(f.calls.filter(a => a[1] === "reply").length, 0);
    assert.equal(f.events.filter(e => e.event === "dispatch").length, 0);
    assert.equal(f.nativeAdmission(), false);
  });
  check("dispatch-scoped sender never substitutes for the heartbeat terminal", () => {
    const f = fixture(); f.delay = 0; f.scriptWorker = true; f.dispatchReceipt = true;
    assert.doesNotMatch(f.run(), /DISPATCHED/); assert.deepEqual(f.workerCalls, []);
    assert.equal(f.calls.filter(a => a[1] === "reply").length, 0);
  });
  check("wrong acknowledgement cannot resume the scripted worker", () => {
    const f = fixture(); f.delay = 0; f.scriptWorker = true; f.wrongAcknowledgement = true;
    f.run(); assert.deepEqual(f.workerCalls, []); assert.equal(f.workerAcknowledged, false);
  });
  check("missing durable journal withholds admission acknowledgement", () => {
    const f = fixture(); f.delay = 0; f.scriptWorker = true; f.journalFailure = true;
    assert.doesNotMatch(f.run(), /DISPATCHED/); assert.deepEqual(f.workerCalls, []);
    assert.equal(f.nativeAdmission(), false);
  });
  check("receipt-aware native admission acknowledges the worker without journal logging", () => {
    const f = fixture(); f.delay = 0; f.scriptWorker = true; f.journalFailure = true;
    const receipts = path.join(path.dirname(helper), "dispatch-receipts.js");
    f.adapterConfig.receipts = receipts;
    f.adapterConfig.dependencies[receipts] = hash(fs.readFileSync(receipts));
    fs.writeFileSync(f.configFile, JSON.stringify(f.adapterConfig));
    assert.match(f.run(), /DISPATCHED/);
    assert.equal(f.workerAcknowledged, true);
    assert.equal(f.replyAfterReceipt, true);
    assert.equal(f.replyAfterJournal, false);
    assert.deepEqual(f.workerCalls, [true]);
    assert.equal(f.nativeAdmission(), true);
  });
  check("logging remains optional without the native admission adapter", () => {
    const f = fixture(); f.delay = 0; f.journalFailure = true;
    f.setAdmission(false);
    assert.match(f.run(), /DISPATCHED/);
    assert.ok(!f.calls.some((a) => a[1] === "reply"));
  });
  for (const variant of ["missing", "subject", "from_handle", "dispatchId", "taskId", "missing-dispatchId", "missing-taskId", "rejected", "question", "wrong-question", "foreign-question"]) check("foreign or missing bootstrap identity is not acknowledged: " + variant, () => {
    const f = fixture(); f.delay = 0; f.scriptWorker = true;
    if (variant === "missing") f.receipt = false;
    else if (["subject", "from_handle"].includes(variant)) f.foreignReceipt = variant;
    else if (variant === "question") f.question = false;
    else if (variant === "wrong-question") f.wrongQuestion = true;
    else if (variant === "rejected") f.rejectedReceipt = true;
    else if (variant.startsWith("missing-")) f.missingReceiptPayload = variant.slice(8);
    else if (variant === "foreign-question") f.foreignQuestion = true;
    else f.wrongReceiptPayload = variant;
    assert.doesNotMatch(f.run(), /DISPATCHED/); assert.deepEqual(f.workerCalls, []);
  });
  for (const agent of ["codex", "antigravity"]) check("same-Run " + agent + " preflight preserves pending bytes and original reconciliation never resends", () => {
    const f = fixture(); f.delay = Infinity; f.run();
    const pendingFile = path.join(f.repo, ".dely/local/runs/fixture/pending-start.json"), before = fs.readFileSync(pendingFile);
    const original = { id: f.id, spec: f.spec, enteredAt: f.enteredAt, startedAt: f.startedAt, handle: f.handle };
    f.delay = 0; f.preflight = true; f.agy = agent === "antigravity";
    const pinBefore = { ...f.pin };
    Object.assign(f.pin, f.agy ? { agent, model: "default", effort: "default" } : { agent, model: "gpt-6.1-sol", effort: "medium" });
    try { f.context.preflight({ repo: f.repo, run: "fixture" }); } catch (e) { if (!Object.hasOwn(e, "exit")) throw e; assert.equal(e.exit, 0, f.output.join("\n")); }
    assert.deepEqual(fs.readFileSync(pendingFile), before);
    Object.assign(f, original); Object.assign(f.pin, pinBefore); f.agy = false; f.preflight = false;
    const starts = f.starts, enters = f.enters;
    assert.match(f.run(), /DISPATCHED/); assert.equal(f.starts, starts); assert.equal(f.enters, enters);
  });
  check("a bound native turn proves an Orca turn_start_unobserved worker without replay", () => {
    const f = fixture(); f.delay = 1; f.startUnobserved = true;
    assert.match(f.run(), /DISPATCHED ctx_fixture_1/);
    assert.equal(f.starts, 1); assert.equal(f.enters, 1);
    const event = f.events.find((e) => e.event === "dispatch");
    assert.equal(event.launch.modelEvidence.session, "session_fixture");
    assert.equal(event.launch.modelEvidence.turn, "turn_fixture");
  });
  for (const field of ["wrongIdentity", "wrongRun", "wrongHandle", "nativeMissing", "nativeWrongModel", "nativeWrongEffort", "nativeStale", "nativeFuture", "nativeWrongTurn", "nativeWrongPrompt", "nativeWrongRepo", "nativeConflict"]) check("turn_start_unobserved cannot bypass " + field, () => {
    const f = fixture(); f.delay = 1; f.startUnobserved = true; f[field] = true;
    assert.doesNotMatch(f.run(), /DISPATCHED/);
    assert.equal(f.starts, 1);
    assert.equal(f.events.filter((e) => e.event === "dispatch").length, 0);
  });
  check("a start after 45 seconds is admitted once within the 60-second deadline", () => {
    const f = fixture();
    assert.match(f.run(), /DISPATCHED/);
    assert.equal(f.starts, 1); assert.equal(f.enters, 1);
    assert.equal(f.events.filter((e) => e.event === "dispatch").length, 1);
  });
  check("never-started input stays unknown and cannot launch a replacement", () => {
    const f = fixture(); f.delay = Infinity;
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.equal(f.clock - f.enteredAt, 60000);
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.equal(f.starts, 1); assert.equal(f.enters, 1);
    assert.equal(f.events.filter((e) => e.event === "dispatch").length, 0);
  });
  check("a late start reconciles the original dispatch without another prompt", () => {
    const f = fixture(); f.delay = 65000;
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    f.clock += 10000;
    assert.match(f.run(), /DISPATCHED ctx_fixture_1/);
    assert.equal(f.starts, 1); assert.equal(f.enters, 1);
    assert.equal(f.events.filter((e) => e.event === "dispatch").length, 1);
  });
  check("the bound native turn resolves a stale provider model without prompt replay", () => {
    const f = fixture(); f.delay = 0; f.projectionDelay = 10000; f.turnStart = true;
    assert.match(f.run(), /DISPATCHED/);
    assert.ok(f.clock < f.projectionDelay);
    assert.equal(f.starts, 1); assert.equal(f.enters, 1);
    assert.equal(f.events.filter((e) => e.event === "dispatch").length, 1);
  });
  check("an ambiguous submission without a dispatch id retains the launch lock", () => {
    const f = fixture(); f.missingId = true;
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.equal(f.starts, 1); assert.equal(f.enters, 0);
  });
  for (const field of ["wrongModel", "wrongIdentity"]) check(field + " cannot admit or replace an uncertain worker", () => {
    const f = fixture(); f.delay = Infinity;
    f.run(); f.delay = 0; f[field] = true;
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.equal(f.starts, 1); assert.equal(f.events.filter((e) => e.event === "dispatch").length, 0);
  });
  for (const field of ["wrongModel", "wrongIdentity"]) check("turn_started cannot bypass " + field, () => {
    const f = fixture(); f.delay = 0; f.turnStart = true; f[field] = true;
    assert.doesNotMatch(f.run(), /DISPATCHED/);
    assert.equal(f.starts, 1);
    assert.equal(f.events.filter((e) => e.event === "dispatch").length, 0);
  });
  for (const field of ["wrongRun", "wrongHandle", "nativeMissing", "nativeWrongModel", "nativeWrongEffort", "nativeStale", "nativeFuture", "nativeWrongTurn", "nativeWrongPrompt", "nativeWrongRepo"]) check(field + " stays unknown despite matching projection and turn_started", () => {
    const f = fixture(); f.delay = 0; f.turnStart = true; f[field] = true;
    assert.doesNotMatch(f.run(), /DISPATCHED/);
    assert.equal(f.starts, 1);
    assert.equal(f.events.filter((e) => e.event === "dispatch").length, 0);
  });
  check("a succeeded pending worker is reconciled instead of executing the task twice", () => {
    const f = fixture(); f.delay = Infinity; f.run();
    f.dead = true; f.succeeded = true; f.nativeForDead = true;
    assert.match(f.run(), /DISPATCHED ctx_fixture_1/);
    assert.equal(f.starts, 1); assert.equal(f.enters, 1);
    assert.equal(f.calls.filter((a) => a[1] === "worker-release").length, 0);
  });
  for (const field of ["nativeSession", "nativeTurn"]) check("pending recovery cannot replace its recorded " + field, () => {
    const f = fixture(); f.delay = 0; f.receipt = false;
    assert.doesNotMatch(f.run(), /DISPATCHED/);
    f.receipt = true; f[field] = "different_identity";
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.equal(f.starts, 1);
    assert.equal(f.events.filter((e) => e.event === "dispatch").length, 0);
  });
  check("identical native mirrors remain one proof", () => {
    const f = fixture(); f.delay = 1; f.nativeDuplicate = "identical";
    assert.match(f.run(), /DISPATCHED/);
  });
  for (const field of ["nativeConflict", "nativeDuplicate"]) check(field + " cannot collapse conflicting native contexts into one proof", () => {
    const f = fixture(); f.delay = 1; f[field] = field === "nativeDuplicate" ? "conflicting" : true;
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.equal(f.starts, 1);
  });
  check("a lagging mirror cannot hide a later unrelated prompt in the same session", () => {
    const f = fixture(); f.delay = 1; f.nativeDuplicate = "stale";
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.equal(f.starts, 1);
  });
  for (const failure of ["unreadable", "vanished"]) check(failure + " native files preserve the unknown attempt", () => {
    const f = fixture(); f.delay = 0;
    const original = fs.readdirSync;
    fs.readdirSync = (directory, ...args) => {
      if (String(directory).includes(path.join(f.repo, ".codex", "sessions"))) {
        if (failure === "unreadable") throw Object.assign(new Error("fixture access denied"), { code: "EACCES" });
        return [...original(directory, ...args), "rollout-vanished.jsonl"];
      }
      return original(directory, ...args);
    };
    try { assert.match(f.run(), /OUTCOME_UNKNOWN/); assert.equal(f.starts, 1); }
    finally { fs.readdirSync = original; }
  });
  check("a succeeded worker with missing native proof cannot be replaced", () => {
    const f = fixture(); f.delay = Infinity; f.run(); f.dead = true; f.succeeded = true;
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.equal(f.starts, 1);
    assert.equal(f.calls.filter((a) => a[1] === "worker-release").length, 0);
  });
  check("changed task input cannot bypass an uncertain attempt", () => {
    const f = fixture(); f.delay = Infinity; f.run();
    fs.appendFileSync(path.join(f.repo, "spec.md"), "changed\n");
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.equal(f.starts, 1);
  });
  check("missing owned inventory cannot admit a late worker", () => {
    const f = fixture(); f.delay = Infinity; f.run(); f.delay = 0;
    for (const name of ["dely-run-fixture.jsonl", "dely-agy-fixture.jsonl"]) fs.unlinkSync(path.join(f.repo, name));
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.equal(f.starts, 1); assert.equal(f.events.filter((e) => e.event === "dispatch").length, 0);
  });
  check("a late worker still needs its original receipt before journaling", () => {
    const f = fixture(); f.delay = Infinity; f.run(); f.delay = 0; f.receipt = false;
    assert.doesNotMatch(f.run(), /DISPATCHED/);
    assert.equal(f.starts, 1); assert.equal(f.enters, 1);
    assert.equal(f.events.filter((e) => e.event === "dispatch").length, 0);
  });
  check("a corrupt staged snapshot cannot be admitted during reconciliation", () => {
    const f = fixture(); f.delay = Infinity; f.run(); f.delay = 0;
    const file = path.join(f.repo, ".dely/local/runs/fixture/pending-start.json");
    const pending = JSON.parse(fs.readFileSync(file, "utf8"));
    pending.snapshotPath = path.join(f.repo, "staged.txt");
    pending.snapshotSha256 = hash("original snapshot");
    fs.writeFileSync(pending.snapshotPath, "changed snapshot");
    fs.writeFileSync(file, JSON.stringify(pending));
    assert.match(f.run(), /staged snapshot was modified/);
    assert.equal(f.starts, 1); assert.equal(f.events.filter((e) => e.event === "dispatch").length, 0);
  });
  check("a dead attempt with an uncertain release blocks replacement", () => {
    const f = fixture(); f.delay = Infinity; f.run(); f.dead = true; f.release = "release_unknown";
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.equal(f.starts, 1);
  });
  check("an inactive unsettled worker cannot be released or replaced", () => {
    const f = fixture(); f.delay = Infinity; f.run(); f.dead = true; f.unsettled = true;
    assert.match(f.run(), /OUTCOME_UNKNOWN/);
    assert.equal(f.starts, 1); assert.equal(f.calls.filter((a) => a[1] === "worker-release").length, 0);
  });
  check("a proven inactive released final fallback cannot launch stage one again", () => {
    const f = fixture(); f.delay = Infinity; f.run(); f.dead = true; f.nativeForDead = true;
    f.run();
    assert.equal(f.starts, 1);
    assert.equal(f.exit, 5);
    assert.ok(f.calls.some((a) => a[1] === "worker-release"));
  });
  console.log(`${passed} passed, ${failed} failed`);
} finally {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("dely-start-check-")) throw Error("Unsafe fixture cleanup path");
  fs.rmSync(root, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
