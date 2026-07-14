# SayHi

SayHi is a clean-room, OMP-native engineering workflow framework design. It combines a repository-owned engineering memory, a typed workflow state machine, phase-specific sub-agents, and unchanged upstream Skills.

This repository currently contains **design documentation only**. It intentionally contains no executable Core, CLI, Plugin, Hook, Tool, or Agent implementation.

## Status

- Product and architecture decisions: accepted
- Implementation status: not started
- Target license: MIT
- First runtime adapter: Oh-My-Pi (OMP)
- CLI name: `sayhi`
- Project directory: `.sayhi/`
- OMP command namespace: `/sayhi:*`

## Documentation

- [Domain language](./CONTEXT.md)
- [Documentation index](./docs/README.md)
- [Product specification](./docs/spec/product.md)
- [Design trade-offs versus Trellis](./docs/spec/design-tradeoffs.md)
- [System architecture](./docs/spec/architecture.md)
- [Workflow specification](./docs/spec/workflow.md)
- [Data contracts](./docs/spec/data-contracts.md)
- [Configuration specification](./docs/spec/configuration.md)
- [CLI specification](./docs/spec/cli.md)
- [OMP plugin specification](./docs/spec/omp-plugin.md)
- [Security model](./docs/spec/security.md)
- [Supply-chain and update specification](./docs/spec/supply-chain.md)
- [Acceptance criteria](./docs/spec/acceptance.md)
- [Implementation roadmap](./docs/implementation/roadmap.md)
- [Architecture decisions](./docs/adr/)
- [Research references](./docs/references.md)

## Design sources

SayHi studies the behavior and engineering trade-offs of [Trellis](https://github.com/mindfold-ai/Trellis), uses the extension surfaces documented by [Oh-My-Pi](https://omp.sh/docs/plugins), and orchestrates pinned, unchanged Skills sourced through [dnslin/skills](https://github.com/dnslin/skills), including the engineering and productivity Skills from [mattpocock/skills](https://github.com/mattpocock/skills).

Trellis code, templates, prompts, and documentation text are not part of SayHi. Behavioral study does not make Trellis a code dependency.
