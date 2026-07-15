---
status: accepted
date: 2026-07-14
---

# Keep local Task state authoritative over external trackers

The SayHi Task Projection and Event stream are the workflow state authority. GitHub, GitLab, local Markdown, and custom trackers are collaboration projections connected through typed External References and explicit status, pull, push, and conflict-resolution plans; closing an external Issue cannot complete a local Task.

## Considered options

- Make the external tracker authoritative, aligning team UI but losing uniform offline, recovery, and cross-tracker semantics.
- Perform real-time bidirectional synchronization, reducing manual operations but introducing update loops, ambiguous conflicts, permission failures, and unknown network outcomes.
- Avoid tracker integration, preserving simplicity but undermining unchanged `to-spec` and `to-tickets` workflows.

## Consequences

Users may see temporary divergence and must resolve conflicts explicitly. Runtime behavior is consistent and offline-capable, and remote collaboration cannot bypass local quality Gates.
