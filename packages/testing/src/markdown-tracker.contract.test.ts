import assert from "node:assert/strict";
import test from "node:test";

import {
  coreContract,
  readGateEvidenceKinds,
  type MarkdownTrackerSnapshot,
  type MarkdownTrackerStore,
  type StartWorkflowTaskRequest,
  type WorkflowLifecycle,
  type WorkflowPhase,
  type WorkflowState,
} from "@dnslin/sayhi-core";

const TRACKER_TASK: StartWorkflowTaskRequest = {
  contractVersion: 1,
  task: {
    id: "TASK-MARKDOWN-31",
    title: "Project local Tasks to Markdown",
    route: "build",
    parentTaskId: null,
    initiativeGraphId: null,
    intent: {
      goals: ["Make Task state visible in a local Markdown Tracker."],
      nonGoals: ["Synchronize a remote Tracker."],
      acceptanceCriteria: ["The Tracker reflects accepted local Task state."],
    },
    scope: {
      files: ["docs/tracker.md"],
      apis: [],
      schemas: [],
      locks: [],
    },
    baselineRef: "baseline.json",
    contexts: {},
    policies: { commit: "never", push: "never", maxRepairAttempts: 2 },
  },
  routeGate: {
    gate: "route",
    evidence: [{ kind: "human-approval", reference: "evidence/route.json" }],
  },
  event: {
    eventId: "EVENT-MARKDOWN-31-CREATE",
    actor: { kind: "orchestrator", id: "sayhi-test", sessionRef: "session-31" },
    reason: "Create Markdown Tracker Task.",
    idempotencyKey: "IDEMPOTENCY-MARKDOWN-31-CREATE",
    occurredAt: "2026-07-19T12:00:00Z",
  },
};

class MemoryMarkdownTrackerStore implements MarkdownTrackerStore {
  snapshot: MarkdownTrackerSnapshot = { schemaVersion: 1, markdown: "", entries: [] };
  writes = 0;

  async readMarkdownTracker(): Promise<MarkdownTrackerSnapshot> {
    return this.snapshot;
  }

  async writeMarkdownTracker(snapshot: MarkdownTrackerSnapshot): Promise<void> {
    this.snapshot = snapshot;
    this.writes += 1;
  }
}

function advanceTrackerWorkflow(
  state: WorkflowState,
  lifecycle: WorkflowLifecycle,
  phase: WorkflowPhase,
  suffix: string,
  blockers?: readonly string[],
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
      evidence: [
        {
          kind: readGateEvidenceKinds(gate)[0]!,
          reference: `evidence/${suffix}-${gate}.json`,
        },
      ],
    })),
    ...(blockers === undefined ? {} : { blockers }),
    event: {
      ...TRACKER_TASK.event,
      eventId: `EVENT-MARKDOWN-31-${suffix}`,
      idempotencyKey: `IDEMPOTENCY-MARKDOWN-31-${suffix}`,
      occurredAt: "2026-07-19T12:02:00Z",
    },
  });
  assert.equal(advanced.ok, true);
  return advanced.state;
}

test("Core deterministically projects created and advanced Tasks to Markdown without retry writes", async () => {
  const created = coreContract.startWorkflowTask(TRACKER_TASK);
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const store = new MemoryMarkdownTrackerStore();
  const projected = await coreContract.projectMarkdownTracker({ store, state: created.state });
  assert.equal(projected.disposition, "created");
  assert.equal(store.writes, 1);
  assert.equal(
    store.snapshot.markdown,
    [
      "# SayHi Tracker",
      "",
      "<!-- sayhi-tracker:entries -->",
      "<!-- sayhi-tracker:task TASK-MARKDOWN-31 -->",
      "## TASK-MARKDOWN-31 — Project local Tasks to Markdown",
      "- Route: `build`",
      "- Lifecycle: `active`",
      "- Phase: `triage`",
      "- Step: `ready`",
      "- Version: 1",
      "- Updated: `2026-07-19T12:00:00Z`",
      "<!-- /sayhi-tracker:task TASK-MARKDOWN-31 -->",
      "<!-- /sayhi-tracker:entries -->",
      "",
    ].join("\n"),
  );

  const retried = await coreContract.projectMarkdownTracker({ store, state: created.state });
  assert.equal(retried.disposition, "unchanged");
  assert.equal(store.writes, 1);

  const advanced = coreContract.transitionWorkflow(created.state, {
    contractVersion: 1,
    taskId: created.state.projection.id,
    expectedVersion: created.state.projection.version,
    to: { lifecycle: "active", phase: "explore", step: "ready" },
    gates: [
      {
        gate: "route",
        evidence: [{ kind: "human-approval", reference: "evidence/explore.json" }],
      },
    ],
    event: {
      eventId: "EVENT-MARKDOWN-31-EXPLORE",
      actor: { kind: "orchestrator", id: "sayhi-test", sessionRef: "session-31" },
      reason: "Advance Markdown Tracker Task.",
      idempotencyKey: "IDEMPOTENCY-MARKDOWN-31-EXPLORE",
      occurredAt: "2026-07-19T12:01:00Z",
    },
  });
  assert.equal(advanced.ok, true);
  if (!advanced.ok) {
    return;
  }

  const updated = await coreContract.projectMarkdownTracker({ store, state: advanced.state });
  assert.equal(updated.disposition, "updated");
  assert.equal(store.writes, 2);
  assert.match(store.snapshot.markdown, /- Phase: `explore`/u);
  assert.match(store.snapshot.markdown, /- Version: 2/u);
  assert.match(store.snapshot.markdown, /- Updated: `2026-07-19T12:01:00Z`/u);
});

test("Core preserves an untracked Markdown projection for explicit reconciliation", async () => {
  const created = coreContract.startWorkflowTask(TRACKER_TASK);
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const markdown = [
    "# SayHi Tracker",
    "",
    "<!-- sayhi-tracker:entries -->",
    "<!-- sayhi-tracker:task TASK-MARKDOWN-31 -->",
    "## TASK-MARKDOWN-31 — Manually restored projection",
    "- Lifecycle: `active`",
    "<!-- /sayhi-tracker:task TASK-MARKDOWN-31 -->",
    "<!-- /sayhi-tracker:entries -->",
    "",
  ].join("\n");
  const store = new MemoryMarkdownTrackerStore();
  store.snapshot = { schemaVersion: 1, markdown, entries: [] };

  const result = await coreContract.projectMarkdownTracker({ store, state: created.state });
  assert.equal(result.disposition, "reconciliation-required");
  assert.equal(store.writes, 0);
  assert.equal(store.snapshot.markdown, markdown);
});

test("Core refuses to overwrite manual text inside the generated Tracker section", async () => {
  const created = coreContract.startWorkflowTask(TRACKER_TASK);
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const store = new MemoryMarkdownTrackerStore();
  await coreContract.projectMarkdownTracker({ store, state: created.state });
  const editedMarkdown = store.snapshot.markdown.replace(
    "<!-- /sayhi-tracker:entries -->",
    "Manual note retained for reconciliation.\n<!-- /sayhi-tracker:entries -->",
  );
  store.snapshot = { ...store.snapshot, markdown: editedMarkdown };

  const advanced = coreContract.transitionWorkflow(created.state, {
    contractVersion: 1,
    taskId: created.state.projection.id,
    expectedVersion: created.state.projection.version,
    to: { lifecycle: "active", phase: "explore", step: "ready" },
    gates: [
      {
        gate: "route",
        evidence: [{ kind: "human-approval", reference: "evidence/explore.json" }],
      },
    ],
    event: {
      ...TRACKER_TASK.event,
      eventId: "EVENT-MARKDOWN-31-ROOT-EDIT",
      idempotencyKey: "IDEMPOTENCY-MARKDOWN-31-ROOT-EDIT",
      occurredAt: "2026-07-19T12:01:00Z",
    },
  });
  assert.equal(advanced.ok, true);
  if (!advanced.ok) {
    return;
  }

  const result = await coreContract.projectMarkdownTracker({ store, state: advanced.state });
  assert.equal(result.disposition, "reconciliation-required");
  assert.equal(store.writes, 1);
  assert.equal(store.snapshot.markdown, editedMarkdown);
  if (result.disposition !== "reconciliation-required") {
    return;
  }
  const resolved = await coreContract.resolveMarkdownTrackerConflict({
    store,
    conflict: result.conflict,
    resolution: "use-local",
  });
  assert.equal(resolved.disposition, "resolved");
  assert.equal(store.writes, 2);
  assert.doesNotMatch(store.snapshot.markdown, /Manual note retained for reconciliation\./u);
  assert.match(store.snapshot.markdown, /- Phase: `explore`/u);
});

test("Core reconciles a manual projection edit without changing local Task authority", async () => {
  const created = coreContract.startWorkflowTask(TRACKER_TASK);
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const store = new MemoryMarkdownTrackerStore();
  await coreContract.projectMarkdownTracker({ store, state: created.state });
  const editedMarkdown = store.snapshot.markdown.replace(
    "Project local Tasks to Markdown",
    "Manual Tracker title",
  );
  store.snapshot = { ...store.snapshot, markdown: editedMarkdown };
  const advanced = coreContract.transitionWorkflow(created.state, {
    contractVersion: 1,
    taskId: created.state.projection.id,
    expectedVersion: created.state.projection.version,
    to: { lifecycle: "active", phase: "explore", step: "ready" },
    gates: [
      {
        gate: "route",
        evidence: [{ kind: "human-approval", reference: "evidence/explore.json" }],
      },
    ],
    event: {
      ...TRACKER_TASK.event,
      eventId: "EVENT-MARKDOWN-31-MANUAL-EDIT",
      idempotencyKey: "IDEMPOTENCY-MARKDOWN-31-MANUAL-EDIT",
      occurredAt: "2026-07-19T12:01:00Z",
    },
  });
  assert.equal(advanced.ok, true);
  if (!advanced.ok) {
    return;
  }

  const result = await coreContract.projectMarkdownTracker({ store, state: advanced.state });
  assert.equal(result.disposition, "reconciliation-required");
  if (result.disposition !== "reconciliation-required") {
    return;
  }
  assert.match(result.conflict.base, /Project local Tasks to Markdown/u);
  assert.match(result.conflict.observed ?? "", /Manual Tracker title/u);
  assert.match(result.conflict.incoming ?? "", /- Phase: `explore`/u);
  assert.equal(store.writes, 1);

  const resolved = await coreContract.resolveMarkdownTrackerConflict({
    store,
    conflict: result.conflict,
    resolution: "keep-observed",
  });
  assert.equal(resolved.disposition, "resolved");
  assert.equal(store.writes, 2);
  assert.match(store.snapshot.markdown, /Manual Tracker title/u);
  assert.equal(advanced.state.projection.lifecycle, "active");
  assert.equal(advanced.state.projection.phase, "explore");

  const retried = await coreContract.projectMarkdownTracker({ store, state: advanced.state });
  assert.equal(retried.disposition, "unchanged");
  assert.equal(store.writes, 2);
});

test("Core renders stable blocked, archived, and deleted Tracker entries", async () => {
  const blockedCreated = coreContract.startWorkflowTask(TRACKER_TASK);
  assert.equal(blockedCreated.ok, true);
  if (!blockedCreated.ok) {
    return;
  }
  const blockedState = advanceTrackerWorkflow(
    blockedCreated.state,
    "blocked",
    "triage",
    "BLOCKED",
    ["Issue #28 is unresolved."],
  );
  const blockedStore = new MemoryMarkdownTrackerStore();
  await coreContract.projectMarkdownTracker({ store: blockedStore, state: blockedState });
  assert.match(blockedStore.snapshot.markdown, /- Lifecycle: `blocked`/u);
  assert.match(blockedStore.snapshot.markdown, /- Blockers:\n  - Issue #28 is unresolved\./u);

  const archivedCreated = coreContract.startWorkflowTask({
    ...TRACKER_TASK,
    task: {
      ...TRACKER_TASK.task,
      id: "TASK-MARKDOWN-31-ARCHIVED",
      route: "quick",
    },
    event: {
      ...TRACKER_TASK.event,
      eventId: "EVENT-MARKDOWN-31-ARCHIVED-CREATE",
      idempotencyKey: "IDEMPOTENCY-MARKDOWN-31-ARCHIVED-CREATE",
    },
  });
  assert.equal(archivedCreated.ok, true);
  if (!archivedCreated.ok) {
    return;
  }
  let archivedState = archivedCreated.state;
  for (const [lifecycle, phase, suffix] of [
    ["active", "implement", "ARCHIVED-IMPLEMENT"],
    ["active", "review", "ARCHIVED-REVIEW"],
    ["active", "finish", "ARCHIVED-FINISH"],
    ["completed", "finish", "ARCHIVED-COMPLETE"],
    ["archived", "finish", "ARCHIVED-ARCHIVE"],
  ] as const) {
    archivedState = advanceTrackerWorkflow(archivedState, lifecycle, phase, suffix);
  }
  const archivedStore = new MemoryMarkdownTrackerStore();
  await coreContract.projectMarkdownTracker({ store: archivedStore, state: archivedState });
  assert.match(archivedStore.snapshot.markdown, /- Lifecycle: `archived`/u);
  assert.match(archivedStore.snapshot.markdown, /- Step: `archived`/u);

  const deletedStore = new MemoryMarkdownTrackerStore();
  const deleted = await coreContract.projectDeletedMarkdownTrackerTask({
    store: deletedStore,
    state: archivedState,
    deletedAt: "2026-07-19T12:03:00Z",
  });
  assert.equal(deleted.disposition, "created");
  assert.match(deletedStore.snapshot.markdown, /- Lifecycle: `deleted`/u);
  assert.match(deletedStore.snapshot.markdown, /- Last local lifecycle: `archived`/u);
  assert.match(deletedStore.snapshot.markdown, /- Deleted: `2026-07-19T12:03:00Z`/u);
});

test("Core preserves the base and observed Markdown when Tracker markers are malformed", async () => {
  const created = coreContract.startWorkflowTask(TRACKER_TASK);
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const store = new MemoryMarkdownTrackerStore();
  store.snapshot = { schemaVersion: 1, markdown: "# Team notes\n\n", entries: [] };
  await coreContract.projectMarkdownTracker({ store, state: created.state });
  const malformedMarkdown = store.snapshot.markdown.replace(
    "<!-- /sayhi-tracker:entries -->",
    "",
  );
  store.snapshot = { ...store.snapshot, markdown: malformedMarkdown };
  const advanced = coreContract.transitionWorkflow(created.state, {
    contractVersion: 1,
    taskId: created.state.projection.id,
    expectedVersion: created.state.projection.version,
    to: { lifecycle: "active", phase: "explore", step: "ready" },
    gates: [
      {
        gate: "route",
        evidence: [{ kind: "human-approval", reference: "evidence/explore.json" }],
      },
    ],
    event: {
      ...TRACKER_TASK.event,
      eventId: "EVENT-MARKDOWN-31-MALFORMED",
      idempotencyKey: "IDEMPOTENCY-MARKDOWN-31-MALFORMED",
      occurredAt: "2026-07-19T12:01:00Z",
    },
  });
  assert.equal(advanced.ok, true);
  if (!advanced.ok) {
    return;
  }

  const result = await coreContract.projectMarkdownTracker({ store, state: advanced.state });
  assert.equal(result.disposition, "reconciliation-required");
  if (result.disposition !== "reconciliation-required") {
    return;
  }
  assert.match(result.conflict.base, /Project local Tasks to Markdown/u);
  assert.equal(result.conflict.observed, malformedMarkdown);
  assert.match(result.conflict.incoming ?? "", /- Phase: `explore`/u);
  assert.equal(store.writes, 1);
  assert.equal(store.snapshot.markdown, malformedMarkdown);
});

test("Core orders Markdown Tracker entries by Task ID code units", async () => {
  const zTask = coreContract.startWorkflowTask({
    ...TRACKER_TASK,
    task: { ...TRACKER_TASK.task, id: "TASK-Z" },
    event: {
      ...TRACKER_TASK.event,
      eventId: "EVENT-MARKDOWN-31-Z",
      idempotencyKey: "IDEMPOTENCY-MARKDOWN-31-Z",
    },
  });
  const lowercaseTask = coreContract.startWorkflowTask({
    ...TRACKER_TASK,
    task: { ...TRACKER_TASK.task, id: "TASK-a" },
    event: {
      ...TRACKER_TASK.event,
      eventId: "EVENT-MARKDOWN-31-a",
      idempotencyKey: "IDEMPOTENCY-MARKDOWN-31-a",
    },
  });
  assert.equal(zTask.ok, true);
  assert.equal(lowercaseTask.ok, true);
  if (!zTask.ok || !lowercaseTask.ok) {
    return;
  }

  const store = new MemoryMarkdownTrackerStore();
  await coreContract.projectMarkdownTracker({ store, state: lowercaseTask.state });
  await coreContract.projectMarkdownTracker({ store, state: zTask.state });
  assert.ok(
    store.snapshot.markdown.indexOf("<!-- sayhi-tracker:task TASK-Z -->") <
      store.snapshot.markdown.indexOf("<!-- sayhi-tracker:task TASK-a -->"),
  );
});

test("Core renders marker-like Task text as data without corrupting the Tracker", async () => {
  const created = coreContract.startWorkflowTask({
    ...TRACKER_TASK,
    task: {
      ...TRACKER_TASK.task,
      id: "TASK-MARKER-TEXT",
      title: "Text <!-- /sayhi-tracker:entries --> remains data",
    },
    event: {
      ...TRACKER_TASK.event,
      eventId: "EVENT-MARKDOWN-31-MARKER-TEXT",
      idempotencyKey: "IDEMPOTENCY-MARKDOWN-31-MARKER-TEXT",
    },
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const store = new MemoryMarkdownTrackerStore();
  const projected = await coreContract.projectMarkdownTracker({ store, state: created.state });
  assert.equal(projected.disposition, "created");
  assert.match(store.snapshot.markdown, /Text &lt;!-- \/sayhi-tracker:entries --&gt; remains data/u);

  const retried = await coreContract.projectMarkdownTracker({ store, state: created.state });
  assert.equal(retried.disposition, "unchanged");
});

test("Core denies local reconciliation when another Task's authority state is unavailable", async () => {
  const editedTask = coreContract.startWorkflowTask({
    ...TRACKER_TASK,
    task: { ...TRACKER_TASK.task, id: "TASK-EDITED" },
    event: {
      ...TRACKER_TASK.event,
      eventId: "EVENT-MARKDOWN-31-EDITED",
      idempotencyKey: "IDEMPOTENCY-MARKDOWN-31-EDITED",
    },
  });
  const projectedTask = coreContract.startWorkflowTask({
    ...TRACKER_TASK,
    task: { ...TRACKER_TASK.task, id: "TASK-PROJECTED" },
    event: {
      ...TRACKER_TASK.event,
      eventId: "EVENT-MARKDOWN-31-PROJECTED",
      idempotencyKey: "IDEMPOTENCY-MARKDOWN-31-PROJECTED",
    },
  });
  assert.equal(editedTask.ok, true);
  assert.equal(projectedTask.ok, true);
  if (!editedTask.ok || !projectedTask.ok) {
    return;
  }

  const store = new MemoryMarkdownTrackerStore();
  await coreContract.projectMarkdownTracker({ store, state: editedTask.state });
  const advancedEditedTask = advanceTrackerWorkflow(
    editedTask.state,
    "active",
    "explore",
    "EDITED-UNPROJECTED",
  );
  const editedMarkdown = store.snapshot.markdown.replace(
    "Project local Tasks to Markdown",
    "Manual Tracker title",
  );
  store.snapshot = { ...store.snapshot, markdown: editedMarkdown };

  const conflict = await coreContract.projectMarkdownTracker({
    store,
    state: projectedTask.state,
  });
  assert.equal(conflict.disposition, "reconciliation-required");
  if (conflict.disposition !== "reconciliation-required") {
    return;
  }
  assert.equal(conflict.conflict.taskId, editedTask.state.projection.id);
  assert.equal(conflict.conflict.incoming, null);

  const resolved = await coreContract.resolveMarkdownTrackerConflict({
    store,
    conflict: conflict.conflict,
    resolution: "use-local",
  });
  assert.equal(resolved.disposition, "reconciliation-required");
  assert.equal(store.writes, 1);
  assert.equal(store.snapshot.markdown, editedMarkdown);
  assert.equal(advancedEditedTask.projection.phase, "explore");
});
