# SayHi Workflow Specification

**Status:** Accepted design baseline

## 1. Model

SayHi represents work using four independent dimensions:

```text
Route       Quick | Build | Initiative
Lifecycle   proposed | active | blocked | completed | archived | cancelled
Phase       triage | explore | plan | implement | review | integrate | finish
Step        phase-specific position
```

Combining all dimensions into one status string is forbidden. A lifecycle value describes whether work is live; a Phase and Step describe where live work is positioned.

## 2. Global invariants

1. Only Core may accept a Workflow Event or update a Projection.
2. Every transition requires the caller's expected task version.
3. Every completed Gate requires typed Evidence.
4. A required Context Entry must exist and match its content identity.
5. An Agent result must match its dispatch task, Phase, Agent role, and repository fingerprint.
6. Before resuming an active Build Phase, Core must revalidate its exact approved Plan, Context Manifest, Phase Agent Capability Contract, and locked Skill identities. Identity failure MUST append a same-Phase Block transition with workflow Evidence and return a review-required disposition without dispatching the Agent.
7. No read Agent may overlap an exclusive writer or validation operation in the shared checkout.
8. A Task may move backward only through an explicitly allowed repair or replanning transition.
9. Cancellation and blocking preserve artifacts and working changes.
10. Finish is required before archive.
11. Prompts may explain workflow rules but cannot redefine them.

## 3. Route classification

### 3.1 Quick

Quick is appropriate only when all are true:

- the desired outcome is specific and independently verifiable;
- affected scope is small and understood;
- there is no meaningful architecture or product decision;
- no multi-session coordination is expected;
- a targeted validation can demonstrate correctness;
- no dependency graph is required.

Quick begins in gitignored runtime state. It escalates to Build if scope expands, uncertainty persists, a new hard-to-reverse decision appears, required context cannot be identified, or verification reveals broader impact.

### 3.2 Build

Build is appropriate for one independently verifiable deliverable that needs durable planning, formal review, or more than one session.

### 3.3 Initiative

Initiative is appropriate when work contains several independently verifiable deliverables, explicit dependencies, cross-component integration, or sequencing that should survive sessions.

### 3.4 Route Gate

The Orchestrator MUST present the proposed Route and reason. Explicit `/sayhi:flow start` authorizes classification but does not waive later human Gates. Quick may proceed without creating durable planning artifacts. Build and Initiative require confirmation before persistent Task creation.

## 4. Phase matrix

| Phase | Quick | Build | Initiative parent | Initiative Build node |
|---|---:|---:|---:|---:|
| Triage | required | required | required | inherited/validated |
| Explore | skipped by default | required | required | as required by node |
| Plan | skipped by default | required | required | required |
| Implement | required for changes | required | forbidden by default | required |
| Review | required for changes | required | aggregation only | required |
| Integrate | skipped | skipped unless configured | required | skipped |
| Finish | required | required | required | required before node completion |

Skipping a permitted Phase MUST emit a reason. Skipping a required Phase is an invalid transition.

## 5. Phase specifications

### 5.1 Triage

**Purpose:** establish intent, repository condition, Route, risk, and authorization.

**Entry:** a new user request or an unmanaged session requests SayHi management.

**Required activities:**

- identify repository and installed SayHi state;
- capture or inspect the Baseline;
- classify Route with reasons;
- identify obvious task ownership conflicts;
- determine whether tracker setup is required;
- obtain persistent-work consent for Build or Initiative.

**Outputs:** Route decision; initial task identity or Quick runtime identity; initial scope; baseline fingerprint; authorization policy.

**Exit Gate:** classification is accepted and no unsafe repository condition remains unresolved.

### 5.2 Explore

**Purpose:** resolve requirements, unknowns, domain language, and risky alternatives before implementation planning.

**Applicable methods:** unchanged `grill-with-docs`, `research`, `domain-modeling`, `prototype`, or `wayfinder` Skills as selected by the Orchestrator and sidecar contracts.

**Required activities:**

- clarify goals, non-goals, constraints, and acceptance criteria;
- research unstable technical facts through primary sources;
- record hard-to-reverse decisions as ADR candidates;
- identify whether a prototype is necessary;
- persist task-local research and External References;
- create or update Explore Context Manifest.

**Outputs:** accepted requirements baseline; research; terminology changes; ADRs or references when justified; uncertainty assessment.

**Exit Gate:** material unknowns are resolved, accepted as risks, or recorded as blockers.

### 5.3 Plan

**Purpose:** freeze an implementable, reviewable change plan and its exact context.

**Required activities:**

- create PRD, design, and implementation plan as required by scope;
- define file and non-file Resource Claims;
- define validation commands and acceptance evidence;
- build phase Context Manifests;
- for Initiative, create and validate the typed DAG;
- use `to-spec` and `to-tickets` when an external or multi-session plan is appropriate;
- present the plan and first eligible execution order.

**Outputs:** plan artifacts; Context Manifests; graph or Build scope; validation plan; updated Baseline if explicitly adopted.

**Exit Gate:** required artifacts exist, context hashes validate, dependencies are ready, and the user approves implementation.

Task-creation approval is not Plan approval.

### 5.4 Implement

**Purpose:** produce the bounded behavior change using one exclusive Writer.

**Required activities:**

- verify Phase, Agent, Context Manifest, and Baseline;
- acquire Writer Lease after all Readers exit;
- load unchanged `implement` and `tdd` Skills as applicable;
- change only adopted scope;
- run incremental checks permitted by the exclusive operation;
- record changed paths and evidence;
- release Writer Lease before formal Review.

**Outputs:** working changes; implementation report; incremental test evidence; updated repository fingerprint.

**Exit Gate:** Implementation Agent output validates, no unexplained out-of-band mutation exists, and required incremental checks pass.

Implementation may return to Plan if requirements or architecture prove incorrect. The reason and affected artifacts MUST be evented and re-approved.

### 5.5 Review

**Purpose:** independently assess project standards, task intent, and executable validation.

**Read Wave:** Standards Review and Spec Review MAY execute concurrently against the same frozen fingerprint.

**Standards axis:** checks explicit Approved Specs. Violations block.

**Spec axis:** checks missing or partial behavior, wrong implementation, scope creep, and unmet acceptance criteria. Findings block.

General code smells are advisory unless they violate an Approved Spec or create a demonstrable correctness issue.

Validation commands run under an exclusive validation lease after read reviewers complete if they can mutate caches, snapshots, generated files, databases, or ports.

**Outputs:** structured review reports; validation evidence; aggregated blocking and advisory findings.

**Exit Gate:** no unwaived blocker remains and final validation passes.

**Repair loop:** blocking findings return to Implement. At most two evidence-based repair attempts are allowed. A third failure transitions the Task to blocked. A user MAY waive a blocker only with a recorded reason and sufficient authority.

### 5.6 Integrate

**Purpose:** prove that completed Initiative nodes work together and satisfy parent acceptance criteria.

**Entry:** all required graph nodes have completed their Build Review and Finish gates, or the graph explicitly permits partial integration.

**Required activities:**

- verify node commit and evidence identities;
- re-evaluate graph and Resource Claims;
- run cross-module and parent acceptance validation;
- inspect interfaces, schemas, generated artifacts, and lockfiles;
- aggregate unresolved advisory findings;
- create Repair nodes rather than mutating completed node history.

**Outputs:** integration report; final validation evidence; Repair nodes if required.

**Exit Gate:** parent acceptance criteria pass and no required Repair node remains open.

### 5.7 Finish

**Purpose:** close the engineering loop without losing useful knowledge or repository state.

**Required activities:**

- verify prior Gate evidence is still bound to the current fingerprint;
- create a constrained task commit when policy allows;
- record commit SHA or uncommitted fingerprint;
- run Knowledge Agent and persist candidates;
- obtain human decisions for any requested promotion;
- write Workspace Journal and optional Handoff;
- synchronize external tracker projections only through an explicit plan;
- complete and archive the Task.

**Outputs:** final evidence; commit reference; Journal entry; Knowledge Candidates and decisions; tracker synchronization result; archived Task.

**Exit Gate:** repository state is accounted for, required knowledge review is resolved or deferred explicitly, and archive invariants pass.

## 6. Lifecycle transitions

```text
proposed
   |
   v
active <--------------+
   |                   |
   +--> blocked -------+  resume after blocker resolution
   |
   +--> cancelled
   |
   v
completed
   |
   v
archived
```

- `blocked` retains Phase and Step.
- `cancelled` is terminal for execution but preserves history.
- `completed` means Finish Gate passed; it does not mean files were moved.
- `archived` means durable artifacts moved to the archive location and active bindings were cleared.

## 7. Quick lifecycle

1. Create local Quick identity and Baseline.
2. Execute Triage, Implement, and Review in runtime state.
3. If no project change exists, close runtime state without Project Store artifacts while retaining a compact external runtime audit that remains inspectable and archivable after restart.
4. If a project change exists, Finish creates a Quick Record containing intent, route reason, scope, acceptance criteria, evidence, review, changed paths, and commit/fingerprint state.
5. If escalation is required, create a full Task using the same identity, import valid Quick evidence, and enter Explore or Plan. Prior code changes become explicit Baseline state requiring review.

## 8. Build lifecycle

```text
Triage
  -> Explore
  -> Plan --human approval-->
  -> Implement
  -> Review --repair up to 2 times-->
  -> Finish
  -> completed
  -> archived
```

For a single-session Build, the accepted goals, non-goals, and acceptance criteria in task artifacts form the stable intent baseline. For a multi-session Build, external specs or tickets are referenced with content identity and the local Task remains the runtime authority.

## 9. Initiative lifecycle

1. Parent performs Triage, Explore, and Plan.
2. Planning creates a typed graph of Build nodes.
3. Core calculates ready nodes.
4. Ready nodes may share parallel read-only exploration/planning waves.
5. Exactly one node at a time receives a Writer Lease.
6. Every node completes Review and node Finish before satisfying `blocks` edges.
7. Parent performs Integrate.
8. Integration failure creates one or more Repair nodes with explicit dependencies.
9. Parent performs Finish and archives after all required nodes and repairs complete.

The Initiative parent MUST NOT directly implement code unless it owns an explicit Build node for that deliverable.

## 10. A+ scheduling protocol

### 10.1 Shared Read Wave

- Capture repository fingerprint `S`.
- Acquire shared reader leases for selected ready operations.
- Dispatch only Agents whose Capability Contracts contain no repository-writing tools.
- Require every result to report `S`.
- End all Reader processes and release leases.
- Verify the repository still matches `S`.

### 10.2 Exclusive Write Phase

- Acquire a Writer Lease atomically.
- Revalidate `S`, task version, context, scope, and Agent identity.
- Permit one Implementation Agent to mutate the checkout.
- Capture resulting fingerprint `W` and changed-path inventory.
- Release the Writer Lease.

### 10.3 Review and validation

- Run parallel reviewers against `W` under shared read leases.
- End the read wave.
- If validation commands may write, acquire an exclusive validation lease.
- Aggregate evidence and decide Review Gate.

Reader and Writer activity MUST NOT overlap. This intentionally favors correctness over implementation throughput.

## 11. Dependency readiness

A node is ready only when:

- all `blocks` predecessors are completed;
- every required `informs` artifact exists and matches identity;
- required `validates` relationships can be satisfied;
- no active operation owns a conflicting Resource Claim;
- node Context Manifests are valid;
- required human Gates are accepted;
- the parent graph version matches the scheduler's expected version.

Cycles are invalid. A blocked node propagates blockage only along transitive blocking dependencies.

## 12. Failure states

The Core distinguishes:

- `context_stale` — a referenced content identity changed;
- `context_invalid` — required context is missing, unsafe, or malformed;
- `conflicted` — repository state changed outside the accepted operation;
- `recovery_required` — Projection/Event or update state cannot be reconciled automatically;
- `blocked` — a business, review, dependency, authorization, or bounded-repair blocker prevents progress;
- `agent_invalid` — dispatched Agent identity, capability, or output contract is unexpected;
- `skill_invalid` — a locked Skill identity or declared Skill bundle differs from the accepted dispatch.
- `sync_conflict` — local and external tracker projections changed incompatibly.

These are reason codes associated with lifecycle or operations, not additional Phase values.

## 13. Human Gates

Human confirmation is required for:

- entering persistent Build or Initiative management;
- approving Plan before implementation;
- adopting pre-existing file changes into task scope;
- waiving a blocking Review finding;
- modifying a live Initiative graph materially after Plan;
- promoting shared knowledge;
- resolving ambiguous update or tracker conflicts;
- destructive actions, which V1 normally forbids.

A Task-level `auto-after-review` commit policy MAY be authorized once at start. It does not authorize push or history rewriting.

## 14. Context pressure and handoff

SayHi monitors runtime context usage through adapter capabilities. A Handoff may be requested only at a safe boundary: after a Phase Agent returns, after a persisted Event, and while no lease is held. Handoff MUST record Task ID, Phase, Step, Projection version, active blockers, current repository fingerprint, and artifact references.

Compaction during an unsafe operation MUST NOT advance state. The next session restores from durable state and the Handoff rather than trusting conversational recollection.
