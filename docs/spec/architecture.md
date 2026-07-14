# SayHi System Architecture

**Status:** Accepted design baseline

## 1. Architectural style

SayHi uses a ports-and-adapters architecture around a deterministic domain Core. The Core owns concepts and invariants; adapters supply filesystem, Git, clock, process, tracker, and agent-runtime capabilities.

```text
                         dnslin/skills
                              |
                     build-time pinned import
                              v
+-------------------- SayHi source repository --------------------+
|  Core  <-----  CLI Adapter                                      |
|   ^                                                            |
|   +--------  OMP Plugin Adapter                                 |
|   +--------  Future Adapter Ports (not implemented in V1)       |
+----------------------------------------------------------------+
             |                         |
             v                         v
      .sayhi/ Project Store       OMP session/runtime
             |                         |
             +----------+--------------+
                        v
              user repository and Git
                        |
                        v
              optional Tracker adapters
```

Core MUST remain callable in-process by both CLI and Plugin. The OMP Plugin MUST NOT shell out to the CLI for ordinary state reads or transitions.

## 2. Source repository topology

The intended implementation repository is:

```text
sayhi/
├── package.json
├── packages/
│   ├── core/
│   │   ├── state-machine/
│   │   ├── task-store/
│   │   ├── project-store/
│   │   ├── context/
│   │   ├── graph/
│   │   ├── scheduling/
│   │   ├── knowledge/
│   │   ├── trackers/
│   │   ├── git/
│   │   ├── migrations/
│   │   └── schemas/
│   ├── cli/
│   ├── omp-plugin/
│   └── testing/
├── registry/
│   └── skills/                  # SayHi sidecar capability metadata
├── vendor/
│   └── skills/                  # build-generated, locked Skill snapshot
├── scripts/                     # build and provenance automation
├── docs/
├── CONTEXT.md
├── LICENSE
└── THIRD_PARTY_NOTICES.md
```

This is an implementation target, not a requirement that generated project content mirror source-package boundaries.

## 3. Bounded contexts

### 3.1 Workflow context

Owns Routes, Phases, Steps, Gates, transition rules, Workflow Events, and Projections.

It does not execute shell commands or understand OMP message formats.

### 3.2 Project Memory context

Owns Specs, Tasks, Research, Workspaces, Journals, evidence references, archives, ownership classes, and schema migrations.

It does not decide whether a transition is legal.

### 3.3 Context Delivery context

Owns Context Manifests, trust tiers, content identity, token-aware injection modes, and context freshness.

It does not grant Agent tools or promote knowledge.

### 3.4 Agent Execution context

Owns Phase Agent contracts, Agent identity, dispatch requests, output validation, Read Waves, Writer Leases, and repository fingerprints.

It does not interpret an Agent's prose as an accepted transition.

### 3.5 Planning context

Owns Initiative graphs, typed edges, Resource Claims, readiness, blocker propagation, and graph revisions.

### 3.6 Knowledge context

Owns Knowledge Candidates, classification, conflict detection, promotion decisions, and supersession provenance.

### 3.7 Integration context

Owns external Tracker adapters and typed External References. Local Task state remains outside this context and authoritative.

### 3.8 Supply Chain context

Owns Skill Lock generation, provenance, license inventory, sidecar compatibility, release manifests, and generated-file update policy.

## 4. Dependency rules

The implementation MUST obey these dependency directions:

```text
schemas and domain values
        ^
        |
workflow / memory / context / graph / knowledge
        ^
        |
application services in Core
        ^
        |
CLI, OMP, filesystem, Git, process, tracker adapters
```

- Domain code MUST NOT import OMP APIs.
- Domain code MUST NOT read process-global environment directly.
- Filesystem and Git operations MUST be represented by injected ports.
- Adapters MAY translate domain errors but MUST NOT bypass domain validation.
- CLI and OMP MUST use the same application services and schemas.
- Prompt templates MUST NOT duplicate authoritative transition tables; they are generated from or validated against Core definitions.

## 5. Managed Project topology

```text
repository/
├── .sayhi/
│   ├── config.yaml
│   ├── manifest.json
│   ├── spec/
│   ├── tasks/
│   │   ├── <active-task>/
│   │   └── archive/<year-month>/
│   ├── research/
│   ├── workspace/<developer>/
│   ├── workflow/
│   ├── overrides/
│   └── .runtime/
├── .omp/
│   ├── AGENTS.md
│   ├── RULES.md
│   ├── agents/
│   └── plugin state managed by OMP
├── AGENTS.md                       # optional portable managed pointer
└── project source
```

`.sayhi/.runtime/` MUST be ignored by Git. Durable Tasks, Specs, accepted workflow definitions, and shared Project Store metadata SHOULD be committed.

## 6. Component responsibilities

### 6.1 Core

Core exposes application-level operations such as:

- initialize or inspect a Project Store;
- create, classify, escalate, transition, block, complete, or archive a Task;
- append and replay Workflow Events;
- validate and project task state;
- build and verify Context Manifests;
- calculate graph readiness and blocker propagation;
- acquire, renew, release, or diagnose leases;
- capture and compare repository Baselines;
- validate Agent dispatch and outputs;
- propose and promote knowledge;
- calculate safe file updates and migrations;
- prepare tracker synchronization plans.

Operations MUST return typed success or domain-error values suitable for CLI JSON output and OMP Tool results.

### 6.2 CLI

The CLI is the administrative and human-facing adapter. It renders plans and diagnostics, obtains interactive consent, and invokes Core operations. It MUST support headless JSON mode without assuming a TTY.

### 6.3 OMP Plugin

The OMP Plugin adapts OMP events and tools to Core operations. It owns no alternative task state. Its responsibilities include:

- the `/sayhi:flow` entry point;
- per-session active-Task binding;
- stable and sticky instruction installation;
- dynamic workflow-state injection;
- custom model-callable workflow Tools;
- namespaced Phase Agent definitions;
- compaction and session-change recovery;
- user-facing status and approval rendering.

### 6.4 Skill bundle

The bundle contains exact Skill files selected from a locked Skill Registry revision. Sidecar records define how SayHi may expose or autoload a Skill. Runtime state never depends on parsing arbitrary Skill prose for permissions.

## 7. Runtime control flow

### 7.1 Session start

```text
OMP session_start
  -> locate repository and Project Store
  -> validate installed manifest compatibility
  -> resolve session binding or explicit resume target
  -> read Task Projection (bounded read)
  -> verify Projection/Event consistency
  -> display SayHi status
```

A failure to validate MUST produce a visible degraded or blocked state. SayHi MUST NOT silently fall back to an unrelated Task.

### 7.2 User turn

```text
user prompt
  -> classify unmanaged vs managed intent
  -> resolve active Task and Phase
  -> build dynamic workflow envelope
  -> inject trust-separated content
  -> Orchestrator reasons and invokes a typed Tool or Phase Agent
```

The Hook does not advance state. The model does not write `task.json` directly.

### 7.3 Phase Agent dispatch

```text
Orchestrator dispatch request
  -> validate Task/version/Phase/Agent role
  -> verify Agent identity and Capability Contract
  -> verify Context Manifest and Base Fingerprint
  -> acquire shared read or exclusive writer/validation lease
  -> run OMP Task Agent
  -> validate structured output and fingerprint
  -> release lease
  -> persist artifact/evidence through Core
  -> separately request an allowed transition
```

Agent output that fails its schema or references a stale fingerprint MUST be stored as diagnostic evidence at most; it MUST NOT complete a Gate.

### 7.4 State transition

```text
workflow_advance(expectedVersion, outcome, evidence, idempotencyKey)
  -> acquire task mutation lock
  -> load and validate Projection/Event head
  -> validate allowed transition and Gates
  -> append Event
  -> atomically replace Projection
  -> release lock
  -> refresh runtime injection cache
```

If Event append succeeds but Projection replacement fails, recovery replays the Event. If Event append fails, the Projection MUST remain unchanged.

## 8. Persistence model

### 8.1 Durable shared state

Committed state includes Project Store configuration, Specs, Tasks, Events, Context Manifests, graph revisions, accepted evidence references, accepted knowledge, workflow customizations, and install manifests.

### 8.2 Local runtime state

Ignored state includes session bindings, leases, heartbeats, PIDs, local caches, transient Agent outputs, machine paths, credentials, and unaccepted Quick state.

### 8.3 External state

Issues, tickets, remote research sources, and Handoffs at Skill-defined locations are linked through External References. Their remote state cannot override local workflow state without an accepted local event.

## 9. File ownership architecture

SayHi classifies files as:

- **Engine-owned:** generated adapter files whose full contents are tracked by hash.
- **User-owned:** engineering content that SayHi never overwrites after creation.
- **Managed-customizable:** generated base plus constrained user override or marker-delimited Managed Block.

Update compares installed base, local content, and incoming base. Unmodified generated files MAY update automatically; conflicts MUST preserve all versions and stop the affected update.

## 10. Consistency boundaries

The filesystem is not a transactional database. SayHi therefore defines narrow consistency boundaries:

- one Task Event stream is serialized by a task mutation lock;
- one shared checkout mutation is serialized by a Writer Lease;
- graph edits are serialized by graph version;
- file update plans are staged before atomic replacement;
- Git state is re-fingerprinted before and after exclusive operations;
- remote tracker operations use explicit synchronization plans and cannot be atomically combined with local writes.

Failures crossing boundaries MUST be visible and recoverable rather than disguised as success.

## 11. Future adapter boundary

A future adapter must implement:

- session identity and lifecycle events;
- command registration or prompt entry;
- model-callable typed tools;
- Phase Agent dispatch with tool restrictions;
- context injection and compaction recovery;
- approval and status presentation.

Adapters MAY have different capabilities. Core MUST expose capability negotiation rather than assume every platform behaves like OMP. No future adapter is part of V1.
