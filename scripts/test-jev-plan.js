"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const advisor = require("./jev_agent.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const plan = { request: "Remove PowerPoint export and add a DOO table.", tasks: [
  { id: "remove-slides", objective: "Remove PowerPoint export", scope: "Remove export entry and implementation", acceptance: "PowerPoint export is absent and other exports work", depends_on: [] },
  { id: "doo-table", objective: "Add DOO table", scope: "Render DOO rows from existing data", acceptance: "Known DOO fixture renders the expected rows", depends_on: [] },
] };
const copy = () => structuredClone(plan);
function transport(change = () => {}) {
  return async (_, options) => {
    const sent = JSON.parse(options.body);
    assert.deepEqual(sent.state, plan);
    const reply = { model: advisor.MODEL, answers: Object.fromEntries(Object.entries(sent.questions).map(([id, q]) => {
      const choice = Object.keys(q.criteria)[0];
      return [id, { type: "choice", choice, confidence: 0.2,
        probabilities: Object.fromEntries(Object.keys(q.criteria).map((key) => [key, Number(key === choice)])) }];
    })) };
    change(reply);
    return { ok: true, json: async () => reply };
  };
}
const run = (input, fetch, apiKey = "test") => advisor.advise(input, "plan", { apiKey, fetch });
function preserved(result, input) {
  assert.deepEqual(result.submitted_plan, input);
  assert.match(result.input_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.provenance.author, "Codex");
}
test("plan returns identity-bound advice, never approval or generated task prose", async () => {
  const result = await run(plan, transport());
  preserved(result, plan);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.task_advice.length, 2);
  assert.deepEqual(result.duplicate_advice[0].task_ids, ["remove-slides", "doo-table"]);
  assert.equal(result.task_advice[0].id, "remove-slides");
});
test("invalid graphs fail before transport and preserve exact submitted data", async () => {
  for (const mutate of [
    p => p.tasks.push(structuredClone(p.tasks[0])),
    p => { p.tasks[0].scope = " "; },
    p => { delete p.tasks[0].acceptance; },
    p => { p.tasks[0].depends_on = ["missing"]; },
    p => { p.tasks[0].depends_on = [p.tasks[0].id]; },
    p => { p.tasks[0].depends_on = [p.tasks[1].id]; p.tasks[1].depends_on = [p.tasks[0].id]; },
    p => { p.tasks[0].depends_on = "doo-table"; },
    p => { p.tasks[0].depends_on = ["doo-table", "doo-table"]; },
    p => { p.request = ""; },
    p => { p.tasks[0].id = ""; },
    p => { p.tasks[0].objective = ""; },
    p => { p.tasks = []; },
    p => { p.revision = 3; },
    p => { p.tasks = Array.from({ length: 13 }, (_, i) => ({ ...p.tasks[0], id: String(i) })); },
    p => { p.tasks[0].scope = "x".repeat(64000); },
  ]) {
    const input = copy(); mutate(input);
    let calls = 0;
    const result = await run(input, () => { calls++; throw Error("must not call"); });
    assert.equal(calls, 0);
    assert.equal(result.status, "NOT_EVALUATED");
    preserved(result, input);
  }
});
test("missing, partial, malformed and contradictory replies cannot approve", async () => {
  for (const change of [
    reply => { delete reply.answers[Object.keys(reply.answers)[0]]; },
    reply => { reply.model = "other"; },
    reply => { reply.approved = true; },
    reply => { Object.values(reply.answers)[0].task = "invented prose"; },
    reply => { const a = Object.values(reply.answers)[0]; a.choice = "split_required"; },
    reply => { const a = Object.values(reply.answers)[0]; a.choice = "unknown"; a.probabilities = { independent: 0, split_required: 0, unknown: 1 }; },
  ]) {
    const result = await run(plan, transport(change));
    assert.equal(result.status, "NOT_EVALUATED"); preserved(result, plan);
  }
  for (const [fetch, key] of [[() => { throw Error("offline"); }, "test"], [() => { throw Error("no key call"); }, ""]]) {
    const result = await run(plan, fetch, key);
    assert.equal(result.status, "NOT_EVALUATED"); preserved(result, plan);
  }
});
test("scope edits change review identity", async () => {
  const changed = copy(); changed.tasks[0].scope += " and change CSV export";
  assert.notEqual((await run(plan, null, "")).input_sha256, (await run(changed, null, "")).input_sha256);
});
test("provider failures remain bounded and snapshots survive caller mutation", async () => {
  for (const fetch of [
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => { throw Error("bad JSON"); } }),
    async () => { throw Object.assign(Error("timeout"), { name: "TimeoutError" }); },
  ]) {
    const result = await run(plan, fetch);
    preserved(result, plan); assert.equal(result.status, "NOT_EVALUATED");
  }
  const input = copy(); let calls = 0;
  const result = await run(input, async (...args) => {
    calls++; input.tasks[0].objective = "changed during transport";
    return transport()(...args);
  });
  assert.equal(calls, 1); preserved(result, plan);
});
test("CLI persists invalid plan evidence with failure status and refuses overwrite", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jev-plan-"));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const input = copy(); input.tasks[0].depends_on = ["unknown"];
  fs.writeFileSync(path.join(directory, "plan.json"), JSON.stringify(input));
  const args = [require.resolve("./jev_agent.js"), "plan", "--repo", directory,
    "--input", "plan.json", "--out", "result.json"];
  assert.equal(spawnSync(process.execPath, args).status, 3);
  const output = fs.readFileSync(path.join(directory, "result.json"), "utf8");
  preserved(JSON.parse(output), input);
  assert.equal(spawnSync(process.execPath, args).status, 2);
  assert.equal(fs.readFileSync(path.join(directory, "result.json"), "utf8"), output);
});
