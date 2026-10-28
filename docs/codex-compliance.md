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

SessionStart supplies the current session/turn IDs, the installed script, this
guide and the full routing and fallback detail. Each UserPromptSubmit repeats
the actionable core: the current prepare/advise command, evidence reminder,
routing boundary and sync rule. Read-only inspection can gather context
before preparation. Keep mandatory instructions outside relevance ranking.
Use one read command per tool call and the resolved Orca CLI directly. Independent
reads can use separate parallel tool calls. Shell conditionals, compound commands,
pipelines, redirects and wrappers remain subject to review. A denied tool stays
blocked and permits an honest limitation report at Stop. A preflight healthcheck performs only
read-only instruction loading and Orca lifecycle calls, then stops without
implementation or a separate Jev review.
Read-only inspection conveniences include `cat`, `head`, `tail`, `wc`, `ls`,
`stat`, `file`, `du`, `df`, `grep`, plain `find` without delete, exec or
print-to-file, `node --check <file>`, and listing git forms (`status`, `diff`,
`log`, `show`, `blame`, `grep`, `ls-tree`, `cat-file`, `branch` list flags,
`tag --list`, `config --get`, `worktree list`, `reflog`). Simple `git remote`,
`git remote -v`, `git remote --verbose` and `git remote get-url <name>` are
also read-only. Mutating flags, redirects, pipelines, output flags and
`remote show` (which may contact the remote) still require review.
`sort` and `uniq` require review because their arguments can name output files.
`find -fprint0` and `git reflog delete`, `expire`, `drop` and `write` also require
review; listing reflogs and plain `find` printing remain read-only.
Plain `file <path>` remains read-only; optioned forms require review because
`--compile` writes a magic database. Git grep pager options also require review
because they launch a command. Help/version shortcuts exempt only a standalone
flag, so `sort -h -o <output>` cannot inherit a help exemption.
After Context Engine returns multiple optional candidates, use the existing
Jev context command and preserve every candidate and its provenance.

Before implementation:

Prefer Dely for reversible bounded internal work. The risk flags describe
consequential changes, rather than task topics or the presence of data, APIs,
authentication code or production code in a repository. Apply the
[task risk policy](task-risk-policy.md), and record the actual effect that
supports each Hard exclusion. Unknown effects remain unevaluated.
Evidence names the relevant location/contract, before/after behavior, affected
consumers and detector. Read-only semantics/exposure can retain data risk;
destructive commands and line numbers for unwritten code are not required.
Assess slices independently. Optional domain/leaf labels select no grade or
worker. For each correction candidate, consider all five saved answers and
record the Control decision. Normal review can retain Medium+ with no proof;
missing correction proof is distinct from missing task evidence.
Before prepare/dispatch, assessment inputs require concrete verification
evidence in the existing `context.acceptance` and `context.evidence` string
fields. Require a concrete available method/command and fixture, procedure,
expected_result, would_fail_if, and inspected source/caller/detector provenance.
Explicitly distinguish a planned detector before dispatch from executed
acceptance after implementation: pre-dispatch evidence defines the verification
instrument and criteria that will prove the work, whereas executed results
belong to verification logs and records after implementation. If Jev returns a
valid `insufficient_evidence` response, inspect the gap, gather real new
evidence and use a fresh task snapshot/assessment without overwriting raw Jev
answers, old tasks or reviews. Unknowns remain NOT_EVALUATED. This guidance
requires no forced low grade, schema field, evaluator, routing/admission/fallback
or ownership change.

1. Build a task JSON from the actual request and current session skill catalog.
   Supply complete descriptions and absolute SKILL.md paths. Include every
   mandatory or user-selected skill in required_skills.
2. Read the exact input path printed by the current UserPromptSubmit hook.
   Use `apply_patch` to add that one UTF-8 JSON file. Its path is inside the
   effective hook home's `dely-compliance/inputs/`, with a filename bound to
   the session, turn and fresh UserPromptSubmit nonce. Steering within the same
   turn gets a new path, so prior input remains intact. This exception accepts one complete
   JSON task, never a second file, an update, an existing file, a directory link
   or an escaping path. It grants no implementation permission. Invoke the
   installed script's prepare command with --session,
   --turn, --repo, the explicit --home from the hook's guidance, and --task-file
   <path>. It freezes the native roster and task inputs and runs the existing
   task assessment. New implementation specs use LF and a terminal newline
   before freezing and assessment; trailing blank lines remain intact. Review,
   staging and dispatch then require those exact canonical bytes. Historical
   snapshots are unchanged. It neither scans the home catalog nor calls skill advice.
3. Inspect the assessment and choose skills from the actual native session
   roster. Invoke review with the same IDs, --difficulty,
   --reason, --skills and --skill-reason. The skills argument is a JSON array
   of supplied names, or exact catalog paths when names collide. Review loads the full selected instructions into its
   output and checks that required skills were retained.
   Policy v4 keeps raw Jev evidence. Only an eligible single-dimension
   verification/coordination correction uses optional `--review-evidence-json
   <JSON>` with `--difficulty medium_minus`; no external proof file is needed.
   See [the proof contract](task-risk-policy.md#optional-correction). Normal
   review remains unchanged. Final Medium+/Hard are Sol-only without fallback.
4. For a delegated grade, create the actual Dely Run before review, include
   its ID with --run, and load the installed delivery skill. Review rejects a
   missing, empty or whitespace-only Run ID and keeps the task PREPARED.
   Before dispatch, use `apply_patch` to add the exact frozen spec as
   `<execution-repo>/.dely/local/runs/<run>/spec.md` (the Control repo when no
   `execution_repo` was supplied). Relative patch paths resolve from the Control
   workspace, as they do in `apply_patch`. This create-only exception checks
   the current interactive Control review and every frozen binding; changed
   content, existing files, linked paths and all ordinary edits stay blocked.
   Use the prepared spec/context and reviewed
   assessment for dispatch. Routing also accepts that exact-byte copy at the
   canonical `.dely/local/runs/<run>/spec.md` path for the supplied Run. It still
   reloads the original frozen spec/context and validates the approved route;
   arbitrary copies, changed bytes and escaping paths remain rejected.
   The gate accepts the installed Dely coordination
   commands before dispatch, then requires dispatch receipts with matching
   spec/context hashes before ordinary mutations.
5. For Hard, implement directly after review. The routing module retains its
   existing risk exclusions and model selection; the hook checks the active
   model slug against the reviewed primary. Native events do not supply effort,
   so the existing harness model/effort checks still own that evidence.

Preparation and review record assessment metadata in the configured opt-in
journal, including calls through this adapter. They create no logging directory
and record no full prompts, context bodies or credentials. Optional titles
contain at most 60 graphemes of the frozen spec's first level-one heading outside code fences;
domain is an optional enum or null. Extraction errors retain the base event.
Neither field changes admission or routing. Missing or
unwritable logging never changes routing or admission. Tests use a private
journal so their results do not inflate ordinary usage.

## Request advisory before implementation review

Use the installed adapter's `advise` command to consult the frozen Jev advisor
before task assessment. Add an `advisory` envelope to the current-turn task JSON
before creating the exact input file printed by UserPromptSubmit. Keep the full
native skill roster and mandatory skills in that task.

```json
"advisory": {
  "mode": "plan",
  "input": {
    "request": "The same exact request as the enclosing task",
    "tasks": [{
      "id": "fix",
      "objective": "Fix the known issue",
      "scope": "One internal adapter",
      "acceptance": "The focused regression passes",
      "depends_on": []
    }]
  }
}
```

Run the absolute native Node executable and installed adapter from the hook's
guidance, changing `prepare` to `advise` and retaining `--session`, `--turn`,
`--repo`, `--home` and `--task-file`. No other flags are accepted. The task file
must be this prompt's exact nonce-bound input; arbitrary input/output paths,
inline JSON and linked paths are rejected. `mode` also accepts `skill` or
`context` using the [existing schemas](agent-advice.md). Skill input must retain
the enclosing task's complete supplied roster. Advice requests retain the exact
request text, code provenance and mandatory instructions.

The adapter validates the current owner, prompt, task and frozen dependencies.
It reserves `tasks/advisory-<prompt-hash>/request.json` exclusively before the
provider call and writes `result.json` with task/input/advisor hashes. It never
marks the native task reviewed or admits source edits. Control reads that result,
settles the plan explicitly, and then runs normal `prepare` and `review`.
An existing complete result is returned without another call. An incomplete
reservation or changed binding stops; timeout alone never permits a retry.
Provider failures stay `NOT_EVALUATED`. An updated plan requires a fresh prompt
and its new input file, within the advisor's existing revision bound.

Install an advisor that supports `plan` before using that mode. Refresh frozen
software between completed plans with `--preserve-hooks`; do not replace the
advisor during an admitted implementation. Advice grants no skill, model,
difficulty, dispatch or fallback authority.

### Diagnose a frozen insufficient-evidence assessment

In a fresh interactive prompt in the assessed repository, keep the actual native
skill roster and mandatory skills in the current nonce-bound task input. Use
`mode: "advice"`, give the task a diagnostic request, and add this envelope
(replace the example ID with the existing native task directory name):

```json
"advisory": {
  "mode": "evidence",
  "input": {
    "request": "Diagnose the frozen verification evidence",
    "task_id": "0123456789abcdef01234567"
  }
}
```

The inner request must exactly match the enclosing task's request. Add only the
new input file printed by this prompt's hook, using `apply_patch`. Run the hook's
absolute native Node command with `advise` in place of `prepare`, retaining its
five arguments: `--session`, `--turn`, `--repo`, `--home`, and `--task-file`.
Read the reported `output_file` and explicitly review the advice. No classification
is retried and no implementation is authorized by this operation.

The target must be under this home's `dely-compliance/tasks/`, belong to the
current repository, and retain its original `spec.md`, `context.json` and
`assessment.json`. Its raw verification answer must be `insufficient_evidence`.
The adapter validates the original assessment and exact source paths, rejects
links, and binds all three files' bytes to the current owner, prompt, task and
frozen software. It rechecks the binding before writing a result and on replay.
Existing records are never rewritten. A lost or incomplete reservation stops;
a complete result is reused without another provider call.

`result.checks` contains typed `present`, `missing`, `contradictory`, or `unknown`
judgments for method, fixture, procedure, expected result, counterexample, and
source/caller/detector provenance. `gaps` names missing or contradictory elements.
Unknown checks and any result containing them remain `NOT_EVALUATED`; known
partial diagnostics are retained. Malformed replies and provider failures also
remain unevaluated. `binding` records the exact spec/context/assessment hashes.

All-present advice remains `REVIEW_REQUIRED` with `authority: "NONE"`. An empty
gap list means the diagnostic identified no specific gap. This is a fresh,
untrusted judgment, not access to the original model's hidden reason. Planned
detectors are valid before implementation; executed acceptance belongs after it.
Control must inspect any proposed gap, gather real new evidence if needed, and
prepare a fresh snapshot for subsequent work. Raw insufficient-evidence vetoes,
ordinary review/dispatch/edit gates, grades, corrections and fallbacks remain
unchanged, even when every diagnostic check says `present`.

## Continue the same confirmed task

An implementation review saves an immutable `continuation.json` checkpoint.
On a new prompt in the same session, the adapter automatically reuses that
checkpoint when its owner session, native model, thread/terminal, instructions,
selected skill policies, software, target, task fingerprints and any required
dispatch still validate. The turn stays `REVIEWED`, mutations remain admitted,
and the prompt guidance states that the approved task was reused. Workers
cannot inherit this path through a staged receipt claim. Changed ownership or
invalid evidence falls back to `PENDING` and normal preparation. Control must
prepare a fresh task when the request changes scope.
Automatic reuse supplies the previous review's Run ID and validates it against
the immutable checkpoint and matching dispatch. A missing or mismatched dispatch
keeps the next turn `PENDING`; removing dispatch evidence also blocks later tools.

Control can also run the installed script's `resume` command with
the current `--session`, `--turn`, `--repo` and `--home`, plus the original
`--run` for delegated work. Direct Hard work omits `--run`.

Resume validates owner session, native model, thread/terminal, instructions,
selected skill policies, software, target, immutable checkpoint and all task
fingerprints. Delegated work also needs its original matching dispatch.
It reuses the original approval, selected skills, raw assessment and correction
proof. It creates no new task input, roster, assessment or review, and makes no
Jev request. New task inputs and skill selections are rejected by resume.
Workers cannot resume a Control approval through a staged receipt claim.

The earlier `prepare --continue` form remains accepted for existing callers;
that form still stages an input and requires explicit current-turn review.

For a changed task, instructions, model, roster, target, dependency or software,
use normal preparation and the required new dispatch. Older states without a
checkpoint also use normal preparation. The adapter only reuses a checkpoint
whose complete evidence still validates; it never guesses that a scope change
continues an old approval.

A retained unavailable Jev result stays `NOT_EVALUATED`; continuation is not a
provider retry. Record a Control disposition for missing mandatory evidence:
existing source-evidence review, or fresh assessment before resumed work.
Optional skill advice and valid Hard exclusions do not require backfill. Keep
supplemental results separate, linked by original input/result hashes; they do
not rewrite an approved assessment or dispatch. A later changed snapshot is a
matching candidate until Control confirms its relationship to the original.

## Dispatch evidence and optional logging

New dispatches write one immutable receipt per dispatch under the Run's
`receipts/` directory before acknowledging native admission. The receipt binds
the route and actual launch to the repository, Run, original spec/context,
assessment/correction hashes, dispatch and terminal identity. Native worker
admission also validates the current session/turn/model/effort, delivered
prompt claim and owned inventory. A missing, partial or mismatched receipt
grants no admission. Linked receipt paths are rejected.

The journal is optional telemetry. Missing, unwritable or oversized journal
files do not block valid receipt-based admission. Historical Runs without a
receipt directory retain their legacy journal check; once a Run has receipt
evidence, invalid receipts cannot fall back to journal authority. Older native
adapters still require their legacy journal until reinstalled between tasks.

New task preparation stores one authoritative `skills.json` roster; the
state's skill-input, session-roster and source-roster references share it.
Historical snapshots are read without rewriting their original files.

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
        "acceptance": "Method/command: node --test scripts/test-codex-compliance.js. Fixture: test fixture exercising SessionStart and UserPromptSubmit hook output. Procedure: invoke hook handlers with Control and worker events. Expected result: additionalContext includes the static verification evidence reminder and passes validation. Would fail if: reminder text is generic or lacks expected_result/would_fail_if/provenance requirements.",
        "evidence": "Inspected source and caller provenance: scripts/codex-compliance.js context() generates additionalContext for SessionStart and UserPromptSubmit; scripts/test-codex-compliance.js verifies hook output. Planned detector distinguishes pre-dispatch verification requirements from executed post-implementation results.",
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

For an isolated candidate in another worktree of the same Git repository,
add `"execution_repo": "C:/absolute/candidate/path"` to the task JSON. Keep
`prepare --repo` and `review --repo` on the original Control workspace: native
hook `cwd` identifies the session, not a shell command's working directory.
The adapter verifies that the absolute target exists and shares the original
repository's Git common directory. An unrelated repository is rejected.

Preparation retains the prompt origin and assesses the declared candidate.
Use that candidate path with `dely dispatch --repo`, together with the generated
spec and reviewed assessment. Dispatch evidence must match the candidate,
Run, difficulty and exact spec/context hashes. Both worktrees' instructions
are frozen; changing either instructions or the target path binding invalidates
review. Omitting `execution_repo` keeps the existing single-workspace behavior.
The exact installed helper's usage and `pins` reads remain available before
dispatch; ordinary edits still require matching implementation evidence.

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
Native state `native-skills-v4` also freezes the original `assessment.json` and
fingerprints `reviewed.json`. Review and admission compare raw evidence to the
original; pure approval validation preserves `reviewed_at`. Worker admission
binds the dispatch to the reviewed policy, basis and correction hash, and
checks the effective model/effort against the final route. Proven workers
inherit their dispatch's admission and cannot create Control reviews. Mutable
worker implementation files are not immutable task evidence.
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
The dispatch's native session/turn evidence must match the current hook;
matching only a model slug, terminal or copied receipt cannot inherit admission.
This preserves the worker instruction to read only its supplied task spec.
Session and prompt guidance expose the native hook's model, session and turn.
The first verified inherited PreToolUse call in each turn also reports those
facts to the worker; repeats in the same turn stay silent.
Missing model evidence stays `NOT_EVALUATED`; native hooks do not supply effort.
These messages grant no admission and do not replace the existing checks.
The native prompt guidance identifies this inherited path separately from
Control preparation: workers read their supplied spec, send the receipt and
report an admission denial to Control instead of reviewing themselves. Worker
prompts omit the Control preparation procedure and retain the
verification-evidence reminder, supplied-spec, guide and read-only guidance.
If preparation nevertheless occurs, it retains only the current prompt's
worker claim; the same dispatch/model/terminal/inventory checks still apply.
An unrelated prompt resets that claim and cannot inherit the preceding task.

Stop checks evidence only after a tool requiring implementation authority has
passed PreToolUse validation. The `mutation_admitted` flag records admission,
not execution or successful completion. Denied tools and preparation alone do
not set it. Repreparing in the same turn preserves it; a new prompt resets it.
Legacy `attempted` evidence retains its conservative Stop check until the next
prompt because it cannot distinguish admitted tools from denials.

After admission, Stop blocks once per unresolved evidence state and then permits
an honest limitation report. Denied retries do not rearm that block; another
admitted tool does. SessionStart and UserPromptSubmit retain the full preparation
procedure. Denials give a concise cause and the installed guide path; compound
shell commands also suggest separate read tool calls. Workers report admission
denials to Control and never prepare or review their own task.

For admitted Control work in the registered Dely authoring source, Stop also
checks source/install freshness through the hash-pinned installed updater.
Sync records `sync_source`, `sync_homes` and the updater dependency in settings,
and the same selected homes in source registration. Every recorded home must
match the full source bundle and bindings. A mismatch blocks once with final
sync instructions; report `NOT_SYNCED` if review, verification or synchronization
cannot finish. The hook never publishes changes or executes the source updater.
This check does not extend to read-only turns, verified workers, unrelated
repositories or an unregistered candidate worktree. Native task admission and
the honest limitation-report path still apply.

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
Also verify a denied compound read followed by Stop permits the first final
report while the compound command and an unreviewed write remain blocked.
Set `COMPLIANCE_ROUTING` to the installed `task-routing.js` when the test
fixture's default cache pin is unavailable.

Backups are inside each Codex home's dely-compliance directory. To remove the
adapter, remove only its four command handlers from hooks.json, preserving
the other handlers, then start a fresh session. Use the saved manifest only
after checking that restoring it would preserve any later hook changes.
