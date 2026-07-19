# Issue #33 — GitLab and custom Tracker projection design

## Scope

Create a deterministic Core Tracker-projection module for the GitLab and configured custom adapters. A local `WorkflowState` remains the only authority for Task lifecycle state; remote mappings, resource identifiers, versions, and capability flags live only in the adapter-side projection record.

This issue deliberately does not add CLI commands, network clients, credentials, pull/import behavior, or automatic conflict resolution. A later adapter may translate GitLab HTTP calls into the narrow remote port, but that implementation must supply a conditional-write outcome; GitLab's documented issue update endpoint returns `iid` and `updated_at` but does not provide a documented compare-and-swap request parameter.

## Confirmed public seams

1. **Core Tracker projection operation** — one operation projects a locally authoritative `WorkflowState` to an adapter. It creates a mapping, updates a mapped resource, retries safely, and archives a mapped resource. Its typed result distinguishes `created`, `updated`, `unchanged`, `archived`, reconciliation-required, and recovery-required outcomes.
2. **Adapter remote port** — the Core supplies a deterministic projection payload carrying a stable Task marker and an authority identity. The GitLab and custom adapters provide lookup, create, conditional replace, and archive operations plus declared capabilities. The port returns typed resource, conflict, unsupported, authentication, and uncertain outcomes; it never throws credentials into diagnostics.
3. **Mapping store** — the adapter owns durable mapping persistence. A mapping keeps only the Task ID, adapter identifier, external identifier/credential-free URI, observed remote version, projected authority identity, and a pending mutation identity/operation when an update or archive outcome is unknown. It is an `External Reference`-shaped projection record, never a field in the Task Projection or Workflow Event history.

## Invariants

- The stable marker derives from the local Task ID. Before create, Core looks it up; a retry after an unknown create result adopts the discovered resource instead of creating a duplicate.
- Before an update or archive, Core persists the pending local authority identity and operation. A remote resource that matches incoming local authority is adopted only when it still matches the recorded mapping or a matching pending mutation proves an unknown local operation may have succeeded; any other projected-field change requires reconciliation. Conditional writes use the current remote version after that identity check.
- A remote version change that leaves the projected identity intact is recorded as an unchanged observation, allowing comments or unrelated metadata to advance the remote version without fabricating a conflict.
- Archive is a projection update, never remote deletion. An adapter that cannot archive fails closed with a recoverable `unsupported` diagnostic.
- Authentication failures and uncertain network outcomes include only a safe diagnostic code, operation, adapter identifier, and remediation. Remote content and credentials are not persisted or promoted to authority; adapter-returned resource URIs must be absolute and credential-free before persistence.
- GitLab and custom adapter fixtures exercise the same public Core seam. Adapter-specific remote IDs remain behind the mapping/port seam.

## Verification

Add contract tests at the confirmed Core seam: each GitLab and custom fixture verifies initial create, local update, idempotent retry, and archive. The shared suite also verifies uncertain create/update/archive responses, a matching remote edit without a pending local mutation, unsupported archive, authentication failure, credentialed URI rejection, a detected concurrent edit, and a conditional-write conflict. Run the focused test after each red/green slice, then typecheck and the full suite.
