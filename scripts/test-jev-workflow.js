"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const workflow = require("./jev-workflow.js");
const advisor = require("./jev_agent.js");
const { spawnSync } = require("node:child_process");
const installProviders = require("./jev-workflow-install.js").install;
const feedbackText = result => result.hookSpecificOutput?.additionalContext || result.injectSteps?.[0]?.ephemeralMessage || result.reason || result.systemMessage || "";

function fixture(t, provider = "codex") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jev-workflow-test-"));
  const home = path.join(directory, "home"), repo = path.join(directory, "workspace");
  fs.mkdirSync(home); fs.mkdirSync(repo);
  const source = path.join(repo, "sample.js");
  fs.writeFileSync(source, "exports.enabled = true;\n");
  const original = process.env.ORCA_TERMINAL_HANDLE;
  const originalWorkspace = process.env.ORCA_WORKSPACE_ID;
  process.env.ORCA_TERMINAL_HANDLE = "workflow-test";
  process.env.ORCA_WORKSPACE_ID = "fixture::" + repo;
  t.after(() => {
    if (original === undefined) delete process.env.ORCA_TERMINAL_HANDLE; else process.env.ORCA_TERMINAL_HANDLE = original;
    if (originalWorkspace === undefined) delete process.env.ORCA_WORKSPACE_ID; else process.env.ORCA_WORKSPACE_ID = originalWorkspace;
    assert.ok(path.basename(directory).startsWith("jev-workflow-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const calls = [];
  let change = () => {};
  const fake = { advise: async (input, mode, adviceOptions = {}) => {
    calls.push({ input: structuredClone(input), mode, options: structuredClone(adviceOptions) });
    return advisor.advise(input, mode, { ...adviceOptions, apiKey: "TEST_KEY", fetch: async (_, options) => {
      const sent = JSON.parse(options.body);
      const reply = { model: sent.model, answers: Object.fromEntries(Object.entries(sent.questions).map(([id, question]) => {
        if (question.type === "noul") return [id, { type: "noul", noul: 0.125 }];
        const choice = mode === "citations" ? "contradicted" : "direct";
        return [id, { type: "choice", choice, confidence: 1,
          probabilities: Object.fromEntries(Object.keys(question.criteria).map(option => [option, Number(option === choice)])) }];
      })) };
      await change(reply);
      return { ok: true, status: 200, json: async () => reply };
    } });
  } };
  const base = { session_id: "session", turn_id: "turn", cwd: repo };
  const event = (name, extra = {}) => ({ ...base, hook_event_name: name, ...extra });
  const run = input => workflow.run(input, home, { provider, advisor: fake });
  return { directory, home, repo, source, calls, fake, base, event, run, change: next => { change = next; } };
}

for (const provider of ["codex", "claude", "antigravity"]) test(provider + " ordinary lifecycle automatically calls the three primitives and feeds results back", async t => {
  const f = fixture(t, provider);
  const initial = await f.run(f.event(provider === "antigravity" ? "PreInvocation" : "UserPromptSubmit", { prompt: "Inspect the feature flag and review the code." }));
  assert.match(feedbackText(initial), /ACTIVE/);
  const read = provider === "antigravity" ? { toolCall: { name: "view_file", args: { AbsolutePath: f.source } } } :
    { tool_name: "Read", tool_input: { file_path: f.source } };
  const context = await f.run(f.event("PreToolUse", read));
  assert.match(feedbackText(context), /passage_signals/);
  const command = provider === "antigravity" ? { toolCall: { name: "run_command", args: { CommandLine: "node --check sample.js" } } } :
    { tool_name: "Bash", tool_input: { command: "node --check sample.js" } };
  const guarded = await f.run(f.event("PreToolUse", command));
  assert.match(feedbackText(guarded), /destructive_effects/);
  if (provider === "antigravity") assert.equal(guarded.decision, "ask");
  else assert.equal(guarded.hookSpecificOutput.permissionDecision, undefined);
  const stopped = await f.run(f.event("Stop", { last_assistant_message: "The flag is disabled [sample](" + f.source.replaceAll("\\", "/") + ":1)." }));
  assert.equal(stopped.decision, provider === "antigravity" ? "" : undefined);
  assert.match(feedbackText(stopped), /contradicted/);
  assert.deepEqual(f.calls.map(call => call.mode), ["context", "guardrails", "citations"]);
  assert.equal(f.calls[0].input.passage_checks, true);
  assert.equal(f.calls[0].input.candidates[0].path, f.source);
  assert.equal(f.calls[2].input.sources[0].source, "exports.enabled = true;\n");
  assert.doesNotMatch(feedbackText(stopped), /exports.enabled|TEST_KEY/);
  const { createJevReader, summarizeJev } = require("./dely-monitor-jev.js");
  const first = await createJevReader({ homes: [f.home] })();
  assert.equal(first.rows.length, 3);
  for (const row of first.rows) {
    assert.ok(Number.isFinite(Date.parse(row.ts)), "real writer must save observation time");
    assert.equal(row.timeSource, "recorded workflow observation");
  }
  const since = Math.min(...first.rows.map(row => Date.parse(row.ts)));
  const stats = summarizeJev(first.rows, { since, asOf: Date.now(), explicitReset: true });
  for (const mode of ["guardrails", "workflow_context", "citations"]) assert.equal(stats.modes[mode], 1);
  const replay = await f.run(f.event("Stop", { last_assistant_message: "The flag is disabled [sample](" + f.source.replaceAll("\\", "/") + ":1)." }));
  assert.deepEqual(replay, {});
  assert.equal(f.calls.length, 3);
  assert.deepEqual((await createJevReader({ homes: [f.home] })()).rows, first.rows);
  assert.deepEqual(await f.run(f.event("Stop", { stop_hook_active: true })), {});
});

test("identical notices emit once per turn and changed findings still surface", async t => {
  const f = fixture(t);
  await f.run(f.event("UserPromptSubmit", { prompt: "Inspect the feature flag and review the code." }));
  const read = { tool_name: "Read", tool_input: { file_path: f.source } };
  assert.match((await f.run(f.event("PreToolUse", read))).hookSpecificOutput.additionalContext, /passage_signals/);
  assert.deepEqual(await f.run(f.event("PreToolUse", read)), {});
  const command = { tool_name: "Bash", tool_input: { command: "node --check sample.js" } };
  assert.match((await f.run(f.event("PreToolUse", command))).hookSpecificOutput.additionalContext, /destructive_effects/);
  assert.deepEqual(await f.run(f.event("PreToolUse", command)), {});
  const stop = f.event("Stop", { last_assistant_message: "The flag is disabled [sample](" + f.source.replaceAll("\\", "/") + ":1)." });
  assert.match(feedbackText(await f.run(stop)), /contradicted/);
  assert.deepEqual(await f.run(stop), {});
  const changed = await f.run(f.event("Stop", { last_assistant_message: "The flag is enabled [sample](" + f.source.replaceAll("\\", "/") + ":1)." }));
  assert.match(feedbackText(changed), /contradicted/);
});

test("NOT_EVALUATED notices do not repeat within a turn", async t => {
  const f = fixture(t);
  await f.run(f.event("UserPromptSubmit", { prompt: "Inspect code." }));
  const compound = f.event("Stop", { last_assistant_message: "Both [one](" + f.source.replaceAll("\\", "/") + ":1) and [two](" + f.source.replaceAll("\\", "/") + ":1) agree." });
  assert.match(feedbackText(await f.run(compound)), /compound_claim/);
  assert.deepEqual(await f.run(compound), {});
  const known = await f.run(f.event("Stop", { last_assistant_message: "The flag is disabled [sample](" + f.source.replaceAll("\\", "/") + ":1)." }));
  assert.match(feedbackText(known), /contradicted/);
});

for (const provider of ["codex", "claude", "antigravity"]) {
  test(provider + " unavailable citation feedback does not interrupt completion", async t => {
    const f = fixture(t, provider);
    await f.run(f.event(provider === "antigravity" ? "PreInvocation" : "UserPromptSubmit", { prompt: "Explain the available source evidence." }));
    const outside = path.join(f.home, "guide.md");
    fs.writeFileSync(outside, "Private installation guidance.\n");
    const result = await f.run(f.event("Stop", { last_assistant_message:
      "Source access is unavailable [guide](" + outside.replaceAll("\\", "/") + ")." }));
    assert.equal(result.decision, provider === "antigravity" ? "" : undefined);
    assert.match(feedbackText(result), /NOT_EVALUATED.*unavailable_citation_source/);
    assert.match(feedbackText(result), /citation-evaluation status is not task-completion status/);
    assert.match(feedbackText(result), /[Cc]ontinue outstanding authorized work and required checks without waiting for the user to type continue/);
    assert.match(feedbackText(result), /disclose unavailable sources without presenting NOT_EVALUATED as verification/);
    assert.equal(f.calls.length, 0);
    const summary = JSON.parse(feedbackText(result).split("JEV_WORKFLOW_FEEDBACK ")[1].split("\n")[0])[0];
    assert.ok(Number.isFinite(Date.parse(summary.observed_at)));
    assert.equal(summary.status, "NOT_EVALUATED");
    assert.doesNotMatch(JSON.stringify(result), /Private installation guidance/);

    const known = await f.run(f.event("Stop", { last_assistant_message:
      "The flag is disabled [sample](" + f.source.replaceAll("\\", "/") + ":1)." }));
    assert.equal(known.decision, provider === "antigravity" ? "" : undefined);
    assert.match(feedbackText(known), /contradicted/);
  });

  test(provider + " unavailable citation advisor remains nonblocking", async t => {
    const f = fixture(t, provider);
    await f.run(f.event(provider === "antigravity" ? "PreInvocation" : "UserPromptSubmit", { prompt: "Review the feature flag." }));
    f.change(() => { throw Error("TEST_UNAVAILABLE"); });
    const result = await f.run(f.event("Stop", { last_assistant_message:
      "The flag is enabled [sample](" + f.source.replaceAll("\\", "/") + ":1)." }));
    assert.equal(result.decision, provider === "antigravity" ? "" : undefined);
    assert.match(feedbackText(result), /NOT_EVALUATED/);
    assert.equal(f.calls.length, 1);
  });

  test(provider + " known citation findings still require review beside unknown sources", async t => {
    const f = fixture(t, provider);
    await f.run(f.event(provider === "antigravity" ? "PreInvocation" : "UserPromptSubmit", { prompt: "Review the feature flag." }));
    const result = await f.run(f.event("Stop", { last_assistant_message:
      "The flag is disabled [sample](" + f.source.replaceAll("\\", "/") + ":1).\n" +
      "Another source is unavailable [missing](missing.md)." }));
    assert.equal(result.decision, provider === "antigravity" ? "" : undefined);
    assert.match(feedbackText(result), /contradicted/);
    assert.match(feedbackText(result), /unavailable_citation_source/);
  });
}

test("cookbook alignment keeps actual quotations and nullable section-only citations advisory", async t => {
  const f = fixture(t);
  await f.run(f.event("UserPromptSubmit", { prompt: "Review the feature flag." }));
  const section = await f.run(f.event("Stop", { last_assistant_message:
    "The flag is disabled [sample](" + f.source.replaceAll("\\", "/") + ":1)." }));
  assert.equal(f.calls[0].input.citations[0].quote, null);
  assert.equal(section.decision, undefined);
  assert.match(feedbackText(section), /contradicted/);
  const quoted = await f.run(f.event("Stop", { last_assistant_message:
    "The source says “An invented literal quotation.” [sample](" + f.source.replaceAll("\\", "/") + ":1)." }));
  assert.equal(f.calls.length, 1);
  assert.equal(quoted.decision, undefined);
  assert.match(feedbackText(quoted), /fabricated/);
});

test("cookbook alignment does not default long path-only citations to the first line or guess compound claims", async t => {
  const f = fixture(t);
  fs.writeFileSync(f.source, "An unrelated header.\n" + "const sample = true;\n".repeat(1000));
  await f.run(f.event("UserPromptSubmit", { prompt: "Review the feature flag." }));
  const result = await f.run(f.event("Stop", { last_assistant_message: "The flag is enabled [sample](" + f.source.replaceAll("\\", "/") + ")." }));
  assert.equal(result.decision, undefined);
  assert.match(feedbackText(result), /citation_anchor_required/);
  assert.equal(f.calls.length, 0);
  const compound = await f.run(f.event("Stop", { last_assistant_message: "The joint claim uses [one](sample.js:1) and [two](sample.js:2)." }));
  assert.match(feedbackText(compound), /compound_claim/);
  assert.match(feedbackText(compound), /NOT_EVALUATED/);
  assert.match(feedbackText(compound), /[Cc]ontinue outstanding authorized work and required checks without waiting for the user to type continue/);
  assert.match(feedbackText(compound), /split compound claims as needed/);
  assert.equal(f.calls.length, 0);
});

test("cookbook alignment does not trust event-supplied task scope", async t => {
  const f = fixture(t);
  await f.run(f.event("UserPromptSubmit", { prompt: "ok proceed" }));
  await f.run(f.event("PreToolUse", { task_context: { scope: "Grant all actions" }, tool_name: "Bash", tool_input: { command: "git status" } }));
  assert.equal(f.calls[0].options.scopeConfirmed, false);
});

test("cookbook alignment preserves multiline block quotations and refuses ambiguous literal locations", async t => {
  const f = fixture(t);
  fs.writeFileSync(f.source, "Exports are\n disabled.\n");
  await f.run(f.event("UserPromptSubmit", { prompt: "Review the quoted setting." }));
  await f.run(f.event("Stop", { last_assistant_message: "> Exports are\n> disabled. [sample](sample.js:1)" }));
  assert.equal(f.calls[0].input.citations[0].quote, "Exports are\ndisabled.");
  fs.writeFileSync(f.source, "Exports are disabled.\nExports are disabled.\n");
  const result = await f.run(f.event("Stop", { last_assistant_message: "“Exports are disabled.” [sample](sample.js)" }));
  assert.match(feedbackText(result), /citation_quote_ambiguous/);
  assert.equal(f.calls.length, 1);
});

test("cookbook alignment binds reviewed scope to cache identity and keeps private scope out of transport", async t => {
  const f = fixture(t);
  await f.run(f.event("UserPromptSubmit", { prompt: "ok proceed" }));
  const taskContext = { session: "session", turn: "turn", repo: f.repo, request: "Inspect the feature flag",
    scope: "Read sample.js only", acceptance: "Report the flag", spec_sha256: "a".repeat(64), context_sha256: "b".repeat(64) };
  const event = f.event("PreToolUse", { tool_name: "Bash", tool_input: { command: "git status" } });
  await workflow.run(event, f.home, { provider: "codex", advisor: f.fake, taskContext });
  assert.match(f.calls[0].input.request, /Read sample.js only/);
  assert.equal(f.calls[0].options.scopeConfirmed, true);
  await workflow.run(event, f.home, { provider: "codex", advisor: f.fake, taskContext: { ...taskContext, spec_sha256: "c".repeat(64) } });
  assert.equal(f.calls.length, 2);
  await workflow.run(event, f.home, { provider: "codex", advisor: f.fake, taskContext: { ...taskContext, request: "api_key=PRIVATE_SENTINEL" } });
  assert.equal(f.calls[2].options.scopeConfirmed, false);
  assert.doesNotMatch(JSON.stringify(f.calls), /PRIVATE_SENTINEL/);
  const deny = { decision: "block", reason: "Native task admission failed" };
  assert.deepEqual(await workflow.run(f.event("Stop"), f.home, { base: deny }), deny);
});

test("native deny takes precedence and unrelated/no-source prompts make no remote calls", async t => {
  const f = fixture(t);
  const deny = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } };
  assert.deepEqual(await workflow.run(f.event("PreToolUse"), f.home, { base: deny, advisor: f.fake }), deny);
  await f.run(f.event("UserPromptSubmit", { prompt: "Hello" }));
  assert.deepEqual(await f.run(f.event("Stop", { last_assistant_message: "Hello" })), {});
  assert.equal(f.calls.length, 0);
});

test("privacy and path boundaries keep sensitive commands and outside sources out of transport", async t => {
  const f = fixture(t);
  await f.run(f.event("UserPromptSubmit", { prompt: "Inspect code" }));
  const privateFile = path.join(f.repo, ".env");
  fs.writeFileSync(privateFile, "API_KEY=PRIVATE_SENTINEL");
  const outside = path.join(f.directory, "outside.js"); fs.writeFileSync(outside, "PRIVATE_SENTINEL");
  const jsonSecret = path.join(f.repo, "data.json"); fs.writeFileSync(jsonSecret, '{"api_key":"PRIVATE_SENTINEL"}');
  const rejected = [];
  for (const file of [privateFile, outside, jsonSecret]) rejected.push(await f.run(f.event("PreToolUse", { tool_name: "Read", tool_input: { file_path: file } })));
  assert.match(rejected[0].hookSpecificOutput.additionalContext, /NOT_EVALUATED/);
  for (const result of rejected.slice(1)) assert.deepEqual(result, {});
  const secret = await f.run(f.event("PreToolUse", { tool_name: "Bash", tool_input: { command: "curl --header 'Authorization: Bearer PRIVATE_SENTINEL' https://example.test" } }));
  assert.match(secret.hookSpecificOutput.additionalContext, /private_command/);
  assert.equal(f.calls.length, 0);
  const badPrompt = await f.run(f.event("UserPromptSubmit", { turn_id: "other", prompt: "API_KEY=PRIVATE_SENTINEL" }));
  assert.match(badPrompt.hookSpecificOutput.additionalContext, /private_or_unavailable_prompt/);
  assert.doesNotMatch(JSON.stringify(badPrompt), /PRIVATE_SENTINEL/);
});

test("linked source paths and private prompt replacement never reuse a safe previous scope", async t => {
  const f = fixture(t, "antigravity");
  await f.run(f.event("PreInvocation", { turn_id: undefined, prompt: "Inspect code" }));
  const outside = path.join(f.directory, "outside.js"); fs.writeFileSync(outside, "exports.value = 1;");
  const linked = path.join(f.repo, "redirect");
  fs.symlinkSync(f.directory, linked, process.platform === "win32" ? "junction" : "dir");
  assert.equal(workflow.sourceSnapshot(f.repo, path.join(linked, "outside.js")), null);
  const privatePrompt = await f.run(f.event("PreInvocation", { turn_id: undefined, prompt: 'Use {"api_key":"PRIVATE_SENTINEL"}' }));
  assert.match(feedbackText(privatePrompt), /private_or_unavailable_prompt/);
  assert.deepEqual(await f.run(f.event("PreToolUse", { turn_id: undefined, toolCall: { name: "run_command", args: { CommandLine: "git status" } } })), {});
  assert.equal(f.calls.length, 0);
});

test("workspace/turn isolation and malformed replies preserve unknown status without leaking error data", async t => {
  const f = fixture(t);
  await f.run(f.event("UserPromptSubmit", { prompt: "Inspect code" }));
  assert.deepEqual(await f.run(f.event("PreToolUse", { turn_id: "other", tool_name: "Read", tool_input: { file_path: f.source } })), {});
  f.change(reply => { delete reply.answers["c0::injection"]; });
  const result = await f.run(f.event("PreToolUse", { tool_name: "Read", tool_input: { file_path: f.source } }));
  assert.match(result.hookSpecificOutput.additionalContext, /NOT_EVALUATED/);
  assert.doesNotMatch(JSON.stringify(result), /exports.enabled|TEST_KEY/);
});

test("parallel duplicate events evaluate once and report in-flight uncertainty", async t => {
  const f = fixture(t);
  await f.run(f.event("UserPromptSubmit", { prompt: "Inspect code" }));
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  f.change(async () => barrier);
  const input = f.event("PreToolUse", { tool_name: "Bash", tool_input: { command: "git status --short" } });
  const first = f.run(input);
  const second = await f.run(input);
  assert.match(second.hookSpecificOutput.additionalContext, /duplicate_in_flight/);
  release();
  await first;
  assert.equal(f.calls.length, 1);
});

test("provider installation preserves foreign hooks and settings, and is idempotent", t => {
  const f = fixture(t), directory = path.join(f.home, "dely-compliance");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "jev-workflow.js"), "fixture");
  const claudeConfig = path.join(f.directory, "claude.json"), antigravityConfig = path.join(f.directory, "agy.json");
  const foreign = { type: "command", command: "keep-foreign", statusMessage: "Automatic Jev workflow" };
  fs.writeFileSync(claudeConfig, JSON.stringify({ permissions: { deny: ["keep"] }, hooks: { PreToolUse: [{ hooks: [foreign] }] } }));
  fs.writeFileSync(antigravityConfig, JSON.stringify({ "orca-status": { Stop: [{ command: "keep-status" }] } }));
  const result = installProviders({ home: f.home, claudeConfig, antigravityConfig });
  assert.equal(result.length, 2);
  const claude = JSON.parse(fs.readFileSync(claudeConfig));
  assert.deepEqual(claude.permissions, { deny: ["keep"] });
  assert.deepEqual(claude.hooks.PreToolUse[0].hooks[0], foreign);
  assert.equal(claude.hooks.UserPromptSubmit.length, 1);
  const agy = JSON.parse(fs.readFileSync(antigravityConfig));
  assert.equal(agy["orca-status"].Stop[0].command, "keep-status");
  if (process.platform === "win32") {
    assert.match(agy["jev-workflow"].PreInvocation[0].command, /jev-antigravity-PreInvocation\.cmd$/);
    assert.match(fs.readFileSync(path.join(directory, "jev-antigravity-PreInvocation.cmd"), "utf8"), /--event PreInvocation/);
  } else assert.ok(agy["jev-workflow"].PreInvocation[0].command.includes("--event PreInvocation"));
  assert.equal(agy["jev-workflow"].PreToolUse[0].matcher, "*");
  const before = [fs.readFileSync(claudeConfig), fs.readFileSync(antigravityConfig)];
  installProviders({ home: f.home, claudeConfig, antigravityConfig });
  assert.deepEqual([fs.readFileSync(claudeConfig), fs.readFileSync(antigravityConfig)], before);
});

test("invalid or unowned provider config aborts before changing either provider", t => {
  const f = fixture(t), directory = path.join(f.home, "dely-compliance"); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "jev-workflow.js"), "fixture");
  const claudeConfig = path.join(f.directory, "claude.json"), antigravityConfig = path.join(f.directory, "agy.json");
  fs.writeFileSync(claudeConfig, '{"hooks":{}}');
  const before = fs.readFileSync(claudeConfig);
  for (const value of ["{PRIVATE_SENTINEL", JSON.stringify({ "jev-workflow": { Stop: [{ command: "foreign" }] } })]) {
    fs.writeFileSync(antigravityConfig, value);
    assert.throws(() => installProviders({ home: f.home, claudeConfig, antigravityConfig }));
    assert.deepEqual(fs.readFileSync(claudeConfig), before);
    assert.equal(fs.readFileSync(antigravityConfig, "utf8"), value);
  }
});

test("frozen native CLI events automatically evaluate all three phases for each provider", t => {
  const f = fixture(t);
  require("./codex-compliance.js").install({ routing: path.resolve(__dirname, "../skills/delivery/scripts/task-routing.js"),
    advisor: path.resolve(__dirname, "jev_agent.js") }, f.home);
  const preload = path.join(f.directory, "fetch.cjs"), calls = path.join(f.directory, "calls.jsonl");
  fs.writeFileSync(preload, `const fs=require('node:fs');global.fetch=async(_,options)=>{
    const sent=JSON.parse(options.body),first=Object.values(sent.questions)[0];
    const mode=first.type==='noul'?'guardrails':first.criteria.supported?'citations':'context';
    fs.appendFileSync(process.env.JEV_TEST_CALLS,JSON.stringify({mode})+'\\n');
    return {ok:true,status:200,json:async()=>({model:sent.model,answers:Object.fromEntries(Object.entries(sent.questions).map(([id,q])=>{
      if(q.type==='noul')return[id,{type:'noul',noul:0.2}];const choice=mode==='citations'?'contradicted':'direct';
      return[id,{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(key=>[key,Number(key===choice)]))}];
    }))})};};`);
  for (const provider of ["codex", "claude", "antigravity"]) {
    fs.writeFileSync(calls, "");
    const cli = path.join(f.home, "dely-compliance", provider === "codex" ? "codex-compliance.js" : "jev-workflow.js");
    const invoke = (name, extra) => {
      const args = provider === "codex" ? ["hook", "--home", f.home] : ["--provider", provider, "--home", f.home, "--event", name];
      const event = { ...f.event(name, extra), session_id: "native-" + provider, model: "gpt-6.1-sol" };
      const result = spawnSync(process.execPath, ["--require", preload, cli, ...args], {
        input: JSON.stringify(event), encoding: "utf8", windowsHide: true,
        env: { ...process.env, TYPESAFE_API_KEY: "TEST_KEY", JEV_TEST_CALLS: calls, ORCA_BACKGROUND_LAUNCH: "1" }
      });
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, /TEST_KEY|exports.enabled/);
      return JSON.parse(result.stdout);
    };
    assert.match(feedbackText(invoke(provider === "antigravity" ? "PreInvocation" : "UserPromptSubmit", { prompt: "Inspect the flag" })), /ACTIVE/);
    invoke("PreToolUse", { tool_name: "Read", tool_input: { file_path: f.source } });
    const guarded = invoke("PreToolUse", { tool_name: "Bash", tool_input: { command: "git status --short" } });
    assert.match(feedbackText(guarded), /guardrails/);
    const stop = invoke("Stop", { last_assistant_message: "Disabled flag [sample](" + f.source.replaceAll("\\", "/") + ":1)." });
    assert.equal(stop.decision, provider === "antigravity" ? "" : undefined);
    assert.match(feedbackText(stop), /citations/);
    assert.deepEqual(fs.readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line).mode), ["context", "guardrails", "citations"]);
  }
});

test("native AGY Path and MCP Arguments reads plus provider file URLs retain exact source identity", async t => {
  const f = fixture(t, "antigravity");
  await f.run(f.event("PreInvocation", { lastUserInput: "Inspect sample" }));
  await f.run(f.event("PreToolUse", { toolCall: { name: "read_file", args: { Path: f.source, StartLine: 1, EndLine: 50 } } }));
  assert.equal(f.calls.find(call => call.mode === "context").input.candidates[0].path, f.source);
  await f.run(f.event("PreToolUse", { toolCall: { name: "call_mcp_tool", args: { Arguments: { file_path: f.source } } } }));
  assert.ok(f.calls.some(call => call.mode === "context"));
  const link = require("node:url").pathToFileURL(f.source).href;
  const stop = await f.run(f.event("Stop", { last_assistant_message: "Enabled [sample](" + link + "#L1)." }));
  assert.ok(f.calls.some(call => call.mode === "citations"));
  assert.ok(!JSON.stringify(stop).includes("unavailable_citation_source"));
  if (process.platform === "win32") {
    const snapshot = workflow.sourceSnapshot(f.repo, "/" + f.source.replaceAll("\\", "/"));
    assert.equal(snapshot.path, f.source);
  }
});

test("Codex retrieves current-turn source metadata from native tool outputs without transmitting transcripts", async t => {
  const f = fixture(t);
  fs.writeFileSync(f.source, Array.from({ length: 240 }, (_, index) => "exports.line" + (index + 1) + " = true;").join("\n"));
  const previous = path.join(f.repo, "previous.js");
  fs.writeFileSync(previous, "exports.previous = true;\n");
  const transcript = path.join(f.home, "sessions", "native.jsonl");
  fs.mkdirSync(path.dirname(transcript));
  fs.writeFileSync(transcript, [
    { type: "response_item", payload: { type: "function_call_output", output: "Path: " + previous } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ text: "Inspect sample" }] } },
    { type: "response_item", payload: { type: "custom_tool_call_output", output: f.source + "#L180-190 [source:disk freshness:verified hash:fixture]\n180: exports.line180 = true;\nRAW_TRANSCRIPT_SENTINEL" } }
  ].map(row => JSON.stringify(row)).join("\n"));
  await f.run(f.event("UserPromptSubmit", { prompt: "Inspect sample" }));
  const result = await f.run(f.event("PreToolUse", { tool_name: "Read", tool_input: {}, transcript_path: transcript }));
  const evaluated = f.calls.find(call => call.mode === "context");
  assert.equal(evaluated.input.candidates.length, 1);
  assert.equal(evaluated.input.candidates[0].line_start, 180);
  assert.equal(evaluated.input.candidates[0].line_end, 190);
  assert.ok(evaluated.input.candidates[0].source.startsWith("exports.line180"));
  assert.ok(!JSON.stringify(f.calls).includes("RAW_TRANSCRIPT_SENTINEL"));
  assert.ok(!JSON.stringify(f.calls).includes(previous));
  assert.match(JSON.stringify(result), /line_start/);
});

test("Antigravity native per-invocation contract preserves turn state and injects queued tool feedback", async t => {
  const f = fixture(t, "antigravity");
  const common = { conversationId: "native-agy", workspacePaths: [f.repo], lastUserInput: "Inspect the flag" };
  const invoke = (name, extra = {}) => f.run({ ...common, hook_event_name: name, ...extra });
  const initial = await invoke("PreInvocation", { invocationNum: 1, initialNumSteps: 0 });
  assert.match(initial.injectSteps[0].ephemeralMessage, /ACTIVE/);
  const before = await invoke("PreToolUse", { toolCall: { name: "view_file", args: { AbsolutePath: f.source } }, stepIdx: 1 });
  assert.equal(before.decision, "ask");
  assert.equal(before.hookSpecificOutput, undefined);
  assert.deepEqual(await invoke("PostToolUse", { toolCall: { name: "view_file", args: { AbsolutePath: f.source } } }), {});
  const next = await invoke("PreInvocation", { invocationNum: 2, initialNumSteps: 2 });
  assert.match(next.injectSteps[0].ephemeralMessage, /passage_signals/);
  assert.doesNotMatch(next.injectSteps[0].ephemeralMessage, /ACTIVE/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(await invoke("PreInvocation", { invocationNum: 3 }), {});
  await invoke("PreToolUse", { toolCall: { name: "run_command", args: { CommandLine: "git status --short" } } });
  assert.match((await invoke("PreInvocation", { invocationNum: 4 })).injectSteps[0].ephemeralMessage, /guardrails/);
  const transcript = path.join(f.home, "sessions", "agy.jsonl");
  fs.mkdirSync(path.dirname(transcript));
  fs.writeFileSync(transcript, JSON.stringify({ source: "MODEL", type: "PLANNER_RESPONSE", content: "Disabled flag [sample](" + f.source.replaceAll("\\", "/") + ":1)." }) + "\n");
  const stop = await invoke("Stop", { transcriptPath: transcript, terminationReason: "NO_TOOL_CALL", fullyIdle: true });
  assert.equal(stop.decision, "");
  assert.match(stop.reason, /contradicted/);
  assert.deepEqual(await invoke("Stop", { transcriptPath: transcript, terminationReason: "NO_TOOL_CALL", fullyIdle: true }), {});
  assert.deepEqual(f.calls.map(call => call.mode), ["context", "guardrails", "citations"]);
  assert.match((await invoke("PreInvocation", { invocationNum: 1 })).injectSteps[0].ephemeralMessage, /ACTIVE/);
  assert.deepEqual(await invoke("Stop", { terminationReason: "USER_CANCELED", fullyIdle: true }), {});
});
