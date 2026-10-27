"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJevReader, summarizeJev } = require("./dely-monitor-jev.js");
const riskKeys = ["security", "data", "public_contract", "architecture", "production", "routing"];
const riskValues = (value) => Object.fromEntries(riskKeys.map((key) => [key, value]));

test("production context is distinct from recorded and historical Hard exclusions", async (t) => {
  const { homes, put } = fixture(t);
  const cases = [
    ["mixed", { ...riskValues(false), data: true, production: true }, ["data"], ["data"]],
    ["historical", { ...riskValues(false), production: true }, ["production"], ["production"]],
    ["legacy", { ...riskValues(false), production: true }, undefined, null],
    ["unsafe", riskValues(false), ["PRIVATE_SENTINEL", { secret: "PRIVATE_SENTINEL" }, "data", "data"], ["data"]],
    ["malformed", riskValues(false), "PRIVATE_SENTINEL", null],
  ];
  for (const [i, [name, risks, hard_exclusions]] of cases.entries()) put(homes[0], name, "assessment.json", assessment({
    assessed_at: new Date(Date.parse(ts) + i).toISOString(), status: "DIRECT_CODEX", jev: null, hard_exclusions,
    task: { repo: "D:/example", context: { risks } } }));
  const rows = (await createJevReader({ homes })()).rows;
  const view = require("../ui/monitor/jev-view.js").jevPresentation;
  for (const [name, , , expected] of cases) assert.deepEqual(rows.find((r) => r.sources[0].task === name).hardExclusions, expected);
  const mixed = rows.find((r) => r.sources[0].task === "mixed");
  assert.match(view(mixed).riskExplanation, /Recorded Hard exclusions: data=true/);
  assert.doesNotMatch(view(mixed).riskExplanation, /production/);
  assert.match(view(mixed).riskContext, /not an automatic Hard exclusion/);
  const historical = rows.find((r) => r.sources[0].task === "historical");
  assert.match(view(historical).riskExplanation, /production=true.*historical/);
  const legacy = rows.find((r) => r.sources[0].task === "legacy");
  assert.match(view(legacy).riskExplanation, /not recorded/);
  assert.doesNotMatch(view(legacy).riskExplanation, /production=true/);
  const dom = visibleJevRows([mixed, historical, legacy]);
  assert.match(dom[0].textContent, /production=true records context/);
  assert.match(dom[1].textContent, /historical/);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_SENTINEL/);
});

test("risk projection keeps only six actual booleans and never infers flags from Hard", async (t) => {
  const { homes, put } = fixture(t);
  const cases = [riskValues(true), riskValues(false), { security: true, data: true, routing: false },
    undefined, null, [], "PRIVATE_SENTINEL", { security: "true", data: "false", public_contract: 1,
      architecture: 0, production: null, routing: {}, extra: "PRIVATE_SENTINEL" }];
  for (const [i, risks] of cases.entries()) put(homes[0], "risk-" + i, "assessment.json", assessment({
    assessed_at: new Date(Date.parse(ts) + i).toISOString(), status: "DIRECT_CODEX", jev: null,
    task: { repo: "D:/example", context: { risks, scope: "PRIVATE_SENTINEL", evidence: "PRIVATE_SENTINEL" },
      spec: "PRIVATE_SENTINEL" } }));
  const result = await createJevReader({ homes })();
  for (const [i, risks] of cases.entries()) {
    const row = result.rows.find((r) => r.sources[0].task === "risk-" + i);
    const expected = Object.fromEntries(riskKeys.map((key) => [key,
      risks && !Array.isArray(risks) && typeof risks[key] === "boolean" ? risks[key] : null]));
    assert.deepEqual(row.risks, expected);
    assert.equal(row.riskSource, "assessment");
  }
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL|scope|evidence/);
});

test("risk provenance follows original assessment across reviewed-only and duplicate records", async (t) => {
  const { homes, put } = fixture(t);
  const original = assessment();
  original.task.context.risks = riskValues(false);
  original.hard_exclusions = [];
  const reviewed = { ...original, status: "APPROVED", task: { ...original.task,
    context: { risks: riskValues(true) } }, hard_exclusions: ["production"], review: { by: "codex-control", reviewed_at: ts } };
  put(homes[0], "copy", "reviewed.json", reviewed);
  const read = createJevReader({ homes });
  let result = await read();
  assert.equal(result.rows[0].riskSource, "reviewed");
  assert.equal(result.rows[0].status, "ORIGINAL_UNAVAILABLE");
  assert.deepEqual(result.rows[0].risks, riskValues(true));
  assert.deepEqual(result.rows[0].hardExclusions, ["production"]);
  put(homes[1], "original", "assessment.json", original);
  result = await read();
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].riskSource, "assessment");
  assert.deepEqual(result.rows[0].risks, riskValues(false));
  assert.deepEqual(result.rows[0].hardExclusions, []);
  assert.equal(result.rows[0].control.length, 1);
  assert.equal(summarizeJev(result.rows).evaluations, 1);
  for (const mode of ["skill", "context"]) put(homes[0], mode, mode + "-advice.json", {
    mode, status: "NOT_EVALUATED", task: { context: { risks: riskValues(true) } } });
  result = await read();
  for (const row of result.rows.filter((r) => r.mode !== "task")) {
    assert.equal(row.risks, null); assert.equal(row.riskSource, null);
  }
});

test("risk contract kills present-but-wrong coercion and Hard-status inference counterexamples", async (t) => {
  const { homes, put } = fixture(t);
  put(homes[0], "missing", "assessment.json", assessment({ status: "DIRECT_CODEX", jev: null }));
  put(homes[0], "strings", "assessment.json", assessment({ assessed_at: "2026-10-18T11:00:00Z",
    task: { repo: "D:/example", context: { risks: Object.fromEntries(riskKeys.map((key) => [key, "false"])) } } }));
  const filename = path.join(__dirname, "dely-monitor-jev.js");
  const source = fs.readFileSync(filename, "utf8");
  const correct = 'typeof risks[key] === "boolean" ? risks[key] : null';
  const contract = async (reader) => {
    const result = await reader({ homes })();
    for (const row of result.rows) assert.deepEqual(row.risks, riskValues(null));
  };
  await contract(createJevReader);
  for (const wrong of ["Boolean(risks[key])", "risks[key] || false",
    'key === "data" && status === "DIRECT_CODEX" ? true : (' + correct + ")"]) {
    const mutated = source.replace(correct, wrong);
    assert.notEqual(mutated, source, "counterexample instrument must replace the real projection");
    const Module = require("node:module"), candidate = new Module(filename, module);
    candidate.filename = filename; candidate.paths = module.paths; candidate._compile(mutated, filename);
    await assert.rejects(contract(candidate.exports.createJevReader), { code: "ERR_ASSERTION" });
  }
});

// Execute the real table renderer and element helper, with a DOM that rejects HTML writes.
function visibleJevRows(rows) {
  const vm = require("node:vm");
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.className = ""; this.value = ""; }
    set textContent(value) { this.value = String(value); this.children = []; }
    get textContent() { return this.value + this.children.map((c) => c.textContent).join(" "); }
    set innerHTML(_) { throw Error("HTML writes are forbidden"); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener() {}
  }
  const nodes = { "jev-rows": new Element("tbody"), "jev-more": new Element("button") };
  const source = fs.readFileSync(path.join(__dirname, "../ui/monitor/monitor.js"), "utf8");
  const helper = source.slice(source.indexOf("const element ="), source.indexOf("\n", source.indexOf("const element =")));
  const renderer = source.slice(source.indexOf("function showJevRows()"), source.indexOf("function renderJev("));
  vm.runInNewContext(helper + "\n" + renderer + "\nshowJevRows();", {
    document: { createElement: (tag) => new Element(tag) }, $: (id) => nodes[id], jevRows: rows, jevShown: 25,
    jevPresentation: require("../ui/monitor/jev-view.js").jevPresentation
  });
  return nodes["jev-rows"].children;
}

test("visible risk DOM shows all states, true triggers and provenance without expanding details", () => {
  const base = { mode: "task", status: "DIRECT_CODEX", category: "skipped", reason: "HARD_DIRECT_SKIP",
    riskSource: "assessment", control: [], sources: [] };
  const rows = [
    { ...base, risks: { ...riskValues(false), data: true, routing: true }, hardExclusions: ["data", "routing"] },
    { ...base, risks: riskValues(null) }, { ...base, risks: riskValues(false), riskSource: "reviewed" },
    { ...base, category: "valid", reason: "NOT_RECORDED", proposal: "hard", risks: riskValues(false) },
    ...["skill", "context"].map((mode) => ({ ...base, mode, risks: riskValues(true) })),
    { ...base, risks: { security: "true", data: "false" } }
  ];
  const dom = visibleJevRows(rows);
  for (const [i, row] of rows.entries()) {
    const text = dom[i].textContent;
    if (row.mode !== "task") { assert.match(text, /Risk flags: not applicable/); assert.doesNotMatch(text, /security=/); continue; }
    for (const key of riskKeys) assert.ok(text.includes(key + "=" +
      (typeof row.risks[key] === "boolean" ? row.risks[key] : "unknown/not recorded")), text);
    if (row.reason === "HARD_DIRECT_SKIP") assert.match(text, /Consequential-risk gates select Hard before Jev/);
    else assert.doesNotMatch(text, /Consequential-risk gates/);
  }
  assert.match(dom[0].textContent, /Recorded Hard exclusions: data=true, routing=true/);
  assert.match(dom[1].textContent, /Recorded Hard exclusions: not recorded/);
  assert.match(dom[2].textContent, /reviewed snapshot \(original unavailable\)/);
  assert.match(dom[0].textContent, /original assessment/);
  const descendants = (node) => [node, ...node.children.flatMap(descendants)];
  assert.equal(descendants(dom[0]).filter((n) => n.className === "note-tag" && /^(data|routing)=true$/.test(n.textContent)).length, 2);
  const css = fs.readFileSync(path.join(__dirname, "../ui/monitor/monitor.css"), "utf8");
  assert.match(css, /\.jev-risks\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.jev-risk-note\s*\{[^}]*white-space:\s*normal/);
});

const legacy = (suggestion = { name: "writing-for-agents" }) => ({ mode: "skill", status: "REVIEW_REQUIRED",
  model: "jev-1.13.0", suggestion, confidence: 0.67,
  probabilities: suggestion ? { none: 0.09, s149: 0.91 } : { none: 0.91, s149: 0.09 } });
test("safe telemetry and incomplete observations stay distinct from evaluated advice", async (t) => {
  const { homes, put } = fixture(t);
  const diagnostics = { stage: "schema", code: "SCHEMA_INVALID", duration_ms: 12.5,
    http_status: 200, requested_model: "jev-1.13.0", provider_model: null, message: "PRIVATE_SENTINEL" };
  const observation = { id: "s0", relevance: "direct", confidence: 1,
    probabilities: { direct: 1, supporting: 0, unrelated: 0, unknown: 0 }, body: "PRIVATE_SENTINEL" };
  put(homes[0], "progress", "skill-advice.json", { mode: "skill", status: "NOT_EVALUATED",
    reason: "JEV_UNAVAILABLE_OR_INVALID", input_sha256: "a".repeat(64), suggestions: [], suggestion: null,
    evaluations: [], request_diagnostics: diagnostics, incomplete_batch_progress: {
      input_sha256: "a".repeat(64), batch_index: 1, batch_count: 2, completed_batches: 1,
      completed_evaluations: 1, evaluations: [observation], requests: [
        { ...diagnostics, stage: "complete", code: "OK", provider_model: "jev-1.13.0" }, diagnostics], catalog: "PRIVATE_SENTINEL" } });
  const result = await createJevReader({ homes })(), row = result.rows[0];
  assert.equal(row.category, "error"); assert.equal(row.output, null);
  assert.deepEqual(row.suggestions, []);
  assert.equal(row.request_diagnostics.code, "SCHEMA_INVALID");
  assert.equal(row.incomplete_batch_progress.completed_batches, 1);
  assert.equal(row.incomplete_batch_progress.evaluations[0].choice, "direct");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL|"id":"s0"/);
  const view = require("../ui/monitor/jev-view.js").jevPresentation(row);
  assert.match(view.model, /Requested.*jev-1.13.0.*Provider.*not recorded/i);
  assert.match(view.proposal, /No valid reply/);
});
test("two-pass skill advice remains evaluated in the monitor without exposing instruction excerpts", async (t) => {
  const { homes, put } = fixture(t), advisor = require("./jev_agent.js");
  const input = { request: "Fix the documented export bug.", skills: [
    { name: "diagnosing-bugs", path: "private/SKILL.md", description: "Diagnose bugs", body: "PRIVATE_INSTRUCTION_EXCERPT" },
  ] };
  const fetch = async (_, options) => ({ ok: true, status: 200, json: async () => ({ model: advisor.MODEL,
    answers: require("./fixtures/jev-skill-reply.js")(JSON.parse(options.body)) }) });
  put(homes[0], "two-pass", "skill-advice.json", await advisor.advise(input, "skill", { apiKey: "TEST_KEY", fetch }));
  const result = await createJevReader({ homes })(), row = result.rows[0];
  assert.equal(row.category, "valid");
  assert.equal(row.suggestions[0].name, "diagnosing-bugs");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_INSTRUCTION_EXCERPT|private\/SKILL/);
});

test("legacy generic errors and unevaluated records retain their populations without inferred telemetry", async (t) => {
  const { homes, put } = fixture(t);
  for (let i = 0; i < 42; i++) put(homes[0], "old-task-" + i, "assessment.json", {
    policy: "jev-task-routing-v4", status: "NOT_EVALUATED", jev: null,
    reason: "Jev request timed out or returned an invalid response", task: { repo: "D:/private-" + i } });
  for (let i = 0; i < 41; i++) put(homes[0], "old-skill-" + i, "skill-advice.json", {
    mode: "skill", status: "NOT_EVALUATED", input_sha256: i.toString(16).padStart(64, "0"),
    suggestions: [], suggestion: null, reason: i < 9 ? "JEV_UNAVAILABLE_OR_INVALID" : "TYPESAFE_API_KEY_MISSING" });
  const result = await createJevReader({ homes })();
  const summary = summarizeJev(result.rows);
  assert.equal(summary.errors, 51); assert.equal(summary.notEvaluated, 32);
  for (const row of result.rows) {
    assert.equal(row.request_diagnostics, null); assert.equal(row.incomplete_batch_progress, null);
  }
});
test("invalid telemetry and unbound progress are omitted without leaking arbitrary fields", async (t) => {
  const { homes, put } = fixture(t);
  put(homes[0], "invalid", "skill-advice.json", { mode: "skill", status: "NOT_EVALUATED",
    reason: "JEV_UNAVAILABLE_OR_INVALID", input_sha256: "a".repeat(64), suggestions: [],
    request_diagnostics: { stage: "PRIVATE_SENTINEL", message: "PRIVATE_SENTINEL" },
    incomplete_batch_progress: { input_sha256: "b".repeat(64), evaluations: ["PRIVATE_SENTINEL"] } });
  const result = await createJevReader({ homes })();
  assert.equal(result.rows[0].request_diagnostics, null);
  assert.equal(result.rows[0].incomplete_batch_progress, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
});

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

test("codex-compliance-test-* fixture directory components are excluded by default and included with probes=true in Jev", () => {
  const rows = [
    { ts, repo: "D:/example", category: "valid", mode: "task" },
    { ts, repo: "/tmp/codex-compliance-test-abc/repo", category: "error", mode: "task" },
    { ts, repo: "C:\\temp\\codex-compliance-test-def\\repo", category: "error", mode: "skill" },
    { ts, repo: "C:/temp/CODEX-COMPLIANCE-TEST-XYZ/repo", category: "error", mode: "context" },
    { ts, repo: "D:/projects/my-codex-compliance-test-suite", category: "valid", mode: "task" },
    { ts, repo: "D:/projects/codex-compliance-test", category: "valid", mode: "skill" },
    { ts, repo: "D:/.tmp-dely/probe", category: "error", mode: "task" },
  ];
  const end = Date.parse(ts) + 1000;

  const def = summarizeJev(rows, { asOf: end });
  assert.equal(def.recorded, 3);
  assert.equal(def.valid, 3);
  assert.equal(def.errors, 0);

  const withProbes = summarizeJev(rows, { probes: true, asOf: end });
  assert.equal(withProbes.recorded, 7);
  assert.equal(withProbes.valid, 3);
  assert.equal(withProbes.errors, 4);
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
  const reset = summarizeJev([...rows, { ts: "invalid", repo: "D:/example", category: "unknown", mode: "context" }],
    { since: end, asOf: end, explicitReset: true, mode: "context", repo: "D:/example" });
  assert.equal(reset.recorded, 0); assert.equal(reset.unknownTime, 0);
  assert.equal(reset.excludedUnknownTime, 2);
});

function workflowFixture(t) {
  const base = fixture(t), crypto = require("node:crypto");
  const digest = value => crypto.createHash("sha256").update(value).digest("hex");
  const session = "c".repeat(64), turn = "fixture-turn", directory = session + "-" + digest(turn).slice(0, 16);
  const root = home => path.join(home, "dely-compliance", "jev-workflow");
  function pointer(home, overrides = {}) {
    fs.mkdirSync(root(home), { recursive: true });
    const target = path.join(root(home), session + ".json");
    fs.writeFileSync(target, JSON.stringify({ cwd: "D:/example", turn, prompt: "PRIVATE_SENTINEL", ...overrides }));
    return target;
  }
  function saved(home, value, kind = "cache", name = digest(JSON.stringify(value))) {
    const target = path.join(root(home), directory, `${kind}-${name}.json`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
    return target;
  }
  return { ...base, pointer, saved, workflowRoot: root, directory };
}
const noul = value => ({ type: "noul", noul: value, secret: "PRIVATE_SENTINEL" });
const contextChoice = { relevance: "direct", confidence: 0.9, probabilities: { direct: 1, supporting: 0, unknown: 0, unrelated: 0 } };
function workflowSamples() {
  return [
    { mode: "guardrails", status: "REVIEW_REQUIRED", input_sha256: "a".repeat(64), commands: [{
      command: "PRIVATE_SENTINEL", id: "PRIVATE_SENTINEL", hazards: {
        destructive_effects: noul(0.8), sensitive_data_access: noul(0.1), elevated_privileges: noul(0.2),
        scope_mismatch: { status: "NOT_EVALUATED", reason: "UNCONFIRMED_SCOPE", body: "PRIVATE_SENTINEL" },
        exfiltration: { status: "NOT_EVALUATED", reason: "UNCONFIRMED_SCOPE" } } }] },
    { mode: "context", status: "REVIEW_REQUIRED", input_sha256: "b".repeat(64), sources: [{ ...contextChoice,
      path: "PRIVATE_SENTINEL", source: "PRIVATE_SENTINEL", passage_signals: { evidence: noul(0.8), conflict: noul(0.2), injection: noul(0.1) } }] },
    { mode: "citations", status: "REVIEW_REQUIRED", input_sha256: "c".repeat(64), citations: [{
      claim: "PRIVATE_SENTINEL", quote: "PRIVATE_SENTINEL", path: "PRIVATE_SENTINEL", reason: "PRIVATE_SENTINEL",
      judgment: "supported", status: "REVIEW_REQUIRED", evaluation_status: "EVALUATED", confidence: 0.8,
      probabilities: { supported: 1, unsupported: 0, contradicted: 0 } }] },
  ];
}

test("workflow cache, feedback and runtime copies deduplicate all three phases without exposing content", async t => {
  const { homes, saved, pointer, put } = workflowFixture(t);
  for (const home of homes) {
    pointer(home);
    for (const value of workflowSamples()) { saved(home, value); saved(home, value, "feedback"); }
  }
  put(homes[0], "old-task", "assessment.json", assessment());
  put(homes[0], "old-context", "context-advice.json", { mode: "context", status: "REVIEW_REQUIRED", ranked_context: [contextChoice] });
  const read = createJevReader({ homes });
  const result = await read(), again = await read();
  assert.equal(result.rows.length, 5);
  for (const row of result.rows.filter(row => row.origin === "workflow")) {
    assert.equal(row.sources.length, 4); assert.equal(row.repo, "D:/example");
    assert.equal(row.workspaceSource, "matching saved session pointer");
    assert.equal(row.ts, null); assert.equal(row.model, null); assert.equal(row.request_diagnostics, null);
    assert.equal(row.category, "valid");
  }
  assert.equal(result.coverage[0].workflow.loaded, 6);
  assert.deepEqual(result.coverage[0].workflow.modes, { guardrails: 2, workflow_context: 2, citations: 2 });
  assert.deepEqual(again.rows, result.rows); assert.ok(again.cache.hits >= 12);
  const stats = summarizeJev(result.rows, { asOf: Date.parse(ts) + 1 });
  assert.deepEqual(stats.modes, { task: 1, skill: 0, context: 1, guardrails: 1, workflow_context: 1, citations: 1 });
  assert.equal(stats.valid, 5);
  for (const mode of ["guardrails", "workflow_context", "citations"]) {
    const phase = stats.effectiveness.phases.find(phase => phase.mode === mode);
    assert.deepEqual(phase.validReplyRate, { numerator: 1, denominator: 1, rate: 1 });
    assert.deepEqual(phase.latency, { samples: 0, records: 1, medianMs: null, p95Ms: null });
    assert.equal(summarizeJev(result.rows, { mode, repo: "D:/example" }).recorded, 1);
  }
  assert.equal(summarizeJev(result.rows, { explicitReset: true }).recorded, 1);
  assert.equal(stats.unknownTime, 4);
  assert.doesNotMatch(JSON.stringify({ result, stats }), /PRIVATE_SENTINEL|"prompt"|"command"|"claim"|"quote"|"path"/);
  assert.match(visibleJevRows(result.rows.filter(row => row.origin === "workflow"))[0].textContent, /matching saved session pointer.*evaluation time not saved/);
});

test("historical citation replies retain missing evaluation-status provenance and strict validation", async t => {
  const { homes, saved } = workflowFixture(t);
  const citation = workflowSamples()[2];
  const { evaluation_status, ...legacy } = citation.citations[0];
  const record = (item, extra = {}) => ({ ...citation, ...extra, citations: [item] });
  const historical = record(legacy);
  for (const home of homes) {
    saved(home, historical); saved(home, historical, "feedback");
  }
  const rejected = [
    { ...legacy, evaluation_status: "NOT_EVALUATED" },
    { ...legacy, evaluation_status: null },
    { ...legacy, evaluation_status: "PRIVATE_SENTINEL" },
    { ...legacy, confidence: 2 },
    { ...legacy, probabilities: { supported: 1, unsupported: 0 } },
    { ...legacy, probabilities: { supported: 0, unsupported: 1, contradicted: 0 } },
    { ...legacy, judgment: "fabricated" },
    { ...legacy, judgment: "PRIVATE_SENTINEL" },
  ];
  for (const item of rejected) saved(homes[0], record(item));
  saved(homes[0], record(legacy, { status: "NOT_EVALUATED" }));
  const result = await createJevReader({ homes })();
  const rows = result.rows, valid = rows.filter(row => row.category === "valid");
  assert.equal(rows.length, 10);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].sources.length, 4);
  assert.equal(valid[0].output[0].evidence, "recorded Jev reply");
  assert.equal(valid[0].output[0].evaluationStatus, "not recorded (legacy reply)");
  assert.equal(rows.filter(row => row.category === "unknown").length, 8);
  assert.equal(rows.filter(row => row.category === "not_evaluated").length, 1);
  const phase = summarizeJev(rows).effectiveness.phases.find(phase => phase.mode === "citations");
  assert.deepEqual(phase.validReplyRate, { numerator: 1, denominator: 1, rate: 1 });
  assert.deepEqual(phase.latency, { samples: 0, records: 10, medianMs: null, p95Ms: null });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL|"claim"|"quote"|"path"/);
});

test("workflow invalid, unevaluated and local-only results never become confirmed errors or Jev replies", async t => {
  const { homes, saved } = workflowFixture(t);
  const [guard, context, citation] = workflowSamples();
  for (const value of [guard, context, citation,
    { ...guard, input_sha256: "d".repeat(64), commands: [{ hazards: { destructive_effects: noul(2) } }] },
    { mode: "guardrails", status: "NOT_EVALUATED", reason: "JEV_UNAVAILABLE_OR_INVALID" },
    { mode: "context", status: "NOT_EVALUATED", reason: "TYPESAFE_API_KEY_MISSING" },
    { mode: "citations", status: "NOT_EVALUATED", reason: "PRIVATE_SENTINEL", citations: [{ claim: "PRIVATE_SENTINEL" }] },
    { ...citation, status: "NOT_EVALUATED", input_sha256: "e".repeat(64) },
    { mode: "citations", status: "REVIEW_REQUIRED", citations: [{ judgment: "fabricated", evaluation_status: "EVALUATED", quote: "PRIVATE_SENTINEL" }] },
    { mode: "citations", status: "REVIEW_REQUIRED", citations: [{ judgment: "NOT_EVALUATED", evaluation_status: "NOT_EVALUATED" }] },
    { mode: "guardrails", status: "PRIVATE_SENTINEL" },
  ]) saved(homes[0], value);
  const rows = (await createJevReader({ homes })()).rows, stats = summarizeJev(rows);
  assert.equal(stats.recorded, 11); assert.equal(stats.valid, 3); assert.equal(stats.errors, 1);
  assert.equal(stats.notEvaluated, 5); assert.equal(stats.unknown, 2);
  assert.equal(stats.unknownWorkspace, 11); assert.equal(stats.unknownTime, 11);
  const guardPhase = stats.effectiveness.phases.find(phase => phase.mode === "guardrails");
  assert.deepEqual(guardPhase.validReplyRate, { numerator: 1, denominator: 2, rate: 0.5 });
  const citationPhase = stats.effectiveness.phases.find(phase => phase.mode === "citations");
  assert.equal(citationPhase.evaluated, 1);
  assert.equal(stats.effectiveness.distributions.find(item => item.signal === "fabricated").count, 1);
  assert.equal(stats.effectiveness.outcomeEvidence, "NOT_MEASURED");
  assert.doesNotMatch(JSON.stringify(stats), /PRIVATE_SENTINEL/);
});

test("ready workflow records remain available when the task root is unreadable", async t => {
  const { homes, saved } = workflowFixture(t);
  saved(homes[0], workflowSamples()[1]);
  fs.writeFileSync(path.join(homes[0], "dely-compliance", "tasks"), "unsafe task root");
  const result = await createJevReader({ homes: [homes[0]] })();
  assert.equal(result.rows.length, 1);
  assert.equal(result.coverage[0].taskState, "unreadable");
  assert.equal(result.coverage[0].workflow.state, "ready");
  assert.equal(result.coverage[0].state, "partial");
  assert.equal(result.coverage.some(source => ["ready", "partial"].includes(source.state)), true);
});

test("workflow refresh handles pointer changes, deletion, bounded malformed data and unsafe files", async t => {
  const { homes, saved, pointer, workflowRoot, directory, root } = workflowFixture(t);
  const [guard, context] = workflowSamples(), pointerPath = pointer(homes[0]);
  const file = saved(homes[0], guard);
  const malformed = saved(homes[0], "{", "cache", "1".repeat(64));
  saved(homes[0], "x".repeat(32769), "cache", "2".repeat(64));
  const unsafe = path.join(workflowRoot(homes[0]), directory, "feedback-" + "3".repeat(64) + ".json");
  fs.mkdirSync(unsafe); // Non-file entry.
  const target = path.join(root, "outside.json"); fs.writeFileSync(target, JSON.stringify(context));
  let linked = false;
  try { fs.symlinkSync(target, path.join(path.dirname(file), "cache-" + "4".repeat(64) + ".json")); linked = true; } catch (error) { assert.ok(["EPERM", "EACCES"].includes(error.code)); }
  const read = createJevReader({ homes });
  let result = await read();
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].repo, "D:/example");
  assert.equal(result.coverage[0].workflow.malformed, 1); assert.equal(result.coverage[0].workflow.oversized, 1);
  assert.equal(result.coverage[0].workflow.excluded, linked ? 2 : 1);
  assert.equal(result.coverage[0].workflow.state, "partial");
  result = await read(); assert.equal(result.coverage[0].workflow.malformed, 1);
  pointer(homes[0], { turn: "different-turn" });
  result = await read(); assert.equal(result.rows[0].repo, null);
  assert.equal(result.coverage[0].workflow.malformed, 2);
  pointer(homes[0], { cwd: "D:/changed" });
  fs.writeFileSync(file, JSON.stringify(context));
  result = await read(); assert.equal(result.rows[0].mode, "workflow_context"); assert.equal(result.rows[0].repo, "D:/changed");
  fs.unlinkSync(pointerPath);
  result = await read(); assert.equal(result.rows[0].repo, null); assert.equal(result.rows[0].ts, null);
  fs.unlinkSync(file); fs.unlinkSync(malformed);
  result = await read(); assert.equal(result.rows.length, 0);
  assert.equal(result.coverage[0].workflow.loaded, 0);
  if (linked) {
    fs.rmSync(workflowRoot(homes[1]), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(workflowRoot(homes[1])), { recursive: true });
    fs.symlinkSync(workflowRoot(homes[0]), workflowRoot(homes[1]), process.platform === "win32" ? "junction" : "dir");
    result = await read(); assert.equal(result.coverage[1].workflow.state, "unreadable"); assert.equal(result.rows.length, 0);
  }
});

test("Control agreement uses paired evaluations and final ordered reviews once, with telemetry denominators", async t => {
  const { homes, put } = fixture(t);
  const telemetry = duration_ms => ({ stage: "complete", code: "OK", duration_ms, http_status: 200,
    requested_model: "jev-1.13.0", provider_model: "jev-1.13.0" });
  for (let i = 0; i < 4; i++) {
    const value = assessment({ assessed_at: new Date(Date.parse(ts) + i).toISOString(), request_diagnostics: telemetry([10, 20, 30, 100][i]) });
    put(homes[0], "task-" + i, "assessment.json", value);
    if (i < 2) {
      const reviewed = { ...value, status: "APPROVED", difficulty: i ? "easy" : "medium_plus",
        review: { by: "codex-control", reviewed_at: ts } };
      put(homes[0], "task-" + i, "reviewed.json", reviewed);
      put(homes[1], "copy-" + i, "reviewed.json", reviewed);
    }
    if (i === 3) for (let j = 0; j < 2; j++) put(homes[j], "ambiguous-" + j, "reviewed.json", {
      ...value, status: "APPROVED", difficulty: j ? "easy" : "medium_plus", review: { by: "codex-control" } });
  }
  const rows = (await createJevReader({ homes })()).rows;
  assert.equal(rows.length, 4);
  let stats = summarizeJev(rows, { asOf: Date.parse(ts) + 100 });
  assert.deepEqual(stats.effectiveness.agreement, { proposed: 4, paired: 2, agreed: 1, disagreed: 1, missingReview: 1, ambiguousReview: 1 });
  assert.deepEqual(stats.effectiveness.phases[0].latency, { samples: 4, records: 4, medianMs: 25, p95Ms: 100 });
  const ambiguous = rows.find(row => row.control.some(review => review.reviewedAt === null));
  ambiguous.control = [{ status: "APPROVED", difficulty: "easy", reviewedAt: ts },
    { status: "APPROVED", difficulty: "medium_plus", reviewedAt: new Date(Date.parse(ts) + 20).toISOString() }];
  stats = summarizeJev(rows, { asOf: Date.parse(ts) + 100 });
  assert.equal(stats.effectiveness.agreement.paired, 3); assert.equal(stats.effectiveness.agreement.agreed, 2);
  const zero = summarizeJev(rows, { mode: "workflow_context" }).effectiveness;
  assert.equal(zero.agreement.proposed, 0); assert.equal(zero.phases[0].validReplyRate.rate, null);
});

test("a shared session pointer is matched separately for each turn, including cached reads and conflicting homes", async t => {
  const { homes, saved, pointer, workflowRoot, directory } = workflowFixture(t);
  const crypto = require("node:crypto"), staleTurn = "prior-turn";
  const staleDir = directory.slice(0, 65) + crypto.createHash("sha256").update(staleTurn).digest("hex").slice(0, 16);
  for (const home of homes) {
    pointer(home);
    const currentFile = saved(home, workflowSamples()[0]);
    fs.mkdirSync(path.join(workflowRoot(home), staleDir));
    fs.copyFileSync(currentFile, path.join(workflowRoot(home), staleDir, path.basename(currentFile)));
  }
  const read = createJevReader({ homes });
  for (let i = 0; i < 2; i++) {
    const result = await read();
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows.find(row => row.sources[0].task === directory).repo, "D:/example");
    assert.equal(result.rows.find(row => row.sources[0].task === staleDir).repo, null);
  }
  pointer(homes[1], { cwd: "D:/conflict" });
  const row = (await read()).rows.find(row => row.sources[0].task === directory);
  assert.equal(row.repo, null); assert.equal(row.workspaceSource, "conflicting saved session pointers");
});
