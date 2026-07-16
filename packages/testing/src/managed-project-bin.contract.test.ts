import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import type { CliJsonEnvelope } from "@dnslin/sayhi-cli";
import { createHash } from "node:crypto";

import { NodeManagedProjectFileSystem } from "@dnslin/sayhi-cli";
import {
  adoptDurableTaskBaseline,
  advanceDurableTask,
  archiveDurableTask,
  createDurableTask,
  readDurableTask,
  recoverDurableTask,
  withDurableTaskWriter,
  type WorkflowLifecycle,
  type WorkflowPhase,
  type WorkflowState,
} from "@dnslin/sayhi-core";

import {
  taskLifecycleEventMetadata,
  taskLifecycleStartRequest,
  taskLifecycleTransition,
  type TaskLifecycleFixture,
} from "./task-lifecycle-test-support.js";

const executeFile = promisify(execFile);
const CLI_BINARY = fileURLToPath(
  new URL("../../cli/dist/bin.js", import.meta.url),
);

const FOUNDATION_TASK = Object.freeze({
  taskId: "TASK-15-FOUNDATION",
  title: "Demonstrate the recoverable Foundation CLI",
  goal: "Recover a durable Task through the packaged CLI scenario",
  acceptanceCriterion: "The packaged CLI preserves recoverable Foundation state",
  files: Object.freeze(["packages/core/**"]),
  eventNamespace: "15-FOUNDATION",
  sessionRef: "session-15-foundation",
}) satisfies TaskLifecycleFixture;
const LEGACY_RUNTIME_IGNORE_CONTENT = "/.runtime/\n";
const CURRENT_RUNTIME_IGNORE_CONTENT = "# SayHi local runtime state\n/.runtime/\n";

test("packaged CLI binary executes Managed Project lifecycle commands", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-cli-binary-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));

  const initialization = await executeFile(process.execPath, [
    CLI_BINARY,
    "init",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(initialization.stderr, "");
  const initialized = JSON.parse(initialization.stdout) as CliJsonEnvelope;
  assert.equal(initialized.ok, true);
  assert.equal(initialized.operation, "project.init");

  const diagnosis = await executeFile(process.execPath, [
    CLI_BINARY,
    "doctor",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(diagnosis.stderr, "");
  const diagnosed = JSON.parse(diagnosis.stdout) as CliJsonEnvelope;
  assert.equal(diagnosed.ok, true);
  assert.equal(diagnosed.result?.state, "healthy");

  const update = await executeFile(process.execPath, [
    CLI_BINARY,
    "update",
    "--dry-run",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(update.stderr, "");
  const updatePlan = JSON.parse(update.stdout) as CliJsonEnvelope;
  assert.equal(updatePlan.ok, true);
  assert.equal(updatePlan.operation, "project.update");
  assert.equal(updatePlan.result?.state, "planned");

  const userConfig = "schemaVersion: 1\nuserSetting: keep\n";
  await writeFile(
    join(repository, ".sayhi", "config.yaml"),
    userConfig,
    "utf8",
  );
  const uninstall = await executeFile(process.execPath, [
    CLI_BINARY,
    "uninstall",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(uninstall.stderr, "");
  const uninstalled = JSON.parse(uninstall.stdout) as CliJsonEnvelope;
  assert.equal(uninstalled.ok, true);
  assert.equal(uninstalled.operation, "project.uninstall");
  assert.equal(uninstalled.result?.state, "applied");
  assert.equal(
    await readFile(join(repository, ".sayhi", "config.yaml"), "utf8"),
    userConfig,
  );
});

test("packaged CLI demonstrates recoverable Foundation state through safe uninstall", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-foundation-cli-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await runGit(repository, "init", "--quiet");
  await runGit(repository, "config", "user.email", "sayhi-tests@example.test");
  await runGit(repository, "config", "user.name", "SayHi Tests");
  await mkdir(join(repository, "packages", "core"), { recursive: true });
  await writeFile(
    join(repository, "packages", "core", "foundation.ts"),
    "export const foundation = 'clean';\n",
    "utf8",
  );

  const initialization = await executeCli("init", "--cwd", repository, "--json");
  assert.equal(initialization.stderr, "");
  const initialized = JSON.parse(initialization.stdout) as CliJsonEnvelope;
  assert.equal(initialized.ok, true);
  assert.equal(initialized.operation, "project.init");
  await runGit(repository, "add", "--all");
  await runGit(repository, "commit", "--quiet", "-m", "initial state");

  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const created = await createDurableTask({
    fileSystem,
    start: taskLifecycleStartRequest(FOUNDATION_TASK, "2026-07-15T12:00:00Z"),
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  await writeFile(
    join(repository, "packages", "core", "foundation.ts"),
    "export const foundation = 'dirty';\n",
    "utf8",
  );
  const observedBaseline = await fileSystem.captureBaseline({
    taskId: FOUNDATION_TASK.taskId,
    declaredScope: created.state.projection.scope,
    adoptedPaths: [],
  });
  assert.deepEqual(
    observedBaseline.dirtyPaths.map((change) => change.path),
    ["packages/core/foundation.ts"],
  );
  let blockedWriterEntered = false;
  const blockedWriter = await withDurableTaskWriter({
    fileSystem,
    taskId: FOUNDATION_TASK.taskId,
    expectedVersion: created.state.projection.version,
    operation: async (writer) => {
      blockedWriterEntered = true;
      await writer.writeFile(
        "packages/core/foundation.ts",
        "export const foundation = 'overwritten';\n",
      );
    },
  });
  assert.equal(blockedWriter.ok, false);
  if (blockedWriter.ok) {
    return;
  }
  assert.equal(blockedWriterEntered, false);
  assert.equal(
    blockedWriter.diagnostics[0]?.code,
    "task_lifecycle.baseline.missing",
  );
  assert.equal(
    await readFile(join(repository, "packages", "core", "foundation.ts"), "utf8"),
    "export const foundation = 'dirty';\n",
  );
  const rejectedAdoption = await adoptDurableTaskBaseline({
    fileSystem,
    taskId: FOUNDATION_TASK.taskId,
    expectedVersion: created.state.projection.version,
    baseline: observedBaseline,
    event: taskLifecycleEventMetadata(
      FOUNDATION_TASK,
      "BASELINE-REJECTED",
      "2026-07-15T12:01:00Z",
    ),
  });
  assert.equal(rejectedAdoption.ok, false);
  if (rejectedAdoption.ok) {
    return;
  }
  assert.equal(
    rejectedAdoption.diagnostics[0]?.code,
    "task_lifecycle.baseline.adoption_required",
  );

  const adopted = await adoptDurableTaskBaseline({
    fileSystem,
    taskId: FOUNDATION_TASK.taskId,
    expectedVersion: created.state.projection.version,
    baseline: {
      ...observedBaseline,
      adoptedPaths: observedBaseline.dirtyPaths.map((change) => change.path),
    },
    event: taskLifecycleEventMetadata(
      FOUNDATION_TASK,
      "BASELINE-ADOPTED",
      "2026-07-15T12:02:00Z",
    ),
  });
  assert.equal(adopted.ok, true);
  if (!adopted.ok) {
    return;
  }
  assert.equal(adopted.event.type, "baseline_adopted");
  assert.deepEqual(adopted.event.adopted, observedBaseline.dirtyPaths);

  let state = await advanceFoundationTask(
    fileSystem,
    adopted.state,
    [
      ["active", "explore"],
      ["active", "plan"],
      ["active", "implement"],
    ],
    "2026-07-15T12:03:00Z",
  );

  await mkdir(join(repository, "docs"), { recursive: true });
  await writeFile(
    join(repository, "docs", "foundation.md"),
    "# Foundation\n\nUse recoverable state.\n",
    "utf8",
  );
  const spec = await executeCli(
    "spec",
    "create",
    "foundation.md",
    "--from",
    "docs/foundation.md",
    "--apply",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(spec.stderr, "");
  assert.equal((JSON.parse(spec.stdout) as CliJsonEnvelope).operation, "spec.create");
  const context = await executeCli(
    "context",
    "add",
    FOUNDATION_TASK.taskId,
    "implement",
    ".sayhi/spec/foundation.md",
    "--apply",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(context.stderr, "");
  assert.equal((JSON.parse(context.stdout) as CliJsonEnvelope).operation, "context.add");
  await writeFile(
    join(repository, ".sayhi", "spec", "foundation.md"),
    "# Foundation\n\nChanged behavior.\n",
    "utf8",
  );
  const staleContext = await executeCli(
    "context",
    "list",
    FOUNDATION_TASK.taskId,
    "implement",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(staleContext.stderr, "");
  const stale = JSON.parse(staleContext.stdout) as CliJsonEnvelope;
  assert.equal(stale.result?.state, "stale");

  const beforeRecovery = await readDurableTask({
    fileSystem,
    taskId: FOUNDATION_TASK.taskId,
  });
  assert.equal(beforeRecovery.ok, true);
  if (!beforeRecovery.ok) {
    return;
  }
  const projectionPath = join(
    repository,
    ".sayhi",
    "tasks",
    FOUNDATION_TASK.taskId,
    "task.json",
  );
  await rm(projectionPath);
  const recovered = await recoverDurableTask({
    fileSystem: new NodeManagedProjectFileSystem(repository),
    taskId: FOUNDATION_TASK.taskId,
  });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.state.projection, beforeRecovery.state.projection);
  assert.deepEqual(
    JSON.parse(await readFile(projectionPath, "utf8")),
    beforeRecovery.state.projection,
  );

  const diagnosis = await executeCli("doctor", "--cwd", repository, "--json");
  assert.equal(diagnosis.stderr, "");
  const diagnosed = JSON.parse(diagnosis.stdout) as CliJsonEnvelope;
  assert.equal(diagnosed.ok, true);
  assert.equal(diagnosed.operation, "project.doctor");
  assert.equal(diagnosed.result?.taskCount, 1);

  state = await advanceFoundationTask(
    fileSystem,
    recovered.state,
    [
      ["active", "review"],
      ["active", "finish"],
      ["completed", "finish"],
    ],
    "2026-07-15T12:04:00Z",
  );
  const archived = await archiveDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      FOUNDATION_TASK,
      state,
      "archived",
      "finish",
      "archived",
      "2026-07-15T12:05:00Z",
    ),
  });
  assert.equal(archived.ok, true);
  if (!archived.ok) {
    return;
  }
  assert.equal(archived.moved, true);
  const archivedProjection = JSON.parse(
    await readFile(
      join(
        repository,
        ".sayhi",
        "tasks",
        "archive",
        FOUNDATION_TASK.taskId,
        "task.json",
      ),
      "utf8",
    ),
  ) as { lifecycle: string };
  assert.equal(archivedProjection.lifecycle, "archived");

  const runtimeIgnorePath = join(repository, ".sayhi", ".gitignore");
  const ownershipPath = join(repository, ".sayhi", "managed-files.json");
  const manifestPath = join(repository, ".sayhi", "manifest.json");
  await writeFile(runtimeIgnorePath, LEGACY_RUNTIME_IGNORE_CONTENT, "utf8");
  const ownership = JSON.parse(await readFile(ownershipPath, "utf8")) as {
    files: Array<{
      path: string;
      installedBaseIdentity?: { digest: string };
      generatedSourceVersion: string;
    }>;
  };
  const runtimeRecord = ownership.files.find(
    (record) => record.path === ".sayhi/.gitignore",
  );
  assert.ok(runtimeRecord?.installedBaseIdentity);
  runtimeRecord.installedBaseIdentity.digest = createHash("sha256")
    .update(LEGACY_RUNTIME_IGNORE_CONTENT)
    .digest("hex");
  runtimeRecord.generatedSourceVersion = "0.0.0";
  await writeFile(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`, "utf8");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    installed: { templates: string };
  };
  manifest.installed.templates = "0.0.0";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const updated = await executeCli("update", "--apply", "--cwd", repository, "--json");
  assert.equal(updated.stderr, "");
  assert.equal((JSON.parse(updated.stdout) as CliJsonEnvelope).result?.state, "applied");
  assert.equal(await readFile(runtimeIgnorePath, "utf8"), CURRENT_RUNTIME_IGNORE_CONTENT);
  const userRuntimeIgnoreContent =
    `${CURRENT_RUNTIME_IGNORE_CONTENT}user-local-change\n`;
  await writeFile(runtimeIgnorePath, userRuntimeIgnoreContent, "utf8");
  const conflict = await executeCli(
    "update",
    "--dry-run",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(conflict.stderr, "");
  const conflictEnvelope = JSON.parse(conflict.stdout) as CliJsonEnvelope;
  const actions = conflictEnvelope.result?.actions as readonly {
    path: string;
    result: string;
  }[];
  assert.equal(
    actions.find((action) => action.path === ".sayhi/.gitignore")?.result,
    "conflict",
  );
  assert.equal(await readFile(runtimeIgnorePath, "utf8"), userRuntimeIgnoreContent);
  await writeFile(runtimeIgnorePath, CURRENT_RUNTIME_IGNORE_CONTENT, "utf8");

  const userConfig = "schemaVersion: 1\nuserSetting: keep\n";
  await writeFile(join(repository, ".sayhi", "config.yaml"), userConfig, "utf8");
  const uninstall = await executeCli("uninstall", "--apply", "--cwd", repository, "--json");
  assert.equal(uninstall.stderr, "");
  const uninstalled = JSON.parse(uninstall.stdout) as CliJsonEnvelope;
  assert.equal(uninstalled.ok, true);
  assert.equal(uninstalled.operation, "project.uninstall");
  assert.equal(uninstalled.result?.state, "applied");
  assert.equal(
    await readFile(join(repository, ".sayhi", "config.yaml"), "utf8"),
    userConfig,
  );
  assert.equal(
    await readFile(join(repository, "packages", "core", "foundation.ts"), "utf8"),
    "export const foundation = 'dirty';\n",
  );
  await assert.rejects(readFile(runtimeIgnorePath, "utf8"));
  await assert.rejects(readFile(manifestPath, "utf8"));
  await assert.rejects(readFile(ownershipPath, "utf8"));
});

async function advanceFoundationTask(
  fileSystem: NodeManagedProjectFileSystem,
  initialState: WorkflowState,
  transitions: readonly (readonly [WorkflowLifecycle, WorkflowPhase])[],
  occurredAt: string,
): Promise<WorkflowState> {
  let state = initialState;
  for (const [lifecycle, phase] of transitions) {
    const advanced = await advanceDurableTask({
      fileSystem,
      transition: taskLifecycleTransition(
        FOUNDATION_TASK,
        state,
        lifecycle,
        phase,
        `${lifecycle}-${phase}`,
        occurredAt,
      ),
    });
    if (!advanced.ok) {
      assert.fail(advanced.diagnostics[0]?.message ?? "Task advancement failed");
    }
    assert.equal(advanced.ok, true);
    state = advanced.state;
  }
  return state;
}

async function executeCli(...args: readonly string[]) {
  return executeFile(process.execPath, [CLI_BINARY, ...args]);
}

async function runGit(repository: string, ...args: readonly string[]) {
  await executeFile("git", args, { cwd: repository, windowsHide: true });
}
