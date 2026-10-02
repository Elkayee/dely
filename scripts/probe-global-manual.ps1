$ErrorActionPreference = "Stop"

$workspace = Join-Path $env:TEMP "dely-global-manual-v6"
if (Test-Path $workspace) { Remove-Item $workspace -Recurse -Force }
New-Item -ItemType Directory -Path $workspace | Out-Null
git -C $workspace init -q

$repoRaw = (& orca repo add --path $workspace --json) | Out-String
$repo = $repoRaw | ConvertFrom-Json
if (-not $repo.ok) { throw $repoRaw }

$runRaw = (& orca orchestration run-create --objective "Global manual dispatch probe" --json) | Out-String
$run = $runRaw | ConvertFrom-Json
if (-not $run.ok) { throw $runRaw }
$runId = $run.result.run.id
Write-Host "RUN=$runId"

$termRaw = (& orca terminal create --worktree "path:$workspace" --shell cmd.exe --command "agy --dangerously-skip-permissions" --title "AGY global manual v6" --json) | Out-String
$term = $termRaw | ConvertFrom-Json
if (-not $term.ok) { throw $termRaw }
$handle = $term.result.terminal.handle
Write-Host "TERMINAL=$handle"

$trusted = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $showRaw = (& orca terminal show --terminal $handle --json) | Out-String
    $show = $showRaw | ConvertFrom-Json
    $preview = "$($show.result.terminal.preview)"
    if ($preview -match "Antigravity CLI requires permission" -and $preview -match "Yes, I trust this folder") {
        & orca terminal send --terminal $handle --enter --json | Out-Null
        $trusted = $true
        continue
    }
    if ($preview -match "Antigravity CLI" -and $preview -notmatch "requires permission") {
        break
    }
}
Write-Host "TRUST_PROMPT_HANDLED=$trusted"

$idleRaw = (& orca terminal wait --terminal $handle --for tui-idle --timeout-ms 30000 --json) | Out-String
Write-Host "IDLE=$($idleRaw.Trim())"

$taskRaw = (& orca orchestration task-create --spec "Read-only probe. First send heartbeat ack, then worker_done succeeded with subject global manual ok." --task-title "global-manual-v6" --run $runId --json) | Out-String
$task = $taskRaw | ConvertFrom-Json
if (-not $task.ok) { throw $taskRaw }
$taskId = $task.result.task.id

$dispatchRaw = (& orca orchestration dispatch --task $taskId --to $handle --run $runId --return-preamble --json) | Out-String
Write-Host "DISPATCH=$($dispatchRaw.Trim())"
$dispatch = $dispatchRaw | ConvertFrom-Json
if (-not $dispatch.ok) { throw $dispatchRaw }
$dispatchId = $dispatch.result.dispatch.id
$preamble = $dispatch.result.preamble
if (-not $dispatchId -or [string]::IsNullOrWhiteSpace($preamble)) { throw "Missing dispatch/preamble" }

$sendRaw = (& orca terminal send --terminal $handle --text $preamble --enter --wait-submit 15 --json) | Out-String
Write-Host "SEND=$($sendRaw.Trim())"

Start-Sleep -Seconds 12
$workerRaw = (& orca orchestration worker-list --run $runId --json) | Out-String
Write-Host "WORKERS=$($workerRaw.Trim())"
$checkRaw = (& orca orchestration check --run $runId --peek --json) | Out-String
Write-Host "CHECK=$($checkRaw.Trim())"

& orca terminal close --terminal $handle --json | Out-Null
Remove-Item $workspace -Recurse -Force -ErrorAction SilentlyContinue
