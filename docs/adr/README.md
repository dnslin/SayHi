# SayHi Architecture Decision Records

Accepted ADRs:

1. [Build SayHi clean-room and target OMP first](./0001-clean-room-omp-first.md)
2. [Separate the Skill Registry from the SayHi framework](./0002-separate-skill-registry-and-framework.md)
3. [Use a TypeScript monorepo with one shared Core](./0003-typescript-monorepo-with-shared-core.md)
4. [Own durable engineering memory in a repository Project Store](./0004-repository-owned-project-store.md)
5. [Use three Routes over a seven-Phase workflow](./0005-route-aware-seven-phase-workflow.md)
6. [Persist task state as Events plus a Projection](./0006-event-log-and-task-projection.md)
7. [Use layered injection with phase manifests and trust tiers](./0007-layered-context-and-trust.md)
8. [Seal Phase Agent capabilities independently from prompts](./0008-capability-sealed-phase-agents.md)
9. [Use parallel read waves and a single shared-checkout Writer](./0009-reader-writer-barrier-without-worktrees.md)
10. [Keep local Task state authoritative over external trackers](./0010-local-task-authority-for-trackers.md)
11. [Require human approval for shared knowledge promotion](./0011-human-gated-knowledge-promotion.md)
12. [Classify file ownership and perform hash-aware updates](./0012-owned-files-and-three-way-updates.md)
13. [Permit scoped task commits but never automatic push](./0013-scoped-task-commits-without-push.md)

The detailed specifications are normative. ADRs explain why the foundational choices were made and should be superseded, not silently rewritten, when those choices change.
