param(
    [ValidateSet("sync", "plan", "check", "apply", "update")]
    [string]$Action = "sync",
    [string]$ExpectedSha
)

$ErrorActionPreference = "Stop"
$nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction Stop
$updaterPath = Join-Path $PSScriptRoot "sync-dely.js"
$nodeArgs = @($updaterPath, $Action)
if ($ExpectedSha) { $nodeArgs += @("--expected-sha", $ExpectedSha) }
& $nodeCommand.Source @nodeArgs
exit $LASTEXITCODE
