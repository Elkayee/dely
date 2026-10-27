"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const routing = require("../skills/delivery/scripts/task-routing.js");

const helper = path.resolve(__dirname, "../skills/delivery/scripts/dely.js");
const source = fs.readFileSync(helper, "utf8");
const cli = source.indexOf("const [cmd, ...rest] = process.argv.slice(2);");
assert.ok(cli > 0, "Load helper functions without invoking the CLI entry point.");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

for (const command of ["preflight", "dispatch"]) {
  test("case27-case29 " + command + " never launches a non-Sol worker for final Medium+ or Hard", async (t) => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dely-route-ownership-")));
    t.after(() => {
      assert.ok(path.basename(repo).startsWith("dely-route-ownership-"));
      fs.rmSync(repo, { recursive: true });
    });
    fs.writeFileSync(path.join(repo, "spec.md"), "One known internal integration with agreed acceptance.\n");
    fs.writeFileSync(path.join(repo, "context.json"), JSON.stringify({ scope: "Known integration", coupling: "Known components",
      acceptance: "Agreed integrated detector", evidence: "Owners and detector inspected", requirements_confirmed: true,
      risks: Object.fromEntries(routing.RISK_KEYS.map((key) => [key, false])) }));
    const raw = await routing.assess(routing.loadTask(repo, "spec.md", "context.json"), { apiKey: "" });
    const file = path.join(repo, "approved.json"), rejected = {}, starts = [];
    const context = vm.createContext({ require: createRequire(helper), __dirname: path.dirname(helper), __filename: helper,
      Buffer, TextDecoder, process: { platform: "win32", env: { CODEX_HOME: path.join(repo, "no-native-adapter") }, exit: (code) => { rejected.code = code; throw rejected; } }, console: { log: () => {} } });
    vm.runInContext(source.slice(0, cli), context, { filename: helper });
    context.requireHandle = () => {};
    context.restoreControlFocus = () => {};
    context.logEvent = () => {};
    context.pin = (_, phase) => phase === "implement_backup_2" ? { agent: "codex", model: "gpt-6-luna", effort: "max" } :
      { agent: "codex", model: "gpt-6.1-sol", effort: "medium" };
    context.start = (_, __, pin) => { starts.push(pin); return { modelUnavailable: true }; };
    const f = { repo, run: "ownership-fixture", phase: "implement", "spec-file": "spec.md", "assessment-file": file };
    fs.writeFileSync(file, JSON.stringify(routing.review(raw, "medium_plus", "Known integration requires Sol")));
    assert.throws(() => context[command](f), (e) => e === rejected);
    assert.notEqual(rejected.code, 0);
    assert.equal(starts.length, 1);
    assert.equal(starts[0].model, "gpt-6.1-sol");
    starts.length = 0;
    if (command === "dispatch") {
      const pendingFile = context.pendingStartPath(repo, f.run);
      const pending = JSON.parse(fs.readFileSync(pendingFile, "utf8"));
      pending.pin.model = "gpt-6-luna";
      pending.pin.effort = "max";
      fs.writeFileSync(pendingFile, JSON.stringify(pending));
      assert.throws(() => context.dispatch(f), (e) => e === rejected);
      assert.equal(starts.length, 0, "An unauthorized pending model cannot resume or launch a replacement");
    }
    fs.writeFileSync(file, JSON.stringify(routing.review(raw, "hard", "Consequential execution remains direct")));
    assert.throws(() => context[command](f), (e) => e === rejected);
    assert.equal(starts.length, 0);
  });
}

function dispatchFixture(t, mode) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "dely-staged-dispatch-"));
  t.after(() => {
    assert.equal(fs.realpathSync(repo), repo);
    assert.ok(path.basename(repo).startsWith("dely-staged-dispatch-"));
    fs.rmSync(repo, { recursive: true });
  });
  const original = Buffer.from("Read the confirmed task. Tiếng Việt.\r\n", "utf8");
  fs.writeFileSync(path.join(repo, "spec.md"), original);
  const decision = { difficulty: "medium_minus", task: { spec_sha256: hash(original),
    context_sha256: hash("fixture context") }, review: { source: "control-evidence" } };
  const route = { requireApprovedRoute: () => decision, selectedPhase: () => "implement_backup",
    verifyPin: () => {}, verifyUnavailablePin: () => {} };
  const nativeRequire = createRequire(helper);
  const context = vm.createContext({ require: (name) => name === "./task-routing.js" ? route : nativeRequire(name),
    __dirname: path.dirname(helper), __filename: helper, Buffer, TextDecoder,
    process: { platform: "win32", env: { CODEX_HOME: path.join(repo, "no-native-adapter"), DELY_ACK_S: "1", DELY_POLL_S: "0.001" } },
    console: { log: () => {} } });
  vm.runInContext(source.slice(0, cli), context, { filename: helper });
  const launches = [], events = [], snapshots = [];
  context.pin = (_, phase) => phase === "implement_backup_2" || mode === "inline" ?
    { agent: "codex", model: "gpt-6-luna", effort: "max" } :
    { agent: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" };
  context.requireHandle = () => {};
  context.recordOwnedSnapshot = (_, file) => snapshots.push(file);
  context.restoreControlFocus = () => {};
  context.logEvent = (event, fields) => events.push({ event, ...fields });
  context.start = (_, run, pin, spec) => {
    launches.push({ agent: pin.agent, spec });
    if (mode === "fallback" && launches.length === 1) return { modelUnavailable: true };
    return { id: "ctx_staged", terminalHandle: "term_staged" };
  };
  context.orca = () => {
    const delivered = snapshots.length ? fs.readFileSync(snapshots[0], "utf8") : launches.at(-1).spec;
    return { result: { messages: [{ type: "heartbeat", subject: delivered.match(/rcpt_[a-f0-9]{16}/)[0],
      dispatchId: "ctx_staged", from_handle: "term_staged" }] } };
  };
  const completed = {};
  context.process.exit = (code) => {
    assert.equal(code, 0);
    throw completed;
  };
  assert.throws(() => context.dispatch({ repo, run: "fixture", phase: "implement", "spec-file": "spec.md" }),
    (error) => error === completed);
  return { original, launches, snapshot: snapshots[0], journal: events.find((row) => row.event === "dispatch") };
}

for (const mode of ["staged", "fallback"]) {
  test("staged file metadata matches delivered bytes through " + mode + " dispatch", (t) => {
    const f = dispatchFixture(t, mode);
    const delivered = fs.readFileSync(f.snapshot);
    const metadata = f.launches.at(-1).spec.match(/\((\d+) bytes, SHA-256: ([a-f0-9]{64})\)/);
    assert.ok(metadata);
    assert.notEqual(hash(delivered), hash(f.original));
    assert.equal(Number(metadata[1]), delivered.length);
    assert.equal(metadata[2], hash(delivered));
    assert.equal(f.journal.promptSha256, hash(f.original));
    assert.equal(f.journal.snapshotSha256, hash(delivered));
    if (mode === "fallback") {
      assert.deepEqual(f.launches.map((row) => row.agent), ["antigravity", "codex"]);
      assert.equal(f.launches[0].spec, f.launches[1].spec);
    }
  });
}

test("inline dispatch retains original task evidence and receipt", (t) => {
  const f = dispatchFixture(t, "inline");
  assert.equal(f.snapshot, undefined);
  assert.equal(f.journal.snapshotSha256, null);
  assert.equal(f.journal.promptSha256, hash(f.original));
  assert.ok(f.launches[0].spec.startsWith(f.original.toString("utf8")));
  assert.ok(f.launches[0].spec.includes(f.journal.receiptMarker));
});
