$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:ORCA_TERMINAL_HANDLE)) {
    throw "Run this script inside a live Orca Control terminal."
}

$repo = Split-Path -Parent $PSScriptRoot
$dely = Join-Path $repo ".dely-poc\skills\delivery\scripts\dely.js"

if (-not (Test-Path $dely)) {
    throw "Run scripts\setup-poc.ps1 first."
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

$runRaw = (& orca orchestration run-create --objective "POC Dely to Antigravity preflight" --json) | Out-String
$runResult = $runRaw | ConvertFrom-Json
if (-not $runResult.ok) { throw $runRaw }

$runId = $runResult.result.run.id
Write-Host "Run: $runId"

$env:DELY_POLL_S = "1"
$env:DELY_PREFLIGHT_S = "60"

$exitCode = 1
try {
    $process = Start-Process -FilePath "node.exe" -ArgumentList @($dely, "preflight", "--repo", $repo, "--run", $runId) -NoNewWindow -Wait -PassThru
    $exitCode = $process.ExitCode
}
finally {
    Close-AgyRunTerminals $runId
}

exit $exitCode
