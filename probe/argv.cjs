"use strict";

// Test the portable launch primitive directly, without disabling task admission.
// End-to-end dispatch admission is covered separately by reviewed v4 fixtures.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");

function launches(tree, mutate = false) {
  const file = path.resolve(tree, "skills/delivery/scripts/dely.js");
  let source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (mutate) {
    const needle = 'if (wantsEffort) args.push("--effort", p.effort);';
    assert.ok(source.includes(needle), "The wrong-effort mutation must still target the launch primitive");
    source = source.replace(needle, "");
  }
  const rows = JSON.parse(fs.readFileSync(path.join(tree, "harnesses.json"), "utf8")).harnesses;
  const c = vm.createContext({ require: createRequire(file), __dirname: path.dirname(file), __filename: file,
    process: { platform: "linux", env: {} }, Buffer, TextDecoder, console: { log: () => {} } });
  vm.runInContext(source.slice(0, source.indexOf("const [cmd, ...rest] = process.argv.slice(2);")), c);
  let args;
  c.orca = (a) => { if (a[1] === "worker-start") args = [...a]; return { ok: true, result: { dispatchId: "fixture-dispatch" } }; };
  const result = new Map();
  for (const h of rows.filter((h) => h.status === "supported")) {
    for (const mode of ["default", "pinned", "effort_default", "effort_only"]) {
      const pin = { ...h, agent: h.id, model: mode === "default" || mode === "effort_only" ? "default" : "fixture-model",
        effort: mode === "default" || mode === "effort_default" ? "default" : "high" };
      args = null;
      const started = c.start("/fixture/repo", "fixture-run", pin, "A synthetic launch argument fixture", "Fixture");
      const key = h.id + "/" + mode;
      if (mode === "effort_only" && (h.effortFlag || h.effortInModel || h.modelPin)) {
        assert.equal(args, null, key + " must reject effort without a model");
        assert.ok(started.error);
      }
      if (args && mode === "default") {
        assert.ok(!args.includes("--model") && !args.includes("--effort"), key + " must preserve defaults");
      }
      if (args && mode === "effort_default") assert.ok(!args.includes("--effort"), key + " must omit default effort");
      result.set(key, { args, error: !!started.error });
    }
  }
  return result;
}

function compare(candidate, release) {
  const current = launches(candidate), prior = launches(release), wrong = launches(candidate, true);
  const differences = [], mutant = [];
  for (const [key, row] of current) {
    if (JSON.stringify(row) !== JSON.stringify(prior.get(key))) differences.push(key);
    if (JSON.stringify(row) !== JSON.stringify(wrong.get(key))) mutant.push(key);
  }
  for (const key of prior.keys()) if (!current.has(key)) differences.push(key + " removed");
  assert.ok(mutant.length, "Dropping effort must be detected, even when candidate/release agree");
  assert.deepEqual(differences, [], "Record and review every intended launch change instead of accepting an unexplained difference");
  return { status: "PASS", instrument: "portable_launch_primitive", modes: current.size,
    baseline_differences: differences, rejected_mutation: "drop_explicit_effort", mutant_differences: mutant,
    limits: "Synthetic argv only; separate v4 admission and native Windows AGY/Codex evidence are required" };
}

if (require.main === module) {
  try { console.log(JSON.stringify(compare(path.resolve(process.argv[2]), path.resolve(process.argv[3])))); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { compare };
