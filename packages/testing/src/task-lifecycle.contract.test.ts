import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveDurableTask,
  advanceDurableTask,
  createDurableTask,
  diagnoseDurableTasks,
  recoverDurableTask,
  type TaskArchiveFileSystem,
  type TransitionWorkflowRequest,
  type WorkflowLifecycle,
  type WorkflowPhase,
  type WorkflowState,
} from "@dnslin/sayhi-core";

import {
  createCompletedDurableTask,
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

function startRequest() {
  return taskLifecycleStartRequest(TASK_FIXTURE, "2026-07-14T10:00:00Z");
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

  const archiveHistory = fileSystem.files.get(archivedEventsPath);

  const identical = await archiveDurableTask({
    fileSystem,
    transition: archiveTransition,
  });
  assert.equal(identical.ok, true);
  if (!identical.ok) {
    return;
  }
  assert.equal(identical.moved, false);

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
