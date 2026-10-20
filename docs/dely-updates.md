# Update local Dely from one source

The authoring source is this repository. New native sessions use only
`dely@dely`, installed from this repository's local marketplace. Codex creates
versioned caches; they are generated execution artifacts, not additional
authoring sources. Compliance in each existing Codex home must select that
home's canonical plugin cache for the skill, router, dispatcher and advisor.

After a Dely change passes its checks and Control review, finish the current
plan, then update before starting another plan. Keep the installed version
frozen while a plan is running. This is an explicit release command, not a
watcher that promotes each save.

From the repository root, using native Node:

```powershell
node.exe scripts/sync-dely.js plan
node.exe scripts/sync-dely.js update --expected-sha <bundle_sha256-from-plan>
node.exe scripts/sync-dely.js check
```

`plan` is read-only. Review its source, bundle hash and target homes before
`update`. The hash binds the reviewed package files; source drift stops the
update. A content-addressed snapshot contains the public package directories,
excluding local task history and generated trees. Shell text uses canonical
LF, matching a Git export from a Windows checkout; binary assets stay exact.
`update` uses Codex's marketplace/install commands, checks the copied
bundle, disables the named legacy Dely plugin entries, and calls the existing
compliance installer with `--preserve-hooks`. Both native `hooks.json` files
and their existing trust stay unchanged. Credential discovery retains its
previous root. Other plugins and configuration stay intact.

The default homes are the native `~/.codex` and Orca's existing runtime home.
Use repeated `--home` arguments to select existing installations explicitly.
Initial hook installation and native trust review still follow
[Codex compliance setup](codex-compliance.md#install-and-activate).

`apply` repairs bindings to an already published matching canonical cache,
without running plugin installation. For a read-only diagnosis of an older
cache, `plan --catalog <path>` and `check --catalog <path>` compare it with the
authoring source. Custom catalog paths are never promotion targets.

If runtime files differ under an already installed version, the updater stops.
Advance the release version and its repository gate before publishing changed
runtime bytes. The version number alone is not proof that two bundles match.

Each update saves profile backups under the home's
`dely-compliance/backups/sync-<id>`. A failed update restores those profile files
and reports any incomplete restoration. Newly materialized caches remain for
inspection. Cleanup disables only the known obsolete Dely registrations;
it preserves old caches, frozen releases, unknown references and assessment
history. It does not infer that an old session or worker has stopped.

Open a fresh native session after activation. Compare its actual supplied
`dely:delivery` path with `settings.delivery` before the next delegated task.
A live session's earlier skill roster is historical input and must not be
rewritten to claim it loaded the new plugin.
