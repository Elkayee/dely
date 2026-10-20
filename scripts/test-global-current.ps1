$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:ORCA_TERMINAL_HANDLE)) {
    throw "Run inside a live Orca Control terminal."
}

$repo = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $HOME ".codex\dely-compliance\settings.json"
$dely = (Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json).dely

if (-not (Test-Path $dely)) {
    throw "Global Dely adapter is missing."
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

$runRaw = (& orca orchestration run-create --objective "Global Dely current-workspace smoke test" --json) | Out-String
$run = $runRaw | ConvertFrom-Json
if (-not $run.ok) { throw $runRaw }

$runId = $run.result.run.id
Write-Host "Run: $runId"
Write-Host "Helper: $dely"

$env:DELY_POLL_S = "1"
$env:DELY_PREFLIGHT_S = "60"

$exitCode = 1
try {
    $process = Start-Process -FilePath "node.exe" -ArgumentList @($dely, "preflight", "--repo", $repo, "--run", $runId) -NoNewWindow -Wait -PassThru
    $exitCode = $process.ExitCode
    if ($exitCode -eq 0) {
        Write-Host "GLOBAL CURRENT PASS"
    }
}
finally {
    Close-AgyRunTerminals $runId
}

exit $exitCode
