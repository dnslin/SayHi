# SayHi

SayHi is a clean-room, OMP-native engineering workflow framework. It combines a repository-owned engineering memory, a typed workflow state machine, phase-specific sub-agents, and unchanged upstream Skills.

The executable baseline currently contains only the TypeScript workspace and a shared bootstrap Core contract. It does not claim working workflow, CLI command, Plugin, Hook, Tool, or Agent behavior.

## Status

- Product and architecture decisions: accepted
- Implementation status: bootstrap contract workspace only
- Target license: MIT
- First runtime adapter: Oh-My-Pi (OMP)
- CLI name: `sayhi`
- Project directory: `.sayhi/`
- OMP command namespace: `/sayhi:*`

## Workspace commands

The baseline requires Node.js 22.17 or newer and npm 10.9.2 or newer. From a clean checkout:

```sh
npm ci
npm run build
npm run typecheck
npm run test:contracts
```

`npm run test:contracts` builds the workspace before running the focused contract suite.

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

## Clean-room boundary

Implementation is authored from SayHi's accepted specifications and ADRs plus publicly documented extension contracts. OMP is an integration target, not an implementation source or code dependency.

Contributors MUST NOT copy or adapt OMP or Trellis implementation code, templates, prompts, tests, fixtures, or documentation text. Externally observed behavior must be independently expressed in SayHi contracts and tests, with source attribution recorded in [the references](./docs/references.md).
