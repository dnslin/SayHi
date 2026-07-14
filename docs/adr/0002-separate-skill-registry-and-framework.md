---
status: accepted
date: 2026-07-14
---

# Separate the Skill Registry from the SayHi framework

`dnslin/skills` remains a rolling Skill Registry, while `dnslin/sayhi` is an independent framework repository. SayHi pins one immutable Registry commit, vendors selected Skills at build time, verifies per-file hashes and upstream licenses, and never resolves the rolling Registry at runtime.

## Considered options

- Put SayHi inside the Skill Registry, coupling framework releases to daily upstream synchronization and duplicating generated Plugin snapshots.
- Resolve Registry Skills at runtime, reducing package size but making behavior non-reproducible and vulnerable to name collisions or unavailable network state.
- Copy Skills manually into SayHi, losing a single provenance and update workflow.

## Consequences

Releases require a deliberate lock-update PR and coordination between two repositories. Installed workflows remain offline and reproducible, and the Registry can continue collecting unrelated Skills without changing SayHi behavior.
