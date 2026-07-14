# SayHi Product Specification

**Status:** Accepted design baseline  
**Date:** 2026-07-14  
**Implementation:** Not started

## 1. Summary

SayHi is an engineering workflow framework for AI coding agents. Its first adapter targets Oh-My-Pi (OMP). SayHi gives an agent durable project standards, task memory, research, journals, typed workflow state, quality gates, and role-specific sub-agents while retaining unchanged upstream engineering Skills.

SayHi is not a prompt collection and is not a copy of Trellis. It is an independently implemented framework that studies Trellis behavior, applies Matt Pocock's Skills as engineering methods, and uses OMP-native commands, hooks, tools, and task agents.

## 2. Problem

AI coding sessions commonly lose correctness for five reasons:

1. Repository conventions and architectural constraints are missing or too far back in context.
2. Requirements, decisions, research, and verification evidence are scattered across chat history and external trackers.
3. Prompt-driven workflows can claim progress without proving that required artifacts or checks exist.
4. Multiple agents can operate with incompatible permissions or inconsistent snapshots of the repository.
5. Upstream Skills and generated agent files can change without a reproducible record of what was executed.

SayHi addresses these problems by combining durable repository artifacts with deterministic control-plane code.

## 3. Product principles

### 3.1 Files survive conversations

Material requirements, research, decisions, evidence, and knowledge MUST be persisted to reviewable files. Chat history is not a durable task database.

### 3.2 State is advanced by code

The model MAY propose an outcome, but only the Core transition API may accept a Workflow Event and advance a Task Projection.

### 3.3 Context is automatic and phase-specific

The active Task, current workflow position, hard rules, and curated phase context MUST be available without relying on the model to remember to search for them.

### 3.4 Skills remain Skills

Vendored upstream Skills MUST remain byte-identical to the pinned source. SayHi describes their capabilities in sidecar contracts rather than modifying their prompts.

### 3.5 Permissions are structural

An Agent prompt cannot grant itself tools, network, spawn rights, trust, or transition authority. Capability Contracts establish the maximum permissions.

### 3.6 The repository belongs to the user

SayHi MUST preserve unrelated changes, MUST NOT use destructive Git recovery, and MUST distinguish generated framework files from user-owned engineering content.

### 3.7 Knowledge promotion is deliberate

Research and journals are evidence sources, not project law. Shared rules MUST be promoted through review with provenance.

## 4. Goals

SayHi V1 MUST:

- provide an independent TypeScript Core shared by a CLI and an OMP Plugin;
- initialize and maintain a `.sayhi/` Project Store;
- support Quick, Build, and Initiative Routes;
- implement the seven accepted Phases and their Gates;
- persist Tasks as a Projection plus append-only Workflow Events;
- build and validate phase-specific Context Manifests;
- automatically inject stable rules, dynamic workflow state, and role-specific context;
- ship namespaced, capability-sealed Phase Agents;
- run parallel read-only Agent waves and exactly one shared-checkout Writer;
- model Initiative work as a typed dependency DAG with resource claims;
- preserve research, workspace journals, evidence, and knowledge candidates;
- integrate unchanged Matt engineering and productivity Skills from a pinned Skill Registry revision;
- support local-first external tracker references and explicit synchronization;
- create constrained Build/Initiative commits after successful review;
- update and uninstall generated files without overwriting user content;
- produce deterministic diagnostics and machine-readable output;
- operate without a runtime dependency on the Skill Registry or Trellis.

## 5. Non-goals for V1

V1 MUST NOT attempt to provide:

- adapters for coding agents other than OMP;
- simultaneous code-writing Agents in one checkout;
- worktree-based execution;
- automatic `push`, `rebase`, `reset`, `stash`, `revert`, or history rewriting;
- real-time bidirectional Issue Tracker synchronization;
- runtime Skill downloads or silent Skill updates;
- automatic promotion of Agent-generated knowledge into shared specifications;
- a hosted service, account system, telemetry service, or remote task database;
- copied Trellis source code, generated templates, prompts, or documentation text;
- guaranteed compatibility with arbitrary unverified project Agent definitions.

Future adapters and isolated writer backends MAY be added without changing Core domain contracts.

## 6. Primary users

### 6.1 Repository maintainer

Initializes SayHi, approves project configuration, curates specifications, reviews knowledge candidates, and controls upgrades.

### 6.2 Task author

Describes a desired change, reviews planning Gates, and may override Route classification or commit policy.

### 6.3 Main OMP session

Acts as the Orchestrator. It classifies work, dispatches sealed Phase Agents, presents human Gates, and calls typed Tools.

### 6.4 Phase Agent

Performs one bounded role against a declared Task, Phase, repository fingerprint, Context Manifest, and Capability Contract.

### 6.5 External collaborator

Interacts through a GitHub, GitLab, local Markdown, or custom Tracker projection without becoming the workflow state authority.

## 7. Product surface

SayHi consists of:

1. **Core** — domain state, schemas, stores, transitions, context building, graph rules, locks, migrations, and safety invariants.
2. **CLI** — human and automation access to Core.
3. **OMP Plugin** — commands, hooks, tools, Phase Agents, Skills, and runtime rendering.
4. **Project Store** — durable repository-owned engineering artifacts.
5. **Skill bundle** — pinned unchanged Skills plus sidecar capability metadata.
6. **Tracker adapters** — explicit projections and conflict-aware synchronization.

## 8. Functional requirements

### 8.1 Initialization and maintenance

- **FR-INIT-001:** `sayhi init` MUST discover the repository root and refuse unsafe targets such as the user's home directory unless explicitly overridden.
- **FR-INIT-002:** Initialization MUST show a write plan before mutating existing files.
- **FR-INIT-003:** Initialization MUST create or merge managed blocks without replacing unrelated content.
- **FR-INIT-004:** The CLI MUST record the installed Core, CLI, Plugin, schema, template, and Skill Lock versions.
- **FR-INIT-005:** `sayhi doctor` MUST diagnose schema drift, file ownership violations, Agent collisions, missing ignores, stale locks, and invalid context.
- **FR-INIT-006:** `sayhi update` MUST support dry-run, three-way handling, migrations, and conflict reports.
- **FR-INIT-007:** Uninstall MUST remove only verified Engine-owned content and SayHi managed blocks.

### 8.2 Work classification

- **FR-ROUTE-001:** Every managed request MUST be classified as Quick, Build, or Initiative with a recorded reason.
- **FR-ROUTE-002:** The user MUST be able to override a Route before persistent Build/Initiative artifacts are created.
- **FR-ROUTE-003:** Quick MUST start without a planning-document Gate.
- **FR-ROUTE-004:** A Quick that exceeds its scope or uncertainty threshold MUST retain its task ID and escalate to Build.
- **FR-ROUTE-005:** Initiative MUST decompose into Build nodes before implementation begins.

### 8.3 Tasks and workflow

- **FR-TASK-001:** A durable Task MUST have a stable ID, Route, lifecycle, Phase, Step, version, scope, acceptance criteria, and ownership metadata.
- **FR-TASK-002:** Accepted transitions MUST append immutable Workflow Events and update a Projection.
- **FR-TASK-003:** Transitions MUST be optimistic, idempotent, schema-validated, and Gate-validated.
- **FR-TASK-004:** A corrupt or lagging Projection MUST be recoverable from valid Events.
- **FR-TASK-005:** The Core MUST reject transitions from stale versions or invalid Phases.
- **FR-TASK-006:** Quick MUST create a compact durable record only when project changes are produced.
- **FR-TASK-007:** Completed work MUST pass Finish before archive.

### 8.4 Engineering content

- **FR-CONTENT-001:** The Project Store MUST support scoped Specs, Tasks, task-local and shared Research, developer Workspaces, Journals, workflow definitions, evidence, and archives.
- **FR-CONTENT-002:** SayHi-owned artifacts MUST remain distinct from externally owned ADRs, Issues, CONTEXT files, and Handoffs.
- **FR-CONTENT-003:** External artifacts MUST be represented by typed references rather than silent copies.
- **FR-CONTENT-004:** Every shared Spec update MUST record provenance and invalidate active manifests that reference the prior hash.

### 8.5 Context

- **FR-CTX-001:** Every formal Phase MUST have an independently validated Context Manifest.
- **FR-CTX-002:** Context Entries MUST include source, kind, reason, scope, required flag, injection mode, trust tier, and expected content identity.
- **FR-CTX-003:** Required missing or mismatched content MUST block the consuming Phase with `context_stale` or `context_invalid`.
- **FR-CTX-004:** Runtime injection MUST include the active Task and workflow position on every relevant turn.
- **FR-CTX-005:** Full context MUST be scoped to the consuming Phase Agent rather than indiscriminately injected into every turn.
- **FR-CTX-006:** Compaction and session changes MUST preserve enough identity to restore the active Task and Context Manifest.

### 8.6 Agents and Skills

- **FR-AGENT-001:** SayHi MUST ship Research, Planning, Architecture, Implementation, Standards Review, Spec Review, Integration, and Knowledge Agent roles.
- **FR-AGENT-002:** Each role MUST have a versioned Capability Contract and output schema.
- **FR-AGENT-003:** Only the Orchestrator MAY dispatch workflow Agents or request state advancement.
- **FR-AGENT-004:** User Prompt Overrides MUST NOT expand a Capability Contract.
- **FR-AGENT-005:** Runtime dispatch MUST detect an unexpected Agent definition, source, or content hash and fail closed.
- **FR-SKILL-001:** Core Matt Skills MUST be bundled unchanged from the locked Skill Registry revision.
- **FR-SKILL-002:** Optional Skills MUST be enabled explicitly and mapped to Phases and permissions through sidecar metadata.
- **FR-SKILL-003:** Skill loading MUST NOT by itself grant state-transition or repository-mutation authority.

### 8.7 Scheduling and repository mutation

- **FR-SCHED-001:** A Read Wave MAY run several read-only Agents concurrently against one Baseline.
- **FR-SCHED-002:** A Writer Lease MUST be exclusive and MUST exclude all Reader activity against the shared checkout.
- **FR-SCHED-003:** Agent output MUST be rejected if its Base Fingerprint is stale.
- **FR-SCHED-004:** A Writer MUST be constrained to an adopted task scope and resource claims.
- **FR-SCHED-005:** Lock recovery MUST require lease identity checks and MUST never assume a PID alone proves ownership.
- **FR-SCHED-006:** Validation commands with write side effects MUST execute under an exclusive validation lease.

### 8.8 Dependency graph

- **FR-GRAPH-001:** An Initiative graph MUST be acyclic and schema-valid.
- **FR-GRAPH-002:** Edges MUST support `blocks`, `informs`, `validates`, and `supersedes` semantics.
- **FR-GRAPH-003:** Nodes MUST declare relevant file and non-file Resource Claims.
- **FR-GRAPH-004:** Readiness MUST be calculated by Core from dependencies, context freshness, Gates, and resource availability.
- **FR-GRAPH-005:** A blocked node MUST block only its transitive dependents.
- **FR-GRAPH-006:** Material graph changes after Plan MUST be evented and require renewed approval.

### 8.9 Review, validation, and Git

- **FR-REVIEW-001:** Review MUST evaluate documented Standards and task Spec as independent axes.
- **FR-REVIEW-002:** Standards violations and missing, incorrect, or scope-creeping Spec behavior MUST block by default.
- **FR-REVIEW-003:** General code smells MAY be advisory unless they violate an Approved Spec.
- **FR-REVIEW-004:** Repair MUST be bounded to two evidence-based attempts before the Task becomes blocked.
- **FR-GIT-001:** Build and Initiative MAY create a task commit only after successful validation and Review.
- **FR-GIT-002:** Quick MUST NOT commit automatically.
- **FR-GIT-003:** Pre-existing changes MUST NOT be included unless explicitly adopted into the Task Baseline.
- **FR-GIT-004:** SayHi MUST NOT push or perform destructive history operations.
- **FR-GIT-005:** Every task commit MUST be bound to its evidence and recorded SHA.

### 8.10 Knowledge and continuity

- **FR-KNOW-001:** Finish MUST evaluate whether evidence contains durable knowledge.
- **FR-KNOW-002:** Knowledge Agent output MUST remain a candidate until a human accepts it.
- **FR-KNOW-003:** Accepted knowledge MUST be classified as Spec, ADR, domain language, or runbook content.
- **FR-KNOW-004:** Candidates MUST retain source Task and Evidence references.
- **FR-KNOW-005:** Workspace Journals MUST support session continuity but MUST NOT gain instruction authority.
- **FR-KNOW-006:** A Handoff MUST be created at a safe state boundary when context pressure requires a new session.

### 8.11 Trackers

- **FR-SYNC-001:** Local SayHi Task state MUST remain authoritative.
- **FR-SYNC-002:** Tracker adapters MUST support explicit status, pull, push, and conflict resolution operations.
- **FR-SYNC-003:** External closure MUST create an event or candidate action, not complete the local Task.
- **FR-SYNC-004:** Credentials MUST remain outside committed Project Store content.

## 9. Quality attributes

### 9.1 Correctness

Critical state changes MUST be validated by deterministic code and covered by transition, recovery, and corruption tests.

### 9.2 Recoverability

An interrupted process MUST leave either the previous valid state or enough append-only evidence to diagnose and repair the projection. SayHi MUST preserve user modifications on failure.

### 9.3 Reproducibility

A released Plugin MUST identify the exact Core, schema, templates, Agent contracts, and Skill files used to build it.

### 9.4 Transparency

Human-readable files are part of the product. Machine state MUST have CLI inspection commands and machine-readable JSON output.

### 9.5 Performance

Per-turn state injection MUST avoid replaying full event histories or loading all project knowledge. Normal active-state resolution SHOULD require bounded reads of the Project Store.

### 9.6 Portability

Core MUST not import OMP runtime APIs. Adapter-specific behavior MUST remain behind an integration boundary so future adapters can reuse the domain model.

### 9.7 Safety

Ambiguous ownership, stale context, unexpected repository mutation, Agent identity mismatch, and invalid transitions MUST fail closed with actionable recovery instructions.

## 10. Constraints

- V1 implementation language is TypeScript compiled to Node-compatible JavaScript.
- V1 runtime adapter is OMP.
- OMP Plugin code is trusted executable code and MUST be treated as a privileged dependency.
- The shared checkout is the only V1 code-writing workspace.
- The Skill Registry may change independently; SayHi releases remain pinned.
- The public implementation license is MIT, with third-party notices for vendored content.

## 11. Success criteria

SayHi V1 is successful when a new repository can be initialized, execute a Build end to end, recover it in a fresh OMP session, enforce context and Agent contracts, produce review-bound evidence and a safe commit, archive the Task with a Journal entry, and reproduce the same result from a locked release without silently modifying user content.

Initiative support is successful when a typed DAG can schedule parallel read waves and serial writer nodes, propagate blockers correctly, and complete a final Integration Gate without worktree isolation.

Detailed executable criteria live in [acceptance.md](./acceptance.md).
