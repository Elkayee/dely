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
  const routing = {
    requireApprovedRoute: () => ({ difficulty: "easy", task: { spec_sha256: hash(fs.readFileSync(path.join(repo, "spec.md"))), context_sha256: "context" }, jev: null, review: { source: "fixture" } }),
    selectedPhase: () => "implement_backup_2", verifyPin: () => {},
  };
  function orca(args) {
    state.calls.push(args);
    const kind = args.slice(0, 2).join(" ");
    const value = (key) => args[args.indexOf(key) + 1];
    if (kind === "terminal create") return { ok: true, result: { terminal: { handle: "term_fixture" } } };
    if (kind === "terminal wait") return { ok: true, result: { wait: { satisfied: true } } };
    if (kind === "terminal read") return { ok: true, result: { terminal: { status: state.dead ? "exited" : "connected", tail: state.enteredAt === null ? ["[Pasted Content]"] : [] } } };
    if (kind === "terminal send") { state.enters++; state.enteredAt = state.clock; return { ok: true, result: { accepted: true } }; }
    if (kind === "orchestration worker-start") {
      state.starts++;
      state.spec = value("--spec");
      state.id = "ctx_fixture_" + state.starts;
      return { ok: true, result: { dispatchId: state.missingId ? undefined : state.id, taskId: "task_fixture", state: "outcome_unknown" } };
    }
    if (kind === "orchestration worker-show") {
      const id = state.wrongIdentity ? "ctx_other" : state.id;
      const working = state.enteredAt !== null && state.clock - state.enteredAt >= state.delay;
      if ((working || state.nativeForDead) && !state.nativeMissing) {
        const directory = path.join(repo, ".codex/sessions/1970/01/01");
        fs.mkdirSync(directory, { recursive: true });
        const model = state.wrongModel || state.nativeWrongModel ? "gpt-5.6-terra" : pin.model;
        const effort = state.nativeWrongEffort ? "low" : pin.effort;
        const stamp = new Date(state.clock + (state.nativeFuture ? 120000 : 0)).toISOString();
        const turn = state.nativeTurn || "turn_fixture", spec = state.nativeWrongPrompt ? "unrelated task" : state.id + " " + state.spec;
        const rows = [
          { type: "session_meta", payload: { id: state.nativeSession || "session_fixture", cwd: repo, timestamp: new Date(state.nativeStale ? -1 : 0).toISOString() } },
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
        dispatch: { id, runId: state.wrongRun ? "other_run" : "fixture", assigneeHandle: state.wrongHandle ? "term_other" : "term_fixture", status: state.dead && !state.unsettled ? (state.succeeded ? "completed" : "failed") : "dispatched", completedAt: state.dead && !state.unsettled ? "2026-10-15T00:00:00Z" : null },
        worker: { dispatchId: id, agentTerminalHandle: "term_fixture", state: state.dead ? (state.succeeded ? "succeeded" : "failed") : "ready" },
        observation: { status: state.dead ? "exited" : "live", exactWorker: !state.wrongIdentity },
        projection: { dispatchId: id, provider: { id: "codex", model: state.wrongModel || state.clock < (state.projectionDelay || 0) ? "gpt-6.1-sol" : pin.model },
          stage: { worker: state.dead ? (state.succeeded ? "succeeded" : "failed") : "ready", dispatch: state.dead ? (state.succeeded ? "completed" : "failed") : "dispatched", detail: "input_accepted", activity: working ? "working" : "idle" },
          outcome: state.succeeded ? "succeeded" : "in_progress",
          liveness: { verdict: state.dead ? "exited" : "live", source: "agent_status" }, evidence: { durable: true, liveStatus: "fresh" } },
      } };
    }
    if (kind === "orchestration worker-release") return { ok: true, result: { state: state.release } };
    if (kind === "orchestration check") return { ok: true, result: { messages: state.receipt ? [{ type: "heartbeat", subject: (state.spec || "").match(/subject `([^`]+)`/)?.[1], from_handle: "term_fixture", payload: { dispatchId: state.id, taskId: "task_fixture" } }] : [] } };
    if (kind === "orchestration worker-list") return { ok: true, result: { workers: [] } };
    return { ok: true, result: {} };
  }
  const context = vm.createContext({
    require: (name) => name === "./task-routing.js" ? routing : name === "os" ? { ...os, tmpdir: () => repo, homedir: () => repo } : localRequire(name),
    process: { platform: "win32", env: { APPDATA: repo, CODEX_HOME: path.join(repo, ".codex"), ORCA_TERMINAL_HANDLE: "term_control", DELY_ACK_S: "1", DELY_POLL_S: ".02" }, argv: [], exit: (code) => { throw { exit: code }; } },
    console: { log: (line) => state.output.push(String(line)) }, Buffer, TextDecoder, SharedArrayBuffer,
    Atomics: { wait: (_a, _i, _v, ms) => { state.clock += ms; } },
    Date: class extends Date { static now() { return state.clock; } },
    __dirname: path.dirname(helper), __filename: helper,
    fixtureOrca: orca, fixturePin: pin, fixtureEvents: state.events,
  });
  vm.runInContext(source + "\norca=fixtureOrca; pin=()=>fixturePin; requireHandle=()=>{}; logEvent=(event,data)=>fixtureEvents.push({event,...data}); globalThis.invoke=dispatch;", context);
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
