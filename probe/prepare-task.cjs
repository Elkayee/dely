"use strict";

// Prepare evidence only. Control must inspect it and explicitly review the
// returned assessment; this script never grants a worker or chooses a grade.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const routing = require("../skills/delivery/scripts/task-routing.js");
async function prepare(repo, run) {
  repo = fs.realpathSync(repo);
  if (!/^[A-Za-z0-9_-]+$/.test(run)) throw Error("Expected one Run identifier");
  const refs = ["REQUEST.md", "slug.js", "test/slug.test.js"].map((name) => {
    const bytes = fs.readFileSync(path.join(repo, name));
    return name + " sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
  });
  const dir = path.join(repo, ".dely/local/runs", run);
  fs.mkdirSync(dir, { recursive: true });
  const spec = path.join(dir, "spec.md"), context = path.join(dir, "context.json");
  fs.writeFileSync(spec, "# Probe slug behavior\nImplement the REQUEST.md slug defect in slug.js. Add a regression for punctuation and padding, run node --test test/, and report the actual result to Control. This is a verification fixture, not ordinary adoption workload. Control owns review; do not approve your own change.\n", { flag: "wx" });
  fs.writeFileSync(context, JSON.stringify({ scope: "The seeded slug helper and its focused regression fixture",
    coupling: "Known local CommonJS export and fixture caller; inspect the pinned sources before confirming effects",
    acceptance: "The punctuation/padding regression must fail the seeded implementation and pass the corrected helper while preserving the original Hello World case",
    evidence: refs.join("; "), requirements_confirmed: false, purpose: "verification_probe", domain: "other",
    risks: Object.fromEntries(routing.RISK_KEYS.map((key) => [key, null])) }, null, 2) + "\n", { flag: "wx" });
  return { spec, context, next: "Control inspects sources, confirms requirements and each risk boolean in context.json, then runs assess and review. Unknown facts must not default false." };
}
if (require.main === module) prepare(process.argv[2], process.argv[3]).then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { prepare };
