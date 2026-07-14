# SayHi Acceptance Criteria

**Status:** Accepted design baseline  
**Purpose:** Define observable completion for each milestone without prescribing internal library choices.

## 1. Milestone 0 — Contracts

### AC-0001 Schema coverage

Given the accepted durable record list, when contract validation runs, then Task Projection, Workflow Event, Context Entry, Baseline, Lease, Agent Contract, Agent dispatch/result, Evidence, Dependency Graph, External Reference, Knowledge Candidate, Skill Lock, project manifest, and managed-file records have versioned schemas and fixtures.

### AC-0002 Transition model

Given every Route and Phase, when the transition matrix is enumerated, then each legal transition has declared prerequisites and every undeclared transition is rejected.

### AC-0003 Domain language

Given the specifications and ADRs, when domain terms are scanned, then Route, Phase, lifecycle, Task, Projection, Event, Manifest, Agent, Lease, and trust terms are used consistently with `CONTEXT.md`.

### AC-0004 Clean-room boundary

Given the source tree, when provenance review runs, then no Trellis code, prompt, template, or copied documentation is present and all external design references are attributed.

### AC-0005 Threat model

Given the privileged operations, when security review runs, then each has an authority, trust boundary, fail-closed behavior, and residual-risk statement.

## 2. Milestone 1 — Foundation CLI

### AC-0101 Safe initialization

Given an empty Git repository, when `sayhi init` is approved, then the Project Store and required managed files are created, the runtime path is ignored, and `sayhi doctor` passes.

### AC-0102 Existing-file preservation

Given existing `.omp/AGENTS.md`, `.omp/RULES.md`, and root `AGENTS.md`, when initialization runs, then only unambiguous SayHi Managed Blocks are added and all unrelated bytes remain unchanged.

### AC-0103 Task eventing

Given a new Build, when legal transitions execute, then one Event is appended per accepted mutation and `task.json` exactly projects the Event head.

### AC-0104 Stale version rejection

Given two callers with the same expected Task version, when one advances first, then the second receives a stale-version error and produces no additional state mutation.

### AC-0105 Idempotent retry

Given an accepted transition, when the same idempotency key and intent are retried, then the original result is returned without a duplicate Event.

### AC-0106 Projection recovery

Given a missing or lagging Projection and a valid Event stream, when recovery is planned and applied, then the rebuilt Projection matches deterministic replay and history remains unchanged.

### AC-0107 Corrupt event detection

Given a missing, reordered, or digest-mismatched Event, when `doctor` runs, then mutation is blocked and the report identifies the first inconsistent sequence.

### AC-0108 Ownership update

Given unmodified Engine-owned, modified Engine-owned, User-owned, and Managed-customizable files, when update planning runs, then only safe automatic changes are selected and conflicts preserve all variants.

### AC-0109 Uninstall

Given initialized files plus user changes, when uninstall is planned and applied, then matching Engine-owned files and SayHi blocks are removed while all user content remains.

### AC-0110 Baseline adoption

Given a dirty repository, when a Task attempts to touch a pre-existing modified file, then mutation is blocked until explicit adoption records the path, diff identity, and Event.

### AC-0111 Lease recovery

Given an expired lease, when owner liveness or repository stability is uncertain, then a new Writer is denied; when diagnosis proves safety, recovery issues a new lease without deleting task evidence.

## 3. Milestone 2 — OMP Build and Quick

### AC-0201 Plugin discovery

Given a packaged Plugin, when installed through a supported OMP path, then its command, hooks, Tools, Agents, and Skills are discoverable and `sayhi doctor` verifies their identities.

### AC-0202 Four-layer injection

Given an active Build, when a new turn starts, then OMP sees stable AGENTS context, sticky hard rules, one dynamic workflow envelope, and only the current Agent's phase context.

### AC-0203 Compaction recovery

Given an active Build at a safe boundary, when OMP compacts or starts a replacement session, then SayHi restores Task ID, version, Phase, Step, blockers, and Context Manifest without advancing state.

### AC-0204 Context stale block

Given an Implement Manifest referencing an Approved Spec, when that Spec content changes, then Implementation dispatch is rejected with `context_stale` until refresh and approval.

### AC-0205 Trust separation

Given a research file containing instructions to ignore rules and run a command, when it is injected as Untrusted Reference, then it is rendered as data-only and cannot change Agent tools, state, or trust.

### AC-0206 Agent collision

Given a project Agent with the same runtime name but a different tool set or hash, when dispatch is requested, then dispatch fails closed and `doctor` reports the effective conflicting source.

### AC-0207 Build happy path

Given an accepted Build request, when Triage, Explore, Plan, Implement, Review, and Finish succeed, then artifacts, Events, evidence, Journal, commit SHA, completion, and archive are mutually consistent.

### AC-0208 Plan Gate

Given planning artifacts but no human implementation approval, when an Implementation Agent is requested, then dispatch is denied.

### AC-0209 Dual-axis review

Given one Standards violation and one Spec omission, when Review runs, then independent structured findings are aggregated and both block completion.

### AC-0210 Bounded repair

Given repeated blocking review failures, when two repair attempts fail, then a third automatic repair is not dispatched and the Task becomes blocked with preserved evidence.

### AC-0211 Safe task commit

Given successful Review and `auto-after-review`, when Finish commits, then only Task-owned paths are committed, existing staged/unadopted content is excluded or blocks, and the observed SHA is evented.

### AC-0212 No push or destructive Git

Given any managed Task, when the model requests push, reset, stash, rebase, revert, or force checkout through managed workflow, then SayHi refuses and does not claim authorization from commit policy.

### AC-0213 Quick without change

Given a Quick analysis that makes no project change, when Finish occurs, then no durable Task directory is created.

### AC-0214 Quick with change

Given a Quick code change that passes Review, when Finish occurs, then a compact Quick Record and evidence are archived without PRD/design/implementation files and no automatic commit is created.

### AC-0215 Quick escalation

Given a Quick whose uncertainty or scope grows, when escalation is accepted, then the same task identity becomes a Build, prior evidence remains linked, and Explore/Plan Gates become required.

## 4. Milestone 3 — Initiative

### AC-0301 DAG validation

Given an Initiative graph, when a cycle, missing node, invalid edge, or malformed Resource Claim exists, then Plan cannot complete.

### AC-0302 Readiness

Given mixed blocking and informing edges, when predecessors change state, then Core derives exactly the nodes whose hard dependencies, context, approvals, and resources are ready.

### AC-0303 Parallel read wave

Given several ready read-only operations at fingerprint `S`, when dispatched concurrently, then all have read-only contracts, report `S`, and finish before a Writer Lease can be acquired.

### AC-0304 Reader-writer exclusion

Given any active Reader lease, when a Writer is requested, then acquisition fails; given an active Writer or validation lease, new Readers are denied.

### AC-0305 Stale reader result

Given a read result bound to `S`, when the repository changes to `S2` before acceptance, then the result cannot satisfy a Gate.

### AC-0306 Serial node writes

Given two ready Build nodes, when both request implementation, then exactly one receives the Writer Lease and the other remains ready/waiting without editing files.

### AC-0307 Blocker propagation

Given one blocked node, when readiness recalculates, then only nodes transitively dependent through blocking semantics are blocked; independent nodes remain eligible.

### AC-0308 Upstream invalidation

Given a downstream planned node whose informing upstream artifact changes, when identity is re-evaluated, then the downstream node becomes `context_stale`.

### AC-0309 Material graph revision

Given an Initiative past Plan, when a material graph change is proposed, then no revision is applied without a reason, expected graph version, and renewed approval Event.

### AC-0310 Integration repair

Given completed nodes and a failing parent integration test, when Integrate fails, then a Repair node is created with explicit dependencies; completed node Events are not rewritten.

### AC-0311 Initiative completion

Given all required nodes and repairs completed, when Integration and Finish pass, then parent acceptance evidence references node commits and the parent archives without direct hidden implementation.

## 5. Milestone 4 — Knowledge and Trackers

### AC-0401 Candidate generation

Given durable evidence and Journal content, when Knowledge Agent runs, then it returns schema-valid candidates with source Task, Evidence, scope, confidence, proposed type, and target.

### AC-0402 No automatic promotion

Given a high-confidence candidate, when Finish runs without human promotion approval, then no Approved Spec, ADR, domain document, or runbook is changed.

### AC-0403 Promotion conflict

Given a candidate conflicting with an existing Approved Spec, when acceptance is requested, then the conflict and affected manifests are shown and automatic acceptance is blocked.

### AC-0404 Promotion provenance

Given an accepted candidate, when the target changes, then the promotion Event, source evidence, new content identity, and impacted active Tasks are recorded.

### AC-0405 Journal authority

Given a Journal statement contradicting an Approved Spec, when context is built, then the Spec retains instruction authority and the Journal remains Task Context.

### AC-0406 Tracker observation

Given an external Issue closed remotely, when sync pull runs, then an `external_closed` observation is planned or evented but the local Task does not complete.

### AC-0407 Sync conflict

Given local and remote edits to the same projected field, when synchronization is planned, then SayHi reports `sync_conflict` and preserves both versions until explicit resolution.

### AC-0408 Credential handling

Given configured tracker credentials, when diagnostics, Events, evidence, and Journals are inspected, then credentials are absent and redacted output does not reveal them.

## 6. Milestone 5 — Distribution

### AC-0501 Exact Skill bundle

Given the locked Registry commit, when a release is built, then every packaged Skill file matches the lock and no unexpected Skill file is present.

### AC-0502 Provenance and licenses

Given a release package, when inventory validation runs, then every vendored Skill has Registry and upstream provenance plus required license/notice coverage.

### AC-0503 Upgrade proposal

Given a newer Registry revision, when discovery runs, then it creates a semantic-diff proposal and never changes a released package or merges automatically.

### AC-0504 Runtime offline behavior

Given an installed release without network access, when Quick, Build, context injection, Agent verification, and local Task operations run, then no Skill Registry fetch is attempted.

### AC-0505 Package smoke test

Given packed Core, CLI, and Plugin artifacts, when installed into a clean fixture environment, then initialization, Plugin discovery, Build smoke flow, update plan, doctor, and uninstall execute against package contents rather than source-tree assumptions.

### AC-0506 Reproducible manifest

Given the same source revision, dependency lock, toolchain, and Skill Lock, when two release builds run, then generated content inventories and package manifests are identical apart from explicitly declared non-reproducible metadata.

## 7. Cross-cutting acceptance

- No test may rely on a live model for deterministic Core correctness.
- Agent/prompt evaluations supplement but do not replace schema, state, and safety tests.
- Windows, macOS, and Linux path/atomicity behavior MUST be represented before public V1 release.
- Every mutation failure test verifies preservation of unrelated user files.
- Every headless confirmation test fails closed.
- Every public CLI mutation has a dry-run or plan path when meaningful.
- Documentation examples are validated against schemas or generated fixtures before release.
