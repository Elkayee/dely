param(
    [Parameter(Mandatory = $true)]
    [string]$HelperPath
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$helper = (Resolve-Path -LiteralPath $HelperPath).Path
$nodeExe = Join-Path $env:ProgramFiles "nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) { throw "Native Node executable not found: $nodeExe" }
$fixtureRoot = Join-Path $repoRoot (".tmp-dely\quota-backup-fixture-" + [guid]::NewGuid().ToString("N"))
$homeRoot = Join-Path $fixtureRoot "home"
$repo = Join-Path $fixtureRoot "repo"
$tempRoot = Join-Path $fixtureRoot "temp"
$appData = Join-Path $fixtureRoot "appdata"
$localAppData = Join-Path $fixtureRoot "localappdata"
$delyLog = Join-Path $homeRoot ".dely\log.jsonl"
$globalAgents = Join-Path $homeRoot ".codex\AGENTS.md"
$backupRow = '| `implement_backup` | Codex CLI | gpt-6-luna | max |'
$tick = [string][char]96
$primaryRow = "|" + $tick + "implement" + $tick + " | Antigravity CLI | claude-sonnet-5-5-high | default |"
$flashRow = "|" + $tick + "implement_backup" + $tick + " | Antigravity CLI | gemini-3.8-flash-high | default |"
$lunaRow = "|" + $tick + "implement_backup_2" + $tick + " | Codex CLI | gpt-6-luna | max |"
$projectReviewRow = "|" + $tick + "review" + $tick + " | Codex CLI | gpt-6-luna | default |"
$pass = 0
$fail = 0

function Assert-Case([string]$name, [bool]$condition, [string]$detail) {
    if ($condition) {
        $script:pass++
        Write-Output "PASS $name"
    } else {
        $script:fail++
        Write-Output "FAIL $name - $detail"
    }
}

function Has-FlagValue($call, [string]$flag, [string]$value) {
    for ($i = 0; $i -lt $call.args.Count - 1; $i++) {
        if ($call.args[$i] -eq $flag -and $call.args[$i + 1] -eq $value) { return $true }
    }
    return $false
}

function Invoke-Raw([string]$name, [string[]]$cliArgs) {
    $run = "quota-fixture-$name"
    $env:ORCA_FIXTURE_LOG = Join-Path $fixtureRoot "$name.calls.jsonl"
    $env:ORCA_FIXTURE_SCENARIO = $name
    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& $nodeExe $helper @cliArgs 2>&1 | ForEach-Object { $_.ToString() })
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldPreference
    }
    $calls = @()
    if (Test-Path -LiteralPath $env:ORCA_FIXTURE_LOG) {
        $calls = @(Get-Content -LiteralPath $env:ORCA_FIXTURE_LOG | ForEach-Object { $_ | ConvertFrom-Json })
    }
    $events = @()
    if (Test-Path -LiteralPath $delyLog) {
        $events = @(Get-Content -LiteralPath $delyLog | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.run -eq $run })
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join [Environment]::NewLine); Calls = $calls; Events = $events }
}

function Invoke-Scenario([string]$name, [string[]]$extra) {
    $run = "quota-fixture-$name"
    $cliArgs = @("dispatch", "--repo", $repo, "--run", $run, "--phase", "implement", "--spec-file", "spec.md") + $extra
    return Invoke-Raw $name $cliArgs
}function Has-Launch($scenario) {
    $launches = @($scenario.Calls | Where-Object {
        ($_.args[0] -eq "terminal" -and $_.args[1] -eq "create") -or
        ($_.args[0] -eq "orchestration" -and @("worker-start", "task-create", "dispatch") -contains $_.args[1])
    })
    return $launches.Count -gt 0
}

function Read-Command($call) {
    for ($i = 0; $i -lt $call.args.Count - 1; $i++) {
        if ($call.args[$i] -eq "--command") { return [string]$call.args[$i + 1] }
    }
    return ""
}

function Write-Utf8NoBom([string]$path, [string]$content) {
    [System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
}

function Set-FixturePins([string[]]$globalRows, [string[]]$projectRows) {
    Write-Utf8NoBom $globalAgents ($globalRows -join [Environment]::NewLine)
    Write-Utf8NoBom (Join-Path $repo "AGENTS.md") ($projectRows -join [Environment]::NewLine)
}
$envNames = @("USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "ORCA_CLI_COMMAND", "ORCA_FIXTURE_LOG", "ORCA_FIXTURE_SCENARIO", "ORCA_TERMINAL_HANDLE", "DELY_ACK_S", "DELY_POLL_S", "DELY_LOOP_GUARD_OVERRIDE", "NODE_OPTIONS")
$oldEnv = @{}
foreach ($name in $envNames) { $oldEnv[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }

try {
    New-Item -ItemType Directory -Path (Join-Path $homeRoot ".codex"), (Join-Path $homeRoot ".dely"), (Join-Path $repo ""), (Join-Path $appData "npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin"), (Join-Path $localAppData "agy\bin"), $tempRoot -Force | Out-Null

    $globalRows = @($primaryRow, $flashRow, $lunaRow)
    $projectRows = @($projectReviewRow)
    Set-FixturePins $globalRows $projectRows
    Set-Content -LiteralPath (Join-Path $repo "spec.md") -Value "fixture task" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $appData "npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe") -Value "fixture executable" -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $localAppData "agy\bin\agy.exe") -Value "fixture executable" -Encoding ASCII

    $orcaShim = Join-Path $fixtureRoot "orca-fixture.js"
    @'
const fs = require("fs");
const path = require("path");
const log = process.env.ORCA_FIXTURE_LOG;
const scenario = process.env.ORCA_FIXTURE_SCENARIO || "";
const args = process.argv.slice(2).filter((x) => x !== "--json");
const readRecords = () => {
  try { return fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch (_) { return []; }
};
const value = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1] || null;
};
let result = {};
if (args[0] === "terminal" && args[1] === "create") {
  result = { terminal: { handle: "term_fixture", connected: true, writable: true } };
} else if (args[0] === "terminal" && args[1] === "show") {
  result = { terminal: { handle: value("--terminal"), connected: true, writable: true, agentIdentity: "antigravity", preview: ">" } };
} else if (args[0] === "terminal" && args[1] === "wait") {
  result = { wait: { satisfied: true, blockedReason: null } };
} else if (args[0] === "terminal" && args[1] === "read") {
  const records = readRecords();
  const codex = records.some((r) => r.args[0] === "terminal" && r.args[1] === "create" && (r.args[r.args.indexOf("--command") + 1] || "").includes("codex.exe"));
  const entered = records.some((r) => r.args[0] === "terminal" && r.args[1] === "send" && r.args.includes("--enter"));
  const screenReads = records.filter((r) => r.args[0] === "terminal" && r.args[1] === "read").length;
  const delayedCodex = ["stage2", "stage2-not-working", "legacy-stage1"].includes(scenario);
  const promptVisible = codex && !entered && (!delayedCodex || screenReads >= 2);
  result = { terminal: { handle: value("--terminal"), status: "connected", tail: promptVisible ? ["[Pasted Content 5830 chars]"] : ["READY", ">"], latestCursor: 1 } };
} else if (args[0] === "terminal" && args[1] === "send") {
  result = { submission: { accepted: true } };
} else if (args[0] === "orchestration" && args[1] === "task-create") {
  result = { task: { id: "task_fixture" } };
} else if (args[0] === "orchestration" && args[1] === "dispatch") {
  result = { dispatch: { id: "ctx_fixture" } };
} else if (args[0] === "orchestration" && args[1] === "worker-start") {
  result = { dispatchId: "ctx_fixture", taskId: "task_fixture", state: "ready" };
} else if (args[0] === "orchestration" && args[1] === "worker-show") {
  const records = readRecords();
  const entered = records.some((r) => r.args[0] === "terminal" && r.args[1] === "send" && r.args.includes("--enter"));
  const created = records.filter((r) => r.args[0] === "terminal" && r.args[1] === "create").slice(-1)[0];
  const commandIndex = created ? created.args.indexOf("--command") : -1;
  const command = commandIndex >= 0 ? String(created.args[commandIndex + 1] || "") : "";
  const codex = command.includes("codex.exe");
  const model = command.match(/--model\s+"([^"]+)"/);
  const working = entered && scenario !== "stage2-not-working";
  result = {
    observation: { status: "live", exactWorker: true, agentWait: null },
    projection: {
      provider: { id: codex ? "codex" : "antigravity", model: codex ? "gpt-6-luna" : (model ? model[1] : null) },
      stage: { worker: "ready", dispatch: "dispatched", detail: "input_accepted", activity: working ? "working" : "idle" },
      liveness: { verdict: "live", source: "agent_status" },
      evidence: { durable: true, liveStatus: "fresh" }
    }
  };} else if (args[0] === "orchestration" && args[1] === "check") {
  const run = value("--run");
  const records = readRecords();
  const relevant = records.filter((r) => {
    const a = r.args || [];
    for (let i = 0; i < a.length - 1; i++) if (a[i] === "--run" && a[i + 1] === run) return true;
    return false;
  });
  const started = relevant.filter((r) => r.args[1] === "worker-start" || r.args[1] === "dispatch").slice(-1)[0];
  const created = relevant.filter((r) => r.args[0] === "terminal" && r.args[1] === "create").slice(-1)[0];
  const task = relevant.filter((r) => r.args[1] === "task-create").slice(-1)[0];
  if (started) {
    const get = (a, key) => { const i = a.indexOf(key); return i < 0 ? null : a[i + 1] || null; };
    let spec = get(started.args, "--spec") || (task && get(task.args, "--spec")) || "";
    const worktree = get(started.args, "--worktree") || "";
    const staged = spec.match(/(?:Read the full task spec from|First action: read the complete staged file from) ([^ \r\n]+)/);
    if (staged && worktree.startsWith("path:")) {
      try { spec = fs.readFileSync(path.join(worktree.slice(5), staged[1].replace(/\//g, path.sep)), "utf8"); } catch (_) {}
    }
    const match = spec.match(/subject `([^`]+)`/);
    const terminal = get(started.args, "--terminal") || (created && created.response && created.response.result && created.response.result.terminal.handle) || "term_fixture";
    result = { messages: [{ type: "heartbeat", subject: match ? match[1] : "ack", from_handle: terminal, payload: { dispatchId: "ctx_fixture", taskId: "task_fixture", receiptMarker: match ? match[1] : "ack" } }] };
  } else result = { messages: [] };
}
const response = { ok: true, result };
try { fs.appendFileSync(log, JSON.stringify({ args, response }) + "\n"); } catch (_) {}
process.stdout.write(JSON.stringify(response));
'@ | Set-Content -LiteralPath $orcaShim -Encoding UTF8

    $preload = Join-Path $fixtureRoot "fast-clock.js"
    @'
const now = Date.now.bind(Date);
let step = 0;
Date.now = () => now() + (++step * 1000);
Atomics.wait = () => "timed-out";
'@ | Set-Content -LiteralPath $preload -Encoding UTF8

    [Environment]::SetEnvironmentVariable("USERPROFILE", $homeRoot, "Process")
    [Environment]::SetEnvironmentVariable("HOME", $homeRoot, "Process")
    [Environment]::SetEnvironmentVariable("APPDATA", $appData, "Process")
    [Environment]::SetEnvironmentVariable("LOCALAPPDATA", $localAppData, "Process")
    [Environment]::SetEnvironmentVariable("TEMP", $tempRoot, "Process")
    [Environment]::SetEnvironmentVariable("TMP", $tempRoot, "Process")
    [Environment]::SetEnvironmentVariable("ORCA_CLI_COMMAND", $orcaShim, "Process")
    [Environment]::SetEnvironmentVariable("ORCA_TERMINAL_HANDLE", "term_control", "Process")
    [Environment]::SetEnvironmentVariable("DELY_ACK_S", "60", "Process")
    [Environment]::SetEnvironmentVariable("DELY_POLL_S", "1", "Process")
    [Environment]::SetEnvironmentVariable("DELY_LOOP_GUARD_OVERRIDE", $null, "Process")
    [Environment]::SetEnvironmentVariable("NODE_OPTIONS", "--require=$preload", "Process")

    $globalRows = @($primaryRow, $flashRow, $lunaRow)
    $projectRows = @($projectReviewRow)
    Set-FixturePins $globalRows $projectRows

    $primary = Invoke-Scenario "primary" @()
    $primaryTerminal = @($primary.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $primaryCommand = if ($primaryTerminal) { Read-Command $primaryTerminal } else { "" }
    $primaryEvent = @($primary.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    $primaryPins = $primaryEvent -and $primaryEvent.pinPhase -eq "implement" -and $null -eq $primaryEvent.fallbackStage -and $primaryEvent.launch.effective.agent -eq "antigravity" -and $primaryEvent.launch.effective.model -eq "claude-sonnet-5-5-high" -and $primaryEvent.launch.effective.effort -eq "default"
    Assert-Case "primary inherits global Sonnet High and launches AGY with that model" ($primary.ExitCode -eq 0 -and $primaryCommand -match 'agy(\.exe)?' -and $primaryCommand -match '--model "claude-sonnet-5-5-high"' -and $primaryPins) ($primary.Output + " | command=$primaryCommand")

    $stage1 = Invoke-Scenario "stage1" @("--fallback", "quota")
    $stage1Terminal = @($stage1.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $stage1Command = if ($stage1Terminal) { Read-Command $stage1Terminal } else { "" }
    $stage1Event = @($stage1.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    $stage1Pins = $stage1Event -and $stage1Event.pinPhase -eq "implement_backup" -and $stage1Event.fallbackStage -eq 1 -and $stage1Event.launch.pinPhase -eq "implement_backup" -and $stage1Event.launch.fallbackStage -eq 1 -and $stage1Event.launch.effective.agent -eq "antigravity" -and $stage1Event.launch.effective.model -eq "gemini-3.8-flash-high" -and $stage1Event.launch.effective.effort -eq "default"
    Assert-Case "quota defaults to stage 1 and launches AGY Flash High from the global pin" ($stage1.ExitCode -eq 0 -and $stage1Command -match 'agy(\.exe)?' -and $stage1Command -match '--model "gemini-3.8-flash-high"' -and $stage1Pins) ($stage1.Output + " | command=$stage1Command")

    $stage2 = Invoke-Scenario "stage2" @("--fallback", "quota", "--fallback-stage", "2")
    $stage2Terminal = @($stage2.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $stage2Command = if ($stage2Terminal) { Read-Command $stage2Terminal } else { "" }
    $stage2Start = @($stage2.Calls | Where-Object { $_.args[0] -eq "orchestration" -and $_.args[1] -eq "worker-start" }) | Select-Object -First 1
    $stage2Enter = @($stage2.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "send" -and $_.args -contains "--enter" })
    $stage2Screens = @($stage2.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "read" -and $_.args -contains "--screen" })
    $promptIndexes = @()
    for ($i = 0; $i -lt $stage2Screens.Count; $i++) { if (($stage2Screens[$i].response.result.terminal.tail -join [Environment]::NewLine) -match 'Pasted Content') { $promptIndexes += $i } }
    $delayedPrompt = $stage2Screens.Count -ge 2 -and $promptIndexes.Count -gt 0 -and $promptIndexes[0] -gt 0
    $workingEvidence = @($stage2.Calls | Where-Object { $_.args[0] -eq "orchestration" -and $_.args[1] -eq "worker-show" -and $_.response.result.projection.stage.activity -eq "working" }).Count -gt 0
    $stage2Wait = @($stage2.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "wait" }) | Select-Object -First 1
    $stage2WaitSatisfied = $stage2Wait -and $stage2Wait.response.result.wait.satisfied -eq $true -and (Has-FlagValue $stage2Wait "--for" "tui-idle")
    $stage2Event = @($stage2.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    $stage2Pins = $stage2Event -and $stage2Event.pinPhase -eq "implement_backup_2" -and $stage2Event.fallbackStage -eq 2 -and $stage2Event.launch.pinPhase -eq "implement_backup_2" -and $stage2Event.launch.fallbackStage -eq 2 -and $stage2Event.launch.effective.agent -eq "codex" -and $stage2Event.launch.effective.model -eq "gpt-6-luna" -and $stage2Event.launch.effective.effort -eq "max" -and $stage2Event.launch.startEvidence -eq "legacy_working_projection"
    $stage2CommandOk = $stage2Command -match 'codex\.exe".*--model "gpt-6-luna" -c "model_reasoning_effort=max"'
    $stage2AttachedOnce = $stage2Start -and (Has-FlagValue $stage2Start "--terminal" "term_fixture") -and -not (Has-FlagValue $stage2Start "--model" "gpt-6-luna") -and -not (Has-FlagValue $stage2Start "--effort" "max") -and $stage2Enter.Count -eq 1 -and $workingEvidence
    Assert-Case "stage 2 launches native Codex Luna max with delayed prompt, one bare Enter, and fresh working evidence" ($stage2.ExitCode -eq 0 -and $stage2CommandOk -and $stage2WaitSatisfied -and $stage2AttachedOnce -and $stage2Pins -and $delayedPrompt) ($stage2.Output + " | command=$stage2Command")

    $notWorking = Invoke-Scenario "stage2-not-working" @("--fallback", "quota", "--fallback-stage", "2")
    $notWorkingEnter = @($notWorking.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "send" -and $_.args -contains "--enter" })
    $nonWorkingEvidence = @($notWorking.Calls | Where-Object { $_.args[0] -eq "orchestration" -and $_.args[1] -eq "worker-show" -and $_.response.result.projection.stage.activity -ne "working" }).Count -gt 0
    Assert-Case "stage 2 rejects accepted input without fresh working evidence" ($notWorking.ExitCode -ne 0 -and $notWorkingEnter.Count -eq 1 -and $nonWorkingEvidence -and $notWorking.Output -match "no working Codex turn evidence") $notWorking.Output

    $projectPrimary = "|" + $tick + "implement" + $tick + " | Antigravity CLI | gemini-3.8-flash-high | default |"
    Set-FixturePins $globalRows @($projectReviewRow, $projectPrimary)
    $primaryOverride = Invoke-Scenario "primary-project-override" @()
    $overrideTerminal = @($primaryOverride.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $overrideEvent = @($primaryOverride.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    Assert-Case "project primary pin overrides the global primary" ($primaryOverride.ExitCode -eq 0 -and (Read-Command $overrideTerminal) -match '--model "gemini-3.8-flash-high"' -and $overrideEvent.launch.effective.model -eq "gemini-3.8-flash-high") $primaryOverride.Output

    Set-FixturePins @($primaryRow, $backupRow, $lunaRow) @($projectReviewRow, $flashRow)
    $stage1Override = Invoke-Scenario "stage1-project-override" @("--fallback", "quota", "--fallback-stage", "1")
    $stage1OverrideTerminal = @($stage1Override.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $stage1OverrideEvent = @($stage1Override.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    Assert-Case "project Flash stage 1 overrides a legacy global Luna pin" ($stage1Override.ExitCode -eq 0 -and (Read-Command $stage1OverrideTerminal) -match '--model "gemini-3.8-flash-high"' -and $stage1OverrideEvent.pinPhase -eq "implement_backup" -and $stage1OverrideEvent.fallbackStage -eq 1) $stage1Override.Output

    Set-FixturePins $globalRows @($projectReviewRow, ("|" + $tick + "implement_backup" + $tick + " | Antigravity CLI | gemini-3.8-flash-high | high |"))
    $badFlashEffort = Invoke-Scenario "bad-flash-effort" @("--fallback", "quota", "--fallback-stage", "1")
    Assert-Case "stage 1 rejects Flash with non-default effort before launch" ($badFlashEffort.ExitCode -ne 0 -and -not (Has-Launch $badFlashEffort) -and $badFlashEffort.Output -match "quota stage 1 pin") $badFlashEffort.Output

    Set-FixturePins $globalRows @($projectReviewRow, ("|" + $tick + "implement_backup_2" + $tick + " | Codex CLI | gpt-6-luna | low |"))
    $lunaLow = Invoke-Scenario "luna-low" @("--fallback", "quota", "--fallback-stage", "2")
    Assert-Case "stage 2 rejects Codex Luna low effort before launch" ($lunaLow.ExitCode -ne 0 -and -not (Has-Launch $lunaLow) -and $lunaLow.Output -match "quota stage 2 pin") $lunaLow.Output

    Set-FixturePins $globalRows @($projectReviewRow, ("|" + $tick + "implement_backup_2" + $tick + " | Codex CLI | gpt-6-luna | default |"))
    $lunaDefault = Invoke-Scenario "luna-default" @("--fallback", "quota", "--fallback-stage", "2")
    Assert-Case "stage 2 rejects Codex Luna default effort before launch" ($lunaDefault.ExitCode -ne 0 -and -not (Has-Launch $lunaDefault) -and $lunaDefault.Output -match "quota stage 2 pin") $lunaDefault.Output

    Set-FixturePins $globalRows @($projectReviewRow)
    $unknown = Invoke-Scenario "unknown" @("--fallback", "provider")
    Assert-Case "unknown fallback reason cannot launch" ($unknown.ExitCode -ne 0 -and -not (Has-Launch $unknown)) $unknown.Output

    $invalidStage = Invoke-Scenario "invalid-stage" @("--fallback", "quota", "--fallback-stage", "3")
    Assert-Case "unknown fallback stage cannot launch" ($invalidStage.ExitCode -ne 0 -and -not (Has-Launch $invalidStage) -and $invalidStage.Output -match "invalid fallback stage") $invalidStage.Output

    $missingQuota = Invoke-Scenario "stage-without-quota" @("--fallback-stage", "1")
    Assert-Case "fallback stage without quota reason cannot launch" ($missingQuota.ExitCode -ne 0 -and -not (Has-Launch $missingQuota) -and $missingQuota.Output -match "requires --fallback quota") $missingQuota.Output

    $preflight = Invoke-Raw "preflight-stage" @("preflight", "--repo", $repo, "--run", "quota-fixture-preflight-stage", "--fallback", "quota", "--fallback-stage", "1")
    Assert-Case "fallback stage on preflight is rejected before Orca mutation" ($preflight.ExitCode -ne 0 -and -not (Has-Launch $preflight) -and $preflight.Output -match "only for implementation dispatch") $preflight.Output

    $review = Invoke-Scenario "review-stage2" @("--phase", "review", "--fallback", "quota", "--fallback-stage", "2")
    Assert-Case "Codex-owned review remains rejected" ($review.ExitCode -ne 0 -and -not (Has-Launch $review) -and $review.Output -match "review is owned by Codex Control") $review.Output

    Set-FixturePins @($primaryRow, $flashRow) @($projectReviewRow)
    $missingStage2 = Invoke-Scenario "missing-stage2-pin" @("--fallback", "quota", "--fallback-stage", "2")
    Assert-Case "missing stage 2 pin fails without falling back to Flash or primary" ($missingStage2.ExitCode -ne 0 -and -not (Has-Launch $missingStage2)) $missingStage2.Output

    Set-FixturePins @($primaryRow, $backupRow) @($projectReviewRow)
    $legacy = Invoke-Scenario "legacy-stage1" @("--fallback", "quota")
    $legacyTerminal = @($legacy.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $legacyCommand = if ($legacyTerminal) { Read-Command $legacyTerminal } else { "" }
    $legacyEvent = @($legacy.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    Assert-Case "legacy sole Codex Luna backup remains valid at default stage 1" ($legacy.ExitCode -eq 0 -and $legacyCommand -match 'codex\.exe".*--model "gpt-6-luna" -c "model_reasoning_effort=max"' -and $legacyEvent.pinPhase -eq "implement_backup" -and $legacyEvent.fallbackStage -eq 1) ($legacy.Output + " | command=$legacyCommand")
    Write-Output "RESULT pass=$pass fail=$fail helper=$helper"
    if ($fail -gt 0) { exit 1 }
} finally {
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $oldEnv[$name], "Process") }
    $resolvedFixture = [System.IO.Path]::GetFullPath($fixtureRoot)
    $resolvedTmp = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".tmp-dely"))
    if ($resolvedFixture.StartsWith($resolvedTmp + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        $item = Get-Item -LiteralPath $resolvedFixture -Force -ErrorAction SilentlyContinue
        if ($item -and -not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            if ($fail -gt 0) {
                Write-Output "FIXTURE retained at $resolvedFixture"
            } else {
                Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
            }
        }
    }
}
