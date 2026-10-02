$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:ORCA_TERMINAL_HANDLE)) {
    throw "Run this script inside a live Orca Control terminal."
}

$repo = Split-Path -Parent $PSScriptRoot
$dely = Join-Path $repo ".dely-poc\skills\delivery\scripts\dely.js"
$marker = Join-Path $repo "poc\worker-output.txt"

if (-not (Test-Path $dely)) {
    throw "Run scripts\setup-poc.ps1 first."
}

function Invoke-Dely([string[]]$Arguments) {
    $stdout = [System.IO.Path]::GetTempFileName()
    $stderr = [System.IO.Path]::GetTempFileName()
    try {
        $allArgs = @($dely) + $Arguments
        $process = Start-Process -FilePath "node.exe" -ArgumentList $allArgs -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $outText = [System.IO.File]::ReadAllText($stdout)
        $errText = [System.IO.File]::ReadAllText($stderr)
        if (-not [string]::IsNullOrWhiteSpace($outText)) { Write-Host $outText.TrimEnd() }
        if (-not [string]::IsNullOrWhiteSpace($errText)) { Write-Host $errText.TrimEnd() }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = ($outText + $errText).Trim() }
    }
    finally {
        Remove-Item $stdout, $stderr -Force -ErrorAction SilentlyContinue
    }
}

function Close-AgyRunTerminals([string]$RunId) {
    $state = Join-Path ([System.IO.Path]::GetTempPath()) "dely-agy-$RunId.jsonl"
    if (-not (Test-Path $state)) { return }

    foreach ($line in [System.IO.File]::ReadLines($state, [System.Text.Encoding]::UTF8)) {
        try {
            $record = $line | ConvertFrom-Json
            $handle = $record.terminalHandle
            $owned = if ($null -eq $record.owned) { $true } else { [bool]$record.owned }
            if ($handle -and $owned) {
                & orca terminal close --terminal $handle --json | Out-Null
            }
        }
        catch {}
    }
    Remove-Item $state -Force -ErrorAction SilentlyContinue
}

Set-Location $repo

$runRaw = (& orca orchestration run-create --objective "POC Codex Control -> Dely -> Orca -> Antigravity CLI" --json) | Out-String
$runResult = $runRaw | ConvertFrom-Json
if (-not $runResult.ok) { throw $runRaw }

$runId = $runResult.result.run.id
Write-Host "Run: $runId"

$env:DELY_POLL_S = "1"
$env:DELY_PREFLIGHT_S = "60"
$env:DELY_ACK_S = "60"

$dispatchId = $null
try {
    $preflight = Invoke-Dely @("preflight", "--repo", $repo, "--run", $runId)
    if ($preflight.ExitCode -ne 0) { exit $preflight.ExitCode }
    Close-AgyRunTerminals $runId

    if (Test-Path $marker) { Remove-Item $marker }

    $dispatch = Invoke-Dely @("dispatch", "--repo", $repo, "--run", $runId, "--phase", "implement", "--spec-file", "poc/agy-worker-spec.md")
    if ($dispatch.ExitCode -ne 0) { exit $dispatch.ExitCode }

    $dispatchMatch = [regex]::Match($dispatch.Output, "(?m)^DISPATCHED (ctx_[A-Za-z0-9]+)$")
    if (-not $dispatchMatch.Success) { throw "Dely did not return a dispatch id." }
    $dispatchId = $dispatchMatch.Groups[1].Value

    $env:DELY_WAITER = "1"
    $wait = Invoke-Dely @("wait", "--run", $runId, "--control", "codex", "--stall-min", "1", "--timeout-min", "2")
    if ($wait.ExitCode -ne 0) { exit $wait.ExitCode }

    $settledLine = ($wait.Output -split "[\r\n]+" | Where-Object { $_ -match '^\{"SETTLED":' } | Select-Object -Last 1)
    if (-not $settledLine) { throw "Dely wait did not return SETTLED." }
    $settled = $settledLine | ConvertFrom-Json

    & orca orchestration check --run $runId --ack $settled.SETTLED --json | Out-Null
    & orca orchestration worker-release --dispatch $dispatchId --json | Out-Null

    if (-not (Test-Path $marker)) { throw "Antigravity worker did not create poc\worker-output.txt." }

    $content = [System.IO.File]::ReadAllText($marker)
    $lf = "AGY_WORKER_OK" + [char]10
    $crlf = "AGY_WORKER_OK" + [char]13 + [char]10
    if ($content -ne $lf -and $content -ne $crlf) { throw "Unexpected marker content: $content" }

    Write-Host "POC PASS: Dely -> Orca -> Antigravity CLI produced AGY_WORKER_OK"
}
finally {
    Close-AgyRunTerminals $runId
    Remove-Item $marker -Force -ErrorAction SilentlyContinue
}
