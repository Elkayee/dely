$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:ORCA_TERMINAL_HANDLE)) {
    throw "Run inside a live Orca Control terminal."
}

$repo = Split-Path -Parent $PSScriptRoot
$workspace = Join-Path $repo ".tmp-dely\global-smoke"
$settingsPath = Join-Path $HOME ".codex\dely-compliance\settings.json"
$dely = (Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json).dely

if (Test-Path $workspace) {
    git -C $repo worktree remove --force $workspace 2>$null
    if (Test-Path $workspace) {
        Remove-Item $workspace -Recurse -Force
    }
}

New-Item -ItemType Directory -Path (Split-Path -Parent $workspace) -Force | Out-Null
git -C $repo worktree add --detach $workspace HEAD
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (Test-Path (Join-Path $workspace "AGENTS.md")) {
    throw "Smoke workspace must not have AGENTS.md."
}
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

$runRaw = (& orca orchestration run-create --objective "Global Dely fallback smoke test" --json) | Out-String
$run = $runRaw | ConvertFrom-Json
if (-not $run.ok) { throw $runRaw }

$runId = $run.result.run.id
Write-Host "Run: $runId"
Write-Host "Workspace: $workspace"
Write-Host "Project AGENTS: absent"

$env:DELY_POLL_S = "1"
$env:DELY_PREFLIGHT_S = "60"

$exitCode = 1
try {
    $process = Start-Process -FilePath "node.exe" -ArgumentList @($dely, "preflight", "--repo", $workspace, "--run", $runId) -NoNewWindow -Wait -PassThru
    $exitCode = $process.ExitCode
    if ($exitCode -eq 0) {
        Write-Host "GLOBAL FALLBACK PASS"
    }
}
finally {
    Close-AgyRunTerminals $runId
    git -C $repo worktree remove --force $workspace 2>$null
    git -C $repo worktree prune
}

exit $exitCode
