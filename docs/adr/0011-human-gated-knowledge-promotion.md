---
status: accepted
date: 2026-07-14
---

# Require human approval for shared knowledge promotion

Research, Review, Evidence, and Workspace Journals may produce provenance-bearing Knowledge Candidates. A Knowledge Agent can classify and propose a target, but only a human-approved promotion Event may change an Approved Spec, ADR, domain document, or runbook.

## Considered options

- Automatically promote high-confidence findings at Finish, increasing learning speed but allowing model errors and one-off patterns to become global instructions.
- Store only Journals, avoiding promotion complexity but leaving future Agents unable to consume durable rules reliably.
- Let the Knowledge Agent edit shared documents and rely on later code review, which grants a read-oriented role too much authority.

## Consequences

Knowledge review adds Finish work and some candidates may remain pending. Shared instructions retain provenance, conflicts are visible, and changing a Spec correctly invalidates active Context Manifests.
