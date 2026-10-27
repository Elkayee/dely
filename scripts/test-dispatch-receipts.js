"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const receipts = require("../skills/delivery/scripts/dispatch-receipts.js");

function fixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "dely-receipt-test-"));
  t.after(() => {
    assert.equal(fs.realpathSync(repo), repo);
    assert.ok(path.basename(repo).startsWith("dely-receipt-test-"));
    fs.rmSync(repo, { recursive: true });
  });
  const route = { event: "task_route", run: "run", repo };
  const dispatch = { event: "dispatch", run: "run", repo, dispatchId: "dispatch", terminalHandle: "terminal" };
  return { repo, route, dispatch };
}

test("receipts are immutable and incomplete new evidence never appears as legacy", (t) => {
  const f = fixture(t), file = receipts.record(f.repo, "run", f.route, f.dispatch);
  assert.equal(receipts.record(f.repo, "run", f.route, f.dispatch), file);
  assert.equal(receipts.record(f.repo, "run", f.route, { ...f.dispatch, seconds: 20 }), file);
  assert.throws(() => receipts.record(f.repo, "run", f.route, { ...f.dispatch, terminalHandle: "foreign" }), /differs/);
  assert.deepEqual(receipts.records(f.repo, "run").rows, [f.route, f.dispatch]);
  fs.writeFileSync(file, "{partial");
  assert.deepEqual(receipts.records(f.repo, "run"), { runs: ["run"], rows: [] });
});

test("receipt identity and filenames cannot escape their Run or repository", (t) => {
  const f = fixture(t), outside = fixture(t);
  for (const dispatch of [{ ...f.dispatch, run: "other" }, { ...f.dispatch, dispatchId: "../escape" },
    { ...f.dispatch, repo: outside.repo }]) {
    assert.throws(() => receipts.record(f.repo, "run", f.route, dispatch), /identity/);
  }
  assert.throws(() => receipts.records(f.repo, "../escape"), /Run/);
});

test("linked receipt directories cannot redirect admission evidence", (t) => {
  const f = fixture(t), outside = fixture(t), local = path.join(f.repo, ".dely", "local");
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.symlinkSync(outside.repo, local, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => receipts.record(f.repo, "run", f.route, f.dispatch), /links/);
  assert.throws(() => receipts.records(f.repo, "run"), /links/);
});
