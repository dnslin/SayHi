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
  archiveDurableTask,
  addDurableContextManifestEntry,
  advanceDurableTask,
  adoptDurableTaskBaseline,
  createDurableTask,
  completeDurableQuickResult,
  createDurableTaskHandoff,
  diagnoseDurableTasks,
  decideDurableBuildPlan,
  escalateDurableQuickToBuild,
  initializeManagedProject,
  freezeDurableContextManifest,
  recoverDurableTask,
  withDurableTaskWriter,
  recordDurableQuickResult,
  recordDurableBuildPlan,
  type BaselineRecord,
  type ContractIdentity,
  type TaskScope,
} from "@dnslin/sayhi-core";

import {
  createCompletedDurableTask,
  taskLifecycleExploreTransition,
  taskLifecycleEventMetadata,
  taskLifecycleStartRequest,
  taskLifecycleTransition,
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

  const handoff = {
    schemaVersion: 1,
    taskId: TASK_ID,
    phase: advanced.state.projection.phase,
    step: advanced.state.projection.step,
    projectionVersion: advanced.state.projection.version,
    blockers: advanced.state.projection.blockers,
    repositoryFingerprint: "sha256:workspace-state",
    artifactReferences: ["context/explore.jsonl", "evidence/route.json"],
    createdAt: "2026-07-15T13:00:00Z",
  };
  const recorded = await createDurableTaskHandoff({
    fileSystem: initialFileSystem,
    taskId: TASK_ID,
    expectedVersion: advanced.state.projection.version,
    repositoryFingerprint: handoff.repositoryFingerprint,
    artifactReferences: handoff.artifactReferences,
    createdAt: handoff.createdAt,
  });
  assert.equal(recorded.ok, true);
  if (!recorded.ok) {
    return;
  }
  assert.deepEqual(recorded.handoff, handoff);

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
  assert.deepEqual(recovered.handoff, handoff);
});

test("Node filesystem archives a completed Task directory idempotently", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-archive-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const initialized = await initializeManagedProject({
    fileSystem,
    installation: INSTALLATION,
    projectId: "PROJECT-13-ARCHIVE",
    timestamp: "2026-07-15T12:30:00Z",
  });
  assert.equal(initialized.ok, true);
  const completed = await createCompletedDurableTask(
    fileSystem,
    TASK_FIXTURE,
    "2026-07-14T11:00:00Z",
    "2026-07-15T12:30:00Z",
  );
  const activeDirectory = `.sayhi/tasks/${TASK_ID}`;
  await fileSystem.createDirectory(`${activeDirectory}/evidence`);
  await fileSystem.writeFile(
    `${activeDirectory}/evidence/provenance.json`,
    "{\"source\":\"issue-13\"}\n",
  );

  const archived = await archiveDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      completed,
      "archived",
      "finish",
      "ARCHIVE",
      "2026-07-15T12:30:00Z",
    ),
  });
  assert.equal(archived.ok, true);
  if (!archived.ok) {
    return;
  }
  assert.equal(archived.moved, true);
  const archivedDirectory = `.sayhi/tasks/archive/${TASK_ID}`;
  assert.equal((await fileSystem.inspect(activeDirectory)).kind, "missing");
  assert.equal(
    await fileSystem.readFile(`${archivedDirectory}/evidence/provenance.json`),
    "{\"source\":\"issue-13\"}\n",
  );
  const archivedEventsPath = `${archivedDirectory}/events.jsonl`;
  const history = await fileSystem.readFile(archivedEventsPath);
  assert.equal(history.split("\n").filter(Boolean).length, completed.events.length + 1);

  const diagnosis = await diagnoseDurableTasks({ fileSystem });
  assert.equal(diagnosis.ok, true);
  if (!diagnosis.ok) {
    return;
  }
  assert.equal(diagnosis.taskCount, 0);

  const retried = await archiveDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      TASK_FIXTURE,
      completed,
      "archived",
      "finish",
      "ARCHIVE-RETRY",
      "2026-07-15T12:30:00Z",
    ),
  });
  assert.equal(retried.ok, true);
  if (!retried.ok) {
    return;
  }
  assert.equal(retried.moved, false);
  assert.equal(await fileSystem.readFile(archivedEventsPath), history);
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
  const { repository, fileSystem, created } = await createTaskRepository("quick");
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

test("Writer admits a Build only after its durable approved Plan enters Implement", async (t) => {
  const { repository, fileSystem, created } = await createTaskRepository();
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const explored = await advanceDurableTask({
    fileSystem,
    transition: exploreTransition(
      created.state.projection.version,
      "WRITER-SEAL-EXPLORE",
      "2026-07-15T10:01:00Z",
    ),
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
      "WRITER-SEAL-PLAN",
      "2026-07-15T10:02:00Z",
    ),
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) {
    return;
  }
  await mkdir(join(repository, "docs"), { recursive: true });
  await writeFile(
    join(repository, "docs", "plan-context.md"),
    "Stable implementation context.\n",
    "utf8",
  );
  const added = await addDurableContextManifestEntry({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: planned.state.projection.version,
    phase: "implement",
    source: "docs/plan-context.md",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "WRITER-SEAL-CONTEXT-ADDED",
      "2026-07-15T10:02:30Z",
    ),
  });
  if (!added.ok) {
    assert.fail(added.diagnostics[0]?.message ?? "Implement Context entry failed");
  }
  assert.equal(added.ok, true);
  const baseline = await captureTaskBaseline(fileSystem, []);
  const adopted = await adoptBaseline(
    fileSystem,
    added.state.projection.version,
    baseline,
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
    assert.equal(rejected.diagnostics[0]?.code, "build_plan.approval_required");
  }
  await assert.rejects(
    readFile(join(repository, "packages", "core", "should-not-exist.ts"), "utf8"),
  );
  const frozen = await freezeDurableContextManifest({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: adopted.state.projection.version,
    phase: "implement",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "WRITER-SEAL-CONTEXT",
      "2026-07-15T10:03:00Z",
    ),
  });
  if (!frozen.ok) {
    assert.fail(frozen.diagnostics[0]?.message ?? "Implement Context freeze failed");
  }
  assert.equal(frozen.ok, true);
  const recorded = await recordDurableBuildPlan({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: frozen.state.projection.version,
    content: "# Approved Writer Plan\n\nWrite the admitted source file.\n",
    event: taskLifecycleEventMetadata(
      TASK_FIXTURE,
      "WRITER-SEAL-PLAN-RECORDED",
      "2026-07-15T10:04:00Z",
    ),
  });
  if (!recorded.ok) {
    assert.fail(recorded.diagnostics[0]?.message ?? "Build Plan record failed");
  }
  assert.equal(recorded.ok, true);
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
        "WRITER-SEAL-APPROVED",
        "2026-07-15T10:05:00Z",
      ),
      actor: {
        kind: "user",
        id: "sayhi-test-user",
        sessionRef: TASK_FIXTURE.sessionRef,
      },
    },
  });
  if (!approved.ok) {
    assert.fail(approved.diagnostics[0]?.message ?? "Build Plan approval failed");
  }
  assert.equal(approved.ok, true);
  const admitted = await withDurableTaskWriter({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: approved.state.projection.version,
    operation: async (writer) => {
      await writer.writeFile("packages/core/admitted.ts", "export {};\n");
    },
  });
  if (!admitted.ok) {
    assert.fail(admitted.diagnostics[0]?.message ?? "Approved Build Writer was rejected");
  }
  assert.equal(admitted.ok, true);
  assert.equal(
    await readFile(join(repository, "packages", "core", "admitted.ts"), "utf8"),
    "export {};\n",
  );
  await writeFile(
    join(repository, "docs", "plan-context.md"),
    "Drifted implementation context.\n",
    "utf8",
  );
  let staleWriterEntered = false;
  const staleWriter = await withDurableTaskWriter({
    fileSystem,
    taskId: TASK_ID,
    expectedVersion: approved.state.projection.version,
    operation: async (writer) => {
      staleWriterEntered = true;
      await writer.writeFile("packages/core/after-drift.ts", "export {};\n");
    },
  });
  assert.equal(staleWriter.ok, false);
  if (!staleWriter.ok) {
    assert.equal(staleWriter.diagnostics[0]?.code, "build_plan.context_stale");
  }
  assert.equal(staleWriterEntered, false);
  await assert.rejects(
    readFile(join(repository, "packages", "core", "after-drift.ts"), "utf8"),
  );
  const replanned = await recoverDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(replanned.ok, true);
  if (replanned.ok) {
    assert.equal(replanned.state.projection.phase, "plan");
  }
});

test("Writer rejects Baseline drift before changing project files", async (t) => {
  const { repository, fileSystem, created } = await createTaskRepository("quick");
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

test("Quick result rejects drift after the scoped Writer completes", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-quick-result-drift-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await runGit(repository, "init", "--quiet");
  await runGit(repository, "config", "user.email", "sayhi-tests@example.test");
  await runGit(repository, "config", "user.name", "SayHi Tests");
  await mkdir(join(repository, "packages", "core"), { recursive: true });
  await writeFile(
    join(repository, "packages", "core", "existing.ts"),
    "export const state = 'clean';\n",
    "utf8",
  );
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const initialized = await initializeManagedProject({
    fileSystem,
    installation: INSTALLATION,
    projectId: "PROJECT-17-QUICK-DRIFT",
    timestamp: "2026-07-16T15:30:00Z",
  });
  assert.equal(initialized.ok, true);
  await runGit(repository, "add", "--all");
  await runGit(repository, "commit", "--quiet", "-m", "initial state");

  const fixture = Object.freeze({
    ...TASK_FIXTURE,
    taskId: "TASK-17-QUICK-DRIFT",
    eventNamespace: "17-QUICK-DRIFT",
  });
  const buildStart = taskLifecycleStartRequest(fixture, "2026-07-16T15:30:01Z");
  const created = await createDurableTask({
    fileSystem,
    start: { ...buildStart, task: { ...buildStart.task, route: "quick" } },
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const implementing = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      fixture,
      created.state,
      "active",
      "implement",
      "IMPLEMENT",
      "2026-07-16T15:30:02Z",
    ),
  });
  assert.equal(implementing.ok, true);
  if (!implementing.ok) {
    return;
  }
  const baseline = await fileSystem.captureBaseline({
    taskId: fixture.taskId,
    declaredScope: implementing.state.projection.scope,
    adoptedPaths: [],
  });
  const adopted = await adoptDurableTaskBaseline({
    fileSystem,
    taskId: fixture.taskId,
    expectedVersion: implementing.state.projection.version,
    baseline,
    event: taskLifecycleEventMetadata(
      fixture,
      "BASELINE",
      "2026-07-16T15:30:03Z",
    ),
  });
  assert.equal(adopted.ok, true);
  if (!adopted.ok) {
    return;
  }
  const written = await withDurableTaskWriter({
    fileSystem,
    taskId: fixture.taskId,
    expectedVersion: adopted.state.projection.version,
    operation: async (writer) => {
      await writer.writeFile("packages/core/quick-change.ts", "export const changed = true;\n");
    },
  });
  assert.equal(written.ok, true);
  if (!written.ok) {
    return;
  }
  const premature = await recordDurableQuickResult({
    fileSystem,
    taskId: fixture.taskId,
    expectedVersion: adopted.state.projection.version,
    baselineAfter: written.finalBaseline,
    changedPaths: written.changedPaths,
  });
  assert.equal(premature.ok, false);
  if (!premature.ok) {
    assert.equal(premature.diagnostics[0]?.code, "task_lifecycle.quick_result.invalid");
  }
  await assert.rejects(
    readFile(join(repository, ".sayhi", "tasks", fixture.taskId, "quick.json"), "utf8"),
  );
  await writeFile(
    join(repository, "packages", "core", "existing.ts"),
    "export const state = 'drifted';\n",
    "utf8",
  );
  const recorded = await recordDurableQuickResult({
    fileSystem,
    taskId: fixture.taskId,
    expectedVersion: adopted.state.projection.version,
    baselineAfter: written.finalBaseline,
    changedPaths: written.changedPaths,
  });
  assert.equal(recorded.ok, false);
  if (!recorded.ok) {
    assert.equal(recorded.diagnostics[0]?.code, "task_lifecycle.baseline.drift");
  }
  await assert.rejects(
    readFile(join(repository, ".sayhi", "tasks", fixture.taskId, "quick.json"), "utf8"),
  );
});

test("durable Quick escalation recovers an interrupted Projection write without duplicate Events", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-quick-escalation-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const initialized = await initializeManagedProject({
    fileSystem,
    installation: INSTALLATION,
    projectId: "PROJECT-18-QUICK-ESCALATION",
    timestamp: "2026-07-16T16:00:00Z",
  });
  assert.equal(initialized.ok, true);

  const fixture = Object.freeze({
    ...TASK_FIXTURE,
    taskId: "TASK-18-QUICK-ESCALATION",
    eventNamespace: "18-QUICK-ESCALATION",
  });
  const buildStart = taskLifecycleStartRequest(fixture, "2026-07-16T16:00:01Z");
  const created = await createDurableTask({
    fileSystem,
    start: {
      ...buildStart,
      task: {
        ...buildStart.task,
        route: "quick",
        contexts: { triage: "context/triage.jsonl" },
      },
    },
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const escalation = {
    contractVersion: 1 as const,
    taskId: fixture.taskId,
    expectedVersion: created.state.projection.version,
    routeGate: {
      gate: "route" as const,
      evidence: [
        {
          kind: "human-approval" as const,
          reference: "evidence/build-route-approved.json",
        },
      ],
    },
    event: taskLifecycleEventMetadata(
      fixture,
      "ESCALATED",
      "2026-07-16T16:00:02Z",
    ),
  };
  const projectionPath = `.sayhi/tasks/${fixture.taskId}/task.json`;
  let failProjectionWrite = true;
  const faultingFileSystem = new Proxy(fileSystem, {
    get(target, property, receiver) {
      if (property === "writeFile") {
        return async (path: string, content: string) => {
          if (path === projectionPath && failProjectionWrite) {
            failProjectionWrite = false;
            throw new Error("route escalation projection write interrupted");
          }
          await target.writeFile(path, content);
        };
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const interrupted = await escalateDurableQuickToBuild({
    fileSystem: faultingFileSystem,
    escalation,
  });
  assert.equal(interrupted.ok, false);
  if (!interrupted.ok) {
    assert.equal(interrupted.diagnostics[0]?.code, "task_lifecycle.io_failed");
  }

  const recovered = await recoverDurableTask({
    fileSystem,
    taskId: fixture.taskId,
  });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  assert.equal(recovered.state.projection.route, "build");
  assert.equal(recovered.state.projection.phase, "explore");
  assert.equal(recovered.state.projection.baselineRef, created.state.projection.baselineRef);
  assert.deepEqual(recovered.state.projection.intent, created.state.projection.intent);
  assert.deepEqual(recovered.state.projection.contexts, created.state.projection.contexts);

  const retried = await escalateDurableQuickToBuild({ fileSystem, escalation });
  assert.equal(retried.ok, true);
  if (!retried.ok) {
    return;
  }
  assert.equal(retried.appended, false);
  assert.equal(retried.state.events.length, 2);
  const events = (await readFile(
    join(repository, ".sayhi", "tasks", fixture.taskId, "events.jsonl"),
    "utf8",
  )).trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.equal(events.filter((event) => event.type === "route_escalated").length, 1);
});
test("Quick completion repairs its record after an interrupted write", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-quick-result-repair-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await runGit(repository, "init", "--quiet");
  await runGit(repository, "config", "user.email", "sayhi-tests@example.test");
  await runGit(repository, "config", "user.name", "SayHi Tests");
  await mkdir(join(repository, "packages", "core"), { recursive: true });
  await writeFile(
    join(repository, "packages", "core", "existing.ts"),
    "export const state = 'clean';\n",
    "utf8",
  );
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const initialized = await initializeManagedProject({
    fileSystem,
    installation: INSTALLATION,
    projectId: "PROJECT-17-QUICK-REPAIR",
    timestamp: "2026-07-16T15:40:00Z",
  });
  assert.equal(initialized.ok, true);
  await runGit(repository, "add", "--all");
  await runGit(repository, "commit", "--quiet", "-m", "initial state");

  const fixture = Object.freeze({
    ...TASK_FIXTURE,
    taskId: "TASK-17-QUICK-REPAIR",
    eventNamespace: "17-QUICK-REPAIR",
  });
  const buildStart = taskLifecycleStartRequest(fixture, "2026-07-16T15:40:01Z");
  const created = await createDurableTask({
    fileSystem,
    start: { ...buildStart, task: { ...buildStart.task, route: "quick" } },
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const implementing = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      fixture,
      created.state,
      "active",
      "implement",
      "IMPLEMENT",
      "2026-07-16T15:40:02Z",
    ),
  });
  assert.equal(implementing.ok, true);
  if (!implementing.ok) {
    return;
  }
  const baseline = await fileSystem.captureBaseline({
    taskId: fixture.taskId,
    declaredScope: implementing.state.projection.scope,
    adoptedPaths: [],
  });
  const adopted = await adoptDurableTaskBaseline({
    fileSystem,
    taskId: fixture.taskId,
    expectedVersion: implementing.state.projection.version,
    baseline,
    event: taskLifecycleEventMetadata(fixture, "BASELINE", "2026-07-16T15:40:03Z"),
  });
  assert.equal(adopted.ok, true);
  if (!adopted.ok) {
    return;
  }
  const written = await withDurableTaskWriter({
    fileSystem,
    taskId: fixture.taskId,
    expectedVersion: adopted.state.projection.version,
    operation: async (writer) => {
      await writer.writeFile("packages/core/quick-change.ts", "export const changed = true;\n");
    },
  });
  assert.equal(written.ok, true);
  if (!written.ok) {
    return;
  }
  const reviewed = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      fixture,
      adopted.state,
      "active",
      "review",
      "REVIEW",
      "2026-07-16T15:40:04Z",
    ),
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }
  const finishing = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      fixture,
      reviewed.state,
      "active",
      "finish",
      "FINISH",
      "2026-07-16T15:40:05Z",
    ),
  });
  assert.equal(finishing.ok, true);
  if (!finishing.ok) {
    return;
  }
  const completion = taskLifecycleTransition(
    fixture,
    finishing.state,
    "completed",
    "finish",
    "COMPLETE",
    "2026-07-16T15:40:06Z",
  );
  const quickRecordPath = `.sayhi/tasks/${fixture.taskId}/quick.json`;
  let failQuickRecordWrite = true;
  const faultingFileSystem = new Proxy(fileSystem, {
    get(target, property, receiver) {
      if (property === "writeFile") {
        return async (path: string, content: string) => {
          if (path === quickRecordPath && failQuickRecordWrite) {
            failQuickRecordWrite = false;
            throw new Error("quick record write interrupted");
          }
          await target.writeFile(path, content);
        };
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const interrupted = await completeDurableQuickResult({
    fileSystem: faultingFileSystem,
    taskId: fixture.taskId,
    expectedVersion: finishing.state.projection.version,
    transition: completion,
    baselineAfter: written.finalBaseline,
    changedPaths: written.changedPaths,
  });
  assert.equal(interrupted.ok, false);
  if (!interrupted.ok) {
    assert.equal(interrupted.diagnostics[0]?.code, "task_lifecycle.io_failed");
  }
  const repaired = await completeDurableQuickResult({
    fileSystem,
    taskId: fixture.taskId,
    expectedVersion: finishing.state.projection.version,
    transition: completion,
    baselineAfter: written.finalBaseline,
    changedPaths: written.changedPaths,
  });
  assert.equal(repaired.ok, true);
  if (!repaired.ok) {
    return;
  }
  assert.equal(repaired.state.projection.lifecycle, "completed");
  await readFile(join(repository, ".sayhi", "tasks", fixture.taskId, "quick.json"), "utf8");
  const events = (await readFile(
    join(repository, ".sayhi", "tasks", fixture.taskId, "events.jsonl"),
    "utf8",
  )).trim().split("\n").map((line) => JSON.parse(line) as { type: string; to?: { lifecycle?: string } });
  assert.equal(
    events.filter((event) => event.type === "workflow_transitioned" && event.to?.lifecycle === "completed").length,
    1,
  );
});
test("Node Writer serializes concurrent mutation attempts", async (t) => {
  const { repository, fileSystem, created } = await createTaskRepository("quick");
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

async function createTaskRepository(route: "build" | "quick" = "build") {
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
  const created = await createDurableTask({ fileSystem, start: startRequest(route) });
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

function startRequest(route: "build" | "quick" = "build") {
  const start = taskLifecycleStartRequest(TASK_FIXTURE, "2026-07-14T11:00:00Z");
  return route === "build"
    ? start
    : { ...start, task: { ...start.task, route } };
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

