import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NodeManagedProjectFileSystem, runCli } from "@dnslin/sayhi-cli";
import {
  advanceDurableTask,
  createDurableTask,
  initializeManagedProject,
  recoverDurableTask,
  type ContractIdentity,
} from "@dnslin/sayhi-core";

import {
  taskLifecycleExploreTransition,
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
