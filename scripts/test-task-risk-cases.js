"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const routing = require("../skills/delivery/scripts/task-routing.js");

const createdDirs = [];

function createTask(spec, context) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "routing-tests-risk-cases-")));
  createdDirs.push(repo);
  fs.writeFileSync(path.join(repo, "spec.md"), spec, "utf8");
  fs.writeFileSync(path.join(repo, "context.json"), JSON.stringify(context, null, 2), "utf8");
  return routing.loadTask(repo, "spec.md", "context.json");
}

after(() => {
  const tmp = fs.realpathSync(os.tmpdir());
  for (const dir of createdDirs) {
    const resolved = fs.realpathSync(dir);
    assert.ok(
      resolved.startsWith(tmp + path.sep) &&
      path.basename(resolved).startsWith("routing-tests-risk-cases-"),
      `Path ${resolved} is not an isolated temporary repository prefixed routing-tests-risk-cases-`
    );
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

function createMockFetch(tracker) {
  const q = routing.questions();
  const labels = ["hard", "insufficient_evidence", "medium_plus", "medium_minus", "easy"];
  const answers = Object.fromEntries(
    Object.keys(q).map((id) => [
      id,
      {
        type: "choice",
        choice: "medium_minus",
        confidence: 1,
        probabilities: Object.fromEntries(labels.map((lbl) => [lbl, lbl === "medium_minus" ? 1 : 0])),
      },
    ])
  );
  const responseBody = {
    model: routing.MODEL,
    answers,
    usage: { input_tokens: 300, output_tokens: 0 },
  };

  return async (url, options) => {
    tracker.calls++;
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(options.method, "POST");
    return {
      ok: true,
      json: async () => responseBody,
    };
  };
}

async function verifyBenignRiskScenario(task, reviewReason) {
  const tracker = { calls: 0 };
  const fetch = createMockFetch(tracker);
  const assessed = await routing.assess(task, { apiKey: "test-key", fetch });

  assert.equal(tracker.calls, 1, "API must be called exactly once");
  assert.equal(assessed.status, "REVIEW_REQUIRED");
  assert.equal(assessed.difficulty, "medium_minus");

  const reviewed = routing.review(assessed, "medium_minus", reviewReason);
  assert.equal(reviewed.status, "APPROVED");
  assert.equal(reviewed.difficulty, "medium_minus");
  assert.equal(reviewed.route.workflow, "dely");
  assert.equal(reviewed.route.primary.harness, "antigravity");
  assert.equal(reviewed.route.primary.model, "gemini-3.8-flash-medium");
  assert.equal(reviewed.route.primary.effort, "default");
  assert.equal(routing.selectedPhase(reviewed, {}), "implement_backup");
  assert.deepEqual(routing.selectedPin(reviewed, {}), {
    harness: "antigravity",
    model: "gemini-3.8-flash-medium",
    effort: "default",
  });

  const assessmentFile = path.join(task.repo, "assessment.json");
  fs.writeFileSync(assessmentFile, JSON.stringify(reviewed, null, 2), "utf8");
  const approved = routing.requireApprovedRoute({
    repo: task.repo,
    "spec-file": "spec.md",
    "assessment-file": "assessment.json",
  });
  assert.equal(routing.selectedPhase(approved, {}), "implement_backup");
  assert.deepEqual(routing.selectedPin(approved, {}), {
    harness: "antigravity",
    model: "gemini-3.8-flash-medium",
    effort: "default",
  });
}

test("auth documentation/tests preserving authority", async () => {
  const spec = "Document existing token authentication invariants and add regression unit tests for header parsing; authority and permission boundaries are preserved without change.";
  const context = {
    scope: "Documentation in docs/auth.md and unit tests in tests/auth.test.js",
    coupling: "Known internal token validation helper; authority checks unchanged",
    acceptance: "Unit tests verify existing header parsing logic; authority and permission enforcement unchanged",
    evidence: "docs/auth.md and tests/auth.test.js inspected against token validator implementation",
    requirements_confirmed: true,
    risks: {
      security: false,
      data: false,
      public_contract: false,
      architecture: false,
      production: false,
      routing: false,
    },
  };
  const t = createTask(spec, context);
  await verifyBenignRiskScenario(
    t,
    "Documentation and tests of existing authentication preserve authority and permission boundaries without change"
  );
});

test("a local data parser preserving meaning", async () => {
  const spec = "Refactor private helper in local CSV parser to handle trailing commas while preserving schema semantics, business meaning, and data integrity.";
  const context = {
    scope: "Private helper parseRow in src/csv-parser.js",
    coupling: "Known internal caller parseCsv; schema and data storage untouched",
    acceptance: "Local unit tests confirm trailing commas parse correctly with identical record structure",
    evidence: "csv-parser.js and fixture tests inspected; authoritative data schema unchanged",
    requirements_confirmed: true,
    risks: {
      security: false,
      data: false,
      public_contract: false,
      architecture: false,
      production: false,
      routing: false,
    },
  };
  const t = createTask(spec, context);
  await verifyBenignRiskScenario(
    t,
    "Local CSV parser adjustment preserves data format semantics and business meaning without schema alteration"
  );
});

test("an internal API helper preserving the public contract", async () => {
  const spec = "Extract an internal URL normalization helper for service client requests; public API signature and wire protocol contract remain strictly backward-compatible.";
  const context = {
    scope: "Private helper formatUrl in lib/client.js",
    coupling: "Internal callers inside HTTP client; public export signatures preserved",
    acceptance: "Client integration tests pass without modifying public endpoint contracts or schemas",
    evidence: "lib/client.js and public index.js exports verified",
    requirements_confirmed: true,
    risks: {
      security: false,
      data: false,
      public_contract: false,
      architecture: false,
      production: false,
      routing: false,
    },
  };
  const t = createTask(spec, context);
  await verifyBenignRiskScenario(
    t,
    "Internal API helper refactoring preserves public interface and wire compatibility guarantees"
  );
});

test("a known internal extraction preserving system boundaries", async () => {
  const spec = "Extract formatting logic from worker coordinator into an internal helper module within the existing package boundary; system architecture and boundaries remain intact.";
  const context = {
    scope: "Extract internal formatTaskSummary into lib/formatters.js",
    coupling: "Known internal package consumers; architectural boundaries preserved",
    acceptance: "Existing unit tests pass with extracted helper imported",
    evidence: "Module boundaries and import graph in package verified",
    requirements_confirmed: true,
    risks: {
      security: false,
      data: false,
      public_contract: false,
      architecture: false,
      production: false,
      routing: false,
    },
  };
  const t = createTask(spec, context);
  await verifyBenignRiskScenario(
    t,
    "Known internal extraction within established module boundaries preserves system architecture"
  );
});

test("local tests in a production repository without rollout", async () => {
  const spec = "Add isolated unit tests for date calculation utility in a repository deployed to production; purely local test verification with no production cutover or rollout.";
  const context = {
    scope: "Unit tests in test/date-utils.test.js for date calculation functions",
    coupling: "Independent test suite; no production services or deploy scripts touched",
    acceptance: "node --test test/date-utils.test.js passes in local worktree",
    evidence: "Production service untouched; test-only changes verified in local worktree",
    requirements_confirmed: true,
    risks: {
      security: false,
      data: false,
      public_contract: false,
      architecture: false,
      production: false,
      routing: false,
    },
  };
  const t = createTask(spec, context);
  await verifyBenignRiskScenario(
    t,
    "Local test addition in production repository involves no live cutover, migration, or rollout"
  );
});

test("ordinary reviewed Dely/worktree coordination without policy/ownership changes", async () => {
  const spec = "Perform routine Dely worktree preparation and dispatch review check under established task routing policy; delegation rules, admission gates, and ownership remain unchanged.";
  const context = {
    scope: "Routine Dely worktree task preparation and coordination",
    coupling: "Standard review workflow under established routing policy",
    acceptance: "Preflight checks succeed under existing policy without changing gates or ownership",
    evidence: "Task spec, context, and review invariants verified against existing routing policy",
    requirements_confirmed: true,
    risks: {
      security: false,
      data: false,
      public_contract: false,
      architecture: false,
      production: false,
      routing: false,
    },
  };
  const t = createTask(spec, context);
  await verifyBenignRiskScenario(
    t,
    "Ordinary reviewed Dely worktree coordination operates within existing routing policy and worker ownership"
  );
});
