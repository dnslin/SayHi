# Issue #31 — Markdown Tracker projection design

## Scope

Implement the first Tracker adapter as a deterministic Core operation. It projects the locally authoritative Task Projection into Markdown; it never accepts Markdown as a source of Workflow Events or lifecycle state.

## Confirmed public seams

1. **Core Markdown tracker operation**: create/update a task entry from a `WorkflowState`, returning a typed result that distinguishes created, unchanged, updated, and reconciliation-required outcomes. The operation is deterministic and idempotent for the same local state.
2. **Tracker file boundary**: a minimal filesystem port exposes explicit read/write operations. The adapter detects a user-edited generated entry using its recorded local projection identity, preserves the observed Markdown and local state in a conflict result, and requires a later explicit reconciliation decision.

## Invariants

- The Markdown projection is derived only from accepted local Workflow Events/Projection data.
- Reapplying an unchanged local Task does not alter the tracker file.
- Tracker entries use Task ID code-unit ordering, never host locale collation, so the same local state renders the same bytes everywhere.
- A manually edited generated entry is not silently overwritten or used to change local Task state.
- Blocked and archived entries render from accepted local Task state. A `deleted` Tracker tombstone is anchored to the last accepted local Task State and remains distinct from the local `cancelled` lifecycle.
- No GitHub/GitLab API, CLI sync command, or bidirectional tracker behavior belongs in this issue; those are separately tracked by #32 and #33.

## Representation

- A Markdown document holds one marker-delimited entry per Task and preserves user text outside the generated entries.
- A versioned tracker sidecar retains each generated entry's exact base text and SHA-256 identity. This supports a fail-closed three-way reconciliation result containing base, observed local Markdown, and incoming local-authority Markdown.
- An explicit resolution selects either the local-authority incoming form or the observed Markdown form for one generated entry. A foreign edit to the generated root container may only be explicitly replaced by the local form; preserving it requires moving that text outside the generated container. Neither path mutates Workflow Event history.

## Verification

Add direct Core contract tests at those seams: lifecycle rendering/idempotency, manual edit conflict/reconciliation, and stable blocked/archived/deleted forms. Reuse the repository's existing Node test / `packages/testing` convention, then run the focused test, typecheck, and full suite.
