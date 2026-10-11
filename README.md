# dely

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg">
  <img src="assets/logo-light.svg" alt="dely" width="72" height="72">
</picture>

Ask for a change; Dely takes it through design approval, implementation,
independent review, and a pull request you merge.

https://github.com/user-attachments/assets/83ec539a-6551-4807-8517-0c73e5d171d7

[YouTube](https://www.youtube.com/watch?v=6pRWkhlQSAc)

## Contents

- [Quickstart](#quickstart)
- [How Dely works](#how-dely-works)
- [Choose a harness for each role](#choose-a-harness-for-each-role)
- [Install Orca](#install-orca)
- [Install Dely](#install-dely)
- [Configure a project](#configure-a-project)
- [Log](#log)
- [Troubleshooting](#troubleshooting)

## Quickstart

1. [Install Orca](#install-orca).
2. [Install Dely](#install-dely) in the harness you will talk to.
3. Open that harness in your project. Run `dely:setup` to choose which harness
   and model run each role, or use the project's existing pins. If no pin names
   a phase, it runs on Control's harness.
4. Ask for a change.

## How Dely works

You ask. Control designs. You approve. The implementer builds. The reviewer
checks. Control opens the pull request. You merge.

**Control** is the session you talk to. It writes the design, waits for your
approval, starts the other two sessions, and opens the pull request. Install
Dely here.

**Implementer** is a session Control starts to make the change.

**Reviewer** is a session Control starts to check the change independently
before the pull request. The implementer and the reviewer are the workers.

A Spike investigates only — no delivery run.

## Choose a harness for each role

Before the first delivery in a project, open each harness you chose there once
and answer its trust question. Setup opens them for you. OMP has no trust
question; Pi asks only when the project or a parent folder has `.pi/` or
`.agents/skills`.

✓ works · ⚠ works, read the note · ✗ not supported

| Harness | Control | Implementer | Reviewer | Watch out for |
| --- | --- | --- | --- | --- |
| Claude Code | ✓ | ✓ | ✓ | Put @AGENTS.md in CLAUDE.md. |
| Codex CLI | ⚠ | ✓ | ✓ | Use Codex CLI 0.159.2 or newer with Orca 1.4.217 or newer. As Control, it can start the next Dely step before the last one finishes. |
| Grok Build | ⚠ | ⚠ | ⚠ | Answer the trust question once in every project. As a worker, you cannot choose the model. As Control, a free account ran out of usage mid-delivery. |
| Antigravity CLI | ✓ | ⚠ | ⚠ | Choose the effort through the model name. Avoid gemini-3-flash-preview. As a worker, the first launch in a new folder can lose the task and show 'not signed in' while signed in; Dely retries once, then asks you to open agy there. |
| Kiro CLI | ✗ | ✗ | ✗ | Workers never start in Orca. |
| Cursor Agent CLI | ✓ | ✓ | ✓ | Choose the effort through the model name, for example cursor-grok-4.6-high. |
| GitHub Copilot CLI | ✓ | ⚠ | ⚠ | At the first launch, answer No, thanks to the app prompt; until then a launch can leave the task unsent. Answer the folder trust question once in every project and choose to remember the folder; Orca does not see it, so a missed one shows as NO_ACK. As a worker, you cannot choose the model. |
| OMP | ✓ | ⚠ | ⚠ | It never asks for trust, so use it only in repositories you trust. As a worker, use Orca 1.4.220 or newer, which does not show OMP's status (stablyai/orca#24436), so Dely reports a working OMP worker as needing attention. As a worker, to pin a model, install Dely in OMP, then check the model in OMP's session log. |
| Pi | ⚠ | ⚠ | ⚠ | As Control, run Dely's commands with no time limit, and release leftover workers. As a worker, to pin a model, install Dely in Pi, then check the model in Pi's session log. |

Other agents Orca can launch may work too;
[`harnesses.json`](harnesses.json) records what was measured.

## Install Orca

Orca runs each session and launches the workers.

1. Install the [desktop app](https://www.onorca.dev/docs/install).
2. Register the CLI: Settings → General → Orca CLI. See the
   [CLI overview](https://www.onorca.dev/docs/cli/overview).
3. Enable orchestration: Settings → Experimental. See
   [orchestration](https://www.onorca.dev/docs/cli/orchestration).
4. Check it:

```bash
orca open
orca status --json
orca orchestration run-list --json
```

On Linux, the binary is `orca-ide`.

## Install Dely

**Install Dely only in the harness you use as the Control session.** A harness
used only as implementer or reviewer needs Orca and its own login. Workers
read no Dely skill. **A pinned OMP or Pi worker also needs that harness's
Dely install below**, which loads `dely-pin.ts`.

Have Node 18 or newer on PATH. Open Control in your project and ask for a
change using `dely:delivery`. To choose the implementer and reviewer, run
`dely:setup` first; see [Configure a project](#configure-a-project). If no pin
names a phase, it runs on Control's harness with its default model and effort.
Use the invocation spelling listed below for your harness.

### Claude Code

```bash
claude plugin marketplace add https://github.com/hieuphung97/dely.git
claude plugin install dely@dely
claude plugin list                 # verify
claude plugin update dely          # update; restart to apply
claude plugin uninstall dely       # remove
```

Put `@AGENTS.md` in `CLAUDE.md` so Claude reads the routing line setup adds.
Invoke `/dely:delivery` or `/dely:setup`.

### Codex CLI

```bash
codex plugin marketplace add https://github.com/hieuphung97/dely.git
codex plugin add dely@dely
codex plugin list                  # verify
codex plugin marketplace upgrade   # update; open a new session
codex plugin remove dely@dely       # remove
```

If add keeps a stale marketplace, remove the marketplace and plugin, then add
again. Pin a tag or full commit SHA with
`codex plugin marketplace add --ref <ref> https://github.com/hieuphung97/dely.git`.
Do not use `codex plugin install`.
Invoke `$delivery (dely:delivery)` or `$setup (dely:setup)`.

### Cursor Agent CLI

```bash
cursor-agent plugin marketplace add https://github.com/hieuphung97/dely.git
cursor-agent plugin marketplace list          # verify marketplace
cursor-agent plugin marketplace update dely   # re-index only; does not fetch
cursor-agent plugin marketplace remove dely   # remove marketplace only
```

In a session, open `/plugin` → Marketplace → dely → Install for you.
To update, remove and re-add the marketplace, then uninstall and reinstall
Dely in `/plugin`. To remove Dely, use `/plugin` → Installed → dely → Uninstall.
Type `/dely` to find `/delivery` and `/setup`. Local snapshot installs are
unavailable; Cursor can read the Claude plugin cache.

### GitHub Copilot CLI

```bash
copilot plugin install https://github.com/hieuphung97/dely.git
copilot plugin install /path/to/dely       # local alternative
copilot skill list                        # verify delivery and setup
copilot plugin update dely                # update git or local install
copilot plugin uninstall dely             # remove
```

Invoke `/dely:delivery` or `/dely:setup`. Direct installs print a deprecation
warning. A same-named project or personal skill can hide the plugin skill.

### Antigravity CLI

```bash
agy plugin install https://github.com/hieuphung97/dely.git
agy plugin install /path/to/dely           # local alternative
agy plugin list                           # verify dely with skills
agy plugin install https://github.com/hieuphung97/dely.git   # update git install
agy plugin uninstall dely                 # remove
```

There is no plugin update subcommand. Re-run install with the same target to
update. Invoke `/dely:delivery` or `/dely:setup`.

### Grok Build

```bash
grok plugin install https://github.com/hieuphung97/dely.git --trust
grok plugin install /path/to/dely --trust  # local alternative
grok plugin details dely                  # verify
grok inspect                              # verify loaded delivery and setup
grok plugin update dely                   # update git install
grok plugin uninstall dely                # remove
```

For a local install, uninstall then install again; update does not re-copy.
Invoke `/delivery` or `/setup`. Grok also loads Claude Code plugins; its own
copy wins. To stop loading Dely completely, remove both copies if present.

### OMP

Use a dedicated clone or an unpacked snapshot; install links the source path.

```bash
git clone https://github.com/hieuphung97/dely.git
omp plugin install /path/to/dely
omp plugin list --json                    # verify dely-pin.ts
omp skill list --json                     # verify loaded skills
omp plugin uninstall dely                 # remove; needs bun on PATH
omp plugin disable dely                   # disable skills and extension
```

Update by pulling the dedicated clone, then opening a new OMP session.
Without bun, disable Dely; delete `~/.omp/plugins/node_modules/dely`, remove
the empty `node_modules` directory, and delete `.plugins.dely` from
`~/.omp/plugins/omp-plugins.lock.json`. Invoke `delivery` or `setup` without
namespacing. OMP has no workspace-trust gate; only use trusted repositories.

### Pi

```bash
pi install git:github.com/hieuphung97/dely@v<version>
pi install /path/to/dely                   # local alternative
pi list                                   # verify
pi --verbose                              # verify loaded paths at startup
pi remove git:github.com/hieuphung97/dely@v<version>
pi remove /path/to/dely                    # remove local install
```

Find `<version>` in [releases](https://github.com/hieuphung97/dely/releases).
Update by installing the new tag. At startup, check that Skills names
`delivery` and `setup`, and Extensions names `dely-pin.ts`.
Invoke `/skill:delivery` or `/skill:setup`. Check a pinned worker's model in
`~/.pi/agent/sessions/`.

Checked versions (observations, not minimums): Orca 1.4.218, 1.4.220 (OMP worker); Claude Code
2.1.286; Codex CLI 0.159.3; Cursor Agent CLI 2026.09.28-64d2043; Copilot CLI
1.0.89; Antigravity CLI 1.2.13 (install), 1.2.14 (worker, Control); Grok
Build 1.0.44; OMP 18.4.8 (Control), 18.6.1 (worker); Pi 0.99.1.

## Configure a project

Pins say which harness, model and effort run the implementer and the reviewer.
Run `dely:setup` in Control. It asks whether the choice is for the team or only
for you, then writes one of two files:

- `.dely/pins.json` holds team pins. Commit it.
- `.dely/local/pins.json` holds your own pins. It is never committed.

Both files look like this:

```json
{
  "implement": { "harness": "claude", "model": "default", "effort": "default" },
  "review": { "harness": "codex", "model": "default", "effort": "default" }
}
```

`harness` is an id from [`harnesses.json`](harnesses.json), such as `claude` or
`codex`, not the display name. Use `default` to leave the model or effort to
the harness. A file can name just one phase.

Dely picks a pin for each phase on its own. Your file wins, then the team file,
then Control's own harness with its defaults. If your file pins only
`review`, Dely uses the team's `implement` pin when there is one. Otherwise it
uses Control's harness and defaults.

In another worktree of the same clone, Dely looks for your file in that
worktree first, then in the main checkout.

`.dely/local/` has its own `.gitignore`, so nothing in it shows in `git status`.
`git clean -fdx` deletes it, personal pins included.

To see what is in use, ask Control to run `dely pins --repo <path>`. It prints
each phase's harness, model, effort and source (`local`, `team` or `control`).

### Upgrading from 0.23

Version 0.23 kept the pins in a `<!-- dely:begin -->` block in `AGENTS.md`.
Dely now stops while that block is there. Run `dely:setup`. It offers to move
the table to `.dely/pins.json` and leave one routing line in `AGENTS.md`.

## Log

`~/.dely/log.jsonl` is machine-local JSON Lines, one object per line. It
is off unless `~/.dely/` exists; `mkdir ~/.dely` turns it on, and Dely
never creates that directory. A missing directory means nothing is
written and nothing is created.

The file may contain sensitive content. It quotes worker screen output
in full, so it can hold repository contents, error text, and whatever a
harness printed.

## Troubleshooting

- **Worker stays at startup:** read its screen. Answer shell startup prompts
  such as an oh-my-zsh update, then retry.
- **Orca disconnects:** reopen Orca, check the commands under Install Orca,
  and inspect workers with `orca orchestration worker-list --run <run>`
  before retrying.
- **First launch stops at trust:** open that harness in the same path and
  answer its dialog, then retry. Copilot can report only `NO_ACK`, and its
  first launch also shows an app promo: answer No, thanks once;
  Antigravity can lose the prompt on a new path; retry once. Pi asks when
  the path or an ancestor has `.pi/` resources or `.agents/skills`.
- **Codex helper says "not inside an Orca terminal":** ask Control to look up
  its handle with `orca terminal list --worktree active --json` only when
  that worktree has one agent terminal, then prefix helper and `orca` commands
  with `ORCA_TERMINAL_HANDLE=<handle>`. Otherwise, use another Control harness.
  Never use another pane's handle.
- **Old behavior after update:** open a new Control session. Ask Control to run
  its `scripts/dely` with no arguments to identify the running copy. Compare
  `skills/delivery/SKILL.md` by SHA-256 at every skill location, including
  `~/.agents/skills`, project and personal skills, plugin caches and
  marketplace sources; update or remove mismatched copies.
  Codex personal skills can shadow plugins; Cursor copies can override the
  Claude cache; Copilot project and personal skills can hide its plugin.

[Workflow contract](skills/delivery/SKILL.md) ·
[Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md) ·
[Security](SECURITY.md) · [Decisions](docs/decisions.md) · [MIT](LICENSE)

---

The following Orca POC notes describe the local adapter and installed environment before this upstream merge.

## Dely + Orca POC

### Agent advice in this checkout

`scripts/jev_agent.js` reuses task difficulty assessment and adds context
ranking and skill suggestions. Use `--repo` to select the target workspace;
relative inputs and outputs resolve there. The skill roster comes from the
agent's current session catalog and is supplied as JSON; the CLI does not
scan directories or load skills.

See [the agent advice guide](docs/agent-advice.md) for all three commands,
provenance handling and error states. Run
`node --test scripts/test-jev-agent.js scripts/test-task-routing.js` for
advisor and existing routing checks. This is local checkout tooling; the
portable skill and installed plugin are unchanged.

### Local usage dashboard

Run `node scripts/dely-monitor.js --enable-logging` and open
`http://127.0.0.1:8787` to monitor recorded routing, effective implementation
pins, separate Codex conversation models and current Orca worker outcomes.
Missing classification/model evidence stays explicit. See the
[usage monitor guide](docs/usage-monitor.md) for denominators and source limits.

### Jev task routing

Version `0.24.7` assesses implementation tasks before Dely creates a Run.
Easy and Medium- use AGY Gemini 3.8 Flash High/default. Medium+ uses AGY
Sonnet 5.5 High/default. Every delegated grade has one explicit quota fallback:
Codex Luna/max at stage 1.
Hard runs directly in Codex Sol/xhigh without Dely. Codex Control reviews
delegated work. Project or personal pins that contradict the reviewed route
are rejected before a worker starts.

Medium- is bounded internal work with known ownership, low coupling and
focused acceptance. Medium+ coordinates known internal components with
integrated acceptance. Existing Hard risk exclusions take precedence.
The CLI labels are `easy`, `medium_minus`, `medium_plus`, and `hard`;
old three-grade assessments must be rerun. The model rows stay compatible:
`implement` supplies Sonnet, `implement_backup` supplies Flash as a primary,
and `implement_backup_2` supplies the single Luna quota fallback.

AGY must advertise the requested model in `agy models`, and its live footer
must confirm the model and High level before receiving the prompt. Unknown
model slugs can silently fall back inside AGY; the adapter now refuses that
behavior. A successful catalog proving the requested model absent now selects
Codex `gpt-6-luna/max` directly, skipping Flash. This separate availability
branch applies to dispatch and implementation preflight; it is not a quota
stage. Auth/timeout/unusable catalog and an unapplied
live footer still stop. Both the original requested pin and the effective
Luna pin are recorded; the reviewed spec/context is rechecked before launch.

Write the spec and a context JSON inside the workspace. The context has
`scope`, `coupling`, `acceptance`, and `evidence` strings, confirmed
`requirements_confirmed`, and explicit boolean `risks` for `security`, `data`,
`public_contract`, `architecture`, `production`, and `routing`. Missing facts
stay unknown. Set a risk to `true` when the task changes that surface.

From the package root:

```powershell
node skills/delivery/scripts/task-routing.js assess --repo D:\project --spec-file spec.md --context-file context.json --out assessment.json
node skills/delivery/scripts/task-routing.js review --assessment-file assessment.json --difficulty medium_minus --reason "Bounded internal scope and focused acceptance verified" --out assessment.json
```

Pass `--assessment-file assessment.json --spec-file spec.md` together to
`dely preflight` so it checks the reviewed task's primary model.

Jev evaluates five narrow questions using `jev-1.13.0`. Control must review
the evidence; no confidence threshold is treated as calibrated. Pass the
reviewed file to `dely dispatch --assessment-file assessment.json`, including
fallback dispatches. A changed spec or context invalidates the assessment.
Medium's quota fallback is `--fallback quota --fallback-stage 1` and selects
Luna/max; it never launches Flash. Hard is refused by the dispatcher.

Get a TypeSafe key from the [official console](https://console.typesafe.ai/).
Put `TYPESAFE_API_KEY=your-key` in the workspace `.env`; `.env.example` shows
the format. The actual `.env` is ignored by Git. The client reads the process
environment first, then the workspace `.env`, the installed package's `.env`,
and Windows User/Machine environment scopes. It uses Node's native env parser
and does not load unrelated `.env` variables. It makes one bounded HTTPS request to
`https://api.typesafe.ai/v1/systemone`; it does not install an SDK dependency.
Without a key or a usable answer, Jev remains `NOT_EVALUATED`. Control can
explicitly review complete source evidence without inventing a Jev result.

Run `node --test scripts/test-task-routing.js` for HTTP and admission checks,
and `scripts/test-quota-backup.ps1 -HelperPath <helper>` for actual adapter
argv/readiness/fallback checks against the Orca fixture.

POC architecture:

```text
GPT / Codex Control + Review
       |
       | implementation only
       v
      Dely
       |
       v
      Orca
       |
       v
Antigravity CLI (agy) implement worker
```

### Current status

- Control and reviewer are GPT/Codex.
- Antigravity CLI (`agy`) is implementation-only worker.
- `agy 1.2.11` is installed and its model catalogue is reachable.
- Orca Desktop `1.4.210` is reachable.
- Direct `orca orchestration worker-start --agent antigravity` currently fails at Orca stage `agent_readiness` even though the AGY TUI is running.
- The working route is: create a fresh AGY terminal -> create an orchestration task -> `orchestration dispatch --inject`.
- E2E is verified PASS on 2026-09-26 after removing the standalone CLI: preflight passed, the Antigravity implement worker created the exact marker, Orca received durable `worker_done` with `outcome=succeeded`, Dely settled the Run, and the runner verified `AGY_WORKER_OK`.
- The local Dely adapter changes the Antigravity launch path and ignores Orca's informational `nextAction=inspect` when `requiresAction=false`; Claude/Codex/Cursor launch behavior remains upstream.
- Each Dely implementation dispatch uses a fresh AGY terminal. The POC records exact terminal handles in a temporary Run-scoped file and closes only those terminals during cleanup.
- `AGENTS.md` pins only `implement` to `Antigravity CLI`; review is performed directly by Codex Control.

Dely upstream currently marks Antigravity as deferred because its normal `worker-start` readiness path is not reliable. This POC restores an injected-terminal path only for AGY.

### Runaway-loop guardrails

The local/global Dely adapter now keeps a small Run-scoped guard file in the OS temp directory:

- Maximum 12 tracked control invocations before a successful `wait` settlement.
- Two identical failures from the same `dispatch` / `wait` / `wait-bg` command arm the guard; the next automatic retry exits with code 10 and `LOOP_GUARD`.
- `DELY_CONTROL_STEP_LIMIT` and `DELY_SAME_FAILURE_LIMIT` can override the defaults when a test needs a smaller budget.
- `DELY_LOOP_GUARD_OVERRIDE=1` clears the guard for one intentional command after explicit user direction.
- Codex instructions bound diagnostic reads to 4,000 characters and searches to 50 results, excluding large generated/cache trees by default.
- Dely already clips free-form worker terminal excerpts to 400 characters. Structured orchestration JSON is not truncated because doing so could corrupt `SETTLED` / action payloads.

Run the focused regression check with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-loop-guard.ps1
```

Run the quota-backup fixture against an installed helper path, for example:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-quota-backup.ps1 -HelperPath .\.dely-poc\skills\delivery\scripts\dely.js
```

### Files

- `AGENTS.md` — routes implementation to Antigravity CLI and keeps review with Codex Control.
- `patches/dely-agy.patch` — reproducible local Dely adapter.
- `scripts/setup-poc.ps1` — rebuilds the local Dely snapshot, applies the AGY adapter, and installs the local Codex plugin.
- `scripts/poc-preflight.ps1` — Dely preflight through Orca to AGY.
- `scripts/test-quota-backup.ps1` — black-box quota fallback and pin-propagation fixture.
- `scripts/poc-e2e.ps1` — deterministic Control -> Dely -> Orca -> AGY proof.
- `poc/agy-worker-spec.md` — worker task used by the E2E proof.
- `.dely-poc/` — generated local Dely snapshot; ignored by Git.

### Setup

From `D:\orca`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-poc.ps1
```

Expected final line:

```text
POC setup OK: Codex Control + Dely + Orca + Antigravity CLI worker.
```

The setup script rebuilds only `.dely-poc`; it does not modify AGY credentials or the upstream `dely@dely` installation.

### Global mode for all workspaces

Global mode is installed at:

```text
C:\Users\Home33\.codex\dely-orca-agy-global
```

The default Dely routing is stored in the existing user-level:

```text
C:\Users\Home33\.codex\AGENTS.md
```

with:

```text
implement        -> Antigravity CLI / claude-sonnet-5-5-high / default
implement_backup -> Antigravity CLI / gemini-3.8-flash-high / default
implement_backup_2 -> Codex CLI / gpt-6-luna / max
review           -> Codex Control (local review, no worker dispatch)
```

The patched Dely resolver checks the current workspace `AGENTS.md` first, then the user-level `~/.codex/AGENTS.md`. A project can override each pin independently. Ordinary implementation dispatch launches AGY with the Sonnet High model. Only an explicit Sonnet provider quota uses `dely dispatch --phase implement --fallback quota --fallback-stage 1` to launch AGY Flash High/default. Only an explicit Flash provider quota advances to `dely dispatch --phase implement --fallback quota --fallback-stage 2` after confirming the prior attempt is inactive and released when required. Stage 2 launches native Codex Luna/max, waits for `tui-idle`, and attaches the worker to that same terminal. Dely waits within a bounded deadline for fresh live working evidence or a visibly unsubmitted prompt; it sends one bare Enter only for the latter, then verifies fresh live working evidence. Authentication, timeout, unknown failures, and stage 2 do not advance the chain.

The Antigravity adapter also calls `orca repo add --path <workspace>` before launching a worker, so a normal new repository does not need a manual Orca registration step.

Install or rebuild global mode from `D:\orca`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-global.ps1
```

Expected final line:

```text
GLOBAL DELY OK
```

AGY workspace trust is intentionally not auto-confirmed. On a folder that Antigravity has never trusted, the first delivery stops with a message containing:

```text
antigravity workspace trust required in terminal term_...
```

Open that AGY terminal, review the folder, approve trust once if appropriate, then rerun the task. After trust is established, no per-workspace Dely configuration is required.

### Verify the integration

Run the verification commands from a live Orca Control terminal because orchestration needs the coordinator terminal identity.

Preflight:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:/orca/scripts/poc-preflight.ps1
```

When the verified AGY catalog lacks the requested model, expect:

```text
MODEL_UNAVAILABLE claude-sonnet-5-5-high -> Codex gpt-6-luna/max
PREFLIGHT implement codex PASS ...
```

When the requested model is available, the implementation healthcheck remains
`PREFLIGHT implement antigravity PASS`. Review is owned by Codex Control.

Full proof:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:/orca/scripts/poc-e2e.ps1
```

Success criteria:

- Dely resolves `Antigravity CLI` from `AGENTS.md`.
- The local adapter starts `agy --dangerously-skip-permissions` in an Orca terminal.
- Orca creates the task and injects the worker preamble/spec into that terminal.
- AGY sends the required heartbeat and `worker_done` through Orca.
- Codex settles/acks/releases the implementation and performs review itself; `dely dispatch --phase review` is rejected.
- AGY creates only `poc/worker-output.txt`.
- The file contains exactly `AGY_WORKER_OK` plus one newline.
- The POC scripts close retained AGY worker terminals after the run.
- Final output is:

```text
POC PASS: Dely -> Orca -> Antigravity CLI produced AGY_WORKER_OK
```

### Worker model

AGY is the primary worker, pinned to `claude-sonnet-5-5-high` with default effort. Explicit Sonnet quota advances to AGY `gemini-3.8-flash-high` at stage 1; only explicit Flash quota advances to Codex `gpt-6-luna` at max effort in stage 2. Separately, a successful AGY catalog proving a requested Sonnet or Flash model absent goes directly to Luna/max. Dely keeps the existing native idle and fresh live-working startup checks; auth/timeout/unverified catalog and an unapplied footer stop.
