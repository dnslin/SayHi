import { hashCanonicalJson, stableJson, type ContractIdentity } from "./identity.js";
import {
  recordTrackerSynchronization,
  replayWorkflowEvents,
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
export type GitHubIssueConflictResolution = "use-local" | "keep-observed";

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
export interface GetGitHubIssueProjectionStatusRequest {
  readonly state: WorkflowState;
  readonly tracker: GitHubTrackerPort;
}

export interface ResolveGitHubIssueProjectionConflictRequest {
  readonly state: WorkflowState;
  readonly tracker: GitHubTrackerPort;
  readonly conflict: GitHubIssueSyncConflict;
  readonly resolution: GitHubIssueConflictResolution;
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
  | "github.local_state_stale"
  | "github.resolution_not_authorized";

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
  | Readonly<{
      readonly disposition: "resolved-local" | "resolved-remote";
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
export type GitHubIssueProjectionStatusResult =
  | Readonly<{
      readonly disposition: "current" | "remote-version-changed" | "external-closed";
      readonly state: WorkflowState;
      readonly reference: TrackerReference;
      readonly issue: GitHubIssue;
    }>
  | Readonly<{ readonly disposition: "not-mapped"; readonly state: WorkflowState }>
  | Readonly<{ readonly disposition: "deleted"; readonly state: WorkflowState }>
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
  const repeated = repeatedSynchronization(request.state, request.event, [
    "created",
    "updated",
    "observed",
  ]);
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

export async function getGitHubIssueProjectionStatus(
  request: GetGitHubIssueProjectionStatusRequest,
): Promise<GitHubIssueProjectionStatusResult> {
  const reference = latestGitHubReference(request.state);
  if (reference === undefined) {
    return Object.freeze({ disposition: "not-mapped", state: request.state });
  }
  const read = await readIssue(request.tracker, reference);
  if (read.kind === "diagnostic") {
    return Object.freeze({
      disposition: "diagnostic",
      state: request.state,
      diagnostic: read.diagnostic,
    });
  }
  if (read.issue === null) {
    return Object.freeze({ disposition: "deleted", state: request.state });
  }
  const identity = issueIdentity(read.issue);
  if (read.issue.state === "closed") {
    return Object.freeze({
      disposition:
        identity === reference.identity && read.issue.version === reference.observedVersion
          ? "current"
          : "external-closed",
      state: request.state,
      reference,
      issue: read.issue,
    });
  }
  if (identity !== reference.identity) {
    return Object.freeze({
      disposition: "sync-conflict",
      state: request.state,
      conflict: Object.freeze({
        expectedVersion: reference.observedVersion,
        observed: read.issue,
        desired: renderGitHubIssueProjection(request.state),
      }),
    });
  }
  return Object.freeze({
    disposition:
      read.issue.version === reference.observedVersion
        ? "current"
        : "remote-version-changed",
    state: request.state,
    reference,
    issue: read.issue,
  });
}
export async function pullGitHubIssueProjection(
  request: PullGitHubIssueProjectionRequest,
): Promise<GitHubIssueProjectionResult> {
  const repeated = repeatedSynchronization(request.state, request.event, [
    "observed",
    "external_closed",
  ]);
  if (repeated !== null) {
    return repeated;
  }

  const status = await getGitHubIssueProjectionStatus(request);
  if (status.disposition === "not-mapped") {
    return withDiagnostic(request.state, {
      code: "github.not_mapped",
      message: "The local Task has no mapped GitHub Issue to pull.",
      remediation: "Push the Task projection first or explicitly establish its GitHub Issue mapping.",
      recoverable: true,
    });
  }
  if (status.disposition === "deleted") {
    return withDiagnostic(request.state, issueDeletedDiagnostic());
  }
  if (status.disposition === "diagnostic") {
    return withDiagnostic(request.state, status.diagnostic);
  }
  if (status.disposition === "sync-conflict") {
    return Object.freeze({
      disposition: "sync-conflict",
      state: request.state,
      conflict: status.conflict,
    });
  }
  if (status.disposition === "current") {
    return Object.freeze({ disposition: "unchanged", state: request.state });
  }
  return recordSynchronization(
    request,
    status.issue,
    status.disposition === "external-closed" ? "external_closed" : "observed",
  );
}
export async function resolveGitHubIssueProjectionConflict(
  request: ResolveGitHubIssueProjectionConflictRequest,
): Promise<GitHubIssueProjectionResult> {
  const repeated = repeatedSynchronization(request.state, request.event, [
    request.resolution === "use-local" ? "resolved_local" : "resolved_remote",
  ]);
  if (repeated !== null) {
    return repeated;
  }
  if (request.event.actor.kind !== "user") {
    return withDiagnostic(request.state, {
      code: "github.resolution_not_authorized",
      message: "GitHub synchronization conflict resolution requires an attributable user decision.",
      remediation: "Resubmit the selected resolution with user Event metadata.",
      recoverable: true,
    });
  }
  const reference = latestGitHubReference(request.state);
  const desired = renderGitHubIssueProjection(request.state);
  if (
    reference === undefined ||
    request.conflict.expectedVersion !== reference.observedVersion ||
    projectionIdentity(request.conflict.desired) !== projectionIdentity(desired) ||
    !isGitHubIssue(request.conflict.observed) ||
    request.conflict.observed.externalId !== reference.externalId
  ) {
    return withDiagnostic(request.state, {
      code: "github.local_state_stale",
      message: "The supplied GitHub conflict no longer matches the mapped local Task state.",
      remediation: "Reload GitHub Issue status and resolve the current conflict with a new user Event.",
      recoverable: true,
    });
  }
  const current = await readIssue(request.tracker, reference);
  if (current.kind === "diagnostic") {
    return withDiagnostic(request.state, current.diagnostic);
  }
  if (current.issue === null) {
    return withDiagnostic(request.state, issueDeletedDiagnostic());
  }
  if (
    current.issue.version !== request.conflict.observed.version ||
    issueIdentity(current.issue) !== issueIdentity(request.conflict.observed)
  ) {
    return conflict(
      request.state,
      reference.observedVersion,
      current.issue,
      desired,
    );
  }
  if (request.resolution === "keep-observed") {
    return recordSynchronization(request, current.issue, "resolved_remote");
  }
  const updated = await updateIssue(
    request.tracker,
    Object.freeze({
      ...reference,
      observedVersion: current.issue.version,
      identity: issueIdentity(current.issue),
    }),
    desired,
    request.event.idempotencyKey,
  );
  if (updated.kind === "diagnostic") {
    return withDiagnostic(request.state, updated.diagnostic);
  }
  if (updated.conflict !== null) {
    return conflict(request.state, current.issue.version, updated.conflict, desired);
  }
  if (updated.issue === null) {
    return withDiagnostic(request.state, issueDeletedDiagnostic());
  }
  if (issueIdentity(updated.issue) !== projectionIdentity(desired)) {
    return conflict(request.state, current.issue.version, updated.issue, desired);
  }
  return recordSynchronization(request, updated.issue, "resolved_local");
}

function repeatedSynchronization(
  state: WorkflowState,
  event: WorkflowEventMetadata,
  acceptedChanges: readonly TrackerSynchronizationChange[],
): GitHubIssueProjectionResult | null {
  const repeatedIndex = state.events.findIndex(
    (candidate) => candidate.idempotencyKey === event.idempotencyKey,
  );
  if (repeatedIndex === -1) {
    return null;
  }
  const repeated = state.events[repeatedIndex]!;
  const replayed = replayWorkflowEvents(state.events);
  if (
    repeatedIndex === state.events.length - 1 &&
    repeated.type === "tracker_synchronized" &&
    repeated.reference.adapter === "github" &&
    acceptedChanges.includes(repeated.change) &&
    repeated.reason === event.reason &&
    repeated.actor.kind === event.actor.kind &&
    repeated.actor.id === event.actor.id &&
    repeated.actor.sessionRef === event.actor.sessionRef &&
    replayed.ok &&
    stableJson(replayed.state.projection) === stableJson(state.projection)
  ) {
    return Object.freeze({ disposition: "unchanged", state });
  }
  return withDiagnostic(state, {
    code: "github.idempotency_conflict",
    message: "The synchronization idempotency key is already bound to different or stale Tracker synchronization material.",
    remediation: "Reload the local Task and retry the original operation with its matching Event, or allocate a new idempotency key.",
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
  request:
    | PushGitHubIssueProjectionRequest
    | PullGitHubIssueProjectionRequest
    | ResolveGitHubIssueProjectionConflictRequest,
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
  if (change === "resolved_local" || change === "resolved_remote") {
    return Object.freeze({
      disposition: change === "resolved_local" ? "resolved-local" : "resolved-remote",
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
    return (
      (uri.protocol === "http:" || uri.protocol === "https:") &&
      uri.username.length === 0 &&
      uri.password.length === 0 &&
      uri.search.length === 0 &&
      uri.hash.length === 0
    );
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
