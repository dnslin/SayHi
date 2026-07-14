---
status: accepted
date: 2026-07-14
---

# Classify file ownership and perform hash-aware updates

SayHi classifies generated project files as Engine-owned, User-owned, or Managed-customizable. Updates compare the installed base, local content, and incoming base; unmodified Engine-owned content may update automatically, User-owned content is never template-replaced, and ambiguous changes preserve local/base/incoming variants and stop.

## Considered options

- Overwrite generated paths during every update, simplifying maintenance but destroying local changes and potentially user instructions.
- Never update initialized project files, protecting content but allowing old Hooks, Agent contracts, and schemas to become incompatible with new CLI/Plugin releases.
- Require users to edit generated files directly, making customization easy but erasing a reliable ownership boundary.

## Consequences

SayHi must maintain ownership manifests, Managed Block parsers, migration plans, conflict reports, and uninstall tests. Updates remain reviewable and reversible within safe file boundaries instead of assuming framework ownership of the repository.
