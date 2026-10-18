"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { compare } = require("../probe/argv.cjs");

for (const change of ["unchanged", "removed", "deferred"]) test("argv primitive detects a previously supported harness " + change, (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dely-argv-probe-")));
  t.after(() => { assert.ok(path.basename(dir).startsWith("dely-argv-probe-")); fs.rmSync(dir, { recursive: true }); });
  const candidate = path.join(dir, "candidate"), release = path.join(dir, "release");
  const harnesses = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../harnesses.json"), "utf8"));
  const source = fs.readFileSync(path.resolve(__dirname, "../skills/delivery/scripts/dely.js"));
  for (const root of [candidate, release]) {
    fs.mkdirSync(path.join(root, "skills/delivery/scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "skills/delivery/scripts/dely.js"), source);
    const data = JSON.parse(JSON.stringify(harnesses));
    if (root === candidate && change === "removed") data.harnesses = data.harnesses.filter((h) => h.id !== "claude");
    if (root === candidate && change === "deferred") data.harnesses.find((h) => h.id === "claude").status = "deferred";
    fs.writeFileSync(path.join(root, "harnesses.json"), JSON.stringify(data));
  }
  if (change === "unchanged") assert.equal(compare(candidate, release).status, "PASS");
  else assert.throws(() => compare(candidate, release), /Record and review every intended launch change/);
});
