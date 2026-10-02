$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$dely = Join-Path $repo ".dely-poc\skills\delivery\scripts\dely.js"
if (-not (Test-Path $dely)) {
    throw "Run scripts\setup-poc.ps1 first."
}

$fakeOrca = Join-Path ([System.IO.Path]::GetTempPath()) ("dely-fake-orca-" + [guid]::NewGuid().ToString("N") + ".js")
$original = @{
    ORCA_CLI_COMMAND = $env:ORCA_CLI_COMMAND
    DELY_WAITER = $env:DELY_WAITER
    DELY_POLL_S = $env:DELY_POLL_S
    DELY_CONTROL_STEP_LIMIT = $env:DELY_CONTROL_STEP_LIMIT
    DELY_SAME_FAILURE_LIMIT = $env:DELY_SAME_FAILURE_LIMIT
    DELY_LOOP_GUARD_OVERRIDE = $env:DELY_LOOP_GUARD_OVERRIDE
}

function Get-GuardPath([string]$RunId) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($RunId)
        $hex = ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
        return Join-Path ([System.IO.Path]::GetTempPath()) ("dely-loop-guard-" + $hex.Substring(0, 24) + ".json")
    }
    finally {
        $sha.Dispose()
    }
}

function Invoke-Wait([string]$RunId) {
    $out = (& node $dely wait --run $RunId --control codex --timeout-min 0.0001 2>&1) | Out-String
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $out.Trim() }
}

$runFailure = "guard-repeat-" + [guid]::NewGuid().ToString("N")
$runBudget = "guard-budget-" + [guid]::NewGuid().ToString("N")

try {
    [System.IO.File]::WriteAllText(
        $fakeOrca,
        'process.stdout.write(JSON.stringify({ok:true,result:{workers:[]}}));',
        [System.Text.UTF8Encoding]::new($false)
    )

    $env:ORCA_CLI_COMMAND = $fakeOrca
    $env:DELY_WAITER = "1"
    $env:DELY_POLL_S = "0.01"
    $env:DELY_CONTROL_STEP_LIMIT = "12"
    $env:DELY_SAME_FAILURE_LIMIT = "2"
    Remove-Item Env:DELY_LOOP_GUARD_OVERRIDE -ErrorAction SilentlyContinue

    $first = Invoke-Wait $runFailure
    $second = Invoke-Wait $runFailure
    $third = Invoke-Wait $runFailure

    if ($first.ExitCode -ne 7 -or $second.ExitCode -ne 7) {
        throw "Repeated-failure setup did not produce two DEADLINE results."
    }
    if ($third.ExitCode -ne 10 -or $third.Output -notmatch "LOOP_GUARD wait returned the same failure 2 times") {
        throw "Repeated-failure guard did not stop the third attempt."
    }

    $env:DELY_CONTROL_STEP_LIMIT = "1"
    $env:DELY_SAME_FAILURE_LIMIT = "99"

    $budgetFirst = Invoke-Wait $runBudget
    $budgetSecond = Invoke-Wait $runBudget
    if ($budgetFirst.ExitCode -ne 7) {
        throw "Step-budget setup did not produce DEADLINE."
    }
    if ($budgetSecond.ExitCode -ne 10 -or $budgetSecond.Output -notmatch "LOOP_GUARD control step budget 1 exhausted") {
        throw "Step-budget guard did not stop the second attempt."
    }

    $env:DELY_LOOP_GUARD_OVERRIDE = "1"
    $override = Invoke-Wait $runBudget
    if ($override.ExitCode -ne 7 -or $override.Output -notmatch "DEADLINE") {
        throw "Explicit loop-guard override did not permit one retry."
    }

    Write-Host "LOOP GUARD PASS"
}
finally {
    foreach ($key in $original.Keys) {
        [Environment]::SetEnvironmentVariable($key, $original[$key], "Process")
    }
    Remove-Item $fakeOrca -Force -ErrorAction SilentlyContinue
    Remove-Item (Get-GuardPath $runFailure), (Get-GuardPath $runBudget) -Force -ErrorAction SilentlyContinue
}
