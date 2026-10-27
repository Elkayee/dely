"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parseArgs } = require("node:util");

function definitions(script, home, provider, events) {
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const command = [quote(process.execPath.replaceAll("\\", "/")), quote(script.replaceAll("\\", "/")),
    "--provider", provider, "--home", quote(home.replaceAll("\\", "/"))].join(" ");
  return Object.fromEntries(events.map(event => {
    let nativeCommand = command + " --event " + event;
    if (process.platform === "win32") {
      const wrapper = path.join(path.dirname(script), "jev-" + provider + "-" + event + ".cmd");
      const node = process.execPath.replaceAll("%", "%%");
      fs.writeFileSync(wrapper, '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"' + node + '" "%~dp0jev-workflow.js" --provider ' + provider + ' --home "%~dp0.." --event ' + event + '\r\nexit /b %errorlevel%\r\n');
      if (/^[A-Za-z0-9_.:\\~-]+$/.test(wrapper)) nativeCommand = wrapper.replaceAll("\\", "/");
      else {
        const literal = value => "'" + value.replaceAll("'", "''") + "'";
        const launch = "& " + literal(process.execPath) + " " + literal(script) + " --provider " + provider + " --home " + literal(home) + " --event " + event;
        nativeCommand = "powershell.exe -NoProfile -NonInteractive -EncodedCommand " + Buffer.from(launch, "utf16le").toString("base64");
      }
    }
    return [event, [{ hooks: [{ type: "command", command: nativeCommand, timeout: 15 }] }]];
  }));
}

function writeConfig(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify(value, null, 2) + "\n";
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === bytes) return;
  if (fs.existsSync(file)) {
    const backup = file + ".jev-before-" + Date.now();
    fs.copyFileSync(file, backup);
    fs.chmodSync(backup, 0o600);
  }
  const temporary = file + ".jev-" + process.pid;
  fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function install({ home, claudeConfig, antigravityConfig }) {
  home = fs.realpathSync(home);
  const script = path.join(home, "dely-compliance", "jev-workflow.js");
  if (!fs.existsSync(script)) throw Error("Install the reviewed frozen Jev workflow before configuring providers");
  const result = [], proposals = [];
  if (claudeConfig) {
    const config = fs.existsSync(claudeConfig) ? JSON.parse(fs.readFileSync(claudeConfig, "utf8")) : {};
    if (!config || typeof config !== "object" || Array.isArray(config) ||
        (Object.hasOwn(config, "hooks") && (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)))) throw Error("Invalid Claude hooks; preserved without changes");
    config.hooks ||= {};
    const desired = definitions(script, home, "claude", ["UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"]);
    for (const [event, groups] of Object.entries(desired)) {
      const existing = config.hooks[event] || [];
      if (!Array.isArray(existing)) throw Error("Invalid Claude event; preserved without changes");
      config.hooks[event] = existing.map(group => ({ ...group,
        hooks: (group.hooks || []).filter(hook => hook.command !== groups[0].hooks[0].command)
      })).filter(group => group.hooks.length).concat(groups);
    }
    proposals.push({ file: claudeConfig, config });
    result.push({ provider: "claude", config: claudeConfig, status: "INSTALLED" });
  }
  if (antigravityConfig) {
    const config = fs.existsSync(antigravityConfig) ? JSON.parse(fs.readFileSync(antigravityConfig, "utf8")) : {};
    if (!config || typeof config !== "object" || Array.isArray(config)) throw Error("Invalid Antigravity hooks; preserved without changes");
    const desired = definitions(script, home, "antigravity", ["PreInvocation", "PreToolUse", "PostToolUse", "Stop"]);
    const expected = Object.values(desired).map(groups => groups[0].hooks[0].command);
    if (config["jev-workflow"] && Object.values(config["jev-workflow"]).flatMap(groups =>
      Array.isArray(groups) ? groups.flatMap(group => Array.isArray(group.hooks) ? group.hooks : [group]) : [{}])
      .some(hook => !expected.includes(hook.command))) {
      throw Error("Foreign Antigravity workflow bundle preserved without changes");
    }
    config["jev-workflow"] = Object.fromEntries(Object.entries(desired).map(([event, groups]) => [event,
      ["PreToolUse", "PostToolUse"].includes(event) ? [{ matcher: "*", hooks: groups[0].hooks }] : groups[0].hooks]));
    proposals.push({ file: antigravityConfig, config });
    result.push({ provider: "antigravity", config: antigravityConfig, status: "INSTALLED" });
  }
  for (const proposal of proposals) {
    if (fs.existsSync(proposal.file) && fs.lstatSync(proposal.file).isSymbolicLink()) throw Error("Linked hook config preserved without changes");
  }
  for (const proposal of proposals) writeConfig(proposal.file, proposal.config);
  return result;
}

if (require.main === module) {
  const { values } = parseArgs({ options: { home: { type: "string" }, "claude-config": { type: "string" }, "antigravity-config": { type: "string" } } });
  try {
    console.log(JSON.stringify(install({ home: values.home || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
      claudeConfig: values["claude-config"], antigravityConfig: values["antigravity-config"] })));
  } catch { console.error("Jev workflow installation failed; inspect provider configuration. No native authority was granted."); process.exitCode = 1; }
}

module.exports = { install, definitions };
