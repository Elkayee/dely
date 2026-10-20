#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { parseArgs } = require("node:util");

const PLUGIN = "dely@dely";
const LEGACY = ["dely@dely-orca-poc", "dely@dely-orca-agy-global"];
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const canonical = (file) => fs.realpathSync(file);
const normalize = (file) => process.platform === "win32" ? canonical(file).toLowerCase() : canonical(file);
const equalPath = (a, b) => normalize(a) === normalize(b);
const digest = (root, file) => sha(fs.readFileSync(path.join(root, file)));
function packagedBytes(root, file, authoring = false) {
  const bytes = fs.readFileSync(path.join(root, file));
  // Match a Git export for shell text checked out with Windows CRLF.
  return authoring && (file.endsWith(".sh") || file === "skills/delivery/scripts/dely") ?
    Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n")) : bytes;
}
const PROFILE = ["config.toml", "hooks.json", "dely-compliance/settings.json",
  "dely-compliance/codex-compliance.js", "dely-compliance/jev-advisor.js",
  "dely-compliance/guide.md", "dely-compliance/task-risk-policy.md", "dely-compliance/jev-skill-advice.md",
  "dely-compliance/current-source.json"];

function members(root, directory) {
  const result = [];
  for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, item.name);
    if (file === "docs/_plans" || ["node_modules", "__pycache__", "artifacts", ".git", "venv", "target"].includes(item.name) || item.name.startsWith(".tmp")) continue;
    if (/^\.env(?:\.|$)/i.test(item.name)) throw Error("Private environment file in package tree: " + file);
    if (item.isSymbolicLink()) throw Error("Bundle links require inspection: " + file);
    if (item.isDirectory()) result.push(...members(root, file));
    else if (item.isFile()) result.push(file);
    else throw Error("Unsupported bundle member: " + file);
  }
  return result;
}

function bundle(root, authoring = true) {
  const roots = ["skills", "extensions", "scripts", "docs", "assets", "probe", ".github",
    ".claude-plugin", ".codex-plugin", ".cursor-plugin"];
  const files = [...roots.filter((name) => fs.existsSync(path.join(root, name))).flatMap((name) => members(root, name)),
    ...["harnesses.json", "package.json", "plugin.json", "README.md", "AGENTS.md", "LICENSE",
      "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md"].filter((name) => fs.existsSync(path.join(root, name)))].sort();
  const version = json(path.join(root, "package.json")).version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw Error("Invalid release version");
  for (const file of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    if (json(path.join(root, file)).version !== version) throw Error("Split plugin versions");
  }
  const hashes = Object.fromEntries(files.map((file) => [file, sha(packagedBytes(root, file, authoring))]));
  return { version, sha256: sha(JSON.stringify(hashes)), hashes };
}

function snapshot(source, home, expected) {
  const manifest = bundle(source);
  if (manifest.sha256 !== expected) throw Error("Source changed before snapshot");
  const directory = path.join(home, "dely-releases");
  if (!fs.existsSync(directory)) fs.mkdirSync(directory);
  inside(home, directory);
  const destination = path.resolve(canonical(directory), manifest.version + "-" + expected.slice(0, 16) + "-sync");
  if (path.dirname(destination) !== canonical(directory)) throw Error("Snapshot destination escapes its release root");
  if (fs.existsSync(destination)) {
    inside(home, destination);
    if (bundle(destination, false).sha256 !== expected) throw Error("Existing snapshot differs; preserved for inspection");
    return destination;
  }
  const stage = fs.mkdtempSync(path.join(directory, "staging-"));
  inside(home, stage);
  for (const [relative, hash] of Object.entries(manifest.hashes)) {
    const bytes = packagedBytes(source, relative, true), to = path.join(stage, relative);
    if (sha(bytes) !== hash) throw Error("Source changed while snapshotting; retained " + stage);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, bytes);
  }
  if (bundle(stage, false).sha256 !== expected || bundle(source).sha256 !== expected) throw Error("Snapshot hash mismatch; retained " + stage);
  fs.renameSync(stage, destination);
  return destination;
}

function oldPlugins(text, disable = false) {
  const enabled = [];
  for (const id of LEGACY) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const section = new RegExp('(^\\[plugins\\."' + escaped + '"\\][^\\r\\n]*\\r?\\n)([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))', "m");
    text = text.replace(section, (whole, heading, body) => {
      if (/^enabled\s*=\s*true\b/m.test(body)) enabled.push(id);
      return disable ? heading + body.replace(/^(enabled\s*=\s*)true\b/m, "$1false") : whole;
    });
  }
  return { enabled, text };
}

function cache(home, version) {
  return path.join(home, "plugins/cache/dely/dely", version);
}

function pluginEnabled(text, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = new RegExp('^\\[plugins\\."' + escaped + '"\\][^\\r\\n]*\\r?\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))', "m");
  return /^enabled\s*=\s*true\b/m.test(section.exec(text)?.[1] || "");
}

function plan({ source, catalog, homes }) {
  source = canonical(source);
  const expected = bundle(source);
  const targets = [...new Set(homes.map(canonical))].map((home) => {
    home = canonical(home);
    const target = path.resolve(catalog || cache(home, expected.version));
    const installed = fs.existsSync(target) ? bundle(target, false) : null;
    const different = installed ? [...new Set([...Object.keys(expected.hashes), ...Object.keys(installed.hashes)])]
      .filter((file) => expected.hashes[file] !== installed.hashes[file]) : ["CATALOG_NOT_INSTALLED"];
    const settings = json(path.join(home, "dely-compliance/settings.json"));
    const bindings = { delivery: "skills/delivery/SKILL.md", routing: "skills/delivery/scripts/task-routing.js",
      dely: "skills/delivery/scripts/dely.js", advisor_source: "scripts/jev_agent.js" };
    const drift = Object.entries(bindings).filter(([key, relative]) =>
      !settings[key] || !fs.existsSync(settings[key]) || !fs.existsSync(path.join(target, relative)) ||
      !equalPath(settings[key], path.join(target, relative)))
      .map(([key]) => key);
    const config = path.join(home, "config.toml");
    const configText = fs.existsSync(config) ? fs.readFileSync(config, "utf8") : "";
    const legacy_enabled = oldPlugins(configText).enabled;
    if (!pluginEnabled(configText, PLUGIN)) drift.push("catalog_registration");
    const software = { "scripts/codex-compliance.js": "dely-compliance/codex-compliance.js",
      "docs/codex-compliance.md": "dely-compliance/guide.md", "docs/task-risk-policy.md": "dely-compliance/task-risk-policy.md",
      "docs/jev-skill-advice.md": "dely-compliance/jev-skill-advice.md" };
    for (const [from, to] of Object.entries(software)) {
      if (!fs.existsSync(path.join(home, to)) || digest(home, to) !== expected.hashes[from]) drift.push(to);
    }
    const frozenAdvisor = path.join(home, "dely-compliance/jev-advisor.js");
    const advisorText = fs.readFileSync(path.join(source, "scripts/jev_agent.js"), "utf8")
      .replace('const ROOT = path.resolve(__dirname, "..");', "const ROOT = " + JSON.stringify(settings.credential_root) + ";\n");
    if (!fs.existsSync(frozenAdvisor) || sha(fs.readFileSync(frozenAdvisor)) !== sha(advisorText)) drift.push("frozen_advisor");
    for (const [file, hash] of Object.entries(settings.dependencies || {})) {
      if (!fs.existsSync(file) || sha(fs.readFileSync(file)) !== hash) drift.push("dependency:" + path.basename(file));
    }
    return { home, catalog: target, different, drift, legacy_enabled, credential_root: settings.credential_root };
  });
  return { source, plugin: PLUGIN, version: expected.version, bundle_sha256: expected.sha256,
    package_files: Object.keys(expected.hashes).length,
    homes: targets, status: targets.some((target) => target.different.length) ? "SOURCE_NOT_PUBLISHED" :
      targets.some((target) => target.drift.length || target.legacy_enabled.length) ? "BINDING_DRIFT" : "COHERENT" };
}

function windowsCodexEntry(searchPath = process.env.PATH || "") {
  for (const directory of searchPath.split(path.delimiter)) {
    const shim = path.join(directory, "codex.cmd");
    if (!fs.existsSync(shim)) continue;
    const relative = "node_modules\\@openai\\codex\\bin\\codex.js";
    const entry = path.join(directory, ...relative.split("\\"));
    if (fs.readFileSync(shim, "utf8").includes(relative) && fs.existsSync(entry)) return canonical(entry);
  }
  throw Error("Native Codex npm entrypoint not found; no launcher was executed");
}

function runCodex(home, args) {
  // Plugin commands only; never launch an agent or acquire hook trust.
  const argv = ["plugin", ...args, "--json"];
  const options = { env: { ...process.env, CODEX_HOME: home }, encoding: "utf8", timeout: 60000 };
  const output = process.platform === "win32" ? execFileSync(process.execPath, [windowsCodexEntry(), ...argv], options) :
    execFileSync("codex", argv, options);
  const receipt = JSON.parse(output);
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw Error("Invalid native plugin CLI receipt");
  return receipt;
}

function inside(homes, target) {
  const selected = Array.isArray(homes) ? homes : [homes];
  if (!selected.some((home) => {
    const relative = path.relative(canonical(home), canonical(target));
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  })) throw Error("Target escapes its selected homes");
}

function sync(options, { publish = false, expected, codex = runCodex, install } = {}) {
  if (options.catalog) throw Error("apply/update uses the canonical plugin cache, not a custom catalog");
  const initial = plan(options);
  if (!expected || initial.bundle_sha256 !== expected) throw Error("Supply the reviewed --expected-sha from plan; source changed or approval missing");
  if (!publish && initial.homes.some((target) => target.different.length)) throw Error("Source is not published; update the catalog first");
  const sourceManifest = json(path.join(initial.source, ".claude-plugin/marketplace.json"));
  const selected = sourceManifest.plugins?.filter((item) => item.name === "dely");
  if (sourceManifest.name !== "dely" || selected?.length !== 1 || ![".", "./"].includes(selected[0].source)) {
    throw Error("Expected the authoritative local dely marketplace");
  }
  const locks = [];
  try {
    for (const target of initial.homes) {
      inside(target.home, path.join(target.home, "dely-compliance"));
      const file = path.join(target.home, "dely-compliance/sync.lock");
      const token = crypto.randomUUID();
      fs.writeFileSync(file, token, { flag: "wx" });
      locks.push({ file, token });
    }
    const originals = [], backups = [];
    for (const target of initial.homes) {
      if (fs.existsSync(target.catalog)) inside(initial.homes.map((item) => item.home), target.catalog);
      // Refuse a same-version overwrite: active plans may still pin these bytes.
      if (publish && fs.existsSync(target.catalog) && target.different.length) {
        throw Error("Runtime bytes changed under an existing version; advance the release version before update");
      }
      inside(target.home, path.join(target.home, "dely-compliance"));
      const backupRoot = path.join(target.home, "dely-compliance/backups");
      if (!fs.existsSync(backupRoot)) fs.mkdirSync(backupRoot);
      inside(target.home, backupRoot);
      const destination = path.join(backupRoot, "sync-" + crypto.randomUUID());
      fs.mkdirSync(destination);
      inside(target.home, destination);
      backups.push(destination);
      for (const relative of PROFILE) {
        const file = path.join(target.home, relative);
        const bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
        originals.push({ file, bytes });
        if (bytes !== null) {
          const backup = path.join(destination, relative);
          fs.mkdirSync(path.dirname(backup), { recursive: true });
          fs.writeFileSync(backup, bytes, { flag: "wx" });
        }
      }
    }
    try {
      const published = publish ? snapshot(initial.source, initial.homes[0].home, expected) : null;
      const proofs = [];
      install ||= require(path.join(initial.source, "scripts/codex-compliance.js")).install;
      for (const target of initial.homes) {
        const hooks = fs.readFileSync(path.join(target.home, "hooks.json"));
        if (publish) {
          const registration = codex(target.home, ["marketplace", "add", published]);
          if (!registration?.installedRoot || !equalPath(registration.installedRoot, published)) throw Error("Wrong marketplace source receipt");
          const installed = codex(target.home, ["add", PLUGIN]);
          if (installed?.pluginId !== PLUGIN || !installed.installedPath || !equalPath(installed.installedPath, target.catalog)) {
            throw Error("Wrong installed catalog receipt");
          }
        }
        inside(initial.homes.map((item) => item.home), target.catalog);
        if (bundle(target.catalog, false).sha256 !== expected || bundle(initial.source).sha256 !== expected) {
          throw Error("Source or published catalog changed during synchronization");
        }
        const config = path.join(target.home, "config.toml");
        if (fs.existsSync(config)) fs.writeFileSync(config, oldPlugins(fs.readFileSync(config, "utf8"), true).text);
        install({ routing: path.join(target.catalog, "skills/delivery/scripts/task-routing.js"),
          advisor: path.join(target.catalog, "scripts/jev_agent.js"), "preserve-hooks": true }, target.home);
        if (!fs.readFileSync(path.join(target.home, "hooks.json")).equals(hooks)) throw Error("Native hooks changed");
        const settings = json(path.join(target.home, "dely-compliance/settings.json"));
        if (settings.credential_root !== target.credential_root) throw Error("Credential search root changed");
        proofs.push({ home: target.home, hooks_sha256: sha(hooks), hooks_preserved: true,
          disabled_legacy_plugins: target.legacy_enabled });
        fs.writeFileSync(path.join(target.home, "dely-compliance/current-source.json"), JSON.stringify({
          source: initial.source, snapshot: published, catalog: canonical(target.catalog), bundle_sha256: expected,
        }, null, 2) + "\n");
      }
      const result = plan(options);
      if (result.status !== "COHERENT") throw Error("Postflight bindings remain inconsistent");
      const receipt = { ...result, snapshot: published, checked_at: new Date().toISOString(), backups, proofs,
        cleanup: "Legacy plugin entries disabled; snapshots, caches and history retained",
        next_session: "Open a fresh native session so its supplied skill roster loads the selected plugin" };
      for (const directory of backups) fs.writeFileSync(path.join(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
      return receipt;
    } catch (error) {
      const failed = [];
      for (const { file, bytes } of originals.reverse()) {
        try {
          if (bytes === null) { if (fs.existsSync(file)) fs.unlinkSync(file); }
          else fs.writeFileSync(file, bytes);
        } catch (_) { failed.push(file); }
      }
      throw Error("Sync failed; " + (failed.length ? "ROLLBACK_INCOMPLETE: " + failed.join(", ") : "profile files restored") +
        ". Retained backups: " + backups.join(", ") + ". " + error.message);
    }
  } finally {
    for (const { file, token } of locks.reverse()) {
      if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === token) fs.unlinkSync(file);
    }
  }
}

function defaults(values) {
  const primary = path.join(os.homedir(), ".codex");
  const pointer = path.join(primary, "dely-compliance/current-source.json");
  const source = path.resolve(values.source || (fs.existsSync(pointer) ? json(pointer).source : path.join(__dirname, "..")));
  const homes = values.home || [primary,
    path.join(process.env.APPDATA || path.join(os.homedir(), "AppData/Roaming"), "orca/codex-runtime-home/home")]
    .filter((home) => fs.existsSync(path.join(home, "dely-compliance/settings.json")));
  if (!homes.length) throw Error("No existing compliance installation; use initial setup first");
  return { source, homes, ...(values.catalog ? { catalog: path.resolve(values.catalog) } : {}) };
}

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    source: { type: "string" }, catalog: { type: "string" }, home: { type: "string", multiple: true },
    "expected-sha": { type: "string" },
  } });
  const command = positionals[0] || "plan";
  if (positionals.length > 1 || !["plan", "check", "apply", "update"].includes(command)) {
    throw Error("Usage: sync-dely.js plan|check|apply|update [--source PATH] [--catalog PATH] [--home PATH] [--expected-sha SHA256]");
  }
  const options = defaults(values);
  const result = ["apply", "update"].includes(command) ? sync(options,
    { publish: command === "update", expected: values["expected-sha"] }) : plan(options);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (command === "check" && result.status !== "COHERENT") process.exitCode = 1;
}

module.exports = { bundle, plan, defaults, sync, oldPlugins, packagedBytes, windowsCodexEntry };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
