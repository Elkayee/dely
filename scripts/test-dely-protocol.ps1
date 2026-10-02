$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$dely = Join-Path $repo ".dely-poc\skills\delivery\scripts\dely.js"
if (-not (Test-Path $dely)) {
    throw "Run scripts\setup-poc.ps1 first."
}
Set-Location $repo

$launcher = Join-Path $repo ".dely-poc\skills\delivery\scripts\dely.cmd"
$launcherOut = (& $launcher 2>&1) | Out-String
if ($LASTEXITCODE -ne 0 -or $launcherOut -notmatch "dely cleanup --run RUN") {
    throw "Windows Dely launcher did not execute the helper usage successfully."
}

$fakeOrca = Join-Path ([System.IO.Path]::GetTempPath()) ("dely-protocol-orca-" + [guid]::NewGuid().ToString("N") + ".js")
$fakeLog = Join-Path ([System.IO.Path]::GetTempPath()) ("dely-protocol-log-" + [guid]::NewGuid().ToString("N") + ".jsonl")
$spec = Join-Path $repo ".tmp-dely\protocol-implement-spec.md"
$runImplement = "protocol-implement-" + [guid]::NewGuid().ToString("N")
$runReviewReject = "protocol-review-reject-" + [guid]::NewGuid().ToString("N")
$runCleanup = "protocol-cleanup-" + [guid]::NewGuid().ToString("N")
$cleanupState = Join-Path ([System.IO.Path]::GetTempPath()) ("dely-agy-" + $runCleanup + ".jsonl")
$originalOrca = $env:ORCA_CLI_COMMAND
$originalLog = $env:DELY_FAKE_LOG
$originalPoll = $env:DELY_POLL_S

try {
    New-Item (Split-Path -Parent $spec) -ItemType Directory -Force | Out-Null
    [System.IO.File]::WriteAllText($spec, "Implementation protocol test.", [System.Text.UTF8Encoding]::new($false))

    $fake = @'
const fs = require("fs");
const args = process.argv.slice(2).filter((x) => x !== "--json");
fs.appendFileSync(process.env.DELY_FAKE_LOG, JSON.stringify(args) + "\n");
let result = {};
if (args[0] === "terminal" && args[1] === "create") {
  result.terminal = { handle: "term_fake" };
} else if (args[0] === "terminal" && args[1] === "list") {
  result.terminals = [{
    handle: "term_existing",
    agentIdentity: "antigravity",
    connected: true,
    writable: true,
    preview: "idle and ready for new instructions",
    lastOutputAt: 1
  }];
} else if (args[0] === "terminal" && args[1] === "show") {
  result.terminal = { handle: args[3], agentIdentity: "antigravity", connected: true, writable: true };
} else if (args[0] === "terminal" && args[1] === "wait") {
  result.wait = { handle: args[3], condition: "tui-idle", satisfied: true, status: "running" };
} else if (args[0] === "orchestration" && args[1] === "task-create") {
  result.task = { id: "task_fake" };
} else if (args[0] === "orchestration" && args[1] === "dispatch") {
  result.dispatch = { id: "ctx_fake" };
} else if (args[0] === "orchestration" && args[1] === "check" && args.includes("--peek")) {
  result.messages = [{ subject: "ack", dispatchId: "ctx_fake" }];
} else if (args[0] === "orchestration" && args[1] === "worker-list") {
  result.workers = [];
}
process.stdout.write(JSON.stringify({ ok: true, result }));
'@
    [System.IO.File]::WriteAllText($fakeOrca, $fake, [System.Text.UTF8Encoding]::new($false))

    $env:ORCA_CLI_COMMAND = $fakeOrca
    $env:DELY_FAKE_LOG = $fakeLog
    $env:DELY_POLL_S = "0.01"

    $dispatchOut = (& node $dely dispatch --repo $repo --run $runImplement --phase implement --spec-file ".tmp-dely/protocol-implement-spec.md" 2>&1) | Out-String
    if ($LASTEXITCODE -ne 0 -or $dispatchOut -notmatch "DISPATCHED ctx_fake") {
        throw "Implementation dispatch protocol test did not dispatch."
    }

    $fakeCalls = Get-Content $fakeLog | ForEach-Object { $_ | ConvertFrom-Json }
    $terminalCreates = @($fakeCalls | Where-Object { $_[0] -eq "terminal" -and $_[1] -eq "create" })
    $terminalLists = @($fakeCalls | Where-Object { $_[0] -eq "terminal" -and $_[1] -eq "list" })
    if ($terminalCreates.Count -ne 1 -or $terminalLists.Count -ne 0) {
        throw "Implementation dispatch must create a fresh AGY terminal and must not search for a reusable terminal."
    }

    $taskCreate = $fakeCalls |
        Where-Object { $_[0] -eq "orchestration" -and $_[1] -eq "task-create" } |
        Select-Object -Last 1
    if ($null -eq $taskCreate) {
        throw "Fake Orca did not receive task-create."
    }
    $specIndex = [Array]::IndexOf([object[]]$taskCreate, "--spec")
    if ($specIndex -lt 0) {
        throw "Implementation dispatch did not send a spec."
    }
    $workerSpec = [string]$taskCreate[$specIndex + 1]
    if ($workerSpec -match "DISPOSITION:") {
        throw "AGY implementation spec must not contain a review disposition contract."
    }

    $reviewOut = (& node $dely dispatch --repo $repo --run $runReviewReject --phase review --spec-file ".tmp-dely/protocol-implement-spec.md" 2>&1) | Out-String
    if ($LASTEXITCODE -ne 2 -or $reviewOut -notmatch "AGY dispatch is implement-only; review is owned by Codex Control") {
        throw "Review dispatch was not rejected as Codex-owned."
    }

    $cleanupLines = @(
        '{"dispatchId":"ctx_a","terminalHandle":"term_owned_a","owned":true}',
        '{"dispatchId":"ctx_b","terminalHandle":"term_reused","owned":false}',
        '{"dispatchId":"ctx_c","terminalHandle":"term_owned_c","owned":true}',
        '{"dispatchId":"ctx_d","terminalHandle":"term_owned_a","owned":true}'
    )
    [System.IO.File]::WriteAllLines($cleanupState, $cleanupLines, [System.Text.UTF8Encoding]::new($false))

    $cleanupTempDir = Join-Path $repo ".tmp-dely"
    New-Item $cleanupTempDir -ItemType Directory -Force | Out-Null
    $runArtifactA = Join-Path $cleanupTempDir ($runCleanup + "-prompt.txt")
    $runArtifactB = Join-Path $cleanupTempDir ($runCleanup + "-wait.json")
    $unrelatedArtifact = Join-Path $cleanupTempDir "unrelated.txt"
    [System.IO.File]::WriteAllText($runArtifactA, "a", [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($runArtifactB, "b", [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($unrelatedArtifact, "keep", [System.Text.UTF8Encoding]::new($false))

    Clear-Content $fakeLog
    $cleanupOut = (& node $dely cleanup --run $runCleanup 2>&1) | Out-String
    if ($LASTEXITCODE -ne 0 -or $cleanupOut -notmatch "CLEANED 2 terminals 2 artifacts") {
        throw "Cleanup did not close exactly two unique owned terminals and delete two Run artifacts."
    }
    if (Test-Path $cleanupState) {
        throw "Cleanup state file was not removed."
    }
    if ((Test-Path $runArtifactA) -or (Test-Path $runArtifactB)) {
        throw "Cleanup left Run-owned .tmp-dely artifacts behind."
    }
    if (-not (Test-Path $unrelatedArtifact)) {
        throw "Cleanup removed an unrelated .tmp-dely artifact."
    }

    $closed = Get-Content $fakeLog | ForEach-Object { $_ | ConvertFrom-Json } |
        Where-Object { $_[0] -eq "terminal" -and $_[1] -eq "close" } |
        ForEach-Object { $_[3] }
    if (($closed | Sort-Object) -join "," -ne "term_owned_a,term_owned_c") {
        throw "Cleanup closed unexpected terminals: $($closed -join ',')"
    }

    Write-Host "DELY PROTOCOL PASS"
}
finally {
    $env:ORCA_CLI_COMMAND = $originalOrca
    $env:DELY_FAKE_LOG = $originalLog
    $env:DELY_POLL_S = $originalPoll
    Remove-Item $fakeOrca, $fakeLog, $spec, $cleanupState -Force -ErrorAction SilentlyContinue
}
