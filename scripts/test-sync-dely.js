"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { bundle, plan, sync, oldPlugins, windowsCodexEntry } = require("./sync-dely.js");
const { install } = require("./codex-compliance.js");

function put(root, name, value) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}

function fixture(t, count = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dely-sync-test-"));
  // Only this test's unique temporary directory is removed.
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith("dely-sync-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, "source");
  for (const file of ["package.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    put(source, file, { version: "1.0.0" });
  }
  put(source, ".claude-plugin/marketplace.json", { name: "dely", plugins: [{ name: "dely", source: "./" }] });
  for (const file of ["harnesses.json", "plugin.json", ".cursor-plugin/plugin.json"]) put(source, file, {});
  for (const file of ["skills/delivery/SKILL.md", "skills/delivery/scripts/task-routing.js",
    "skills/delivery/scripts/dely.js", "skills/delivery/scripts/usage.js", "extensions/pin.ts"]) put(source, file, "fixture");
  put(source, "scripts/jev_agent.js", 'const ROOT = path.resolve(__dirname, "..");');
  put(source, "scripts/codex-compliance.js", fs.readFileSync(path.join(__dirname, "codex-compliance.js")));
  for (const name of ["codex-compliance", "task-risk-policy", "jev-skill-advice"]) {
    put(source, "docs/" + name + ".md", fs.readFileSync(path.join(__dirname, "../docs", name + ".md")));
  }
  for (const name of ["sync-dely.js", "setup-global.ps1"]) put(source, "scripts/" + name, fs.readFileSync(path.join(__dirname, name)));
  put(source, "docs/dely-updates.md", fs.readFileSync(path.join(__dirname, "../docs/dely-updates.md")));
  const homes = Array.from({ length: count }, (_, index) => path.join(root, "home" + index));
  for (const home of homes) {
    const catalog = path.join(home, "plugins/cache/dely/dely/1.0.0");
    fs.cpSync(source, catalog, { recursive: true });
    const hooks = { hooks: Object.fromEntries(["SessionStart", "UserPromptSubmit", "PreToolUse", "Stop"].map((event) =>
      [event, [{ hooks: [{ command: "node codex-compliance.js hook", statusMessage: "Checking Jev and Dely task evidence" }] }]])) };
    put(home, "hooks.json", hooks);
    put(home, "config.toml", '[plugins."dely@dely-orca-poc"]\r\nenabled = true # old\r\n\r\n[plugins."dely@dely"]\r\nenabled = true\r\n\r\n[plugins."other@other"]\r\nenabled = true\r\n');
    put(home, "dely-compliance/settings.json", { delivery: path.join(source, "skills/delivery/SKILL.md"),
      routing: path.join(source, "skills/delivery/scripts/task-routing.js"), dely: path.join(source, "skills/delivery/scripts/dely.js"),
      advisor_source: path.join(source, "scripts/jev_agent.js"), credential_root: "confirmed-key-root" });
  }
  const options = { source, homes };
  return { root, source, homes, options, expected: bundle(source).sha256 };
}

test("plan detects canonical path drift without writing or treating equal bytes as equal paths", (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.homes[0], "dely-compliance/settings.json"));
  const result = plan(f.options);
  assert.equal(result.status, "BINDING_DRIFT");
  assert.deepEqual(result.homes[0].different, []);
  assert.deepEqual(result.homes[0].drift.slice(0, 4), ["delivery", "routing", "dely", "advisor_source"]);
  assert.ok(fs.readFileSync(path.join(f.homes[0], "dely-compliance/settings.json")).equals(before));
  assert.equal(fs.existsSync(path.join(f.homes[0], "dely-compliance/backups")), false);
});

test("same version with a different fallback module cannot be overwritten", (t) => {
  const f = fixture(t);
  put(f.source, "skills/delivery/scripts/network-fallback.js", "new authority");
  const expected = bundle(f.source).sha256;
  assert.equal(plan(f.options).status, "SOURCE_NOT_PUBLISHED");
  assert.throws(() => sync(f.options, { publish: true, expected }), /advance the release version/);
  assert.equal(fs.existsSync(path.join(f.homes[0], "dely-compliance/backups")), false);
});

test("real installer coheres two homes, preserves trust and key root, and retains old sources", (t) => {
  const f = fixture(t, 2);
  const hooks = f.homes.map((home) => fs.readFileSync(path.join(home, "hooks.json")));
  const frozen = path.join(f.root, "old-frozen/evidence.json");
  put(f.root, "old-frozen/evidence.json", "retained evidence");
  const result = sync(f.options, { expected: f.expected, install });
  assert.equal(result.status, "COHERENT");
  for (const [index, home] of f.homes.entries()) {
    assert.ok(fs.readFileSync(path.join(home, "hooks.json")).equals(hooks[index]));
    const settings = JSON.parse(fs.readFileSync(path.join(home, "dely-compliance/settings.json")));
    assert.equal(settings.credential_root, "confirmed-key-root");
    assert.equal(settings.delivery, fs.realpathSync(path.join(home, "plugins/cache/dely/dely/1.0.0/skills/delivery/SKILL.md")));
    assert.match(fs.readFileSync(path.join(home, "config.toml"), "utf8"), /enabled = false # old\r\n/);
    assert.match(fs.readFileSync(path.join(home, "config.toml"), "utf8"), /other@other"\]\r\nenabled = true/);
  }
  assert.equal(fs.readFileSync(frozen, "utf8"), "retained evidence");
  assert.equal(result.backups.length, 2);
});

test("partial second-home failure restores every original profile and reports failure", (t) => {
  const f = fixture(t, 2);
  const before = f.homes.map((home) => fs.readFileSync(path.join(home, "dely-compliance/settings.json")));
  let calls = 0;
  assert.throws(() => sync(f.options, { expected: f.expected, install(options, home) {
    install(options, home);
    if (++calls === 2) throw Error("injected failure");
  } }), /profile files restored.*injected failure/);
  f.homes.forEach((home, index) => {
    assert.ok(fs.readFileSync(path.join(home, "dely-compliance/settings.json")).equals(before[index]));
    assert.match(fs.readFileSync(path.join(home, "config.toml"), "utf8"), /enabled = true # old/);
    assert.equal(fs.existsSync(path.join(home, "dely-compliance/codex-compliance.js")), false);
  });
});

test("missing approval, changed source, outside target and extra runtime members fail closed", (t) => {
  const f = fixture(t);
  assert.throws(() => sync(f.options), /expected-sha/);
  assert.throws(() => sync(f.options, { expected: "0".repeat(64) }), /expected-sha/);
  assert.throws(() => sync({ ...f.options, catalog: f.source }, { expected: f.expected }), /not a custom catalog/);
  const catalog = path.join(f.homes[0], "plugins/cache/dely/dely/1.0.0");
  put(catalog, "skills/extra/SKILL.md", "unreviewed skill");
  assert.deepEqual(plan(f.options).homes[0].different, ["skills/extra/SKILL.md"]);
  assert.throws(() => sync(f.options, { expected: f.expected }), /not published/);
});

test("postflight detects stale installed software and a disabled selected catalog", (t) => {
  const f = fixture(t);
  sync(f.options, { expected: f.expected, install });
  put(f.homes[0], "dely-compliance/codex-compliance.js", "stale adapter");
  put(f.homes[0], "config.toml", '[plugins."dely@dely"]\nenabled = false\n');
  const drift = plan(f.options).homes[0].drift;
  assert.ok(drift.includes("catalog_registration"));
  assert.ok(drift.includes("dely-compliance/codex-compliance.js"));
});

test("only the named obsolete Dely plugin entries are disabled", () => {
  const text = '[plugins."dely@dely-orca-agy-global"]\nenabled = true\n[plugins."dely@dely"]\nenabled = true\n';
  assert.deepEqual(oldPlugins(text).enabled, ["dely@dely-orca-agy-global"]);
  const updated = oldPlugins(text, true).text;
  assert.match(updated, /agy-global"\]\nenabled = false/);
  assert.match(updated, /plugins\."dely@dely"\]\nenabled = true/);
});

test("publisher uses only the selected source and verifies copied bytes before installation", (t) => {
  const f = fixture(t);
  const calls = [];
  const result = sync(f.options, { expected: f.expected, publish: true, install,
    codex(home, args) {
      calls.push({ home, args });
      return args[0] === "marketplace" ? { installedRoot: args[2] } :
        { pluginId: "dely@dely", installedPath: path.join(home, "plugins/cache/dely/dely/1.0.0") };
    } });
  assert.equal(result.status, "COHERENT");
  assert.deepEqual(calls.map((call) => call.args.slice(0, 2)), [["marketplace", "add"], ["add", "dely@dely"]]);
  const published = calls[0].args[2];
  assert.ok(published.startsWith(path.join(f.homes[0], "dely-releases") + path.sep));
  assert.equal(bundle(published).sha256, f.expected);
});

test("an existing sync lock stops mutation and acquired locks are released after failure", (t) => {
  const f = fixture(t, 2);
  const otherLock = path.join(f.homes[1], "dely-compliance/sync.lock");
  fs.writeFileSync(otherLock, "another updater");
  assert.throws(() => sync(f.options, { expected: f.expected, install }), /EEXIST/);
  assert.equal(fs.existsSync(path.join(f.homes[0], "dely-compliance/sync.lock")), false);
  assert.equal(fs.readFileSync(otherLock, "utf8"), "another updater");
  assert.equal(fs.existsSync(path.join(f.homes[0], "dely-compliance/backups")), false);
});

test("a shared catalog stays inside selected homes and duplicate homes do not self-lock", (t) => {
  const f = fixture(t, 2);
  const ownPlugins = path.join(f.homes[1], "plugins");
  // A private test-owned tree is replaced by a junction, matching Orca's shared cache.
  assert.ok(path.resolve(ownPlugins).startsWith(path.resolve(f.root) + path.sep));
  fs.rmSync(ownPlugins, { recursive: true });
  fs.symlinkSync(path.join(f.homes[0], "plugins"), ownPlugins, "junction");
  const result = sync({ ...f.options, homes: [...f.homes, f.homes[0]] }, { expected: f.expected, install });
  assert.equal(result.status, "COHERENT");
  assert.equal(result.homes.length, 2);
  assert.equal(fs.realpathSync(result.homes[0].catalog), fs.realpathSync(result.homes[1].catalog));
});

test("release versions cannot escape the managed cache root", (t) => {
  const f = fixture(t);
  put(f.source, "package.json", { version: "../../outside" });
  assert.throws(() => plan(f.options), /Invalid release version/);
});

test("publisher excludes local task history and retains a previous frozen snapshot", (t) => {
  const f = fixture(t);
  put(f.source, "docs/_plans/private.json", "private task");
  put(f.source, ".dely/local/private.json", "private task");
  let published;
  sync(f.options, { expected: f.expected, publish: true, install, codex(home, args) {
    if (args[0] === "marketplace") { published = args[2]; return { installedRoot: published }; }
    return { pluginId: "dely@dely", installedPath: path.join(home, "plugins/cache/dely/dely/1.0.0") };
  } });
  assert.equal(fs.existsSync(path.join(published, "docs/_plans/private.json")), false);
  assert.equal(fs.existsSync(path.join(published, ".dely/local/private.json")), false);
  assert.equal(bundle(published).sha256, f.expected);
  assert.throws(() => {
    put(f.source, "scripts/.env", "private");
    plan(f.options);
  }, /Private environment file/);
});

test("published shell files use canonical LF and a CRLF cache is never accepted as matching", (t) => {
  const f = fixture(t);
  put(f.source, "skills/delivery/scripts/dely", "#!/bin/sh\r\ncase x in\r\nx) : ;;\r\nesac\r\n");
  const ownCatalog = path.join(f.homes[0], "plugins/cache/dely/dely/1.0.0");
  assert.ok(path.resolve(ownCatalog).startsWith(path.resolve(f.root) + path.sep));
  fs.rmSync(ownCatalog, { recursive: true });
  let published;
  const result = sync(f.options, { expected: bundle(f.source).sha256, publish: true, install, codex(home, args) {
    if (args[0] === "marketplace") { published = args[2]; return { installedRoot: published }; }
    fs.cpSync(published, ownCatalog, { recursive: true });
    return { pluginId: "dely@dely", installedPath: ownCatalog };
  } });
  assert.equal(result.status, "COHERENT");
  const shell = fs.readFileSync(path.join(ownCatalog, "skills/delivery/scripts/dely"), "utf8");
  assert.equal(shell.includes("\r"), false);
  put(ownCatalog, "skills/delivery/scripts/dely", shell.replace(/\n/g, "\r\n"));
  assert.equal(plan(f.options).status, "SOURCE_NOT_PUBLISHED");
});

test("Windows resolution ignores extensionless launchers and verifies the native npm entrypoint", (t) => {
  const f = fixture(t);
  const linux = path.join(f.root, "linux-bin"), native = path.join(f.root, "native-bin");
  put(linux, "codex", "#!/bin/sh\nexit 0\n");
  put(native, "codex.cmd", '@echo off\nnode "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\n');
  put(native, "node_modules/@openai/codex/bin/codex.js", "native fixture");
  assert.equal(windowsCodexEntry([linux, native].join(path.delimiter)),
    fs.realpathSync(path.join(native, "node_modules/@openai/codex/bin/codex.js")));
  assert.throws(() => windowsCodexEntry(linux), /no launcher was executed/);
});

test("a CLI success with the wrong catalog identity is rejected before changing bindings", (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.homes[0], "dely-compliance/settings.json"));
  assert.throws(() => sync(f.options, { expected: f.expected, publish: true, install, codex(home, args) {
    return args[0] === "marketplace" ? { installedRoot: args[2] } :
      { pluginId: "dely@dely", installedPath: f.source };
  } }), /Wrong installed catalog receipt/);
  assert.ok(fs.readFileSync(path.join(f.homes[0], "dely-compliance/settings.json")).equals(before));
});
