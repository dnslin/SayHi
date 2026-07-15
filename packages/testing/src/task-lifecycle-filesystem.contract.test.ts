import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { NodeManagedProjectFileSystem, runCli } from "@dnslin/sayhi-cli";
import {
  advanceDurableTask,
  adoptDurableTaskBaseline,
  createDurableTask,
  initializeManagedProject,
  recoverDurableTask,
  withDurableTaskWriter,
  type ContractIdentity,
  type BaselineRecord,
  type TaskScope,
} from "@dnslin/sayhi-core";

import {
  taskLifecycleExploreTransition,
  taskLifecycleEventMetadata,
  taskLifecycleStartRequest,
  type TaskLifecycleFixture,
} from "./task-lifecycle-test-support.js";

const TASK_ID = "TASK-10-FILESYSTEM";
const TASK_FIXTURE = Object.freeze({
  taskId: TASK_ID,
  title: "Persist a Task on the Node filesystem",
  goal: "Recover after process restart",
  acceptanceCriterion: "Projection matches Event replay",
  files: Object.freeze(["packages/core/**", "packages/cli/**"]),
  eventNamespace: "10-FILESYSTEM",
  sessionRef: "session-10-filesystem",
}) satisfies TaskLifecycleFixture;

const INSTALLATION = {
  core: "0.0.0",
  cli: "0.0.0",
  ompPlugin: "0.0.0",
  projectSchema: 1,
  templates: "0.1.0",
  skillLockDigest: `sha256:${"a".repeat(64)}` as ContractIdentity,
} as const;

const executeFile = promisify(execFile);
const TASK_SCOPE = Object.freeze({
  files: ["packages/core/**", "packages/cli/**"],
  apis: ["TaskLifecycleFileSystem"],
  schemas: ["events.jsonl", "task.json"],
  locks: [],
}) satisfies TaskScope;

test("Node filesystem persists and recovers a Task across adapter instances", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-lifecycle-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const initialFileSystem = new NodeManagedProjectFileSystem(repository);
  const initialized = await initializeManagedProject({
    fileSystem: initialFileSystem,
    installation: INSTALLATION,
    projectId: "PROJECT-10-FILESYSTEM",
    timestamp: "2026-07-14T11:00:00Z",
  });
  assert.equal(initialized.ok, true);

  const created = await createDurableTask({
    fileSystem: initialFileSystem,
    start: startRequest(),
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const eventsPath = join(
    repository,
    ".sayhi",
    "tasks",
    TASK_ID,
    "events.jsonl",
  );
  const projectionPath = join(
    repository,
    ".sayhi",
    "tasks",
    TASK_ID,
    "task.json",
  );
  const creationHistory = await readFile(eventsPath, "utf8");

  const advanced = await advanceDurableTask({
    fileSystem: initialFileSystem,
    transition: exploreTransition(
      created.state.projection.version,
      "EXPLORE",
      "2026-07-14T11:01:00Z",
    ),
  });
  assert.equal(advanced.ok, true);
  if (!advanced.ok) {
    return;
  }
  assert.equal((await readFile(eventsPath, "utf8")).startsWith(creationHistory), true);

  await rm(projectionPath);
  const restartedFileSystem = new NodeManagedProjectFileSystem(repository);
  const recovered = await recoverDurableTask({
    fileSystem: restartedFileSystem,
    taskId: TASK_ID,
  });

  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  assert.deepEqual(recovered.state.projection, advanced.state.projection);
  assert.deepEqual(
    JSON.parse(await readFile(projectionPath, "utf8")),
    advanced.state.projection,
  );
});

test("Node filesystem serializes concurrent Task advances across adapters", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-lock-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const initialized = await initializeManagedProject({
    fileSystem,
    installation: INSTALLATION,
    projectId: "PROJECT-10-LOCK",
    timestamp: "2026-07-14T11:30:00Z",
  });
  assert.equal(initialized.ok, true);
  const created = await createDurableTask({ fileSystem, start: startRequest() });
  if (!created.ok) {
    assert.fail(created.diagnostics[0]?.message ?? "Task creation failed");
  }

  const results = await Promise.all([
    advanceDurableTask({
      fileSystem: new NodeManagedProjectFileSystem(repository),
      transition: exploreTransition(
        created.state.projection.version,
        "FIRST",
        "2026-07-14T11:31:00Z",
      ),
    }),
    advanceDurableTask({
      fileSystem: new NodeManagedProjectFileSystem(repository),
      transition: exploreTransition(
        created.state.projection.version,
        "SECOND",
        "2026-07-14T11:31:01Z",
      ),
    }),
  ]);

  assert.equal(results.filter((result) => result.ok).length, 1);
  const rejected = results.find((result) => !result.ok);
  assert.ok(rejected && !rejected.ok);
  assert.equal(rejected.diagnostics[0]?.code, "workflow.version.stale");
  const recovered = await recoverDurableTask({
    fileSystem: new NodeManagedProjectFileSystem(repository),
    taskId: TASK_ID,
  });
  assert.equal(recovered.ok, true);
  if (recovered.ok) {
    assert.equal(recovered.state.events.length, 2);
  }
});

test("Baseline excludes durable Task Store records from other Tasks", async (t) => {
  const { repository, fileSystem } = await createTaskRepository();
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const created = await createDurableTask({
    fileSystem,
    start: taskLifecycleStartRequest(
      {
        ...TASK_FIXTURE,
        taskId: "TASK-11-OTHER",
        eventNamespace: "11-OTHER",
      },
      "2026-07-15T09:30:00Z",
    ),
  });
  assert.equal(created.ok, true);

  const observed = await captureTaskBaseline(fileSystem, []);

  assert.equal(
    observed.dirtyPaths.some((change) => change.path.startsWith(".sayhi/tasks/")),
    false,
  );
});

test("Writer blocks dirty files until their exact Baseline is adopted", async (t) => {
  const { repository, fileSystem, created } = await createTaskRepository();
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const sourcePath = join(repository, "packages", "core", "existing.ts");
  await writeFile(sourcePath, "export const state = 'dirty';\n", "utf8");
  await writeFile(join(repository, "ignored-user.txt"), "private notes\n", "utf8");
  const observed = await captureTaskBaseline(fileSystem, []);

  assert.deepEqual(
    observed.dirtyPaths.map((change) => change.path),
    ["ignored-user.txt", "packages/core/existing.ts"],
  );
  const missingAdoption = await adoptDurableTaskBaseline({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: created.state.projection.version,
    baseline: observed,
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "BASELINE-REJECTED",
      "2026-07-15T10:00:00Z",
    ),
  });
  assert.equal(missingAdoption.ok, false);
  if (!missingAdoption.ok) {
    assert.equal(
      missingAdoption.diagnostics[0]?.code,
      "task_lifecycle.baseline.adoption_required",
    );
  }

  const adopted = await adoptBaseline(
    fileSystem,
    created.state.projection.version,
    observed,
  );
  assert.equal(adopted.event.type, "baseline_adopted");
  assert.deepEqual(adopted.event.adopted, observed.dirtyPaths);
  const written = await withDurableTaskWriter({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: adopted.state.projection.version,
    operation: async (writer) => {
      await writer.writeFile("packages/core/generated.ts", "export {};\n");
      return "written";
    },
  });

  assert.equal(written.ok, true);
  if (written.ok) {
    assert.equal(written.value, "written");
    assert.deepEqual(written.changedPaths, ["packages/core/generated.ts"]);
    assert.deepEqual(
      written.finalBaseline.dirtyPaths.map((change) => change.path),
      [
        "ignored-user.txt",
        "packages/core/existing.ts",
        "packages/core/generated.ts",
      ],
    );
  }
  assert.equal(
    await readFile(join(repository, "packages", "core", "generated.ts"), "utf8"),
    "export {};\n",
  );
});

test("Writer rejects Baseline drift before changing project files", async (t) => {
  const { repository, fileSystem, created } = await createTaskRepository();
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const observed = await captureTaskBaseline(fileSystem, []);
  const adopted = await adoptBaseline(
    fileSystem,
    created.state.projection.version,
    observed,
  );
  await writeFile(
    join(repository, "packages", "core", "existing.ts"),
    "export const state = 'drifted';\n",
    "utf8",
  );

  const rejected = await withDurableTaskWriter({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: adopted.state.projection.version,
    operation: async (writer) => {
      await writer.writeFile("packages/core/should-not-exist.ts", "export {};\n");
    },
  });

  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.diagnostics[0]?.code, "task_lifecycle.baseline.drift");
  }
  await assert.rejects(
    readFile(join(repository, "packages", "core", "should-not-exist.ts"), "utf8"),
  );
});

test("Node Writer serializes concurrent mutation attempts", async (t) => {
  const { repository, fileSystem, created } = await createTaskRepository();
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const observed = await captureTaskBaseline(fileSystem, []);
  const adopted = await adoptBaseline(
    fileSystem,
    created.state.projection.version,
    observed,
  );
  let activeWriters = 0;
  let peakWriters = 0;

  const results = await Promise.all([
    withDurableTaskWriter({
      fileSystem: new NodeManagedProjectFileSystem(repository),
      taskId: TASK_ID,
      expectedVersion: adopted.state.projection.version,
      operation: async (writer) => {
        activeWriters += 1;
        peakWriters = Math.max(peakWriters, activeWriters);
        try {
          await delay(25);
          await writer.writeFile("packages/core/first.ts", "export const first = true;\n");
          return "first";
        } finally {
          activeWriters -= 1;
        }
      },
    }),
    withDurableTaskWriter({
      fileSystem: new NodeManagedProjectFileSystem(repository),
      taskId: TASK_ID,
      expectedVersion: adopted.state.projection.version,
      operation: async (writer) => {
        activeWriters += 1;
        peakWriters = Math.max(peakWriters, activeWriters);
        try {
          await writer.writeFile("packages/core/second.ts", "export const second = true;\n");
          return "second";
        } finally {
          activeWriters -= 1;
        }
      },
    }),
  ]);

  assert.equal(peakWriters, 1);
  assert.equal(results.filter((result) => result.ok).length, 1);
  const rejected = results.find((result) => !result.ok);
  assert.ok(rejected && !rejected.ok);
  assert.equal(rejected.diagnostics[0]?.code, "task_lifecycle.baseline.drift");
});

test("Node Writer never recovers a lock from PID liveness alone", async (t) => {
  const { repository, fileSystem } = await createTaskRepository();
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const lockPath = join(repository, ".sayhi", ".runtime", "writer.lock");
  await writeFile(lockPath, '{"pid":999999,"token":"stale"}', "utf8");
  let entered = false;
  const waiting = fileSystem.withWriterMutationLock(async () => {
    entered = true;
  });

  await delay(30);
  assert.equal(entered, false);
  await rm(lockPath);
  await waiting;
  assert.equal(entered, true);
});

test("Node Task lock never recovers a lock from PID liveness alone", async (t) => {
  const { repository, fileSystem } = await createTaskRepository();
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const lockPath = join(
    repository,
    ".sayhi",
    ".runtime",
    `task-${TASK_ID}.lock`,
  );
  await writeFile(lockPath, '{"pid":999999,"token":"stale"}', "utf8");
  let entered = false;
  const waiting = fileSystem.withTaskMutationLock(
    `.sayhi/.runtime/task-${TASK_ID}.lock`,
    async () => {
      entered = true;
    },
  );

  await delay(30);
  assert.equal(entered, false);
  await rm(lockPath);
  await waiting;
  assert.equal(entered, true);
});



test("Node Writer rejects a symlinked parent without escaping the repository", async (t) => {
  const { repository, fileSystem, created } = await createTaskRepository();
  const outside = await mkdtemp(join(tmpdir(), "sayhi-task-writer-escape-"));
  t.after(async () =>
    Promise.all([
      rm(repository, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );
  await symlink(
    outside,
    join(repository, "packages", "core", "linked"),
    "junction",
  );
  const observed = await captureTaskBaseline(fileSystem, []);
  const adopted = await adoptBaseline(
    fileSystem,
    created.state.projection.version,
    observed,
  );

  const rejected = await withDurableTaskWriter({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: adopted.state.projection.version,
    operation: async (writer) => {
      await writer.writeFile("packages/core/linked/escaped.ts", "export {};\n");
    },
  });

  assert.equal(rejected.ok, false);
  await assert.rejects(readFile(join(outside, "escaped.ts"), "utf8"));
});


test("CLI doctor reports corrupt durable Event history without mutation", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-doctor-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const initialized = await runCli(["init", "--json", "--cwd", repository]);
  assert.equal(initialized.exitCode, 0);
  const created = await createDurableTask({ fileSystem, start: startRequest() });
  assert.equal(created.ok, true);

  const eventsPath = join(
    repository,
    ".sayhi",
    "tasks",
    TASK_ID,
    "events.jsonl",
  );
  const projectionPath = join(
    repository,
    ".sayhi",
    "tasks",
    TASK_ID,
    "task.json",
  );
  const event = parseJsonObject((await readFile(eventsPath, "utf8")).trimEnd());
  const corruptHistory = `${JSON.stringify({ ...event, reason: "tampered" })}\n`;
  await writeFile(eventsPath, corruptHistory, "utf8");
  const projection = await readFile(projectionPath, "utf8");

  const diagnosis = await runCli(["doctor", "--json", "--cwd", repository]);

  assert.equal(diagnosis.exitCode, 3);
  assert.match(diagnosis.stdout, /workflow\.event\.chain_invalid/u);
  assert.match(diagnosis.stdout, /events\.jsonl\$\[0\]\.chainDigest/u);
  assert.equal(await readFile(eventsPath, "utf8"), corruptHistory);
  assert.equal(await readFile(projectionPath, "utf8"), projection);
});

async function createTaskRepository() {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-baseline-"));
  await runGit(repository, "init", "--quiet");
  await runGit(repository, "config", "user.email", "sayhi-tests@example.test");
  await runGit(repository, "config", "user.name", "SayHi Tests");
  await mkdir(join(repository, "packages", "core"), { recursive: true });
  await writeFile(
    join(repository, "packages", "core", "existing.ts"),
    "export const state = 'clean';\n",
    "utf8",
  );
  await writeFile(join(repository, ".gitignore"), "ignored-user.txt\n", "utf8");
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const initialized = await initializeManagedProject({
    fileSystem,
    installation: INSTALLATION,
    projectId: "PROJECT-11-BASELINE",
    timestamp: "2026-07-15T09:00:00Z",
  });
  assert.equal(initialized.ok, true);
  await runGit(repository, "add", "--all");
  await runGit(repository, "commit", "--quiet", "-m", "initial state");
  const created = await createDurableTask({ fileSystem, start: startRequest() });
  if (!created.ok) {
    assert.fail(created.diagnostics[0]?.message ?? "Task creation failed");
  }
  return Object.freeze({ repository, fileSystem, created });
}

async function captureTaskBaseline(
  fileSystem: NodeManagedProjectFileSystem,
  adoptedPaths: readonly string[],
) {
  return fileSystem.captureBaseline({
    taskId: TASK_ID,
    declaredScope: TASK_SCOPE,
    adoptedPaths,
  });
}

async function adoptBaseline(
  fileSystem: NodeManagedProjectFileSystem,
  expectedVersion: number,
  observed: BaselineRecord,
) {
  const adoptedPaths = observed.dirtyPaths.map((change) => change.path);
  const adopted = await adoptDurableTaskBaseline({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion,
    baseline: { ...observed, adoptedPaths },
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      `BASELINE-${expectedVersion}`,
      "2026-07-15T10:00:00Z",
    ),
  });
  if (!adopted.ok) {
    assert.fail(adopted.diagnostics[0]?.message ?? "Baseline adoption failed");
  }
  return adopted;
}

async function runGit(repository: string, ...args: readonly string[]) {
  await executeFile("git", args, { cwd: repository, windowsHide: true });
}

function parseJsonObject(source: string): object {
  const value: unknown = JSON.parse(source);
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value;
}

function startRequest() {
  return taskLifecycleStartRequest(TASK_FIXTURE, "2026-07-14T11:00:00Z");
}

function exploreTransition(
  expectedVersion: number,
  suffix: string,
  occurredAt: string,
) {
  return taskLifecycleExploreTransition(
    TASK_FIXTURE,
    expectedVersion,
    suffix,
    occurredAt,
  );
}
