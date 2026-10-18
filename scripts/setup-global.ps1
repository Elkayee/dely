$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$patch = Join-Path $repo "patches\dely-agy.patch"
$codexHome = Join-Path $HOME ".codex"
$globalRoot = Join-Path $codexHome "dely-orca-agy-global"
$globalAgents = Join-Path $codexHome "AGENTS.md"
$utf8Strict = [System.Text.UTF8Encoding]::new($false, $true)
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

if (Test-Path $globalRoot) {
    throw "Existing global install preserved. Update its task-owned files rather than deleting or recloning it."
}

git clone --no-checkout --config core.autocrlf=false --depth 1 https://github.com/hieuphung97/dely.git $globalRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git -C $globalRoot fetch --depth 1 origin ce7a29cc0edb351c256162e8f5076f42ba69234f
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git -C $globalRoot checkout --detach ce7a29cc0edb351c256162e8f5076f42ba69234f
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$patchForApply = Join-Path ([System.IO.Path]::GetTempPath()) ("dely-agy-" + [guid]::NewGuid().ToString("N") + ".patch")
$patchText = [System.IO.File]::ReadAllText($patch, $utf8Strict).Replace("`r`n", "`n")
[System.IO.File]::WriteAllText($patchForApply, $patchText, $utf8NoBom)
git -C $globalRoot apply $patchForApply
$patchApplyExitCode = $LASTEXITCODE
Remove-Item -LiteralPath $patchForApply -Force
if ($patchApplyExitCode -ne 0) { exit $patchApplyExitCode }

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
if (-not (Select-String -Path $delyScript -Pattern 'review is owned by Codex Control' -Quiet)) {
    throw "Global Dely copy does not enforce Codex-owned review."
}
if (-not (Select-String -Path $delyScript -Pattern 'function startCodexQuotaTerminal' -Quiet)) {
    throw "Global Dely copy does not contain the native Codex fallback terminal path."
}
if (-not (Select-String -Path $delyScript -Pattern 'unknown fallback reason' -Quiet)) {
    throw "Global Dely copy does not reject unknown fallback reasons."
}
if (-not (Select-String -Path $delyScript -Pattern 'fallback-stage' -Quiet)) {
    throw "Global Dely copy does not support ordered quota stages."
}
if (-not (Select-String -Path (Join-Path $globalRoot "skills\delivery\scripts\task-routing.js") -Pattern 'gemini-3\.8-flash-medium' -Quiet)) {
    throw "Global Dely copy does not pin the Flash Medium quota stage."
}
if (-not (Select-String -Path $delyScript -Pattern 'implement_backup_2' -Quiet)) {
    throw "Global Dely copy does not pin the final Luna backup."
}
if (-not (Select-String -Path $delyScript -Pattern 'model_reasoning_effort=' -Quiet)) {
    throw "Global Dely copy does not pin Codex reasoning effort in its native terminal command."
}
if (-not (Select-String -Path $delyScript -Pattern 'function observedTurn\(value\)' -Quiet)) {
    throw "Global Dely copy does not require an observed Codex turn start."
}
if (-not (Select-String -Path $delyScript -Pattern 'terminal.*send.*--enter' -Quiet)) {
    throw "Global Dely copy does not submit a visibly pasted Codex prompt."
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
| `implement` | Codex CLI | gpt-6.1-sol | medium |
| `implement_backup` | Antigravity CLI | gemini-3.8-flash-medium | default |
| `implement_backup_2` | Codex CLI | gpt-6-luna | max |

Review is performed directly by Codex Control. Never dispatch review work to AGY.
Assess before creating a Dely Run with the installed `skills/delivery/scripts/task-routing.js`, then record Codex Control review. Every dispatch requires `--assessment-file`; its spec/context hashes must still match.
Final Easy and Medium- (medium_minus) use AGY Gemini 3.8 Flash Medium/default and retain one explicit quota fallback to Codex Luna/max at stage 1. Final Medium+ (medium_plus) uses only Codex gpt-6.1-sol/medium with no fallback. Hard uses only direct Codex gpt-6.1-sol/xhigh without Dely or fallback.
Medium- is bounded internal work with known ownership, low coupling and focused acceptance. Medium+ coordinates known internal components and integrated acceptance. Consequential risk still selects Hard; old assessments must be rerun under the four-tier policy.
Prefer Dely for reversible bounded internal changes. Risk flags describe actual consequential effects, not task topics or repository names; record concrete evidence for each true flag. Documentation, tests, local parsing, internal refactors with known boundaries, and routine Dely/worktree coordination are not Hard merely by topic. Unknown effects stay NOT_EVALUATED.
The six Hard effects are changes to security authority/trust; destructive or sensitive data, persisted schema compatibility or business meaning; public interface compatibility; system boundaries or unresolved architecture; live production cutover; and delegation/admission/fallback authority or worker ownership. Ordinary reviewed dispatch is not a routing-policy change.
Policy jev-task-routing-v4 preserves Jev Max Rank. Candidate metadata alone keeps Sol. An eligible single verification/coordination correction needs optional --review-evidence-json, valid frozen proof and explicit Control review before becoming Medium-. Known Hard, raw Hard and unknown facts retain their vetoes. Normal review needs no proof.
Control considers each candidate using all five stored answers, the rubric and frozen snapshot, then records its reason. Retaining Medium+ without a correction proof is valid; missing correction proof is distinct from missing task evidence. Assess every slice independently; implementation, integration, domain, file count and leaf labels set no grade or worker. Evidence names the relevant location/contract, before/after behavior, affected consumers and failure detector, not necessarily a destructive command or an unwritten line number.
The implement row supplies Codex Sol/medium, implement_backup supplies Flash even as a primary, and implement_backup_2 supplies the single Luna fallback for final Easy/Medium-. Pass --assessment-file and --spec-file together on task preflight so it checks the reviewed primary.
Only explicit provider quota advances the selected chain after the prior attempt is inactive and released when required. Authentication, timeout, unknown errors, and the final stage do not advance.
A successful AGY model catalog proving the requested Easy/Medium- model absent selects Codex gpt-6-luna/max directly, skipping Flash. Final Medium+/Hard stop or wait for Sol instead. Discovery/auth/timeout errors and an unapplied live footer still stop. Model absence is not a quota stage.
Jev reads `TYPESAFE_API_KEY`; no confidence cutoff is assumed calibrated. Missing facts stay `NOT_EVALUATED`. If Jev is unavailable, Control may explicitly review complete source evidence while leaving Jev unevaluated; never automatically default to AGY.

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
