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

After checks and Control review, synchronize the source and both existing
installations with one command from the repository root, using native Node:

```powershell
node.exe scripts/sync-dely.js
```

The default action is `sync`; explicit `sync` and `scripts/setup-global.ps1`
do the same work. It computes the source hash, publishes a missing release or
repairs bindings as needed, and verifies every selected home before returning
`COHERENT`. It also verifies the recorded source, catalog and bundle hash, and
repairs stale source registration. A coherent installation is a read-only no-op.
Failures return a nonzero exit code rather than reporting synchronization as complete.

After every reviewed and verified change to this authoring source, Control must
run that command before claiming completion. The installed compliance adapter
checks freshness at Stop for admitted Control work in the registered source.
It uses the hash-pinned installed updater and the recorded set of installation
homes, comparing complete bundle bytes and bindings. A stale source, either
stale home, or missing registration blocks completion once with sync guidance;
an unresolved update must be reported as `NOT_SYNCED`.

The Stop check only reads state. It never publishes unreviewed source or runs
the source copy of the updater. Read-only turns, verified workers, unrelated
repositories and the existing bounded limitation-report path remain available.
Sync records its source and selected homes in installed settings and source
registration, and pins the installed updater alongside its routing module.
After updating, open a fresh native session to use the new supplied skill roster.

Use `plan` or `check` explicitly for read-only inspection. The lower-level
`update` and `apply` actions still require `--expected-sha` from a reviewed
plan. Automatic sync binds the same hash internally; source drift stops the
update. A content-addressed snapshot contains the public package directories,
excluding local task history and generated trees. Shell text uses canonical
LF, matching a Git export from a Windows checkout; binary assets stay exact.
`update` uses Codex's marketplace/install commands, checks the copied
bundle, disables the named legacy Dely plugin entries, and calls the existing
compliance installer with `--preserve-hooks`. Both native `hooks.json` files
and their existing trust stay unchanged. Credential discovery retains its
previous root. Other plugins and configuration stay intact.

When `dely` is registered to an older snapshot, publication lists the current
marketplaces and replaces only that registration with native remove/add calls
inside the profile backup/rollback transaction. It retains the old snapshot
and plugin caches; no registration is removed when it already selects the
new snapshot. Native plugin installation can prune previous cache versions.
Before native publication, the updater saves every existing cache file under
the profile backup's `plugin-cache` directory. It restores missing files and
verifies their hashes after the native calls, including on failure. Existing
files with different bytes are never overwritten: `CACHE_RESTORE_INCOMPLETE`
stops the update and names the retained backup. Linked cache members or a
replaced cache destination also stop restoration before unsafe writes.

Package roots and files must not be links, including dangling links. Before
backups or publication, the updater checks every managed profile destination
and the existing ancestors of an absent catalog. Destinations must resolve
inside the selected homes; the shared plugin junction between those homes
remains supported. Destinations are checked again after native plugin calls
and installation. Hook bytes for all homes are compared with their original
pre-installation bytes, including after the last home is installed.

The default homes are the set recorded in `current-source.json`. A registered
home with missing settings stops synchronization before profile changes; it
does not silently shrink that set. Invalid registered home lists also stop.
Without a registered set, discovery uses native `~/.codex` and Orca's existing
runtime home. Use repeated `--home` arguments to select existing installations
explicitly.
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

Rollback checks each destination again before restoring and verifies the
restored bytes. If a destination has changed to an unsafe link, the updater
leaves it untouched and reports `ROLLBACK_INCOMPLETE` with the affected path
and retained backups. Resolve that destination before recovering its profile
from the reported backup; do not treat this result as a successful update.

Open a fresh native session after activation. Compare its actual supplied
`dely:delivery` path with `settings.delivery` before the next delegated task.
A live session's earlier skill roster is historical input and must not be
rewritten to claim it loaded the new plugin.

## Verify updater changes

```powershell
node.exe --test scripts/test-sync-dely.js
node.exe --test scripts/test-codex-compliance.js
```

The sync tests use private source/home fixtures, the real compliance installer,
and injected plugin CLI receipts. They cover automatic publish/repair, the
default and explicit CLI, coherent no-op, repeated sync, shared catalogs,
refused links, destination changes during publication, cross-home hook changes
and rollback. They do not install a plugin into the active native homes.
On Windows, a private fixture also uses the real native marketplace commands
to verify registration replacement and retention of an actually installed old
plugin cache. Failure fixtures also exercise shared caches, conflicting bytes
and a replaced restoration destination.
