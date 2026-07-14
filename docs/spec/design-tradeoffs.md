# SayHi Design Trade-offs

**Status:** Accepted design analysis  
**Date:** 2026-07-14  
**Scope:** SayHi V1 compared with the currently documented Trellis product and workflow

## 1. Purpose and comparison boundary

This document makes the costs of the accepted SayHi design explicit. It is not a claim that SayHi is categorically better than Trellis. Trellis is an implemented, multi-platform product; SayHi is currently a design baseline for an OMP-first product.

The Trellis side of the comparison is limited to behavior described in its public [repository README](https://github.com/mindfold-ai/Trellis) and [repository workflow](https://github.com/mindfold-ai/Trellis/blob/main/.trellis/workflow.md). SayHi conclusions are design expectations, not measured implementation results.

## 2. Shared foundations

SayHi deliberately retains several general ideas that are already strong in Trellis:

- repository-owned Specs, Tasks, Research, Workspace records, and Journals;
- planning before implementation;
- automatic delivery of relevant engineering context;
- phase-oriented sub-agent execution;
- review against project standards and task intent;
- durable learning after work completes;
- session recovery from files rather than conversation memory.

These are not differentiation claims. They are the foundation on which SayHi adds stricter runtime contracts and a different Skill boundary.

## 3. Decision matrix

| Dimension | Trellis documented behavior | SayHi V1 decision | SayHi benefit | SayHi cost or risk |
| --- | --- | --- | --- | --- |
| Product maturity | Implemented, released, documented, and used across many agent platforms | Design-only until the roadmap is implemented | Clean domain boundaries can be chosen before compatibility debt exists | Trellis is immediately usable; SayHi has delivery, adoption, and correctness risk |
| Platform reach | One project layer across multiple coding-agent platforms | Deep OMP adapter first; future adapters are out of V1 | OMP hooks, Tools, task Agents, compaction, and installation can be used without lowest-common-denominator compromises | OMP coupling is high and non-OMP users receive no V1 value |
| Workflow shape | A compact Plan → Implement → Verify → Finish loop | Quick, Build, and Initiative Routes over seven Phases | Ceremony can scale with risk, and integration is modeled separately from review | More states, transitions, commands, documentation, and failure modes |
| State authority | Task files, workflow files, breadcrumbs, and scripts coordinate progress | Core alone accepts typed Events; `task.json` is a replayable Projection | Deterministic transition checks, retry deduplication, auditability, and interruption recovery | Event schemas, replay, migrations, locks, digest chains, and repair tooling are substantial infrastructure |
| Context delivery | Curated spec and task context is injected for work and checking | Hash-bound Context Manifests plus four trust tiers and four injection layers | Reproducible phase context, stale-context rejection, and explicit prompt-injection boundaries | Manifest maintenance can block legitimate work and increase token and operational overhead |
| Agent control | Workflow Skills and sub-agents perform planning, implementation, and checking | Namespaced Phase Agents have versioned Capability Contracts, bounded tools, schemas, and fingerprint checks | A role cannot silently expand its authority, and stale outputs can be rejected | Tool sealing is adapter-specific; model behavior is still probabilistic inside the allowed capability set |
| Engineering methods | Trellis ships its own workflow content and generated platform assets | Matt engineering and productivity Skills remain unchanged, pinned, and externally attributable | Framework policy is separated from engineering technique; Skill provenance and upgrades are reviewable | External Skill structure can drift, pin upgrades require human work, and incompatible methods may need sidecars rather than edits |
| Knowledge promotion | Finish includes updating Specs with new learning | Agents produce provenance-bearing candidates; only a human can promote them | Prevents unreviewed model output from becoming future instruction authority | Review fatigue can leave useful knowledge unpromoted and the Spec base stale |
| Parallelism | Phase sub-agents structure work; public overview does not promise isolated concurrent writers | Parallel read waves plus one exclusive shared-checkout Writer | Safe reasoning parallelism without worktree lifecycle and merge complexity | There is no parallel coding throughput; a slow Writer blocks every ready implementation node |
| Dependency planning | Work is organized incrementally around tasks | Initiative uses a typed DAG, readiness rules, blockers, and resource claims | Cross-task order and integration become explicit and machine-checkable | Graph decomposition can be wrong, resource claims can be incomplete, and maintaining the graph adds planning cost |
| Git behavior | The documented implementation sub-agent does not commit | Reviewed Build and Initiative work may produce a scoped task commit; Quick never auto-commits | Evidence and a precise reviewed change can be bound to one commit | Dirty working trees and user changes make safe scoping difficult; commit automation needs conservative refusal paths |
| External trackers | Not a central authority in the public workflow overview | Local Task is authoritative; trackers are explicit projections | Agent execution does not depend on remote availability or ambiguous webhook ordering | Teams may see lag between local and tracker state and must resolve conflicts deliberately |
| File updates | Generated assets and template hashes support managed setup | Owned files, Managed Blocks, install manifests, and three-way update plans | User content can coexist with generated content and upgrades can surface conflicts | Ownership metadata and merge-base retention are complex; malformed markers require manual recovery |
| Supply chain | Trellis is installed as its own product and carries its repository license | Clean-room SayHi implementation targets MIT and locks exact Skill sources and hashes | Clear separation from Trellis source and reproducible Skill inputs | Clean-room discipline slows development; target licensing remains only a plan until implementation provenance is audited |
| Runtime footprint | Current README lists Node.js and Python prerequisites | One TypeScript Core is planned with OMP and CLI adapters sharing it | One schema and transition implementation can serve both entry points | This benefit is unproven until packaging, cross-platform filesystem behavior, and OMP compatibility are tested |

## 4. Where Trellis is the better choice

Trellis is the stronger choice when any of the following dominates:

- the team needs a working framework now rather than a new product-development effort;
- the same workflow must support several agents or IDEs immediately;
- a compact four-phase mental model is more valuable than typed lifecycle precision;
- the team accepts Trellis's shipped workflow content and licensing terms;
- maintaining Event replay, leases, manifests, capability contracts, and a Skill lockfile would exceed the team's operational budget;
- parallel coding is not required and formal Initiative dependency planning would be unnecessary ceremony.

SayHi MUST NOT describe parity with Trellis on maturity or platform breadth before evidence demonstrates it.

## 5. Where SayHi is intended to be the better choice

SayHi is intended to be stronger when all or most of the following matter:

- OMP is the primary coding agent and native integration depth matters more than platform breadth;
- workflow correctness must be enforced by code rather than prompt convention alone;
- exact task state and context inputs must survive retries, compaction, and session changes;
- engineering Skills should remain separately sourced, pinned, unchanged, and attributable;
- untrusted Research and Agent-generated knowledge must not silently gain instruction authority;
- large work needs a dependency graph, explicit blockers, and final integration evidence;
- the team rejects worktree-based coordination but still wants safe parallel research and review;
- generated project files must be updatable and uninstallable without owning whole user files.

These are hypotheses until validated by the acceptance suite and real project trials.

## 6. Critical SayHi failure modes

### 6.1 Framework over-engineering

The Core can become a workflow operating system whose maintenance cost exceeds the coding work it assists.

Controls:

- Quick MUST avoid durable ceremony until a material change or escalation occurs.
- Milestones MUST deliver vertical user-visible behavior, not isolated infrastructure layers.
- A feature without an acceptance case and observed user need MUST remain outside V1.

### 6.2 False confidence from deterministic wrappers

Typed state and sealed tools cannot make model reasoning deterministic or guarantee code quality.

Controls:

- deterministic checks validate authority, identity, state, evidence shape, and repository freshness;
- model quality remains subject to independent review and executable validation;
- acceptance claims MUST distinguish deterministic invariants from probabilistic evaluations.

### 6.3 Shared-checkout interference

External editors, shells, formatters, and humans can mutate the repository without respecting SayHi's Writer Lease.

Controls:

- fingerprint before dispatch, before write, and before acceptance;
- refuse stale outputs and preserve user changes;
- make lease status visible;
- never claim isolation equivalent to a worktree, container, or remote workspace.

Residual risk: fingerprints detect interference after observation; they cannot prevent it.

### 6.4 Repository noise and merge conflicts

Committed Events, Projections, Manifests, Journals, and graphs can create review noise or branch conflicts.

Controls:

- use one append-only Event stream per Task rather than one global stream;
- keep runtime state out of Git;
- bound Journal formats and archive completed records;
- measure artifact churn during real trials before enabling team-wide adoption.

### 6.5 Context staleness and approval fatigue

Strict hashes can interrupt work after harmless Spec edits, while human promotion gates can accumulate queues.

Controls:

- stale manifests provide a deterministic rebuild plan;
- only required entries block;
- candidate review supports batch accept, reject, and supersede without automatic promotion;
- metrics track stale-manifest frequency and candidate age.

### 6.6 OMP lifecycle drift

OMP plugin contracts, hook timing, task-agent discovery, or packaging can change independently.

Controls:

- isolate all OMP APIs in one adapter;
- negotiate capabilities at startup;
- pin and test a supported OMP range;
- fail visibly when a required capability is absent.

### 6.7 Skill supply-chain drift

The rolling Skill Registry can move, upstream files can be reorganized, and legal metadata can change.

Controls:

- releases consume an immutable Registry commit and per-file hashes;
- runtime never fetches Skills;
- upgrade plans show content, provenance, and license changes;
- bundled Skill text is not patched in place.

## 7. Review triggers

The accepted design MUST be reconsidered through a new ADR if evidence shows any of the following:

- OMP cannot provide a stable hook or task-Agent boundary required by capability sealing;
- shared-checkout fingerprints produce unacceptable false blocks or missed interference;
- repository-owned Events and Manifests cause recurring merge conflicts in normal team use;
- Quick routinely escalates because its classification boundary is too narrow;
- single-Writer throughput dominates end-to-end Initiative time;
- human knowledge queues remain unreviewed long enough to defeat knowledge accumulation;
- unchanged upstream Skills cannot be composed without contradictory instructions;
- a second runtime adapter requires Core concepts to depend on OMP semantics.

Crossing a trigger does not automatically select a replacement. It requires measured evidence, alternatives, migration impact, and an explicit accepted ADR.
