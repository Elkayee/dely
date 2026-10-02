$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$patch = Join-Path $repo "patches\dely-agy.patch"
$codexHome = Join-Path $HOME ".codex"
$globalRoot = Join-Path $codexHome "dely-orca-agy-global"
$globalAgents = Join-Path $codexHome "AGENTS.md"
$utf8Strict = [System.Text.UTF8Encoding]::new($false, $true)
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

if (Test-Path $globalRoot) {
    Remove-Item $globalRoot -Recurse -Force
}

git clone --depth 1 https://github.com/hieuphung97/dely.git $globalRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

git -C $globalRoot apply $patch
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$marketplaceFile = Join-Path $globalRoot ".claude-plugin\marketplace.json"
$marketplace = [System.IO.File]::ReadAllText($marketplaceFile, $utf8Strict)
$marketplace = $marketplace.Replace('"name": "dely-orca-agy-poc"', '"name": "dely-orca-agy-global"')
[System.IO.File]::WriteAllText($marketplaceFile, $marketplace, $utf8NoBom)

$delyScript = Join-Path $globalRoot "skills\delivery\scripts\dely.js"
$delyWindowsLauncher = Join-Path $globalRoot "skills\delivery\scripts\dely.cmd"
$launcherText = '@echo off' + [Environment]::NewLine + 'node "%~dp0dely.js" %*' + [Environment]::NewLine
[System.IO.File]::WriteAllText($delyWindowsLauncher, $launcherText, $utf8NoBom)
if (-not (Test-Path $delyWindowsLauncher)) {
    throw "Global Dely copy does not contain the Windows launcher."
}
if (-not (Select-String -Path $delyScript -Pattern 'p.agent === "antigravity"' -Quiet)) {
    throw "Global Dely copy does not contain the Antigravity adapter."
}
if (-not (Select-String -Path $delyScript -Pattern 'os.homedir\(\).*\.codex.*AGENTS.md' -Quiet)) {
    throw "Global Dely copy does not contain global AGENTS fallback."
}
if (-not (Select-String -Path $delyScript -Pattern 'orca\(\["repo", "add", "--path", repo\]\)' -Quiet)) {
    throw "Global Dely copy does not auto-register new workspaces in Orca."
}
if (-not (Select-String -Path $delyScript -Pattern 'workspace trust required' -Quiet)) {
    throw "Global Dely copy does not surface AGY workspace trust safely."
}
if (-not (Select-String -Path $delyScript -Pattern 'stableIdentity' -Quiet)) {
    throw "Global Dely copy does not require stable AGY identity before dispatch."
}
if (-not (Select-String -Path $delyScript -Pattern 't\.agentIdentity === "antigravity"' -Quiet)) {
    throw "Global Dely copy does not require Orca Antigravity identity before dispatch."
}
if (-not (Select-String -Path $delyScript -Pattern '"--inject"' -Quiet)) {
    throw "Global Dely copy does not use Orca injected dispatch after AGY readiness."
}
if (-not (Select-String -Path $delyScript -Pattern 'DELY_CONTROL_STEP_LIMIT' -Quiet)) {
    throw "Global Dely copy does not contain the control step budget."
}
if (-not (Select-String -Path $delyScript -Pattern 'DELY_SAME_FAILURE_LIMIT' -Quiet)) {
    throw "Global Dely copy does not contain the repeated-failure guard."
}
if (-not (Select-String -Path $delyScript -Pattern 'LOOP_GUARD' -Quiet)) {
    throw "Global Dely copy does not contain the runaway-loop hard stop."
}
if (-not (Select-String -Path $delyScript -Pattern 'AGY dispatch is implement-only' -Quiet)) {
    throw "Global Dely copy does not enforce Codex-owned review."
}
if (-not (Select-String -Path $delyScript -Pattern 'function cleanup\(f\)' -Quiet)) {
    throw "Global Dely copy does not contain Run-owned AGY cleanup."
}
if (-not (Select-String -Path $delyScript -Pattern 'path\.join\(process\.cwd\(\), "\.tmp-dely"\)' -Quiet)) {
    throw "Global Dely copy does not contain Run-scoped temp artifact cleanup."
}
if (Select-String -Path $delyScript -Pattern 'trustedNow' -Quiet) {
    throw "Global Dely copy must not auto-confirm workspace trust."
}

$managed = @'
<!-- dely-global:begin -->
## Dely Global Defaults

Default delivery routing for all workspaces. A project-level Dely table overrides these defaults.

| Phase | Harness | Model | Effort |
| --- | --- | --- | --- |
| `implement` | Antigravity CLI | default | default |

Review is performed directly by Codex Control. Never dispatch review work to AGY.

### Bounded Control

- Treat `LOOP_GUARD` as a hard stop and report the current result instead of retrying autonomously.
- The Dely control loop is limited to 12 tracked invocations before settlement; the same failing command may fail twice, then the next retry must stop.
- Bound diagnostic file/log reads to 4,000 characters and searches to 50 hits. Exclude `.git`, `node_modules`, `venv`, `artifacts`, and generated POC/temp trees unless the task targets them.
- Prefer one bounded search over opening files one by one. Narrow the path and query before expanding scope.
- Use `DELY_LOOP_GUARD_OVERRIDE=1` only for one intentional retry after explicit user direction.
<!-- dely-global:end -->
'@

if (Test-Path $globalAgents) {
    $globalAgentsInfo = Get-Item $globalAgents
    if ($globalAgentsInfo.Length -gt 1MB) {
        throw "Refusing to rewrite oversized global AGENTS.md ($($globalAgentsInfo.Length) bytes). Repair it first."
    }
    $current = [System.IO.File]::ReadAllText($globalAgents, $utf8Strict)
} else {
    $current = ""
}
$pattern = '(?s)<!-- dely-global:begin -->.*?<!-- dely-global:end -->'
if ($current -match $pattern) {
    $updated = [regex]::Replace($current, $pattern, $managed)
} else {
    $sep = if ([string]::IsNullOrWhiteSpace($current)) { "" } else { [Environment]::NewLine + [Environment]::NewLine }
    $updated = $current.TrimEnd() + $sep + $managed + [Environment]::NewLine
}
[System.IO.File]::WriteAllText($globalAgents, $updated, $utf8NoBom)

codex plugin marketplace add $globalRoot --json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

codex plugin add dely@dely-orca-agy-global --json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

cmd.exe /d /c "codex plugin remove dely@dely-orca-agy-poc --json >nul 2>nul" | Out-Null
cmd.exe /d /c "codex plugin remove dely@dely --json >nul 2>nul" | Out-Null
cmd.exe /d /c "codex plugin marketplace remove dely-orca-agy-poc --json >nul 2>nul" | Out-Null

Write-Host "GLOBAL DELY OK"
Write-Host "Adapter: $globalRoot"
Write-Host "Defaults: $globalAgents"
Write-Host "Plugin: dely@dely-orca-agy-global"
