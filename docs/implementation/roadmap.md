# SayHi Implementation Roadmap

**Status:** Approved sequencing; implementation progress is established only by recorded Exit Gate evidence.

## Delivery policy

SayHi is delivered as vertical, demonstrable milestones. A milestone is complete only when its contracts, failure paths, migration behavior, documentation, and packaged or fixture-level demo meet the acceptance criteria.

Implementation MAY refine low-level libraries and module names. It MUST NOT change accepted product behavior without updating the relevant specification and, for hard-to-reverse changes, an ADR.

## Milestone 0 — Contracts and executable design

### Deliverables

- TypeScript workspace skeleton without runtime feature claims;
- domain values and versioned schemas for all records in `data-contracts.md`;
- transition table and Gate registry;
- error taxonomy and JSON result envelopes;
- filesystem/Git/clock/process/tracker/OMP port interfaces;
- Agent and Skill sidecar schemas;
- golden valid/invalid fixtures;
- clean-room contribution guidance;
- license and third-party notice scaffolding;
- architecture, threat model, and ADR test references.

### Demonstration

Run schema and transition tests over fixtures without OMP or a live model.

### Exit Gate

All Milestone 0 acceptance criteria pass. No adapter owns duplicate transition logic.

### Primary risks

- contracts become over-specific before runtime learning;
- Event model omits an operation needed by adapters;
- repository fingerprint is expensive or platform-dependent.

Mitigation: keep ports explicit, test canonical encodings across fixtures, and separate normative behavior from library choices.

## Milestone 1 — Foundation Core and CLI

### Deliverables

- Project Store discovery and path safety;
- init/status/doctor/update-plan/uninstall-plan;
- file ownership manifest and Managed Block engine;
- Task/Event stores, replay, Projection, recovery, and migrations;
- baseline/fingerprint capture and adoption;
- lease service and operation journal;
- Spec, Context, Workspace, Journal, archive, and graph storage commands;
- JSON/headless CLI behavior;
- cross-platform filesystem fixtures.

### Demonstration

Initialize a fixture repository, create and advance a Task through administrative test transitions, simulate interrupted Projection replacement, recover it, perform an update conflict, and uninstall without changing user content.

### Exit Gate

Foundation acceptance criteria pass on supported operating-system CI. CLI and tests call one Core implementation.

### Primary risks

- filesystem atomicity differs across platforms;
- Git dirtiness/adoption semantics surprise users;
- updater rollback expectations exceed safe guarantees.

## Milestone 2 — OMP Plugin, Quick, and Build

### Deliverables

- valid OMP `plugin.json` and package layout;
- `/sayhi:flow` command;
- AGENTS/RULES Managed Blocks;
- session, injection, tool, compaction, and shutdown hooks;
- namespaced schema-valid custom Tools;
- generated capability-sealed Phase Agents;
- locked Matt Skills bundle and sidecars;
- four-layer context delivery and trust rendering;
- Quick lazy persistence and escalation;
- Build flow from Triage through Finish;
- dual-axis review, validation runner, bounded repair, and safe commit;
- fresh-session restore and Handoff.

### Demonstration

In a fixture project, install the packed Plugin, complete one no-change Quick, one changed Quick, and one multi-session Build. Deliberately test stale Spec, Agent collision, blocked Plan, dirty baseline, failed Review, compaction, and package uninstall.

### Exit Gate

The Build happy path and every fail-closed acceptance case pass with packaged artifacts. Deterministic tests do not depend on model compliance; prompt evaluations cover role behavior separately.

### Exit Gate evidence

**Satisfied for issue #23’s Quick and Build acceptance scope:** `npm run test:milestone-2` runs the complete contract suite. Its packaged-artifact smoke test builds, packs, and locally installs Core, CLI, OMP, and the compiled testing contracts, then reruns the installed Quick/Build matrix. That matrix verifies no-change and changed Quick persistence, escalation, approved Build completion, stale Context and identity blocking, denied Gates, Baseline drift, bounded Review repair, uninstall, and scoped Git safety. Explicit packaged-CLI requests for push, reset, stash, rebase, revert, and force checkout are refused without changing Git state.

### Primary risks

- OMP lifecycle ordering changes;
- Project Agent precedence undermines expected definitions;
- dynamic injection duplicates or disappears after compaction;
- live model output is difficult to constrain reliably.

Mitigation: adapter contract tests against pinned supported OMP versions, identity checks, idempotent injection markers, and structured output validation.

## Milestone 3 — Initiative and A+ scheduler

### Deliverables

- typed graph mutation and readiness services;
- resource-claim conflict analysis;
- shared Reader and exclusive Writer/validation leases;
- parallel read-wave dispatcher;
- serial Build-node writer queue;
- blocker propagation and graph revision Gate;
- parent Integration Agent and cross-node evidence;
- Repair node generation;
- interruption and stale-output recovery.

### Demonstration

Run an Initiative with at least four nodes: two parallel research/planning candidates, two serial code changes, one blocked independent branch, and an integration failure that generates and completes a Repair node.

### Exit Gate

No test observes Reader/Writer overlap, stale results cannot satisfy Gates, independent nodes continue around blockers, and parent completion is bound to node commits and integration evidence.

### Primary risks

- global barriers reduce practical throughput;
- tests or language servers write unexpectedly;
- resource claims cannot capture all semantic interference;
- external edits race between fingerprints.

The V1 response is detection and blocking, not unsafe automatic reconciliation.

## Milestone 4 — Knowledge and tracker integration

### Deliverables

- Knowledge Agent schema and candidate store;
- duplicate/conflict/impact analysis;
- review/accept/reject/supersede CLI;
- Spec/ADR/domain/runbook promotion adapters;
- manifest invalidation after promotion;
- Tracker port plus GitHub, GitLab, local Markdown, and custom configuration contracts;
- explicit pull/push/status/resolve plans;
- credential redaction and external-reference observation;
- Journal and Handoff continuity refinements.

### Demonstration

Extract candidates from a completed Task, reject one, accept one into a scoped Spec, observe an affected Task become stale, and resolve a simulated tracker conflict without changing local lifecycle automatically.

### Exit Gate

No Agent can promote knowledge directly, provenance remains traversable, credentials do not enter durable artifacts, and local Task state stays authoritative.

### Primary risks

- proposed knowledge is noisy;
- promotion diffs are difficult for nontechnical users;
- tracker APIs and permission models diverge.

## Milestone 5 — Distribution and maintenance

### Deliverables

- locked import pipeline from `dnslin/skills`;
- exact vendoring and sidecar compatibility checks;
- third-party notices and release inventory;
- coordinated npm package publishing;
- OMP Marketplace metadata and installation documentation;
- packed-package smoke suite;
- Skill upgrade discovery PR workflow;
- project update/migration/uninstall matrix;
- release attestation/signing where supported;
- public support and deprecation policy.

### Demonstration

Build from a clean source checkout, install packages into a clean environment, run a Build smoke workflow offline, discover but do not auto-merge an upstream Skill change, update a project with a controlled conflict, and uninstall safely.

### Exit Gate

Distribution acceptance criteria pass, licenses are reviewed, package contents match allowlists, and release artifacts are reproducible within documented limits.

### Primary risks

- Registry automation or licenses are incomplete;
- npm and OMP installation paths differ;
- generated-file compatibility becomes a long-term burden.

## Test strategy across milestones

### Deterministic tests

- schema/property tests;
- transition model tests;
- Event replay and corruption tests;
- path traversal and symlink tests;
- file ownership and Managed Block golden tests;
- Git baseline and staging fixtures;
- lease concurrency and crash tests;
- graph property and scheduling tests;
- context trust-rendering tests;
- adapter contract tests;
- migration and package smoke tests.

### Model-facing evaluations

- Route classification scenarios;
- adherence to Phase role and output schema;
- resistance to data-only prompt injection;
- correct Skill selection;
- plan quality and graph decomposition;
- review coverage and false-positive tracking;
- knowledge candidate precision.

Model evaluations are probabilistic product evidence. They never replace deterministic enforcement tests.

## Deferred after V1

- adapters beyond OMP;
- isolated parallel-writer backends using containers or remote workspaces;
- hosted dashboards or team services;
- cryptographic Event signing;
- automatic low-risk knowledge promotion;
- real-time tracker webhooks;
- richer TUI or custom theme;
- MCP servers not required by a specific adapter use case.

## First implementation action when authorized

The first coding change should create only the Milestone 0 workspace, schemas, fixtures, tests, license files, and contribution guardrails. It should not claim a working CLI or Plugin until their vertical acceptance criteria pass.
