# Codex task compliance

This local adapter makes Codex request Jev advice and record Control review
before supported tool mutations. It preserves the existing Dely routes.
Install it in every Codex home used on this machine, including Orca's
CODEX_HOME. It needs Node 24, an installed Dely task-routing module and the
existing Jev advisor. Node 24 must be on the hook process PATH. It adds no
service or dependency. On Windows, hook commands and preparation guidance
use the absolute native node.exe with PowerShell's call operator. This avoids
an extensionless Linux NVM binary shadowing Node and opening the app picker.

## Install and activate

Run from the checkout, supplying the installed routing module and advisor:

    rtk proxy node scripts/codex-compliance.js install --home C:/Users/Home33/.codex --routing C:/Users/Home33/.codex/plugins/cache/dely-orca-agy-global/dely/0.24.8/skills/delivery/scripts/task-routing.js --advisor D:/orca/scripts/jev_agent.js

Repeat with Orca's actual CODEX_HOME. The installer preserves other hooks,
backs up hooks.json and adds SessionStart, UserPromptSubmit, PreToolUse and
Stop handlers. Reinstalling replaces only this adapter's handlers.
The adapter freezes the advisor's source while preserving its original
credential search root. It copies no credentials. Editing the checkout's
advisor does not replace advice code during an active task.

Codex must have hooks enabled. Review and trust the four exact definitions
through Codex's native /hooks interface, then start a fresh session.
Untrusted definitions are skipped by Codex. The installer deliberately
reports REQUIRES_NATIVE_HOOK_REVIEW instead of claiming activation.

## Agent procedure

SessionStart and each UserPromptSubmit supply the current session/turn IDs,
the installed script and this guide. Read-only inspection can gather context
before preparation. Keep mandatory instructions outside relevance ranking.
After Context Engine returns multiple optional candidates, use the existing
Jev context command and preserve every candidate and its provenance.

Before implementation:

1. Build a task JSON from the actual request and current session skill catalog.
   Supply complete descriptions and absolute SKILL.md paths. Include every
   mandatory or user-selected skill in required_skills.
2. Save the complete task JSON as UTF-8 through the approved preparation
   surface. Invoke the installed script's prepare command with --session,
   --turn, --repo and --task-file <path>. It writes isolated inputs and calls the existing
   Jev skill advisor and task assessment; it does not approve their results.
3. Inspect both results. Invoke review with the same IDs, --difficulty,
   --reason, --skills and --skill-reason. The skills argument is a JSON array
   of supplied names, or exact catalog paths when names collide. Review loads the full selected instructions into its
   output and checks that required skills were retained.
4. For a delegated grade, include --run with the actual Dely Run ID and load
   the installed delivery skill. Use the prepared spec/context and reviewed
   assessment for dispatch. The gate accepts the installed Dely coordination
   commands before dispatch, then requires journal evidence with matching
   spec/context hashes before ordinary mutations.
5. For Hard, implement directly after review. The routing module retains its
   existing risk exclusions and model selection; the hook checks the active
   model slug against the reviewed primary. Native events do not supply effort,
   so the existing harness model/effort checks still own that evidence.

File input keeps a large session skill catalog out of the Windows process
command line. Relative paths resolve from the current working directory;
quote paths containing spaces. UTF-8 with or without a BOM is accepted.
Exactly one input is required: --task-file <path> or the existing
--task-json '<JSON>'. Invalid files, UTF-8 or JSON fail before preparation
writes task snapshots or authorizes any mutation. Both forms use the same
validation and fingerprinted snapshots below.

The task JSON shape is:

    {
      "mode": "implement",
      "request": "The current task",
      "spec": "The complete implementation contract",
      "context": {
        "scope": "The confirmed scope",
        "coupling": "Known dependencies",
        "acceptance": "Observable acceptance checks",
        "evidence": "Current source evidence",
        "requirements_confirmed": true,
        "risks": {
          "security": false, "data": false, "public_contract": false,
          "architecture": false, "production": false, "routing": false
        }
      },
      "skills": [
        {
          "name": "The actual catalog name",
          "path": "An absolute path to SKILL.md",
          "description": "The full current catalog description"
        }
      ],
      "required_skills": ["The actual catalog name"]
    }

Use mode advice for skill advice without implementation; omit spec/context.
Jev skill advice discovers only the user's home `.agents/skills` catalog. The
supplied session roster is snapshotted separately for mandatory Control skills.
Inspect the complete `suggestions[]` list and choose every skill the task needs,
alongside mandatory/user-selected skills. The singular `suggestion` field is a
legacy alias; a task is not limited to that one entry. Detailed evaluations are
saved in the advice file printed by `prepare`.
See [home skill advice](jev-skill-advice.md) for packet limits and selection.
That review does not authorize mutations. Questions requiring no tools do
not need a delivery assessment. A new user turn invalidates the previous
turn's authorization; prepare and explicitly review the current task again.
When continuing the same task, explicitly select its existing Run ID and
retain the exact spec/context. A matching prior dispatch can be reused;
the gate does not require replaying an already delivered prompt.

NOT_EVALUATED remains recorded when Jev is unavailable. Control must explain
the chosen skills and may use the routing module's existing evidence-based
review; no confidence threshold or automatic model fallback is introduced.
NOT_APPLICABLE is reserved for an empty skill roster.

The hook checks task inputs, advice, loaded skill hashes, AGENTS.md snapshots
and installed dependency hashes again before mutations. Update this adapter
and its dependencies between tasks. Changes require fresh native hook review
when Codex marks a definition modified.

## Coverage and limits

PreToolUse checks apply_patch, known file/notebook MCP mutation names and
shell calls. Simple read commands, this adapter's preparation/review and Orca
coordination remain available. Unknown shell commands require review.
Delegated evidence comes from the existing opt-in ~/.dely/log.jsonl; absence,
malformed data or a journal larger than 16 MiB cannot prove a dispatch.
The adapter does not create ~/.dely or enable logging silently.

Codex Dely workers inherit Control's admission only when the current Orca
terminal handle, effective Codex model, dispatch log, route log and Dely
terminal inventory match, and the current user turn carries that dispatch's
receipt marker or staged spec hash. A later unrelated prompt loses the
exception. Prompt text claiming a worker role is insufficient.
This preserves the worker instruction to read only its supplied task spec.

Stop asks for missing evidence after an implementation attempt. It blocks
once per unresolved state and then permits an honest limitation report,
avoiding an endless completion loop.

This is an omission guardrail, not proof that a model understood or followed
every instruction. Shell classification is conservative, not a security
parser. Native hook failures, disabled/untrusted hooks and specialized tool
paths can bypass checks; independently verify activation. Codex documents
those limits in [Hooks](https://learn.chatgpt.com/docs/hooks).

## Verify and recover

    rtk proxy node --check scripts/codex-compliance.js
    rtk proxy node --test scripts/test-codex-compliance.js

Verify a fresh native session rejects a write with no preparation, preserves
read-only inspection, and allows a write after real advice and explicit
Control review. Verify the hook's trust status through /hooks.

Backups are inside each Codex home's dely-compliance directory. To remove the
adapter, remove only its four command handlers from hooks.json, preserving
the other handlers, then start a fresh session. Use the saved manifest only
after checking that restoring it would preserve any later hook changes.
