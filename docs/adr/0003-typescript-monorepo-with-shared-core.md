---
status: accepted
date: 2026-07-14
---

# Use a TypeScript monorepo with one shared Core

SayHi Core, CLI, OMP Plugin, and testing support will live in one TypeScript monorepo. CLI and Plugin call the same Core application services in-process; Core does not import OMP APIs and exposes ports for filesystem, Git, process, clock, tracker, and runtime behavior.

## Considered options

- A native Rust or Go CLI called as a subprocess by the Plugin, gaining a standalone binary but adding process startup, JSON-RPC, packaging, and version-handshake complexity to every runtime operation.
- Separate CLI and Plugin implementations, making early prototypes easy but allowing state, lock, and migration behavior to diverge.
- An OMP-only Plugin with no reusable Core, reducing packages but locking durable state semantics to one adapter.

## Consequences

Node-compatible JavaScript is a runtime prerequisite and package boundaries require discipline. In return, domain invariants have one implementation, OMP custom Tools avoid parsing CLI output, and future adapters can reuse Core.
