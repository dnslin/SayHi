# SayHi Domain Language

SayHi coordinates AI-assisted engineering work while preserving enough project memory and evidence for a later session to continue safely.

## Product and repositories

**SayHi**:
The engineering workflow framework defined by this repository. SayHi owns workflow coordination and project memory but delegates engineering techniques to Skills.
_Avoid_: Trellis clone, Skill collection

**Framework Repository**:
The independent `dnslin/sayhi` source repository containing SayHi Core, CLI, adapters, contracts, and release automation.
_Avoid_: Skill Registry

**Skill Registry**:
The independent `dnslin/skills` repository that collects upstream and locally authored Skills with provenance information. It is a build-time source, not a runtime dependency.
_Avoid_: Plugin repository, runtime Skill server

**Managed Project**:
A user repository initialized by the SayHi CLI and containing a `.sayhi/` Project Store plus the selected runtime adapter files.
_Avoid_: SayHi repository

**Project Store**:
The committed `.sayhi/` content tree that holds durable specifications, tasks, research, workspace memory, workflow definitions, and references.
_Avoid_: Runtime directory, cache

## Work classification

**Route**:
The selected amount of workflow governance for a request: Quick, Build, or Initiative. A Route determines which Phases are required or may be skipped.
_Avoid_: Phase, task status

**Quick**:
A small, well-bounded Route that starts with local runtime state and creates a durable Quick Record only if it changes the project.
_Avoid_: undocumented change, full Build

**Build**:
A Route for one independently verifiable deliverable that requires exploration, planning, implementation, review, and finish gates.
_Avoid_: Initiative node when referring to the parent

**Initiative**:
A Route for several dependent deliverables represented by a typed Dependency Graph whose executable nodes are Builds.
_Avoid_: large Build, epic without a graph

**Phase**:
One of the seven stable workflow positions: Triage, Explore, Plan, Implement, Review, Integrate, or Finish.
_Avoid_: Route, lifecycle state

**Step**:
A precise position within a Phase used for recovery and allowed-transition validation.
_Avoid_: Phase

**Gate**:
A deterministic check that must pass before a transition, commit, promotion, synchronization, or archive operation is allowed.
_Avoid_: model suggestion

## Work records

**Task**:
The durable unit of planned or executed work, identified by a stable task ID and represented by a Projection plus Workflow Events.
_Avoid_: chat session, external Issue

**Quick Record**:
The compact archived Task created at Finish for a Quick Route that changed the project. It does not require PRD, design, or implementation-plan files.
_Avoid_: full Task directory

**Projection**:
The current human-readable task state in `task.json`, derived from accepted Workflow Events.
_Avoid_: source event history

**Workflow Event**:
An immutable, sequenced fact in `events.jsonl` describing an accepted state change or material workflow occurrence.
_Avoid_: log line, mutable status

**Evidence**:
A structured reference to an observable result that supports a Gate, such as a validation result, review report, artifact hash, or commit SHA.
_Avoid_: unsupported agent claim

**External Reference**:
A typed, version-aware pointer from a SayHi Task to an artifact owned elsewhere, such as an Issue, ADR, CONTEXT file, or Handoff.
_Avoid_: copied mirror

## Context and instructions

**Context Manifest**:
A phase-specific, hash-bound list of the exact specifications, task artifacts, research, and references that an Agent must receive.
_Avoid_: semantic search result, full repository dump

**Context Entry**:
One typed item in a Context Manifest, including its path or URI, reason, scope, trust tier, injection mode, and expected hash.
_Avoid_: untyped file path

**Trust Tier**:
The authority granted to injected content: Engine Instruction, Approved Spec, Task Context, or Untrusted Reference.
_Avoid_: confidence score

**Engine Instruction**:
A hash-verified SayHi rule or Agent contract allowed to control workflow behavior.
_Avoid_: project convention

**Approved Spec**:
A user-approved project rule allowed to constrain engineering work within its declared scope.
_Avoid_: research note, candidate knowledge

**Task Context**:
Task-local planning or memory content that informs the current work but cannot override Engine Instructions or Approved Specs.
_Avoid_: global rule

**Untrusted Reference**:
External or tool-produced content that is injected strictly as data and cannot grant itself instruction authority.
_Avoid_: approved instruction

## Agents and execution

**Orchestrator**:
The only component allowed to select Phase Agents, validate their outputs, acquire execution leases, and request state transitions.
_Avoid_: Implementation Agent

**Phase Agent**:
A role-specific OMP sub-agent operating under a sealed Capability Contract and returning schema-shaped output for one Phase.
_Avoid_: unrestricted general agent

**Capability Contract**:
The non-user-editable ceiling on a Phase Agent's tools, Skills, network access, spawn rights, and output schema.
_Avoid_: prompt override

**Prompt Override**:
Project-specific text that may refine a Phase Agent's guidance without expanding its Capability Contract.
_Avoid_: custom Agent definition

**Read Wave**:
A set of concurrent read-only Phase Agents operating against one repository fingerprint while no Writer Lease exists.
_Avoid_: parallel implementation

**Writer Lease**:
The exclusive, expiring authority for one Implementation or repair operation to mutate the shared checkout.
_Avoid_: advisory lock file

**Baseline**:
The captured Git HEAD, index, tracked changes, untracked-file set, and declared task scope against which later mutations are checked.
_Avoid_: base branch

**Repository Fingerprint**:
A deterministic identity for the repository state used to reject stale Agent outputs and detect out-of-band changes.
_Avoid_: commit SHA alone

## Planning and knowledge

**Dependency Graph**:
The acyclic, typed graph of Initiative nodes, dependency edges, resource claims, and readiness state.
_Avoid_: parent-child list

**Resource Claim**:
A declared file, API, schema, generated artifact, or lockfile scope used to detect semantic interference between graph nodes.
_Avoid_: dependency edge

**Knowledge Candidate**:
A provenance-bearing proposal extracted from evidence, research, review, or journals that has not yet become a shared rule.
_Avoid_: Approved Spec

**Knowledge Promotion**:
The human-approved transition of a Knowledge Candidate into a Spec, ADR, domain document, or runbook.
_Avoid_: automatic summarization

**Workspace Journal**:
A developer-scoped session record used for continuity and later knowledge review, but not injected as an authoritative project rule.
_Avoid_: Spec, event log

## Distribution and ownership

**Skill Lock**:
The build-time record of the Skill Registry revision, upstream provenance, per-file hashes, and licenses included in a SayHi release.
_Avoid_: runtime update channel

**Managed Block**:
A marker-delimited section that SayHi may safely generate, update, and remove inside an otherwise user-owned file.
_Avoid_: whole-file ownership

**Ownership Class**:
The update policy assigned to a file: Engine-owned, User-owned, or Managed-customizable.
_Avoid_: filesystem permission

**Tracker Projection**:
The collaboration-facing representation of a local SayHi Task in an external Issue Tracker. It is not the workflow state authority.
_Avoid_: source of truth
