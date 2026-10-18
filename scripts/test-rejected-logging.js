"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const delyScript = path.resolve(__dirname, "../skills/delivery/scripts/dely.js");

function validateRejectedBatchMessages(messages) {
  assert.ok(Array.isArray(messages), "batch messages must be an array");
  assert.equal(messages.length, 2, "must retain all batch messages");
  for (const m of messages) {
    if (typeof m.rejected !== "boolean") {
      throw new Error("REGRESSION: message missing boolean 'rejected' field: " + JSON.stringify(m));
    }
  }
  const allRejected = messages.every((m) => m.rejected === true);
  if (allRejected) {
    throw new Error("REGRESSION: every batch message is blindly marked rejected");
  }
  const noneRejected = messages.every((m) => m.rejected === false);
  if (noneRejected) {
    throw new Error("REGRESSION: no batch message is marked rejected");
  }
  assert.equal(messages[0].type, "worker_done");
  assert.equal(messages[0].dispatchId, "ctx_rejected");
  assert.equal(messages[0].rejected, true, "rejected worker_done must be marked rejected: true");

  assert.equal(messages[1].type, "heartbeat");
  assert.equal(messages[1].dispatchId, "ctx_heartbeat");
  assert.equal(messages[1].rejected, false, "non-rejected heartbeat must be marked rejected: false");
}

test("wait() logs per-message rejected boolean under mixed rejected worker_done and non-rejected heartbeat", (t) => {
  const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dely-rejected-logging-")));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const delyHome = path.join(tmpDir, "home");
  fs.mkdirSync(path.join(delyHome, ".dely"), { recursive: true });

  const mockOrcaScript = path.join(tmpDir, "mock-orca.js");
  const stateFile = path.join(tmpDir, "orca-state.json");
  fs.writeFileSync(stateFile, JSON.stringify({ checkCalls: 0, acks: [] }));

  const mockOrcaCode = `
const fs = require("fs");
const stateFile = ${JSON.stringify(stateFile)};
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const args = process.argv.slice(2);

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

if (args.includes("status")) {
  out({ ok: true, result: { runtime: { appVersion: "1.4.203" } } });
}
if (args.includes("terminal") && args.includes("list")) {
  out({ ok: true, result: { terminals: [] } });
}
if (args.includes("worker-release")) {
  out({ ok: true, result: { state: "released" } });
}
if (args.includes("orchestration") && args.includes("check")) {
  const ackIdx = args.indexOf("--ack");
  if (ackIdx !== -1) {
    state.acks.push(args[ackIdx + 1]);
    fs.writeFileSync(stateFile, JSON.stringify(state));
    out({ ok: true, result: {} });
  }

  state.checkCalls++;
  fs.writeFileSync(stateFile, JSON.stringify(state));

  if (state.checkCalls === 1) {
    out({
      ok: true,
      result: {
        deliveryId: "deliv_mixed_batch",
        messages: [
          {
            id: "msg_rejected_done",
            type: "worker_done",
            subject: "rejected completion",
            from_handle: "term_worker_1",
            payload: {
              dispatchId: "ctx_rejected",
              _orcaLifecycleRejection: "dispatch_mismatch"
            }
          },
          {
            id: "msg_live_heartbeat",
            type: "heartbeat",
            subject: "alive",
            from_handle: "term_worker_2",
            payload: {
              dispatchId: "ctx_heartbeat"
            }
          }
        ]
      }
    });
  } else {
    out({
      ok: true,
      result: {
        deliveryId: "deliv_settled_done",
        messages: [
          {
            id: "msg_settled_done",
            type: "worker_done",
            subject: "settled completion",
            from_handle: "term_worker_3",
            payload: {
              dispatchId: "ctx_settled"
            }
          }
        ]
      }
    });
  }
}

out({ ok: true, result: {} });
`;
  fs.writeFileSync(mockOrcaScript, mockOrcaCode);

  const env = {
    ...process.env,
    HOME: delyHome,
    USERPROFILE: delyHome,
    HOMEDRIVE: "",
    HOMEPATH: delyHome,
    ORCA_CLI_COMMAND: mockOrcaScript,
    ORCA_TERMINAL_HANDLE: "",
    DELY_WAITER: "1",
  };

  const result = spawnSync(
    process.execPath,
    [delyScript, "wait", "--run", "run_test_rejected", "--control", "claude"],
    {
      env,
      encoding: "utf8",
    }
  );

  assert.equal(result.status, 0, "wait command must exit cleanly: " + result.stderr + "\n" + result.stdout);

  const logFile = path.join(delyHome, ".dely", "log.jsonl");
  assert.ok(fs.existsSync(logFile), "log.jsonl must be written");

  const lines = fs
    .readFileSync(logFile, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));

  const rejectedEvent = lines.find((e) => e.event === "rejected");
  assert.ok(rejectedEvent, "a rejected log event must be recorded in log.jsonl");
  assert.equal(rejectedEvent.run, "run_test_rejected");
  assert.equal(rejectedEvent.deliveryId, "deliv_mixed_batch");

  // Verify the real log event payload satisfies all requirements
  validateRejectedBatchMessages(rejectedEvent.messages);

  // Verify ack was called for the rejected delivery
  const finalState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.ok(finalState.acks.includes("deliv_mixed_batch"), "rejected delivery must be acknowledged");

  // Verify settled event followed
  const settledEvent = lines.find((e) => e.event === "settled");
  assert.ok(settledEvent, "settled event must follow after rejected delivery ack");
  assert.equal(settledEvent.deliveryId, "deliv_settled_done");
});

test("regression detector: fails when per-message rejected field is absent", () => {
  const mutatedMessages = [
    { type: "worker_done", subject: "done", dispatchId: "ctx_rejected" },
    { type: "heartbeat", subject: "alive", dispatchId: "ctx_heartbeat" },
  ];
  assert.throws(
    () => validateRejectedBatchMessages(mutatedMessages),
    /REGRESSION: message missing boolean 'rejected' field/
  );
});

test("regression detector: fails when every batch message is blindly marked rejected", () => {
  const mutatedMessages = [
    { type: "worker_done", subject: "done", dispatchId: "ctx_rejected", rejected: true },
    { type: "heartbeat", subject: "alive", dispatchId: "ctx_heartbeat", rejected: true },
  ];
  assert.throws(
    () => validateRejectedBatchMessages(mutatedMessages),
    /REGRESSION: every batch message is blindly marked rejected/
  );
});
