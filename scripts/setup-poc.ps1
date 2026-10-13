$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$dely = Join-Path $repo ".dely-poc"
$patch = Join-Path $repo "patches\dely-agy.patch"

Set-Location $repo

if (Test-Path $dely) {
    throw "Existing POC preserved. Update its task-owned files rather than deleting or recloning it."
}

git clone --no-checkout --config core.autocrlf=false --depth 1 https://github.com/hieuphung97/dely.git $dely
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git -C $dely fetch --depth 1 origin ce7a29cc0edb351c256162e8f5076f42ba69234f
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git -C $dely checkout --detach ce7a29cc0edb351c256162e8f5076f42ba69234f
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

git -C $dely apply $patch
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$delyScript = Join-Path $dely "skills\delivery\scripts\dely.js"
$delyWindowsLauncher = Join-Path $dely "skills\delivery\scripts\dely.cmd"
$launcherText = '@echo off' + [Environment]::NewLine + 'node "%~dp0dely.js" %*' + [Environment]::NewLine
[System.IO.File]::WriteAllText($delyWindowsLauncher, $launcherText, [System.Text.UTF8Encoding]::new($false))
if (-not (Test-Path $delyWindowsLauncher)) {
    throw "Local Dely snapshot does not contain the Windows launcher."
}
if (-not (Select-String -Path $delyScript -Pattern 'p.agent === "antigravity"' -Quiet)) {
    throw "Local Dely snapshot does not contain the Antigravity injected-dispatch adapter."
}
if (-not (Select-String -Path $delyScript -Pattern 'LOOP_GUARD' -Quiet)) {
    throw "Local Dely snapshot does not contain the runaway-loop guard."
}
if (-not (Select-String -Path $delyScript -Pattern 'AGY dispatch is implement-only' -Quiet)) {
    throw "Local Dely snapshot does not enforce Codex-owned review."
}
if (-not (Select-String -Path $delyScript -Pattern 'function cleanup\(f\)' -Quiet)) {
    throw "Local Dely snapshot does not contain Run-owned AGY cleanup."
}
if (-not (Select-String -Path $delyScript -Pattern 'path\.join\(process\.cwd\(\), "\.tmp-dely"\)' -Quiet)) {
    throw "Local Dely snapshot does not contain Run-scoped temp artifact cleanup."
}

codex plugin marketplace add $dely --json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

codex plugin add dely@dely-orca-agy-poc --json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "POC setup OK: Codex Control + Dely + Orca + Antigravity CLI worker."
