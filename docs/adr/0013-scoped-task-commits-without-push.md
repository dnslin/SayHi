---
status: accepted
date: 2026-07-14
---

# Permit scoped task commits but never automatic push

An authorized Build or Initiative node may create a commit after Review and validation pass, provided the repository fingerprint, Task scope, adopted baseline, and index are safe. Quick never commits automatically. SayHi does not push or perform automatic stash, reset, rebase, revert, forced checkout, or history rewriting.

## Considered options

- Ask before every node commit, maximizing immediate control but repeatedly interrupting large Initiatives after the user already authorized managed execution.
- Never commit, preserving manual control but weakening the binding among code, evidence, graph dependencies, and recovery.
- Commit and push automatically, maximizing automation but causing external side effects and branch-policy risk beyond the accepted workflow authority.

## Consequences

Baseline capture, adoption, path ownership, explicit staging, uncertain-result diagnosis, and commit Evidence are mandatory. SayHi can produce stable checkpoints without taking control of remote branches or hiding unrelated user work.
