---
status: accepted
date: 2026-07-14
---

# Use layered injection with phase manifests and trust tiers

SayHi will combine stable `.omp/AGENTS.md` context, short sticky `.omp/RULES.md`, an ephemeral per-turn workflow envelope, and phase-specific Agent context. Context Manifests freeze exact sources and hashes; every entry is classified as Engine Instruction, Approved Spec, Task Context, or Untrusted Reference, and only the first two may carry instruction authority.

## Considered options

- Inject every Spec, Task, Research file, and Journal on every turn, reducing omission risk but exhausting context and amplifying stale or irrelevant knowledge.
- Select context through semantic search on every turn, adapting dynamically but losing reproducibility.
- Rely only on AGENTS.md and model-directed file reads, which cannot keep dynamic workflow state reliable across long sessions and compaction.

## Consequences

Planning must curate manifests and hash changes can block work as stale. SayHi gains deterministic, inspectable context and a structural defense against external content granting itself authority, while accepting that trust labels do not eliminate model influence.
