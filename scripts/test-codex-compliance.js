"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const guard = require("./codex-compliance.js");
const routingPath = process.env.COMPLIANCE_ROUTING || path.join(os.homedir(),
  ".codex/plugins/cache/dely-orca-agy-global/dely/0.24.10/skills/delivery/scripts/task-routing.js");
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
  const file = guard.inputFile(f.home, "session", "turn");
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

test("once attempted, identical accepted tools do not rewrite session state", async (t) => {
  const f = fixture(t);
  await f.prepare();
  f.review();
  assert.deepEqual(guard.hook(f.event, f.home), {});
  const file = guard.stateFile(f.home, "session");
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
  const input = path.join(f.home, "dely-compliance", "inputs", guard.digest("session\0turn") + ".json");
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
  assert.equal((await f.prepare()).skill_selection.advice_status, "NOT_REQUESTED");
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
