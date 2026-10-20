"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const installer = require("./codex-compliance.js");
const guard = process.env.COMPLIANCE_ADAPTER ? require(path.resolve(process.env.COMPLIANCE_ADAPTER)) : installer;

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "native-advisory-"));
  const home = path.join(directory, "home"), repo = path.join(directory, "repo");
  fs.mkdirSync(home); fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "Keep advisory separate from authority.\n");
  installer.install({ routing: path.resolve(__dirname, "../skills/delivery/scripts/task-routing.js"),
    advisor: require.resolve("./jev_agent.js") }, home);
  const session = process.env.CODEX_THREAD_ID || "session", turn = "turn";
  const event = { session_id: session, turn_id: turn, cwd: repo, model: "gpt-6.1-sol" };
  guard.hook({ ...event, hook_event_name: "UserPromptSubmit", prompt: "Implement the scoped task" }, home);
  const state = JSON.parse(fs.readFileSync(guard.stateFile(home, session), "utf8"));
  const task = { mode: "advice", request: "Review the scoped plan", skills: [], required_skills: [],
    advisory: { mode: "plan", input: { request: "Review the scoped plan", tasks: [
      { id: "fix", objective: "Fix the known issue", scope: "One internal adapter", acceptance: "The regression passes", depends_on: [] },
    ] } } };
  const file = guard.inputFile(home, session, turn, state.input_nonce);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const save = () => fs.writeFileSync(file, JSON.stringify(task));
  save();
  const options = { session, turn, repo, "task-file": file };
  const settings = JSON.parse(fs.readFileSync(guard.settingsFile(home), "utf8"));
  const advisor = require(settings.advisor), original = advisor.advise;
  let calls = 0;
  advisor.advise = async (input, mode) => { calls++; return original(input, mode, { apiKey: "" }); };
  const command = [process.execPath, path.join(home, "dely-compliance/codex-compliance.js"), "advise",
    "--session", session, "--turn", turn, "--repo", repo, "--home", home, "--task-file", file]
    .map(word => '"' + word + '"').join(" ");
  const shell = (text = command) => guard.hook({ ...event, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: text } }, home);
  t.after(() => { delete require.cache[require.resolve(settings.advisor)]; fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, home, repo, event, state, task, file, save, options, settings, advisor, shell, command, calls: () => calls };
}

test("current native advisory is allowed before review but never admits a source edit", async t => {
  const f = fixture(t), before = fs.readFileSync(guard.stateFile(f.home, f.options.session), "utf8");
  assert.notEqual(f.shell().hookSpecificOutput?.permissionDecision, "deny");
  const result = await guard.advisory(f.options, f.home);
  assert.equal(result.status, "NOT_EVALUATED");
  assert.equal(result.reason, "TYPESAFE_API_KEY_MISSING");
  assert.equal(f.calls(), 1);
  assert.equal(fs.readFileSync(guard.stateFile(f.home, f.options.session), "utf8"), before);
  const edit = guard.hook({ ...f.event, hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: "source edit" }, f.home);
  assert.equal(edit.hookSpecificOutput.permissionDecision, "deny");
  const evidence = JSON.parse(fs.readFileSync(result.output_file, "utf8"));
  assert.equal(evidence.binding.task_sha256, guard.digest(fs.readFileSync(f.file)));
  assert.equal(evidence.result.input_sha256, evidence.binding.input_sha256);
});

test("identical completed advice is reused without another provider call", async t => {
  const f = fixture(t), first = await guard.advisory(f.options, f.home);
  const bytes = fs.readFileSync(first.output_file, "utf8");
  const second = await guard.advisory(f.options, f.home);
  assert.equal(second.reused, true); assert.equal(f.calls(), 1);
  assert.equal(fs.readFileSync(second.output_file, "utf8"), bytes);
  f.task.request += " changed"; f.save();
  await assert.rejects(guard.advisory(f.options, f.home));
  assert.equal(f.calls(), 1);
});

test("validated provider plan evidence is preserved without approving the task", async t => {
  const f = fixture(t), original = require("./jev_agent.js").advise;
  f.advisor.advise = (input, mode) => original(input, mode, { apiKey: "test", fetch: async (_url, init) => {
    const sent = JSON.parse(init.body);
    const answers = Object.fromEntries(Object.entries(sent.questions).map(([id, question]) => {
      const labels = Object.keys(question.criteria), choice = labels[0];
      return [id, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(labels.map(label => [label, Number(label === choice)])) }];
    }));
    return { ok: true, status: 200, json: async () => ({ model: "jev-1.13.0", answers }) };
  } });
  const result = await guard.advisory(f.options, f.home);
  assert.equal(result.status, "REVIEW_REQUIRED");
  const proof = JSON.parse(fs.readFileSync(result.output_file, "utf8"));
  assert.deepEqual(proof.result.submitted_plan, f.task.advisory.input);
  assert.equal(JSON.parse(fs.readFileSync(guard.stateFile(f.home, f.options.session), "utf8")).status, "PENDING");
});

test("concurrent and interrupted attempts cannot repeat the provider request", async t => {
  const f = fixture(t);
  let release;
  f.advisor.advise = (input, mode) => new Promise(resolve => { release = () => resolve({ mode, status: "NOT_EVALUATED", reason: "TEST", input_sha256: guard.digest(JSON.stringify(input)) }); });
  const first = guard.advisory(f.options, f.home);
  await assert.rejects(guard.advisory(f.options, f.home), /incomplete|progress/i);
  release(); const result = await first;
  fs.unlinkSync(result.output_file);
  await assert.rejects(guard.advisory(f.options, f.home), /incomplete|progress/i);
});

test("native exemption rejects foreign identity, runtime, paths, flags and compound commands", async t => {
  const f = fixture(t);
  for (const command of [f.command.replace(f.options.session, "foreign-session"),
    f.command.replace('"--turn" "turn"', '"--turn" "stale"'),
    f.command.replace(process.execPath, path.join(f.directory, "node.exe")),
    f.command + ' --out "' + path.join(f.repo, "escape.json") + '"',
    f.command + " ; node other.js", f.command.replace('"advise"', '"unknown"')]) {
    assert.equal(f.shell(command).hookSpecificOutput?.permissionDecision, "deny", command);
  }
  assert.equal(f.calls(), 0);
});

test("advisory rejects malformed, oversized and substituted task input before provider work", async t => {
  const f = fixture(t), original = fs.readFileSync(f.file);
  for (const content of ["{", " ".repeat(256 * 1024 + 1), JSON.stringify({ ...f.task, advisory: { mode: "execute", input: {} } }),
    JSON.stringify({ ...f.task, required_skills: ["missing"] }),
    JSON.stringify({ ...f.task, advisory: { mode: "plan", input: { request: "different task", tasks: [] } } })]) {
    fs.writeFileSync(f.file, content);
    await assert.rejects(guard.advisory(f.options, f.home));
  }
  fs.writeFileSync(f.file, original);
  const other = path.join(f.directory, "other.json"); fs.copyFileSync(f.file, other);
  await assert.rejects(guard.advisory({ ...f.options, "task-file": other }, f.home));
  assert.equal(f.calls(), 0);
});

test("changed frozen dependency or evidence binding is rejected", async t => {
  const f = fixture(t), first = await guard.advisory(f.options, f.home);
  const proof = JSON.parse(fs.readFileSync(first.output_file, "utf8"));
  proof.binding.task_sha256 = "0".repeat(64); fs.writeFileSync(first.output_file, JSON.stringify(proof));
  await assert.rejects(guard.advisory(f.options, f.home));
  fs.appendFileSync(f.settings.advisor, "\n// changed\n");
  await assert.rejects(guard.advisory(f.options, f.home), /changed/i);
  assert.equal(f.calls(), 1);
});

test("input and evidence symlinks cannot redirect pre-admission writes", async t => {
  const f = fixture(t), actual = path.join(f.directory, "actual.json");
  fs.renameSync(f.file, actual);
  try { fs.symlinkSync(actual, f.file, "file"); }
  catch (error) { if (error.code === "EPERM") return t.skip("Windows file symlink privilege unavailable"); throw error; }
  await assert.rejects(guard.advisory(f.options, f.home), /link/i);
  assert.equal(f.calls(), 0);
});

test("managed evidence directories cannot be replaced with junctions", async t => {
  const f = fixture(t), first = await guard.advisory(f.options, f.home);
  const directory = path.dirname(first.output_file), moved = path.join(f.directory, "moved");
  fs.renameSync(directory, moved);
  fs.symlinkSync(moved, directory, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(guard.advisory(f.options, f.home), /link/i);
  assert.equal(f.calls(), 1);
});

test("a changed prompt during transport cannot persist successful advice", async t => {
  const f = fixture(t);
  f.advisor.advise = async (input, mode) => {
    guard.hook({ ...f.event, turn_id: "new-turn", hook_event_name: "UserPromptSubmit", prompt: "changed task" }, f.home);
    return { mode, status: "REVIEW_REQUIRED", input_sha256: guard.digest(JSON.stringify(input)) };
  };
  await assert.rejects(guard.advisory(f.options, f.home), /current|changed/i);
});

test("a replaced in-flight reservation cannot produce a completed result", async t => {
  const f = fixture(t);
  f.advisor.advise = async (input, mode) => {
    const base = path.join(f.home, "dely-compliance/tasks");
    const dir = fs.readdirSync(base).find(name => name.startsWith("advisory-"));
    fs.writeFileSync(path.join(base, dir, "request.json"), "{}");
    return { mode, status: "REVIEW_REQUIRED", input_sha256: guard.digest(JSON.stringify(input)) };
  };
  await assert.rejects(guard.advisory(f.options, f.home), /reservation changed/i);
});

test("provider exception stays unavailable and cannot be retried implicitly", async t => {
  const f = fixture(t); let calls = 0;
  f.advisor.advise = async () => { calls++; throw Error("private transport details"); };
  const first = await guard.advisory(f.options, f.home);
  assert.equal(first.status, "NOT_EVALUATED"); assert.equal(first.reason, "ADVISOR_UNAVAILABLE");
  assert.doesNotMatch(fs.readFileSync(first.output_file, "utf8"), /private transport/);
  await guard.advisory(f.options, f.home); assert.equal(calls, 1);
});

test("skill advice must retain the native supplied roster and remains optional", async t => {
  const f = fixture(t);
  f.task.advisory = { mode: "skill", input: { request: f.task.request, skills: [] } }; f.save();
  const result = await guard.advisory(f.options, f.home);
  assert.equal(result.status, "NOT_APPLICABLE");
  assert.equal(JSON.parse(fs.readFileSync(guard.stateFile(f.home, f.options.session), "utf8")).status, "PENDING");
});

test("context advice retains code and provenance and a substituted skill roster is refused", async t => {
  const f = fixture(t);
  f.task.advisory = { mode: "context", input: { request: f.task.request, candidates: [
    { id: "code", path: path.join(f.repo, "adapter.js"), source: "const value = 1;", line_start: 0, line_end: 0, required: true },
  ] } }; f.save();
  const result = await guard.advisory(f.options, f.home);
  const proof = JSON.parse(fs.readFileSync(result.output_file, "utf8"));
  assert.deepEqual(proof.result.ranked_context, f.task.advisory.input.candidates);
  f.task.advisory = { mode: "skill", input: { request: f.task.request, skills: [
    { name: "substitute", path: path.join(f.repo, "SKILL.md"), description: "Not in the native roster" },
  ] } }; f.save();
  await assert.rejects(guard.advisory(f.options, f.home));
});

test("native CLI refuses arbitrary output or input flags without a provider request", t => {
  const f = fixture(t);
  const cli = spawnSync(process.execPath, [path.join(f.home, "dely-compliance/codex-compliance.js"), "advise",
    ...Object.entries({ ...f.options, home: f.home }).flatMap(([key, value]) => ["--" + key, value]),
    "--task-json", JSON.stringify(f.task)], { encoding: "utf8" });
  assert.equal(cli.status, 2); assert.equal(f.calls(), 0);
});

test("native advise CLI writes only managed evidence with no reviewed task", t => {
  const f = fixture(t);
  // An invalid graph is validated locally before credential lookup or transport.
  f.task.advisory.input.tasks[0].depends_on = ["fix"]; f.save();
  const cli = spawnSync(process.execPath, [path.join(f.home, "dely-compliance/codex-compliance.js"), "advise",
    ...Object.entries({ ...f.options, home: f.home }).flatMap(([key, value]) => ["--" + key, value])], { encoding: "utf8" });
  assert.equal(cli.status, 2); assert.equal(f.calls(), 0);
});
