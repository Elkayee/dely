# Control result evidence

The local journal distinguishes a successful worker from Control acceptance.
`scripts/dely-control-result.js` records acceptance or a reference audit after
checking the native Run coordinator, active Codex terminal, frozen approval and
hashed review artifacts. It creates no journal directory and changes no route.

Create a private decision JSON with `schema_version: 1`,
`reviewer: "codex-control"`, `reviewed_at`, a concrete `reason`, the exact
`assessment_basis_sha256`, and nonempty `evidence_refs`. Each reference has an
absolute `file` and its SHA-256 as `sha256`. Preserve those artifacts; changing
one makes recording fail. Acceptance also requires `run`, `dispatchId` and
`verdict: "accepted"` or `"rejected"`:

```text
node scripts/dely-control-result.js acceptance --run RUN --dispatch DISPATCH --assessment-file APPROVED.json --evidence-file CONTROL.json
```

The receipt-confirmed implementation and exact native worker must match the
assessment. Acceptance requires a durable completed successful result. Neither
`worker_done` nor a supplied reviewer string establishes that result alone.
The command appends `task_control_result`; the journal contains the decision
hash and bindings, without the review text or source file paths.

For reference auditing, use `case_id` and `reference_difficulty` instead of a
worker verdict. Control must actually adjudicate the reference against source
evidence before recording it:

```text
node scripts/dely-control-result.js audit --run RUN --assessment-file APPROVED.json --evidence-file AUDIT.json
```

This appends `task_reference_audit`. The monitor joins each case/basis to its
system decision; it does not infer a reference grade from adoption or candidate
metadata. Missing, conflicting or unbound evidence stays pending/unevaluated.
Synthetic test/probe adjudications do not establish ordinary workload leakage.
See [metric denominators and windows](usage-monitor.md).
