---
status: accepted
date: 2026-07-14
---

# Persist task state as Events plus a Projection

Every durable Task will keep an append-only `events.jsonl` and a human-readable `task.json` Projection. Core appends an accepted, sequenced, idempotent Workflow Event before atomically replacing the Projection; a missing or lagging Projection can be rebuilt by deterministic replay.

## Considered options

- A mutable `task.json` only, which is simple but cannot explain transitions, deduplicate retries, or reliably recover partial updates.
- An Event Log only, which is auditable but makes every Hook read and human inspection require replay.
- A database, which provides transactions but conflicts with repository-owned, reviewable, portable state in V1.

## Consequences

Schemas, replay logic, digest chains, migrations, and recovery tests become mandatory. Per-turn reads remain bounded, state formation is auditable, and process interruption does not require inventing missing history.
