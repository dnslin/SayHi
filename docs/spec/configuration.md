# SayHi Configuration Specification

**Status:** Accepted design baseline

## 1. Configuration layers

SayHi configuration is assembled in this precedence order:

```text
explicit CLI or Tool operation parameters
> SAYHI_* environment variables for supported machine/secret settings
> ignored local project configuration
> committed .sayhi/config.yaml
> release defaults
```

Higher precedence replaces scalar values. Map and list behavior MUST be declared per field; implementations MUST NOT apply an undocumented generic deep merge. A lower-precedence layer cannot weaken an Engine security invariant.

## 2. Committed project configuration

`.sayhi/config.yaml` contains team-reviewed behavior without credentials or machine paths.

Illustrative V1 shape:

```yaml
schemaVersion: 1

project:
  name: example

workflow:
  defaultRoute: classify
  requireBuildConsent: true
  maxRepairAttempts: 2
  commitPolicy: auto-after-review
  pushPolicy: never

context:
  maxEntriesPerManifest: 100
  maxExpandedBytes: 500000
  importDepth: 5
  stalePolicy: block

scheduler:
  maxParallelReaders: 4
  writerLeaseSeconds: 300
  heartbeatSeconds: 15

validation:
  commands:
    targeted: []
    full: []
    integration: []

skills:
  capabilityPacks: []

agents:
  overridesDir: .sayhi/overrides/agents

tracker:
  adapter: local
  configRef: docs/agents/issue-tracker.md

knowledge:
  promotion: human-required

journal:
  developerIdSource: local
```

Values above are representative defaults for schema design, not permission to implement unbounded byte or time values without validation.

## 3. Local ignored configuration

Machine-specific values live at a path declared by Core and covered by `.gitignore`, expected to be `.sayhi/.runtime/config.local.yaml` in V1. It may contain:

- developer identity;
- local command-path overrides;
- host/install identity;
- preferred OMP model hints that do not affect correctness;
- tracker credential references, never raw credentials when a credential store is available;
- local diagnostic and cache preferences.

Local configuration MUST NOT define Approved Specs, alter Event history, raise Agent capabilities, disable required Gates, or authorize push.

## 4. Environment variables

All variables use the `SAYHI_` prefix. V1 MUST document an allowlist rather than converting arbitrary environment keys into configuration paths.

Expected categories include:

- credential references or adapter tokens;
- noninteractive/CI mode;
- local cache and diagnostic locations;
- explicit session or install identity where supplied by an adapter;
- test-only deterministic clock/randomness hooks unavailable in production builds.

Secret-bearing variables MUST be redacted from diagnostics.

## 5. Workflow policy

Configurable workflow policy MAY choose defaults within Core limits:

- default Route behavior (`classify`, `quick`, or `build` where safe);
- whether Build consent is required, which defaults to true and cannot be disabled by untrusted project content;
- commit policy (`auto-after-review`, `confirm`, `never`);
- maximum repair attempts up to the Engine maximum;
- optional stricter Review or validation Gates;
- journal and handoff preferences.

Configuration MUST NOT remove mandatory Triage, Review for code changes, Finish before archive, or Initiative Integration.

## 6. Validation commands

Validation commands are structured records, not shell strings:

```yaml
validation:
  commands:
    targeted:
      - id: unit-export
        argv: [npm, test, "--", export]
        cwd: .
        timeoutSeconds: 120
        expectedWrites: []
```

Initialization MAY auto-detect candidates from package manifests, workspace configuration, Makefiles, language toolchains, and CI. Detected commands become committed configuration only after review.

Commands that may write snapshots, generated files, caches inside the repository, lockfiles, or databases MUST declare expected side effects and execute under an exclusive validation lease.

## 7. Context budgets

Context settings define hard resource ceilings, not semantic selection:

- maximum manifest entries;
- maximum bytes/tokens expanded per trust tier;
- maximum individual file size;
- recursive import depth;
- permitted external URI schemes;
- behavior when required content exceeds budget.

Required Approved Specs cannot be silently dropped to meet a budget. The consuming operation must block, summarize through an approved process, or obtain a manifest revision.

## 8. Scheduler settings

Projects MAY lower parallel Reader count or lease duration. They cannot configure more than one shared-checkout Writer in V1.

Lease expiry and heartbeat settings have Engine-enforced safe ranges. Expiry never authorizes blind lease stealing.

## 9. Skills and Agent overrides

Committed configuration enables named capability packs. It does not specify arbitrary filesystem Skills for managed autoload.

Agent overrides reference prompt-body files in the declared override directory. The generated Agent Contract remains Engine-owned. An override attempting to include frontmatter or capability fields is rejected.

## 10. Tracker configuration

The committed configuration identifies adapter type and a non-secret configuration reference. Original `setup-matt-pocock-skills` output at `docs/agents/issue-tracker.md` may supply repository-level tracker semantics.

Hostnames, project IDs, label mappings, and field mappings may be committed. Tokens and personal identities remain local or external.

## 11. Configuration validation

Configuration is validated before any mutation operation. Errors include:

- unsupported schema version;
- unknown security-sensitive field;
- invalid enum or unsafe numeric bound;
- prohibited push/destructive Git policy;
- unstructured shell command;
- missing referenced override or tracker configuration;
- attempt to expand an Agent contract;
- context budget unable to include mandatory Engine Instructions.

Read-only status MAY operate in a degraded mode to report errors. Mutation fails closed.

## 12. Unknown fields and forward compatibility

Readers MAY preserve unknown fields for a newer minor schema when they do not influence current behavior. A component MUST refuse mutation when it encounters an unknown field in a security-, state-, Agent-, Git-, or trust-sensitive section.

Migrations create an explicit plan and never drop unknown data silently.
