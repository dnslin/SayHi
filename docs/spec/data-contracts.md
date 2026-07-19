# SayHi Data Contracts

**Status:** Accepted design baseline  
**Format scope:** Logical V1 contracts; implementation JSON Schemas are a Milestone 0 deliverable.

## 1. General rules

- Durable machine-readable records MUST declare `schemaVersion`.
- JSON records MUST be UTF-8 and MUST NOT contain comments.
- JSONL files contain exactly one complete JSON object per non-empty line.
- Time values use RFC 3339 UTC strings.
- IDs are opaque, stable strings. Callers MUST NOT infer dates or hierarchy from ID text.
- Repository-relative paths use `/`, never start with `/`, and MUST NOT contain `..` traversal.
- URI references MUST declare an adapter or scheme.
- Unknown fields MAY be preserved during read/write for forward compatibility, but unknown enum values MUST fail operations that depend on their semantics.
- A migration MUST never rewrite user prose merely to normalize formatting.

## 2. Content identity

Text content uses an explicit identity descriptor:

```json
{
  "algorithm": "sha256-lf-v1",
  "digest": "hex-encoded-sha256"
}
```

`sha256-lf-v1` means UTF-8 bytes with CRLF and CR normalized to LF before hashing. Invalid UTF-8 or binary files use `sha256-bytes-v1` over raw bytes.

Identity calculation MUST reject a symlink that resolves outside the Managed Project unless the reference is explicitly external and permitted by policy.

## 3. Project manifest

`.sayhi/manifest.json` records installation and schema compatibility:

```json
{
  "schemaVersion": 1,
  "projectId": "opaque-project-id",
  "installed": {
    "core": "0.1.0",
    "cli": "0.1.0",
    "ompPlugin": "0.1.0",
    "projectSchema": 1,
    "templates": "0.1.0",
    "skillLockDigest": "sha256:..."
  },
  "initializedAt": "2026-07-14T00:00:00Z",
  "updatedAt": "2026-07-14T00:00:00Z",
  "ownershipManifest": ".sayhi/managed-files.json"
}
```

The manifest does not contain credentials, machine-specific absolute paths, or session identity.

## 4. Task Projection

`tasks/<task-id>/task.json` is the bounded-read Projection:

```json
{
  "schemaVersion": 1,
  "id": "opaque-task-id",
  "title": "Add user export",
  "route": "build",
  "lifecycle": "active",
  "phase": "implement",
  "step": "writing",
  "version": 17,
  "eventHead": {
    "sequence": 17,
    "eventId": "opaque-event-id",
    "chainDigest": "sha256:..."
  },
  "parentTaskId": null,
  "initiativeGraphId": null,
  "intent": {
    "goals": ["..."],
    "nonGoals": ["..."],
    "acceptanceCriteria": ["..."]
  },
  "scope": {
    "files": ["packages/export/**"],
    "apis": ["ExportService"],
    "schemas": [],
    "locks": ["package-lock.json"]
  },
  "baselineRef": "baseline.json",
  "contexts": {
    "explore": "context/explore.jsonl",
    "implement": "context/implement.jsonl",
    "review": "context/review.jsonl",
    "integrate": "context/integrate.jsonl"
  },
  "policies": {
    "commit": "auto-after-review",
    "push": "never",
    "maxRepairAttempts": 2
  },
  "blockers": [],
  "externalReferences": [],
  "createdAt": "2026-07-14T00:00:00Z",
  "updatedAt": "2026-07-14T00:00:00Z"
}
```

### 4.1 Projection invariants

- `version` MUST equal the accepted Event head sequence.
- `completed` MUST have Phase `finish` and a successful Finish Gate Event.
- `archived` MUST have an archive Event and no active session binding.
- `blocked` MUST retain the Phase and Step at which work stopped plus at least one blocker.
- Initiative parents MUST reference a graph before leaving Plan.
- Initiative parents MUST NOT enter Implement unless an explicit Build node represents parent-owned implementation.

### 4.2 Durable Task Handoff

`tasks/<task-id>/handoff.json` records the durable session-continuity material for a Task at a safe boundary:

```json
{
  "schemaVersion": 1,
  "taskId": "opaque-task-id",
  "phase": "implement",
  "step": "writing",
  "projectionVersion": 17,
  "blockers": [],
  "repositoryFingerprint": "sha256:...",
  "artifactReferences": ["context/implement.jsonl", "evidence/implement-gate.json"],
  "createdAt": "2026-07-14T00:00:00Z"
}
```

- A Handoff MUST be created against the current expected Projection version while no conflicting Task operation holds the Task lock.
- `taskId`, `phase`, `step`, `projectionVersion`, and `blockers` MUST match the recovered Projection exactly.
- `repositoryFingerprint` and every `artifactReferences` entry MUST be non-empty. `createdAt` MUST be RFC 3339 UTC.
- Recovery MUST return the matching Handoff with the Projection. A missing Handoff is allowed; an invalid or stale Handoff MUST fail recovery without rewriting accepted Event history.

## 5. Workflow Events

`events.jsonl` is append-only. A normal transition Event is:

```json
{
  "schemaVersion": 1,
  "eventId": "opaque-event-id",
  "taskId": "opaque-task-id",
  "sequence": 17,
  "previousChainDigest": "sha256:...",
  "chainDigest": "sha256:...",
  "type": "phase_completed",
  "from": {
    "lifecycle": "active",
    "phase": "plan",
    "step": "approval"
  },
  "to": {
    "lifecycle": "active",
    "phase": "implement",
    "step": "ready"
  },
  "actor": {
    "kind": "orchestrator",
    "id": "sayhi-omp",
    "sessionRef": "local-session-reference"
  },
  "outcome": "accepted",
  "evidence": ["evidence/plan-gate.json"],
  "reason": "User approved the implementation plan",
  "idempotencyKey": "opaque-caller-key",
  "occurredAt": "2026-07-14T00:00:00Z"
}
```

### 5.1 Required event behavior

- Sequences start at 1 and increase by one.
- An `idempotencyKey` reused with identical intent returns the original result.
- A reused key with different intent is an error.
- Chain digests detect accidental truncation or reordering; they are not a substitute for signed provenance.
- Event replay MUST be deterministic for a supported schema version.
- Repair tools MUST append corrective administrative Events rather than edit accepted history.

Representative Event types include task creation, Route classification, Route escalation, artifact registration, context freeze, Gate acceptance, Phase transition, blocker creation/resolution, graph revision, Agent dispatch/result acceptance, review waiver, commit recording, external sync observation, knowledge decision, completion, cancellation, and archive.
### 5.2 Tracker synchronization

`tracker_synchronized` records an explicit local observation of a Tracker projection. It preserves the current Task lifecycle, Phase, Step, blockers, and Route while advancing the Event sequence and Projection version. Its `reference` carries a credential-free URI, adapter, external ID, remote observed-version, role, content identity, and observation timestamp.

- `created`, `updated`, and `observed` record a mapped projection after the remote adapter confirms its versioned result.
- `external_closed` records a remotely closed Issue without completing, archiving, or otherwise transitioning the local Task.
- Core records a Tracker Event only after the remote operation is confirmed. Permission denial, rate limiting, an unknown outcome, deleted Issue, or version conflict leaves local Event history unchanged and returns a recoverable diagnostic.
- A remote body, title, or state change that conflicts with the mapped content identity is data-only conflict material; it cannot alter local Task state without an accepted local Event.
- `status` is read-only. An explicit conflict resolution requires user-attributed Event metadata: `resolved_local` conditionally reapplies the local projection against the observed remote version, while `resolved_remote` records the confirmed remote reference without changing local Task state. Event history retains the prior mapped version and the user-selected resolution.
- Persisted Tracker reference URIs permit only HTTP(S) origin and path: userinfo, query, and fragment content are rejected so tokens and other secrets cannot enter Events or Projections.



## 6. Context Manifest

Each phase manifest is JSONL. A Context Entry is:

```json
{
  "schemaVersion": 1,
  "id": "context-entry-id",
  "source": {
    "type": "project-path",
    "value": ".sayhi/spec/backend/api-guidelines.md"
  },
  "kind": "spec",
  "reason": "The task changes a public API",
  "required": true,
  "mode": "full",
  "trust": "approved-spec",
  "instructionPolicy": "scoped-instruction",
  "scope": ["packages/api/**"],
  "identity": {
    "algorithm": "sha256-lf-v1",
    "digest": "..."
  },
  "addedBy": "planning-agent-output-id",
  "acceptedByEvent": "event-id"
}
```

Allowed `mode` values are `full`, `summary`, and `pointer`.

Allowed trust values are:

- `engine-instruction`
- `approved-spec`
- `task-context`
- `untrusted-reference`

The manifest reader MUST preserve source boundaries during rendering. Content from `untrusted-reference` MUST be placed in data-only containers and MUST NOT be concatenated into an instruction block.
An `approved-spec` entry MUST match the source path and content identity recorded in Core-maintained approved project state. A path, filename, heading, or unrecorded file under `.sayhi/spec/` MUST NOT assign instruction authority.

## 7. Repository Baseline and Fingerprint

`baseline.json` records the accepted initial state:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-07-14T00:00:00Z",
  "repositoryRootIdentity": "stable-local-repository-id",
  "head": "git-object-id-or-null",
  "indexDigest": "sha256:...",
  "trackedWorktreeDigest": "sha256:...",
  "untracked": [
    { "path": "notes.txt", "identity": { "algorithm": "sha256-bytes-v1", "digest": "..." } }
  ],
  "submodulesDigest": "sha256:...",
  "dirtyPaths": [
    { "path": "notes.txt", "identity": "sha256:..." }
  ],
  "adoptedPaths": [],
  "declaredScope": {
    "files": ["packages/export/**"],
    "apis": [],
    "schemas": [],
    "locks": []
  }
}
```

A Repository Fingerprint is a compact digest of the same material at a point in time. Ignored runtime files and Project Store Task records are excluded; all other untracked paths, including ignored user files, are included. The exact canonical encoding MUST be versioned so two components cannot compare fingerprints produced by different algorithms as equal.

Adopting a pre-existing change appends an Event that binds the new Baseline identity to its exact paths and diff identities. Adoption MUST show every path and diff being incorporated.

## 8. Lease record

Lease files live under `.sayhi/.runtime/` and are not committed:

```json
{
  "schemaVersion": 1,
  "leaseId": "random-unpredictable-id",
  "kind": "writer",
  "projectId": "...",
  "taskId": "...",
  "owner": {
    "sessionId": "...",
    "processId": 1234,
    "hostId": "...",
    "installId": "..."
  },
  "baseFingerprint": "...",
  "acquiredAt": "...",
  "heartbeatAt": "...",
  "expiresAt": "..."
}
```

Lease acquisition MUST use an atomic create operation. Expiry makes a lease eligible for diagnosis, not automatically safe to steal. Recovery verifies owner liveness when possible, repository stability, and no active operation before issuing a replacement lease.

## 9. Agent Capability Contract

A sidecar Agent contract contains:

```json
{
  "schemaVersion": 1,
  "role": "standards-review",
  "runtimeName": "sayhi-v1-standards-review",
  "contractVersion": 1,
  "tools": ["read", "search", "find", "lsp"],
  "network": "none",
  "skills": ["code-review"],
  "spawns": [],
  "repositoryAccess": "read-only",
  "outputSchema": "schemas/agent/standards-review-output.json",
  "promptBaseIdentity": "sha256:...",
  "overridePolicy": "prompt-body-only"
}
```

The generated runtime definition MUST be validated against the contract before dispatch. An override cannot add frontmatter, tools, Skills, network, or spawn rights.

## 10. Agent dispatch and result

A dispatch request binds execution to state:

```json
{
  "schemaVersion": 1,
  "dispatchId": "...",
  "taskId": "...",
  "expectedTaskVersion": 17,
  "phase": "review",
  "agentRole": "standards-review",
  "agentContractIdentity": "sha256:...",
  "contextManifestIdentity": "sha256:...",
  "baseFingerprint": "...",
  "requestedAt": "..."
}
```

Every Agent result MUST echo these binding values and include a schema-valid `outcome`, artifacts, Evidence, legacy diagnostic `findings`, and observed final fingerprint. A result cannot declare a Task transition accepted.

`findings` remains the version-1 array of diagnostic strings so previously persisted Agent results remain readable. New Review results additionally include structured `reviewFindings`. Each Review finding has a stable `id`, `severity` (`blocking` or `advisory`), `subject` (`acceptance-criterion` or `approved-spec`), `reference`, `message`, and actionable `remediation`. Only Standards Review and Spec Review results may include `reviewFindings`. A failed or blocked Review result MUST contain at least one blocking `reviewFinding`; a successful Review result MUST NOT contain one.

Standards Review and Spec Review Capability Contracts MUST have `read-only` repository access and independently assess the exact Implementation final fingerprint. Their `baseFingerprint` and `observedFinalFingerprint` MUST both equal that fingerprint. A Build may enter Review only after a successful current-cycle Implementation result. It may enter Finish only after both independent Review results succeed without blocking findings. A blocking finding permits the explicit Review repair transition. When the configured repair-attempt limit is exhausted, Core blocks the Task with the accepted Review Evidence preserved.

For an active Build Phase, Core accepts a `phase_execution_dispatched` Workflow Event that binds the exact approved Plan identity to the complete dispatch binding, including Context Manifest, Phase Agent Capability Contract, and ordered locked Skill identities. Core accepts at most one result for that dispatch as a `phase_execution_result_accepted` Event.

On resume, Core MUST load the bound Plan evidence and revalidate the live Context Manifest, Capability Contract, and Skill materials against the durable binding before work continues or an accepted result returns. A changed or missing Plan, Context, Agent capability, or Skill MUST append a same-Phase Block Event using caller-supplied Event metadata and return a review-required disposition with its actionable diagnostic. When every identity is unchanged and a result is already accepted, resume returns that result and MUST NOT dispatch the Phase Agent again.
A successful Phase dispatch holds an opaque runtime shared-checkout Reader Lease scoped to its dispatch ID before it returns ready. Promotion and every other shared-checkout Writer MUST wait for all such leases to end. Recording an accepted Phase result releases its exact Lease after validation. Resume and recovery MUST supply the exact Lease as an attributable handoff that the caller has stopped the prior Phase Agent; a missing or mismatched Lease MUST fail without reclaiming an active Reader.

## 11. Evidence

Evidence records include:

```json
{
  "schemaVersion": 1,
  "id": "evidence-id",
  "taskId": "...",
  "kind": "validation",
  "producer": "sayhi-validation-runner",
  "baseFingerprint": "...",
  "command": {
    "argv": ["npm", "test", "--", "export"],
    "cwd": ".",
    "exitCode": 0
  },
  "artifacts": [],
  "result": "passed",
  "startedAt": "...",
  "completedAt": "..."
}
```

Secrets and excessive raw output MUST be redacted or stored in local diagnostic logs with a durable digest and bounded excerpt. Evidence MUST distinguish “not run,” “passed,” “failed,” and “inconclusive.”

## 12. Dependency Graph

`graph.json` contains a versioned DAG:

```json
{
  "schemaVersion": 1,
  "id": "graph-id",
  "initiativeTaskId": "...",
  "version": 4,
  "nodes": [
    {
      "taskId": "TASK-102",
      "priority": 50,
      "resources": {
        "files": ["packages/api/**"],
        "apis": ["UserService.create"],
        "schemas": ["users"],
        "locks": ["package-lock.json"]
      }
    }
  ],
  "edges": [
    { "from": "TASK-101", "to": "TASK-102", "type": "blocks", "reason": "..." }
  ],
  "updatedByEvent": "event-id"
}
```

`supersedes` edges retain replaced nodes; they do not delete historical Tasks. Readiness is derived and SHOULD NOT be persisted as an independent source of truth.

Ordinary Build nodes omit `repair` and `repairIntent`. A graph-visible Repair node retains the failed Integration context in `repair`: `failureKind` is `conflict` or `acceptance-failed`, `summary` is non-empty, and `evidence` contains at least one typed Evidence reference. Its `repairIntent` retains the child Build Task's non-empty goals and independently verifiable acceptance criteria. Repair creation also creates the matching durable child Build Task with the Initiative as `parentTaskId`. The Repair node has explicit `blocks` edges from its completed prerequisite Build nodes; a later graph revision retains both the original nodes and their Events.

## 13. External Reference

```json
{
  "schemaVersion": 1,
  "id": "reference-id",
  "kind": "issue",
  "adapter": "github",
  "uri": "https://github.com/org/repo/issues/42",
  "externalId": "42",
  "observedVersion": "etag-or-updated-at",
  "role": "specification",
  "identity": null,
  "lastObservedAt": "..."
}
```

Local state changes based on an External Reference require a local Event. Remote credentials never appear in the reference.

## 14. Knowledge Candidate

```json
{
  "schemaVersion": 1,
  "id": "candidate-id",
  "taskId": "...",
  "type": "convention",
  "statement": "Public APIs use the project error envelope",
  "scope": ["packages/api/**"],
  "evidence": ["evidence/review.json"],
  "confidence": "high",
  "proposedAction": "update-spec",
  "target": ".sayhi/spec/backend/api-guidelines.md",
  "contentHash": "sha256:...",
  "targetIdentity": { "algorithm": "sha256-lf-v1", "digest": "..." },
  "status": "pending",
  "createdBy": "knowledge-agent-result-id",
  "createdAt": "...",
  "review": null
}
```

`contentHash` covers the proposed knowledge content, while `taskId`, `evidence`, and `createdBy` retain provenance. `targetIdentity` snapshots an existing target or is `null` when the target was absent. Any later target appearance, removal, type change, or content change makes the Candidate stale and requires revision. Human review changes only the Candidate status to `accepted`, `rejected`, or `revision-requested` and records reviewer, reason, and timestamp; it MUST NOT change the target. A later human-authorized promotion Event may change Approved knowledge, record promotion provenance, and invalidate affected Context Manifests.

A Promotion Event is an immutable record containing an attributable `user` Event, the requested `candidateHash`, a complete Candidate snapshot (including source Task, Evidence, and review), the target's prior and new content identities, and the exact active Context Manifests bound to that target. Core accepts it only when the snapshot Candidate remains `accepted`, its review is `approved`, and the supplied hash equals its immutable `contentHash`; it never rewrites the Candidate. A later Promotion Event records the prior target Promotion Event ids in `supersedes`. Core stages the record and replacement content in `.sayhi/.runtime/knowledge-promotion.json` before mutation; recovery observes the target's before or after identity before finishing the approval registry and immutable Event. The V1 adapters promote `update-spec` Candidates under `.sayhi/spec/`, `update-adr` Candidates under `docs/adr/`, `update-domain` Candidates targeting `CONTEXT.md`, and `update-runbook` Candidates under `docs/runbooks/`.

## 15. Skill Lock

The release Skill Lock contains:

```json
{
  "schemaVersion": 1,
  "registry": {
    "repository": "https://github.com/dnslin/skills",
    "commit": "full-git-commit"
  },
  "skills": [
    {
      "name": "tdd",
      "path": "tdd",
      "files": [
        {
          "path": "SKILL.md",
          "sha256": {
            "algorithm": "sha256-bytes-v1",
            "digest": "hex-encoded-sha256"
          }
        }
      ],
      "upstream": {
        "repository": "https://github.com/mattpocock/skills",
        "commit": "full-upstream-commit",
        "path": "skills/engineering/tdd",
        "license": "MIT"
      },
      "sidecarIdentity": "sha256:..."
    }
  ]
}
```

Runtime reads the installed lock for diagnostics but never fetches newer Skills.

## 16. Managed files

`.sayhi/managed-files.json` records:

- path;
- Ownership Class;
- installed base identity;
- generated source/template version;
- marker IDs for Managed Blocks;
- incoming update identity when an update is pending;
- optional local override source.

Installed base and incoming update identities use the Content Identity descriptor from section 2.

Engine-owned content that does not match the installed base is locally modified and cannot be overwritten automatically. User-owned content has no replacement base. Managed-customizable content is composed from an Engine-owned base and constrained override or managed markers.

## 17. Atomicity and recovery

- JSON snapshots are written to a same-directory temporary file, flushed where supported, and atomically renamed.
- Event append occurs before Projection replacement.
- Multi-file update operations create a staged plan and operation journal under local runtime.
- Initiative Repair creation stages `.sayhi/.runtime/initiative-repair-operation.json` through `prepared`, `graph-revised`, and `completed`; recovery uses the accepted graph Event to finish any missing child Build Task.
- On restart, Core determines whether to finish a safe atomic replacement, replay accepted Events, or require recovery.
- Recovery MUST NOT infer successful external side effects without observing them through the adapter.
