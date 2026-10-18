"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJevReader, summarizeJev } = require("./dely-monitor-jev.js");

const ts = "2026-10-18T10:00:00Z";
const labels = ["easy", "medium_minus", "medium_plus", "hard", "insufficient_evidence"];
const answer = (choice = "medium_plus") => ({ type: "choice", choice, confidence: 0.8,
  probabilities: Object.fromEntries(labels.map((label) => [label, Number(label === choice)])) });
function assessment(overrides = {}) {
  return { policy: "jev-task-routing-v4", assessed_at: ts, status: "REVIEW_REQUIRED", difficulty: "medium_plus",
    task: { repo: "D:/example", spec_sha256: "a".repeat(64), context_sha256: "b".repeat(64),
      spec: "PRIVATE_SPEC", context: { secret: "PRIVATE_CONTEXT" } },
    jev: { model: "jev-1.13.0", answers: Object.fromEntries(
      ["scope", "uncertainty", "risk", "verification", "coordination"].map((key) => [key, answer()])) }, ...overrides };
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-jev-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const homes = [path.join(root, "native"), path.join(root, "orca")];
  const put = (home, task, file, value) => {
    const target = path.join(home, "dely-compliance/tasks", task, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value)); return target;
  };
  return { root, homes, put };
}

test("original assessment, reviewed copy and cross-home copies count once and never expose task.context", async (t) => {
  const { homes, put } = fixture(t), original = assessment();
  put(homes[0], "one", "assessment.json", original);
  put(homes[0], "one", "reviewed.json", { ...original, status: "APPROVED", difficulty: "medium_minus",
    review: { by: "codex-control", reviewed_at: ts, source: "codex-control", reason: "PRIVATE_REVIEW" },
    route: { workflow: "dely", primary: { harness: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" } } });
  put(homes[1], "copy", "assessment.json", original);
  const result = await createJevReader({ homes })();
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|spec_sha256|context_sha256|task\.context/);
  assert.equal(result.rows.length, 1, "review is not a new Jev evaluation");
  const summary = summarizeJev(result.rows);
  assert.equal(summary.recorded, 1); assert.equal(summary.valid, 1); assert.equal(summary.evaluations, 1);
  assert.equal(result.rows[0].proposal, "medium_plus");
  assert.equal(result.rows[0].control[0].difficulty, "medium_minus");
  assert.equal(result.rows[0].sources.length, 3);
  assert.equal(result.rows[0].task, undefined);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|spec_sha256|context_sha256|task\.context/);
});

test("HTTP and validation failures differ from credentials, missing evidence, hard skips and unknown", async (t) => {
  const { homes, put } = fixture(t);
  const cases = [
    ["http", "Jev HTTP 503", "error"],
    ["invalid", "Jev request timed out or returned an invalid response", "error"],
    ["credentials", "TYPESAFE_API_KEY is not configured", "not_evaluated"],
    ["evidence", "Missing task evidence", "not_evaluated"],
    ["skip", null, "skipped"], ["unknown", "Bearer PRIVATE_TOKEN", "unknown"],
  ];
  for (const [id, reason] of cases) put(homes[0], id, "assessment.json", assessment({ assessed_at: `2026-10-18T10:0${cases.findIndex((r) => r[0] === id)}:00Z`,
    jev: null, status: id === "skip" ? "DIRECT_CODEX" : "NOT_EVALUATED", reason }));
  const result = await createJevReader({ homes })();
  for (const [id, , expected] of cases) assert.equal(result.rows.find((r) => r.sources.some((s) => s.task === id)).category, expected);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TOKEN/);
  const summary = summarizeJev(result.rows);
  assert.equal(summary.evaluations, 2); assert.equal(summary.errors, 2);
  assert.equal(summary.notEvaluated, 2); assert.equal(summary.skipped, 1); assert.equal(summary.unknown, 1);
});

test("a reviewed hard skip or missing-credential assessment never becomes another evaluation", async (t) => {
  const { homes, put } = fixture(t);
  for (const [id, status, reason] of [["hard", "DIRECT_CODEX", null], ["missing-key", "NOT_EVALUATED", "TYPESAFE_API_KEY is not configured"]]) {
    const original = assessment({ assessed_at: id === "hard" ? ts : "2026-10-18T11:00:00Z", status, jev: null, reason });
    put(homes[0], id, "assessment.json", original);
    put(homes[0], id, "reviewed.json", { ...original, status: "APPROVED", difficulty: "hard",
      review: { by: "codex-control", reviewed_at: ts } });
  }
  const summary = summarizeJev((await createJevReader({ homes })()).rows);
  assert.equal(summary.recorded, 2); assert.equal(summary.evaluations, 0);
  assert.equal(summary.skipped, 1); assert.equal(summary.notEvaluated, 1);
});

test("advisor output is whitelisted and unreadable files expose coverage without error bodies", async (t) => {
  const { homes, put } = fixture(t);
  const denied = put(homes[0], "one", "assessment.json", assessment());
  put(homes[0], "one", "context-advice.json", { mode: "context", status: "REVIEW_REQUIRED", model: "jev-1.13.0",
    ranked_context: [{ id: "PRIVATE_ID", body: "PRIVATE_BODY", provenance: "PRIVATE_PATH", relevance: "direct",
      confidence: 1, probabilities: { direct: 1, supporting: 0, unknown: 0, unrelated: 0 } }] });
  const promises = require("node:fs/promises"), open = promises.open;
  promises.open = async (file, ...args) => {
    if (file === denied) throw Object.assign(Error("PRIVATE_ERROR"), { code: "EACCES" });
    return open(file, ...args);
  };
  t.after(() => { promises.open = open; });
  const result = await createJevReader({ homes })();
  assert.equal(result.coverage[0].unreadable, 1); assert.equal(result.coverage[0].state, "partial");
  assert.equal(result.rows[0].category, "valid"); assert.equal(result.rows[0].repo, null); assert.equal(result.rows[0].ts, null);
  assert.equal(result.rows[0].output[0].choice, "direct");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test("malformed files, bounded paths, advisor modes, cache hits, invalidation and deletion have visible coverage", async (t) => {
  const { root, homes, put } = fixture(t);
  const file = put(homes[0], "one", "assessment.json", assessment());
  put(homes[0], "bad", "assessment.json", "{");
  put(homes[0], "shape", "assessment.json", []);
  put(homes[0], "large", "assessment.json", "x".repeat(300000));
  put(homes[0], "one", "skill-advice.json", { mode: "skill", status: "REVIEW_REQUIRED", model: "jev-1.13.0", input_sha256: "c".repeat(64),
    suggestions: [{ path: "PRIVATE_CATALOG", description: "PRIVATE_SKILL" }],
    evaluations: [{ id: "s0", relevance: "direct", confidence: 0.9, probabilities: { direct: 1, supporting: 0, unknown: 0, unrelated: 0 } }] });
  put(homes[0], "one", "context-advice.json", { mode: "context", status: "NOT_EVALUATED", reason: "TYPESAFE_API_KEY_MISSING" });
  put(homes[0], "one", "arbitrary.json", { private: "PRIVATE_ARBITRARY" });
  fs.mkdirSync(path.join(root, "outside"));
  try { fs.symlinkSync(path.join(root, "outside"), path.join(homes[0], "dely-compliance/tasks", "link"), "junction"); } catch (_) {}
  const reader = createJevReader({ homes });
  const first = await reader();
  assert.equal(first.rows.length, 3); assert.equal(first.coverage[0].malformed, 2);
  assert.equal(first.coverage[0].oversized, 1); assert.equal(first.coverage[1].state, "missing");
  assert.equal(first.coverage[0].modes.skill, 1); assert.equal(first.coverage[0].modes.context, 1);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE_/);
  const second = await reader(); assert.equal(second.cache.parsed, 0); assert.ok(second.cache.hits >= 5);
  fs.writeFileSync(file, JSON.stringify(assessment({ jev: null, reason: "Jev HTTP 429" })));
  const changed = await reader(); assert.equal(changed.cache.parsed, 1); assert.equal(changed.rows.find((r) => r.mode === "task").category, "error");
  fs.unlinkSync(file);
  assert.equal((await reader()).rows.some((r) => r.mode === "task"), false);
});

test("strict answer projections reject wrong shapes and keep valid insufficient-evidence output", async (t) => {
  const { homes, put } = fixture(t);
  const bad = assessment(); bad.jev.answers.scope.probabilities.easy = "PRIVATE_PROBABILITY";
  put(homes[0], "bad", "assessment.json", bad);
  const good = assessment(); good.jev.answers.scope = answer("insufficient_evidence");
  put(homes[0], "good", "assessment.json", good);
  const result = await createJevReader({ homes })();
  assert.equal(result.rows.find((r) => r.sources[0].task === "bad").category, "unknown");
  const row = result.rows.find((r) => r.sources[0].task === "good");
  assert.equal(row.category, "valid"); assert.equal(row.proposal, "NOT_EVALUATED");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test("time, workspace, probe and observation-reset filters preserve unknown time coverage", () => {
  const rows = [
    { ts, repo: "D:/example", category: "valid", mode: "task" },
    { ts, repo: "D:/.tmp-dely/probe", category: "error", mode: "skill" },
    { ts: null, repo: "D:/example", category: "unknown", mode: "context" },
  ];
  const end = Date.parse(ts) + 1000;
  assert.equal(summarizeJev(rows, { since: end, asOf: end }).recorded, 1);
  assert.equal(summarizeJev(rows, { repo: "D:/example", asOf: end }).recorded, 2);
  assert.equal(summarizeJev(rows, { probes: true, asOf: end }).recorded, 3);
  assert.equal(summarizeJev(rows, { asOf: end }).unknownTime, 1);
});
