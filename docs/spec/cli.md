# SayHi CLI Specification

**Binary:** `sayhi`  
**Package:** `@dnslin/sayhi-cli`  
**Status:** Accepted design baseline

## 1. Purpose

The CLI is the human, CI, and administrative adapter to SayHi Core. It MUST call Core in-process and MUST NOT maintain independent workflow logic.

## 2. Invocation model

```text
sayhi [global-options] <command> [subcommand] [arguments]
```

Global options:

- `--cwd <path>` — target working directory;
- `--json` — emit one machine-readable result object;
- `--no-color` — disable styled output;
- `--non-interactive` — never prompt; fail when a decision is required;
- `--verbose` — include bounded diagnostic detail;
- `--version` and `--help`.

Human output goes to stdout for results and stderr for warnings/diagnostics. JSON mode MUST not mix prose into stdout.

## 3. Exit codes

| Code | Meaning |
|---:|---|
| 0 | operation completed successfully |
| 2 | invalid command or arguments |
| 3 | schema, configuration, or validation failure |
| 4 | repository, update, or synchronization conflict |
| 5 | workflow blocked or human Gate required |
| 6 | SayHi is not initialized for the target repository |
| 7 | installed component or schema incompatibility |
| 8 | external adapter or process failure |
| 9 | operation cancelled or safely aborted |

Domain error codes inside JSON output are more specific and remain stable across localized human messages.

## 4. Command families

### 4.1 Project lifecycle

```text
sayhi init
sayhi status
sayhi doctor
sayhi update --check|--apply|--dry-run
sayhi uninstall --dry-run|--apply
sayhi migrate --plan|--apply
```

`init` MUST inspect existing `.omp`, `AGENTS.md`, repository dirtiness, project type, likely validation commands, and tracker configuration. It presents a write plan and never assumes existing files are expendable.

`doctor` MUST be read-only unless invoked with a separately named repair action. It checks at least:

- Project Store and schema compatibility;
- Projection/Event consistency;
- stale or suspicious leases;
- Git ignore and ownership records;
- generated-file and Managed Block integrity;
- Plugin/Core/CLI/Skill Lock compatibility;
- Agent name collisions and contract hashes;
- context freshness and path safety;
- tracker adapter configuration without printing secrets.

### 4.2 Flow and task lifecycle

```text
sayhi flow start [request]
sayhi flow status [--task <id>]
sayhi flow resume <task-id>
sayhi flow pause [--reason <text>]
sayhi flow abort [--reason <text>]

sayhi task create --from <start-request.json>
sayhi task show <task-id>
sayhi task list
sayhi task events <task-id>
sayhi task advance <task-id> --from <transition-request.json>
sayhi task block <task-id> --from <transition-request.json>
sayhi task unblock <task-id> --from <transition-request.json>
sayhi task complete <task-id> --from <transition-request.json>
sayhi task archive <task-id> --from <transition-request.json>
sayhi task recover <task-id> --apply
```

Commands that imply a transition MUST use the same transition service as the OMP `workflow_advance` Tool. Administrative commands cannot skip Gates unless a specific, audited override operation exists.

`task create`, `task advance`, `task block`, `task unblock`, `task complete`, and `task archive` read their request JSON from a regular, repository-relative file. The CLI transports that request to Core; Core remains the sole validator of Task state, versions, Gates, Events, and archive eligibility.

### 4.3 Baseline and Git

```text
sayhi task baseline <task-id>
sayhi task adopt <task-id> <path...>
sayhi task commit-plan <task-id>
sayhi task commit <task-id>
```

`adopt` MUST display or output every pre-existing dirty path captured in the shared checkout Baseline, including paths outside the declared Task Scope; it MUST refuse incomplete adoption. `commit-plan` is read-only and lists Gate state, paths, existing index content, proposed message, and exclusions. The CLI MUST refuse to stage unknown pre-existing content.

No V1 command performs push, reset, stash, rebase, revert, or forced checkout.

### 4.4 Specifications and context

```text
sayhi spec create <path> --from <source> --dry-run|--apply
sayhi spec list
sayhi spec show <path>
sayhi spec validate [path]
sayhi spec impacted <path>

sayhi context list <task-id> [phase]
sayhi context add <task-id> <phase> <source> --dry-run|--apply
sayhi context remove <task-id> <phase> <entry-id> --dry-run|--apply
sayhi context validate <task-id> [phase]
sayhi context refresh <task-id> [phase] --dry-run|--apply [--accept-approved-spec-change]
sayhi context freeze <task-id> <phase> --dry-run|--apply
```

Context mutations produce a plan with `--dry-run`, validate trust assignment, and append Events only with `--apply`. When omitted, `[phase]` resolves to the current Task Phase. `spec create --apply` records the created content identity as approved project state; a file placed manually under `.sayhi/spec/` is still an Untrusted Reference. `refresh` recalculates identity but MUST NOT silently accept changed semantics; changed Approved Spec content requires the scoped `--accept-approved-spec-change` confirmation flag.

### 4.5 Dependency graph

```text
sayhi graph show <initiative-id>
sayhi graph validate <initiative-id>
sayhi graph ready <initiative-id>
sayhi graph add-node <initiative-id> <task-id>
sayhi graph add-edge <initiative-id> <from> <to> --type <type>
sayhi graph remove-edge <initiative-id> <edge-id>
sayhi graph revise <initiative-id> --plan|--apply
```

Graph mutation after Plan requires an accepted revision reason and renewed approval. `ready` is a derived read operation.

### 4.6 Workspace and Journal

```text
sayhi workspace init <developer-id>
sayhi journal add
sayhi journal list [--developer <id>]
sayhi journal show <entry-id>
sayhi handoff create <task-id>
sayhi handoff validate <reference>
```

Journal commands MUST distinguish committed shared summaries from local machine paths and MUST avoid placing secrets or full raw logs in durable entries.

### 4.7 Knowledge

```text
sayhi knowledge list [--status pending]
sayhi knowledge show <candidate-id>
sayhi knowledge review <candidate-id>
sayhi knowledge accept <candidate-id>
sayhi knowledge reject <candidate-id> --reason <text>
sayhi knowledge supersede <candidate-id> --by <reference>
```

Acceptance presents target diff, conflict analysis, scope, provenance, and affected active manifests before applying changes.

### 4.8 Tracker synchronization

```text
sayhi sync status [task-id]
sayhi sync pull [task-id] --plan|--apply
sayhi sync push [task-id] --plan|--apply
sayhi sync resolve <conflict-id>
```

`pull` and `push` default to plan mode in interactive use. External closure never completes a local Task automatically.

### 4.9 Skills and Agents

```text
sayhi skills list
sayhi skills verify
sayhi agents list
sayhi agents verify
sayhi agents render --dry-run
```

These commands inspect the installed Skill Lock, sidecars, Agent contracts, generated identities, collisions, and overrides. They do not update Skills at runtime.

## 5. Mutation protocol

Every mutating CLI command MUST:

1. resolve repository root and Project Store;
2. verify version compatibility;
3. acquire the narrow required lock;
4. load current state and expected version;
5. calculate a change plan;
6. obtain confirmation unless prior policy authorizes it;
7. stage writes or append the Event;
8. atomically apply projections/files where possible;
9. verify postconditions;
10. release the lock and report the durable result.

An interrupt signal propagates through the operation. Cancellation leaves existing durable state valid and reports any external side effect whose result is unknown.

## 6. Interactive behavior

- Prompts MUST include a safe default.
- Headless mode treats every unanswered confirmation as denied.
- A destructive or ambiguous action MUST NOT be hidden behind a general `--yes` flag.
- Conflicts present affected paths and recovery commands.
- Secret input MUST not be echoed or written to Project Store logs.

## 7. JSON result envelope

```json
{
  "ok": true,
  "operation": "context.validate",
  "result": {},
  "warnings": [],
  "diagnostics": [],
  "version": {
    "cli": "0.1.0",
    "core": "0.1.0",
    "schema": 1
  }
}
```

Failure uses `ok: false`, a stable domain error code, human-safe message, optional structured remediation, and no secret-bearing stack trace unless explicitly requested in a safe local context.

## 8. Configuration precedence

The expected precedence is:

```text
explicit CLI flags
> environment variables for secrets/machine settings
> local ignored SayHi configuration
> committed .sayhi/config.yaml
> framework defaults
```

Array and map merge semantics MUST be documented per setting. Security restrictions cannot be weakened through lower-precedence configuration.
