# SayHi Design Documentation

These documents are the accepted design baseline for SayHi. Normative words such as **MUST**, **MUST NOT**, **SHOULD**, and **MAY** describe implementation requirements.

## Specifications

1. [Product specification](./spec/product.md) — goals, scope, users, requirements, and constraints.
2. [Design trade-offs versus Trellis](./spec/design-tradeoffs.md) — explicit benefits, costs, failure modes, and review triggers.
3. [System architecture](./spec/architecture.md) — contexts, dependencies, ownership, and runtime topology.
4. [Workflow specification](./spec/workflow.md) — Routes, Phases, Gates, failures, and scheduling.
5. [Data contracts](./spec/data-contracts.md) — Project Store records and invariants.
6. [Configuration specification](./spec/configuration.md) — committed, local, environment, and policy settings.
7. [CLI specification](./spec/cli.md) — command surface, safety, output, and exit behavior.
8. [OMP plugin specification](./spec/omp-plugin.md) — commands, hooks, tools, Agents, and injection.
9. [Security model](./spec/security.md) — trust boundaries, threats, and controls.
10. [Supply chain and updates](./spec/supply-chain.md) — Skill pinning, licensing, reproducible builds, and managed files.
11. [Acceptance criteria](./spec/acceptance.md) — milestone-level executable behavior.

## Planning

- [Implementation roadmap](./implementation/roadmap.md)
- [Research references](./references.md)

## Domain language

- [Root context](../CONTEXT.md)

## Architecture decisions

[ADR index](./adr/README.md) lists the hard-to-reverse decisions with meaningful alternatives. The specifications are authoritative for detailed behavior; ADRs explain why foundational choices were made.

## Authority order

If documents disagree, resolve them in this order:

1. A newer accepted or superseding ADR for the specific decision.
2. The normative specification dedicated to the subject.
3. The product specification.
4. The implementation roadmap.
5. Non-normative examples.

Any resolved conflict MUST update every affected document in the same change.
