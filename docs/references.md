# Research References

These sources informed the SayHi design. They are references for behavior and integration constraints, not copied implementation dependencies.

## Trellis

- [Repository and README](https://github.com/mindfold-ai/Trellis)
- [Current workflow model](https://github.com/mindfold-ai/Trellis/blob/main/.trellis/workflow.md)
- [OMP runtime extension](https://github.com/mindfold-ai/Trellis/blob/main/.omp/extensions/trellis/index.ts)
- [OMP configurator](https://github.com/mindfold-ai/Trellis/blob/main/packages/cli/src/configurators/omp.ts)
- [Template hash behavior](https://github.com/mindfold-ai/Trellis/blob/main/packages/cli/src/utils/template-hash.ts)
- [AGPL-3.0 license](https://github.com/mindfold-ai/Trellis/blob/main/LICENSE)

SayHi preserves general lessons such as durable repository artifacts, session-scoped active work, context manifests, state breadcrumbs, compaction recovery, and hash-aware updates. It does not reuse Trellis code, templates, prompt bodies, or documentation wording.

## Oh-My-Pi

- [Plugin documentation](https://omp.sh/docs/plugins)
- [Context file behavior](https://github.com/can1357/oh-my-pi/blob/main/docs/context-files.md)
- [Hook lifecycle](https://github.com/can1357/oh-my-pi/blob/main/docs/hooks.md)
- [Custom Tools](https://github.com/can1357/oh-my-pi/blob/main/docs/custom-tools.md)
- [Task Agent discovery and capability fields](https://github.com/can1357/oh-my-pi/blob/main/docs/task-agent-discovery.md)
- [Slash command behavior](https://github.com/can1357/oh-my-pi/blob/main/docs/slash-command-internals.md)
- [Skills](https://github.com/can1357/oh-my-pi/blob/main/docs/skills.md)
- [Plugin installation plumbing](https://github.com/can1357/oh-my-pi/blob/main/docs/plugin-manager-installer-plumbing.md)
- [MIT license](https://github.com/can1357/oh-my-pi/blob/main/LICENSE)

OMP is the V1 runtime adapter. SayHi Core must not depend on undocumented assumptions when a supported public/runtime contract is available.

## Matt Pocock Skills

- [Skills repository](https://github.com/mattpocock/skills)
- [Engineering collection](https://github.com/mattpocock/skills/tree/main/skills/engineering)
- [Productivity collection](https://github.com/mattpocock/skills/tree/main/skills/productivity)
- [`ask-matt`](https://github.com/mattpocock/skills/blob/main/skills/engineering/ask-matt/SKILL.md)
- [`implement`](https://github.com/mattpocock/skills/blob/main/skills/engineering/implement/SKILL.md)
- [`code-review`](https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md)
- [`setup-matt-pocock-skills`](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/SKILL.md)
- [MIT license](https://github.com/mattpocock/skills/blob/main/LICENSE)

SayHi vendors selected releases unchanged and supplies separate sidecar capability metadata.

## Skill Registry

- [`dnslin/skills`](https://github.com/dnslin/skills)
- [Recorded upstream versions](https://github.com/dnslin/skills/blob/main/UPSTREAM_VERSIONS.md)
- [Upstream synchronization script](https://github.com/dnslin/skills/blob/main/scripts/sync-upstream-skills.sh)
- [Upstream synchronization workflow](https://github.com/dnslin/skills/blob/main/.github/workflows/sync-upstream-skills.yml)

The Registry is a rolling build-time source. A SayHi release pins a full commit and verifies exact files independently.

## Time standards

- [IERS Bulletin C leap-second data](https://hpiers.obspm.fr/iers/bul/bulc/Leap_Second.dat)
- [IANA leap-second list](https://data.iana.org/time-zones/tzdb/leap-seconds.list)

The version 1 timestamp validator uses the leap seconds published through IERS Bulletin 72 (July 2026). A newly announced leap second requires a validation-contract update.
