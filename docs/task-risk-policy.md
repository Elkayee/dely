# Task risk policy

Use Dely for confirmed, reversible internal Easy, Medium- and Medium+ changes.
Classify the changed behavior and its consequences, rather than the repository,
topic, file count, or the fact that a worker will be dispatched. Codex Control
reviews the evidence and the Jev result before any implementation.

The six `context.risks` booleans mean consequential effects. Set a flag to
`true` only when the scoped task causes the corresponding effect below, and
record that concrete effect in `context.evidence`. Check the spec as well:
setting a flag to `false` cannot hide an effect described elsewhere.

| Flag | Consequential effect that selects Hard | Examples that do not select Hard merely by topic |
| --- | --- | --- |
| `security` | Changes authentication, authorization, trust boundaries, secret access, or permission enforcement | Documentation or tests of existing authentication; display-only account UI |
| `data` | Destructive authoritative-data changes, sensitive-data exposure, persisted schema compatibility, or business meaning | Read-only retrieval, a private parser with preserved semantics, fixture formatting |
| `public_contract` | Changes a public interface or its compatibility guarantees | Internal helpers, documentation corrections that preserve the contract |
| `architecture` | Changes system boundaries or needs consequential unresolved architecture decisions | A known internal extraction or coordinated changes within established boundaries |
| `production` | Live production cutover, migration, or consequential rollout | Local implementation and focused tests in a worktree; a repository used in production |
| `routing` | Changes delegation policy, admission gates, fallback authority, or worker ownership | Ordinary Dely dispatch using the existing reviewed policy; routine worktree coordination |

Do not turn an unknown effect into `false`. Missing or contradictory evidence
stays `NOT_EVALUATED` until Control resolves it. A known consequential effect
still selects Hard even when the diff is one line. Do not average away a Hard
finding, bypass model/footer checks, or downgrade a higher-risk Jev answer.

Medium- has known ownership, low coupling and focused acceptance. Medium+
coordinates known internal components with bounded reversible effects and
integrated acceptance. A refactor or integration can fit these grades when
boundaries, owners, rollback and acceptance are already understood.

Policy `jev-task-routing-v3` uses Flash 3.8 Medium/default for Easy and Medium-.
Medium+ uses Codex Sol/medium, with Luna/max only for explicit quota. A
successful nonempty AGY catalog proving a requested model absent also permits Luna/max. Hard stays
direct Codex Sol/xhigh. Reassess earlier policy records; never rewrite an old
assessment to make it look newly evaluated.

Measure adoption from actual assessment and dispatch evidence. Separate probes,
tests, incomplete evaluations and latest-session snapshots from ordinary task
history; a successful probe does not establish an ordinary usage percentage.
