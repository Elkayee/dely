# Codex task compliance

This local adapter validates native skill selection and records task assessment
and Control review before supported tool mutations. Jev skill advice is optional;
task-difficulty assessment and the existing Dely routes remain required.
Install it in every Codex home used on this machine, including Orca's
CODEX_HOME. It needs Node 24, an installed Dely task-routing module and the
existing Jev advisor. Node 24 must be on the hook process PATH. It adds no
service or dependency. On Windows, hook commands and preparation guidance
use the absolute native node.exe with PowerShell's call operator. This avoids
an extensionless Linux NVM binary shadowing Node and opening the app picker.

## Install and activate

Run from the checkout, supplying the installed routing module and advisor:

    rtk proxy node scripts/codex-compliance.js install --home C:/Users/Home33/.codex --routing C:/Users/Home33/.codex/plugins/cache/dely-orca-agy-global/dely/0.24.10/skills/delivery/scripts/task-routing.js --advisor D:/orca/scripts/jev_agent.js

Repeat with Orca's actual CODEX_HOME. The installer preserves other hooks,
backs up hooks.json and adds SessionStart, UserPromptSubmit, PreToolUse and
Stop handlers. Reinstalling replaces only this adapter's handlers.
The adapter freezes the advisor's source while preserving its original
credential search root. It copies no credentials. Editing the checkout's
advisor does not replace advice code during an active task.
Task assessment uses the same preserved credential search root as skill advice,
so a new worktree or plugin cache does not lose an existing TypeSafe key. The
workspace and process key precedence remains unchanged; credentials are never
copied into the installed package.

Codex must have hooks enabled. Review and trust the four exact definitions
through Codex's native /hooks interface, then start a fresh session.
Untrusted definitions are skipped by Codex. The installer deliberately
reports REQUIRES_NATIVE_HOOK_REVIEW instead of claiming activation.

For software updates with existing admission wiring, add `--preserve-hooks`.
This requires one compliance handler for each of the four events and leaves
`hooks.json` byte-for-byte unchanged, including shared-home wiring. It refreshes
the frozen software and guides without granting or changing native hook trust.

## Agent procedure

SessionStart and each UserPromptSubmit supply the current session/turn IDs,
the installed script and this guide. Read-only inspection can gather context
before preparation. Keep mandatory instructions outside relevance ranking.
Use simple read commands and the resolved Orca CLI directly. Shell conditionals,
pipelines and wrappers remain subject to review; a denied command records an
attempt and can require review at Stop. A preflight healthcheck performs only
read-only instruction loading and Orca lifecycle calls, then stops without
implementation or a separate Jev review.
After Context Engine returns multiple optional candidates, use the existing
Jev context command and preserve every candidate and its provenance.

Before implementation:

Prefer Dely for reversible bounded internal work. The risk flags describe
consequential changes, rather than task topics or the presence of data, APIs,
authentication code or production code in a repository. Apply the
[task risk policy](task-risk-policy.md), and record the actual effect that
supports each Hard exclusion. Unknown effects remain unevaluated.

1. Build a task JSON from the actual request and current session skill catalog.
   Supply complete descriptions and absolute SKILL.md paths. Include every
   mandatory or user-selected skill in required_skills.
2. Read the exact input path printed by the current UserPromptSubmit hook.
   Use `apply_patch` to add that one UTF-8 JSON file. Its path is inside the
   effective hook home's `dely-compliance/inputs/`, with a filename bound to
   the session and turn. This narrow preparation exception accepts one complete
   JSON task, never a second file, an update, an existing file, a directory link
   or an escaping path. It grants no implementation permission. Invoke the
   installed script's prepare command with --session,
   --turn, --repo, the explicit --home from the hook's guidance, and --task-file
   <path>. It freezes the native roster and task inputs and runs the existing
   task assessment. It neither scans the home catalog nor calls skill advice.
3. Inspect the assessment and choose skills from the actual native session
   roster. Invoke review with the same IDs, --difficulty,
   --reason, --skills and --skill-reason. The skills argument is a JSON array
   of supplied names, or exact catalog paths when names collide. Review loads the full selected instructions into its
   output and checks that required skills were retained.
4. For a delegated grade, create the actual Dely Run before review, include
   its ID with --run, and load the installed delivery skill. Review rejects a
   missing, empty or whitespace-only Run ID and keeps the task PREPARED.
   Use the prepared spec/context and reviewed
   assessment for dispatch. The gate accepts the installed Dely coordination
   commands before dispatch, then requires journal evidence with matching
   spec/context hashes before ordinary mutations.
5. For Hard, implement directly after review. The routing module retains its
   existing risk exclusions and model selection; the hook checks the active
   model slug against the reviewed primary. Native events do not supply effort,
   so the existing harness model/effort checks still own that evidence.

Preparation and review record assessment metadata in the configured opt-in
journal, including calls through this adapter. They create no logging directory
and record no prompts, context bodies, source text or credentials. Missing or
unwritable logging never changes routing or admission. Tests use a private
journal so their results do not inflate ordinary usage.

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

Use mode advice for local skill review without implementation; omit spec/context.
Preparation reports `skill_selection.source: native-session` and
`advice_status: NOT_REQUESTED`. A deliberate skipped advice call is neither a
successful provider evaluation nor a provider failure. The complete supplied
roster stays local; there is no automatic whole-home expansion. If a mandatory
skill is missing, discover that exact source, include its complete metadata in
the native roster and prepare/review again. A missing or ambiguous source cannot
be silently omitted. Exact original paths disambiguate colliding names.

Review retains every required skill, checks current source and configuration
policy, and loads admitted instructions. Aliases retain the most restrictive
native metadata and local policy. Disabled skills and unrequired explicit-only
skills are rejected before their instructions appear in the review output.
An explicit-only skill must be required by the user's request or a mandatory
workflow in the actual session roster. Optional recommendations cannot grant
that authority. See [optional skill advice](jev-skill-advice.md) for consultation
when requested, when candidates compete or when targeted native discovery misses
a needed workflow. Its failures remain honestly `NOT_EVALUATED` and do not add
a denial to independently valid native admission.
That review does not authorize mutations. Questions requiring no tools do
not need a delivery assessment. A new user turn invalidates the previous
turn's authorization; prepare and explicitly review the current task again.
When continuing the same task, explicitly select its existing Run ID and
retain the exact spec/context. A matching prior dispatch can be reused;
the gate does not require replaying an already delivered prompt.

NOT_EVALUATED remains recorded when Jev is unavailable. Control must explain
the chosen skills and may use the routing module's existing evidence-based
review; no confidence threshold or automatic model fallback is introduced.
Optional advice with an empty supplied candidate set is `NOT_APPLICABLE` and
makes no provider call.

The hook freezes the complete task, native metadata, required skills at prepare,
selected sources at review, both alias and canonical invocation policies
(including absence), all supplied roster path bindings, AGENTS.md and installed dependencies.
It retains the conservative active-config fingerprint. Unrelated, nonrequired
skill bodies are outside admission; changing a selected body, policy or alias
invalidates review. Roster alias bindings prevent an unrelated disabled or
explicit-only alias from silently joining a selected policy group. Selected
bytes and bindings must be stable while loaded; prepared evidence is rechecked
before new selected evidence is admitted.
Optional advice files are independent of this execution evidence.
Legacy task states require fresh prepare/review; historical records are not
rewritten or silently promoted. Update this adapter
and its dependencies between tasks. Changes require fresh native hook review
when Codex marks a definition modified.

## Coverage and limits

PreToolUse checks apply_patch, known file/notebook MCP mutation names and
shell calls. Simple read commands, this adapter's preparation/review and Orca
coordination and the exact current-turn JSON input add remain available.
Unknown shell commands require review. A reviewed Node flag command is an
ordinary command; only an existing exact Dely script path can be coordination.
Repeated accepted tools do not rewrite an unchanged session state.
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
read-only inspection, and allows a write after task assessment and explicit
Control review. Verify the hook's trust status through /hooks.

Backups are inside each Codex home's dely-compliance directory. To remove the
adapter, remove only its four command handlers from hooks.json, preserving
the other handlers, then start a fresh session. Use the saved manifest only
after checking that restoring it would preserve any later hook changes.
