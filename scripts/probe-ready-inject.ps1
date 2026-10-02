$ErrorActionPreference = "Stop"
$target = "term_14475745-d9c6-42dd-839e-56664ec7456b"
$runRaw = (& orca orchestration run-create --objective "AGY ready inject probe" --json) | Out-String
$run = $runRaw | ConvertFrom-Json
if (-not $run.ok) { throw $runRaw }
$runId = $run.result.run.id
Write-Host "RUN=$runId"
$taskRaw = (& orca orchestration task-create --spec "Read-only probe. Send heartbeat ack, then worker_done succeeded with subject ready-inject-ok. Do not modify files." --task-title "ready inject probe" --run $runId --json) | Out-String
$task = $taskRaw | ConvertFrom-Json
if (-not $task.ok) { throw $taskRaw }
$taskId = $task.result.task.id
Write-Host "TASK=$taskId"
$dispatchRaw = (& orca orchestration dispatch --task $taskId --to $target --run $runId --inject --return-preamble --json) | Out-String
Write-Host $dispatchRaw.Trim()
