"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const installer = require("./codex-compliance.js");
const guard = process.env.COMPLIANCE_ADAPTER ? require(path.resolve(process.env.COMPLIANCE_ADAPTER)) : installer;
const routingPath = process.env.COMPLIANCE_ROUTING || path.resolve(__dirname, "../skills/delivery/scripts/task-routing.js");
const catalogHelpers = 'const {combineSkills,skillKey,skillPolicyPaths,validateInput}=require(' + JSON.stringify(require.resolve("./jev_agent.js")) + ');\nObject.assign(exports,{combineSkills,skillKey,skillPolicyPaths,validateInput});\n';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-compliance-test-"));
  const home = path.join(directory, "home");
  const repo = path.join(directory, "repo");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "Keep changes scoped.\n");
  const advisor = path.join(directory, "advisor.js");
  fs.writeFileSync(advisor, catalogHelpers + 'const path = require("path");\nconst ROOT = path.resolve(__dirname, "..");\nexports.discoverSkills = () => [];\nexports.advise = async (input) => ({status:"NOT_EVALUATED", reason:"TEST_UNAVAILABLE", input_sha256:require("crypto").createHash("sha256").update(JSON.stringify(input)).digest("hex"), suggestion:null});\n');
  const skill = path.join(directory, "SKILL.md");
  fs.writeFileSync(skill, "Read the actual source before editing.\n");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "hooks.json"), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "existing-session-hook" }] }] },
  }));
  installer.install({ routing: routingPath, advisor }, home);
  const settings = JSON.parse(fs.readFileSync(guard.settingsFile(home), "utf8"));
  settings.journal = path.join(directory, "journal.jsonl");
  fs.writeFileSync(guard.settingsFile(home), JSON.stringify(settings));
  const task = {
    mode: "implement", request: "Implement the confirmed task", spec: "Apply the scoped change.\n",
    context: { scope: "One local file", coupling: "Internal only", acceptance: "The focused check passes",
      evidence: "The current source is known", requirements_confirmed: true,
      risks: { security: false, data: false, public_contract: false, architecture: false, production: false, routing: true } },
    skills: [{ name: "required", path: skill, description: "Required source verification" },
      { name: "dely:delivery", path: settings.delivery, description: "Delivery for delegated changes" }],
    required_skills: ["required"],
  };
  const options = { session: "session", turn: "turn", repo, "task-json": JSON.stringify(task) };
  const event = { session_id: "session", turn_id: "turn", cwd: repo,
    model: "gpt-6.1-sol", hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { command: "patch" } };
  const prepare = () => guard.prepare({ ...options, "task-json": JSON.stringify(task) }, home);
  const review = (extra = {}) => guard.review({ ...options, difficulty: "hard",
    reason: "Control checked the routing risk", "skill-reason": "Retain the mandatory source verification",
    skills: '["required"]', ...extra }, home);
  t.after(() => {
    assert.equal(fs.realpathSync(directory), directory);
    assert.ok(path.basename(directory).startsWith("codex-compliance-test-"));
    fs.rmSync(directory, { recursive: true });
  });
  return { home, repo, skill, advisor, settings, task, options, event, prepare, review };
}

function candidateFixture(t) {
  const f = fixture(t);
  const git = (...args) => {
    const result = spawnSync("git", args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "--quiet", f.repo);
  git("-C", f.repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "--quiet", "--allow-empty", "-m", "fixture");
  const candidate = path.join(path.dirname(f.repo), "candidate");
  git("-C", f.repo, "worktree", "add", "--quiet", "--detach", candidate, "HEAD");
  fs.writeFileSync(path.join(candidate, "AGENTS.md"), "Keep candidate changes scoped.\n");
  f.task.execution_repo = candidate;
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Work in this candidate" }, f.home);
  return { ...f, candidate, git };
}

async function sourceSyncFixture(t) {
  const f = fixture(t), updater = require("./sync-dely.js");
  const source = path.resolve(__dirname, "..");
  for (const file of Object.keys(updater.bundle(source).hashes)) {
    const destination = path.join(f.repo, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, updater.packagedBytes(source, file, true));
  }
  const homes = [f.home, path.join(path.dirname(f.home), "other-home")];
  fs.mkdirSync(homes[1]);
  installer.install({ routing: routingPath, advisor: f.advisor }, homes[1]);
  const expected = updater.bundle(f.repo);
  for (const home of homes) {
    const catalog = path.join(home, "plugins/cache/dely/dely", expected.version);
    fs.cpSync(f.repo, catalog, { recursive: true });
    fs.writeFileSync(path.join(home, "config.toml"), '[plugins."dely@dely"]\nenabled = true\n');
  }
  const options = { source: f.repo, homes };
  assert.equal(updater.sync(options, { expected: expected.sha256, install: installer.install }).status, "COHERENT");
  await f.prepare();
  f.review();
  assert.deepEqual(guard.hook(f.event, f.home), {});
  return { ...f, homes, updater, syncOptions: options };
}

test("source sync blocks admitted completion when source bytes are newer than the installs", async (t) => {
  const f = await sourceSyncFixture(t), stop = { ...f.event, hook_event_name: "Stop" };
  assert.deepEqual(guard.hook(stop, f.home), {});
  const readme = path.join(f.repo, "README.md"), before = fs.readFileSync(readme);
  fs.appendFileSync(readme, "\nVerified source update awaiting installation.\n");
  const result = guard.hook(stop, f.home);
  assert.equal(result.decision, "block");
  assert.match(result.reason, /Dely sync required.*SOURCE_NOT_PUBLISHED/);
  assert.equal(f.updater.plan(f.syncOptions).status, "SOURCE_NOT_PUBLISHED");
  assert.deepEqual(guard.hook(stop, f.home), {}); // An honest blocked report is still possible.
  fs.writeFileSync(readme, before);
  assert.deepEqual(guard.hook(f.event, f.home), {});
  assert.deepEqual(guard.hook(stop, f.home), {});
});

test("source sync checks the other registered home before completion", async (t) => {
  const f = await sourceSyncFixture(t);
  fs.appendFileSync(path.join(f.homes[1], "dely-compliance/guide.md"), "stale installed guide");
  const result = guard.hook({ ...f.event, hook_event_name: "Stop" }, f.home);
  assert.equal(result.decision, "block");
  assert.match(result.reason, /Dely sync required.*BINDING_DRIFT/);
});

test("source sync refuses an updater without an installed dependency pin", async (t) => {
  const f = await sourceSyncFixture(t), file = guard.settingsFile(f.home);
  const settings = JSON.parse(fs.readFileSync(file));
  delete settings.dependencies[settings.updater];
  fs.writeFileSync(file, JSON.stringify(settings));
  const result = guard.hook({ ...f.event, hook_event_name: "Stop" }, f.home);
  assert.equal(result.decision, "block");
  assert.match(result.reason, /Dely sync required.*updater is not pinned/);
});

test("source sync never executes a source-authored updater at the trusted Stop seam", async (t) => {
  const f = await sourceSyncFixture(t), file = guard.settingsFile(f.home);
  const settings = JSON.parse(fs.readFileSync(file));
  const marker = path.join(f.repo, "updater-executed");
  settings.updater = path.join(f.repo, "scripts/sync-dely.js");
  fs.writeFileSync(settings.updater, 'require("fs").writeFileSync(' + JSON.stringify(marker) + ', "unsafe");');
  settings.dependencies[settings.updater] = require("crypto").createHash("sha256").update(fs.readFileSync(settings.updater)).digest("hex");
  fs.writeFileSync(file, JSON.stringify(settings));
  const result = guard.hook({ ...f.event, hook_event_name: "Stop" }, f.home);
  assert.equal(result.decision, "block");
  assert.match(result.reason, /Dely sync required.*updater is not pinned/);
  assert.equal(fs.existsSync(marker), false);
});

for (const kind of ["missing", "invalid", "wrong homes"]) {
  test("source sync detects " + kind + " source registration", async (t) => {
    const f = await sourceSyncFixture(t), file = path.join(f.home, "dely-compliance/current-source.json");
    if (kind === "missing") fs.unlinkSync(file);
    else if (kind === "invalid") fs.writeFileSync(file, "invalid json");
    else {
      const registration = JSON.parse(fs.readFileSync(file));
      registration.homes = [f.home];
      fs.writeFileSync(file, JSON.stringify(registration));
    }
    const result = guard.hook({ ...f.event, hook_event_name: "Stop" }, f.home);
    assert.equal(result.decision, "block");
    assert.match(result.reason, /Dely sync required.*BINDING_DRIFT/);
  });
}

test("source sync leaves verified workers and read-only turns available", async (t) => {
  const f = await sourceSyncFixture(t);
  fs.appendFileSync(path.join(f.repo, "README.md"), "\nSource still awaiting review and sync.\n");
  const stop = { ...f.event, hook_event_name: "Stop" };
  assert.deepEqual(guard.hook(stop, f.home, () => true), {});
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Inspect status only." }, f.home);
  assert.deepEqual(guard.hook(stop, f.home), {});
});

test("source sync does not block completion in unrelated consumer repositories", async (t) => {
  const f = await sourceSyncFixture(t), repo = path.join(path.dirname(f.repo), "consumer");
  fs.mkdirSync(repo);
  fs.appendFileSync(path.join(f.repo, "README.md"), "\nUnpublished Dely source.\n");
  const options = { ...f.options, repo, session: "consumer-session" };
  await guard.prepare(options, f.home);
  guard.review({ ...options, difficulty: "hard", skills: '["required"]',
    reason: "Unrelated consumer change retains its own admission", "skill-reason": "Retain its mandatory skill" }, f.home);
  const event = { ...f.event, cwd: repo, session_id: options.session };
  assert.deepEqual(guard.hook(event, f.home), {});
  assert.deepEqual(guard.hook({ ...event, hook_event_name: "Stop" }, f.home), {});
  const file = guard.settingsFile(f.home), settings = JSON.parse(fs.readFileSync(file));
  settings.sync_source = path.join(path.dirname(f.repo), "unavailable-source");
  fs.writeFileSync(file, JSON.stringify(settings));
  assert.deepEqual(guard.hook({ ...event, hook_event_name: "Stop" }, f.home), {});
});

async function correctionFixture(t) {
  const f = fixture(t);
  f.task.context.risks.routing = false;
  const routing = require(routingPath), assess = routing.assess;
  t.after(() => { routing.assess = assess; });
  routing.assess = (task) => assess(task, { apiKey: "fixture", fetch: async () => ({ ok: true,
    json: async () => ({ model: routing.MODEL, answers: Object.fromEntries(routing.DIMENSIONS.map((name) => {
      const choice = name === "verification" ? "medium_plus" : "medium_minus";
      return [name, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(
        ["easy", "medium_minus", "medium_plus", "hard", "insufficient_evidence"].map((label) => [label, Number(label === choice)])) }];
    })) }) }) });
  const prepared = await f.prepare();
  const proof = { schema_version: 1, assessment_basis_sha256: prepared.assessment.assessment_basis_sha256,
    dimension: "verification", reason_code: "verification_instrument_available",
    explanation: "The known source and focused detector cover one internal adjustment without a new oracle.",
    evidence_refs: [{ source: "context", field: "acceptance" }], acceptance: { method: "fixture_check",
      procedure: "Run the known focused detector with the confirmed fixture", expected_result: "The fixture matches the scoped requirement",
      would_fail_if: "The prior wrong branch returns a different fixture result" } };
  return { ...f, prepared, proof, routing };
}

test("production-only routing still requires native review and bound Dely dispatch", async (t) => {
  const f = fixture(t), routing = require(routingPath), assess = routing.assess;
  let requests = 0;
  f.task.context.risks.routing = false;
  f.task.context.risks.production = true;
  t.after(() => { routing.assess = assess; });
  routing.assess = (task) => assess(task, { apiKey: "fixture", fetch: async () => {
    requests++;
    return { ok: true, json: async () => ({ model: routing.MODEL,
      answers: Object.fromEntries(routing.DIMENSIONS.map((name) => [name, {
        type: "choice", choice: "medium_plus", confidence: 1,
        probabilities: Object.fromEntries(["easy", "medium_minus", "medium_plus", "hard", "insufficient_evidence"]
          .map((label) => [label, Number(label === "medium_plus")])) }])) }) };
  } });
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Production context with no Hard effect" }, f.home);
  const prepared = await f.prepare();
  assert.equal(requests, 1);
  assert.equal(prepared.assessment.difficulty, "medium_plus");
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  assert.throws(() => f.review({ difficulty: "medium_plus", skills: '["required","dely:delivery"]' }), /Run/);
  f.review({ difficulty: "medium_plus", run: "production_context_run", skills: '["required","dely:delivery"]' });
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  const route = { event: "task_route", run: state.run, repo: f.repo, policy: state.assessment.policy,
    specSha256: state.assessment.task.spec_sha256, contextSha256: state.assessment.task.context_sha256,
    assessmentBasisSha256: state.assessment.assessment_basis_sha256, difficulty: "medium_plus",
    correctionSha256: null, reviewSource: state.assessment.review.source };
  const dispatch = { event: "dispatch", run: state.run, repo: f.repo, phase: "implement",
    promptSha256: route.specSha256, contextSha256: route.contextSha256,
    assessmentBasisSha256: route.assessmentBasisSha256, correctionSha256: null,
    launch: { effective: { agent: "codex", model: "gpt-6.1-sol", effort: "medium" } }, dispatchId: "production_context_dispatch" };
  fs.writeFileSync(f.settings.journal, [route, dispatch].map((row) => JSON.stringify(row)).join("\n") + "\n");
  assert.deepEqual(guard.hook(f.event, f.home), {});
});

test("reviewed Control can stage only its exact new Run spec before dispatch", async (t) => {
  const f = await correctionFixture(t);
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Stage the confirmed Run spec" }, f.home);
  await f.prepare();
  f.review({ difficulty: "medium_plus", run: "staging_run", skills: '["required","dely:delivery"]' });
  const target = path.join(f.repo, ".dely/local/runs/staging_run/spec.md");
  const stage = (file = target, body = f.task.spec) => ({ ...f.event, tool_input:
    "*** Begin Patch\n*** Add File: " + file + "\n" + body.trimEnd().split("\n").map((line) => "+" + line).join("\n") + "\n*** End Patch" });
  assert.deepEqual(guard.hook(stage(), f.home), {}, "exact reviewed Run spec must stage before a dispatch exists");
  const denied = (event) => assert.equal(guard.hook(event, f.home).hookSpecificOutput?.permissionDecision, "deny");
  denied(f.event);
  denied(stage(target, "Different executable instructions.\n"));
  denied(stage(path.join(f.repo, ".dely/local/runs/other/spec.md")));
  denied(stage(path.join(f.repo, "source.js")));
  denied({ ...stage(), turn_id: "other" });
  denied({ ...stage(), session_id: "other" });
  denied({ ...stage(), model: "different-model" });
  denied({ ...stage(), tool_input: stage().tool_input.replace("*** End Patch", "*** Add File: extra.md\n+extra\n*** End Patch") });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, f.task.spec);
  denied(stage());
  fs.unlinkSync(target);
  const runDirectory = path.dirname(target), outside = path.join(path.dirname(f.repo), "outside-run");
  fs.mkdirSync(outside);
  fs.rmdirSync(runDirectory);
  fs.symlinkSync(outside, runDirectory, process.platform === "win32" ? "junction" : "dir");
  denied(stage());
  fs.unlinkSync(runDirectory);
  fs.mkdirSync(runDirectory);
  const stateFile = guard.stateFile(f.home, "session"), state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  for (const change of [ { status: "PREPARED" }, { worker_claim: { receipts: ["rcpt_0123456789abcdef"] } } ]) {
    fs.writeFileSync(stateFile, JSON.stringify({ ...state, ...change })); denied(stage());
  }
  fs.writeFileSync(stateFile, JSON.stringify(state));
  fs.appendFileSync(f.skill, "Changed selected policy.\n");
  denied(stage());
  fs.writeFileSync(f.skill, "Read the actual source before editing.\n");
  fs.appendFileSync(path.join(f.repo, "AGENTS.md"), "Changed authority.\n");
  denied(stage());
});

test("confirmed continuation preserves the dispatch basis and requires fresh Control review", async (t) => {
  const f = fixture(t), routing = require(routingPath), assess = routing.assess;
  let requests = 0;
  t.after(() => { routing.assess = assess; });
  routing.assess = (task) => assess(task, { apiKey: "fixture", fetch: async () => {
    requests++;
    return { ok: true, json: async () => ({ model: routing.MODEL,
      answers: Object.fromEntries(routing.DIMENSIONS.map((name) => [name, {
        type: "choice", choice: "medium_plus", confidence: 1,
        probabilities: Object.fromEntries(["easy", "medium_minus", "medium_plus", "hard", "insufficient_evidence"]
          .map((label) => [label, Number(label === "medium_plus")])) }])) }) };
  } });
  f.task.context.risks.routing = false;
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Implement the confirmed task" }, f.home);
  await f.prepare();
  f.review({ difficulty: "medium_plus", run: "continuation_run", skills: '["required","dely:delivery"]' });
  const prior = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  const original = fs.readFileSync(prior.original_assessment, "utf8");
  const approved = fs.readFileSync(path.join(path.dirname(prior.skill_input), "reviewed.json"), "utf8");
  const route = { event: "task_route", run: prior.run, repo: f.repo, policy: prior.assessment.policy,
    specSha256: prior.assessment.task.spec_sha256, contextSha256: prior.assessment.task.context_sha256,
    assessmentBasisSha256: prior.assessment.assessment_basis_sha256, difficulty: "medium_plus",
    correctionSha256: null, reviewSource: prior.assessment.review.source };
  const dispatch = { event: "dispatch", run: prior.run, repo: f.repo, phase: "implement",
    promptSha256: route.specSha256, contextSha256: route.contextSha256,
    assessmentBasisSha256: route.assessmentBasisSha256, correctionSha256: null,
    launch: { effective: { agent: "codex", model: "gpt-6.1-sol", effort: "medium" } }, dispatchId: "continued_dispatch" };
  fs.appendFileSync(f.settings.journal, [route, dispatch].map((row) => JSON.stringify(row)).join("\n") + "\n");
  const next = { ...f.event, turn_id: "continuation_turn" };
  guard.hook({ ...next, hook_event_name: "UserPromptSubmit", prompt: "Continue the same Run after worker completion" }, f.home);
  assert.equal(guard.hook(next, f.home).hookSpecificOutput.permissionDecision, "deny");
  fs.writeFileSync(f.settings.journal, JSON.stringify(route) + "\n");
  await assert.rejects(() => guard.prepare({ ...f.options, turn: next.turn_id, continue: true,
    run: prior.run, "task-json": JSON.stringify(f.task) }, f.home), /matching dispatch/);
  fs.appendFileSync(f.settings.journal, JSON.stringify(dispatch) + "\n");
  const prepared = await guard.prepare({ ...f.options, turn: next.turn_id, continue: true,
    run: prior.run, "task-json": JSON.stringify(f.task) }, f.home);
  assert.equal(prepared.assessment.assessment_basis_sha256, route.assessmentBasisSha256,
    "a continuation must retain the dispatched frozen basis");
  assert.equal(requests, 1, "continuation must not repeat the Jev provider request");
  assert.equal(guard.hook(next, f.home).hookSpecificOutput.permissionDecision, "deny");
  assert.throws(() => f.review({ turn: next.turn_id, difficulty: "hard", run: prior.run,
    skills: '["required","dely:delivery"]' }), /original route/);
  f.review({ turn: next.turn_id, difficulty: "medium_plus", run: prior.run, skills: '["required","dely:delivery"]' });
  assert.deepEqual(guard.hook(next, f.home), {});
  assert.equal(fs.readFileSync(prior.original_assessment, "utf8"), original);
  assert.equal(fs.readFileSync(path.join(path.dirname(prior.skill_input), "reviewed.json"), "utf8"), approved);
});

test("continuation rejects changed inputs, authority and immutable proof", async (t) => {
  const cases = [
    ["spec", (f) => { f.task.spec += "Different work.\n"; }],
    ["context", (f) => { f.task.context.acceptance = "Different acceptance"; }],
    ["roster", (f) => { f.task.skills[0].description = "Different workflow"; }],
    ["mandatory skills", (f) => { f.task.required_skills = []; }],
    ["instructions", (f) => { fs.appendFileSync(path.join(f.repo, "AGENTS.md"), "Changed authority.\n"); }],
    ["skill body", (f) => { fs.appendFileSync(f.skill, "Changed workflow.\n"); }],
    ["original evidence", (f, prior) => { fs.appendFileSync(prior.original_assessment, " "); }],
    ["checkpoint", (f, prior) => { fs.appendFileSync(prior.continuation_checkpoint.file, " "); }],
    ["settings", (f) => { const s = { ...f.settings, journal: path.join(f.home, "different.jsonl") };
      fs.writeFileSync(guard.settingsFile(f.home), JSON.stringify(s)); }],
    ["foreign model", () => {}, { model: "different-model" }],
    ["worker claim", () => {}, { prompt: "receipt rcpt_0000000000000000" }],
    ["foreign Run", () => {}, { run: "different_run" }],
    ["foreign session", () => {}, { session: "different_session" }],
    ["reserved native metadata", (f) => { f.task.native_continuation = { file: "forged", sha256: "0".repeat(64) }; }],
    ["foreign terminal", (f, prior, sub) => {
      const old = process.env.ORCA_TERMINAL_HANDLE;
      process.env.ORCA_TERMINAL_HANDLE = "different_terminal";
      sub.after(() => { if (old === undefined) delete process.env.ORCA_TERMINAL_HANDLE;
        else process.env.ORCA_TERMINAL_HANDLE = old; });
    }],
  ];
  for (const [name, change, extra = {}] of cases) await t.test(name, async (sub) => {
    const f = fixture(sub);
    guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Implement the task" }, f.home);
    await f.prepare(); f.review();
    const prior = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
    change(f, prior, sub);
    const next = { ...f.event, turn_id: "continued", model: extra.model || f.event.model };
    guard.hook({ ...next, hook_event_name: "UserPromptSubmit", prompt: extra.prompt || "Continue unchanged" }, f.home);
    await assert.rejects(() => guard.prepare({ ...f.options, turn: next.turn_id,
      continue: true, ...extra, "task-json": JSON.stringify(f.task) }, f.home), /continuation|changed|checkpoint/i);
    assert.equal(guard.hook(next, f.home).hookSpecificOutput.permissionDecision, "deny");
  });
});

test("advice-only approval does not advertise an execution continuation", async (t) => {
  const f = fixture(t);
  f.task.mode = "advice";
  await f.prepare();
  f.review();
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  assert.equal(state.continuation_checkpoint, undefined);
});

test("continuation metadata cannot be erased before its fresh review", async (t) => {
  const f = fixture(t);
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Implement the task" }, f.home);
  await f.prepare(); f.review();
  guard.hook({ ...f.event, turn_id: "next", hook_event_name: "UserPromptSubmit", prompt: "Continue the task" }, f.home);
  await guard.prepare({ ...f.options, turn: "next", continue: true, "task-json": JSON.stringify(f.task) }, f.home);
  const file = guard.stateFile(f.home, "session"), state = JSON.parse(fs.readFileSync(file, "utf8"));
  delete state.continuation;
  fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(() => f.review({ turn: "next" }), /continuation/i);
});

test("a fresh prompt safely resets an unreadable prior continuation state", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(guard.stateFile(f.home, "session")), { recursive: true });
  for (const prior of ["{", "null", "[]", '"unusable"']) {
    fs.writeFileSync(guard.stateFile(f.home, "session"), prior);
    guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Start a fresh confirmed task" }, f.home);
    const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
    assert.equal(state.status, "PENDING");
    assert.equal(state.continuation_checkpoint, undefined);
    assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  }
});

test("native continuation CLI retains direct Hard evidence and normal prepare stays fresh", async (t) => {
  const f = fixture(t);
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Implement the task" }, f.home);
  await f.prepare(); f.review();
  const original = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  const next = { ...f.event, turn_id: "next" };
  const guidance = guard.hook({ ...next, hook_event_name: "UserPromptSubmit", prompt: "Continue the task" }, f.home);
  assert.match(guidance.hookSpecificOutput.additionalContext, /--continue/);
  const result = spawnSync(process.execPath, [path.join(f.home, "dely-compliance/codex-compliance.js"), "prepare",
    "--home", f.home, "--repo", f.repo, "--session", "session", "--turn", "next", "--continue",
    "--task-json", JSON.stringify(f.task)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const prepared = JSON.parse(result.stdout);
  assert.equal(prepared.continuation, true);
  assert.equal(prepared.assessment.assessment_basis_sha256, original.assessment.assessment_basis_sha256);
  f.review({ turn: "next" });
  assert.deepEqual(guard.hook(next, f.home), {});
  const admitted = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  delete admitted.continuation_source;
  fs.writeFileSync(guard.stateFile(f.home, "session"), JSON.stringify(admitted));
  assert.equal(guard.hook(next, f.home).hookSpecificOutput.permissionDecision, "deny");
  guard.hook({ ...f.event, turn_id: "fresh", hook_event_name: "UserPromptSubmit", prompt: "A new confirmed task" }, f.home);
  const fresh = await guard.prepare({ ...f.options, turn: "fresh", "task-json": JSON.stringify(f.task) }, f.home);
  assert.equal(fresh.continuation, false);
  assert.notEqual(fresh.assessment.assessment_basis_sha256, original.assessment.assessment_basis_sha256);
});

test("continuation retains candidate ownership when the offered target changes", async (t) => {
  const f = candidateFixture(t);
  await f.prepare(); f.review();
  guard.hook({ ...f.event, turn_id: "next", hook_event_name: "UserPromptSubmit", prompt: "Continue" }, f.home);
  f.task.execution_repo = f.repo;
  await assert.rejects(() => guard.prepare({ ...f.options, turn: "next", continue: true,
    "task-json": JSON.stringify(f.task) }, f.home), /continuation owner, target/i);
});

test("continuation retains the original correction proof and never invents a low-tier approval", async (t) => {
  const f = await correctionFixture(t);
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Implement the task" }, f.home);
  const prepared = await f.prepare();
  const proof = { ...f.proof, assessment_basis_sha256: prepared.assessment.assessment_basis_sha256 };
  const review = { difficulty: "medium_minus", run: "corrected_continuation", skills: '["required","dely:delivery"]',
    "review-evidence-json": JSON.stringify(proof) };
  f.review(review);
  const prior = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  const route = { event: "task_route", run: prior.run, repo: f.repo, policy: prior.assessment.policy,
    specSha256: prior.assessment.task.spec_sha256, contextSha256: prior.assessment.task.context_sha256,
    assessmentBasisSha256: prior.assessment.assessment_basis_sha256, difficulty: "medium_minus",
    correctionSha256: prior.assessment.review.correction_sha256, reviewSource: prior.assessment.review.source };
  const dispatch = { event: "dispatch", run: prior.run, repo: f.repo, phase: "implement", promptSha256: route.specSha256,
    contextSha256: route.contextSha256, assessmentBasisSha256: route.assessmentBasisSha256,
    correctionSha256: route.correctionSha256, dispatchId: "corrected_dispatch",
    launch: { effective: { agent: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" } } };
  fs.appendFileSync(f.settings.journal, [route, dispatch].map((row) => JSON.stringify(row)).join("\n") + "\n");
  const next = { ...f.event, turn_id: "next" };
  guard.hook({ ...next, hook_event_name: "UserPromptSubmit", prompt: "Continue the corrected task" }, f.home);
  await guard.prepare({ ...f.options, turn: "next", continue: true, run: prior.run,
    "task-json": JSON.stringify(f.task) }, f.home);
  assert.throws(() => f.review({ ...review, turn: "next", "review-evidence-json": undefined }), /correction|proof/i);
  f.review({ ...review, turn: "next" });
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  assert.equal(state.assessment.assessment_basis_sha256, route.assessmentBasisSha256);
  assert.equal(state.assessment.review.correction_sha256, route.correctionSha256);
  assert.deepEqual(guard.hook(next, f.home), {});
});

test("case32/case33 native CLI persists proof through preflight, dispatch, Control gate and worker admission", async (t) => {
  const f = await correctionFixture(t);
  const run = "v4_native_" + guard.digest(f.repo).slice(0, 12);
  const native = path.join(f.home, "dely-compliance/codex-compliance.js");
  const reviewed = spawnSync(process.execPath, [native, "review", "--home", f.home,
    "--session", "session", "--turn", "turn", "--difficulty", "medium_minus", "--reason", "Control checked the frozen focused detector",
    "--skills", '["required","dely:delivery"]', "--skill-reason", "Required source and delivery skills", "--run", run,
    "--review-evidence-json", JSON.stringify(f.proof)], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
  assert.equal(reviewed.status, 0, reviewed.stderr);
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  const original = fs.readFileSync(state.original_assessment, "utf8");
  assert.equal(state.assessment.review.source, "control-override-justified");
  const assessmentFile = path.join(path.dirname(state.skill_input), "reviewed.json");
  const flags = { repo: f.repo, run, "spec-file": state.assessment.task.spec_file, "assessment-file": assessmentFile };
  const helper = f.settings.dely, source = fs.readFileSync(helper, "utf8");
  const marker = source.indexOf("const [cmd, ...rest] = process.argv.slice(2);");
  assert.ok(marker > 0);
  const exit = {}, starts = [];
  const context = vm.createContext({ require: createRequire(helper), __dirname: path.dirname(helper), __filename: helper,
    Buffer, TextDecoder, console: { log: () => {} }, process: { platform: "win32", env: { DELY_POLL_S: "0.001" }, exit: (code) => { exit.code = code; throw exit; } } });
  vm.runInContext(source.slice(0, marker), context, { filename: helper });
  context.requireHandle = () => {};
  context.restoreControlFocus = () => {};
  context.recordOwnedSnapshot = () => {};
  context.pin = (_, phase) => phase === "implement_backup_2" ? { agent: "codex", model: "gpt-6-luna", effort: "max" } :
    { agent: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" };
  let receipt = "ack";
  context.start = (_, __, pin, spec) => {
    starts.push(pin);
    const staged = spec.match(/Read the full task spec from (\S+)/);
    const delivered = staged ? fs.readFileSync(path.join(f.repo, staged[1]), "utf8") : spec;
    receipt = delivered.match(/rcpt_[a-f0-9]{16}/)?.[0] || "ack";
    return { id: "ctx_native_v4", terminalHandle: "term_native_v4", launch: { modelEvidence: {
      session: "worker-v4", turn: "worker-turn", model: pin.model, effort: pin.effort } } };
  };
  context.logEvent = (event, fields) => fs.appendFileSync(f.settings.journal, JSON.stringify({ event, ...fields }) + "\n");
  context.orca = () => ({ result: { deliveryId: "fixture-delivery", messages: [
    { type: "heartbeat", subject: receipt, dispatchId: "ctx_native_v4", from_handle: "term_native_v4" },
    { type: "worker_done", dispatchId: "ctx_native_v4", payload: { outcome: "succeeded" } } ] } });
  context.releaseWorker = () => ({ state: "released" });
  assert.throws(() => context.preflight(flags), (e) => e === exit);
  assert.equal(exit.code, 0);
  assert.equal(starts[0].model, "gemini-3.8-flash-medium");
  assert.throws(() => context.dispatch({ ...flags, phase: "implement", fallback: "quota" }), (e) => e === exit);
  assert.equal(exit.code, 0);
  assert.equal(starts[1].model, "gpt-6-luna");
  const inventory = path.join(os.tmpdir(), "dely-run-" + run + ".jsonl");
  assert.equal(fs.existsSync(inventory), false);
  fs.writeFileSync(inventory, JSON.stringify({ owned: true, terminalHandle: "term_native_v4", dispatchId: "ctx_native_v4" }) + "\n");
  t.after(() => fs.unlinkSync(inventory));
  const accepted = fs.readFileSync(guard.stateFile(f.home, "session"), "utf8");
  for (let i = 0; i < 2; i++) assert.deepEqual(guard.hook(f.event, f.home), {});
  const worker = { ...f.event, session_id: "worker-v4", turn_id: "worker-turn", model: "gpt-6-luna" };
  const previousHandle = process.env.ORCA_TERMINAL_HANDLE;
  process.env.ORCA_TERMINAL_HANDLE = "term_native_v4";
  t.after(() => {
    if (previousHandle === undefined) delete process.env.ORCA_TERMINAL_HANDLE;
    else process.env.ORCA_TERMINAL_HANDLE = previousHandle;
  });
  guard.hook({ ...worker, hook_event_name: "UserPromptSubmit", prompt: "Read task; receipt " + receipt }, f.home);
  assert.match(guard.hook(worker, f.home).hookSpecificOutput.additionalContext, /inherited admission checks passed/);
  const rows = guard.logRecords(f.settings.journal);
  const route = rows.findLast((r) => r.event === "task_route");
  assert.equal(route.correctionSha256, state.assessment.review.correction_sha256);
  assert.equal(route.assessmentBasisSha256, state.assessment.assessment_basis_sha256);
  assert.equal(fs.readFileSync(state.original_assessment, "utf8"), original);
  const checked = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  assert.equal(checked.assessment.review.reviewed_at, JSON.parse(accepted).assessment.review.reviewed_at);
  fs.writeFileSync(path.join(f.repo, "implementation.js"), "changed code is not immutable evidence\n");
  assert.deepEqual(guard.hook(f.event, f.home), {});
});

for (const phase of ["review", "gate"]) {
  test("case21/case25 native " + phase + " cannot erase a high original Jev evaluation", async (t) => {
    const f = await correctionFixture(t);
    if (phase === "gate") f.review({ difficulty: "medium_plus", skills: '["required","dely:delivery"]', run: "raw-preserved" });
    const stateFile = guard.stateFile(f.home, "session"), state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const erased = await f.routing.assess(f.prepared.assessment.task, { apiKey: "" });
    // Use a self-consistent replacement with recomputed basis; the frozen original still vetoes it.
    erased.jev = null; erased.advisor_state = "NOT_EVALUATED"; erased.jev_difficulty = null; erased.correction_candidate = null;
    erased.assessment_basis_sha256 = guard.digest(f.routing.canonicalJson(f.routing.deriveAssessmentBasis(erased)));
    state.assessment = phase === "review" ? erased : f.routing.review(erased, "medium_plus", "Pretend unavailable");
    fs.writeFileSync(stateFile, JSON.stringify(state));
    if (phase === "review") assert.throws(f.review, /frozen original/);
    else assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  });
}

test("case22/case34/case35 native review retains immutable artifacts and rejects stale identity and policy", async (t) => {
  const f = await correctionFixture(t);
  assert.throws(() => guard.review({ ...f.options, turn: "wrong", difficulty: "medium_minus", reason: "wrong turn",
    "skill-reason": "required", skills: '["required","dely:delivery"]', run: "wrong-turn",
    "review-evidence-json": JSON.stringify(f.proof) }, f.home), /Prepare this turn/);
  f.review({ difficulty: "medium_minus", skills: '["required","dely:delivery"]', run: "immutable-proof",
    "review-evidence-json": JSON.stringify(f.proof) });
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  const artifact = path.join(path.dirname(state.skill_input), "reviewed.json");
  assert.ok(state.fingerprints[artifact]);
  const old = structuredClone(state.assessment); old.policy = "jev-task-routing-v3";
  const before = JSON.stringify(old);
  assert.throws(() => f.routing.validateApprovedAssessment(old), /unsupported/);
  assert.equal(JSON.stringify(old), before);
  fs.appendFileSync(artifact, " ");
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("explicit candidate assessment retains the immutable Control prompt origin", async (t) => {
  const f = candidateFixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.assessment.task.repo, fs.realpathSync(f.candidate));
  f.review();
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  assert.equal(state.repo, fs.realpathSync(f.repo));
  assert.equal(state.execution_repo, fs.realpathSync(f.candidate));
  assert.deepEqual(guard.hook(f.event, f.home), {});
  assert.equal(guard.hook({ ...f.event, cwd: f.candidate }, f.home).hookSpecificOutput.permissionDecision, "deny");
  await assert.rejects(() => guard.prepare({ ...f.options, repo: f.candidate,
    "task-json": JSON.stringify(f.task) }, f.home), /prompt changed/i);
});

test("candidate Dely evidence must match the reviewed target and both exact hashes", async (t) => {
  const f = candidateFixture(t);
  f.task.context.risks.routing = false;
  const routing = require(routingPath), assess = routing.assess;
  t.after(() => { routing.assess = assess; });
  routing.assess = (task, options) => assess(task, { ...options, apiKey: "" });
  await f.prepare();
  f.review({ difficulty: "medium_plus", run: "fixture_run", skills: '["required","dely:delivery"]' });
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  const route = { event: "task_route", run: state.run, repo: f.candidate,
    specSha256: state.assessment.task.spec_sha256, contextSha256: state.assessment.task.context_sha256,
    policy: state.assessment.policy, assessmentBasisSha256: state.assessment.assessment_basis_sha256,
    correctionSha256: null, reviewSource: state.assessment.review.source,
    difficulty: "medium_plus" };
  const dispatch = { event: "dispatch", run: state.run, repo: f.candidate, phase: "implement",
    assessmentBasisSha256: route.assessmentBasisSha256, contextSha256: route.contextSha256, correctionSha256: null,
    launch: { effective: { agent: "codex", model: "gpt-6.1-sol", effort: "medium" } },
    promptSha256: route.specSha256, dispatchId: "fixture_dispatch" };
  for (const wrong of [
    [{ ...route, repo: f.repo }, { ...dispatch, repo: f.repo }],
    [{ ...route, contextSha256: "wrong" }, dispatch],
    [route, { ...dispatch, promptSha256: "wrong" }],
  ]) {
    fs.writeFileSync(f.settings.journal, wrong.map((row) => JSON.stringify(row)).join("\n") + "\n");
    assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  }
  fs.writeFileSync(f.settings.journal, [route, dispatch].map((row) => JSON.stringify(row)).join("\n") + "\n");
  assert.deepEqual(guard.hook(f.event, f.home), {});
});

for (const phase of ["review", "mutation"]) {
  test("candidate instructions changed before " + phase + " invalidate admission", async (t) => {
    const f = candidateFixture(t);
    await f.prepare();
    if (phase === "mutation") f.review();
    fs.appendFileSync(path.join(f.candidate, "AGENTS.md"), "New candidate restriction.\n");
    if (phase === "review") assert.throws(f.review, /instructions changed/i);
    else assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  });
}

for (const kind of ["relative", "missing", "unrelated", "file", "null"]) {
  test("explicit execution target rejects " + kind + " destinations", async (t) => {
    const f = candidateFixture(t);
    if (kind === "relative") f.task.execution_repo = "candidate";
    if (kind === "missing") f.task.execution_repo = path.join(f.repo, "missing");
    if (kind === "unrelated") {
      f.task.execution_repo = path.join(path.dirname(f.repo), "unrelated");
      fs.mkdirSync(f.task.execution_repo);
      f.git("init", "--quiet", f.task.execution_repo);
    }
    if (kind === "file") f.task.execution_repo = f.skill;
    if (kind === "null") f.task.execution_repo = null;
    await assert.rejects(f.prepare);
  });
}

test("retargeting a reviewed candidate alias with identical instructions is denied", async (t) => {
  const f = candidateFixture(t);
  const alias = path.join(path.dirname(f.repo), "candidate-alias");
  fs.symlinkSync(f.candidate, alias, "junction");
  f.task.execution_repo = alias;
  await f.prepare();
  f.review();
  const other = path.join(path.dirname(f.repo), "other-candidate");
  f.git("-C", f.repo, "worktree", "add", "--quiet", "--detach", other, "HEAD");
  fs.copyFileSync(path.join(f.candidate, "AGENTS.md"), path.join(other, "AGENTS.md"));
  fs.unlinkSync(alias);
  fs.symlinkSync(other, alias, "junction");
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

for (const field of ["execution_repo", "execution_repo_path"]) {
  test("removing prepared " + field + " cannot fall back to the Control repository", async (t) => {
    const f = candidateFixture(t);
    await f.prepare();
    f.review();
    const file = guard.stateFile(f.home, "session"), state = JSON.parse(fs.readFileSync(file, "utf8"));
    delete state[field];
    fs.writeFileSync(file, JSON.stringify(state));
    assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  });
}

for (const phase of ["assessment", "review"]) {
  test("same-turn prompt reset during " + phase + " cannot restore stale authority", async (t) => {
    const f = fixture(t);
    const reset = () => guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "New request" }, f.home);
    reset();
    if (phase === "assessment") {
      const routing = require(routingPath), assess = routing.assess;
      t.after(() => { routing.assess = assess; });
      routing.assess = async (...args) => { const result = await assess(...args); reset(); return result; };
      await assert.rejects(f.prepare, /prompt changed/i);
    } else {
      await f.prepare();
      const mock = require(f.settings.advisor), combine = mock.combineSkills;
      mock.combineSkills = (...args) => { const result = combine(...args); reset(); return result; };
      assert.throws(f.review, /prompt changed/i);
    }
    const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
    assert.equal(state.status, "PENDING");
    assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  });
}

test("independent prompt marker rejects stale reviewed state restored after steering", async (t) => {
  const f = fixture(t);
  const reset = () => guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit" }, f.home);
  reset();
  await f.prepare();
  f.review();
  const file = guard.stateFile(f.home, "session"), stale = fs.readFileSync(file);
  reset();
  fs.writeFileSync(file, stale);
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});


test("same-turn steering allocates a fresh task input without overwriting prior evidence", (t) => {
  const f = fixture(t);
  const prompt = { ...f.event, hook_event_name: "UserPromptSubmit" };
  guard.hook(prompt, f.home);
  const current = () => JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  const first = guard.inputFile(f.home, "session", "turn", current().input_nonce);
  fs.mkdirSync(path.dirname(first), { recursive: true });
  fs.writeFileSync(first, JSON.stringify(f.task));
  guard.hook(prompt, f.home);
  const second = guard.inputFile(f.home, "session", "turn", current().input_nonce);
  assert.notEqual(second, first);
  const patch = file => "*** Begin Patch\n*** Add File: " + file + "\n+" + JSON.stringify(f.task) + "\n*** End Patch";
  assert.deepEqual(guard.hook({ ...f.event, tool_input: { input: patch(second) } }, f.home), {});
  assert.equal(guard.hook({ ...f.event, tool_input: { input: patch(first) } }, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("required alias drift during grouping cannot omit its prepared source snapshot", async (t) => {
  const f = fixture(t);
  const alias = path.join(f.repo, "grouping-alias"), replacement = path.join(f.repo, "grouping-replacement");
  fs.mkdirSync(replacement);
  fs.copyFileSync(f.skill, path.join(replacement, "SKILL.md"));
  fs.symlinkSync(path.dirname(f.skill), alias, "junction");
  const source = path.join(alias, "SKILL.md");
  f.task.skills[0].path = source;
  const mock = require(f.settings.advisor), key = mock.skillKey;
  let changed = false;
  mock.skillKey = file => {
    const result = key(file);
    if (file === source && !changed) {
      changed = true;
      if (process.platform === "win32") fs.rmdirSync(alias);
      else fs.unlinkSync(alias);
      fs.symlinkSync(replacement, alias, "junction");
    }
    return result;
  };
  await assert.rejects(f.prepare, /changed/);
});


test("an unselected disabled alias cannot retarget into a selected source", async (t) => {
  const f = fixture(t);
  const other = path.join(f.repo, "other-source");
  const alias = path.join(f.repo, "unused-alias");
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, "SKILL.md"), "Unrelated disabled source.");
  fs.symlinkSync(other, alias, "junction");
  f.task.skills.push({ name: "unused-alias", path: path.join(alias, "SKILL.md"),
    description: "An unrelated alias", enabled: false });
  await f.prepare();
  f.review();
  if (process.platform === "win32") fs.rmdirSync(alias);
  else fs.unlinkSync(alias);
  fs.symlinkSync(path.dirname(f.skill), alias, "junction");
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

for (const kind of ["body", "alias"]) {
  test("a required " + kind + " cannot be rebound after prepared validation", async (t) => {
    const f = fixture(t);
    let alias, replacement;
    if (kind === "alias") {
      alias = path.join(f.repo, "required-alias");
      replacement = path.join(f.repo, "replacement");
      fs.mkdirSync(replacement);
      fs.copyFileSync(f.skill, path.join(replacement, "SKILL.md"));
      fs.symlinkSync(path.dirname(f.skill), alias, "junction");
      f.task.skills[0].path = path.join(alias, "SKILL.md");
    }
    await f.prepare();
    const mock = require(f.settings.advisor);
    const skillKey = mock.skillKey;
    let changed = false;
    mock.skillKey = (file) => {
      if (!changed) {
        changed = true;
        if (kind === "body") fs.appendFileSync(f.skill, " Changed after prepared validation.");
        else {
          if (process.platform === "win32") fs.rmdirSync(alias);
          else fs.unlinkSync(alias);
          fs.symlinkSync(replacement, alias, "junction");
        }
      }
      return skillKey(file);
    };
    assert.throws(f.review, /changed/);
    assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  });
}


for (const kind of ["http", "timeout", "invalid"]) {
  test("optional " + kind + " advice failures remain independent of native admission", async (t) => {
    const f = fixture(t);
    await f.prepare();
    f.review();
    const advisor = require("./jev_agent.js");
    const result = await advisor.advise({ request: f.task.request, skills: [f.task.skills[0]] }, "skill", {
      apiKey: "TEST_KEY", fetch: async () => {
        if (kind === "timeout") throw Error("Timeout");
        return kind === "http" ? { ok: false, status: 503 } : { ok: true, json: async () => ({ model: "invalid" }) };
      },
    });
    assert.equal(result.status, "NOT_EVALUATED");
    const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
    const file = path.join(path.dirname(state.skill_input), "optional-advice.json");
    fs.writeFileSync(file, JSON.stringify(result));
    assert.deepEqual(guard.hook(f.event, f.home), {});
    fs.writeFileSync(file, "Invalid optional advice");
    assert.deepEqual(guard.hook(f.event, f.home), {});
    assert.equal(guard.hook({ ...f.event, model: "wrong" }, f.home).hookSpecificOutput.permissionDecision, "deny");
  });
}

test("operational advice callers filter disabled and unrequested explicit-only candidates", async (t) => {
  const f = fixture(t);
  const advisor = require("./jev_agent.js");
  const explicit = { ...f.task.skills[0], name: "explicit", allow_implicit_invocation: false };
  const disabled = { ...f.task.skills[1], name: "disabled", path: path.join(f.repo, "disabled.md"), enabled: false };
  const normal = { ...f.task.skills[1], name: "normal", path: path.join(f.repo, "normal.md") };
  fs.writeFileSync(disabled.path, "Disabled instructions.");
  fs.writeFileSync(normal.path, "Normal instructions.");
  const candidates = [explicit, disabled, normal];
  const { skills } = advisor.combineSkills(candidates, [], f.home);
  assert.deepEqual(skills.filter((skill) => skill.enabled && skill.allow_implicit_invocation).map((skill) => skill.name), ["normal"]);
  const required = new Set([advisor.skillKey(explicit.path)]);
  assert.deepEqual(skills.filter((skill) => skill.enabled &&
    (skill.allow_implicit_invocation || required.has(advisor.skillKey(skill.path)))).map((skill) => skill.name), ["explicit", "normal"]);
  let calls = 0;
  const empty = await advisor.advise({ request: f.task.request, skills: [] }, "skill", {
    apiKey: "TEST_KEY", fetch: () => { calls++; throw Error("No request expected"); },
  });
  assert.equal(empty.status, "NOT_APPLICABLE");
  assert.deepEqual(empty.suggestions, []);
  assert.equal(calls, 0);
});

test("task input staging rejects links, escaping paths and multiple file writes", (t) => {
  const f = fixture(t);
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit" }, f.home);
  const file = guard.inputFile(f.home, "session", "turn", JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8")).input_nonce);
  const patch = (target) => "*** Begin Patch\n*** Add File: " + target + "\n+" +
    JSON.stringify(f.task) + "\n*** End Patch";
  const event = { ...f.event, tool_input: { input: patch(file) } };
  for (const target of [file + "/../outside.json", path.join(path.dirname(file), "other.json"), path.join(f.repo, "task.json")]) {
    assert.equal(guard.hook({ ...event, tool_input: { input: patch(target) } }, f.home).hookSpecificOutput.permissionDecision, "deny");
  }
  const outside = path.join(f.repo, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.dirname(file), "junction");
  assert.equal(guard.hook(event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("selected policy mutation during loading cannot produce reviewed admission", async (t) => {
  const f = fixture(t);
  await f.prepare();
  const mock = require(f.settings.advisor);
  const combine = mock.combineSkills;
  mock.combineSkills = (...args) => {
    const result = combine(...args);
    fs.appendFileSync(f.skill, " Changed during local policy loading.");
    return result;
  };
  assert.throws(f.review, /changed/);
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("once admitted, identical accepted tools do not rewrite session state", async (t) => {
  const f = fixture(t);
  await f.prepare();
  f.review();
  assert.deepEqual(guard.hook(f.event, f.home), {});
  const file = guard.stateFile(f.home, "session");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).mutation_admitted, true);
  const before = fs.statSync(file).mtimeMs;
  for (let i = 0; i < 10; i++) assert.deepEqual(guard.hook(f.event, f.home), {});
  assert.equal(fs.statSync(file).mtimeMs, before);
});


test("default native preparation never discovers home skills or calls skill advice", async (t) => {
  const f = fixture(t);
  const mock = require(f.settings.advisor);
  mock.discoverSkills = () => { throw Error("UNEXPECTED_HOME_SCAN"); };
  mock.advise = () => { throw Error("UNEXPECTED_SKILL_ADVICE"); };
  const prepared = await f.prepare();
  assert.equal(prepared.skill_selection.source, "native-session");
  assert.equal(prepared.skill_selection.advice_status, "NOT_REQUESTED");
  assert.equal(prepared.skill_advice, undefined);
  assert.equal(f.review().skill_review.source, "native-session");
  assert.deepEqual(guard.hook(f.event, f.home), {});
});

test("unrelated native skill bodies do not invalidate reviewed admission", async (t) => {
  const f = fixture(t);
  const unused = path.join(f.repo, "unused.md");
  fs.writeFileSync(unused, "Unrelated instructions.");
  f.task.skills.push({ name: "unused", path: unused, description: "Unrelated skill" });
  await f.prepare();
  f.review();
  fs.appendFileSync(unused, " Changed body.");
  assert.deepEqual(guard.hook(f.event, f.home), {});
  fs.appendFileSync(f.skill, " Changed required body.");
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("current-turn JSON input can be staged without authorizing source edits", (t) => {
  const f = fixture(t);
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit" }, f.home);
  const input = guard.inputFile(f.home, "session", "turn", JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8")).input_nonce);
  const patch = (file, content) => "*** Begin Patch\n*** Add File: " + file + "\n" +
    content.split("\n").map((line) => "+" + line).join("\n") + "\n*** End Patch";
  const event = { ...f.event, tool_input: { input: patch(input, JSON.stringify(f.task, null, 2)) } };
  assert.deepEqual(guard.hook(event, f.home), {});
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  for (const bad of [
    patch(path.join(f.repo, "source.js"), "{}"),
    patch(input, "not JSON"),
    patch(input, JSON.stringify({ mode: "implement", request: "incomplete", skills: [] })),
    patch(input, JSON.stringify(f.task)) + "\n*** Add File: arbitrary.js\n+code",
  ]) {
    assert.equal(guard.hook({ ...event, tool_input: { input: bad } }, f.home).hookSpecificOutput.permissionDecision, "deny");
  }
  assert.equal(guard.hook({ ...event, turn_id: "stale" }, f.home).hookSpecificOutput.permissionDecision, "deny");
  fs.mkdirSync(path.dirname(input), { recursive: true });
  fs.writeFileSync(input, JSON.stringify(f.task));
  assert.equal(guard.hook(event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("reviewed Node flag commands do not treat the flag as a script path", async (t) => {
  const f = fixture(t);
  await f.prepare();
  f.review();
  const event = { ...f.event, tool_name: "Bash",
    tool_input: { command: "rtk proxy node --test scripts/test-codex-compliance.js" } };
  assert.deepEqual(guard.hook(event, f.home), {});
  assert.equal(guard.hook({ ...event, model: "wrong" }, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("legacy reviewed evidence requires fresh preparation under native semantics", async (t) => {
  const f = fixture(t);
  await f.prepare();
  f.review();
  const file = guard.stateFile(f.home, "session");
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  delete state.schema;
  fs.writeFileSync(file, JSON.stringify(state));
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});


test("task assessment retains the same original credential root as skill advice", async (t) => {
  const f = fixture(t);
  const routing = require(routingPath);
  const assess = routing.assess;
  t.after(() => { routing.assess = assess; });
  let observed;
  routing.assess = (task, options) => { observed = options.credentialRoot; return assess(task, options); };
  await f.prepare();
  assert.equal(observed, f.settings.credential_root);
  assert.notEqual(observed, path.dirname(f.settings.advisor));
});

test("adapter assessment and review use the configured private opt-in journal", async (t) => {
  const f = fixture(t);
  await f.prepare();
  const records = () => fs.readFileSync(f.settings.journal, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(records().map(row => row.operation), ["assess"]);
  assert.throws(() => f.review({ skills: "[]" }), /mandatory skill/);
  assert.equal(records().length, 1);
  f.review();
  const rows = records();
  assert.deepEqual(rows.map(row => row.operation), ["assess", "review"]);
  assert.equal(rows[0].taskKey, rows[1].taskKey);
  assert.equal(rows[1].reviewer, "codex-control");
  assert.equal(rows[1].jevStatus, "NOT_EVALUATED");
  assert.ok(!JSON.stringify(rows).includes(f.task.context.evidence));
  assert.ok(Object.hasOwn(f.settings.dependencies, path.join(path.dirname(routingPath), "usage.js")));
});

test("absent logging directories are not created and never change admission", async (t) => {
  const f = fixture(t);
  f.settings.journal = path.join(f.repo, "logging-not-enabled", "log.jsonl");
  fs.writeFileSync(guard.settingsFile(f.home), JSON.stringify(f.settings));
  await f.prepare();
  assert.equal(f.review().status, "REVIEWED");
  assert.deepEqual(guard.hook(f.event, f.home), {});
  assert.equal(fs.existsSync(path.dirname(f.settings.journal)), false);
});

test("native preparation retains the exact session roster without expanding it from home", async (t) => {
  const f = fixture(t);
  const homeSkill = path.join(f.repo, "home-skill", "SKILL.md");
  const policy = path.join(f.repo, "home-skill", "agents", "openai.yaml");
  fs.mkdirSync(path.dirname(policy), { recursive: true });
  fs.writeFileSync(homeSkill, "---\nname: home-skill\ndescription: Home-only advice\n---\nPRIVATE_LOCAL_BODY\n");
  fs.writeFileSync(policy, "policy:\n  allow_implicit_invocation: true\n");
  const record = { name: "home-skill", path: homeSkill, description: "Home-only advice", enabled: true, allow_implicit_invocation: true };
  const mock = require(f.settings.advisor);
  mock.discoverSkills = () => { throw Error("Whole-home discovery is outside native admission"); };
  mock.advise = () => { throw Error("Skill advice is optional"); };
  const prepared = await f.prepare();
  assert.equal(prepared.skill_selection.advice_status, "NOT_REQUESTED");
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  assert.deepEqual(JSON.parse(fs.readFileSync(state.session_roster, "utf8")).skills, f.task.skills);
  assert.deepEqual(JSON.parse(fs.readFileSync(state.skill_input, "utf8")).skills.map((skill) => skill.name),
    ["required", "dely:delivery"]);
  assert.throws(() => f.review({ skills: '["required","home-skill"]' }), /supplied skills/);
  f.task.skills.push(record);
  await f.prepare();
  const reviewed = f.review({ skills: '["required","home-skill"]' });
  assert.equal(reviewed.status, "REVIEWED");
  assert.deepEqual(reviewed.loaded_skills.map((s) => s.name), ["required", "home-skill"]);
  assert.deepEqual(guard.hook(f.event, f.home), {});
  fs.writeFileSync(policy, "policy:\n  allow_implicit_invocation: false\n");
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

for (const policy of ["explicit-only", "disabled"]) {
  test("session-only " + policy + " policy cannot be waived by supplied metadata", async (t) => {
    const f = fixture(t);
    f.task.required_skills = [];
    f.task.skills[0].enabled = true;
    f.task.skills[0].allow_implicit_invocation = true;
    if (policy === "explicit-only") {
      const file = path.join(path.dirname(f.skill), "agents/openai.yaml");
      fs.mkdirSync(path.dirname(file));
      fs.writeFileSync(file, "policy:\n  allow_implicit_invocation: false\n");
    } else {
      fs.writeFileSync(path.join(f.home, "config.toml"),
        "[[skills.config]]\npath = " + JSON.stringify(path.dirname(f.skill)) + "\nenabled = false\n");
    }
    await f.prepare();
    assert.throws(f.review, policy === "disabled" ? /Disabled skills/ : /Explicit-only skills/);
  });
}

test("native canonical aliases retain the strictest supplied invocation policy", async (t) => {
  const f = fixture(t);
  const alias = path.join(f.repo, "skill-link");
  fs.symlinkSync(path.dirname(f.skill), alias, "junction");
  f.task.skills[0].path = path.join(alias, "SKILL.md");
  f.task.required_skills = [];
  f.task.skills.push({ name: "native-alias", path: f.skill,
    description: "Same source", allow_implicit_invocation: false });
  await f.prepare();
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  const input = JSON.parse(fs.readFileSync(state.skill_input, "utf8"));
  assert.deepEqual(input.skills.map((s) => s.name), ["required", "dely:delivery", "native-alias"]);
  assert.throws(f.review, /Explicit-only skills/);
  f.task.required_skills = ["required"];
  await f.prepare();
  assert.equal(f.review().loaded_skills[0].path, fs.realpathSync(f.skill));
});

test("session-only skill content is fingerprinted before Control can load it", async (t) => {
  const f = fixture(t);
  await f.prepare();
  fs.appendFileSync(f.skill, "Changed instruction body.\n");
  assert.throws(f.review, /changed/i);
});

test("retargeting a prepared alias is rejected even when instruction bytes are identical", async (t) => {
  const f = fixture(t);
  const alias = path.join(f.repo, "alias");
  const replacement = path.join(f.repo, "replacement");
  fs.mkdirSync(replacement);
  fs.copyFileSync(f.skill, path.join(replacement, "SKILL.md"));
  fs.symlinkSync(path.dirname(f.skill), alias, "junction");
  f.task.skills[0].path = path.join(alias, "SKILL.md");
  await f.prepare();
  f.review();
  if (process.platform === "win32") fs.rmdirSync(alias);
  else fs.unlinkSync(alias);
  fs.symlinkSync(replacement, alias, "junction");
  assert.throws(f.review, /Prepare this turn|path changed/);
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("file aliases retain canonical and alias-local policy with both YAML locations protected", async (t) => {
  const f = fixture(t);
  const original = path.join(f.repo, "original");
  const alias = path.join(f.repo, "alias");
  fs.mkdirSync(path.join(original, "agents"), { recursive: true });
  fs.mkdirSync(alias);
  const source = path.join(original, "SKILL.md");
  const targetPolicy = path.join(original, "agents/openai.yaml");
  const aliasPolicy = path.join(alias, "agents/openai.yaml");
  fs.writeFileSync(source, "---\nname: optional\ndescription: Optional workflow\n---\nPRIVATE_BODY\n");
  fs.writeFileSync(targetPolicy, "policy:\n  allow_implicit_invocation: false\n");
  const link = path.join(alias, "SKILL.md");
  fs.symlinkSync(source, link, "file");
  f.task.skills.push({ name: "file-alias", path: link, description: "Optional session workflow", allow_implicit_invocation: true });
  await f.prepare();
  assert.throws(() => f.review({ skills: '["required","file-alias"]' }), /Explicit-only skills/);
  f.task.required_skills.push("file-alias");
  await f.prepare();
  f.review({ skills: '["required","file-alias"]' });
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  assert.equal(state.fingerprints[fs.realpathSync(targetPolicy)], guard.digest(fs.readFileSync(targetPolicy)));
  assert.equal(state.fingerprints[path.resolve(aliasPolicy)], null);
  fs.writeFileSync(targetPolicy, "policy:\n  allow_implicit_invocation: true\n");
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  fs.mkdirSync(path.dirname(aliasPolicy));
  fs.writeFileSync(aliasPolicy, "policy:\n  allow_implicit_invocation: false\n");
  f.task.required_skills = ["required"];
  await f.prepare();
  assert.throws(() => f.review({ skills: '["required","file-alias"]' }), /Explicit-only skills/);
});

test("unselected and nonrequired native bodies are outside admission fingerprints", async (t) => {
  const f = fixture(t);
  const unused = path.join(f.repo, "unused.md");
  fs.writeFileSync(unused, "Unselected system instructions.\n");
  f.task.skills.push({ name: "system-unused", path: unused, description: "An unrelated session skill" });
  await f.prepare();
  f.review();
  fs.appendFileSync(unused, "Changed source.\n");
  assert.deepEqual(guard.hook(f.event, f.home), {});
});

test("native preparation guidance names the configured hook home explicitly", (t) => {
  const f = fixture(t);
  const result = guard.hook({ ...f.event, hook_event_name: "SessionStart" }, f.home);
  assert.ok(result.hookSpecificOutput.additionalContext.includes("--home "));
  assert.ok(result.hookSpecificOutput.additionalContext.includes(f.home));
});

test("preserving hooks refuses missing admission handlers before replacing installed software", (t) => {
  const f = fixture(t);
  const file = path.join(f.home, "hooks.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  delete manifest.hooks.Stop;
  fs.writeFileSync(file, JSON.stringify(manifest));
  const script = path.join(f.home, "dely-compliance/codex-compliance.js");
  const before = guard.digest(fs.readFileSync(script));
  assert.throws(() => guard.install({ routing: routingPath, advisor: f.advisor, "preserve-hooks": true }, f.home), /one existing compliance handler/);
  assert.equal(guard.digest(fs.readFileSync(script)), before);
  assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify(manifest));
});

test("native skill selection preserves independent Jev routing and mandatory dispatch admission", async (t) => {
  const f = fixture(t);
  f.task.context.risks.routing = false;
  f.task.required_skills.push("dely:delivery");
  const routing = require(routingPath);
  const assess = routing.assess;
  t.after(() => { routing.assess = assess; });
  routing.assess = (task) => assess(task, { apiKey: "TEST_KEY", fetch: async () => ({ ok: true,
    json: async () => ({ model: routing.MODEL, answers: Object.fromEntries(Object.keys(routing.questions()).map((id) => [id,
      { type: "choice", choice: "medium_minus", confidence: 1, probabilities: {
        easy: 0, medium_minus: 1, medium_plus: 0, hard: 0, insufficient_evidence: 0 } }])) }) }) });
  require(f.settings.advisor).advise = () => { throw Error("Unexpected skill advice"); };
  const prepared = await f.prepare();
  assert.equal(prepared.skill_selection.advice_status, "NOT_REQUESTED");
  assert.equal(prepared.assessment.difficulty, "medium_minus");
  assert.equal(prepared.assessment.route.workflow, "dely");
  assert.equal(prepared.assessment.route.primary.model, "gemini-3.8-flash-medium");
  assert.throws(() => f.review({ difficulty: "medium_minus" }), /mandatory skill/);
  const reviewed = f.review({ difficulty: "medium_minus", skills: '["required","dely:delivery"]', run: "test-route" });
  assert.equal(reviewed.skill_review.evaluation_status, "NOT_REQUESTED");
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

for (const difficulty of ["easy", "medium_minus", "medium_plus"]) {
  test(difficulty + " review requires a Dely Run before recording approval", async (t) => {
    const f = fixture(t);
    f.task.context.risks.routing = false;
    const routing = require(routingPath);
    const assess = routing.assess;
    t.after(() => { routing.assess = assess; });
    routing.assess = (task) => assess(task, { apiKey: "" });
    await f.prepare();
    for (const run of [undefined, "", " \t "]) {
      assert.throws(() => f.review({ difficulty, skills: '["required","dely:delivery"]', run }), /Dely Run.*--run/);
      const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
      assert.equal(state.status, "PREPARED");
      assert.equal(fs.existsSync(path.join(path.dirname(state.skill_input), "reviewed.json")), false);
    }
    assert.equal(f.review({ difficulty, skills: '["required","dely:delivery"]', run: "run-one" }).status, "REVIEWED");
    assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  });
}

test("software refresh preserves existing native hook definitions byte for byte", (t) => {
  const f = fixture(t);
  const file = path.join(f.home, "hooks.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const groups of Object.values(manifest.hooks)) {
    for (const group of groups) for (const item of group.hooks) {
      if (item.statusMessage === "Checking Jev and Dely task evidence") item.command += " --existing-wiring";
    }
  }
  fs.writeFileSync(file, JSON.stringify(manifest, null, 3));
  const before = fs.readFileSync(file);
  guard.install({ routing: routingPath, advisor: f.advisor, "preserve-hooks": true }, f.home);
  assert.equal(fs.readFileSync(file, "utf8"), before.toString("utf8"));
});

test("reinstalling a candidate from a new checkout retains the existing credential search root", (t) => {
  const f = fixture(t);
  const original = JSON.parse(fs.readFileSync(guard.settingsFile(f.home), "utf8")).credential_root;
  const nextAdvisor = path.join(f.repo, "scripts", "advisor.js");
  fs.mkdirSync(path.dirname(nextAdvisor), { recursive: true });
  fs.copyFileSync(f.advisor, nextAdvisor);
  guard.install({ routing: routingPath, advisor: nextAdvisor }, f.home);
  const settings = JSON.parse(fs.readFileSync(guard.settingsFile(f.home), "utf8"));
  assert.equal(settings.credential_root, original);
  assert.equal(settings.advisor_source, fs.realpathSync(nextAdvisor));
  assert.ok(fs.readFileSync(settings.advisor, "utf8").includes("const ROOT = " + JSON.stringify(original) + ";"));
});

for (const kind of ["policy", "config"]) {
  test("creating an absent " + kind + " after prepare invalidates Control review", async (t) => {
    const f = fixture(t);
    const record = { name: "home-only", path: f.skill, description: "Home catalog record" };
    require(f.settings.advisor).discoverSkills = () => [record];
    await f.prepare();
    const file = kind === "policy" ? path.join(path.dirname(f.skill), "agents", "openai.yaml") : path.join(f.home, "config.toml");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, kind === "policy" ? "policy:\n  allow_implicit_invocation: yes\n" : "[[skills.config]]\npath = " + JSON.stringify(f.skill) + "\nenabled = false\n");
    assert.throws(() => f.review(), /changed/i);
  });
}

for (const kind of ["shared path", "name/path collision"]) {
  test("Control rejects a selector with " + kind + " instead of loading extra records", async (t) => {
    const f = fixture(t);
    const other = path.join(f.repo, "other-skill.md");
    fs.writeFileSync(other, "Other skill source");
    f.task.skills.push({ name: kind === "shared path" ? "alias" : f.skill,
      path: kind === "shared path" ? f.skill : other, description: "Another original record" });
    await f.prepare();
    assert.throws(() => f.review({ skills: JSON.stringify([f.skill]) }), /ambiguous|duplicate/i);
  });
}

test("installed guide's home-advice documentation link resolves locally", (t) => {
  const f = fixture(t);
  assert.ok(fs.readFileSync(path.join(f.home, "dely-compliance", "guide.md"), "utf8").includes("jev-skill-advice.md"));
  assert.ok(fs.existsSync(path.join(f.home, "dely-compliance", "jev-skill-advice.md")));
});

test("a required policy changed during task assessment cannot produce a prepared snapshot", async (t) => {
  const f = fixture(t);
  const routing = require(routingPath);
  const assess = routing.assess;
  t.after(() => { routing.assess = assess; });
  routing.assess = async (input, options) => {
    const policy = path.join(path.dirname(f.skill), "agents", "openai.yaml");
    fs.mkdirSync(path.dirname(policy), { recursive: true });
    fs.writeFileSync(policy, "policy:\n  allow_implicit_invocation: false\n");
    return assess(input, options);
  };
  await assert.rejects(() => f.prepare(), /changed/);
  assert.ok(!fs.existsSync(guard.stateFile(f.home, "session")));
});

test("native prepare CLI reports local provenance without fabricating remote suggestions", (t) => {
  const f = fixture(t);
  const records = Array.from({ length: 3 }, (_, i) => ({ name: "recommended-" + i, path: f.skill, description: ("Complete metadata " + i).repeat(1000) }));
  records[0].allow_implicit_invocation = false;
  records[0].requires_explicit_invocation = true;
  const source = catalogHelpers + 'const path = require("path");\nconst ROOT = path.resolve(__dirname, "..");\nconst records = ' + JSON.stringify(records) + ';\n' +
    'exports.discoverSkills = () => records.map(({requires_explicit_invocation,...skill}) => skill);\nexports.advise = async (input) => ({mode:"skill",status:"REVIEW_REQUIRED",input_sha256:require("crypto").createHash("sha256").update(JSON.stringify(input)).digest("hex"),suggestions:records,suggestion:records[0],evaluations:[{internal:"COMPLETE_EVALUATION_MARKER"}],selection:{catalog_count:3,eligible_count:3,evaluated_count:3,requests:1,rounds:1}});\n';
  fs.writeFileSync(f.advisor, source);
  guard.install({ routing: routingPath, advisor: f.advisor }, f.home);
  const taskFile = path.join(f.repo, "multi-task.json");
  fs.writeFileSync(taskFile, JSON.stringify(f.task));
  const script = path.join(f.home, "dely-compliance", "codex-compliance.js");
  const run = spawnSync(process.execPath, [script, "prepare", "--home", f.home, "--session", "multi-cli", "--turn", "turn",
    "--repo", f.repo, "--task-file", taskFile], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.skill_advice, undefined);
  assert.deepEqual(result.skill_selection, { source: "native-session", advice_status: "NOT_REQUESTED" });
  assert.ok(run.stdout.length < 12000, "large descriptions stay in the advice file rather than bloating the native CLI response");
  assert.ok(!run.stdout.includes("COMPLETE_EVALUATION_MARKER"));
  assert.equal(Object.keys(result)[1], "task_directory", "file pointer appears before potentially large lists");
  assert.equal(fs.existsSync(path.join(result.task_directory, "skill-advice.json")), false);
});

for (const kind of ["explicit-only", "disabled"]) {
  test("Control rejects " + kind + " suggestions before loading their instructions", async (t) => {
    const f = fixture(t);
    const record = { name: "recommended", path: path.join(f.repo, "recommended", "SKILL.md"),
      description: "A recommended workflow", enabled: kind !== "disabled", allow_implicit_invocation: kind !== "explicit-only" };
    fs.mkdirSync(path.dirname(record.path));
    fs.writeFileSync(record.path, "Instructions require policy admission first.\n");
    f.task.skills.push(record);
    await f.prepare();
    assert.throws(() => f.review({ skills: '["required","recommended"]' }),
      kind === "disabled" ? /Disabled skills cannot be loaded/ : /Explicit-only skills must be required/);
    assert.equal(JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8")).status, "PREPARED");
  });
}

test("Control loads a required explicit-only skill but cannot load a required disabled skill", async (t) => {
  const f = fixture(t);
  const record = { ...f.task.skills[0], enabled: true, allow_implicit_invocation: false };
  f.task.skills[0] = record;
  await f.prepare();
  assert.equal(f.review().loaded_skills[0].name, "required");
  record.enabled = false;
  await f.prepare();
  assert.throws(() => f.review(), /Disabled skills cannot be loaded/);
});

test("missing review is denied under bypass permissions; simple reads are available", (t) => {
  const f = fixture(t);
  const denied = guard.hook({ ...f.event, permission_mode: "bypassPermissions" }, f.home);
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(guard.hook({ ...f.event, tool_name: "Bash", tool_input: { command: "rtk git status --short" } }, f.home), {});
  assert.equal(fs.existsSync(path.join(f.repo, "marker.txt")), false);
});

test("bootstrap accepts quoted task JSON but denies chained commands and redirects", (t) => {
  const f = fixture(t);
  const script = path.join(f.home, "dely-compliance/codex-compliance.js");
  const command = 'rtk proxy node "' + script + '" prepare --task-json ' + "'{\"request\":\"x; y\"}'";
  assert.equal(guard.needsReview({ tool_name: "Bash", tool_input: { command } }, script), false);
  for (const cmd of [command + "; Set-Content owned.txt x", "rg text > owned.txt", "git diff --output=owned.txt"]) {
    assert.equal(guard.needsReview({ tool_name: "Bash", tool_input: { command: cmd } }, script), true);
  }
  assert.equal(guard.needsReview({ tool_name: "mcp__fs_write_file" }, script), true);
  for (const name of ["mcp__pycharm_auto__pycharm_notebook_insert_cell_after",
    "mcp__pycharm_auto__pycharm_notebook_replace_cell", "mcp__pycharm_auto__pycharm_notebook_run_all"]) {
    assert.equal(guard.hook({ ...f.event, tool_name: name }, f.home).hookSpecificOutput.permissionDecision, "deny");
  }
});

test("read-only preflight coordination stops without Jev while conditional discovery stays denied", (t) => {
  const f = fixture(t);
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Preflight only; no implementation." }, f.home);
  for (const command of [
    "Get-Content -LiteralPath 'C:/outside-repo/orchestration/SKILL.md' -TotalCount 80",
    "rtk proxy orca skills get orchestration --json",
    "rtk proxy orca orchestration send --type heartbeat --subject ack --task-id task_probe --dispatch-id ctx_probe",
    "rtk proxy orca orchestration send --type worker_done --subject 'preflight ok' --outcome succeeded --task-id task_probe --dispatch-id ctx_probe",
  ]) {
    assert.deepEqual(guard.hook({ ...f.event, tool_name: "Bash", tool_input: { command } }, f.home), {});
  }
  assert.deepEqual(guard.hook({ ...f.event, hook_event_name: "Stop" }, f.home), {});
  const conditional = 'if ($env:ORCA_CLI_COMMAND) { & $env:ORCA_CLI_COMMAND skills get orchestration } elseif ($env:ORCA_DEV_REPO_ROOT) { orca-dev skills get orchestration } else { orca skills get orchestration }';
  assert.equal(guard.hook({ ...f.event, tool_name: "Bash", tool_input: { command: conditional } }, f.home).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("real routing review permits Hard with native skill provenance and loaded instructions", async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.skill_selection.advice_status, "NOT_REQUESTED");
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  const reviewed = f.review();
  assert.equal(reviewed.route.workflow, "direct");
  assert.equal(reviewed.skill_review.evaluation_status, "NOT_REQUESTED");
  assert.equal(reviewed.loaded_skills[0].text, fs.readFileSync(f.skill, "utf8"));
  assert.deepEqual(guard.hook(f.event, f.home), {});
  assert.equal(guard.hook({ ...f.event, model: "wrong-model" }, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("Control cannot downgrade a known Hard risk or drop mandatory skills", async (t) => {
  const f = fixture(t);
  await f.prepare();
  assert.throws(() => f.review({ difficulty: "easy" }), /Hard exclusion/);
  assert.throws(() => f.review({ skills: "[]" }), /mandatory skill/);
  assert.throws(() => f.review({ skills: '["invented"]' }), /supplied skills/);
});

test("colliding catalog names require an exact path and load only the selected source", async (t) => {
  const f = fixture(t);
  const other = path.join(path.dirname(f.skill), "other.md");
  fs.writeFileSync(other, "Other scope.\n");
  f.task.skills.push({ name: "required", path: other, description: "A different scope" });
  await f.prepare();
  assert.throws(f.review, /exact catalog path/);
  const result = f.review({ skills: JSON.stringify([f.skill]) });
  assert.equal(result.loaded_skills.length, 1);
  assert.equal(result.loaded_skills[0].path, fs.realpathSync(f.skill));
});

for (const target of ["spec", "task", "skill", "instructions", "dependency"]) {
  test("changed " + target + " invalidates authorization before a write", async (t) => {
    const f = fixture(t);
    await f.prepare();
    f.review();
    const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
    const file = { spec: state.assessment.task.spec_file, task: state.task_input,
      skill: f.skill, instructions: path.join(f.repo, "AGENTS.md"), dependency: f.settings.advisor }[target];
    fs.appendFileSync(file, "\nchanged");
    assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  });
}

test("new user turn resets authorization; another workspace cannot reuse it", async (t) => {
  const f = fixture(t);
  await f.prepare();
  f.review();
  const elsewhere = path.dirname(f.repo);
  assert.equal(guard.hook({ ...f.event, cwd: elsewhere }, f.home).hookSpecificOutput.permissionDecision, "deny");
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", turn_id: "next" }, f.home);
  assert.equal(guard.hook({ ...f.event, turn_id: "next" }, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("Dely can bootstrap after review, but writes require dispatch for this exact task", async (t) => {
  const f = fixture(t);
  f.task.context.risks.routing = false;
  const routing = require(routingPath), assess = routing.assess;
  t.after(() => { routing.assess = assess; });
  routing.assess = (task, options) => assess(task, { ...options, apiKey: "" });
  await f.prepare();
  f.review({ difficulty: "easy", skills: '["required","dely:delivery"]', run: "run-one" });
  const coordinating = { ...f.event, tool_name: "Bash",
    tool_input: { command: 'rtk proxy node "' + f.settings.dely + '" dispatch --run run-one' } };
  assert.deepEqual(guard.hook(coordinating, f.home), {});
  for (const suffix of ["", " pins --repo " + JSON.stringify(f.repo)]) {
    assert.deepEqual(guard.hook({ ...coordinating,
      tool_input: { command: 'rtk proxy node "' + f.settings.dely + '"' + suffix } }, f.home), {});
  }
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  const route = { event: "task_route", run: state.run, repo: f.repo, difficulty: "easy",
    policy: state.assessment.policy, assessmentBasisSha256: state.assessment.assessment_basis_sha256,
    correctionSha256: null, reviewSource: state.assessment.review.source,
    specSha256: state.assessment.task.spec_sha256, contextSha256: state.assessment.task.context_sha256 };
  const dispatch = { event: "dispatch", run: state.run, repo: f.repo, phase: "implement",
    assessmentBasisSha256: route.assessmentBasisSha256, contextSha256: route.contextSha256, correctionSha256: null,
    launch: { effective: { agent: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" } },
    promptSha256: route.specSha256, dispatchId: "dispatch-one", ts: new Date().toISOString() };
  fs.writeFileSync(f.settings.journal, [route, { ...dispatch, promptSha256: "wrong" }].map(JSON.stringify).join("\n") + "\n");
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  fs.appendFileSync(f.settings.journal, JSON.stringify(dispatch) + "\n");
  assert.deepEqual(guard.hook(f.event, f.home), {});
});

test("worker exception needs actual dispatch, model and owned terminal evidence", (t) => {
  const f = fixture(t);
  const run = "compliance_test_" + guard.digest(f.repo).slice(0, 12);
  const inventory = path.join(os.tmpdir(), "dely-run-" + run + ".jsonl");
  assert.equal(fs.existsSync(inventory), false);
  t.after(() => {
    assert.equal(path.dirname(path.resolve(inventory)), path.resolve(os.tmpdir()));
    if (fs.existsSync(inventory)) fs.unlinkSync(inventory);
  });
  const handle = "terminal-test";
  const dispatch = { event: "dispatch", run, repo: f.repo, phase: "implement",
    terminalHandle: handle, dispatchId: "dispatch-test", promptSha256: "spec-hash",
    fallbackReason: "quota", fallbackStage: 1, assessmentBasisSha256: guard.digest("fixture basis"),
    contextSha256: "context-hash", correctionSha256: null,
    receiptMarker: "rcpt_1234567890abcdef",
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" },
      modelEvidence: { session: f.event.session_id, turn: f.event.turn_id, model: "gpt-6-luna", effort: "max" } } };
  const event = { ...f.event, model: "gpt-6-luna" };
  const route = { event: "task_route", run, repo: f.repo, specSha256: dispatch.promptSha256,
    policy: require(routingPath).POLICY, difficulty: "easy", assessmentBasisSha256: dispatch.assessmentBasisSha256,
    contextSha256: dispatch.contextSha256, correctionSha256: null };
  assert.equal(guard.verifiedWorker(event, f.settings, handle), false);
  fs.writeFileSync(f.settings.journal, [dispatch, route].map(JSON.stringify).join("\n") + "\n");
  assert.equal(guard.verifiedWorker(event, f.settings, handle), false);
  fs.writeFileSync(inventory, JSON.stringify({ owned: true, terminalHandle: handle, dispatchId: "dispatch-test" }) + "\n");
  assert.equal(guard.verifiedWorker(event, f.settings, handle), false);
  const claim = { receipts: [dispatch.receiptMarker] };
  assert.equal(guard.verifiedWorker(event, f.settings, handle, claim), true);
  for (const difficulty of ["medium_plus", "hard"]) {
    fs.writeFileSync(f.settings.journal, [dispatch, { ...route, difficulty }].map(JSON.stringify).join("\n") + "\n");
    assert.equal(guard.verifiedWorker(event, f.settings, handle, claim), false);
  }
  fs.writeFileSync(f.settings.journal, [dispatch, route].map(JSON.stringify).join("\n") + "\n");
  assert.equal(guard.verifiedWorker({ ...event, session_id: "other-session" }, f.settings, handle, claim), false);
  assert.equal(guard.verifiedWorker({ ...event, turn_id: "other-turn" }, f.settings, handle, claim), false);
  assert.equal(guard.verifiedWorker(event, f.settings, handle, { spec_sha256: dispatch.promptSha256 }), true);
  assert.equal(guard.verifiedWorker(f.event, f.settings, handle), false);
  assert.equal(guard.verifiedWorker(event, f.settings, "another-terminal"), false);

  dispatch.snapshotSha256 = guard.digest("The staged spec includes a receipt footer.");
  fs.writeFileSync(f.settings.journal, [dispatch, route].map(JSON.stringify).join("\n") + "\n");
  const stagedClaim = { spec_sha256: dispatch.snapshotSha256 };
  assert.equal(guard.verifiedWorker(event, f.settings, handle, stagedClaim), true);
  assert.equal(guard.verifiedWorker(event, f.settings, handle, { spec_sha256: dispatch.promptSha256 }), false);
  assert.equal(guard.verifiedWorker(event, f.settings, handle, { spec_sha256: guard.digest("stale snapshot") }), false);
  assert.equal(guard.verifiedWorker(event, f.settings, handle, claim), true);
  assert.equal(guard.verifiedWorker({ ...event, model: "wrong-model" }, f.settings, handle, stagedClaim), false);
  assert.equal(guard.verifiedWorker({ ...event, cwd: f.home }, f.settings, handle, stagedClaim), false);
  assert.equal(guard.verifiedWorker(event, f.settings, "another-terminal", stagedClaim), false);
  fs.writeFileSync(f.settings.journal, JSON.stringify(dispatch) + "\n");
  assert.equal(guard.verifiedWorker(event, f.settings, handle, stagedClaim), false);
  fs.writeFileSync(f.settings.journal, [dispatch, { ...route, specSha256: dispatch.snapshotSha256 }].map(JSON.stringify).join("\n") + "\n");
  assert.equal(guard.verifiedWorker(event, f.settings, handle, stagedClaim), false);
});

test("preparation retains a dispatched worker's current prompt claim", async (t) => {
  const f = fixture(t);
  const run = "compliance_prepare_" + guard.digest(f.repo).slice(0, 12);
  const inventory = path.join(os.tmpdir(), "dely-run-" + run + ".jsonl");
  const handle = "prepared-worker", spec = guard.digest(f.task.spec);
  const previous = process.env.ORCA_TERMINAL_HANDLE;
  process.env.ORCA_TERMINAL_HANDLE = handle;
  t.after(() => {
    if (previous === undefined) delete process.env.ORCA_TERMINAL_HANDLE;
    else process.env.ORCA_TERMINAL_HANDLE = previous;
    if (fs.existsSync(inventory)) fs.unlinkSync(inventory);
  });
  const dispatch = { event: "dispatch", run, repo: f.repo, phase: "implement",
    terminalHandle: handle, dispatchId: "prepared-dispatch", promptSha256: spec,
    fallbackReason: "quota", fallbackStage: 1, assessmentBasisSha256: guard.digest("prepared fixture basis"),
    contextSha256: "context-hash", correctionSha256: null,
    launch: { effective: { agent: "codex", model: "gpt-6-luna", effort: "max" },
      modelEvidence: { session: f.event.session_id, turn: f.event.turn_id, model: "gpt-6-luna", effort: "max" } } };
  fs.writeFileSync(f.settings.journal, [dispatch, { event: "task_route", run,
    repo: f.repo, specSha256: spec, policy: require(routingPath).POLICY, difficulty: "easy",
    assessmentBasisSha256: dispatch.assessmentBasisSha256, contextSha256: dispatch.contextSha256,
    correctionSha256: null }].map(JSON.stringify).join("\n") + "\n");
  fs.writeFileSync(inventory, JSON.stringify({ owned: true, terminalHandle: handle,
    dispatchId: dispatch.dispatchId }) + "\n");
  const event = { ...f.event, model: "gpt-6-luna" };
  guard.hook({ ...event, hook_event_name: "UserPromptSubmit",
    prompt: "Task spec staged at task.txt (100 bytes, SHA-256: " + spec + ")." }, f.home);
  const admitted = guard.hook(event, f.home);
  assert.match(admitted.hookSpecificOutput.additionalContext, /inherited admission checks passed/);
  assert.match(admitted.hookSpecificOutput.additionalContext, /Native Codex hook model: "gpt-6-luna"/);
  assert.ok(admitted.hookSpecificOutput.additionalContext.includes(event.turn_id));
  assert.equal(admitted.hookSpecificOutput.permissionDecision, undefined);
  await f.prepare();
  assert.deepEqual(guard.hook(event, f.home), admitted);
  assert.throws(f.review, /workers cannot create Codex Control reviews/);
  const command = JSON.parse(fs.readFileSync(path.join(f.home, "hooks.json"), "utf8"))
    .hooks.PreToolUse[0].hooks[0].command;
  const native = process.platform === "win32" ?
    spawnSync("powershell.exe", ["-NoProfile", "-Command", command],
      { input: JSON.stringify(event), encoding: "utf8" }) :
    spawnSync(process.execPath, [path.join(f.home, "dely-compliance", "codex-compliance.js"), "hook", "--home", f.home],
      { input: JSON.stringify(event), encoding: "utf8" });
  assert.equal(native.status, 0, native.stderr);
  assert.deepEqual(JSON.parse(native.stdout), admitted);
  assert.equal(guard.hook({ ...event, model: "wrong-model" }, f.home).hookSpecificOutput.permissionDecision, "deny");
  delete process.env.ORCA_TERMINAL_HANDLE;
  assert.equal(guard.hook(event, f.home).hookSpecificOutput.permissionDecision, "deny");
  process.env.ORCA_TERMINAL_HANDLE = handle;
  guard.hook({ ...event, hook_event_name: "UserPromptSubmit", prompt: "An unrelated task" }, f.home);
  assert.equal(guard.hook(event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("worker prompt guidance distinguishes inherited admission from Control review", (t) => {
  const f = fixture(t);
  const result = guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit",
    prompt: "Task spec staged at task.txt (100 bytes, SHA-256: " + guard.digest(f.task.spec) + ")." }, f.home);
  assert.match(result.hookSpecificOutput.additionalContext, /workers inherit.*Control/i);
  assert.match(result.hookSpecificOutput.additionalContext, /Do not prepare or review.*worker/i);
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("native model evidence is visible without claiming admission or inferring effort", (t) => {
  const f = fixture(t);
  for (const hook_event_name of ["SessionStart", "UserPromptSubmit"]) {
    const event = { ...f.event, hook_event_name, prompt: "Check the current model" };
    const text = guard.hook(event, f.home).hookSpecificOutput.additionalContext;
    assert.match(text, /Native Codex hook model: "gpt-6\.1-sol"/);
    assert.ok(text.includes(event.session_id));
    assert.ok(text.includes(event.turn_id));
    assert.match(text, /effort: NOT_EVALUATED/);
    assert.match(text, /does not grant.*admission/i);
  }
  const missing = guard.hook({ ...f.event, model: undefined, hook_event_name: "SessionStart" }, f.home);
  assert.match(missing.hookSpecificOutput.additionalContext, /Native Codex hook model: NOT_EVALUATED/);
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("unconfirmed or incomplete implementation evidence cannot produce authorization", async (t) => {
  const f = fixture(t);
  f.task.context.requirements_confirmed = false;
  await assert.rejects(f.prepare, /Complete and confirm/);
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
});

test("editing the advisor checkout preserves the frozen advice used by the active task", async (t) => {
  const f = fixture(t);
  await f.prepare();
  f.review();
  fs.appendFileSync(f.advisor, "\nthrow Error('candidate code must not run');\n");
  assert.deepEqual(guard.hook(f.event, f.home), {});
  assert.equal((await f.prepare()).skill_selection.advice_status, "NOT_REQUESTED");
});

test("Windows native hook seam denies compound reads and permits the first Stop", { skip: process.platform !== "win32" }, (t) => {
  const f = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.home, "hooks.json"), "utf8"));
  const command = manifest.hooks.PreToolUse[0].hooks[0].command;
  assert.ok(command.startsWith("& "));
  assert.ok(command.includes(process.execPath));
  const shadow = path.join(path.dirname(f.repo), "shadow");
  fs.mkdirSync(shadow);
  fs.writeFileSync(path.join(shadow, "node"), Buffer.from([127, 69, 76, 70]));
  const invoke = (event) => {
    const result = spawnSync("C:/Program Files/PowerShell/7/pwsh.exe", ["-NoProfile", "-Command", command],
      { input: JSON.stringify(event), encoding: "utf8", windowsHide: true, timeout: 5000,
        env: { ...process.env, PATH: shadow + path.delimiter + process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.match(invoke({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Explain this hook" })
    .hookSpecificOutput.additionalContext, /prepare --session/);
  const read = { ...f.event, tool_name: "Bash", tool_input: { command: "Get-Content AGENTS.md; Get-Content README.md" } };
  const denied = invoke(read).hookSpecificOutput;
  assert.equal(denied.permissionDecision, "deny");
  assert.match(denied.permissionDecisionReason, /one read command per tool call/);
  assert.deepEqual(invoke({ ...read, tool_input: { command: "Get-Content AGENTS.md" } }), {});
  const stop = { ...f.event, hook_event_name: "Stop" };
  assert.deepEqual(invoke(stop), {});
  assert.equal(invoke(f.event).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(invoke(stop), {});
});

test("file input prepares the complete oversized catalog through the native CLI", (t) => {
  const f = fixture(t);
  const task = { ...f.task, skills: [...f.task.skills, ...Array.from({ length: 104 }, (_, i) => ({
    name: "catalog-" + i, path: f.skill,
    description: "Complete skill description with Unicode Đ and quoted 'text'.\n".repeat(12),
  }))] };
  const input = JSON.stringify(task);
  assert.ok(input.length > 42967);
  assert.equal(task.skills.length, 106);
  const file = path.join(path.dirname(f.skill), "task with spaces Đ.json");
  fs.writeFileSync(file, "\uFEFF" + input);
  const script = path.join(__dirname, "codex-compliance.js");
  const args = [script, "prepare", "--home", f.home, "--session", f.options.session,
    "--turn", f.options.turn, "--repo", f.repo];
  if (process.platform === "win32") {
    const inline = spawnSync(process.execPath, [...args, "--task-json", input], { encoding: "utf8" });
    assert.ok(inline.error, "the oversized inline task must reproduce the Windows launch failure");
    assert.equal(inline.status, null);
  }
  const result = spawnSync(process.execPath, [...args, "--task-file", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "PREPARED");
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, f.options.session), "utf8"));
  assert.deepEqual(JSON.parse(fs.readFileSync(state.session_roster, "utf8")), {
    request: task.request, skills: task.skills,
  });
  assert.equal(fs.readFileSync(state.assessment.task.spec_file, "utf8"), task.spec);
  assert.deepEqual(JSON.parse(fs.readFileSync(state.assessment.task.context_file, "utf8")), task.context);
  f.review();
  assert.deepEqual(guard.hook(f.event, f.home), {});
});

test("invalid file inputs never produce a prepared task", async (t) => {
  const cases = [
    { name: "missing input", options: {} },
    { name: "both inputs", both: true },
    { name: "missing file", options: { "task-file": "missing.json" } },
    { name: "malformed JSON", bytes: Buffer.from("{ SECRET_SENTINEL") },
    { name: "invalid UTF-8", invalidUtf8: true },
  ];
  for (const row of cases) await t.test(row.name, async (t) => {
    const f = fixture(t);
    let options = row.options;
    if (row.both) {
      const file = path.join(path.dirname(f.skill), "valid.json");
      fs.writeFileSync(file, JSON.stringify(f.task));
      options = { "task-json": JSON.stringify(f.task), "task-file": file };
    } else if (row.bytes || row.invalidUtf8) {
      const file = path.join(path.dirname(f.skill), "invalid.json");
      const bytes = row.bytes || Buffer.from(JSON.stringify(f.task));
      if (row.invalidUtf8) bytes[bytes.indexOf("Implement")] = 0xff;
      fs.writeFileSync(file, bytes);
      options = { "task-file": file };
    }
    await assert.rejects(() => guard.prepare({ session: f.options.session, turn: f.options.turn,
      repo: f.repo, ...options }, f.home));
    assert.equal(fs.existsSync(guard.stateFile(f.home, f.options.session)), false);
  });
});

test("advice-only review denies edits and permits the first honest blocked report", async (t) => {
  const f = fixture(t);
  f.task.mode = "advice";
  await f.prepare();
  f.review();
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  const stop = { ...f.event, hook_event_name: "Stop" };
  assert.equal(JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8")).mutation_admitted, false);
  assert.deepEqual(guard.hook(stop, f.home), {});
  assert.deepEqual(guard.hook(stop, f.home), {});
});

test("denied compound reads stay blocked but permit read-only completion", (t) => {
  const f = fixture(t);
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Explain the hook" }, f.home);
  const event = { ...f.event, tool_name: "Bash",
    tool_input: { command: "Get-Content AGENTS.md; Get-Content README.md" } };
  const result = guard.hook(event, f.home).hookSpecificOutput;
  assert.equal(result.permissionDecision, "deny");
  assert.deepEqual(guard.hook({ ...f.event, hook_event_name: "Stop" }, f.home), {});
  assert.match(result.permissionDecisionReason, /one read command per tool call/);
  assert.match(result.permissionDecisionReason, /guide\.md/);
  assert.ok(result.permissionDecisionReason.length < 1000);
  assert.doesNotMatch(result.permissionDecisionReason, /Dely compliance is active/);
  const file = guard.stateFile(f.home, "session");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).mutation_admitted, false);
  assert.deepEqual(guard.hook({ ...event, tool_input: { command: "Get-Content AGENTS.md" } }, f.home), {});
  assert.deepEqual(guard.hook({ ...f.event, hook_event_name: "Stop" }, f.home), {});
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(guard.hook({ ...f.event, hook_event_name: "Stop" }, f.home), {});
});

test("prepared implementation without admitted tools permits a limitation report", async (t) => {
  const f = fixture(t);
  await f.prepare();
  const stop = { ...f.event, hook_event_name: "Stop" };
  assert.deepEqual(guard.hook(stop, f.home), {});
  const reason = guard.hook(f.event, f.home).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /prepare.*review/i);
  assert.ok(reason.length < 1000);
  assert.deepEqual(guard.hook(stop, f.home), {});
});

test("Stop still checks admitted evidence and denied retries do not rearm it", async (t) => {
  const f = fixture(t);
  await f.prepare();
  f.review();
  assert.deepEqual(guard.hook(f.event, f.home), {});
  const original = fs.readFileSync(f.skill);
  fs.appendFileSync(f.skill, "Changed after admission.\n");
  const stop = { ...f.event, hook_event_name: "Stop" };
  assert.equal(guard.hook(stop, f.home).decision, "block");
  assert.deepEqual(guard.hook(stop, f.home), {});
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(guard.hook(stop, f.home), {});
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  assert.equal(state.mutation_admitted, true);
  assert.equal(state.stop_reported, true);
  fs.writeFileSync(f.skill, original);
  assert.deepEqual(guard.hook(f.event, f.home), {});
  fs.appendFileSync(f.skill, "Changed after readmission.\n");
  assert.equal(guard.hook(stop, f.home).decision, "block");
});

test("legacy attempted evidence remains conservative until a new prompt", (t) => {
  const f = fixture(t);
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Legacy task" }, f.home);
  const file = guard.stateFile(f.home, "session");
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  delete state.mutation_admitted;
  fs.writeFileSync(file, JSON.stringify({ ...state, attempted: true }));
  const stop = { ...f.event, hook_event_name: "Stop" };
  assert.equal(guard.hook(stop, f.home).decision, "block");
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit", prompt: "New advice task" }, f.home);
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(guard.hook(stop, f.home), {});
});

test("repreparing advice in the same turn retains an admitted mutation's Stop check", async (t) => {
  const f = fixture(t);
  await f.prepare();
  f.review();
  assert.deepEqual(guard.hook(f.event, f.home), {});
  f.task.mode = "advice";
  await f.prepare();
  f.review();
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  const stop = { ...f.event, hook_event_name: "Stop" };
  assert.equal(guard.hook(stop, f.home).decision, "block");
  assert.deepEqual(guard.hook(stop, f.home), {});
});

test("denied Dely workers receive concise Control recovery guidance", (t) => {
  const f = fixture(t);
  guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit",
    prompt: "Task spec staged at spec.md (1 bytes, SHA-256: " + "a".repeat(64) + ") rcpt_0123456789abcdef" }, f.home);
  const reason = guard.hook(f.event, f.home, () => false).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /report.*Control/i);
  assert.match(reason, /Do not prepare or review/);
  assert.ok(reason.length < 1000);
});

test("installer retains existing hooks and adds its own definitions once", (t) => {
  const f = fixture(t);
  guard.install({ routing: routingPath, advisor: f.advisor }, f.home);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.home, "hooks.json"), "utf8"));
  assert.equal(manifest.hooks.SessionStart.length, 2);
  assert.equal(manifest.hooks.SessionStart[0].hooks[0].command, "existing-session-hook");
  for (const event of ["UserPromptSubmit", "PreToolUse", "Stop"]) assert.equal(manifest.hooks[event].length, 1);
  assert.ok(fs.readdirSync(path.join(f.home, "dely-compliance")).some((file) => file.startsWith("hooks-before-")));
});

test("invalid native input fails with a blocking exit and never prints supplied secrets", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "codex-compliance.js"), "hook"],
    { input: "SECRET_SENTINEL invalid JSON", encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.ok(!result.stdout.includes("SECRET_SENTINEL") && !result.stderr.includes("SECRET_SENTINEL"));
});


function assertConcreteEvidenceReminder(text) {
  assert.ok(typeof text === "string" && text.length > 0, "guidance text must be non-empty");
  if (!/expected_result/i.test(text) || !/would_fail_if/i.test(text) || !/provenance/i.test(text)) {
    throw Error("Reminder is generic or missing required provenance, expected_result, or would_fail_if requirement");
  }
  assert.match(text, /(?:method|command).*fixture/i, "must require available method/command and fixture");
  assert.match(text, /procedure/i, "must require procedure");
  assert.match(text, /expected_result/i, "must require expected_result");
  assert.match(text, /would_fail_if/i, "must require would_fail_if");
  assert.match(text, /(?:source|caller|detector).*provenance|provenance/i, "must require inspected provenance");
  assert.match(text, /distinguish.*planned.*detector.*executed.*acceptance/i, "must distinguish planned detector from executed acceptance");
  assert.match(text, /insufficient_evidence/i, "must address insufficient_evidence handling");
}

test("SessionStart and UserPromptSubmit Control hooks include concrete verification evidence reminder", async (t) => {
  const f = fixture(t);
  assert.throws(() => assertConcreteEvidenceReminder("Before implementation, supply the actual session skill roster and task evidence"),
    /generic|missing/i, "must reject generic reminder");
  assert.throws(() => assertConcreteEvidenceReminder("Require procedure and expected_result but omit others"),
    /generic|missing/i, "must reject reminder missing provenance or would_fail_if");
  assert.throws(() => assertConcreteEvidenceReminder("Require method, fixture, procedure, provenance, would_fail_if"),
    /generic|missing/i, "must reject reminder missing expected_result");

  const sessionEvent = { ...f.event, hook_event_name: "SessionStart" };
  const sessionOutput = guard.hook(sessionEvent, f.home);
  assertConcreteEvidenceReminder(sessionOutput.hookSpecificOutput.additionalContext);

  const manifest = JSON.parse(fs.readFileSync(path.join(f.home, "hooks.json"), "utf8"));
  const sessionCommand = manifest.hooks.SessionStart.find((entry) =>
    entry.hooks && entry.hooks[0] && entry.hooks[0].command && entry.hooks[0].command.includes("codex-compliance.js"))?.hooks[0].command;
  if (sessionCommand) {
    const spawned = process.platform === "win32" ?
      spawnSync("powershell.exe", ["-NoProfile", "-Command", sessionCommand], { input: JSON.stringify(sessionEvent), encoding: "utf8" }) :
      spawnSync(process.execPath, [path.join(f.home, "dely-compliance", "codex-compliance.js"), "hook", "--home", f.home], { input: JSON.stringify(sessionEvent), encoding: "utf8" });
    assert.equal(spawned.status, 0, spawned.stderr);
    const parsed = JSON.parse(spawned.stdout);
    assertConcreteEvidenceReminder(parsed.hookSpecificOutput.additionalContext);
  }

  const promptEvent = { ...f.event, hook_event_name: "UserPromptSubmit", prompt: "Standard Control task prompt" };
  const promptOutput = guard.hook(promptEvent, f.home);
  assertConcreteEvidenceReminder(promptOutput.hookSpecificOutput.additionalContext);

  const specHash = guard.digest(f.task.spec);
  const workerPrompt = guard.hook({ ...f.event, hook_event_name: "UserPromptSubmit",
    prompt: "Task spec staged at spec.md (100 bytes, SHA-256: " + specHash + ") rcpt_0123456789abcdef" }, f.home);
  assert.match(workerPrompt.hookSpecificOutput.additionalContext, /workers inherit.*Control/i);
  assert.match(workerPrompt.hookSpecificOutput.additionalContext, /Do not prepare or review/);
  assertConcreteEvidenceReminder(workerPrompt.hookSpecificOutput.additionalContext);

  await f.prepare();
  f.review();
  assert.deepEqual(guard.hook(f.event, f.home), {});
});
