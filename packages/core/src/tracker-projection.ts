import { hashTextContent } from "./context-manifest.js";
import type { ContentHash } from "./validation.js";
import type { WorkflowState } from "./workflow.js";

export const TRACKER_PROJECTION_CONTRACT_VERSION = 1 as const;

export type TrackerProjectionOperation = "lookup" | "create" | "update" | "archive";

type TrackerProjectionMutationOperation = Exclude<TrackerProjectionOperation, "lookup">;
type TrackerProjectionPendingMutationOperation = Exclude<TrackerProjectionMutationOperation, "create">;

export type TrackerProjectionDiagnosticCode =
  | "tracker.adapter-mismatch"
  | "tracker.authentication-failed"
  | "tracker.mapping-unavailable"
  | "tracker.operation-uncertain"
  | "tracker.operation-unsupported"
  | "tracker.resource-missing"
  | "tracker.resource-uri-invalid";

export interface TrackerProjectionPayload {
  readonly key: string;
  readonly taskId: string;
  readonly title: string;
  readonly route: string;
  readonly lifecycle: string;
  readonly phase: string;
  readonly step: string;
  readonly projectionVersion: number;
  readonly updatedAt: string;
  readonly blockers: readonly string[];
  readonly archived: boolean;
  readonly authorityIdentity: ContentHash;
}

export interface TrackerProjectionRemoteResource {
  readonly externalId: string;
  readonly uri: string;
  readonly version: string;
  readonly authorityIdentity: ContentHash;
  readonly archived: boolean;
}

export interface TrackerProjectionMutation {
  readonly resource: TrackerProjectionRemoteResource;
  readonly expectedVersion: string;
  readonly payload: TrackerProjectionPayload;
}

export interface TrackerProjectionPendingMutation {
  readonly authorityIdentity: ContentHash;
  readonly operation: TrackerProjectionPendingMutationOperation;
}

export type TrackerProjectionAdapterOutcome =
  | Readonly<{ readonly kind: "resource"; readonly resource: TrackerProjectionRemoteResource }>
  | Readonly<{ readonly kind: "missing" }>
  | Readonly<{
      readonly kind: "conflict";
      readonly observedVersion: string | null;
      readonly observedAuthorityIdentity: ContentHash | null;
    }>
  | Readonly<{ readonly kind: "unsupported"; readonly operation: TrackerProjectionOperation }>
  | Readonly<{ readonly kind: "authentication-failed" }>
  | Readonly<{ readonly kind: "uncertain"; readonly operation: TrackerProjectionOperation }>;

export interface TrackerProjectionAdapter {
  readonly adapterId: string;
  readonly capabilities: Readonly<Record<TrackerProjectionMutationOperation, boolean>>;
  lookupProjection(key: string): Promise<TrackerProjectionAdapterOutcome>;
  createProjection(payload: TrackerProjectionPayload): Promise<TrackerProjectionAdapterOutcome>;
  updateProjection(mutation: TrackerProjectionMutation): Promise<TrackerProjectionAdapterOutcome>;
  archiveProjection(mutation: TrackerProjectionMutation): Promise<TrackerProjectionAdapterOutcome>;
}

export interface TrackerProjectionMapping {
  readonly schemaVersion: typeof TRACKER_PROJECTION_CONTRACT_VERSION;
  readonly taskId: string;
  readonly adapterId: string;
  readonly externalId: string;
  readonly uri: string;
  readonly observedVersion: string;
  readonly authorityIdentity: ContentHash;
  readonly pendingMutation: TrackerProjectionPendingMutation | null;
}

export interface TrackerProjectionStore {
  readTrackerProjection(taskId: string): Promise<TrackerProjectionMapping | null>;
  writeTrackerProjection(mapping: TrackerProjectionMapping): Promise<void>;
}

export interface TrackerProjectionConflict {
  readonly taskId: string;
  readonly adapterId: string;
  readonly expectedVersion: string | null;
  readonly observedVersion: string | null;
  readonly expectedAuthorityIdentity: ContentHash | null;
  readonly observedAuthorityIdentity: ContentHash | null;
  readonly incomingAuthorityIdentity: ContentHash;
}

export interface TrackerProjectionDiagnostic {
  readonly code: TrackerProjectionDiagnosticCode;
  readonly adapterId: string;
  readonly operation: TrackerProjectionOperation;
  readonly remediation: string;
}

export interface ProjectTrackerProjectionRequest {
  readonly store: TrackerProjectionStore;
  readonly adapter: TrackerProjectionAdapter;
  readonly state: WorkflowState;
}

export type ProjectTrackerProjectionResult =
  | Readonly<{
      readonly disposition: "created" | "updated" | "unchanged" | "archived";
      readonly mapping: TrackerProjectionMapping;
    }>
  | Readonly<{
      readonly disposition: "reconciliation-required";
      readonly conflict: TrackerProjectionConflict;
    }>
  | Readonly<{
      readonly disposition: "recovery-required";
      readonly diagnostic: TrackerProjectionDiagnostic;
    }>;

export async function projectTrackerProjection(
  request: ProjectTrackerProjectionRequest,
): Promise<ProjectTrackerProjectionResult> {
  const payload = payloadFor(request.state);
  const mapping = await readMapping(request.store, payload.taskId, request.adapter.adapterId);
  if (isProjectionResult(mapping)) {
    return mapping;
  }
  if (mapping !== null && mapping.adapterId !== request.adapter.adapterId) {
    return recoveryRequired(
      request.adapter.adapterId,
      "lookup",
      "tracker.adapter-mismatch",
      "Select the adapter that owns the mapped external Tracker resource, then retry.",
    );
  }

  const lookup = await callAdapter(
    request.adapter,
    "lookup",
    () => request.adapter.lookupProjection(payload.key),
  );
  if (isProjectionResult(lookup)) {
    return lookup;
  }
  if (mapping === null) {
    return projectUnmappedTask(request, payload, lookup);
  }
  if (lookup.kind === "missing") {
    return recoveryRequired(
      request.adapter.adapterId,
      "lookup",
      "tracker.resource-missing",
      "Inspect the mapped external Tracker resource and reconcile its mapping before retrying.",
    );
  }
  if (lookup.kind !== "resource") {
    return outcomeResult(request.adapter.adapterId, "lookup", lookup, mapping, payload);
  }
  const operation = payload.archived ? "archive" : "update";
  const pendingMutation = mapping.pendingMutation ?? null;
  const resourceMatchesMapping = sameHash(
    lookup.resource.authorityIdentity,
    mapping.authorityIdentity,
  );
  const resourceMatchesPayload = sameHash(
    lookup.resource.authorityIdentity,
    payload.authorityIdentity,
  );
  if (resourceMatchesPayload) {
    if (
      (pendingMutation === null && resourceMatchesMapping) ||
      pendingMutationMatches(pendingMutation, payload, operation)
    ) {
      const observed = await persistResourceMapping(
        request.store,
        request.adapter.adapterId,
        payload.taskId,
        lookup.resource,
        "lookup",
      );
      if (isProjectionResult(observed)) {
        return observed;
      }
      return Object.freeze({ disposition: "unchanged", mapping: observed });
    }
    return reconciliationRequired(mapping, lookup.resource.version, lookup.resource.authorityIdentity, payload);
  }
  if (
    !resourceMatchesMapping ||
    (pendingMutation !== null && !pendingMutationMatches(pendingMutation, payload, operation))
  ) {
    return reconciliationRequired(mapping, lookup.resource.version, lookup.resource.authorityIdentity, payload);
  }
  if (!request.adapter.capabilities[operation]) {
    return recoveryRequired(
      request.adapter.adapterId,
      operation,
      "tracker.operation-unsupported",
      `Configure an adapter that supports ${operation} before retrying.`,
    );
  }
  if (pendingMutation === null) {
    const pending = await persistMapping(
      request.store,
      mappingWithPendingMutation(mapping, payload, operation),
      request.adapter.adapterId,
      operation,
    );
    if (pending !== undefined) {
      return pending;
    }
  }
  const mutation: TrackerProjectionMutation = Object.freeze({
    resource: lookup.resource,
    expectedVersion: lookup.resource.version,
    payload,
  });
  const outcome = await callAdapter(
    request.adapter,
    operation,
    () =>
      operation === "archive"
        ? request.adapter.archiveProjection(mutation)
        : request.adapter.updateProjection(mutation),
  );
  if (isProjectionResult(outcome)) {
    return outcome;
  }
  if (outcome.kind !== "resource") {
    if (outcome.kind !== "uncertain") {
      const cleared = await persistMapping(
        request.store,
        mappingWithoutPendingMutation(mapping),
        request.adapter.adapterId,
        operation,
      );
      if (cleared !== undefined) {
        return cleared;
      }
    }
    return outcomeResult(request.adapter.adapterId, operation, outcome, mapping, payload);
  }
  if (!sameHash(outcome.resource.authorityIdentity, payload.authorityIdentity)) {
    return reconciliationRequired(mapping, outcome.resource.version, outcome.resource.authorityIdentity, payload);
  }
  const updated = await persistResourceMapping(
    request.store,
    request.adapter.adapterId,
    payload.taskId,
    outcome.resource,
    operation,
  );
  if (isProjectionResult(updated)) {
    return updated;
  }
  return Object.freeze({
    disposition: operation === "archive" ? "archived" : "updated",
    mapping: updated,
  });
}

async function projectUnmappedTask(
  request: ProjectTrackerProjectionRequest,
  payload: TrackerProjectionPayload,
  lookup: TrackerProjectionAdapterOutcome,
): Promise<ProjectTrackerProjectionResult> {
  if (lookup.kind === "resource") {
    if (!sameHash(lookup.resource.authorityIdentity, payload.authorityIdentity)) {
      return reconciliationRequired(null, lookup.resource.version, lookup.resource.authorityIdentity, payload, request.adapter.adapterId);
    }
    const adopted = await persistResourceMapping(
      request.store,
      request.adapter.adapterId,
      payload.taskId,
      lookup.resource,
      "lookup",
    );
    if (isProjectionResult(adopted)) {
      return adopted;
    }
    return Object.freeze({ disposition: "unchanged", mapping: adopted });
  }
  if (lookup.kind !== "missing") {
    return outcomeResult(request.adapter.adapterId, "lookup", lookup, null, payload);
  }
  if (!request.adapter.capabilities.create) {
    return recoveryRequired(
      request.adapter.adapterId,
      "create",
      "tracker.operation-unsupported",
      "Configure an adapter that supports create before retrying.",
    );
  }
  const created = await callAdapter(
    request.adapter,
    "create",
    () => request.adapter.createProjection(payload),
  );
  if (isProjectionResult(created)) {
    return created;
  }
  if (created.kind !== "resource") {
    return outcomeResult(request.adapter.adapterId, "create", created, null, payload);
  }
  if (!sameHash(created.resource.authorityIdentity, payload.authorityIdentity)) {
    return reconciliationRequired(null, created.resource.version, created.resource.authorityIdentity, payload, request.adapter.adapterId);
  }
  const mapping = await persistResourceMapping(
    request.store,
    request.adapter.adapterId,
    payload.taskId,
    created.resource,
    "create",
  );
  if (isProjectionResult(mapping)) {
    return mapping;
  }
  return Object.freeze({ disposition: "created", mapping });
}

function payloadFor(state: WorkflowState): TrackerProjectionPayload {
  const { projection } = state;
  const source = Object.freeze({
    taskId: projection.id,
    title: projection.title,
    route: projection.route,
    lifecycle: projection.lifecycle,
    phase: projection.phase,
    step: projection.step,
    projectionVersion: projection.version,
    updatedAt: projection.updatedAt,
    blockers: [...projection.blockers],
    archived: projection.lifecycle === "archived",
  });
  return Object.freeze({
    key: `sayhi-task:${encodeURIComponent(projection.id)}`,
    ...source,
    blockers: Object.freeze(source.blockers),
    authorityIdentity: hashTextContent(JSON.stringify(source)),
  });
}

function mappingFor(
  adapterId: string,
  taskId: string,
  resource: TrackerProjectionRemoteResource,
): TrackerProjectionMapping {
  return Object.freeze({
    schemaVersion: TRACKER_PROJECTION_CONTRACT_VERSION,
    taskId,
    adapterId,
    externalId: resource.externalId,
    uri: resource.uri,
    observedVersion: resource.version,
    authorityIdentity: freezeHash(resource.authorityIdentity),
    pendingMutation: null,
  });
}

async function readMapping(
  store: TrackerProjectionStore,
  taskId: string,
  adapterId: string,
): Promise<TrackerProjectionMapping | null | ProjectTrackerProjectionResult> {
  try {
    return await store.readTrackerProjection(taskId);
  } catch {
    return recoveryRequired(
      adapterId,
      "lookup",
      "tracker.mapping-unavailable",
      "Restore adapter-side mapping storage, then retry using the stable Task key.",
    );
  }
}

async function persistMapping(
  store: TrackerProjectionStore,
  mapping: TrackerProjectionMapping,
  adapterId: string,
  operation: TrackerProjectionOperation,
): Promise<undefined | ProjectTrackerProjectionResult> {
  try {
    await store.writeTrackerProjection(mapping);
    return undefined;
  } catch {
    return recoveryRequired(
      adapterId,
      operation,
      "tracker.mapping-unavailable",
      "Restore adapter-side mapping storage, then retry using the stable Task key.",
    );
  }
}

async function persistResourceMapping(
  store: TrackerProjectionStore,
  adapterId: string,
  taskId: string,
  resource: TrackerProjectionRemoteResource,
  operation: TrackerProjectionOperation,
): Promise<TrackerProjectionMapping | ProjectTrackerProjectionResult> {
  if (!isCredentialFreeUri(resource.uri)) {
    return recoveryRequired(
      adapterId,
      operation,
      "tracker.resource-uri-invalid",
      "Configure the adapter to return an absolute URI without embedded credentials.",
    );
  }
  const mapping = mappingFor(adapterId, taskId, resource);
  const failure = await persistMapping(store, mapping, adapterId, operation);
  return failure ?? mapping;
}

function mappingWithPendingMutation(
  mapping: TrackerProjectionMapping,
  payload: TrackerProjectionPayload,
  operation: TrackerProjectionPendingMutationOperation,
): TrackerProjectionMapping {
  return Object.freeze({
    ...mapping,
    authorityIdentity: freezeHash(mapping.authorityIdentity),
    pendingMutation: Object.freeze({
      authorityIdentity: freezeHash(payload.authorityIdentity),
      operation,
    }),
  });
}

function mappingWithoutPendingMutation(mapping: TrackerProjectionMapping): TrackerProjectionMapping {
  return Object.freeze({
    ...mapping,
    authorityIdentity: freezeHash(mapping.authorityIdentity),
    pendingMutation: null,
  });
}

function pendingMutationMatches(
  pendingMutation: TrackerProjectionPendingMutation | null,
  payload: TrackerProjectionPayload,
  operation: TrackerProjectionPendingMutationOperation,
): boolean {
  return (
    pendingMutation !== null &&
    pendingMutation.operation === operation &&
    sameHash(pendingMutation.authorityIdentity, payload.authorityIdentity)
  );
}

function isCredentialFreeUri(value: string): boolean {
  try {
    const uri = new URL(value);
    return uri.username.length === 0 && uri.password.length === 0;
  } catch {
    return false;
  }
}

async function callAdapter(
  adapter: TrackerProjectionAdapter,
  operation: TrackerProjectionOperation,
  invoke: () => Promise<TrackerProjectionAdapterOutcome>,
): Promise<TrackerProjectionAdapterOutcome | ProjectTrackerProjectionResult> {
  try {
    return await invoke();
  } catch {
    return recoveryRequired(
      adapter.adapterId,
      operation,
      "tracker.operation-uncertain",
      "Inspect the external Tracker by stable Task key before retrying.",
    );
  }
}

function outcomeResult(
  adapterId: string,
  operation: TrackerProjectionOperation,
  outcome: TrackerProjectionAdapterOutcome,
  mapping: TrackerProjectionMapping | null,
  payload: TrackerProjectionPayload,
): ProjectTrackerProjectionResult {
  if (outcome.kind === "conflict") {
    return reconciliationRequired(
      mapping,
      outcome.observedVersion,
      outcome.observedAuthorityIdentity,
      payload,
      adapterId,
    );
  }
  if (outcome.kind === "authentication-failed") {
    return recoveryRequired(
      adapterId,
      operation,
      "tracker.authentication-failed",
      "Refresh external Tracker credentials outside the Project Store, then retry.",
    );
  }
  if (outcome.kind === "unsupported") {
    return recoveryRequired(
      adapterId,
      outcome.operation,
      "tracker.operation-unsupported",
      `Configure an adapter that supports ${outcome.operation} before retrying.`,
    );
  }
  return recoveryRequired(
    adapterId,
    outcome.kind === "uncertain" ? outcome.operation : operation,
    "tracker.operation-uncertain",
    "Inspect the external Tracker by stable Task key before retrying.",
  );
}

function reconciliationRequired(
  mapping: TrackerProjectionMapping | null,
  observedVersion: string | null,
  observedAuthorityIdentity: ContentHash | null,
  payload: TrackerProjectionPayload,
  adapterId = mapping?.adapterId ?? "",
): ProjectTrackerProjectionResult {
  return Object.freeze({
    disposition: "reconciliation-required",
    conflict: Object.freeze({
      taskId: payload.taskId,
      adapterId,
      expectedVersion: mapping?.observedVersion ?? null,
      observedVersion,
      expectedAuthorityIdentity:
        mapping === null ? null : freezeHash(mapping.authorityIdentity),
      observedAuthorityIdentity:
        observedAuthorityIdentity === null ? null : freezeHash(observedAuthorityIdentity),
      incomingAuthorityIdentity: freezeHash(payload.authorityIdentity),
    }),
  });
}

function recoveryRequired(
  adapterId: string,
  operation: TrackerProjectionOperation,
  code: TrackerProjectionDiagnosticCode,
  remediation: string,
): ProjectTrackerProjectionResult {
  return Object.freeze({
    disposition: "recovery-required",
    diagnostic: Object.freeze({ code, adapterId, operation, remediation }),
  });
}

function isProjectionResult(value: unknown): value is ProjectTrackerProjectionResult {
  return typeof value === "object" && value !== null && "disposition" in value;
}

function sameHash(left: ContentHash, right: ContentHash): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function freezeHash(value: ContentHash): ContentHash {
  return Object.freeze({ algorithm: value.algorithm, digest: value.digest });
}
