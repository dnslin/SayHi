# SayHi Security Model

**Status:** Accepted design baseline

## 1. Security objectives

SayHi must prevent an AI Agent, injected document, stale session, conflicting process, or compromised update from silently acquiring authority to:

- change workflow state;
- mutate files outside accepted scope;
- bypass review or validation;
- convert untrusted content into project instructions;
- include unrelated user work in a commit;
- expose credentials or sensitive logs;
- replace pinned Skills or Phase Agents;
- perform prohibited Git or external side effects.

SayHi cannot make arbitrary third-party executable Plugins, Skills, shell commands, or model outputs intrinsically safe. It provides enforceable boundaries and visible failure behavior around the capabilities it controls.

## 2. Protected assets

- user source code and existing uncommitted work;
- Task Projection, Event history, graph, evidence, and archives;
- Approved Specs, ADRs, domain documents, and runbooks;
- Agent Capability Contracts and generated definitions;
- Skill Lock, release manifest, and third-party license inventory;
- repository and session identity;
- tracker credentials and external issue state;
- command output that may contain secrets;
- integrity of review, validation, and commit evidence.

## 3. Trust boundaries

```text
Engine release and contracts
        |
        | verified hash/version
        v
Approved project specifications
        |
        | scoped instruction authority
        v
Task-local generated context
        |
        | informative only
        v
External pages, Issues, logs, tool output
        | data-only
        v
Untrusted references
```

Separate execution boundaries exist between:

- Orchestrator and Phase Agent;
- Reader and Writer operations;
- local state and external Trackers;
- installed Plugin and Skill Registry;
- generated files and user-owned files;
- committed Project Store and ignored runtime state.

## 4. Authority model

### 4.1 Core authority

Core alone accepts transitions, graph revisions, knowledge promotions, adoption, archive, and file update plans. Adapters can request operations but cannot create valid state by editing files directly.

### 4.2 Orchestrator authority

The Orchestrator may choose an allowed Phase Agent and present Gates. It cannot expand Agent Capability Contracts, waive Core invariants, or claim Evidence without a structured producer result.

### 4.3 Phase Agent authority

A Phase Agent receives the minimum tools and context for one role. It can return candidate artifacts and Evidence. It cannot advance state, spawn arbitrary workflow Agents, increase trust, or edit outside its repository-access contract.

### 4.4 Human authority

Humans approve persistent workflow entry, Plan, adoption, blocker waivers, material graph revision, knowledge promotion, and conflict resolution. A configured automation policy may pre-authorize only explicitly defined operations such as `auto-after-review` commits.

## 5. Prompt-injection controls

### 5.1 Structural separation

Injected content MUST preserve trust-tier containers. External content is labelled data-only and cannot be concatenated into Engine Instruction or Approved Spec blocks.

### 5.2 Trust assignment

Path, filename, Markdown heading, Agent output, or external metadata cannot self-assign trust. Trust originates from Core policy, release identity, approved project state, or an explicit human promotion Event.

### 5.3 Research reduction

Research Agent extracts facts with source references. Implementation and Review Agents SHOULD receive the accepted research artifact rather than arbitrary full webpages. Raw source content remains Untrusted Reference even when summarized.

### 5.4 Instruction conflicts

When content asks the Agent to ignore higher-tier instructions, run unrelated tools, reveal secrets, or change workflow state, the Agent prompt treats it as quoted data. Core enforcement remains independent of whether the model follows that instruction.

### 5.5 Residual risk

Models can still be influenced by malicious data. Tool minimization, deterministic Gates, and output validation reduce impact; they do not prove semantic immunity.

## 6. Agent identity and collision controls

OMP may resolve project Agent definitions before Plugin definitions. SayHi dispatch therefore validates the effective Agent against a contract identity, including runtime name, tool set, spawn policy, repository access, output schema, and prompt base.

Unexpected same-name definitions cause `agent_invalid`. Prompt customization MUST flow through `.sayhi/overrides/` and generated managed Agent files. `sayhi doctor` reports all active and shadowed definitions.

The same principle applies to Skill name collisions: managed autoload requires the expected locked Skill identity.

## 7. Repository mutation controls

### 7.1 Baseline

Before mutation, SayHi captures HEAD, index, tracked changes, untracked paths/content identity, submodule state, adopted paths, and declared scope.

### 7.2 Scope

The Writer is allowed to modify only adopted file scope and declared resources. Path validation prevents traversal and unsafe symlink escapes.

### 7.3 Reader-writer barrier

Readers and Writers cannot overlap. Writer and validation leases use atomic creation, unpredictable lease IDs, heartbeat, owner identity, expiration, and recovery checks.

### 7.4 Out-of-band changes

SayHi cannot lock a user's editor or shell. It detects unexplained changes by comparing fingerprints at Phase boundaries. Detection enters `conflicted` without resetting or overwriting files.

### 7.5 Direct state edits

Hooks SHOULD block Agent tools from editing protected Task/Event/manifest paths. Core always verifies consistency because Hooks are defense in depth, not the source of truth.

## 8. Shell and process controls

- Custom Tools invoke processes with argument arrays, not interpolated shell strings.
- User-provided values MUST NOT become executable program names or flags without validation.
- Read-only Agents do not receive general Bash.
- Validation commands are discovered, displayed, approved, and stored as structured argv/cwd descriptors.
- Commands that can update snapshots, generated files, databases, or lockfiles run exclusively and report changed paths.
- Timeouts and cancellation signals propagate to child processes.
- Command output is bounded and redacted before durable storage.

SayHi does not claim that an arbitrary approved build script is safe. Approval grants that process the user's repository permissions.

## 9. Git controls

V1 prohibits automatic push, reset, stash, rebase, revert, forced checkout, and history rewriting.

Before commit, SayHi verifies:

- Task is in the correct Finish position;
- required Review and validation Evidence remains bound to the current fingerprint;
- index state matches policy;
- pre-existing staged content is absent or explicitly adopted;
- every staged path belongs to the Task and has not changed unexpectedly;
- commit policy is authorized.

Commit SHA is observed after Git succeeds and then recorded as an Event. An uncertain commit result is diagnosed by inspecting repository state rather than blindly retrying.

## 10. State integrity

- Events are sequenced and digest-chained to detect accidental truncation or reordering.
- Projection version and Event head MUST match.
- Mutations use optimistic versions and idempotency keys.
- Event append precedes Projection replacement so accepted facts can rebuild state.
- Recovery never rewrites accepted Event content.
- Administrative recovery actions append their own Events.

Digest chains are not cryptographic signatures and do not protect against an attacker who can rewrite the entire repository history. Git review and repository access control remain relevant.

## 11. File and update security

- Engine-owned files are updated only when installed-base identity matches local content.
- Managed Blocks use stable markers and reject ambiguous or duplicated markers.
- User-owned files are never replaced by template updates.
- Update plans stage files and preserve local/base/incoming variants on conflict.
- Archive extraction and vendoring reject absolute paths, traversal, unsafe symlinks, and unexpected executable entry points.
- Plugin installation is explicitly documented as installation of privileged executable code.

## 12. Supply-chain security

- SayHi releases pin the full Skill Registry commit and per-file hashes.
- Upstream repository, commit, path, and license are recorded for every vendored Skill.
- A Skill change requires a reviewable upgrade PR; runtime never downloads it.
- Sidecar changes and Skill changes are reviewed together.
- Release packages include a generated software/Skill inventory and third-party notices.
- CI verifies that vendored Skills exactly match the lock and have not been locally edited.
- Release provenance and package integrity SHOULD be published using ecosystem-supported signing/attestation when implementation begins.

## 13. Secret handling

- Credentials live in environment variables, ignored local configuration, or adapter-native credential stores.
- Project Store files, Events, evidence, Journals, and Handoffs MUST NOT contain credentials.
- Tool results and process output pass through configurable redaction before durable storage.
- Redaction MUST cover common token/key patterns and explicit configured secret values, while acknowledging that pattern matching is incomplete.
- Diagnostics default to safe summaries; raw local logs require explicit access.

## 14. External tracker security

- Pull and push are explicit plans.
- External text is Untrusted Reference.
- External closure cannot complete a Task.
- Adapter permissions SHOULD be least privilege.
- Remote version identifiers prevent blind overwrites.
- Conflict resolution records both observed versions and the human decision.
- Network failure cannot be treated as successful synchronization.

## 15. Denial-of-service and resource controls

- Context expansion enforces file-count and byte/token budgets.
- Recursive imports have a bounded depth and cycle detection.
- Event and Journal readers use bounded projections/indexes rather than loading unlimited history per turn.
- Agent concurrency and recursion are capped.
- Process timeouts, output bounds, and cancellation are mandatory.
- Oversized or malformed untrusted content is summarized, quarantined, or rejected.

## 16. Security events and diagnostics

Security-relevant outcomes include unexpected Agent/Skill identity, protected-file edit attempt, stale fingerprint, lease conflict, path escape, invalid trust upgrade, prohibited Git request, secret-redaction activation, Event inconsistency, and package-integrity mismatch.

Durable records store safe identifiers and reasons, not secret content. Local detailed diagnostics are linked by digest when needed.

## 17. Fail-closed matrix

| Condition | Required behavior |
|---|---|
| Core/Plugin/schema incompatible | read-only diagnostics; block mutation |
| required context stale/missing | block consuming Phase |
| Agent identity mismatch | block dispatch |
| repository fingerprint changed | enter conflict; preserve files |
| lease ownership uncertain | block new Writer; require diagnosis |
| output schema invalid | reject Gate evidence |
| update ownership ambiguous | preserve variants; stop update |
| tracker outcome unknown | mark uncertain; inspect before retry |
| no UI for required confirmation | deny and report blocked |

## 18. Explicit residual risks

- A malicious installed Plugin executes with the user's local permissions.
- A user-approved shell command may be destructive.
- A model may reason incorrectly even with correct context.
- An attacker with full repository write access can rewrite state and evidence.
- Single-checkout external edits cannot be prevented, only detected.
- Content trust labels reduce prompt-injection authority but do not eliminate model influence.

These risks MUST be visible in documentation and release notes rather than hidden behind claims of complete autonomy or safety.
