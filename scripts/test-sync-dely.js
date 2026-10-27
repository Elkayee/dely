"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { bundle, plan, defaults, sync, synchronize, oldPlugins, windowsCodexEntry } = require("./sync-dely.js");
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
  put(source, ".claude-plugin/marketplace.json", { name: "dely", owner: { name: "fixture" }, plugins: [{ name: "dely", source: "./" }] });
  for (const file of ["harnesses.json", "plugin.json", ".cursor-plugin/plugin.json"]) put(source, file, {});
  for (const file of ["skills/delivery/SKILL.md", "skills/delivery/scripts/task-routing.js",
    "skills/delivery/scripts/dely.js", "skills/delivery/scripts/usage.js", "extensions/pin.ts"]) put(source, file, "fixture");
  put(source, "skills/delivery/scripts/dispatch-receipts.js", fs.readFileSync(path.join(__dirname, "../skills/delivery/scripts/dispatch-receipts.js")));
  put(source, "scripts/jev_agent.js", 'const ROOT = path.resolve(__dirname, "..");');
  put(source, "scripts/codex-compliance.js", fs.readFileSync(path.join(__dirname, "codex-compliance.js")));
  put(source, "scripts/jev-workflow.js", fs.readFileSync(path.join(__dirname, "jev-workflow.js")));
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

function defaultsFixture(t) {
  const f = fixture(t, 2);
  t.mock.method(os, "homedir", () => f.root);
  const appdata = process.env.APPDATA;
  process.env.APPDATA = path.join(f.root, "roaming");
  t.after(() => {
    if (appdata === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = appdata;
  });
  const registration = ".codex/dely-compliance/current-source.json";
  put(f.root, registration, { source: f.source, homes: f.homes });
  return { ...f, registration };
}

test("default sync retains the registered homes instead of rediscovering a smaller set", (t) => {
  const f = defaultsFixture(t);
  assert.deepEqual(defaults({}).homes, f.homes);
  assert.equal(defaults({}).source, f.source);
});

test("default sync refuses a registered home with missing settings before profile changes", (t) => {
  const f = defaultsFixture(t);
  const profile = path.join(f.homes[0], "dely-compliance/settings.json");
  const before = fs.readFileSync(profile), registration = fs.readFileSync(path.join(f.root, f.registration));
  fs.unlinkSync(path.join(f.homes[1], "dely-compliance/settings.json"));
  assert.throws(() => synchronize(defaults({}), { install }), /registered.*settings/i);
  assert.deepEqual(fs.readFileSync(profile), before);
  assert.deepEqual(fs.readFileSync(path.join(f.root, f.registration)), registration);
  assert.equal(fs.existsSync(path.join(f.homes[0], "dely-compliance/backups")), false);
  assert.deepEqual(defaults({ home: [f.homes[0]] }).homes, [f.homes[0]]);
});

test("default sync rejects malformed registered homes and retains explicit and legacy selection", (t) => {
  const f = defaultsFixture(t);
  for (const homes of [null, [], "home", [null], [""], ["relative/home"]]) {
    put(f.root, f.registration, { source: f.source, homes });
    assert.throws(() => defaults({}), /registered.*homes/i);
    assert.deepEqual(defaults({ home: [f.homes[0]] }).homes, [f.homes[0]]);
  }
  put(f.root, f.registration, { source: f.source });
  const primary = path.join(f.root, ".codex");
  put(primary, "dely-compliance/settings.json", {});
  assert.deepEqual(defaults({}).homes, [primary]);
  fs.unlinkSync(path.join(f.root, f.registration));
  assert.deepEqual(defaults({ source: f.source }).homes, [primary]);
});

test("plan detects canonical path drift without writing or treating equal bytes as equal paths", (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.homes[0], "dely-compliance/settings.json"));
  const result = plan(f.options);
  assert.equal(result.status, "BINDING_DRIFT");
  assert.deepEqual(result.homes[0].different, []);
  assert.deepEqual(result.homes[0].drift.slice(0, 5), ["delivery", "routing", "dely", "receipts", "advisor_source"]);
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
  assert.equal(sync(f.options, { expected: f.expected, install }).status, "COHERENT");
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
      if (args[1] === "list") return { marketplaces: [] };
      return args[0] === "marketplace" ? { installedRoot: args[2] } :
        { pluginId: "dely@dely", installedPath: path.join(home, "plugins/cache/dely/dely/1.0.0") };
    } });
  assert.equal(result.status, "COHERENT");
  assert.deepEqual(calls.map((call) => call.args.slice(0, 2)), [["marketplace", "list"], ["marketplace", "add"], ["add", "dely@dely"]]);
  const published = calls[1].args[2];
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
    if (args[1] === "list") return { marketplaces: [] };
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
    if (args[1] === "list") return { marketplaces: [] };
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
    if (args[1] === "list") return { marketplaces: [] };
    return args[0] === "marketplace" ? { installedRoot: args[2] } :
      { pluginId: "dely@dely", installedPath: f.source };
  } }), /Wrong installed catalog receipt/);
  assert.ok(fs.readFileSync(path.join(f.homes[0], "dely-compliance/settings.json")).equals(before));
});

for (const [relative, type, existing] of [["assets", "junction", true], ["README.md", "file", true], ["README.md", "file", false]]) {
  test("bundle rejects a " + (existing ? "linked" : "dangling") + " top-level " + relative, (t) => {
    const f = fixture(t);
    const outside = path.join(f.root, "outside");
    if (existing) put(outside, "sentinel.txt", "outside package");
    fs.symlinkSync(type === "junction" ? outside : path.join(outside, "sentinel.txt"),
      path.join(f.source, relative), type);
    assert.throws(() => bundle(f.source), /Bundle links require inspection/);
  });
}

for (const existing of [true, false]) {
  test("sync rejects an " + (existing ? "existing" : "absent") + " profile destination outside selected homes", (t) => {
    const f = fixture(t);
    const outside = path.join(f.root, "outside.json");
    if (existing) fs.writeFileSync(outside, "outside sentinel");
    fs.symlinkSync(outside, path.join(f.homes[0], "dely-compliance/current-source.json"), "file");
    let calls = 0;
    assert.throws(() => sync(f.options, { expected: f.expected, install() { calls++; } }),
      /Target escapes|dangling|ENOENT/);
    assert.equal(calls, 0);
    assert.equal(fs.existsSync(path.join(f.homes[0], "dely-compliance/backups")), false);
    if (existing) assert.equal(fs.readFileSync(outside, "utf8"), "outside sentinel");
    else assert.equal(fs.existsSync(outside), false);
  });
}

test("an absent catalog below an escaped parent is rejected before the publisher runs", (t) => {
  const f = fixture(t);
  const plugins = path.join(f.homes[0], "plugins");
  assert.ok(path.resolve(plugins).startsWith(path.resolve(f.root) + path.sep));
  fs.rmSync(plugins, { recursive: true });
  const outside = path.join(f.root, "outside-plugins");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, plugins, "junction");
  let calls = 0;
  assert.throws(() => sync(f.options, { expected: f.expected, publish: true,
    codex() { calls++; throw Error("publisher must not run"); } }), /Target escapes/);
  assert.equal(calls, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(path.join(f.homes[0], "dely-compliance/backups")), false);
});

test("rollback refuses a replaced profile link without writing outside selected homes", (t) => {
  const f = fixture(t);
  const pointer = path.join(f.homes[0], "dely-compliance/current-source.json");
  fs.writeFileSync(pointer, "original pointer");
  const outside = path.join(f.root, "outside.json");
  fs.writeFileSync(outside, "outside sentinel");
  assert.throws(() => sync(f.options, { expected: f.expected, install() {
    fs.unlinkSync(pointer);
    fs.symlinkSync(outside, pointer, "file");
    throw Error("injected destination change");
  } }), /ROLLBACK_INCOMPLETE.*injected destination change/);
  assert.equal(fs.readFileSync(outside, "utf8"), "outside sentinel");
});

test("publisher destination changes are rejected before the installer runs", (t) => {
  const f = fixture(t);
  const outside = path.join(f.root, "outside.json");
  fs.writeFileSync(outside, "outside sentinel");
  let installs = 0;
  assert.throws(() => sync(f.options, { expected: f.expected, publish: true, install() { installs++; },
    codex(home, args) {
      if (args[1] === "list") return { marketplaces: [] };
      if (args[0] === "marketplace") return { installedRoot: args[2] };
      fs.symlinkSync(outside, path.join(home, "dely-compliance/current-source.json"), "file");
      return { pluginId: "dely@dely", installedPath: path.join(home, "plugins/cache/dely/dely/1.0.0") };
    } }), /ROLLBACK_INCOMPLETE.*Target escapes/);
  assert.equal(installs, 0);
  assert.equal(fs.readFileSync(outside, "utf8"), "outside sentinel");
});

for (const changedBy of [1, 2]) {
  test("all original hook bytes survive changes introduced by installer " + changedBy, (t) => {
    const f = fixture(t, 2);
    const hooks = f.homes.map((home) => fs.readFileSync(path.join(home, "hooks.json")));
    let calls = 0;
    assert.throws(() => sync(f.options, { expected: f.expected, install(options, home) {
      install(options, home);
      if (++calls === changedBy) fs.appendFileSync(path.join(f.homes[changedBy === 1 ? 1 : 0], "hooks.json"), "\n");
    } }), /Native hooks changed/);
    f.homes.forEach((home, index) => assert.deepEqual(fs.readFileSync(path.join(home, "hooks.json")), hooks[index]));
  });
}

test("automatic sync publishes missing catalogs and completes both homes without a supplied hash", (t) => {
  const f = fixture(t, 2);
  for (const home of f.homes) {
    const catalog = path.join(home, "plugins/cache/dely/dely/1.0.0");
    assert.ok(path.resolve(catalog).startsWith(path.resolve(f.root) + path.sep));
    fs.rmSync(catalog, { recursive: true });
  }
  const published = new Map();
  const result = synchronize(f.options, { install, codex(home, args) {
    if (args[1] === "list") return { marketplaces: [] };
    if (args[0] === "marketplace") {
      published.set(home, args[2]);
      return { installedRoot: args[2] };
    }
    const catalog = path.join(home, "plugins/cache/dely/dely/1.0.0");
    fs.cpSync(published.get(home), catalog, { recursive: true });
    return { pluginId: "dely@dely", installedPath: catalog };
  } });
  assert.equal(published.size, 2);
  assert.equal(result.status, "COHERENT");
  assert.equal(result.bundle_sha256, f.expected);
  assert.equal(plan(f.options).status, "COHERENT");
});

test("automatic sync repairs bindings without publishing and does nothing on a coherent rerun", (t) => {
  const f = fixture(t);
  const reject = () => { throw Error("unexpected publisher or installer call"); };
  assert.equal(synchronize(f.options, { install, codex: reject }).status, "COHERENT");
  const backupRoot = path.join(f.homes[0], "dely-compliance/backups");
  const backups = fs.readdirSync(backupRoot);
  const pointer = path.join(f.homes[0], "dely-compliance/current-source.json");
  const before = fs.readFileSync(pointer);
  assert.equal(synchronize(f.options, { install: reject, codex: reject }).status, "COHERENT");
  assert.deepEqual(fs.readdirSync(backupRoot), backups);
  assert.deepEqual(fs.readFileSync(pointer), before);
});

test("automatic sync retains hash, immutable-version and canonical-catalog checks", (t) => {
  const f = fixture(t);
  assert.throws(() => synchronize(f.options, { expected: "0".repeat(64) }), /expected-sha/);
  assert.throws(() => synchronize({ ...f.options, catalog: f.source }), /not a custom catalog/);
  put(f.source, "extensions/pin.ts", "changed runtime");
  assert.throws(() => synchronize(f.options, { install }), /advance the release version/);
  assert.equal(fs.existsSync(path.join(f.homes[0], "dely-compliance/backups")), false);
});

test("automatic sync repairs source registration instead of accepting false coherence", (t) => {
  const f = fixture(t);
  synchronize(f.options, { install });
  const pointer = path.join(f.homes[0], "dely-compliance/current-source.json");
  for (const changed of [{ source: f.root }, { bundle_sha256: "stale" }]) {
    const registration = JSON.parse(fs.readFileSync(pointer, "utf8"));
    fs.writeFileSync(pointer, JSON.stringify({ ...registration, ...changed }));
    assert.ok(plan(f.options).homes[0].drift.includes("source_registration"));
    assert.equal(synchronize(f.options, { install }).status, "COHERENT");
    const restored = JSON.parse(fs.readFileSync(pointer, "utf8"));
    assert.equal(restored.source, fs.realpathSync(f.source));
    assert.equal(restored.bundle_sha256, f.expected);
  }
});

for (const verb of [[], ["sync"]]) {
  test("the " + (verb.length ? "explicit sync" : "default") + " CLI completes synchronization", (t) => {
    const f = fixture(t);
    const result = spawnSync(process.execPath, [path.join(__dirname, "sync-dely.js"), ...verb,
      "--source", f.source, "--home", f.homes[0]], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "COHERENT");
    assert.equal(plan(f.options).status, "COHERENT");
  });
}

test("native marketplace replacement keeps old caches and completes automatic sync", { skip: process.platform !== "win32" }, (t) => {
  const f = fixture(t);
  for (const file of ["package.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    put(f.source, file, { name: "dely", version: "1.0.0" });
  }
  const home = f.homes[0], entry = windowsCodexEntry();
  const previous = path.join(f.root, "previous-source");
  fs.cpSync(f.source, previous, { recursive: true });
  for (const file of ["package.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    put(previous, file, { name: "dely", version: "0.9.0" });
  }
  const catalog = path.join(home, "plugins/cache/dely/dely/1.0.0");
  assert.ok(path.resolve(catalog).startsWith(path.resolve(f.root) + path.sep));
  fs.rmSync(catalog, { recursive: true });
  const retained = "plugins/cache/dely/dely/0.9.0/skills/delivery/sentinel.txt";
  const native = (args) => {
    const result = spawnSync(process.execPath, [entry, "plugin", ...args, "--json"],
      { env: { ...process.env, CODEX_HOME: home }, encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  native(["marketplace", "add", previous]);
  native(["add", "dely@dely"]);
  put(home, retained, "keep old runtime");
  const previousBundle = bundle(path.join(home, "plugins/cache/dely/dely/0.9.0"), false);
  const result = synchronize(f.options, { install, codex(_home, args) { return native(args); } });
  assert.equal(result.status, "COHERENT");
  assert.equal(fs.readFileSync(path.join(home, retained), "utf8"), "keep old runtime");
  assert.deepEqual(bundle(path.join(home, "plugins/cache/dely/dely/0.9.0"), false), previousBundle);
  assert.ok(fs.existsSync(previous));
  assert.equal(plan(f.options).status, "COHERENT");
});

test("a wrong marketplace removal identity stops publication and restores the profile", (t) => {
  const f = fixture(t);
  const config = path.join(f.homes[0], "config.toml");
  const before = fs.readFileSync(config);
  const calls = [];
  assert.throws(() => sync(f.options, { expected: f.expected, publish: true, install, codex(_home, args) {
    calls.push(args);
    if (args[1] === "list") return { marketplaces: [{ name: "dely", root: f.source }] };
    fs.writeFileSync(config, "changed registration");
    return { marketplaceName: "other", installedRoot: null };
  } }), /Wrong removed marketplace receipt/);
  assert.deepEqual(calls, [["marketplace", "list"], ["marketplace", "remove", "dely"]]);
  assert.deepEqual(fs.readFileSync(config), before);
});

test("sync pins its installed updater and records every selected home for completion checks", (t) => {
  const f = fixture(t, 2);
  assert.equal(sync(f.options, { expected: f.expected, install }).status, "COHERENT");
  for (const home of f.homes) {
    const settings = JSON.parse(fs.readFileSync(path.join(home, "dely-compliance/settings.json")));
    const registration = JSON.parse(fs.readFileSync(path.join(home, "dely-compliance/current-source.json")));
    assert.equal(settings.sync_source, fs.realpathSync(f.source));
    assert.deepEqual(settings.sync_homes, f.homes.map((item) => fs.realpathSync(item)));
    assert.deepEqual(registration.homes, settings.sync_homes);
    assert.equal(settings.updater, fs.realpathSync(path.join(home, "plugins/cache/dely/dely/1.0.0/scripts/sync-dely.js")));
    assert.ok(settings.dependencies[settings.updater]);
  }
  const file = path.join(f.homes[0], "dely-compliance/settings.json");
  const settings = JSON.parse(fs.readFileSync(file));
  delete settings.dependencies[settings.updater];
  fs.writeFileSync(file, JSON.stringify(settings));
  assert.equal(plan(f.options).status, "BINDING_DRIFT");
  assert.ok(plan(f.options).homes[0].drift.includes("updater_pin"));
  assert.equal(synchronize(f.options, { install }).status, "COHERENT");
});

for (const phase of ["remove", "add"]) {
  test("cache restoration survives a failed native " + phase + " with shared homes", (t) => {
    const f = fixture(t, 2), home = f.homes[0];
    const shared = path.join(f.homes[1], "plugins");
    assert.ok(path.resolve(shared).startsWith(path.resolve(f.root) + path.sep));
    fs.rmSync(shared, { recursive: true });
    fs.symlinkSync(path.join(home, "plugins"), shared, "junction");
    const root = path.join(home, "plugins/cache/dely/dely");
    put(root, "0.9.0/skill.txt", "pinned old skill");
    const previous = bundle(path.join(root, "1.0.0"), false);
    const hooks = f.homes.map((item) => fs.readFileSync(path.join(item, "hooks.json")));
    assert.throws(() => sync(f.options, { expected: f.expected, publish: true, install, codex(_home, args) {
      if (args[1] === "list") return { marketplaces: [{ name: "dely", root: f.source }] };
      if ((phase === "remove" && args[1] === "remove") || (phase === "add" && args[0] === "add")) {
        assert.ok(path.resolve(root).startsWith(path.resolve(f.root) + path.sep));
        fs.rmSync(root, { recursive: true });
        throw Error("injected CLI " + phase);
      }
      return { marketplaceName: "dely", installedRoot: args[1] === "remove" ? null : args[2] };
    } }), new RegExp("profile files restored.*injected CLI " + phase));
    assert.equal(fs.readFileSync(path.join(root, "0.9.0/skill.txt"), "utf8"), "pinned old skill");
    assert.deepEqual(bundle(path.join(root, "1.0.0"), false), previous);
    for (const [index, item] of f.homes.entries()) {
      assert.deepEqual(fs.readFileSync(path.join(item, "hooks.json")), hooks[index]);
      assert.equal(fs.existsSync(path.join(item, "dely-compliance/sync.lock")), false);
    }
  });
}

test("cache restoration reports conflicting bytes without overwriting them and restores other files", (t) => {
  const f = fixture(t), home = f.homes[0];
  const root = path.join(home, "plugins/cache/dely/dely");
  put(root, "0.9.0/changed.txt", "original");
  put(root, "0.9.0/missing.txt", "retain me");
  assert.throws(() => sync(f.options, { expected: f.expected, publish: true, install, codex(_home, args) {
    if (args[1] === "list") return { marketplaces: [] };
    if (args[0] === "marketplace") return { installedRoot: args[2] };
    fs.writeFileSync(path.join(root, "0.9.0/changed.txt"), "concurrent bytes");
    fs.unlinkSync(path.join(root, "0.9.0/missing.txt"));
    return { pluginId: "dely@dely", installedPath: path.join(root, "1.0.0") };
  } }), /CACHE_RESTORE_INCOMPLETE/);
  assert.equal(fs.readFileSync(path.join(root, "0.9.0/changed.txt"), "utf8"), "concurrent bytes");
  assert.equal(fs.readFileSync(path.join(root, "0.9.0/missing.txt"), "utf8"), "retain me");
});

test("cache restoration rejects a replaced root without writing outside selected homes", (t) => {
  const f = fixture(t), home = f.homes[0];
  const root = path.join(home, "plugins/cache/dely/dely"), outside = path.join(f.root, "outside");
  fs.mkdirSync(outside);
  assert.throws(() => sync(f.options, { expected: f.expected, publish: true, install, codex(_home, args) {
    if (args[1] === "list") return { marketplaces: [] };
    if (args[0] === "marketplace") return { installedRoot: args[2] };
    assert.ok(path.resolve(root).startsWith(path.resolve(f.root) + path.sep));
    fs.rmSync(root, { recursive: true });
    fs.symlinkSync(outside, root, "junction");
    throw Error("replaced cache root");
  } }), /Target escapes its selected homes/);
  assert.deepEqual(fs.readdirSync(outside), []);
  const backups = path.join(home, "dely-compliance/backups");
  const retained = path.join(backups, fs.readdirSync(backups)[0], "plugin-cache/1.0.0");
  assert.equal(bundle(retained, false).sha256, f.expected);
});
