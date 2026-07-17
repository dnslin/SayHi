import assert from "node:assert/strict";
import test from "node:test";

import {
  coreContract,
  type BindPhaseExecutionRequest,
  type PhaseExecutionMaterials,
  type ContractIdentity,
  type ReviewFinding,
  advanceDurableTask,
  addDurableContextManifestEntry,
  archiveDurableTask,
  createDurableTask,
  createDurableTaskHandoff,
  decideDurableBuildPlan,
  diagnoseDurableTasks,
  freezeDurableContextManifest,
  listDurableTasks,
  recordDurableBuildPlan,
  refreshDurableContextManifest,
  recoverDurableTask,
  type TaskArchiveFileSystem,
  type TransitionWorkflowRequest,
  type WorkflowLifecycle,
  type WorkflowPhase,
  type WorkflowState,
} from "@dnslin/sayhi-core";

import {
  createCompletedDurableTask,
  IMPLEMENTATION_AGENT,
  REVIEW_AGENTS,
  recordTestPhaseResult,
  taskLifecycleEventMetadata,
  taskLifecycleExploreTransition,
  taskLifecycleStartRequest,
  taskLifecycleTransition,
  type TaskLifecycleFixture,
} from "./task-lifecycle-test-support.js";

const TASK_ID = "TASK-10-BUILD";
const TASK_FIXTURE = Object.freeze({
  taskId: TASK_ID,
  title: "Persist a durable Task lifecycle",
  goal: "Persist accepted Workflow Events",
  acceptanceCriterion: "Recovery reproduces the Task Projection",
  files: Object.freeze(["packages/core/**"]),
  eventNamespace: "10",
  sessionRef: "session-10",
}) satisfies TaskLifecycleFixture;

function resumeBlockEvent(suffix: string, occurredAt: string) {
  return taskLifecycleEventMetadata(
    TASK_FIXTURE,
    `PHASE-RESUME-${suffix}`,
    occurredAt,
  );
}
const TASK_DIRECTORY = `.sayhi/tasks/${TASK_ID}`;
const EVENTS_PATH = `${TASK_DIRECTORY}/events.jsonl`;
const PROJECTION_PATH = `${TASK_DIRECTORY}/task.json`;

class MemoryTaskLifecycleFileSystem implements TaskArchiveFileSystem {
  readonly directories = new Set([".sayhi", ".sayhi/tasks"]);
  readonly files = new Map<string, string>();
  #failNextWritePath: string | null = null;
  #failNextMove = false;
  readonly #lockTails = new Map<string, Promise<void>>();

  failNextWrite(path: string): void {
    this.#failNextWritePath = path;
  }

  failNextMove(): void {
    this.#failNextMove = true;
  }

  async inspect(path: string) {
    if (this.directories.has(path)) {
      return { kind: "directory" as const };
    }
    if (this.files.has(path)) {
      return { kind: "file" as const };
    }
    return { kind: "missing" as const };
  }

  async listDirectory(path: string) {
    const prefix = `${path}/`;
    const entries = new Map<string, "directory" | "file">();
    for (const directory of this.directories) {
      const name = immediateChildName(prefix, directory);
      if (name !== null) {
        entries.set(name, "directory");
      }
    }
    for (const file of this.files.keys()) {
      const name = immediateChildName(prefix, file);
      if (name !== null && !entries.has(name)) {
        entries.set(name, "file");
      }
    }
    return [...entries]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, kind]) => ({ name, kind }));
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`Missing test file: ${path}`);
    }
    return content;
  }

  async readRepositoryFile(path: string): Promise<string> {
    return this.readFile(path);
  }

  async createDirectory(path: string): Promise<void> {
    this.directories.add(path);
  }

  async appendFile(path: string, content: string): Promise<void> {
    this.files.set(path, `${this.files.get(path) ?? ""}${content}`);
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.#failNextWritePath === path) {
      this.#failNextWritePath = null;
      throw new Error(`Injected write failure: ${path}`);
    }
    this.files.set(path, content);
  }
  async moveDirectory(source: string, target: string): Promise<void> {
    if (this.#failNextMove) {
      this.#failNextMove = false;
      throw new Error(`Injected move failure: ${source}`);
    }
    if (!this.directories.has(source) || this.directories.has(target)) {
      throw new Error(`Cannot move ${source} to ${target}.`);
    }
    const directories = [...this.directories].filter(
      (path) => path === source || path.startsWith(`${source}/`),
    );
    const files = [...this.files.entries()].filter(([path]) =>
      path.startsWith(`${source}/`),
    );
    for (const path of directories) {
      this.directories.delete(path);
    }
    for (const [path] of files) {
      this.files.delete(path);
    }
    for (const path of directories) {
      this.directories.add(`${target}${path.slice(source.length)}`);
    }
    for (const [path, content] of files) {
      this.files.set(`${target}${path.slice(source.length)}`, content);
    }
  }

  async withTaskMutationLock<Result>(
    path: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = this.#lockTails.get(path) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#lockTails.set(path, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#lockTails.get(path) === tail) {
        this.#lockTails.delete(path);
      }
    }
  }
}

function immediateChildName(prefix: string, candidate: string): string | null {
  if (!candidate.startsWith(prefix)) {
    return null;
  }
  const name = candidate.slice(prefix.length);
  return name.length > 0 && !name.includes("/") ? name : null;
}

test("durable Task creation and advancement append Events without rewriting history", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const created = await createDurableTask({
    fileSystem,
    start: startRequest(),
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const creationHistory = fileSystem.files.get(EVENTS_PATH);
  assert.ok(creationHistory);
  assert.equal(creationHistory.split("\n").filter(Boolean).length, 1);

  const advanced = await advanceDurableTask({
    fileSystem,
    transition: exploreTransition(created.state.projection.version),
  });
  assert.equal(advanced.ok, true);
  if (!advanced.ok) {
    return;
  }

  const advancedHistory = fileSystem.files.get(EVENTS_PATH);
  assert.ok(advancedHistory);
  assert.equal(advancedHistory.startsWith(creationHistory), true);
  assert.equal(advancedHistory.split("\n").filter(Boolean).length, 2);
  assert.deepEqual(
    JSON.parse(fileSystem.files.get(PROJECTION_PATH)!),
    advanced.state.projection,
  );
});

test("durable Task recovery rebuilds the authoritative Projection from Events", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const created = await createDurableTask({ fileSystem, start: startRequest() });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const advanced = await advanceDurableTask({
    fileSystem,
    transition: exploreTransition(created.state.projection.version),
  });
  assert.equal(advanced.ok, true);
  if (!advanced.ok) {
    return;
  }
  const acceptedHistory = fileSystem.files.get(EVENTS_PATH)!;
  fileSystem.files.delete(PROJECTION_PATH);

  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });

  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.state.projection, advanced.state.projection);
  assert.equal(recovered.state.projection.route, "build");
  assert.equal(recovered.state.projection.phase, "explore");
  assert.equal(recovered.state.projection.lifecycle, "active");
  assert.deepEqual(recovered.state.events.at(-1)?.gates, [
    {
      gate: "route",
      evidence: [
        {
          kind: "human-approval",
          reference: "evidence/build-route-accepted.json",
        },
      ],
    },
  ]);
  assert.equal(fileSystem.files.get(EVENTS_PATH), acceptedHistory);
  assert.deepEqual(
    JSON.parse(fileSystem.files.get(PROJECTION_PATH)!),
    advanced.state.projection,
  );

  const snapshot = new Map(fileSystem.files);
  const retried = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(retried.ok, true);
  if (!retried.ok) {
    return;
  }
  assert.equal(retried.recovered, false);
  assert.deepEqual(retried.state, recovered.state);
  assert.deepEqual(fileSystem.files, snapshot);
});

test("durable Task recovery returns the persisted Handoff", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const created = await createDurableTask({ fileSystem, start: startRequest() });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const state = created.state;
  const handoff = {
    schemaVersion: 1,
    taskId: TASK_ID,
    phase: state.projection.phase,
    step: state.projection.step,
    projectionVersion: state.projection.version,
    blockers: state.projection.blockers,
    repositoryFingerprint: "sha256:workspace-state",
    artifactReferences: ["context/explore.jsonl", "evidence/route.json"],
    createdAt: "2026-07-15T13:00:00Z",
  };
  const recorded = await createDurableTaskHandoff({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: state.projection.version,
    repositoryFingerprint: handoff.repositoryFingerprint,
    artifactReferences: handoff.artifactReferences,
    createdAt: handoff.createdAt,
  });
  assert.equal(recorded.ok, true);
  if (!recorded.ok) {
    return;
  }
  assert.deepEqual(recorded.handoff, handoff);

  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });

  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  assert.ok("handoff" in recovered);
  if (!("handoff" in recovered)) {
    return;
  }
  assert.deepEqual(recovered.handoff, handoff);
});

test("durable Task Handoff rejects a stale Projection version without persistence", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const created = await createDurableTask({ fileSystem, start: startRequest() });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const recorded = await createDurableTaskHandoff({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: created.state.projection.version + 1,
    repositoryFingerprint: "sha256:workspace-state",
    artifactReferences: ["context/triage.jsonl"],
    createdAt: "2026-07-15T13:00:00Z",
  });

  assert.equal(recorded.ok, false);
  if (recorded.ok) {
    return;
  }
  assert.equal(recorded.diagnostics[0]?.code, "workflow.version.stale");
  assert.equal(fileSystem.files.has(`${TASK_DIRECTORY}/handoff.json`), false);
});

test("truncated Event history fails with a diagnostic and no mutation", async () => {
  const { fileSystem } = await createAdvancedTask();
  const history = fileSystem.files.get(EVENTS_PATH)!;
  fileSystem.files.set(EVENTS_PATH, history.slice(0, -2));
  const before = new Map(fileSystem.files);

  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });

  assert.equal(recovered.ok, false);
  if (recovered.ok) {
    return;
  }
  assert.equal(
    recovered.diagnostics[0]?.code,
    "task_lifecycle.history.invalid",
  );
  assert.equal(recovered.diagnostics[0]?.path, `${EVENTS_PATH}:2`);
  assert.deepEqual(fileSystem.files, before);
});

test("digest-corrupt Event history fails with a diagnostic and no mutation", async () => {
  const { fileSystem } = await createAdvancedTask();
  const lines = fileSystem.files.get(EVENTS_PATH)!.trimEnd().split("\n");
  const event = parseJsonObject(lines[1]!);
  lines[1] = JSON.stringify({ ...event, reason: "tampered" });
  fileSystem.files.set(EVENTS_PATH, `${lines.join("\n")}\n`);
  const before = new Map(fileSystem.files);

  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });

  assert.equal(recovered.ok, false);
  if (recovered.ok) {
    return;
  }
  assert.equal(
    recovered.diagnostics[0]?.code,
    "workflow.event.chain_invalid",
  );
  assert.equal(
    recovered.diagnostics[0]?.path,
    `${EVENTS_PATH}$[1].chainDigest`,
  );
  assert.deepEqual(fileSystem.files, before);
});

test("incompatible Event history fails with a diagnostic and no mutation", async () => {
  const { fileSystem } = await createAdvancedTask();
  const lines = fileSystem.files.get(EVENTS_PATH)!.trimEnd().split("\n");
  const event = parseJsonObject(lines[1]!);
  lines[1] = JSON.stringify({ ...event, schemaVersion: 2 });
  fileSystem.files.set(EVENTS_PATH, `${lines.join("\n")}\n`);
  const before = new Map(fileSystem.files);

  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });

  assert.equal(recovered.ok, false);
  if (recovered.ok) {
    return;
  }
  assert.equal(recovered.diagnostics[0]?.code, "workflow.event.invalid");
  assert.equal(
    recovered.diagnostics[0]?.path,
    `${EVENTS_PATH}$[1].schemaVersion`,
  );
  assert.deepEqual(fileSystem.files, before);
});

test("an interrupted Projection write recovers from the accepted Event", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const created = await createDurableTask({ fileSystem, start: startRequest() });
  if (!created.ok) {
    assert.fail(created.diagnostics[0]?.message ?? "Task creation failed");
  }
  const creationHistory = fileSystem.files.get(EVENTS_PATH)!;
  fileSystem.failNextWrite(PROJECTION_PATH);

  const interrupted = await advanceDurableTask({
    fileSystem,
    transition: exploreTransition(created.state.projection.version),
  });

  assert.equal(interrupted.ok, false);
  if (interrupted.ok) {
    return;
  }
  assert.equal(interrupted.diagnostics[0]?.code, "task_lifecycle.io_failed");
  const acceptedHistory = fileSystem.files.get(EVENTS_PATH)!;
  assert.equal(acceptedHistory.startsWith(creationHistory), true);
  assert.equal(acceptedHistory.split("\n").filter(Boolean).length, 2);
  const laggingProjection = parseJsonObject(fileSystem.files.get(PROJECTION_PATH)!);
  assert.ok("version" in laggingProjection);
  assert.equal(laggingProjection.version, 1);

  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.state.projection.version, 2);
  assert.equal(recovered.state.projection.phase, "explore");
  assert.equal(fileSystem.files.get(EVENTS_PATH), acceptedHistory);
});

test("an identical durable transition retry does not append or rewrite state", async () => {
  const { fileSystem, state } = await createAdvancedTask();
  const before = new Map(fileSystem.files);

  const retried = await advanceDurableTask({
    fileSystem,
    transition: exploreTransition(1),
  });

  assert.equal(retried.ok, true);
  if (!retried.ok) {
    return;
  }
  assert.equal(retried.appended, false);
  assert.deepEqual(retried.state, state);
  assert.deepEqual(fileSystem.files, before);
});

test("a stale durable transition fails without mutating files", async () => {
  const { fileSystem } = await createAdvancedTask();
  const before = new Map(fileSystem.files);

  const stale = await advanceDurableTask({
    fileSystem,
    transition: exploreTransition(1, "STALE"),
  });

  assert.equal(stale.ok, false);
  if (stale.ok) {
    return;
  }
  assert.equal(stale.diagnostics[0]?.code, "workflow.version.stale");
  assert.deepEqual(fileSystem.files, before);
});

test("an unsafe Task id is rejected before filesystem mutation", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const request = startRequest();
  const beforeFiles = new Map(fileSystem.files);
  const beforeDirectories = new Set(fileSystem.directories);

  const created = await createDurableTask({
    fileSystem,
    start: {
      ...request,
      task: { ...request.task, id: "../escape" },
    },
  });

  assert.equal(created.ok, false);
  if (created.ok) {
    return;
  }
  assert.equal(
    created.diagnostics[0]?.code,
    "task_lifecycle.task_id.invalid",
  );
  assert.deepEqual(fileSystem.files, beforeFiles);
  assert.deepEqual(fileSystem.directories, beforeDirectories);
});

function exploreTransition(expectedVersion: number, eventSuffix = "EXPLORE") {
  return taskLifecycleExploreTransition(
    TASK_FIXTURE,
    expectedVersion,
    eventSuffix,
    "2026-07-14T10:01:00Z",
  );
}

test("concurrent durable transitions serialize so the loser is stale", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const created = await createDurableTask({ fileSystem, start: startRequest() });
  if (!created.ok) {
    assert.fail(created.diagnostics[0]?.message ?? "Task creation failed");
  }

  const results = await Promise.all([
    advanceDurableTask({
      fileSystem,
      transition: exploreTransition(created.state.projection.version, "FIRST"),
    }),
    advanceDurableTask({
      fileSystem,
      transition: exploreTransition(created.state.projection.version, "SECOND"),
    }),
  ]);

  assert.equal(results.filter((result) => result.ok).length, 1);
  const rejected = results.find((result) => !result.ok);
  assert.ok(rejected && !rejected.ok);
  assert.equal(rejected.diagnostics[0]?.code, "workflow.version.stale");
  assert.equal(
    fileSystem.files.get(EVENTS_PATH)!.split("\n").filter(Boolean).length,
    2,
  );
  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
});

test("recovery rejects Event history owned by a different Task without mutation", async () => {
  const { fileSystem } = await createAdvancedTask();
  const otherTaskId = "TASK-10-OTHER";
  const otherDirectory = `.sayhi/tasks/${otherTaskId}`;
  const otherEventsPath = `${otherDirectory}/events.jsonl`;
  fileSystem.directories.add(otherDirectory);
  fileSystem.files.set(otherEventsPath, fileSystem.files.get(EVENTS_PATH)!);
  const before = new Map(fileSystem.files);

  const recovered = await recoverDurableTask({
    fileSystem,
    taskId: otherTaskId,
  });

  assert.equal(recovered.ok, false);
  if (recovered.ok) {
    return;
  }
  assert.equal(recovered.diagnostics[0]?.code, "workflow.task.mismatch");
  assert.deepEqual(fileSystem.files, before);
});

async function createAdvancedTask() {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const created = await createDurableTask({ fileSystem, start: startRequest() });
  if (!created.ok) {
    assert.fail(created.diagnostics[0]?.message ?? "Task creation failed");
  }
  const advanced = await advanceDurableTask({
    fileSystem,
    transition: exploreTransition(created.state.projection.version),
  });
  if (!advanced.ok) {
    assert.fail(advanced.diagnostics[0]?.message ?? "Task advancement failed");
  }
  return { fileSystem, state: advanced.state };
}

function parseJsonObject(source: string): object {
  const value: unknown = JSON.parse(source);
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value;
}

function startRequest(maxRepairAttempts = 2) {
  return taskLifecycleStartRequest(
    TASK_FIXTURE,
    "2026-07-14T10:00:00Z",
    maxRepairAttempts,
  );
}

test("archiving removes a completed Task from active Task listing without losing audit history", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  fileSystem.directories.add(".sayhi/tasks/archive");
  const completed = await createCompletedDurableTask(
    fileSystem,
    TASK_FIXTURE,
    "2026-07-14T10:00:00Z",
    "2026-07-15T12:00:00Z",
  );
  fileSystem.directories.add(`${TASK_DIRECTORY}/evidence`);
  fileSystem.files.set(
    `${TASK_DIRECTORY}/evidence/provenance.json`,
    "{\"source\":\"issue-13\"}\n",
  );

  const archiveTransition = transitionForFixture(
    completed,
    "archived",
    "finish",
    "ARCHIVE",
  );
  const archived = await archiveDurableTask({ fileSystem, transition: archiveTransition });

  assert.equal(archived.ok, true);
  if (!archived.ok) {
    return;
  }
  assert.equal(archived.moved, true);
  assert.equal(archived.state.projection.lifecycle, "archived");
  const archivedDirectory = `.sayhi/tasks/archive/${TASK_ID}`;
  const archivedEventsPath = `${archivedDirectory}/events.jsonl`;
  const archivedProjectionPath = `${archivedDirectory}/task.json`;
  assert.equal(fileSystem.files.has(EVENTS_PATH), false);
  assert.equal(fileSystem.files.get(`${archivedDirectory}/evidence/provenance.json`), "{\"source\":\"issue-13\"}\n");
  assert.equal(
    fileSystem.files.get(archivedEventsPath)?.split("\n").filter(Boolean).length,
    completed.events.length + 1,
  );
  assert.deepEqual(
    JSON.parse(fileSystem.files.get(archivedProjectionPath)!),
    archived.state.projection,
  );

  const diagnosed = await diagnoseDurableTasks({ fileSystem });
  assert.equal(diagnosed.ok, true);
  if (!diagnosed.ok) {
    return;
  }
  assert.equal(diagnosed.taskCount, 0);
  const listed = await listDurableTasks({ fileSystem });
  assert.equal(listed.ok, true);
  if (!listed.ok) {
    return;
  }
  assert.deepEqual(listed.taskIds, []);

  const archiveHistory = fileSystem.files.get(archivedEventsPath);

  const identical = await archiveDurableTask({
    fileSystem,
    transition: archiveTransition,
  });
  assert.equal(identical.ok, true);
  if (!identical.ok) {
    return;
  }
  assert.equal(identical.moved, true);

  const conflicting = await archiveDurableTask({
    fileSystem,
    transition: { ...archiveTransition, gates: [] },
  });
  assert.equal(conflicting.ok, false);
  if (conflicting.ok) {
    return;
  }
  assert.equal(
    conflicting.diagnostics[0]?.code,
    "workflow.event.idempotency_conflict",
  );
  assert.equal(fileSystem.files.get(archivedEventsPath), archiveHistory);
  const retried = await archiveDurableTask({
    fileSystem,
    transition: transitionForFixture(completed, "archived", "finish", "ARCHIVE-RETRY"),
  });
  assert.equal(retried.ok, true);
  if (!retried.ok) {
    return;
  }
  assert.equal(retried.moved, false);
  assert.deepEqual(retried.state, archived.state);
  assert.equal(fileSystem.files.get(archivedEventsPath), archiveHistory);
});

test("Core lists only active Tasks with valid Event history", async () => {
  const { fileSystem } = await createAdvancedTask();
  const listed = await listDurableTasks({ fileSystem });
  assert.equal(listed.ok, true);
  if (!listed.ok) {
    return;
  }
  assert.deepEqual(listed.taskIds, [TASK_ID]);

  fileSystem.files.set(EVENTS_PATH, "{\"event\":\"corrupt\"}\n");
  const corrupt = await listDurableTasks({ fileSystem });
  assert.equal(corrupt.ok, false);
  if (corrupt.ok) {
    return;
  }
  assert.equal(corrupt.diagnostics[0]?.code, "workflow.event.invalid");
});

test("an interrupted archive move resumes without appending another archive Event", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  fileSystem.directories.add(".sayhi/tasks/archive");
  const completed = await createCompletedDurableTask(
    fileSystem,
    TASK_FIXTURE,
    "2026-07-14T10:00:00Z",
    "2026-07-15T12:00:00Z",
  );
  fileSystem.failNextMove();

  const interrupted = await archiveDurableTask({
    fileSystem,
    transition: transitionForFixture(completed, "archived", "finish", "ARCHIVE-INTERRUPTED"),
  });
  assert.equal(interrupted.ok, false);
  if (interrupted.ok) {
    return;
  }
  assert.equal(interrupted.diagnostics[0]?.code, "task_lifecycle.io_failed");
  assert.equal(
    fileSystem.files.get(EVENTS_PATH)?.split("\n").filter(Boolean).length,
    completed.events.length + 1,
  );

  const resumed = await archiveDurableTask({
    fileSystem,
    transition: transitionForFixture(completed, "archived", "finish", "ARCHIVE-RESUMED"),
  });
  assert.equal(resumed.ok, true);
  if (!resumed.ok) {
    return;
  }
  assert.equal(resumed.moved, true);
  const archivedEvents = fileSystem.files.get(
    `.sayhi/tasks/archive/${TASK_ID}/events.jsonl`,
  );
  assert.equal(
    archivedEvents?.split("\n").filter(Boolean).length,
    completed.events.length + 1,
  );
});

function transitionForFixture(
  state: WorkflowState,
  lifecycle: WorkflowLifecycle,
  phase: WorkflowPhase,
  suffix: string,
): TransitionWorkflowRequest {
  return taskLifecycleTransition(
    TASK_FIXTURE,
    state,
    lifecycle,
    phase,
    suffix,
    "2026-07-15T12:00:00Z",
  );
}

test("only a durable hash-bound approved Build Plan enters Implement", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const created = await createDurableTask({ fileSystem, start: startRequest() });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const explored = await advanceDurableTask({
    fileSystem,
    transition: exploreTransition(created.state.projection.version),
  });
  assert.equal(explored.ok, true);
  if (!explored.ok) {
    return;
  }
  const planned = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      explored.state,
      "active",
      "plan",
      "PLAN",
      "2026-07-15T14:00:00Z",
    ),
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) {
    return;
  }
  fileSystem.files.set("docs/plan-context.md", "Stable implementation context.\n");
  const addedContext = await addDurableContextManifestEntry({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: planned.state.projection.version,
    phase: "implement",
    source: "docs/plan-context.md",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "IMPLEMENT-CONTEXT-ADDED",
      "2026-07-15T14:01:00Z",
    ),
  });
  assert.equal(addedContext.ok, true);
  if (!addedContext.ok) {
    return;
  }
  const unsealedPlan = await recordDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: addedContext.state.projection.version,
    content: "# Implementation Plan\n\nPersist and approve the Plan Gate.\n",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PLAN-UNSEALED",
      "2026-07-15T14:01:15Z",
    ),
  });
  assert.equal(unsealedPlan.ok, false);
  if (!unsealedPlan.ok) {
    assert.equal(unsealedPlan.diagnostics[0]?.code, "build_plan.context_stale");
  }
  const frozenContext = await freezeDurableContextManifest({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: addedContext.state.projection.version,
    phase: "implement",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "IMPLEMENT-CONTEXT",
      "2026-07-15T14:01:30Z",
    ),
  });
  assert.equal(frozenContext.ok, true);
  if (!frozenContext.ok) {
    return;
  }

  const prepared = await recordDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: frozenContext.state.projection.version,
    content: "# Implementation Plan\n\nPersist and approve the Plan Gate.\n",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PLAN-RECORDED",
      "2026-07-15T14:02:00Z",
    ),
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) {
    return;
  }
  assert.equal(prepared.event.type, "build_plan_changed");
  assert.equal(prepared.event.change, "recorded");
  assert.equal(prepared.appended, true);
  assert.deepEqual(prepared.plan.requirements, frozenContext.state.projection.intent);
  assert.deepEqual(
    prepared.plan.contextManifestIdentity,
    frozenContext.event.manifestIdentity,
  );
  fileSystem.files.set("docs/plan-context.md", "Drifted implementation context.\n");
  const repeatedPlan = await recordDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: frozenContext.state.projection.version,
    content: "# Implementation Plan\n\nPersist and approve the Plan Gate.\n",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PLAN-RECORDED",
      "2026-07-15T14:02:00Z",
    ),
  });
  assert.equal(repeatedPlan.ok, true);
  if (!repeatedPlan.ok) {
    return;
  }
  assert.equal(repeatedPlan.appended, false);
  assert.deepEqual(repeatedPlan.state, prepared.state);
  fileSystem.files.set("docs/plan-context.md", "Stable implementation context.\n");
  const conflictingPlanRetry = await recordDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: frozenContext.state.projection.version,
    content: "# Different Implementation Plan\n\nThis must not replace approved evidence.\n",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PLAN-RECORDED",
      "2026-07-15T14:02:00Z",
    ),
  });
  assert.equal(conflictingPlanRetry.ok, false);
  if (!conflictingPlanRetry.ok) {
    assert.equal(
      conflictingPlanRetry.diagnostics[0]?.code,
      "workflow.event.idempotency_conflict",
    );
  }
  const separatelyRecordedPlan = await recordDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: repeatedPlan.state.projection.version,
    content: "# Implementation Plan\n\nPersist and approve the Plan Gate.\n",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PLAN-RECORDED-AGAIN",
      "2026-07-15T14:02:00Z",
    ),
  });
  if (!separatelyRecordedPlan.ok) {
    assert.fail(
      separatelyRecordedPlan.diagnostics[0]?.message ?? "Plan record unexpectedly failed.",
    );
  }
  assert.equal(separatelyRecordedPlan.ok, true);
  assert.equal(separatelyRecordedPlan.appended, true);
  assert.equal(separatelyRecordedPlan.created, false);
  assert.equal(separatelyRecordedPlan.event.change, "recorded");
  assert.equal(separatelyRecordedPlan.plan.identity, prepared.plan.identity);

  const bypassed = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      separatelyRecordedPlan.state,
      "active",
      "implement",
      "BYPASS",
      "2026-07-15T14:03:00Z",
    ),
  });
  assert.equal(bypassed.ok, false);
  if (!bypassed.ok) {
    assert.equal(bypassed.diagnostics[0]?.code, "build_plan.approval_required");
  }

  const rejected = await decideDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: separatelyRecordedPlan.state.projection.version,
    decision: "rejected",
    planIdentity: prepared.plan.identity,
    contextManifestIdentity: prepared.plan.contextManifestIdentity,
    event: {
      ...taskLifecycleEventMetadata(
        TASK_FIXTURE,
        "PLAN-REJECTED",
        "2026-07-15T14:04:00Z",
      ),
      actor: { kind: "user", id: "reviewer-42", sessionRef: "approval-session" },
    },
  });
  assert.equal(rejected.ok, true);
  if (!rejected.ok) {
    return;
  }
  assert.equal(rejected.decision, "rejected");
  assert.equal(rejected.state.projection.phase, "plan");
  assert.equal(rejected.event.type, "build_plan_changed");
  assert.equal(rejected.event.change, "rejected");
  assert.equal(rejected.event.actor.id, "reviewer-42");
  assert.equal(rejected.appended, true);
  const repeatedRejection = await decideDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: separatelyRecordedPlan.state.projection.version,
    decision: "rejected",
    planIdentity: prepared.plan.identity,
    contextManifestIdentity: prepared.plan.contextManifestIdentity,
    event: {
      ...taskLifecycleEventMetadata(
        TASK_FIXTURE,
        "PLAN-REJECTED",
        "2026-07-15T14:04:00Z",
      ),
      actor: { kind: "user", id: "reviewer-42", sessionRef: "approval-session" },
    },
  });
  assert.equal(repeatedRejection.ok, true);
  if (!repeatedRejection.ok) {
    return;
  }
  assert.equal(repeatedRejection.appended, false);
  assert.deepEqual(repeatedRejection.state, rejected.state);
  const rejectedPlanApproval = await decideDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: repeatedRejection.state.projection.version,
    decision: "approved",
    planIdentity: prepared.plan.identity,
    contextManifestIdentity: prepared.plan.contextManifestIdentity,
    event: {
      ...taskLifecycleEventMetadata(
        TASK_FIXTURE,
        "PLAN-REJECTED-APPROVAL",
        "2026-07-15T14:04:30Z",
      ),
      actor: { kind: "user", id: "reviewer-42", sessionRef: "approval-session" },
    },
  });
  assert.equal(rejectedPlanApproval.ok, false);
  if (!rejectedPlanApproval.ok) {
    assert.equal(rejectedPlanApproval.diagnostics[0]?.code, "build_plan.rejected");
  }
  const rejectedPlanRerecord = await recordDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: repeatedRejection.state.projection.version,
    content: "# Implementation Plan\n\nPersist and approve the Plan Gate.\n",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PLAN-RECORDED-REJECTED",
      "2026-07-15T14:04:40Z",
    ),
  });
  assert.equal(rejectedPlanRerecord.ok, false);
  if (!rejectedPlanRerecord.ok) {
    assert.equal(
      rejectedPlanRerecord.diagnostics[0]?.code,
      "workflow.transition.illegal",
    );
  }
  const revisedPlan = await recordDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: repeatedRejection.state.projection.version,
    content: "# Revised Implementation Plan\n\nAddress the reviewer feedback before approval.\n",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PLAN-RECORDED-REVISED",
      "2026-07-15T14:04:45Z",
    ),
  });
  assert.equal(revisedPlan.ok, true);
  if (!revisedPlan.ok) {
    return;
  }
  const retriedOriginalPlanRecord = await recordDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: frozenContext.state.projection.version,
    content: "# Implementation Plan\n\nPersist and approve the Plan Gate.\n",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PLAN-RECORDED",
      "2026-07-15T14:02:00Z",
    ),
  });
  assert.equal(retriedOriginalPlanRecord.ok, true);
  if (!retriedOriginalPlanRecord.ok) {
    return;
  }
  assert.equal(retriedOriginalPlanRecord.appended, false);
  assert.deepEqual(retriedOriginalPlanRecord.state, revisedPlan.state);
  const retriedOriginalRejection = await decideDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: separatelyRecordedPlan.state.projection.version,
    decision: "rejected",
    planIdentity: prepared.plan.identity,
    contextManifestIdentity: prepared.plan.contextManifestIdentity,
    event: {
      ...taskLifecycleEventMetadata(
        TASK_FIXTURE,
        "PLAN-REJECTED",
        "2026-07-15T14:04:00Z",
      ),
      actor: { kind: "user", id: "reviewer-42", sessionRef: "approval-session" },
    },
  });
  assert.equal(retriedOriginalRejection.ok, true);
  if (!retriedOriginalRejection.ok) {
    return;
  }
  assert.equal(retriedOriginalRejection.appended, false);
  assert.deepEqual(retriedOriginalRejection.state, revisedPlan.state);
  const eventCountBeforeDrift = revisedPlan.state.events.length;

  fileSystem.files.set("docs/plan-context.md", "Drifted implementation context.\n");
  const staleApproval = await decideDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: revisedPlan.state.projection.version,
    decision: "approved",
    planIdentity: revisedPlan.plan.identity,
    contextManifestIdentity: revisedPlan.plan.contextManifestIdentity,
    event: {
      ...taskLifecycleEventMetadata(
        TASK_FIXTURE,
        "PLAN-STALE",
        "2026-07-15T14:05:00Z",
      ),
      actor: { kind: "user", id: "reviewer-42", sessionRef: "approval-session" },
    },
  });
  assert.equal(staleApproval.ok, false);
  if (!staleApproval.ok) {
    assert.equal(staleApproval.diagnostics[0]?.code, "build_plan.context_stale");
  }
  const planningAfterDrift = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(planningAfterDrift.ok, true);
  if (!planningAfterDrift.ok) {
    return;
  }
  assert.equal(planningAfterDrift.state.projection.phase, "plan");
  assert.equal(planningAfterDrift.state.events.length, eventCountBeforeDrift);
  fileSystem.files.set("docs/plan-context.md", "Stable implementation context.\n");

  const approved = await decideDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: planningAfterDrift.state.projection.version,
    decision: "approved",
    planIdentity: revisedPlan.plan.identity,
    contextManifestIdentity: revisedPlan.plan.contextManifestIdentity,
    event: {
      ...taskLifecycleEventMetadata(
        TASK_FIXTURE,
        "PLAN-APPROVED",
        "2026-07-15T14:06:00Z",
      ),
      actor: { kind: "user", id: "reviewer-42", sessionRef: "approval-session" },
    },
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) {
    return;
  }
  assert.equal(approved.decision, "approved");
  if (approved.decision !== "approved") {
    return;
  }
  assert.equal(approved.state.projection.phase, "implement");
  assert.equal(approved.event.type, "workflow_transitioned");
  assert.equal(approved.event.actor.id, "reviewer-42");
  assert.deepEqual(approved.event.gates, [
    {
      gate: "plan",
      evidence: [
        {
          kind: "human-approval",
          reference: `plans/${revisedPlan.plan.identity.slice("sha256:".length)}.json`,
        },
        {
          kind: "human-approval",
          reference: `${revisedPlan.plan.contextManifestPath}#${revisedPlan.plan.contextManifestIdentity}`,
        },
      ],
    },
  ]);
  fileSystem.files.set("docs/plan-context.md", "Drifted after approval.\n");
  const repeatedApproval = await decideDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: planningAfterDrift.state.projection.version,
    decision: "approved",
    planIdentity: revisedPlan.plan.identity,
    contextManifestIdentity: revisedPlan.plan.contextManifestIdentity,
    event: {
      ...taskLifecycleEventMetadata(
        TASK_FIXTURE,
        "PLAN-APPROVED",
        "2026-07-15T14:06:00Z",
      ),
      actor: { kind: "user", id: "reviewer-42", sessionRef: "approval-session" },
    },
  });
  assert.equal(repeatedApproval.ok, true);
  if (!repeatedApproval.ok) {
    return;
  }
  assert.equal(repeatedApproval.appended, false);
  assert.deepEqual(repeatedApproval.state, approved.state);
  const staleAdvance = await advanceDurableTask({
    fileSystem,
    transition: {
      ...taskLifecycleTransition(
        TASK_FIXTURE,
        repeatedApproval.state,
        "active",
        "review",
        "CONTEXT-DRIFT-STALE-REVIEW",
        "2026-07-15T14:06:15Z",
      ),
      expectedVersion: repeatedApproval.state.projection.version - 1,
    },
  });
  assert.equal(staleAdvance.ok, false);
  if (!staleAdvance.ok) {
    assert.equal(staleAdvance.diagnostics[0]?.code, "workflow.version.stale");
  }
  const beforeReseal = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(beforeReseal.ok, true);
  if (!beforeReseal.ok) {
    return;
  }
  assert.equal(beforeReseal.state.projection.phase, "implement");
  assert.equal(
    beforeReseal.state.projection.version,
    repeatedApproval.state.projection.version,
  );
  const driftedAdvance = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      repeatedApproval.state,
      "active",
      "review",
      "CONTEXT-DRIFT-REVIEW",
      "2026-07-15T14:06:30Z",
    ),
  });
  assert.equal(driftedAdvance.ok, false);
  if (!driftedAdvance.ok) {
    assert.equal(driftedAdvance.diagnostics[0]?.code, "build_plan.context_stale");
  }

  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  assert.equal(recovered.state.projection.phase, "plan");
  const refreshedContext = await refreshDurableContextManifest({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: recovered.state.projection.version,
    phase: "implement",
    acceptRequiredApprovedSpecChanges: false,
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "CONTEXT-REFRESH-AFTER-APPROVAL",
      "2026-07-15T14:07:00Z",
    ),
  });
  if (!refreshedContext.ok) {
    assert.fail(
      refreshedContext.diagnostics[0]?.message ?? "Context refresh unexpectedly failed.",
    );
  }
  assert.equal(refreshedContext.ok, true);
  assert.equal(refreshedContext.state.projection.phase, "plan");
  const resealed = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(resealed.ok, true);
  if (!resealed.ok) {
    return;
  }
  assert.equal(resealed.state.projection.phase, "plan");
});

test("a superseded Build Plan cannot be rejected", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const created = await createDurableTask({ fileSystem, start: startRequest() });
  if (!created.ok) {
    assert.fail(created.diagnostics[0]?.message ?? "Task creation failed");
  }
  const explored = await advanceDurableTask({
    fileSystem,
    transition: exploreTransition(created.state.projection.version),
  });
  if (!explored.ok) {
    assert.fail(explored.diagnostics[0]?.message ?? "Explore transition failed");
  }
  const planned = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      explored.state,
      "active",
      "plan",
      "SUPERSEDED-PLAN",
      "2026-07-15T14:08:00Z",
    ),
  });
  if (!planned.ok) {
    assert.fail(planned.diagnostics[0]?.message ?? "Plan transition failed");
  }
  const frozen = await freezeDurableContextManifest({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: planned.state.projection.version,
    phase: "implement",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "SUPERSEDED-CONTEXT",
      "2026-07-15T14:08:30Z",
    ),
  });
  if (!frozen.ok) {
    assert.fail(frozen.diagnostics[0]?.message ?? "Context freeze failed");
  }
  const original = await recordDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: frozen.state.projection.version,
    content: "# Original Plan\n\nReview the first approach.\n",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "SUPERSEDED-ORIGINAL",
      "2026-07-15T14:09:00Z",
    ),
  });
  if (!original.ok) {
    assert.fail(original.diagnostics[0]?.message ?? "Original Plan record failed");
  }
  const revised = await recordDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: original.state.projection.version,
    content: "# Revised Plan\n\nReview the revised approach.\n",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "SUPERSEDED-REVISED",
      "2026-07-15T14:09:30Z",
    ),
  });
  if (!revised.ok) {
    assert.fail(revised.diagnostics[0]?.message ?? "Revised Plan record failed");
  }
  const rejection = await decideDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: revised.state.projection.version,
    decision: "rejected",
    planIdentity: original.plan.identity,
    contextManifestIdentity: original.plan.contextManifestIdentity,
    event: {
      ...taskLifecycleEventMetadata(
        TASK_FIXTURE,
        "SUPERSEDED-REJECTION",
        "2026-07-15T14:10:00Z",
      ),
      actor: { kind: "user", id: "reviewer-42", sessionRef: "approval-session" },
    },
  });
  assert.equal(rejection.ok, false);
  if (!rejection.ok) {
    assert.equal(rejection.diagnostics[0]?.code, "build_plan.rejected");
  }
  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (recovered.ok) {
    assert.deepEqual(recovered.state, revised.state);
  }
});

const PHASE_CONTEXT_SOURCE = "docs/phase-context.md";
const PHASE_CONTEXT_CONTENT = "Stable implementation context.\n";


test("Build resume returns an accepted Agent result without dispatching it again", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const prepared = await dispatchApprovedBuildPhase(fileSystem, "DISPATCH-20-RESULT");

  const resumed = await coreContract.resumeDurablePhaseExecution({
    fileSystem,
    taskId: TASK_ID,
    materials: prepared.materials,
    blockEvent: resumeBlockEvent("READY", "2026-07-17T10:01:45Z"),
  });
  assert.equal(resumed.ok, true);
  if (!resumed.ok) {
    return;
  }
  assert.equal(resumed.status, "ready");
  assert.equal(resumed.plan.identity, prepared.planIdentity);
  assert.equal(resumed.binding.dispatchId, prepared.execution.dispatch.dispatchId);

  const result = {
    schemaVersion: 1,
    dispatchId: prepared.execution.dispatch.dispatchId,
    taskId: TASK_ID,
    expectedTaskVersion: prepared.execution.dispatch.expectedTaskVersion,
    phase: "implement",
    agentRole: "implementation",
    contextManifestIdentity: prepared.execution.dispatch.contextManifestIdentity,
    agentContractIdentity: prepared.execution.dispatch.agentContractIdentity,
    baseFingerprint: prepared.execution.dispatch.baseFingerprint,
    outcome: "succeeded",
    artifacts: ["artifacts/implementation.md"],
    evidence: ["evidence/implementation.json"],
    findings: [],
    observedFinalFingerprint: prepared.execution.dispatch.baseFingerprint,
  } as const;
  const accepted = await coreContract.recordDurablePhaseExecutionResult({
    fileSystem,
    taskId: TASK_ID,
    result,
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PHASE-RESULT-ACCEPTED",
      "2026-07-17T10:02:00Z",
    ),
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) {
    return;
  }

  const completed = await coreContract.resumeDurablePhaseExecution({
    fileSystem,
    taskId: TASK_ID,
    materials: prepared.materials,
    blockEvent: resumeBlockEvent("COMPLETED", "2026-07-17T10:02:15Z"),
  });
  assert.equal(completed.ok, true);
  if (!completed.ok) {
    return;
  }
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.result, result);
  assert.equal(completed.state.events.length, accepted.state.events.length);

  const drifted = await coreContract.resumeDurablePhaseExecution({
    fileSystem,
    taskId: TASK_ID,
    materials: {
      ...prepared.materials,
      currentContext: [
        {
          ...prepared.materials.currentContext[0]!,
          content: "Drifted completed context.\n",
        },
      ],
    },
    blockEvent: resumeBlockEvent("DRIFTED", "2026-07-17T10:02:30Z"),
  });
  assert.equal(drifted.ok, true);
  if (!drifted.ok) {
    return;
  }
  assert.equal(drifted.status, "blocked");
  assert.equal(drifted.reviewRequired, true);
  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  assert.equal(recovered.state.projection.lifecycle, "blocked");
  assert.equal(recovered.state.projection.phase, "implement");
  assert.equal(recovered.state.projection.blockers.length, 1);
});

test("Build resume rejects modified approved Plan evidence", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const prepared = await dispatchApprovedBuildPhase(fileSystem, "DISPATCH-20-PLAN");
  const planPath = `${TASK_DIRECTORY}/plans/${prepared.planIdentity.slice("sha256:".length)}.json`;
  fileSystem.files.set(planPath, "{}\n");

  const resumed = await coreContract.resumeDurablePhaseExecution({
    fileSystem,
    taskId: TASK_ID,
    materials: prepared.materials,
    blockEvent: resumeBlockEvent("PLAN", "2026-07-17T10:02:45Z"),
  });
  assert.equal(resumed.ok, true);
  if (resumed.ok) {
    assert.equal(resumed.status, "blocked");
    assert.equal(resumed.diagnostics[0]?.code, "build_plan.invalid");
    assert.equal(resumed.reviewRequired, true);
  }
});

test("Build dispatch rejects a mismatched Plan Manifest outside Implement", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const prepared = await dispatchApprovedBuildPhase(fileSystem, "DISPATCH-20-REVIEW");
  await recordSucceededImplementation(
    fileSystem,
    prepared.execution,
    "PHASE-REVIEW-IMPLEMENTED",
    "2026-07-17T10:01:45Z",
  );
  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  const reviewed = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      recovered.state,
      "active",
      "review",
      "PHASE-REVIEW",
      "2026-07-17T10:02:00Z",
    ),
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }

  const reviewAgentContract = {
    schemaVersion: 1,
    role: "standards-review",
    runtimeName: "sayhi-v1-standards-review",
    contractVersion: 1,
    tools: [],
    network: "none",
    skills: [],
    spawns: [],
    repositoryAccess: "read-only",
    outputSchema: "schemas/agent/standards-review-output.json",
    promptBaseIdentity: `sha256:${"b".repeat(64)}`,
    overridePolicy: "prompt-body-only",
  } as const;
  const dispatched = await coreContract.dispatchDurablePhaseExecution({
    fileSystem,
    planIdentity: prepared.planIdentity,
    execution: {
      contractVersion: 1,
      dispatch: {
        schemaVersion: 1,
        dispatchId: "DISPATCH-20-REVIEW-MISMATCH",
        taskId: TASK_ID,
        expectedTaskVersion: reviewed.state.projection.version,
        phase: "review",
        agentRole: "standards-review",
        baseFingerprint: `sha256:${"e".repeat(64)}`,
        requestedAt: "2026-07-17T10:02:15Z",
        contextManifestIdentity:
          "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        agentContractIdentity:
          "sha256:21a8ae092397c5873d98bcb0f0cf6fd080f62a83096bc7aa35b4185829c0784b",
      },
      manifest: [],
      currentContext: [],
      agentContract: reviewAgentContract,
      skills: [],
    },
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PHASE-REVIEW-DISPATCHED",
      "2026-07-17T10:02:30Z",
    ),
  });
  assert.deepEqual(dispatched, {
    ok: false,
    contractVersion: 1,
    diagnostics: [
      {
        code: "build_plan.invalid",
        path: "$.execution.dispatch.contextManifestIdentity",
        message: "Phase Context Manifest does not match the approved Build Plan.",
        remediation:
          "Restore the frozen Plan Manifest or record and approve a new Build Plan before dispatch.",
      },
    ],
  });
});

test("Build dispatch rejects an Agent for a different active Phase", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const prepared = await dispatchApprovedBuildPhase(fileSystem, "DISPATCH-20-CROSS-PHASE");
  await recordSucceededImplementation(
    fileSystem,
    prepared.execution,
    "PHASE-CROSS-PHASE-IMPLEMENTED",
    "2026-07-17T10:01:45Z",
  );
  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  const reviewed = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      recovered.state,
      "active",
      "review",
      "PHASE-CROSS-PHASE-REVIEW",
      "2026-07-17T10:02:00Z",
    ),
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }

  const dispatched = await coreContract.dispatchDurablePhaseExecution({
    fileSystem,
    planIdentity: prepared.planIdentity,
    execution: {
      ...prepared.execution,
      dispatch: {
        ...prepared.execution.dispatch,
        dispatchId: "DISPATCH-20-IMPLEMENT-DURING-REVIEW",
        expectedTaskVersion: reviewed.state.projection.version,
        requestedAt: "2026-07-17T10:02:15Z",
      },
    },
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PHASE-CROSS-PHASE-DISPATCHED",
      "2026-07-17T10:02:30Z",
    ),
  });
  assert.deepEqual(dispatched, {
    ok: false,
    contractVersion: 1,
    diagnostics: [
      {
        code: "phase_execution.phase.invalid",
        path: "$.execution.dispatch.phase",
        message: "Phase execution dispatch does not match the active Workflow Phase.",
        remediation: "Dispatch the review Phase Agent for the current Build position.",
      },
    ],
  });
});

test("Build requires a fresh dispatch after returning to an earlier Phase", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const prepared = await dispatchApprovedBuildPhase(fileSystem, "DISPATCH-20-REPAIR");
  const result = {
    schemaVersion: 1,
    dispatchId: prepared.execution.dispatch.dispatchId,
    taskId: TASK_ID,
    expectedTaskVersion: prepared.execution.dispatch.expectedTaskVersion,
    phase: "implement",
    agentRole: "implementation",
    contextManifestIdentity: prepared.execution.dispatch.contextManifestIdentity,
    agentContractIdentity: prepared.execution.dispatch.agentContractIdentity,
    baseFingerprint: prepared.execution.dispatch.baseFingerprint,
    outcome: "succeeded",
    artifacts: ["artifacts/implementation.md"],
    evidence: ["evidence/implementation.json"],
    findings: [],
    observedFinalFingerprint: prepared.execution.dispatch.baseFingerprint,
  } as const;
  const accepted = await coreContract.recordDurablePhaseExecutionResult({
    fileSystem,
    taskId: TASK_ID,
    result,
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PHASE-REPAIR-RESULT",
      "2026-07-17T10:02:00Z",
    ),
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) {
    return;
  }
  const reviewed = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      accepted.state,
      "active",
      "review",
      "PHASE-REPAIR-REVIEW",
      "2026-07-17T10:02:15Z",
    ),
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }
  let reviewState = await recordReviewResult(
    fileSystem,
    prepared,
    reviewed.state,
    "standards-review",
    "blocked",
    [
      {
        id: "FINDING-FRESH-DISPATCH-STANDARDS",
        severity: "blocking",
        subject: "approved-spec",
        reference: "docs/spec/workflow.md#5.5",
        message: "The reviewed implementation needs repair.",
        remediation: "Apply the repair before dispatching a new Implement Agent.",
      },
    ],
    "PHASE-REPAIR-STANDARDS",
    "2026-07-17T10:02:20Z",
  );
  reviewState = await recordReviewResult(
    fileSystem,
    prepared,
    reviewState,
    "spec-review",
    "blocked",
    [
      {
        id: "FINDING-FRESH-DISPATCH-SPEC",
        severity: "blocking",
        subject: "acceptance-criterion",
        reference: TASK_FIXTURE.acceptanceCriterion,
        message: "The accepted result omits required behavior.",
        remediation: "Repair the missing behavior before a new dispatch.",
      },
    ],
    "PHASE-REPAIR-SPEC",
    "2026-07-17T10:02:25Z",
  );
  const repaired = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      reviewState,
      "active",
      "implement",
      "PHASE-REPAIR-IMPLEMENT",
      "2026-07-17T10:02:30Z",
    ),
  });
  assert.equal(repaired.ok, true);
  if (!repaired.ok) {
    return;
  }

  const resumed = await coreContract.resumeDurablePhaseExecution({
    fileSystem,
    taskId: TASK_ID,
    materials: prepared.materials,
    blockEvent: resumeBlockEvent("REPAIR", "2026-07-17T10:02:45Z"),
  });
  assert.equal(resumed.ok, false);
  if (!resumed.ok) {
    assert.equal(resumed.diagnostics[0]?.code, "phase_execution.missing");
  }

  const stale = await coreContract.recordDurablePhaseExecutionResult({
    fileSystem,
    taskId: TASK_ID,
    result,
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PHASE-REPAIR-STALE-RESULT",
      "2026-07-17T10:02:45Z",
    ),
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.diagnostics[0]?.code, "phase_execution.result.invalid");
  }

  const fresh = await coreContract.dispatchDurablePhaseExecution({
    fileSystem,
    planIdentity: prepared.planIdentity,
    execution: {
      ...prepared.execution,
      dispatch: {
        ...prepared.execution.dispatch,
        expectedTaskVersion: repaired.state.projection.version,
        requestedAt: "2026-07-17T10:03:00Z",
      },
    },
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PHASE-REPAIR-FRESH-DISPATCH",
      "2026-07-17T10:03:15Z",
    ),
  });
  assert.equal(fresh.ok, true);
  if (!fresh.ok) {
    return;
  }
  const restarted = await coreContract.resumeDurablePhaseExecution({
    fileSystem,
    taskId: TASK_ID,
    materials: prepared.materials,
    blockEvent: resumeBlockEvent("RESTARTED", "2026-07-17T10:03:30Z"),
  });
  assert.equal(restarted.ok, true);
  if (restarted.ok) {
    assert.equal(restarted.status, "ready");
    assert.equal(restarted.binding.dispatchId, prepared.execution.dispatch.dispatchId);
  }
});

test("Build resume blocks Context, Capability, and Skill identity drift", async () => {
  const cases = [
    {
      name: "Context Manifest content drift",
      mutate: (materials: PhaseExecutionMaterials) => ({
        ...materials,
        currentContext: [{ ...materials.currentContext[0]!, content: "Drifted context.\n" }],
      }),
      code: "execution.context_stale",
    },
    {
      name: "Capability expansion",
      mutate: (materials: PhaseExecutionMaterials) => ({
        ...materials,
        agentContract: {
          ...materials.agentContract,
          tools: [...materials.agentContract.tools, "write"],
        },
      }),
      code: "execution.agent_invalid",
    },
    {
      name: "Skill replacement",
      mutate: (materials: PhaseExecutionMaterials) => ({
        ...materials,
        skills: materials.skills.map((skill, index) =>
          index === 0 ? { ...skill, content: "replaced implement skill\n" } : skill,
        ),
      }),
      code: "execution.skill_invalid",
    },
  ] as const;

  for (const driftCase of cases) {
    const fileSystem = new MemoryTaskLifecycleFileSystem();
    const prepared = await dispatchApprovedBuildPhase(
      fileSystem,
      `DISPATCH-20-${driftCase.name.replaceAll(" ", "-")}`,
    );
    const resumed = await coreContract.resumeDurablePhaseExecution({
      fileSystem,
      taskId: TASK_ID,
      materials: driftCase.mutate(prepared.materials),
      blockEvent: resumeBlockEvent(
        `DRIFT-${driftCase.name.replaceAll(" ", "-")}`,
        "2026-07-17T10:02:30Z",
      ),
    });
    assert.equal(resumed.ok, true, driftCase.name);
    if (resumed.ok) {
      assert.equal(resumed.status, "blocked", driftCase.name);
      assert.equal(resumed.diagnostics[0]?.code, driftCase.code);
      assert.equal(resumed.reviewRequired, true);
    }
  }
});
test("Build cannot enter Review before an accepted Implementation result", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  await dispatchApprovedBuildPhase(fileSystem, "DISPATCH-21-IMPLEMENT-GATE");
  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }

  const rejected = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      recovered.state,
      "active",
      "review",
      "IMPLEMENT-RESULT-REQUIRED",
      "2026-07-17T10:04:00Z",
    ),
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.diagnostics[0]?.code, "workflow.transition.illegal");
  }
});
test("Build cannot finish Review before both review axes accept it", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const prepared = await dispatchApprovedBuildPhase(
    fileSystem,
    "DISPATCH-21-REVIEW-GATE",
  );
  await recordSucceededImplementation(
    fileSystem,
    prepared.execution,
    "REVIEW-GATE-IMPLEMENTED",
    "2026-07-17T10:04:15Z",
  );
  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  const reviewed = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      recovered.state,
      "active",
      "review",
      "REVIEW-GATE-ENTERED",
      "2026-07-17T10:04:30Z",
    ),
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }

  const rejected = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      reviewed.state,
      "active",
      "finish",
      "REVIEW-RESULTS-REQUIRED",
      "2026-07-17T10:04:45Z",
    ),
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.diagnostics[0]?.code, "workflow.transition.illegal");
  }
});
test("Build enters Repair only for blocking Review findings", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const prepared = await dispatchApprovedBuildPhase(
    fileSystem,
    "DISPATCH-21-REPAIR-GATE",
  );
  await recordSucceededImplementation(
    fileSystem,
    prepared.execution,
    "REPAIR-GATE-IMPLEMENTED",
    "2026-07-17T10:05:00Z",
  );
  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  const reviewed = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      recovered.state,
      "active",
      "review",
      "REPAIR-GATE-ENTERED",
      "2026-07-17T10:05:15Z",
    ),
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }
  let state = await recordReviewResult(
    fileSystem,
    prepared,
    reviewed.state,
    "standards-review",
    "succeeded",
    [],
    "REPAIR-GATE-STANDARDS",
    "2026-07-17T10:05:30Z",
  );
  state = await recordReviewResult(
    fileSystem,
    prepared,
    state,
    "spec-review",
    "succeeded",
    [],
    "REPAIR-GATE-SPEC",
    "2026-07-17T10:05:45Z",
  );

  const rejected = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      state,
      "active",
      "implement",
      "REPAIR-GATE-WITHOUT-FINDING",
      "2026-07-17T10:06:00Z",
    ),
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.diagnostics[0]?.code, "workflow.transition.illegal");
  }
  state = await recordReviewResult(
    fileSystem,
    prepared,
    state,
    "standards-review",
    "blocked",
    [
      {
        id: "FINDING-21-STANDARDS",
        severity: "blocking",
        subject: "approved-spec",
        reference: "docs/spec/workflow.md#5.5",
        message: "The change violates an Approved Spec requirement.",
        remediation: "Repair the violation and rerun both review axes.",
      },
    ],
    "REPAIR-GATE-STANDARDS-BLOCKED",
    "2026-07-17T10:06:15Z",
  );
  state = await recordReviewResult(
    fileSystem,
    prepared,
    state,
    "spec-review",
    "blocked",
    [
      {
        id: "FINDING-21-SPEC",
        severity: "blocking",
        subject: "acceptance-criterion",
        reference: TASK_FIXTURE.acceptanceCriterion,
        message: "The change omits required recovery behavior.",
        remediation: "Implement recovery and rerun both review axes.",
      },
    ],
    "REPAIR-GATE-SPEC-BLOCKED",
    "2026-07-17T10:06:30Z",
  );
  const repaired = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      state,
      "active",
      "implement",
      "REPAIR-GATE-BLOCKING",
      "2026-07-17T10:06:45Z",
    ),
  });
  assert.equal(repaired.ok, true);
  if (!repaired.ok) {
    return;
  }
  assert.equal(repaired.state.projection.phase, "implement");
  const missingImplementation = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      repaired.state,
      "active",
      "review",
      "REPAIR-GATE-FRESH-IMPLEMENTATION-REQUIRED",
      "2026-07-17T10:07:00Z",
    ),
  });
  assert.equal(missingImplementation.ok, false);
  if (!missingImplementation.ok) {
    assert.equal(
      missingImplementation.diagnostics[0]?.code,
      "workflow.transition.illegal",
    );
  }
});




test("Build Review dispatch requires the Implementation final fingerprint", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const prepared = await dispatchApprovedBuildPhase(
    fileSystem,
    "DISPATCH-21-REVIEW-FINGERPRINT",
  );
  await recordSucceededImplementation(
    fileSystem,
    prepared.execution,
    "REVIEW-FINGERPRINT-IMPLEMENTED",
    "2026-07-17T10:07:15Z",
  );
  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  const reviewed = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      recovered.state,
      "active",
      "review",
      "REVIEW-FINGERPRINT-ENTERED",
      "2026-07-17T10:07:30Z",
    ),
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }
  const reviewAgent = REVIEW_AGENTS[0];
  const dispatched = await coreContract.dispatchDurablePhaseExecution({
    fileSystem,
    planIdentity: prepared.planIdentity,
    execution: {
      ...prepared.execution,
      dispatch: {
        ...prepared.execution.dispatch,
        dispatchId: "DISPATCH-21-REVIEW-FINGERPRINT-MISMATCH",
        expectedTaskVersion: reviewed.state.projection.version,
        phase: "review",
        agentRole: reviewAgent.role,
        baseFingerprint: `sha256:${"e".repeat(64)}`,
        requestedAt: "2026-07-17T10:07:45Z",
        agentContractIdentity: reviewAgent.contractIdentity,
      },
      agentContract: reviewAgent.contract,
      skills: [],
    },
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "REVIEW-FINGERPRINT-DISPATCHED",
      "2026-07-17T10:08:00Z",
    ),
  });
  assert.equal(dispatched.ok, false);
  if (!dispatched.ok) {
    assert.equal(dispatched.diagnostics[0]?.code, "workflow.transition.illegal");
    assert.equal(
      dispatched.diagnostics[0]?.path,
      "$.binding.baseFingerprint",
    );
  }
});

test("Build blocks when configured Review repair attempts are exhausted", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const prepared = await dispatchApprovedBuildPhase(
    fileSystem,
    "DISPATCH-21-REPAIR-EXHAUSTED",
    0,
  );
  await recordSucceededImplementation(
    fileSystem,
    prepared.execution,
    "REPAIR-EXHAUSTED-IMPLEMENTED",
    "2026-07-17T10:08:15Z",
  );
  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  const reviewed = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      recovered.state,
      "active",
      "review",
      "REPAIR-EXHAUSTED-ENTERED",
      "2026-07-17T10:08:30Z",
    ),
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }
  let state = await recordReviewResult(
    fileSystem,
    prepared,
    reviewed.state,
    "standards-review",
    "blocked",
    [
      {
        id: "FINDING-21-EXHAUSTED-STANDARDS",
        severity: "blocking",
        subject: "approved-spec",
        reference: "docs/spec/workflow.md#5.5",
        message: "The Build still violates the Approved Spec.",
        remediation: "Repair the violation before retrying Review.",
      },
    ],
    "REPAIR-EXHAUSTED-STANDARDS",
    "2026-07-17T10:08:45Z",
  );
  state = await recordReviewResult(
    fileSystem,
    prepared,
    state,
    "spec-review",
    "blocked",
    [
      {
        id: "FINDING-21-EXHAUSTED-SPEC",
        severity: "blocking",
        subject: "acceptance-criterion",
        reference: TASK_FIXTURE.acceptanceCriterion,
        message: "The Build misses required recovery behavior.",
        remediation: "Repair the behavior before retrying Review.",
      },
    ],
    "REPAIR-EXHAUSTED-SPEC",
    "2026-07-17T10:09:00Z",
  );
  const exhausted = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      state,
      "active",
      "implement",
      "REPAIR-EXHAUSTED-BLOCKED",
      "2026-07-17T10:09:15Z",
    ),
  });
  assert.equal(exhausted.ok, true);
  if (!exhausted.ok) {
    return;
  }
  assert.equal(exhausted.state.projection.lifecycle, "blocked");
  assert.equal(exhausted.state.projection.phase, "review");
  assert.deepEqual(exhausted.state.projection.blockers, [
    "Configured Review repair attempts are exhausted.",
  ]);
  assert.equal(exhausted.event.type, "workflow_transitioned");
  assert.deepEqual(exhausted.event.gates, [
    {
      gate: "block",
      evidence: [
        { kind: "workflow", reference: `events/${state.events.at(-1)!.eventId}` },
      ],
    },
  ]);
});

test("durable Build rejects a mismatched Review result before appending it", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const prepared = await dispatchApprovedBuildPhase(
    fileSystem,
    "DISPATCH-21-REVIEW-INVALID-EVIDENCE",
  );
  await recordSucceededImplementation(
    fileSystem,
    prepared.execution,
    "REVIEW-INVALID-EVIDENCE-IMPLEMENTED",
    "2026-07-17T10:09:30Z",
  );
  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  const reviewed = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      recovered.state,
      "active",
      "review",
      "REVIEW-INVALID-EVIDENCE-ENTERED",
      "2026-07-17T10:09:45Z",
    ),
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }
  const state = await recordReviewResult(
    fileSystem,
    prepared,
    reviewed.state,
    "standards-review",
    "blocked",
    [
      {
        id: "FINDING-21-INVALID-EVIDENCE-STANDARDS",
        severity: "blocking",
        subject: "approved-spec",
        reference: "docs/spec/workflow.md#5.5",
        message: "The Build still violates the Approved Spec.",
        remediation: "Repair the violation before retrying Review.",
      },
    ],
    "REVIEW-INVALID-EVIDENCE-STANDARDS",
    "2026-07-17T10:10:00Z",
  );
  await assert.rejects(
    recordReviewResult(
      fileSystem,
      prepared,
      state,
      "spec-review",
      "blocked",
      [
        {
          id: "FINDING-21-INVALID-EVIDENCE-SPEC",
          severity: "blocking",
          subject: "acceptance-criterion",
          reference: TASK_FIXTURE.acceptanceCriterion,
          message: "The Build misses required recovery behavior.",
          remediation: "Repair the behavior before retrying Review.",
        },
      ],
      "REVIEW-INVALID-EVIDENCE-SPEC",
      "2026-07-17T10:10:15Z",
      `sha256:${"e".repeat(64)}`,
    ),
    /Build Review results must assess the same frozen Implementation fingerprint/,
  );
  const after = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(after.ok, true);
  if (after.ok) {
    assert.equal(after.state.projection.lifecycle, "active");
    assert.equal(after.state.projection.phase, "review");
    assert.equal(after.state.events.length, state.events.length + 1);
    assert.equal(after.state.events.at(-1)?.type, "phase_execution_dispatched");
  }
});

test("Bound Writer blocks invalid capability material with a deterministic Event id", async () => {
  const fileSystem = new MemoryTaskLifecycleFileSystem();
  const prepared = await dispatchApprovedBuildPhase(
    fileSystem,
    "DISPATCH-21-BOUND-WRITER",
  );
  const before = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(before.ok, true);
  if (!before.ok) {
    return;
  }
  let entered = false;
  const blocked = await coreContract.withBoundDurableTaskWriter({
    fileSystem: fileSystem as unknown as Parameters<
      typeof coreContract.withBoundDurableTaskWriter
    >[0]["fileSystem"],
    taskId: TASK_ID,
    materials: {
      ...prepared.materials,
      agentContract: {
        ...prepared.materials.agentContract,
        tools: [...prepared.materials.agentContract.tools, "validate"],
      },
    },
    operation: async () => {
      entered = true;
    },
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.diagnostics[0]?.code, "execution.agent_invalid");
  }
  assert.equal(entered, false);
  const recovered = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  assert.ok(
    recovered.state.events.some(
      (event) =>
        event.eventId ===
        `EVENT-BOUND-WRITER-${TASK_ID}-${before.state.projection.version}`,
    ),
  );
});

async function recordSucceededImplementation(
  fileSystem: MemoryTaskLifecycleFileSystem,
  execution: BindPhaseExecutionRequest,
  suffix: string,
  occurredAt: string,
): Promise<void> {
  const accepted = await coreContract.recordDurablePhaseExecutionResult({
    fileSystem,
    taskId: TASK_ID,
    result: {
      schemaVersion: 1,
      dispatchId: execution.dispatch.dispatchId,
      taskId: TASK_ID,
      expectedTaskVersion: execution.dispatch.expectedTaskVersion,
      phase: "implement",
      agentRole: "implementation",
      contextManifestIdentity: execution.dispatch.contextManifestIdentity,
      agentContractIdentity: execution.dispatch.agentContractIdentity,
      baseFingerprint: execution.dispatch.baseFingerprint,
      outcome: "succeeded",
      artifacts: ["artifacts/implementation.md"],
      evidence: ["evidence/implementation.json"],
      findings: [],
      observedFinalFingerprint: execution.dispatch.baseFingerprint,
    },
    event: taskLifecycleEventMetadata(TASK_FIXTURE, suffix, occurredAt),
  });
  if (!accepted.ok) {
    assert.fail(accepted.diagnostics[0]?.message ?? "Implementation result failed");
  }
}
async function recordReviewResult(
  fileSystem: MemoryTaskLifecycleFileSystem,
  prepared: Readonly<{
    planIdentity: ContractIdentity;
    execution: BindPhaseExecutionRequest;
  }>,
  state: WorkflowState,
  role: "standards-review" | "spec-review",
  outcome: "succeeded" | "failed" | "blocked",
  findings: readonly ReviewFinding[],
  suffix: string,
  occurredAt: string,
  observedFinalFingerprint?: ContractIdentity,
): Promise<WorkflowState> {
  const reviewAgent = REVIEW_AGENTS.find((agent) => agent.role === role);
  assert.ok(reviewAgent, `Missing Review Agent fixture for ${role}`);
  return recordTestPhaseResult({
    fileSystem,
    fixture: TASK_FIXTURE,
    planIdentity: prepared.planIdentity,
    contextManifestIdentity: prepared.execution.dispatch.contextManifestIdentity,
    state,
    phase: "review",
    agent: reviewAgent,
    materials: {
      manifest: prepared.execution.manifest,
      currentContext: prepared.execution.currentContext,
    },
    outcome,
    reviewFindings: findings,
    ...(observedFinalFingerprint === undefined
      ? {}
      : { observedFinalFingerprint }),
    suffix,
    occurredAt,
  });
}


async function dispatchApprovedBuildPhase(
  fileSystem: MemoryTaskLifecycleFileSystem,
  dispatchId: string,
  maxRepairAttempts = 2,
) {
  const created = await createDurableTask({
    fileSystem,
    start: startRequest(maxRepairAttempts),
  });
  if (!created.ok) {
    assert.fail(created.diagnostics[0]?.message ?? "Task creation failed");
  }
  const explored = await advanceDurableTask({
    fileSystem,
    transition: exploreTransition(created.state.projection.version),
  });
  if (!explored.ok) {
    assert.fail(explored.diagnostics[0]?.message ?? "Explore transition failed");
  }
  const planned = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      explored.state,
      "active",
      "plan",
      "PHASE-PLAN",
      "2026-07-17T10:00:00Z",
    ),
  });
  if (!planned.ok) {
    assert.fail(planned.diagnostics[0]?.message ?? "Plan transition failed");
  }
  fileSystem.files.set(PHASE_CONTEXT_SOURCE, PHASE_CONTEXT_CONTENT);
  const added = await addDurableContextManifestEntry({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: planned.state.projection.version,
    phase: "implement",
    source: PHASE_CONTEXT_SOURCE,
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PHASE-CONTEXT-ADDED",

      "2026-07-17T10:00:15Z",
    ),
  });
  if (!added.ok) {
    assert.fail(added.diagnostics[0]?.message ?? "Context entry failed");
  }
  const frozen = await freezeDurableContextManifest({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: added.state.projection.version,
    phase: "implement",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PHASE-CONTEXT-FROZEN",
      "2026-07-17T10:00:30Z",
    ),
  });
  if (!frozen.ok) {
    assert.fail(frozen.diagnostics[0]?.message ?? "Context freeze failed");
  }
  const recorded = await recordDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: frozen.state.projection.version,
    content: "# Phase execution plan\n\nPersist the execution identity.\n",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PHASE-PLAN-RECORDED",
      "2026-07-17T10:00:45Z",
    ),
  });
  if (!recorded.ok) {
    assert.fail(recorded.diagnostics[0]?.message ?? "Build Plan record failed");
  }
  const approved = await decideDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: recorded.state.projection.version,
    decision: "approved",
    planIdentity: recorded.plan.identity,
    contextManifestIdentity: recorded.plan.contextManifestIdentity,
    event: {
      ...taskLifecycleEventMetadata(
        TASK_FIXTURE,
        "PHASE-PLAN-APPROVED",
        "2026-07-17T10:01:00Z",
      ),
      actor: { kind: "user", id: "reviewer-20", sessionRef: "approval-20" },
    },
  });
  if (!approved.ok || approved.decision !== "approved") {
    assert.fail("Build Plan approval failed");
  }
  const manifest = await coreContract.inspectDurableContextManifest({
    fileSystem,
    taskId: TASK_ID,
    phase: "implement",
  });
  if (!manifest.ok || manifest.state !== "valid") {
    assert.fail("Implement Context Manifest was not valid");
  }
  const execution = {
    contractVersion: 1,
    dispatch: {
      schemaVersion: 1,
      dispatchId,
      taskId: TASK_ID,
      expectedTaskVersion: approved.state.projection.version,
      phase: "implement",
      agentRole: "implementation",
      baseFingerprint: `sha256:${"d".repeat(64)}`,
      requestedAt: "2026-07-17T10:01:15Z",
      contextManifestIdentity: recorded.plan.contextManifestIdentity,
      agentContractIdentity: IMPLEMENTATION_AGENT.contractIdentity,
    },
    manifest: manifest.entries,
    currentContext: [
      {
        source: { type: "project-path", value: PHASE_CONTEXT_SOURCE },
        content: PHASE_CONTEXT_CONTENT,
      },
    ],
    agentContract: IMPLEMENTATION_AGENT.contract,
    skills: IMPLEMENTATION_AGENT.skills,
  } as const;
  const dispatched = await coreContract.dispatchDurablePhaseExecution({
    fileSystem,
    planIdentity: recorded.plan.identity,
    execution,
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "PHASE-DISPATCHED",
      "2026-07-17T10:01:30Z",
    ),
  });
  if (!dispatched.ok) {
    assert.fail(dispatched.diagnostics[0]?.message ?? "Phase dispatch failed");
  }
  return {
    planIdentity: recorded.plan.identity,
    execution,
    materials: {
      manifest: execution.manifest,
      currentContext: execution.currentContext,
      agentContract: execution.agentContract,
      skills: execution.skills,
    },
  };
}
