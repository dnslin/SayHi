---
status: accepted
date: 2026-07-14
---

# Own durable engineering memory in a repository Project Store

SayHi will create a committed `.sayhi/` Project Store for scoped Specs, Tasks, task-local and shared Research, Workspaces, Journals, workflow definitions, evidence, and archives. Artifacts created elsewhere by unchanged Skills or trackers remain canonical at their original location and are connected through typed External References instead of mirrored copies.

## Considered options

- A thin control plane containing only state and references, which minimizes repository files but fails to provide the durable engineering memory the product requires.
- Copy every external Issue, ADR, CONTEXT file, or Handoff into `.sayhi/`, making the store self-contained but creating two writable truths.
- Treat Skill-default paths and external trackers as the Project Store, which prevents a uniform CLI lifecycle and reliable injection contract.

## Consequences

Managed repositories gain visible workflow artifacts and must review their changes. SayHi can recover across sessions and curate context deterministically without claiming ownership of documents governed by other tools.
