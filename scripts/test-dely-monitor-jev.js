"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJevReader, summarizeJev } = require("./dely-monitor-jev.js");

const legacy = (suggestion = { name: "writing-for-agents" }) => ({ mode: "skill", status: "REVIEW_REQUIRED",
  model: "jev-1.13.0", suggestion, confidence: 0.67,
  probabilities: suggestion ? { none: 0.09, s149: 0.91 } : { none: 0.91, s149: 0.09 } });

test("legacy suggestion and explicit none are evaluated, with names and safe raw output retained", async (t) => {
  const { homes, put } = fixture(t);
  put(homes[0], "suggested", "skill-advice.json", legacy());
  put(homes[0], "none", "skill-advice.json", legacy(null));
  const result = await createJevReader({ homes })();
  assert.equal(result.rows.length, 2);
  for (const row of result.rows) assert.equal(row.category, "valid");
  const suggested = result.rows.find((r) => r.sources[0].task === "suggested");
  assert.deepEqual(suggested.suggestions, [{ name: "writing-for-agents" }]);
  assert.deepEqual(suggested.output.probabilities, legacy().probabilities);
  assert.deepEqual(result.rows.find((r) => r.sources[0].task === "none").suggestions, []);
});

test("modern suggestion names and recorded explicit-only policy survive projection in order", async (t) => {
  const { homes, put } = fixture(t);
  put(homes[0], "modern", "skill-advice.json", { mode: "skill", status: "REVIEW_REQUIRED", model: "jev-1.13.0",
    suggestions: [{ name: "research", description: "PRIVATE_DESCRIPTION", path: "PRIVATE_PATH" },
      { name: "implement", allow_implicit_invocation: false, requires_explicit_invocation: true }],
    evaluations: [{ relevance: "direct", confidence: 1, probabilities: { direct: 1, supporting: 0, unrelated: 0, unknown: 0 } }] });
  const result = await createJevReader({ homes })();
  assert.deepEqual(result.rows[0].suggestions, [{ name: "research" },
    { name: "implement", allow_implicit_invocation: false, requires_explicit_invocation: true }]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test("legacy explicit none is a valid evaluated result even without selection counts", async (t) => {
  const { homes, put } = fixture(t);
  put(homes[0], "none", "skill-advice.json", legacy(null));
  const row = (await createJevReader({ homes })()).rows[0];
  assert.equal(row.category, "valid"); assert.equal(row.reason, "LEGACY_NO_SUGGESTION");
  assert.equal(require("../ui/monitor/jev-view.js").jevPresentation(row).proposal, "No suggestion (legacy none)");
});

test("legacy validation rejects unsafe keys, malformed distributions, bad names and contradictory none", async (t) => {
  const { homes, put } = fixture(t);
  const variants = [
    { probabilities: { none: 0.1, s0: 0.1 } }, { probabilities: { none: 0.1, PRIVATE_KEY: 0.9 } },
    { probabilities: { none: 0.1, s01: 0.9 } }, { probabilities: { none: -0.1, s0: 1.1 } },
    { probabilities: { none: 0.1, s0: null } }, { confidence: null }, { confidence: 2 },
    { suggestion: { name: "<PRIVATE_SCRIPT>" } }, { suggestion: { name: "research", enabled: "PRIVATE_FLAG" } },
    { suggestion: null }, { suggestion: undefined }, { probabilities: JSON.parse('{"none":0.1,"__proto__":0.9}') },
    { suggestions: "PRIVATE_CATALOG" },
  ];
  variants.forEach((extra, i) => put(homes[0], String(i), "skill-advice.json", { ...legacy(), input_sha256: i.toString(16).padStart(64, "0"), ...extra }));
  const rows = (await createJevReader({ homes })()).rows;
  assert.equal(rows.length, variants.length);
  for (const row of rows) { assert.equal(row.category, "unknown"); assert.equal(row.output, null); }
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_|__proto__/);
});

test("disabled, zero suggestions, missing names and no output remain distinct without invented metadata", async (t) => {
  const { homes, put } = fixture(t);
  const disabled = { mode: "skill", status: "NOT_APPLICABLE", reason: "NO_ELIGIBLE_SKILLS", suggestions: [],
    evaluations: [{ relevance: "NOT_EVALUATED", reason: "DISABLED" }], selection: { disabled_count: 1, evaluated_count: 0, secret: "PRIVATE_COUNT" } };
  const modern = { mode: "skill", status: "REVIEW_REQUIRED", evaluations: [
    { relevance: "unrelated", confidence: 1, probabilities: { direct: 0, supporting: 0, unknown: 0, unrelated: 1 } }] };
  put(homes[0], "disabled", "skill-advice.json", disabled);
  put(homes[0], "zero", "skill-advice.json", { ...modern, suggestions: [] });
  put(homes[0], "missing", "skill-advice.json", modern);
  put(homes[0], "failed", "skill-advice.json", { mode: "skill", status: "NOT_EVALUATED", reason: "JEV_HTTP_502", suggestions: [] });
  const result = await createJevReader({ homes })();
  const row = (id) => result.rows.find((r) => r.sources[0].task === id);
  assert.equal(row("disabled").category, "not_applicable");
  assert.deepEqual(row("disabled").output, [{ index: 0, choice: "NOT_EVALUATED", reason: "DISABLED" }]);
  assert.equal(row("zero").category, "valid"); assert.deepEqual(row("zero").suggestions, []);
  assert.equal(row("zero").model, null); assert.equal(row("missing").suggestions, null);
  assert.equal(row("failed").category, "error"); assert.equal(row("failed").output, null);
  assert.equal(summarizeJev(result.rows).notApplicable, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test("safe raw probabilities, selection counts and known Control review sources survive without private fields", async (t) => {
  const { homes, put } = fixture(t);
  const raw = { direct: 0.74, supporting: 0.13, unknown: 0.06, unrelated: 0.06 }, sum = 0.99;
  put(homes[0], "raw", "skill-advice.json", { mode: "skill", status: "REVIEW_REQUIRED", suggestions: [],
    evaluations: [{ relevance: "direct", confidence: 0.8, raw_probabilities: raw,
      probabilities: Object.fromEntries(Object.entries(raw).map(([key, p]) => [key, p / sum])) }] });
  for (const source of ["control-evidence", "control-override-justified"]) put(homes[0], source, "reviewed.json", assessment({
    review: { by: "codex-control", source, reason: "PRIVATE_REVIEW" } }));
  const result = await createJevReader({ homes })();
  assert.deepEqual(result.rows.find((r) => r.mode === "skill").output[0].raw_probabilities, raw);
  assert.deepEqual(result.rows.find((r) => r.mode === "task").control.map((r) => r.source).sort(), ["control-evidence", "control-override-justified"]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test("rendered labels distinguish hard skip, missing metadata, failed reply, needs evidence and unsaved review", () => {
  const { jevPresentation } = require("../ui/monitor/jev-view.js");
  const base = { mode: "task", category: "skipped", reason: "HARD_DIRECT_SKIP", control: [] };
  assert.equal(jevPresentation(base).model, "Not called (Hard/direct)");
  assert.equal(jevPresentation(base).proposal, "Not applicable (Hard/direct)");
  assert.equal(jevPresentation(base).review, "No saved Control review");
  assert.equal(jevPresentation({ ...base, category: "error" }).proposal, "No valid reply");
  assert.equal(jevPresentation({ ...base, category: "valid", proposal: "NOT_EVALUATED" }).proposal, "Needs evidence");
  assert.equal(jevPresentation({ ...base, category: "unknown" }).model, "Model not recorded");
});

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
    ["oversized", "SNAPSHOT_TOO_LARGE", "not_evaluated"],
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
  assert.equal(summary.notEvaluated, 3); assert.equal(summary.skipped, 1); assert.equal(summary.unknown, 1);
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
    suggestions: [{ name: "research", path: "PRIVATE_CATALOG", description: "PRIVATE_SKILL" }],
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
  const selected = summarizeJev(rows, { mode: "context", repo: "D:/example", since: end, asOf: end });
  assert.equal(selected.recorded, 1); assert.equal(selected.unknown, 1); assert.equal(selected.modes.task, 0);
  assert.equal(selected.reasons.reduce((sum, r) => sum + r.count, 0), selected.recorded);
  assert.equal(summarizeJev(rows, { mode: "skill", asOf: end }).recorded, 0);
  assert.equal(summarizeJev(rows, { mode: "skill", probes: true, asOf: end }).errors, 1);
});
