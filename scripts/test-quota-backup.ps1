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
$flashRow = "|" + $tick + "implement_backup" + $tick + " | Antigravity CLI | gemini-3.8-flash-medium | default |"
$lunaRow = "|" + $tick + "implement_backup_2" + $tick + " | Codex CLI | gpt-6-luna | max |"
$projectReviewRow = "|" + $tick + "review" + $tick + " | Codex CLI | gpt-6.1-sol | high |"
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
    $cliArgs = @("dispatch", "--repo", $repo, "--run", $run, "--phase", "implement", "--spec-file", "spec.md", "--assessment-file", "assessment.json") + $extra
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

function Set-FixtureAssessment([string]$difficulty) {
    $module = Join-Path $repoRoot "skills\delivery\scripts\task-routing.js"
    $builder = Join-Path $fixtureRoot "prepare-assessment.cjs"
    $script = 'const r=require(process.argv[2]),fs=require("fs"); const task=r.loadTask(process.argv[3],"spec.md","context.json"); const a={policy:r.POLICY,task,status:"NOT_EVALUATED",jev:null}; fs.writeFileSync(process.argv[3]+"/assessment.json",JSON.stringify(r.review(a,process.argv[4],"Fixture source and acceptance inspected by Control")));'
    Write-Utf8NoBom $builder $script
    & $nodeExe $builder $module $repo $difficulty
    if ($LASTEXITCODE -ne 0) { throw "Could not prepare fixture assessment" }
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
    Write-Utf8NoBom (Join-Path $repo "context.json") '{"scope":"Fixture-only private helper","coupling":"Known fixture callers","acceptance":"Fixture asserts exact native model, effort, and launch evidence","evidence":"Orca shim and fixture inputs inspected","requirements_confirmed":true,"risks":{"security":false,"data":false,"public_contract":false,"architecture":false,"production":false,"routing":false}}'
    Set-FixtureAssessment "easy"
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
  const promptVisible = codex && !entered && scenario !== "uncertain-no-prompt" && (scenario === "missing-sonnet-late-prompt" ? screenReads >= 40 : (!delayedCodex || screenReads >= 2));
  const created = records.filter((r) => r.args[0] === "terminal" && r.args[1] === "create").slice(-1)[0];
  const command = created ? created.args[created.args.indexOf("--command") + 1] : "";
  const modelFooter = scenario === "wrong-live-model" ? "Gemini 3.8 Flash · high" : command.includes("claude-sonnet-5-5-high") ? "Claude Sonnet 5.5 · high" : "Gemini 3.8 Flash · medium";
  result = { terminal: { handle: value("--terminal"), status: "connected", tail: promptVisible ? ["[Pasted Content 5830 chars]"] : ["READY", modelFooter, ">"], latestCursor: 1 } };
} else if (args[0] === "terminal" && args[1] === "send") {
  result = { submission: { accepted: true } };
} else if (args[0] === "orchestration" && args[1] === "task-create") {
  result = { task: { id: "task_fixture" } };
} else if (args[0] === "orchestration" && args[1] === "dispatch") {
  result = { dispatch: { id: "ctx_fixture" } };
} else if (args[0] === "orchestration" && args[1] === "worker-start") {
  result = { dispatchId: "ctx_fixture", taskId: "task_fixture", state: ["uncertain-visible-prompt", "uncertain-no-prompt"].includes(scenario) || scenario.includes("fast-completion") ? "outcome_unknown" : "ready" };
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
  };
  if (entered && scenario.includes("fast-completion")) {
    const id = scenario === "fast-completion-other-dispatch" ? "ctx_other" : "ctx_fixture";
    const outcome = scenario === "fast-completion-failed" ? "failed" : "succeeded";
    result = {
      dispatch: { id, status: "completed" }, worker: { dispatchId: id, state: outcome },
      observation: { status: "exited", exactWorker: true },
      projection: { dispatchId: id, provider: null,
        stage: { worker: outcome, dispatch: "completed", detail: "settled", activity: "unknown" },
        outcome, evidence: { durable: scenario !== "fast-completion-not-durable", liveStatus: "unavailable" },
        liveness: { verdict: "unverifiable" } }
    };
  }
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
    if (["preflight-missing-model", "preflight-fast-completion", "task-preflight-flash", "task-preflight-sonnet"].includes(scenario)) {
      result.deliveryId = "delivery_preflight_fixture";
      result.messages.push({ type: "worker_done", from_handle: terminal, payload: { dispatchId: "ctx_fixture", taskId: "task_fixture", outcome: "succeeded" } });
    }
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
const cp = require("child_process");
const originalExec = cp.execFileSync;
cp.execFileSync = function(file, args, options) {
  if (String(file).endsWith("agy.exe") && args[0] === "models") {
    const scenario = process.env.ORCA_FIXTURE_SCENARIO;
    if (scenario === "catalog-auth-error") throw new Error("provider authentication failed");
    if (scenario === "catalog-empty") return "Fetching available models...\n";
    if (scenario === "missing-model-stale") {
      const index = process.argv.indexOf("--repo");
      require("fs").appendFileSync(require("path").join(process.argv[index + 1], "spec.md"), " changed during model discovery");
    }
    if (["missing-sonnet-model", "missing-sonnet-late-prompt", "missing-model-stale", "missing-model-bad-pin", "uncertain-visible-prompt", "uncertain-no-prompt", "preflight-missing-model", "preflight-bad-luna-pin"].includes(scenario) || scenario.includes("fast-completion")) return "gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n";
    if (scenario === "missing-flash-model") return "claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)\n";
    return "claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n";
  }
  return originalExec.call(this, file, args, options);
};
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

    $taskPreflight = Invoke-Raw "task-preflight-flash" @("preflight", "--repo", $repo, "--run", "quota-fixture-task-preflight-flash", "--assessment-file", "assessment.json", "--spec-file", "spec.md")
    $taskPreflightTerminal = @($taskPreflight.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    Assert-Case "task preflight checks the reviewed Easy Flash primary" ($taskPreflight.ExitCode -eq 0 -and (Read-Command $taskPreflightTerminal) -match '--model "gemini-3.8-flash-medium"') $taskPreflight.Output
    $preflightStarts = @($taskPreflight.Calls | Where-Object { $_.args[0] -eq "orchestration" -and $_.args[1] -eq "worker-start" })
    Assert-Case "Control-owned review never creates a Sol High preflight worker" ($taskPreflight.ExitCode -eq 0 -and $preflightStarts.Count -eq 1) $taskPreflight.Output
    $preflightSpec = $preflightStarts[0].args[([array]::IndexOf($preflightStarts[0].args, "--spec") + 1)]
    Assert-Case "healthcheck names the resolved Orca CLI and simple coordination commands" ($preflightSpec -match "orca-fixture.js" -and $preflightSpec -match "directly" -and $preflightSpec -match "no implementation") $preflightSpec
    $partialPreflight = Invoke-Raw "task-preflight-partial" @("preflight", "--repo", $repo, "--run", "quota-fixture-task-preflight-partial", "--assessment-file", "assessment.json")
    Assert-Case "partial task preflight arguments are refused before launch" ($partialPreflight.ExitCode -ne 0 -and -not (Has-Launch $partialPreflight) -and $partialPreflight.Output -match "requires both") $partialPreflight.Output

    $primary = Invoke-Scenario "primary" @()
    $primaryTerminal = @($primary.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $primaryCommand = if ($primaryTerminal) { Read-Command $primaryTerminal } else { "" }
    $primaryEvent = @($primary.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    $primaryPins = $primaryEvent -and $primaryEvent.pinPhase -eq "implement_backup" -and $null -eq $primaryEvent.fallbackStage -and $primaryEvent.launch.effective.agent -eq "antigravity" -and $primaryEvent.launch.effective.model -eq "gemini-3.8-flash-medium" -and $primaryEvent.launch.effective.effort -eq "default"
    Assert-Case "Easy starts AGY Flash Medium from its global model row" ($primary.ExitCode -eq 0 -and $primaryCommand -match 'agy(\.exe)?' -and $primaryCommand -match '--model "gemini-3.8-flash-medium"' -and $primaryPins) ($primary.Output + " | command=$primaryCommand")

    $stage1 = Invoke-Scenario "stage1" @("--fallback", "quota")
    $stage1Terminal = @($stage1.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $stage1Command = if ($stage1Terminal) { Read-Command $stage1Terminal } else { "" }
    $stage1Event = @($stage1.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    $stage1Pins = $stage1Event -and $stage1Event.pinPhase -eq "implement_backup_2" -and $stage1Event.fallbackStage -eq 1 -and $stage1Event.launch.pinPhase -eq "implement_backup_2" -and $stage1Event.launch.fallbackStage -eq 1 -and $stage1Event.launch.effective.agent -eq "codex" -and $stage1Event.launch.effective.model -eq "gpt-6-luna" -and $stage1Event.launch.effective.effort -eq "max"
    Assert-Case "Easy quota defaults to one Luna/max fallback" ($stage1.ExitCode -eq 0 -and $stage1Command -match 'codex\.exe".*--model "gpt-6-luna" -c "model_reasoning_effort=max"' -and $stage1Pins) ($stage1.Output + " | command=$stage1Command")

    $stage2 = Invoke-Scenario "stage2" @("--fallback", "quota", "--fallback-stage", "1")
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
    $stage2Pins = $stage2Event -and $stage2Event.pinPhase -eq "implement_backup_2" -and $stage2Event.fallbackStage -eq 1 -and $stage2Event.launch.pinPhase -eq "implement_backup_2" -and $stage2Event.launch.fallbackStage -eq 1 -and $stage2Event.launch.effective.agent -eq "codex" -and $stage2Event.launch.effective.model -eq "gpt-6-luna" -and $stage2Event.launch.effective.effort -eq "max" -and $stage2Event.launch.startEvidence -eq "legacy_working_projection"
    $stage2CommandOk = $stage2Command -match 'codex\.exe".*--model "gpt-6-luna" -c "model_reasoning_effort=max"'
    $stage2AttachedOnce = $stage2Start -and (Has-FlagValue $stage2Start "--terminal" "term_fixture") -and -not (Has-FlagValue $stage2Start "--model" "gpt-6-luna") -and -not (Has-FlagValue $stage2Start "--effort" "max") -and $stage2Enter.Count -eq 1 -and $workingEvidence
    Assert-Case "Luna quota fallback handles a delayed prompt, one bare Enter, and fresh working evidence" ($stage2.ExitCode -eq 0 -and $stage2CommandOk -and $stage2WaitSatisfied -and $stage2AttachedOnce -and $stage2Pins -and $delayedPrompt) ($stage2.Output + " | command=$stage2Command")

    $notWorking = Invoke-Scenario "stage2-not-working" @("--fallback", "quota", "--fallback-stage", "1")
    $notWorkingEnter = @($notWorking.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "send" -and $_.args -contains "--enter" })
    $nonWorkingEvidence = @($notWorking.Calls | Where-Object { $_.args[0] -eq "orchestration" -and $_.args[1] -eq "worker-show" -and $_.response.result.projection.stage.activity -ne "working" }).Count -gt 0
    Assert-Case "Luna rejects accepted input without fresh working evidence" ($notWorking.ExitCode -ne 0 -and $notWorkingEnter.Count -eq 1 -and $nonWorkingEvidence -and $notWorking.Output -match "no working Codex turn evidence") $notWorking.Output

    $projectPrimary = "|" + $tick + "implement" + $tick + " | Antigravity CLI | gemini-3.8-flash-medium | default |"
    $badProjectFlash = "|" + $tick + "implement_backup" + $tick + " | Antigravity CLI | claude-sonnet-5-5-high | default |"
    Set-FixturePins $globalRows @($projectReviewRow, $badProjectFlash)
    $primaryOverride = Invoke-Scenario "primary-project-override" @()
    Assert-Case "a project pin cannot replace Easy Flash with Sonnet" ($primaryOverride.ExitCode -ne 0 -and -not (Has-Launch $primaryOverride) -and $primaryOverride.Output -match "reviewed difficulty route") $primaryOverride.Output

    Set-FixturePins @($primaryRow, $backupRow, $lunaRow) @($projectReviewRow, $flashRow)
    $stage1Override = Invoke-Scenario "stage1-project-override" @()
    $stage1OverrideTerminal = @($stage1Override.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $stage1OverrideEvent = @($stage1Override.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    Assert-Case "project Flash primary overrides a mismatched global row" ($stage1Override.ExitCode -eq 0 -and (Read-Command $stage1OverrideTerminal) -match '--model "gemini-3.8-flash-medium"' -and $stage1OverrideEvent.pinPhase -eq "implement_backup" -and $null -eq $stage1OverrideEvent.fallbackStage) $stage1Override.Output

    Set-FixturePins $globalRows @($projectReviewRow, ("|" + $tick + "implement_backup" + $tick + " | Antigravity CLI | gemini-3.8-flash-medium | high |"))
    $badFlashEffort = Invoke-Scenario "bad-flash-effort" @()
    Assert-Case "Flash primary rejects non-default effort before launch" ($badFlashEffort.ExitCode -ne 0 -and -not (Has-Launch $badFlashEffort) -and $badFlashEffort.Output -match "reviewed difficulty route") $badFlashEffort.Output

    Set-FixturePins $globalRows @($projectReviewRow, ("|" + $tick + "implement_backup_2" + $tick + " | Codex CLI | gpt-6-luna | low |"))
    $lunaLow = Invoke-Scenario "luna-low" @("--fallback", "quota", "--fallback-stage", "1")
    Assert-Case "quota rejects Codex Luna low effort before launch" ($lunaLow.ExitCode -ne 0 -and -not (Has-Launch $lunaLow) -and $lunaLow.Output -match "quota stage 1 pin") $lunaLow.Output

    Set-FixturePins $globalRows @($projectReviewRow, ("|" + $tick + "implement_backup_2" + $tick + " | Codex CLI | gpt-6-luna | default |"))
    $lunaDefault = Invoke-Scenario "luna-default" @("--fallback", "quota", "--fallback-stage", "1")
    Assert-Case "quota rejects Codex Luna default effort before launch" ($lunaDefault.ExitCode -ne 0 -and -not (Has-Launch $lunaDefault) -and $lunaDefault.Output -match "quota stage 1 pin") $lunaDefault.Output

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
    $missingStage2 = Invoke-Scenario "missing-stage2-pin" @("--fallback", "quota", "--fallback-stage", "1")
    Assert-Case "missing Luna row fails without reverting to a primary" ($missingStage2.ExitCode -ne 0 -and -not (Has-Launch $missingStage2)) $missingStage2.Output

    Set-FixturePins @($primaryRow, $backupRow) @($projectReviewRow)
    $legacy = Invoke-Scenario "legacy-stage1" @("--fallback", "quota")
    $legacyTerminal = @($legacy.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $legacyCommand = if ($legacyTerminal) { Read-Command $legacyTerminal } else { "" }
    Assert-Case "a legacy Luna row cannot replace the missing final fallback row" ($legacy.ExitCode -ne 0 -and -not (Has-Launch $legacy) -and $legacy.Output -match "no implement_backup_2 pin") $legacy.Output

    Set-FixturePins $globalRows @($projectReviewRow)
    Set-FixtureAssessment "medium_minus"
    $minus = Invoke-Scenario "medium-minus" @()
    $minusTerminal = @($minus.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    Assert-Case "Medium- starts AGY Flash Medium" ($minus.ExitCode -eq 0 -and (Read-Command $minusTerminal) -match '--model "gemini-3.8-flash-medium"') $minus.Output
    $minusQuota = Invoke-Scenario "medium-minus-quota" @("--fallback", "quota")
    $minusQuotaTerminal = @($minusQuota.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    Assert-Case "Medium- quota starts Luna/max" ($minusQuota.ExitCode -eq 0 -and (Read-Command $minusQuotaTerminal) -match 'codex\.exe".*--model "gpt-6-luna" -c "model_reasoning_effort=max"') $minusQuota.Output
    Set-FixtureAssessment "medium_plus"
    $medium = Invoke-Scenario "medium" @()
    $mediumTerminal = @($medium.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    Assert-Case "Medium+ starts AGY Sonnet High" ($medium.ExitCode -eq 0 -and (Read-Command $mediumTerminal) -match '--model "claude-sonnet-5-5-high"') $medium.Output
    $sonnetPreflight = Invoke-Raw "task-preflight-sonnet" @("preflight", "--repo", $repo, "--run", "quota-fixture-task-preflight-sonnet", "--assessment-file", "assessment.json", "--spec-file", "spec.md")
    $sonnetPreflightTerminal = @($sonnetPreflight.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    Assert-Case "task preflight checks the reviewed Medium+ Sonnet primary" ($sonnetPreflight.ExitCode -eq 0 -and (Read-Command $sonnetPreflightTerminal) -match '--model "claude-sonnet-5-5-high"') $sonnetPreflight.Output
    $mediumQuota = Invoke-Scenario "medium-quota" @("--fallback", "quota")
    $mediumQuotaTerminal = @($mediumQuota.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $mediumQuotaEvent = @($mediumQuota.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    Assert-Case "Medium+ quota launches Luna/max directly" ($mediumQuota.ExitCode -eq 0 -and (Read-Command $mediumQuotaTerminal) -match 'codex\.exe".*--model "gpt-6-luna" -c "model_reasoning_effort=max"' -and $mediumQuotaEvent.pinPhase -eq "implement_backup_2" -and $mediumQuotaEvent.fallbackStage -eq 1) $mediumQuota.Output
    $mediumFinal = Invoke-Scenario "medium-final" @("--fallback", "quota", "--fallback-stage", "2")
    Assert-Case "Medium+ rejects a second fallback before launch" ($mediumFinal.ExitCode -ne 0 -and -not (Has-Launch $mediumFinal) -and $mediumFinal.Output -match "No such fallback") $mediumFinal.Output
    Set-FixtureAssessment "hard"
    $hard = Invoke-Scenario "hard" @()
    Assert-Case "Hard is refused before any Dely worker launch" ($hard.ExitCode -ne 0 -and -not (Has-Launch $hard) -and $hard.Output -match "HARD_DIRECT_CODEX") $hard.Output
    $hardPreflight = Invoke-Raw "task-preflight-hard" @("preflight", "--repo", $repo, "--run", "quota-fixture-task-preflight-hard", "--assessment-file", "assessment.json", "--spec-file", "spec.md")
    Assert-Case "task preflight cannot launch a worker for Hard" ($hardPreflight.ExitCode -ne 0 -and -not (Has-Launch $hardPreflight) -and $hardPreflight.Output -match "HARD_DIRECT_CODEX") $hardPreflight.Output
    Set-FixtureAssessment "medium_plus"
    $teamPinsDir = Join-Path $repo ".dely"
    $localPinsDir = Join-Path $teamPinsDir "local"
    New-Item -ItemType Directory -Path $localPinsDir -Force | Out-Null
    Write-Utf8NoBom (Join-Path $teamPinsDir "pins.json") '{"implement":{"harness":"antigravity","model":"claude-sonnet-5-5-high","effort":"default"}}'
    Set-FixturePins @($projectPrimary, $flashRow, $lunaRow) @($projectReviewRow)
    $teamPins = Invoke-Scenario "team-pins" @()
    Assert-Case "modern team pins take precedence over a mismatched global row" ($teamPins.ExitCode -eq 0) $teamPins.Output
    Write-Utf8NoBom (Join-Path $localPinsDir "pins.json") '{"implement":{"harness":"antigravity","model":"gemini-3.8-flash-medium","effort":"default"}}'
    $localPins = Invoke-Scenario "local-pins" @()
    Assert-Case "modern personal pins take precedence and cannot evade route validation" ($localPins.ExitCode -ne 0 -and -not (Has-Launch $localPins) -and $localPins.Output -match "reviewed difficulty route") $localPins.Output
    Write-Utf8NoBom (Join-Path $localPinsDir "pins.json") '{"implement":{"harness":"antigravity","model":"claude-sonnet-5-5-high","effort":"default"}}'
    $missingModel = Invoke-Scenario "missing-sonnet-model" @()
    $missingEvent = @($missingModel.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    $missingTerminals = @($missingModel.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" })
    $missingCommand = if ($missingTerminals.Count -eq 1) { Read-Command $missingTerminals[0] } else { "" }
    Assert-Case "verified Sonnet absence launches Luna/max directly with no AGY or Flash terminal" ($missingModel.ExitCode -eq 0 -and $missingTerminals.Count -eq 1 -and $missingCommand -match 'codex\.exe".*--model "gpt-6-luna" -c "model_reasoning_effort=max"' -and $missingEvent.fallbackReason -eq "model_unavailable" -and $null -eq $missingEvent.fallbackStage -and $missingEvent.launch.requested.model -eq "claude-sonnet-5-5-high" -and $missingEvent.launch.effective.model -eq "gpt-6-luna") $missingModel.Output
    $latePrompt = Invoke-Scenario "missing-sonnet-late-prompt" @()
    $lateEnters = @($latePrompt.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "send" -and $_.args -contains "--enter" })
    Assert-Case "missing-model Luna waits past 30 seconds for one visible prompt and sends one bare Enter" ($latePrompt.ExitCode -eq 0 -and $lateEnters.Count -eq 1 -and -not ($lateEnters[0].args -contains "--text")) $latePrompt.Output
    $uncertainVisible = Invoke-Scenario "uncertain-visible-prompt" @()
    $uncertainStarts = @($uncertainVisible.Calls | Where-Object { $_.args[0] -eq "orchestration" -and $_.args[1] -eq "worker-start" })
    $uncertainEnters = @($uncertainVisible.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "send" -and $_.args -contains "--enter" })
    Assert-Case "uncertain start is observed in place with one visible-prompt Enter and no new Dispatch" ($uncertainVisible.ExitCode -eq 0 -and $uncertainStarts.Count -eq 1 -and $uncertainEnters.Count -eq 1 -and -not ($uncertainEnters[0].args -contains "--text")) $uncertainVisible.Output
    $uncertainEmpty = Invoke-Scenario "uncertain-no-prompt" @()
    $emptyEnters = @($uncertainEmpty.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "send" -and $_.args -contains "--enter" })
    Assert-Case "uncertain input with no visible prompt or working proof remains failure without Enter" ($uncertainEmpty.ExitCode -ne 0 -and $emptyEnters.Count -eq 0 -and $uncertainEmpty.Output -match "no started turn") $uncertainEmpty.Output
    Set-FixtureAssessment "easy"
    $missingFlash = Invoke-Scenario "missing-flash-model" @()
    $missingFlashTerminal = @($missingFlash.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" }) | Select-Object -First 1
    $missingFlashEvent = @($missingFlash.Events | Where-Object { $_.event -eq "dispatch" }) | Select-Object -Last 1
    Assert-Case "verified Flash absence also launches Luna/max and records the requested Flash pin" ($missingFlash.ExitCode -eq 0 -and (Read-Command $missingFlashTerminal) -match 'codex\.exe".*--model "gpt-6-luna" -c "model_reasoning_effort=max"' -and $missingFlashEvent.fallbackReason -eq "model_unavailable" -and $missingFlashEvent.launch.requested.model -eq "gemini-3.8-flash-medium") $missingFlash.Output
    Set-FixtureAssessment "medium_plus"
    foreach ($catalogScenario in @("catalog-auth-error", "catalog-empty")) {
        $catalogFailure = Invoke-Scenario $catalogScenario @()
        Assert-Case "$catalogScenario stops without a worker instead of masquerading as model absence" ($catalogFailure.ExitCode -ne 0 -and -not (Has-Launch $catalogFailure) -and $catalogFailure.Output -match "AGY_MODEL_UNVERIFIED") $catalogFailure.Output
    }
    $badLuna = "|" + $tick + "implement_backup_2" + $tick + " | Codex CLI | gpt-6-luna | default |"
    Set-FixturePins @($primaryRow, $flashRow, $badLuna) @($projectReviewRow)
    $badMissingPin = Invoke-Scenario "missing-model-bad-pin" @()
    Assert-Case "model absence cannot launch an unapproved Luna effort" ($badMissingPin.ExitCode -ne 0 -and -not (Has-Launch $badMissingPin) -and $badMissingPin.Output -match "Missing-model fallback") $badMissingPin.Output
    Set-FixturePins @($primaryRow, $flashRow, $lunaRow) @($projectReviewRow)
    $missingStale = Invoke-Scenario "missing-model-stale" @()
    Assert-Case "assessment is revalidated after model discovery before a Luna launch" ($missingStale.ExitCode -ne 0 -and -not (Has-Launch $missingStale) -and $missingStale.Output -match "stale") $missingStale.Output
    Set-Content -LiteralPath (Join-Path $repo "spec.md") -Value "fixture task" -Encoding UTF8
    Set-FixtureAssessment "easy"
    $wrongModel = Invoke-Scenario "wrong-live-model" @()
    $wrongPrompt = @($wrongModel.Calls | Where-Object { $_.args[0] -eq "orchestration" -and @("worker-start", "dispatch") -contains $_.args[1] })
    $wrongClosed = @($wrongModel.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "close" })
    Assert-Case "a mismatched live footer is refused before dispatching the prompt" ($wrongModel.ExitCode -ne 0 -and $wrongPrompt.Count -eq 0 -and $wrongClosed.Count -eq 1 -and $wrongModel.Output -match "AGY_MODEL_NOT_APPLIED") $wrongModel.Output
    Set-FixtureAssessment "medium_plus"
    Set-FixturePins @($primaryRow, $flashRow, $lunaRow) @()
    $preflightMissing = Invoke-Raw "preflight-missing-model" @("preflight", "--repo", $repo, "--run", "quota-fixture-preflight-missing-model", "--control", "codex")
    $preflightTerminals = @($preflightMissing.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "create" })
    $preflightCommand = if ($preflightTerminals.Count -eq 1) { Read-Command $preflightTerminals[0] } else { "" }
    Assert-Case "preflight missing model selects one Luna/max healthcheck and passes before implementation dispatch" ($preflightMissing.ExitCode -eq 0 -and $preflightTerminals.Count -eq 1 -and $preflightCommand -match 'codex\.exe".*--model "gpt-6-luna" -c "model_reasoning_effort=max"' -and $preflightMissing.Output -match 'PREFLIGHT implement codex PASS') $preflightMissing.Output
    $preflightAuth = Invoke-Raw "catalog-auth-error" @("preflight", "--repo", $repo, "--run", "quota-fixture-catalog-auth-error", "--control", "codex")
    Assert-Case "preflight authentication error stops without pretending the model is absent" ($preflightAuth.ExitCode -ne 0 -and -not (Has-Launch $preflightAuth) -and $preflightAuth.Output -match "AGY_MODEL_UNVERIFIED") $preflightAuth.Output
    Set-FixturePins @($primaryRow, $flashRow, $badLuna) @()
    $preflightBadPin = Invoke-Raw "preflight-bad-luna-pin" @("preflight", "--repo", $repo, "--run", "quota-fixture-preflight-bad-luna-pin", "--control", "codex")
    Assert-Case "preflight cannot use a Luna fallback with unapproved default effort" ($preflightBadPin.ExitCode -ne 0 -and -not (Has-Launch $preflightBadPin) -and $preflightBadPin.Output -match "Missing-model fallback") $preflightBadPin.Output
    Set-FixturePins @($primaryRow, $flashRow, $lunaRow) @()
    $fastCompletion = Invoke-Raw "preflight-fast-completion" @("preflight", "--repo", $repo, "--run", "quota-fixture-preflight-fast-completion", "--control", "codex")
    $fastStarts = @($fastCompletion.Calls | Where-Object { $_.args[0] -eq "orchestration" -and $_.args[1] -eq "worker-start" })
    $fastEnters = @($fastCompletion.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "send" -and $_.args -contains "--enter" })
    Assert-Case "preflight accepts durable succeeded completion of its exact worker without requiring an intermediate working frame" ($fastCompletion.ExitCode -eq 0 -and $fastStarts.Count -eq 1 -and $fastEnters.Count -eq 1 -and $fastCompletion.Output -match 'PREFLIGHT implement codex PASS') $fastCompletion.Output
    foreach ($completionScenario in @("fast-completion-other-dispatch", "fast-completion-failed", "fast-completion-not-durable")) {
        $rejectedCompletion = Invoke-Scenario $completionScenario @()
        $rejectedStarts = @($rejectedCompletion.Calls | Where-Object { $_.args[0] -eq "orchestration" -and $_.args[1] -eq "worker-start" })
        $rejectedEnters = @($rejectedCompletion.Calls | Where-Object { $_.args[0] -eq "terminal" -and $_.args[1] -eq "send" -and $_.args -contains "--enter" })
        Assert-Case "$completionScenario is rejected without a second worker or prompt submission" ($rejectedCompletion.ExitCode -ne 0 -and $rejectedStarts.Count -eq 1 -and $rejectedEnters.Count -eq 1 -and $rejectedCompletion.Output -match 'no working Codex turn evidence') $rejectedCompletion.Output
    }
    Add-Content -LiteralPath (Join-Path $repo "spec.md") -Value "changed after review"
    $stale = Invoke-Scenario "stale" @()
    Assert-Case "a stale task assessment is refused before launch" ($stale.ExitCode -ne 0 -and -not (Has-Launch $stale) -and $stale.Output -match "stale") $stale.Output
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
