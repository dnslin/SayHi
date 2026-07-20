# Issue #37 — Packaged Project Store lifecycle design

## Scope

Demonstrate the existing Managed Project lifecycle through the packed Core, CLI, OMP, and testing artifacts that a fresh environment installs offline. The contract covers initial installation, the supported legacy template update, Durable Task continuity, failure recovery, and ownership-aware uninstall. It adds no alternate migration format or runtime installer.

## Design basis

- **Rejected assumption:** source-workspace contracts prove distributable behavior. Packed artifacts can omit a file, resolve a different dependency, or change module paths.
- **Bedrock constraint:** a Project Store can preserve continuity only if its durable Task records remain byte-stable across a supported update; ownership migration may change only the ownership records and managed template bytes it owns.
- **Resulting design:** extend the existing packed-artifact matrix with a lifecycle fixture. It creates a Task through the installed CLI, upgrades the supported legacy template, compares Task bytes before and after, verifies ownership remains complete, and exercises the already-journaled Core mutation recovery from the installed CLI.
- **Alternative not chosen:** add a migration command or a new rollback subsystem. The existing `project.update` plan, operation journal, and `project.uninstall` ownership rules already encode the necessary state transitions.

## Confirmed public seams

1. **Installed artifacts** — the offline `npm pack`/install fixture executes the packaged CLI binary and imports the packaged OMP integration.
2. **Supported update continuity** — `sayhi update --apply` upgrades the legacy runtime-ignore template while preserving durable Task Event/Projection bytes, Task provenance, and Ownership Class records.
3. **Recoverable mutation failure** — `applyManagedProjectPlan` reports an actionable failure and leaves its operation journal; the packaged CLI resumes update or uninstall safely, retaining User-owned content.

## Invariants

- The packed CLI and OMP packages resolve only the packed Core dependency.
- The supported legacy runtime-ignore base is recognized by its recorded installed-base identity; its update changes the template and installation version, never Task records.
- A failed mutation leaves the operation journal until recovery. Recovery is idempotent and completes only actions still expected by the journal.
- User-owned files are retained through update, failure recovery, and uninstall.
- Uninstall removes only Engine-owned Project Store files once its journaled operation completes; a retained User-owned file remains actionable local state.

## Verification

The installed matrix covers fresh CLI/OMP use, legacy migration with durable Task byte continuity and ownership checks, failed update and uninstall journaling, packaged CLI recovery, retained User-owned content, and final uninstall state. The final command runs the complete repository suite.
