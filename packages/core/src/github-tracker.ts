import { hashCanonicalJson, type ContractIdentity } from "./identity.js";
import {
  recordTrackerSynchronization,
  type RecordTrackerSynchronizationResult,
  type TrackerReference,
  type TrackerSynchronizationChange,
  type TrackerSynchronizedEvent,
  type WorkflowEventMetadata,
  type WorkflowState,
} from "./workflow.js";

export const GITHUB_TRACKER_CONTRACT_VERSION = 1 as const;

export type GitHubIssueState = "open" | "closed";
export type GitHubTrackerFailureCode =
  | "permission-denied"
  | "rate-limited"
  | "outcome-unknown";

export interface GitHubIssue {
  readonly externalId: string;
  readonly uri: string;
  readonly version: string;
  readonly title: string;
  readonly body: string;
  readonly state: GitHubIssueState;
}

export interface GitHubIssueProjection {
  readonly title: string;
  readonly body: string;
  readonly state: GitHubIssueState;
}

export interface GitHubIssueReference {
  readonly externalId: string;
  readonly observedVersion: string;
}

export type GitHubIssueReadResult =
  | Readonly<{ readonly kind: "found"; readonly issue: GitHubIssue }>
  | Readonly<{ readonly kind: "not-found" }>
  | Readonly<{
      readonly kind: "failure";
      readonly code: GitHubTrackerFailureCode;
      readonly retryAfterSeconds?: number;
    }>;

export type GitHubIssueMutationResult =
  | Readonly<{ readonly kind: "success"; readonly issue: GitHubIssue }>
  | Readonly<{ readonly kind: "conflict"; readonly issue: GitHubIssue }>
  | Readonly<{ readonly kind: "not-found" }>
  | Readonly<{
      readonly kind: "failure";
      readonly code: GitHubTrackerFailureCode;
      readonly retryAfterSeconds?: number;
    }>;

export interface GitHubTrackerPort {
  findIssueByTaskId(taskId: string): Promise<GitHubIssueReadResult>;
  readIssue(reference: GitHubIssueReference): Promise<GitHubIssueReadResult>;
  createIssue(request: {
    readonly taskId: string;
    readonly projection: GitHubIssueProjection;
    readonly idempotencyKey: string;
  }): Promise<GitHubIssueMutationResult>;
  updateIssue(request: {
    readonly reference: GitHubIssueReference;
    readonly projection: GitHubIssueProjection;
    readonly idempotencyKey: string;
  }): Promise<GitHubIssueMutationResult>;
}

export interface PushGitHubIssueProjectionRequest {
  readonly state: WorkflowState;
  readonly tracker: GitHubTrackerPort;
  readonly event: WorkflowEventMetadata;
}

export interface PullGitHubIssueProjectionRequest {
  readonly state: WorkflowState;
  readonly tracker: GitHubTrackerPort;
  readonly event: WorkflowEventMetadata;
}

export interface GitHubIssueSyncConflict {
  readonly expectedVersion: string | null;
  readonly observed: GitHubIssue;
  readonly desired: GitHubIssueProjection;
}

export type GitHubTrackerDiagnosticCode =
  | "github.permission_denied"
  | "github.rate_limited"
  | "github.outcome_unknown"
  | "github.issue_deleted"
  | "github.not_mapped"
  | "github.invalid_response"
  | "github.idempotency_conflict"
  | "github.local_state_stale";

export interface GitHubTrackerDiagnostic {
  readonly code: GitHubTrackerDiagnosticCode;
  readonly message: string;
  readonly remediation: string;
  readonly recoverable: true;
  readonly retryAfterSeconds?: number;
}

export type GitHubIssueProjectionResult =
  | Readonly<{
      readonly disposition: "created" | "updated" | "observed";
      readonly state: WorkflowState;
      readonly event: TrackerSynchronizedEvent;
    }>
  | Readonly<{
      readonly disposition: "external-closed";
      readonly state: WorkflowState;
      readonly event: TrackerSynchronizedEvent;
    }>
  | Readonly<{ readonly disposition: "unchanged"; readonly state: WorkflowState }>
  | Readonly<{
      readonly disposition: "sync-conflict";
      readonly state: WorkflowState;
      readonly conflict: GitHubIssueSyncConflict;
    }>
  | Readonly<{
      readonly disposition: "diagnostic";
      readonly state: WorkflowState;
      readonly diagnostic: GitHubTrackerDiagnostic;
    }>;

export async function pushGitHubIssueProjection(
  request: PushGitHubIssueProjectionRequest,
): Promise<GitHubIssueProjectionResult> {
  const repeated = repeatedSynchronization(request.state, request.event);
  if (repeated !== null) {
    return repeated;
  }

  const projection = renderGitHubIssueProjection(request.state);
  const reference = latestGitHubReference(request.state);
  if (reference === undefined) {
    const discovered = await findIssue(request.tracker, request.state.projection.id);
    if (discovered.kind === "diagnostic") {
      return withDiagnostic(request.state, discovered.diagnostic);
    }
    if (discovered.issue !== null) {
      if (issueIdentity(discovered.issue) !== projectionIdentity(projection)) {
        return conflict(request.state, null, discovered.issue, projection);
      }
      return recordSynchronization(request, discovered.issue, "observed");
    }

    const created = await createIssue(
      request.tracker,
      request.state.projection.id,
      projection,
      request.event.idempotencyKey,
    );
    if (created.kind === "diagnostic") {
      return withDiagnostic(request.state, created.diagnostic);
    }
    if (created.issue === null) {
      return withDiagnostic(request.state, issueDeletedDiagnostic());
    }
    if (issueIdentity(created.issue) !== projectionIdentity(projection)) {
      return conflict(request.state, null, created.issue, projection);
    }
    return recordSynchronization(request, created.issue, "created");
  }

  if (reference.identity === projectionIdentity(projection)) {
    return Object.freeze({ disposition: "unchanged", state: request.state });
  }

  const updated = await updateIssue(
    request.tracker,
    reference,
    projection,
    request.event.idempotencyKey,
  );
  if (updated.kind === "diagnostic") {
    return withDiagnostic(request.state, updated.diagnostic);
  }
  if (updated.conflict !== null) {
    return conflict(request.state, reference.observedVersion, updated.conflict, projection);
  }
  if (updated.issue === null) {
    return withDiagnostic(request.state, issueDeletedDiagnostic());
  }
  if (issueIdentity(updated.issue) !== projectionIdentity(projection)) {
    return conflict(request.state, reference.observedVersion, updated.issue, projection);
  }
  return recordSynchronization(request, updated.issue, "updated");
}

export async function pullGitHubIssueProjection(
  request: PullGitHubIssueProjectionRequest,
): Promise<GitHubIssueProjectionResult> {
  const repeated = repeatedSynchronization(request.state, request.event);
  if (repeated !== null) {
    return repeated;
  }

  const reference = latestGitHubReference(request.state);
  if (reference === undefined) {
    return withDiagnostic(request.state, {
      code: "github.not_mapped",
      message: "The local Task has no mapped GitHub Issue to pull.",
      remediation: "Push the Task projection first or explicitly establish its GitHub Issue mapping.",
      recoverable: true,
    });
  }

  const read = await readIssue(request.tracker, reference);
  if (read.kind === "diagnostic") {
    return withDiagnostic(request.state, read.diagnostic);
  }
  if (read.issue === null) {
    return withDiagnostic(request.state, issueDeletedDiagnostic());
  }

  const observedIdentity = issueIdentity(read.issue);
  if (read.issue.state === "closed") {
    if (
      observedIdentity === reference.identity &&
      read.issue.version === reference.observedVersion
    ) {
      return Object.freeze({ disposition: "unchanged", state: request.state });
    }
    return recordSynchronization(request, read.issue, "external_closed");
  }
  if (observedIdentity !== reference.identity) {
    return conflict(
      request.state,
      reference.observedVersion,
      read.issue,
      renderGitHubIssueProjection(request.state),
    );
  }
  if (read.issue.version === reference.observedVersion) {
    return Object.freeze({ disposition: "unchanged", state: request.state });
  }
  return recordSynchronization(request, read.issue, "observed");
}

function repeatedSynchronization(
  state: WorkflowState,
  event: WorkflowEventMetadata,
): GitHubIssueProjectionResult | null {
  const repeated = state.events.find(
    (candidate) => candidate.idempotencyKey === event.idempotencyKey,
  );
  if (repeated === undefined) {
    return null;
  }
  if (repeated.type === "tracker_synchronized" && repeated.reference.adapter === "github") {
    return Object.freeze({ disposition: "unchanged", state });
  }
  return withDiagnostic(state, {
    code: "github.idempotency_conflict",
    message: "The synchronization idempotency key is already bound to another local Event.",
    remediation: "Retry this synchronization with the original Event material or allocate a new idempotency key.",
    recoverable: true,
  });
}

async function findIssue(
  tracker: GitHubTrackerPort,
  taskId: string,
): Promise<
  | Readonly<{ readonly kind: "found"; readonly issue: GitHubIssue | null }>
  | Readonly<{ readonly kind: "diagnostic"; readonly diagnostic: GitHubTrackerDiagnostic }>
> {
  try {
    const result = await tracker.findIssueByTaskId(taskId);
    if (result.kind === "not-found") {
      return Object.freeze({ kind: "found", issue: null });
    }
    if (result.kind === "failure") {
      return failureDiagnostic(result);
    }
    return isGitHubIssue(result.issue)
      ? Object.freeze({ kind: "found", issue: freezeIssue(result.issue) })
      : invalidResponseDiagnostic();
  } catch {
    return outcomeUnknownDiagnostic();
  }
}

async function readIssue(
  tracker: GitHubTrackerPort,
  reference: TrackerReference,
): Promise<
  | Readonly<{ readonly kind: "found"; readonly issue: GitHubIssue | null }>
  | Readonly<{ readonly kind: "diagnostic"; readonly diagnostic: GitHubTrackerDiagnostic }>
> {
  try {
    const result = await tracker.readIssue(reference);
    if (result.kind === "not-found") {
      return Object.freeze({ kind: "found", issue: null });
    }
    if (result.kind === "failure") {
      return failureDiagnostic(result);
    }
    return isGitHubIssue(result.issue)
      ? Object.freeze({ kind: "found", issue: freezeIssue(result.issue) })
      : invalidResponseDiagnostic();
  } catch {
    return outcomeUnknownDiagnostic();
  }
}

async function createIssue(
  tracker: GitHubTrackerPort,
  taskId: string,
  projection: GitHubIssueProjection,
  idempotencyKey: string,
): Promise<
  | Readonly<{ readonly kind: "success"; readonly issue: GitHubIssue | null }>
  | Readonly<{ readonly kind: "diagnostic"; readonly diagnostic: GitHubTrackerDiagnostic }>
> {
  try {
    const result = await tracker.createIssue({ taskId, projection, idempotencyKey });
    if (result.kind === "not-found") {
      return Object.freeze({ kind: "success", issue: null });
    }
    if (result.kind === "conflict") {
      return isGitHubIssue(result.issue)
        ? Object.freeze({ kind: "success", issue: freezeIssue(result.issue) })
        : invalidResponseDiagnostic();
    }
    if (result.kind === "failure") {
      return failureDiagnostic(result);
    }
    return isGitHubIssue(result.issue)
      ? Object.freeze({ kind: "success", issue: freezeIssue(result.issue) })
      : invalidResponseDiagnostic();
  } catch {
    return outcomeUnknownDiagnostic();
  }
}

async function updateIssue(
  tracker: GitHubTrackerPort,
  reference: TrackerReference,
  projection: GitHubIssueProjection,
  idempotencyKey: string,
): Promise<
  | Readonly<{ readonly kind: "success"; readonly issue: GitHubIssue | null; readonly conflict: null }>
  | Readonly<{ readonly kind: "success"; readonly issue: null; readonly conflict: GitHubIssue }>
  | Readonly<{ readonly kind: "diagnostic"; readonly diagnostic: GitHubTrackerDiagnostic }>
> {
  try {
    const result = await tracker.updateIssue({
      reference,
      projection,
      idempotencyKey,
    });
    if (result.kind === "not-found") {
      return Object.freeze({ kind: "success", issue: null, conflict: null });
    }
    if (result.kind === "conflict") {
      return isGitHubIssue(result.issue)
        ? Object.freeze({ kind: "success", issue: null, conflict: freezeIssue(result.issue) })
        : invalidResponseDiagnostic();
    }
    if (result.kind === "failure") {
      return failureDiagnostic(result);
    }
    return isGitHubIssue(result.issue)
      ? Object.freeze({ kind: "success", issue: freezeIssue(result.issue), conflict: null })
      : invalidResponseDiagnostic();
  } catch {
    return outcomeUnknownDiagnostic();
  }
}

function recordSynchronization(
  request: PushGitHubIssueProjectionRequest | PullGitHubIssueProjectionRequest,
  issue: GitHubIssue,
  change: TrackerSynchronizationChange,
): GitHubIssueProjectionResult {
  const recorded = recordTrackerSynchronization(request.state, {
    contractVersion: 1,
    taskId: request.state.projection.id,
    expectedVersion: request.state.projection.version,
    change,
    reference: referenceFor(request.state.projection.id, issue, request.event.occurredAt),
    event: request.event,
  });
  return recorded.ok
    ? successFromRecorded(recorded, change)
    : withDiagnostic(request.state, {
        code: "github.local_state_stale",
        message: recorded.diagnostics[0]?.message ?? "The local Task state changed before synchronization could be recorded.",
        remediation: "Reload the local Task, inspect the remote Issue, and retry synchronization with a new Event.",
        recoverable: true,
      });
}

function successFromRecorded(
  recorded: Extract<RecordTrackerSynchronizationResult, { readonly ok: true }>,
  change: TrackerSynchronizationChange,
): GitHubIssueProjectionResult {
  if (change === "external_closed") {
    return Object.freeze({
      disposition: "external-closed",
      state: recorded.state,
      event: recorded.event,
    });
  }
  return Object.freeze({
    disposition: change,
    state: recorded.state,
    event: recorded.event,
  });
}

function conflict(
  state: WorkflowState,
  expectedVersion: string | null,
  observed: GitHubIssue,
  desired: GitHubIssueProjection,
): GitHubIssueProjectionResult {
  return Object.freeze({
    disposition: "sync-conflict",
    state,
    conflict: Object.freeze({
      expectedVersion,
      observed: freezeIssue(observed),
      desired: Object.freeze({ ...desired }),
    }),
  });
}

function withDiagnostic(
  state: WorkflowState,
  diagnostic: GitHubTrackerDiagnostic,
): GitHubIssueProjectionResult {
  return Object.freeze({ disposition: "diagnostic", state, diagnostic });
}

function failureDiagnostic(result: Extract<GitHubIssueReadResult | GitHubIssueMutationResult, { readonly kind: "failure" }>): Readonly<{
  readonly kind: "diagnostic";
  readonly diagnostic: GitHubTrackerDiagnostic;
}> {
  const [code, message, remediation] =
    result.code === "permission-denied"
      ? [
          "github.permission_denied" as const,
          "GitHub denied the tracker operation.",
          "Grant the configured adapter only the required Issue permission, then retry synchronization.",
        ]
      : result.code === "rate-limited"
        ? [
            "github.rate_limited" as const,
            "GitHub rate-limited the tracker operation.",
            "Wait for the reported limit window, then retry the same synchronization Event.",
          ]
        : [
            "github.outcome_unknown" as const,
            "GitHub did not confirm the tracker operation outcome.",
            "Inspect the mapped Issue before retrying; the adapter must reuse the same idempotency key.",
          ];
  return Object.freeze({
    kind: "diagnostic",
    diagnostic: Object.freeze({
      code,
      message,
      remediation,
      recoverable: true,
      ...(result.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: result.retryAfterSeconds }),
    }),
  });
}

function outcomeUnknownDiagnostic(): Readonly<{
  readonly kind: "diagnostic";
  readonly diagnostic: GitHubTrackerDiagnostic;
}> {
  return failureDiagnostic({ kind: "failure", code: "outcome-unknown" });
}

function invalidResponseDiagnostic(): Readonly<{
  readonly kind: "diagnostic";
  readonly diagnostic: GitHubTrackerDiagnostic;
}> {
  return Object.freeze({
    kind: "diagnostic",
    diagnostic: Object.freeze({
      code: "github.invalid_response",
      message: "GitHub returned an Issue without the required safe identity fields.",
      remediation: "Inspect the adapter response and retry only after it returns a credential-free URI and version identifier.",
      recoverable: true,
    }),
  });
}

function issueDeletedDiagnostic(): GitHubTrackerDiagnostic {
  return Object.freeze({
    code: "github.issue_deleted",
    message: "The mapped GitHub Issue no longer exists.",
    remediation: "Inspect the deleted Issue history and explicitly establish a replacement mapping before synchronizing again.",
    recoverable: true,
  });
}


function renderGitHubIssueProjection(state: WorkflowState): GitHubIssueProjection {
  const { projection } = state;
  const lines = [
    `<!-- sayhi-task:${encodeURIComponent(projection.id)} -->`,
    `# ${inline(projection.id)} — ${inline(projection.title)}`,
    "",
    `- Route: \`${projection.route}\``,
    `- Lifecycle: \`${projection.lifecycle}\``,
    `- Phase: \`${projection.phase}\``,
    `- Step: \`${inline(projection.step)}\``,
    `- Version: ${projection.version}`,
    `- Updated: \`${inline(projection.updatedAt)}\``,
  ];
  if (projection.lifecycle === "blocked") {
    lines.push("- Blockers:");
    for (const blocker of projection.blockers) {
      lines.push(`  - ${inline(blocker)}`);
    }
  }
  return Object.freeze({
    title: `${projection.id}: ${inline(projection.title)}`,
    body: lines.join("\n"),
    state:
      projection.lifecycle === "completed" ||
      projection.lifecycle === "archived" ||
      projection.lifecycle === "cancelled"
        ? "closed"
        : "open",
  });
}

function latestGitHubReference(state: WorkflowState): TrackerReference | undefined {
  const id = `github-${state.projection.id}`;
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index]!;
    if (
      event.type === "tracker_synchronized" &&
      event.reference.adapter === "github" &&
      event.reference.id === id
    ) {
      return event.reference;
    }
  }
  return undefined;
}

function referenceFor(taskId: string, issue: GitHubIssue, observedAt: string): TrackerReference {
  return Object.freeze({
    id: `github-${taskId}`,
    adapter: "github",
    uri: issue.uri,
    externalId: issue.externalId,
    observedVersion: issue.version,
    role: "projection",
    identity: issueIdentity(issue),
    lastObservedAt: observedAt,
  });
}

function projectionIdentity(projection: GitHubIssueProjection): ContractIdentity {
  return hashCanonicalJson(projection);
}

function issueIdentity(issue: GitHubIssue): ContractIdentity {
  return projectionIdentity({
    title: issue.title,
    body: issue.body,
    state: issue.state,
  });
}

function isGitHubIssue(value: unknown): value is GitHubIssue {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const issue = value as Record<string, unknown>;
  return (
    isNonEmptyString(issue.externalId) &&
    isCredentialFreeAbsoluteUri(issue.uri) &&
    isNonEmptyString(issue.version) &&
    typeof issue.title === "string" &&
    typeof issue.body === "string" &&
    (issue.state === "open" || issue.state === "closed")
  );
}

function isCredentialFreeAbsoluteUri(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const uri = new URL(value);
    return uri.username.length === 0 && uri.password.length === 0;
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function freezeIssue(issue: GitHubIssue): GitHubIssue {
  return Object.freeze({ ...issue });
}



function inline(value: string): string {
  return value
    .replace(/[\r\n]+/gu, " ")
    .replace(/<!--/gu, "&lt;!--")
    .replace(/-->/gu, "--&gt;")
    .replace(/`/gu, "\\`");
}
