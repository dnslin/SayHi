---
status: accepted
date: 2026-07-14
---

# Build SayHi clean-room and target OMP first

SayHi will independently implement the accepted behavioral specifications and will not copy Trellis code, templates, prompts, or documentation text. V1 will deeply integrate with Oh-My-Pi rather than maintaining several shallow platform adapters; Core remains adapter-independent so later platforms can be added without replacing the domain model.

## Considered options

- Modify or strip down Trellis, which would accelerate implementation but inherit its content architecture, update surface, and AGPL obligations.
- Build several adapters in V1, which would force the initial Core toward a lowest-common-denominator runtime before OMP behavior is proven.
- Build OMP-specific code without a separate Core, which would make later extraction expensive.

## Consequences

Implementation starts slower because behavior must be specified and tested independently. SayHi gains a clear licensing and product boundary, can use OMP-native hooks, Tools, task agents, and compaction behavior fully, and accepts that V1 is not a cross-agent replacement for Trellis.
