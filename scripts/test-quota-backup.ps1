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

function Invoke-Scenario([string]$name, [string[]]$extra) {
    $run = "quota-fixture-$name"
    $env:ORCA_FIXTURE_LOG = Join-Path $fixtureRoot "$name.calls.jsonl"
    $env:ORCA_FIXTURE_SCENARIO = $name
    $cliArgs = @("dispatch", "--repo", $repo, "--run", $run, "--phase", "implement", "--spec-file", "spec.md") + $extra
    $output = @(& $nodeExe $helper @cliArgs 2>&1 | ForEach-Object { $_.ToString() })
    $exitCode = $LASTEXITCODE
    $calls = @()
    if (Test-Path -LiteralPath $env:ORCA_FIXTURE_LOG) {
        $calls = @(Get-Content -LiteralPath $env:ORCA_FIXTURE_LOG | ForEach-Object { $_ | ConvertFrom-Json })
    }
    $events = @()
    if (Test-Path -LiteralPath $delyLog) {
        $events = @(Get-Content -LiteralPath $delyLog | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.run -eq $run })
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join "`n"); Calls = $calls; Events = $events }
}

function Has-Launch($scenario) {
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

$envNames = @("USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "ORCA_CLI_COMMAND", "ORCA_FIXTURE_LOG", "ORCA_FIXTURE_SCENARIO", "ORCA_TERMINAL_HANDLE", "DELY_ACK_S", "DELY_POLL_S", "DELY_LOOP_GUARD_OVERRIDE", "NODE_OPTIONS")
$oldEnv = @{}
foreach ($name in $envNames) { $oldEnv[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }

try {
    New-Item -ItemType Directory -Path (Join-Path $homeRoot ".codex"), (Join-Path $homeRoot ".dely"), (Join-Path $repo ""), (Join-Path $appData "npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin"), (Join-Path $localAppData "agy\bin"), $tempRoot -Force | Out-Null

    $globalText = @(
        '| `implement` | Antigravity CLI | default | default |',
        $backupRow
    ) -join [Environment]::NewLine
    Write-Utf8NoBom $globalAgents $globalText
    $projectText = @(
        '| `implement` | Antigravity CLI | default | default |',
        '| `review` | Codex CLI | gpt-6-luna | default |'
    ) -join [Environment]::NewLine
    Write-Utf8NoBom (Join-Path $repo "AGENTS.md") $projectText
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
  const promptVisible = codex && !entered && (scenario !== "quota" || screenReads >= 2);
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
  const entered = readRecords().some((r) => r.args[0] === "terminal" && r.args[1] === "send" && r.args.includes("--enter"));
  const working = entered && scenario !== "quota-not-working";
  result = {
    observation: { status: "live", exactWorker: true, agentWait: null },
    projection: {
      provider: { id: "codex", model: "gpt-6-luna" },
      stage: { worker: "ready", dispatch: "dispatched", detail: "input_accepted", activity: working ? "working" : "idle" },
      liveness: { verdict: "live", source: "agent_status" },
      evidence: { durable: true, liveStatus: "fresh" }
    }
  };
} else if (args[0] === "orchestration" && args[1] === "check") {
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

    $primary = Invoke-Scenario "primary" @()
    $primaryTerminal = @($primary.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    Assert-Case "ordinary implementation launches AGY" ($primary.ExitCode -eq 0 -and $null -ne $primaryTerminal -and (Read-Command $primaryTerminal) -match "agy(\.exe)?") $primary.Output

    $quota = Invoke-Scenario "quota" @("--fallback", "quota")
    $quotaTerminal = @($quota.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $quotaCommand = if ($quotaTerminal) { Read-Command $quotaTerminal } else { "" }
    $workerStart = @($quota.Calls | Where-Object { $_.args[0] -eq "orchestration" -and $_.args[1] -eq "worker-start" }) | Select-Object -First 1
    $enterCalls = @($quota.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "send" -and $_.args -contains "--enter" })
    $screenCalls = @($quota.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "read" -and $_.args -contains "--screen" })
    $screenPromptIndexes = @(); for ($i = 0; $i -lt $screenCalls.Count; $i++) { if (($screenCalls[$i].response.result.terminal.tail -join "\n") -match 'Pasted Content') { $screenPromptIndexes += $i } }
    $delayedPrompt = $screenCalls.Count -ge 3 -and $screenPromptIndexes.Count -gt 0 -and $screenPromptIndexes[0] -gt 0
    $observedTurn = @($quota.Calls | Where-Object { $_.args[0] -eq "orchestration" -and $_.args[1] -eq "worker-show" -and $_.response.result.projection.stage.activity -eq "working" }).Count -gt 0
    $waitCall = @($quota.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "wait" }) | Select-Object -First 1
    $waitSatisfied = $waitCall -and $waitCall.response.result.wait.satisfied -eq $true -and (Has-FlagValue $waitCall "--for" "tui-idle")
    $effective = @($quota.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    $effectivePins = $effective -and $effective.launch.effective.agent -eq "codex" -and $effective.launch.effective.model -eq "gpt-6-luna" -and $effective.launch.effective.effort -eq "max" -and $effective.launch.startEvidence -eq "legacy_working_projection"
    $attachedOnce = $workerStart -and (Has-FlagValue $workerStart "--terminal" "term_fixture") -and -not (Has-FlagValue $workerStart "--model" "gpt-6-luna") -and -not (Has-FlagValue $workerStart "--effort" "max") -and $enterCalls.Count -eq 1 -and $observedTurn
    $correctCommand = $quotaCommand -match 'codex\.exe".*--model "gpt-6-luna" -c "model_reasoning_effort=max"'
    Assert-Case "quota fallback waits for the delayed prompt and accepts the exact working projection" ($quota.ExitCode -eq 0 -and $correctCommand -and $waitSatisfied -and $attachedOnce -and $effectivePins -and $delayedPrompt) ($quota.Output + " | command=$quotaCommand")

    $notWorking = Invoke-Scenario "quota-not-working" @("--fallback", "quota")
    $notWorkingEnter = @($notWorking.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "send" -and $_.args -contains "--enter" })
    $nonWorkingEvidence = @($notWorking.Calls | Where-Object { $_.args[0] -eq "orchestration" -and $_.args[1] -eq "worker-show" -and $_.response.result.projection.stage.activity -ne "working" }).Count -gt 0
    Assert-Case "non-working legacy projection does not count as a started turn" ($notWorking.ExitCode -ne 0 -and $notWorkingEnter.Count -eq 1 -and $nonWorkingEvidence -and $notWorking.Output -match "no working Codex turn evidence") $notWorking.Output

    $unknown = Invoke-Scenario "unknown" @("--fallback", "provider")
    Assert-Case "unknown fallback reason cannot launch" ($unknown.ExitCode -ne 0 -and -not (Has-Launch $unknown)) $unknown.Output

    $reviewArgs = @("--phase", "review", "--fallback", "quota")
    $review = Invoke-Scenario "review" $reviewArgs
    Assert-Case "review fallback cannot launch" ($review.ExitCode -ne 0 -and -not (Has-Launch $review)) $review.Output

    $projectHasBackup = Select-String -LiteralPath (Join-Path $repo "AGENTS.md") -Pattern '^\|\s*`?implement_backup`?\s*\|' -Quiet
    Assert-Case "project primary inherits global backup pin" (-not $projectHasBackup -and $quota.ExitCode -eq 0 -and $correctCommand) "fixture project unexpectedly has a local backup or fallback did not use global pin"

    Write-Utf8NoBom $globalAgents ($globalText.Replace($backupRow, '| `implement_backup` | Codex CLI | default | max |'))
    $missingModel = Invoke-Scenario "missing-model" @("--fallback", "quota")
    Assert-Case "backup omitting model is rejected before launch" ($missingModel.ExitCode -ne 0 -and -not (Has-Launch $missingModel)) $missingModel.Output

    Write-Utf8NoBom $globalAgents ($globalText.Replace($backupRow, '| `implement_backup` | Codex CLI | gpt-6-luna | high |'))
    $changedEffort = Invoke-Scenario "changed-effort" @("--fallback", "quota")
    Assert-Case "backup changing effort is rejected before launch" ($changedEffort.ExitCode -ne 0 -and -not (Has-Launch $changedEffort)) $changedEffort.Output

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
