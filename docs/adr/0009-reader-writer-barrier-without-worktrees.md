---
status: accepted
date: 2026-07-14
---

# Use parallel read waves and a single shared-checkout Writer

V1 will not use Git worktrees. Read-only research, planning, architecture, and review Agents may run concurrently only within a shared Read Wave against one repository fingerprint. All Readers must exit before one Implementation or validation operation obtains an exclusive Writer Lease; no Reader may observe a checkout while it is being mutated.

## Considered options

- Parallel Writers in worktrees, providing implementation throughput but adding branch, merge, cleanup, platform, and failure complexity the product does not trust for V1.
- Parallel Writers in one checkout with file scopes, which cannot isolate the Git index, generated files, test artifacts, formatters, APIs, or schemas.
- A Writer-only lock that allows Readers during mutation, which exposes them to partial repository state.
- Fully serial Agents, maximizing safety but wasting safe research and dual-review concurrency.

## Consequences

SayHi provides parallel reasoning rather than parallel coding and has a hard single-Writer throughput ceiling. The model is understandable and recoverable without isolation, but external editor/shell changes can only be detected through fingerprints, not prevented.
