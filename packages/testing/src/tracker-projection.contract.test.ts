import assert from "node:assert/strict";
import test from "node:test";

import {
  coreContract,
  readGateEvidenceKinds,
  type ContentHash,
  type StartWorkflowTaskRequest,
  type TrackerProjectionAdapter,
  type TrackerProjectionAdapterOutcome,
  type TrackerProjectionMapping,
  type TrackerProjectionMutation,
  type TrackerProjectionPayload,
  type TrackerProjectionRemoteResource,
  type TrackerProjectionStore,
  type WorkflowLifecycle,
  type WorkflowPhase,
  type WorkflowState,
} from "@dnslin/sayhi-core";

const TRACKER_ADAPTER_IDS = ["gitlab", "custom:team-tracker"] as const;

const TRACKER_TASK: StartWorkflowTaskRequest = {
  contractVersion: 1,
  task: {
    id: "TASK-TRACKER-33",
    title: "Synchronize GitLab and custom Tracker projections safely",
    route: "quick",
    parentTaskId: null,
    initiativeGraphId: null,
    intent: {
      goals: ["Project locally authoritative Task state."],
      nonGoals: ["Import remote Tracker state."],
      acceptanceCriteria: ["Remote Tracker state is a recoverable projection."],
    },
    scope: { files: [], apis: [], schemas: [], locks: [] },
    baselineRef: "baseline.json",
    contexts: {},
    policies: { commit: "never", push: "never", maxRepairAttempts: 2 },
  },
  routeGate: {
    gate: "route",
    evidence: [{ kind: "human-approval", reference: "evidence/route.json" }],
  },
  event: {
    eventId: "EVENT-TRACKER-33-CREATE",
    actor: { kind: "orchestrator", id: "sayhi-test", sessionRef: "session-33" },
    reason: "Create Tracker projection Task.",
    idempotencyKey: "IDEMPOTENCY-TRACKER-33-CREATE",
    occurredAt: "2026-07-19T14:00:00Z",
  },
};

class MemoryTrackerProjectionStore implements TrackerProjectionStore {
  mapping: TrackerProjectionMapping | null = null;
  writes = 0;

  async readTrackerProjection(taskId: string): Promise<TrackerProjectionMapping | null> {
    assert.equal(taskId, TRACKER_TASK.task.id);
    return this.mapping;
  }

  async writeTrackerProjection(mapping: TrackerProjectionMapping): Promise<void> {
    this.mapping = mapping;
    this.writes += 1;
  }
}

class MemoryTrackerProjectionAdapter implements TrackerProjectionAdapter {
  readonly adapterId: string;
  readonly records = new Map<string, TrackerProjectionRemoteResource>();
  createCalls = 0;
  updateCalls = 0;
  archiveCalls = 0;
  createIsUncertain = false;
  updateIsUncertain = false;
  archiveIsUncertain = false;
  authenticationFailure = false;
  conflictOnNextUpdate = false;
  archiveSupported = true;
  resourceUri: string | null = null;

  constructor(adapterId: string) {
    this.adapterId = adapterId;
  }

  get capabilities(): TrackerProjectionAdapter["capabilities"] {
    return { create: true, update: true, archive: this.archiveSupported };
  }

  async lookupProjection(key: string): Promise<TrackerProjectionAdapterOutcome> {
    if (this.authenticationFailure) {
      return { kind: "authentication-failed" };
    }
    return this.records.get(key) === undefined
      ? { kind: "missing" }
      : { kind: "resource", resource: this.records.get(key)! };
  }

  async createProjection(payload: TrackerProjectionPayload): Promise<TrackerProjectionAdapterOutcome> {
    this.createCalls += 1;
    if (this.authenticationFailure) {
      return { kind: "authentication-failed" };
    }
    const resource = this.resourceFor(payload, "1");
    this.records.set(payload.key, resource);
    return this.createIsUncertain
      ? { kind: "uncertain", operation: "create" }
      : { kind: "resource", resource };
  }

  async updateProjection(
    mutation: TrackerProjectionMutation,
  ): Promise<TrackerProjectionAdapterOutcome> {
    const { resource, expectedVersion, payload } = mutation;
    this.updateCalls += 1;
    if (this.authenticationFailure) {
      return { kind: "authentication-failed" };
    }
    if (this.conflictOnNextUpdate) {
      this.conflictOnNextUpdate = false;
      const authorityIdentity = changedIdentity();
      const conflict = {
        ...resource,
        version: "concurrent-update",
        authorityIdentity,
        projection: { ...resource.projection, authorityIdentity },
      };
      this.records.set(payload.key, conflict);
      return { kind: "conflict", resource: conflict };
    }
    if (resource.version !== expectedVersion) {
      return { kind: "conflict", resource };
    }
    const updated = this.resourceFor(payload, String(Number(resource.version) + 1));
    this.records.set(payload.key, updated);
    return this.updateIsUncertain
      ? { kind: "uncertain", operation: "update" }
      : { kind: "resource", resource: updated };
  }

  async archiveProjection(
    mutation: TrackerProjectionMutation,
  ): Promise<TrackerProjectionAdapterOutcome> {
    const { resource, expectedVersion, payload } = mutation;
    this.archiveCalls += 1;
    if (!this.archiveSupported) {
      return { kind: "unsupported", operation: "archive" };
    }
    if (resource.version !== expectedVersion) {
      return { kind: "conflict", resource };
    }
    const archived = {
      ...this.resourceFor(payload, String(Number(resource.version) + 1)),
      archived: true,
    };
    this.records.set(payload.key, archived);
    return this.archiveIsUncertain
      ? { kind: "uncertain", operation: "archive" }
      : { kind: "resource", resource: archived };
  }

  editRemotely(key: string): void {
    const resource = this.records.get(key);
    assert.notEqual(resource, undefined);
    const authorityIdentity = changedIdentity();
    this.records.set(key, {
      ...resource!,
      version: "remote-edit",
      authorityIdentity,
      projection: { ...resource!.projection, phase: "review", authorityIdentity },
    });
  }

  private resourceFor(payload: TrackerProjectionPayload, version: string): TrackerProjectionRemoteResource {
    return {
      externalId: `remote-${payload.taskId}`,
      uri: this.resourceUri ?? `https://tracker.example.test/${payload.taskId}`,
      version,
      authorityIdentity: payload.authorityIdentity,
      archived: payload.archived,
      projection: payload,
    };
  }
}

function changedIdentity(): ContentHash {
  return { algorithm: "sha256-lf-v1", digest: "a remote change" };
}

function startTrackerTask(): WorkflowState {
  const started = coreContract.startWorkflowTask(TRACKER_TASK);
  assert.equal(started.ok, true);
  if (!started.ok) {
    throw new Error("Expected Tracker test Task to start.");
  }
  return started.state;
}

function advanceTrackerTask(
  state: WorkflowState,
  lifecycle: WorkflowLifecycle,
  phase: WorkflowPhase,
  suffix: string,
): WorkflowState {
  const transition = coreContract
    .readRouteDefinition(state.projection.route)
    .transitions.find(
      (candidate) =>
        candidate.from.lifecycle === state.projection.lifecycle &&
        candidate.from.phase === state.projection.phase &&
        candidate.to.lifecycle === lifecycle &&
        candidate.to.phase === phase,
    );
  assert.notEqual(transition, undefined);
  if (transition === undefined) {
    throw new Error("Expected Tracker test transition.");
  }
  const advanced = coreContract.transitionWorkflow(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    to: transition.to,
    gates: transition.requiredGates.map((gate) => ({
      gate,
      evidence: [{ kind: readGateEvidenceKinds(gate)[0]!, reference: `evidence/${suffix}-${gate}.json` }],
    })),
    event: {
      ...TRACKER_TASK.event,
      eventId: `EVENT-TRACKER-33-${suffix}`,
      idempotencyKey: `IDEMPOTENCY-TRACKER-33-${suffix}`,
      occurredAt: "2026-07-19T14:01:00Z",
    },
  });
  assert.equal(advanced.ok, true);
  if (!advanced.ok) {
    throw new Error("Expected Tracker test transition to succeed.");
  }
  return advanced.state;
}

function archiveTrackerTask(state: WorkflowState): WorkflowState {
  let archived = state;
  for (const [lifecycle, phase, suffix] of [
    ["active", "review", "ARCHIVE-REVIEW"],
    ["active", "finish", "ARCHIVE-FINISH"],
    ["completed", "finish", "ARCHIVE-COMPLETE"],
    ["archived", "finish", "ARCHIVE"],
  ] as const) {
    archived = advanceTrackerTask(archived, lifecycle, phase, suffix);
  }
  return archived;
}

for (const adapterId of TRACKER_ADAPTER_IDS) {
  test(`${adapterId} projection creates, updates, retries, and archives without changing local Task authority`, async () => {
    const store = new MemoryTrackerProjectionStore();
    const adapter = new MemoryTrackerProjectionAdapter(adapterId);
    const createdState = startTrackerTask();

    const created = await coreContract.projectTrackerProjection({ store, adapter, state: createdState });
    assert.equal(created.disposition, "created");
    assert.equal(adapter.createCalls, 1);
    assert.equal(store.mapping?.adapterId, adapterId);

    const retried = await coreContract.projectTrackerProjection({ store, adapter, state: createdState });
    assert.equal(retried.disposition, "unchanged");
    assert.equal(adapter.createCalls, 1);
    assert.equal(adapter.updateCalls, 0);

    const updatedState = advanceTrackerTask(createdState, "active", "implement", "UPDATE");
    const updated = await coreContract.projectTrackerProjection({ store, adapter, state: updatedState });
    assert.equal(updated.disposition, "updated");
    assert.equal(adapter.updateCalls, 1);
    assert.equal(updatedState.projection.phase, "implement");

    const archivedState = archiveTrackerTask(updatedState);
    const archived = await coreContract.projectTrackerProjection({ store, adapter, state: archivedState });
    assert.equal(archived.disposition, "archived");
    assert.equal(adapter.archiveCalls, 1);
    assert.equal(adapter.records.get("sayhi-task:TASK-TRACKER-33")?.archived, true);
    assert.equal(archivedState.projection.lifecycle, "archived");
  });
}

test("custom Tracker retry adopts a resource created before an uncertain response", async () => {
  const store = new MemoryTrackerProjectionStore();
  const adapter = new MemoryTrackerProjectionAdapter("custom:team-tracker");
  adapter.createIsUncertain = true;
  const state = startTrackerTask();

  const uncertain = await coreContract.projectTrackerProjection({ store, adapter, state });
  assert.equal(uncertain.disposition, "recovery-required");
  if (uncertain.disposition !== "recovery-required") {
    return;
  }
  assert.equal(uncertain.diagnostic.code, "tracker.operation-uncertain");
  assert.equal(store.mapping, null);

  const retried = await coreContract.projectTrackerProjection({ store, adapter, state });
  assert.equal(retried.disposition, "unchanged");
  if (retried.disposition !== "unchanged") {
    return;
  }
  assert.equal(adapter.createCalls, 1);
  assert.equal(retried.mapping.adapterId, "custom:team-tracker");
});

test("Tracker projection retries uncertain updates and archives without duplicate writes", async () => {
  const store = new MemoryTrackerProjectionStore();
  const adapter = new MemoryTrackerProjectionAdapter("gitlab");
  const createdState = startTrackerTask();
  await coreContract.projectTrackerProjection({ store, adapter, state: createdState });
  const updatedState = advanceTrackerTask(createdState, "active", "implement", "UNCERTAIN-UPDATE");

  adapter.updateIsUncertain = true;
  const uncertainUpdate = await coreContract.projectTrackerProjection({ store, adapter, state: updatedState });
  assert.equal(uncertainUpdate.disposition, "recovery-required");
  assert.equal(adapter.updateCalls, 1);

  const retriedUpdate = await coreContract.projectTrackerProjection({ store, adapter, state: updatedState });
  assert.equal(retriedUpdate.disposition, "unchanged");
  assert.equal(adapter.updateCalls, 1);

  const archivedState = archiveTrackerTask(updatedState);
  adapter.archiveIsUncertain = true;
  const uncertainArchive = await coreContract.projectTrackerProjection({ store, adapter, state: archivedState });
  assert.equal(uncertainArchive.disposition, "recovery-required");
  assert.equal(adapter.archiveCalls, 1);

  const retriedArchive = await coreContract.projectTrackerProjection({ store, adapter, state: archivedState });
  assert.equal(retriedArchive.disposition, "unchanged");
  assert.equal(adapter.archiveCalls, 1);
});

test("Tracker projection reconciles a matching remote edit without a pending local mutation", async () => {
  const store = new MemoryTrackerProjectionStore();
  const adapter = new MemoryTrackerProjectionAdapter("gitlab");
  const createdState = startTrackerTask();
  await coreContract.projectTrackerProjection({ store, adapter, state: createdState });
  const updatedState = advanceTrackerTask(createdState, "active", "implement", "MANUAL-MATCH");

  adapter.updateIsUncertain = true;
  const uncertain = await coreContract.projectTrackerProjection({ store, adapter, state: updatedState });
  assert.equal(uncertain.disposition, "recovery-required");
  store.mapping = { ...store.mapping!, pendingMutation: null } as TrackerProjectionMapping;

  const retried = await coreContract.projectTrackerProjection({ store, adapter, state: updatedState });
  assert.equal(retried.disposition, "reconciliation-required");
  assert.equal(adapter.updateCalls, 1);
});

for (const adapterId of TRACKER_ADAPTER_IDS) {
  test(`${adapterId} projection preserves both conflict versions until explicit local resolution`, async () => {
    const store = new MemoryTrackerProjectionStore();
    const adapter = new MemoryTrackerProjectionAdapter(adapterId);
    const createdState = startTrackerTask();
    await coreContract.projectTrackerProjection({ store, adapter, state: createdState });
    const updatedState = advanceTrackerTask(createdState, "active", "implement", "CONCURRENT");

    adapter.editRemotely("sayhi-task:TASK-TRACKER-33");
    const concurrent = await coreContract.projectTrackerProjection({ store, adapter, state: updatedState });
    assert.equal(concurrent.disposition, "reconciliation-required");
    if (concurrent.disposition !== "reconciliation-required") {
      return;
    }
    assert.equal(concurrent.conflict.adapterId, adapterId);
    assert.equal(concurrent.conflict.incoming.phase, "implement");
    assert.equal(concurrent.conflict.observed.projection.phase, "review");
    assert.equal(adapter.updateCalls, 0);
    assert.equal(updatedState.projection.phase, "implement");

    const resolved = await coreContract.resolveTrackerProjectionConflict({
      store,
      adapter,
      state: updatedState,
      conflict: concurrent.conflict,
      resolution: "use-local",
    });
    assert.equal(resolved.disposition, "resolved-local");
    assert.equal(adapter.updateCalls, 1);
    assert.equal(updatedState.projection.phase, "implement");

    const nextState = advanceTrackerTask(updatedState, "active", "review", "CONDITIONAL");
    adapter.conflictOnNextUpdate = true;
    const raced = await coreContract.projectTrackerProjection({ store, adapter, state: nextState });
    assert.equal(raced.disposition, "reconciliation-required");
    if (raced.disposition !== "reconciliation-required") {
      return;
    }
    assert.equal(raced.conflict.incoming.phase, "review");
    assert.equal(raced.conflict.observed.projection.phase, "implement");
    assert.equal(adapter.updateCalls, 2);
  });
}

test("Tracker projection reports authentication and unsupported archive outcomes as recoverable diagnostics", async () => {
  const authenticationStore = new MemoryTrackerProjectionStore();
  const authenticationAdapter = new MemoryTrackerProjectionAdapter("custom:private-tracker");
  authenticationAdapter.authenticationFailure = true;
  const authentication = await coreContract.projectTrackerProjection({
    store: authenticationStore,
    adapter: authenticationAdapter,
    state: startTrackerTask(),
  });
  assert.equal(authentication.disposition, "recovery-required");
  if (authentication.disposition !== "recovery-required") {
    return;
  }
  assert.equal(authentication.diagnostic.code, "tracker.authentication-failed");
  assert.equal(authentication.diagnostic.adapterId, "custom:private-tracker");

  const store = new MemoryTrackerProjectionStore();
  const adapter = new MemoryTrackerProjectionAdapter("gitlab");
  const state = startTrackerTask();
  await coreContract.projectTrackerProjection({ store, adapter, state });
  const implemented = advanceTrackerTask(state, "active", "implement", "UNSUPPORTED-ARCHIVE");
  adapter.archiveSupported = false;
  const unsupported = await coreContract.projectTrackerProjection({
    store,
    adapter,
    state: archiveTrackerTask(implemented),
  });
  assert.equal(unsupported.disposition, "recovery-required");
  if (unsupported.disposition !== "recovery-required") {
    return;
  }
  assert.equal(unsupported.diagnostic.code, "tracker.operation-unsupported");
  assert.equal(unsupported.diagnostic.operation, "archive");
});

for (const adapterId of TRACKER_ADAPTER_IDS) {
  test(`${adapterId} projection rejects credentialed remote URIs without exposing credentials`, async () => {
    const store = new MemoryTrackerProjectionStore();
    const adapter = new MemoryTrackerProjectionAdapter(adapterId);
    adapter.resourceUri = "https://token@example.test/TASK-TRACKER-33";

    const result = await coreContract.projectTrackerProjection({
      store,
      adapter,
      state: startTrackerTask(),
    });

    assert.equal(result.disposition, "recovery-required");
    if (result.disposition !== "recovery-required") {
      return;
    }
    assert.equal(result.diagnostic.code, "tracker.resource-uri-invalid");
    assert.equal(store.mapping, null);
    assert.doesNotMatch(JSON.stringify(result), /token/u);
    assert.doesNotMatch(JSON.stringify(store.mapping), /token/u);
  });
}

test("Tracker projection rejects credentialed remote resources before exposing a conflict", async () => {
  const store = new MemoryTrackerProjectionStore();
  const adapter = new MemoryTrackerProjectionAdapter("gitlab");
  const createdState = startTrackerTask();
  await coreContract.projectTrackerProjection({ store, adapter, state: createdState });
  const resource = adapter.records.get("sayhi-task:TASK-TRACKER-33");
  assert.notEqual(resource, undefined);
  const authorityIdentity = changedIdentity();
  adapter.records.set("sayhi-task:TASK-TRACKER-33", {
    ...resource!,
    uri: "https://token@example.test/TASK-TRACKER-33",
    authorityIdentity,
    projection: { ...resource!.projection, phase: "review", authorityIdentity },
  });

  const result = await coreContract.projectTrackerProjection({
    store,
    adapter,
    state: advanceTrackerTask(createdState, "active", "implement", "CREDENTIAL-CONFLICT"),
  });

  assert.equal(result.disposition, "recovery-required");
  if (result.disposition !== "recovery-required") {
    return;
  }
  assert.equal(result.diagnostic.code, "tracker.resource-uri-invalid");
  assert.doesNotMatch(JSON.stringify(result), /token/u);
  assert.doesNotMatch(JSON.stringify(store.mapping), /token/u);
});
