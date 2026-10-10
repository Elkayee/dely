"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const guard = require("./codex-compliance.js");
const routingPath = process.env.COMPLIANCE_ROUTING || path.join(os.homedir(),
  ".codex/plugins/cache/dely-orca-agy-global/dely/0.24.8/skills/delivery/scripts/task-routing.js");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-compliance-test-"));
  const home = path.join(directory, "home");
  const repo = path.join(directory, "repo");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "Keep changes scoped.\n");
  const advisor = path.join(directory, "advisor.js");
  fs.writeFileSync(advisor, 'const path = require("path");\nconst ROOT = path.resolve(__dirname, "..");\nexports.advise = async (input) => ({status:"NOT_EVALUATED", reason:"TEST_UNAVAILABLE", input_sha256:require("crypto").createHash("sha256").update(JSON.stringify(input)).digest("hex"), suggestion:null});\n');
  const skill = path.join(directory, "SKILL.md");
  fs.writeFileSync(skill, "Read the actual source before editing.\n");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "hooks.json"), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "existing-session-hook" }] }] },
  }));
  guard.install({ routing: routingPath, advisor }, home);
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

test("real routing review permits Hard; failed Jev advice remains explicit and skills are loaded", async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.skill_advice.status, "NOT_EVALUATED");
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  const reviewed = f.review();
  assert.equal(reviewed.route.workflow, "direct");
  assert.equal(reviewed.skill_review.evaluation_status, "NOT_EVALUATED");
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

for (const target of ["spec", "advice", "skill", "instructions", "dependency"]) {
  test("changed " + target + " invalidates authorization before a write", async (t) => {
    const f = fixture(t);
    await f.prepare();
    f.review();
    const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
    const file = { spec: state.assessment.task.spec_file, advice: state.skill_advice,
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
  await f.prepare();
  f.review({ difficulty: "easy", skills: '["required","dely:delivery"]', run: "run-one" });
  const coordinating = { ...f.event, tool_name: "Bash",
    tool_input: { command: 'rtk proxy node "' + f.settings.dely + '" dispatch --run run-one' } };
  assert.deepEqual(guard.hook(coordinating, f.home), {});
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  const state = JSON.parse(fs.readFileSync(guard.stateFile(f.home, "session"), "utf8"));
  const route = { event: "task_route", run: state.run, repo: f.repo, difficulty: "easy",
    specSha256: state.assessment.task.spec_sha256, contextSha256: state.assessment.task.context_sha256 };
  const dispatch = { event: "dispatch", run: state.run, repo: f.repo, phase: "implement",
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
    receiptMarker: "rcpt_1234567890abcdef",
    launch: { effective: { agent: "codex", model: "gpt-6-luna" } } };
  const event = { ...f.event, model: "gpt-6-luna" };
  assert.equal(guard.verifiedWorker(event, f.settings, handle), false);
  fs.writeFileSync(f.settings.journal, [dispatch, { event: "task_route", run, repo: f.repo,
    specSha256: "spec-hash" }].map(JSON.stringify).join("\n") + "\n");
  assert.equal(guard.verifiedWorker(event, f.settings, handle), false);
  fs.writeFileSync(inventory, JSON.stringify({ owned: true, terminalHandle: handle, dispatchId: "dispatch-test" }) + "\n");
  assert.equal(guard.verifiedWorker(event, f.settings, handle), false);
  const claim = { receipts: [dispatch.receiptMarker] };
  assert.equal(guard.verifiedWorker(event, f.settings, handle, claim), true);
  assert.equal(guard.verifiedWorker(event, f.settings, handle, { spec_sha256: dispatch.promptSha256 }), true);
  assert.equal(guard.verifiedWorker(f.event, f.settings, handle), false);
  assert.equal(guard.verifiedWorker(event, f.settings, "another-terminal"), false);
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
  assert.equal((await f.prepare()).skill_advice.reason, "TEST_UNAVAILABLE");
});

test("Windows hooks bypass shadowed Node and execute through the actual PowerShell seam", { skip: process.platform !== "win32" }, (t) => {
  const f = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.home, "hooks.json"), "utf8"));
  const command = manifest.hooks.PreToolUse[0].hooks[0].command;
  assert.ok(command.startsWith("& "));
  assert.ok(command.includes(process.execPath));
  const shadow = path.join(path.dirname(f.repo), "shadow");
  fs.mkdirSync(shadow);
  fs.writeFileSync(path.join(shadow, "node"), Buffer.from([127, 69, 76, 70]));
  const result = spawnSync("C:/Program Files/PowerShell/7/pwsh.exe", ["-NoProfile", "-Command", command],
    { input: JSON.stringify(f.event), encoding: "utf8", windowsHide: true, timeout: 5000,
      env: { ...process.env, PATH: shadow + path.delimiter + process.env.PATH } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("advice-only review never authorizes edits; Stop permits an honest blocked report", async (t) => {
  const f = fixture(t);
  f.task.mode = "advice";
  await f.prepare();
  f.review();
  assert.equal(guard.hook(f.event, f.home).hookSpecificOutput.permissionDecision, "deny");
  const stop = { ...f.event, hook_event_name: "Stop" };
  assert.equal(guard.hook(stop, f.home).decision, "block");
  assert.deepEqual(guard.hook(stop, f.home), {});
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
