import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import type { CliJsonEnvelope } from "@dnslin/sayhi-cli";
import { createHash } from "node:crypto";

import {
  CLI_MANAGED_PROJECT_INSTALLATION,
  NodeManagedProjectFileSystem,
} from "@dnslin/sayhi-cli";
import {
  applyManagedProjectPlan,
  coreContract,
  MANAGED_PROJECT_OPERATION_JOURNAL_PATH,
  planManagedProjectUninstall,
  planManagedProjectUpdate,
  withDurableTaskWriter,
  type ApplyManagedProjectPlanResult,
  type ContractIdentity,
  type WorkflowLifecycle,
  type WorkflowPhase,
  type WorkflowState,
} from "@dnslin/sayhi-core";
import { readOmpBootstrapContract } from "@dnslin/sayhi-omp";

import { INSTALLED_CONTRACT_FILES } from "./installed-contract-matrix.js";
import {
  IMPLEMENTATION_AGENT,
  REVIEW_AGENTS,
  recordTestPhaseResult,
  taskLifecycleEventMetadata,
  taskLifecycleStartRequest,
  taskLifecycleTransition,
  type TaskLifecycleFixture,
  type TestPhaseAgent,
} from "./task-lifecycle-test-support.js";
import {
  requireRecord,
  requireString,
  requireVersion,
} from "./json-test-support.js";

const executeFile = promisify(execFile);
const NPM_EXECUTABLE = process.platform === "win32" ? process.execPath : "npm";
const NPM_CLI_ENTRY_POINT =
  process.env.npm_execpath ??
  join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const CLI_BINARY = fileURLToPath(
  new URL("./bin.js", import.meta.resolve("@dnslin/sayhi-cli")),
);

function npmArguments(args: readonly string[]): readonly string[] {
  return process.platform === "win32"
    ? [NPM_CLI_ENTRY_POINT, ...args]
    : args;
}

const FOUNDATION_TASK = Object.freeze({
  taskId: "TASK-15-FOUNDATION",
  title: "Demonstrate the recoverable Foundation CLI",
  goal: "Recover a durable Task through the packaged CLI scenario",
  acceptanceCriterion:
    "The packaged CLI preserves recoverable Foundation state",
  files: Object.freeze(["packages/core/**"]),
  eventNamespace: "15-FOUNDATION",
  sessionRef: "session-15-foundation",
}) satisfies TaskLifecycleFixture;
const LEGACY_RUNTIME_IGNORE_CONTENT = "/.runtime/\n";
const CURRENT_RUNTIME_IGNORE_CONTENT =
  "# SayHi local runtime state\n/.runtime/\n";




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
  const existingOmpAgents = "user-owned OMP agents\n";
  const existingOmpRules = "user-owned OMP rules\n";
  const existingRootAgents = "user-owned root agents\n";
  await mkdir(join(repository, ".omp"));
  await writeFile(
    join(repository, ".omp", "AGENTS.md"),
    existingOmpAgents,
    "utf8",
  );
  await writeFile(
    join(repository, ".omp", "RULES.md"),
    existingOmpRules,
    "utf8",
  );
  await writeFile(join(repository, "AGENTS.md"), existingRootAgents, "utf8");
  await writeTaskRequest(
    repository,
    "task-create.json",
    taskLifecycleStartRequest(FOUNDATION_TASK, "2026-07-15T12:00:00Z"),
  );

  const initialization = await executeCli(
    "init",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(initialization.stderr, "");
  const initialized = JSON.parse(initialization.stdout) as CliJsonEnvelope;
  assert.equal(initialized.ok, true);
  assert.equal(initialized.operation, "project.init");
  assert.equal(
    await readFile(join(repository, ".omp", "AGENTS.md"), "utf8"),
    existingOmpAgents,
  );
  assert.equal(
    await readFile(join(repository, ".omp", "RULES.md"), "utf8"),
    existingOmpRules,
  );
  assert.equal(
    await readFile(join(repository, "AGENTS.md"), "utf8"),
    existingRootAgents,
  );
  await runGit(repository, "add", "--all");
  await runGit(repository, "commit", "--quiet", "-m", "initial state");

  const created = await executeCliResult(
    "task",
    "create",
    "--from",
    "task-create.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(created.exitCode, 0);
  let state = await showTaskState(repository);
  const fileSystem = new NodeManagedProjectFileSystem(repository);

  await writeFile(
    join(repository, "packages", "core", "foundation.ts"),
    "export const foundation = 'dirty';\n",
    "utf8",
  );
  const baseline = await executeCliResult(
    "task",
    "baseline",
    FOUNDATION_TASK.taskId,
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(baseline.exitCode, 0);
  const observedBaseline = (JSON.parse(baseline.stdout) as CliJsonEnvelope)
    .result?.baseline as { dirtyPaths: readonly { path: string }[] };
  assert.deepEqual(
    observedBaseline.dirtyPaths.map((change) => change.path),
    ["packages/core/foundation.ts"],
  );
  let blockedWriterEntered = false;
  const blockedWriter = await withDurableTaskWriter({
    fileSystem,
    taskId: FOUNDATION_TASK.taskId,
    expectedVersion: state.projection.version,
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
    "build_plan.approval_required",
  );
  assert.equal(
    await readFile(
      join(repository, "packages", "core", "foundation.ts"),
      "utf8",
    ),
    "export const foundation = 'dirty';\n",
  );
  const adopted = await executeCliResult(
    "task",
    "adopt",
    FOUNDATION_TASK.taskId,
    "packages/core/foundation.ts",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(adopted.exitCode, 0);
  const adoptedEnvelope = JSON.parse(adopted.stdout) as CliJsonEnvelope;
  const adoptedEvent = adoptedEnvelope.result?.event as { type: string };
  assert.equal(adoptedEvent.type, "baseline_adopted");
  state = await showTaskState(repository);

  state = await advanceFoundationTask(
    repository,
    state,
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
  assert.equal(
    (JSON.parse(spec.stdout) as CliJsonEnvelope).operation,
    "spec.create",
  );
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
  assert.equal(
    (JSON.parse(context.stdout) as CliJsonEnvelope).operation,
    "context.add",
  );
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

  const beforeRecovery = await showTaskState(repository);
  const projectionPath = join(
    repository,
    ".sayhi",
    "tasks",
    FOUNDATION_TASK.taskId,
    "task.json",
  );
  await rm(projectionPath);
  const recovered = await executeCliResult(
    "task",
    "recover",
    FOUNDATION_TASK.taskId,
    "--apply",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(recovered.exitCode, 0);
  const recoveredEnvelope = JSON.parse(recovered.stdout) as CliJsonEnvelope;
  assert.equal(recoveredEnvelope.result?.recovered, true);
  state = await showTaskState(repository);
  assert.deepEqual(state.projection, beforeRecovery.projection);
  assert.deepEqual(
    JSON.parse(await readFile(projectionPath, "utf8")),
    beforeRecovery.projection,
  );

  const diagnosis = await executeCli("doctor", "--cwd", repository, "--json");
  assert.equal(diagnosis.stderr, "");
  const diagnosed = JSON.parse(diagnosis.stdout) as CliJsonEnvelope;
  assert.equal(diagnosed.ok, true);
  assert.equal(diagnosed.operation, "project.doctor");
  assert.equal(diagnosed.result?.taskCount, 1);
  const refreshedContext = await executeCliResult(
    "context",
    "refresh",
    FOUNDATION_TASK.taskId,
    "implement",
    "--apply",
    "--accept-approved-spec-change",
    "--cwd",
    repository,
    "--json",
  );
  if (refreshedContext.exitCode !== 0) {
    const envelope = JSON.parse(refreshedContext.stdout) as CliJsonEnvelope;
    assert.fail(envelope.error?.message ?? "Context refresh unexpectedly failed");
  }
  assert.equal(refreshedContext.exitCode, 0);
  state = await showTaskState(repository);
  assert.equal(state.projection.phase, "plan");
  state = await approveFoundationPlan(repository, state, "2026-07-15T12:03:30Z");

  state = await advanceFoundationTask(
    repository,
    state,
    [
      ["active", "review"],
      ["active", "finish"],
      ["completed", "finish"],
    ],
    "2026-07-15T12:04:00Z",
  );
  const archive = taskLifecycleTransition(
    FOUNDATION_TASK,
    state,
    "archived",
    "finish",
    "ARCHIVE",
    "2026-07-15T12:05:00Z",
  );
  await writeTaskRequest(repository, "task-transition.json", archive);
  const archived = await executeCliResult(
    "task",
    "archive",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(archived.exitCode, 0);
  const archivedEnvelope = JSON.parse(archived.stdout) as CliJsonEnvelope;
  const archivedProjection = archivedEnvelope.result?.projection as {
    lifecycle: string;
  };
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
  await writeFile(
    ownershipPath,
    `${JSON.stringify(ownership, null, 2)}\n`,
    "utf8",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    installed: { templates: string };
  };
  manifest.installed.templates = "0.0.0";
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const updated = await executeCli(
    "update",
    "--apply",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(updated.stderr, "");
  assert.equal(
    (JSON.parse(updated.stdout) as CliJsonEnvelope).result?.state,
    "applied",
  );
  assert.equal(
    await readFile(runtimeIgnorePath, "utf8"),
    CURRENT_RUNTIME_IGNORE_CONTENT,
  );
  const userRuntimeIgnoreContent = `${CURRENT_RUNTIME_IGNORE_CONTENT}user-local-change\n`;
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
  assert.equal(
    await readFile(runtimeIgnorePath, "utf8"),
    userRuntimeIgnoreContent,
  );
  await writeFile(runtimeIgnorePath, CURRENT_RUNTIME_IGNORE_CONTENT, "utf8");

  const userConfig = "schemaVersion: 1\nuserSetting: keep\n";
  await writeFile(
    join(repository, ".sayhi", "config.yaml"),
    userConfig,
    "utf8",
  );
  const uninstall = await executeCli(
    "uninstall",
    "--apply",
    "--cwd",
    repository,
    "--json",
  );
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
    await readFile(join(repository, ".omp", "AGENTS.md"), "utf8"),
    existingOmpAgents,
  );
  assert.equal(
    await readFile(join(repository, ".omp", "RULES.md"), "utf8"),
    existingOmpRules,
  );
  assert.equal(
    await readFile(join(repository, "AGENTS.md"), "utf8"),
    existingRootAgents,
  );
  assert.equal(
    await readFile(
      join(repository, "packages", "core", "foundation.ts"),
      "utf8",
    ),
    "export const foundation = 'dirty';\n",
  );
  await assert.rejects(readFile(runtimeIgnorePath, "utf8"));
  await assert.rejects(readFile(manifestPath, "utf8"));
  await assert.rejects(readFile(ownershipPath, "utf8"));
});

test("packaged CLI and OMP migrate durable Project Store data", async (t) => {
  const repository = await createInitializedManagedProject("sayhi-packaged-migration-");
  t.after(async () => rm(repository, { recursive: true, force: true }));
  assert.equal(readOmpBootstrapContract().product, "SayHi");
  await writeTaskRequest(
    repository,
    "task-create.json",
    taskLifecycleStartRequest(FOUNDATION_TASK, "2026-07-20T12:00:00Z"),
  );
  const created = await executeCliResult(
    "task",
    "create",
    "--from",
    "task-create.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(created.exitCode, 0);

  const taskDirectory = join(repository, ".sayhi", "tasks", FOUNDATION_TASK.taskId);
  const eventsPath = join(taskDirectory, "events.jsonl");
  const projectionPath = join(taskDirectory, "task.json");
  const provenancePath = join(taskDirectory, "evidence", "provenance.json");
  const provenance = "{\"source\":\"issue-37\"}\n";
  await mkdir(dirname(provenancePath), { recursive: true });
  await writeFile(provenancePath, provenance, "utf8");
  const eventsBeforeMigration = await readFile(eventsPath, "utf8");
  const projectionBeforeMigration = await readFile(projectionPath, "utf8");
  const ownershipBeforeMigration = await readManagedProjectOwnership(repository);
  await downgradeManagedProjectToLegacyRuntimeTemplate(repository);

  const migration = await executeCliResult(
    "update",
    "--apply",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(migration.exitCode, 0);
  assert.equal(
    await readFile(join(repository, ".sayhi", ".gitignore"), "utf8"),
    CURRENT_RUNTIME_IGNORE_CONTENT,
  );
  const migratedManifest = requireRecord(
    JSON.parse(await readFile(join(repository, ".sayhi", "manifest.json"), "utf8")),
    "Project Manifest",
  );
  const installedVersions = requireRecord(
    migratedManifest.installed,
    "Installed versions",
  );
  assert.equal(
    requireString(installedVersions, "templates"),
    CLI_MANAGED_PROJECT_INSTALLATION.templates,
  );
  assert.equal(await readFile(eventsPath, "utf8"), eventsBeforeMigration);
  assert.equal(await readFile(projectionPath, "utf8"), projectionBeforeMigration);
  assert.equal(await readFile(provenancePath, "utf8"), provenance);
  const continuity = await executeCliResult(
    "task",
    "show",
    FOUNDATION_TASK.taskId,
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(continuity.exitCode, 0);
  const ownershipAfterMigration = await readManagedProjectOwnership(repository);
  assert.deepEqual([...ownershipAfterMigration.keys()].sort(), [
    ".sayhi/.gitignore",
    ".sayhi/config.yaml",
  ]);
  const configBeforeMigration = ownershipBeforeMigration.get(".sayhi/config.yaml");
  const configAfterMigration = ownershipAfterMigration.get(".sayhi/config.yaml");
  assert.ok(configBeforeMigration);
  assert.ok(configAfterMigration);
  assert.deepEqual(configAfterMigration, configBeforeMigration);
  const runtimeAfterMigration = ownershipAfterMigration.get(".sayhi/.gitignore");
  assert.ok(runtimeAfterMigration);
  assert.equal(
    requireString(runtimeAfterMigration, "ownershipClass"),
    "engine-owned",
  );
  assert.equal(
    requireString(runtimeAfterMigration, "generatedSourceVersion"),
    CLI_MANAGED_PROJECT_INSTALLATION.templates,
  );
  const installedBaseIdentity = requireRecord(
    runtimeAfterMigration.installedBaseIdentity,
    "Runtime ignore installed base identity",
  );
  assert.equal(requireString(installedBaseIdentity, "algorithm"), "sha256-lf-v1");
  assert.equal(
    requireString(installedBaseIdentity, "digest"),
    createHash("sha256").update(CURRENT_RUNTIME_IGNORE_CONTENT, "utf8").digest("hex"),
  );
});

test("packaged CLI recovers a failed Project Store update", async (t) => {
  const repository = await createInitializedManagedProject("sayhi-failed-update-");
  t.after(async () => rm(repository, { recursive: true, force: true }));

  const userConfig = "schemaVersion: 1\nuserSetting: keep\n";
  await writeFile(join(repository, ".sayhi", "config.yaml"), userConfig, "utf8");
  const failingFileSystem = new FailingNodeManagedProjectFileSystem(repository);
  const updatePlan = await planManagedProjectUpdate({
    fileSystem: failingFileSystem,
    installation: CLI_MANAGED_PROJECT_INSTALLATION,
    files: [
      {
        path: ".sayhi/config.yaml",
        ownershipClass: "user-owned",
        installedContent: "schemaVersion: 1\n",
        incomingContent: "schemaVersion: 1\n",
        generatedSourceVersion: CLI_MANAGED_PROJECT_INSTALLATION.templates,
        markerIds: [],
      },
      {
        path: ".sayhi/.gitignore",
        ownershipClass: "engine-owned",
        installedContent: CURRENT_RUNTIME_IGNORE_CONTENT,
        incomingContent: CURRENT_RUNTIME_IGNORE_CONTENT,
        generatedSourceVersion: CLI_MANAGED_PROJECT_INSTALLATION.templates,
        markerIds: [],
      },
    ],
  });
  assert.equal(updatePlan.ok, true);
  if (!updatePlan.ok) {
    return;
  }
  failingFileSystem.failNextWrite(".sayhi/manifest.json");
  const failedUpdate = await applyManagedProjectPlan({
    fileSystem: failingFileSystem,
    plan: updatePlan.plan,
    timestamp: "2026-07-20T12:01:00Z",
  });
  assertManagedProjectOperationFailsRecoverably(failedUpdate);
  await recoverManagedProjectOperationWithCli(repository, "update");
  assert.equal(await readFile(join(repository, ".sayhi", "config.yaml"), "utf8"), userConfig);
});

test("packaged CLI recovers a failed Project Store uninstall without removing User-owned data", async (t) => {
  const ompAgents = "user-owned OMP agents\n";
  const ompRules = "user-owned OMP rules\n";
  const rootAgents = "user-owned root agents\n";
  const repository = await createInitializedManagedProject(
    "sayhi-failed-uninstall-",
    async (project) => {
      await mkdir(join(project, ".omp"));
      await writeFile(join(project, ".omp", "AGENTS.md"), ompAgents, "utf8");
      await writeFile(join(project, ".omp", "RULES.md"), ompRules, "utf8");
      await writeFile(join(project, "AGENTS.md"), rootAgents, "utf8");
    },
  );
  t.after(async () => rm(repository, { recursive: true, force: true }));

  const userConfig = "schemaVersion: 1\nuserSetting: keep\n";
  await writeFile(join(repository, ".sayhi", "config.yaml"), userConfig, "utf8");
  const failingFileSystem = new FailingNodeManagedProjectFileSystem(repository);
  const uninstallPlan = await planManagedProjectUninstall({
    fileSystem: failingFileSystem,
    files: [
      { path: ".sayhi/config.yaml", installedContent: "schemaVersion: 1\n" },
      { path: ".sayhi/.gitignore", installedContent: CURRENT_RUNTIME_IGNORE_CONTENT },
    ],
  });
  assert.equal(uninstallPlan.ok, true);
  if (!uninstallPlan.ok) {
    return;
  }
  failingFileSystem.failNextRemoval(".sayhi/manifest.json");
  const failedUninstall = await applyManagedProjectPlan({
    fileSystem: failingFileSystem,
    plan: uninstallPlan.plan,
    timestamp: "2026-07-20T12:02:00Z",
  });
  assertManagedProjectOperationFailsRecoverably(failedUninstall);
  await recoverManagedProjectOperationWithCli(repository, "uninstall");
  assert.equal(await readFile(join(repository, ".sayhi", "config.yaml"), "utf8"), userConfig);
  assert.equal(await readFile(join(repository, ".omp", "AGENTS.md"), "utf8"), ompAgents);
  assert.equal(await readFile(join(repository, ".omp", "RULES.md"), "utf8"), ompRules);
  assert.equal(await readFile(join(repository, "AGENTS.md"), "utf8"), rootAgents);
  await assert.rejects(readFile(join(repository, ".sayhi", "manifest.json"), "utf8"));
});

test("packaged CLI creates and inspects a durable Task", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-cli-binary-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  const beforeInitialization = await executeCliResult(
    "task",
    "list",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(beforeInitialization.exitCode, 6);
  assert.equal(
    (await executeCli("init", "--cwd", repository, "--json")).stderr,
    "",
  );
  await writeFile(
    join(repository, "task-create.json"),
    `${JSON.stringify(taskLifecycleStartRequest(FOUNDATION_TASK, "2026-07-16T10:00:00Z"), null, 2)}\n`,
    "utf8",
  );
  const missingRequest = await executeCliResult(
    "task",
    "create",
    "--from",
    "task-request-missing.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(missingRequest.exitCode, 8);
  assert.equal(
    (JSON.parse(missingRequest.stdout) as CliJsonEnvelope).error?.code,
    "task_lifecycle.io_failed",
  );
  await writeTaskRequest(repository, "task-gated-create.json", {
    ...taskLifecycleStartRequest(FOUNDATION_TASK, "2026-07-16T10:00:01Z"),
    routeGate: { gate: "route", evidence: [] },
  });
  const gated = await executeCliResult(
    "task",
    "create",
    "--from",
    "task-gated-create.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(gated.exitCode, 5);
  assert.equal(
    (JSON.parse(gated.stdout) as CliJsonEnvelope).error?.code,
    "workflow.gate.evidence_invalid",
  );
  await writeFile(
    join(repository, "task-malformed-create.json"),
    '{"contractVersion":1}\n',
    "utf8",
  );
  const malformedCreate = await executeCliResult(
    "task",
    "create",
    "--from",
    "task-malformed-create.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(malformedCreate.exitCode, 3);
  assert.equal(
    (JSON.parse(malformedCreate.stdout) as CliJsonEnvelope).error?.code,
    "workflow.request.invalid",
  );

  const created = await executeCliResult(
    "task",
    "create",
    "--from",
    "task-create.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(created.exitCode, 0);
  const createdEnvelope = JSON.parse(created.stdout) as CliJsonEnvelope;
  assert.equal(createdEnvelope.operation, "task.create");
  assert.equal(createdEnvelope.result?.taskId, FOUNDATION_TASK.taskId);

  const shown = await executeCliResult(
    "task",
    "show",
    FOUNDATION_TASK.taskId,
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(shown.exitCode, 0);
  const shownEnvelope = JSON.parse(shown.stdout) as CliJsonEnvelope;
  assert.equal(shownEnvelope.operation, "task.show");
  assert.equal(
    (shownEnvelope.result?.projection as { id: string }).id,
    FOUNDATION_TASK.taskId,
  );
  const listed = await executeCliResult(
    "task",
    "list",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(listed.exitCode, 0);
  const listedEnvelope = JSON.parse(listed.stdout) as CliJsonEnvelope;
  assert.deepEqual(listedEnvelope.result?.taskIds, [FOUNDATION_TASK.taskId]);
});

test("packaged CLI advances, recovers, and archives a durable Task", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-lifecycle-cli-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  await executeCli("init", "--cwd", repository, "--json");
  await writeFile(
    join(repository, "task-create.json"),
    `${JSON.stringify(taskLifecycleStartRequest(FOUNDATION_TASK, "2026-07-16T11:00:00Z"), null, 2)}\n`,
    "utf8",
  );
  const created = await executeCliResult(
    "task",
    "create",
    "--from",
    "task-create.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(created.exitCode, 0);

  let state = await showTaskState(repository);
  const initialEventCount = state.events.length;
  const explore = taskLifecycleTransition(
    FOUNDATION_TASK,
    state,
    "active",
    "explore",
    "EXPLORE",
    "2026-07-16T11:01:00Z",
  );
  await writeTaskRequest(repository, "task-transition.json", explore);
  const advanced = await executeCliResult(
    "task",
    "advance",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(advanced.exitCode, 0);
  state = await showTaskState(repository);
  assert.equal(state.events.length, initialEventCount + 1);
  assert.equal(state.projection.eventHead.sequence, state.events.length);

  const retried = await executeCliResult(
    "task",
    "advance",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(retried.exitCode, 0);
  assert.equal(
    (await showTaskState(repository)).events.length,
    state.events.length,
  );

  const staleExplore = {
    ...explore,
    event: {
      ...explore.event,
      eventId: "EVENT-15-FOUNDATION-STALE",
      idempotencyKey: "IDEMPOTENCY-15-FOUNDATION-STALE",
    },
  };
  await writeTaskRequest(
    repository,
    "task-stale-transition.json",
    staleExplore,
  );
  const stale = await executeCliResult(
    "task",
    "advance",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-stale-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(stale.exitCode, 3);
  const staleEnvelope = JSON.parse(stale.stdout) as CliJsonEnvelope;
  assert.equal(staleEnvelope.error?.code, "workflow.version.stale");
  assert.equal(
    (await showTaskState(repository)).events.length,
    state.events.length,
  );

  const projectionPath = join(
    repository,
    ".sayhi",
    "tasks",
    FOUNDATION_TASK.taskId,
    "task.json",
  );
  await rm(projectionPath);
  const recovered = await executeCliResult(
    "task",
    "recover",
    FOUNDATION_TASK.taskId,
    "--apply",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(recovered.exitCode, 0);
  const recoveredEnvelope = JSON.parse(recovered.stdout) as CliJsonEnvelope;
  assert.equal(recoveredEnvelope.result?.recovered, true);
  state = await showTaskState(repository);
  await writeTaskRequest(repository, "task-transition.json", {});
  const unboundAdvance = await executeCliResult(
    "task",
    "advance",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(unboundAdvance.exitCode, 3);
  assert.equal(
    (JSON.parse(unboundAdvance.stdout) as CliJsonEnvelope).error?.code,
    "task.request.task_id_mismatch",
  );
  await writeTaskRequest(repository, "task-transition.json", {
    taskId: FOUNDATION_TASK.taskId,
  });
  const malformedAdvance = await executeCliResult(
    "task",
    "advance",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(malformedAdvance.exitCode, 3);
  assert.equal(
    (JSON.parse(malformedAdvance.stdout) as CliJsonEnvelope).error?.code,
    "workflow.request.invalid",
  );
  const transitionWithMismatchedTaskId = taskLifecycleTransition(
    FOUNDATION_TASK,
    state,
    "active",
    "plan",
    "MISMATCHED-TASK-ID",
    "2026-07-16T11:01:58Z",
  );
  await writeTaskRequest(
    repository,
    "task-transition.json",
    transitionWithMismatchedTaskId,
  );
  const eventCountBeforeMismatchedTaskId = state.events.length;
  const mismatchedTaskIdResult = await executeCliResult(
    "task",
    "advance",
    "TASK-15-OTHER",
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(mismatchedTaskIdResult.exitCode, 3);
  assert.equal(
    (JSON.parse(mismatchedTaskIdResult.stdout) as CliJsonEnvelope).error?.code,
    "task.request.task_id_mismatch",
  );
  assert.equal(
    (await showTaskState(repository)).events.length,
    eventCountBeforeMismatchedTaskId,
  );
  const misroutedBlock = taskLifecycleTransition(
    FOUNDATION_TASK,
    state,
    "active",
    "plan",
    "MISROUTED-BLOCK",
    "2026-07-16T11:01:59Z",
  );
  await writeTaskRequest(repository, "task-transition.json", misroutedBlock);
  const eventCountBeforeMisroutedBlock = state.events.length;
  const misroutedBlockResult = await executeCliResult(
    "task",
    "block",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(misroutedBlockResult.exitCode, 3);
  assert.equal(
    (JSON.parse(misroutedBlockResult.stdout) as CliJsonEnvelope).error?.code,
    "task.transition.target.invalid",
  );
  assert.equal(
    (await showTaskState(repository)).events.length,
    eventCountBeforeMisroutedBlock,
  );
  const block = {
    ...taskLifecycleTransition(
      FOUNDATION_TASK,
      state,
      "blocked",
      "explore",
      "BLOCK",
      "2026-07-16T11:02:00Z",
    ),
    blockers: ["Awaiting user input"],
  };
  await writeTaskRequest(repository, "task-transition.json", block);
  const blocked = await executeCliResult(
    "task",
    "block",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(blocked.exitCode, 0);
  state = await showTaskState(repository);
  assert.equal(state.projection.lifecycle, "blocked");
  const unblock = taskLifecycleTransition(
    FOUNDATION_TASK,
    state,
    "active",
    "explore",
    "UNBLOCK",
    "2026-07-16T11:02:01Z",
  );
  await writeTaskRequest(repository, "task-transition.json", unblock);
  const unblocked = await executeCliResult(
    "task",
    "unblock",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(unblocked.exitCode, 0);
  state = await showTaskState(repository);
  assert.equal(state.projection.lifecycle, "active");

  state = await advanceFoundationTask(
    repository,
    state,
    [
      ["active", "plan"],
      ["active", "implement"],
      ["active", "review"],
      ["active", "finish"],
    ],
    "2026-07-16T11:02:00Z",
  );
  const completion = taskLifecycleTransition(
    FOUNDATION_TASK,
    state,
    "completed",
    "finish",
    "COMPLETE",
    "2026-07-16T11:02:02Z",
  );
  await writeTaskRequest(repository, "task-transition.json", completion);
  const completed = await executeCliResult(
    "task",
    "complete",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(completed.exitCode, 0);
  state = await showTaskState(repository);
  assert.equal(state.projection.lifecycle, "completed");
  const archive = taskLifecycleTransition(
    FOUNDATION_TASK,
    state,
    "archived",
    "finish",
    "ARCHIVE",
    "2026-07-16T11:03:00Z",
  );
  await writeTaskRequest(repository, "task-transition.json", archive);
  const archivedThroughAdvance = await executeCliResult(
    "task",
    "advance",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(archivedThroughAdvance.exitCode, 3);
  assert.equal(
    (JSON.parse(archivedThroughAdvance.stdout) as CliJsonEnvelope).error?.code,
    "workflow.transition.illegal",
  );
  assert.equal(
    (await showTaskState(repository)).projection.lifecycle,
    "completed",
  );
  await writeTaskRequest(repository, "task-transition.json", {
    taskId: FOUNDATION_TASK.taskId,
  });
  const malformedArchive = await executeCliResult(
    "task",
    "archive",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(malformedArchive.exitCode, 3);
  assert.equal(
    (JSON.parse(malformedArchive.stdout) as CliJsonEnvelope).error?.code,
    "workflow.request.invalid",
  );
  await writeTaskRequest(repository, "task-transition.json", archive);
  const mismatchedArchive = await executeCliResult(
    "task",
    "archive",
    "TASK-15-OTHER",
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(mismatchedArchive.exitCode, 3);
  assert.equal(
    (JSON.parse(mismatchedArchive.stdout) as CliJsonEnvelope).error?.code,
    "task.request.task_id_mismatch",
  );
  assert.equal(
    (await showTaskState(repository)).events.length,
    state.events.length,
  );
  const archived = await executeCliResult(
    "task",
    "archive",
    FOUNDATION_TASK.taskId,
    "--from",
    "task-transition.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(archived.exitCode, 0);
  assert.equal(
    JSON.parse(archived.stdout).result.projection.lifecycle,
    "archived",
  );
});

test("packaged CLI records explicit dirty Baseline adoption", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-baseline-cli-"));
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
  await writeTaskRequest(
    repository,
    "task-create.json",
    taskLifecycleStartRequest(FOUNDATION_TASK, "2026-07-16T12:00:00Z"),
  );
  await executeCli("init", "--cwd", repository, "--json");
  await runGit(repository, "add", "--all");
  await runGit(repository, "commit", "--quiet", "-m", "initial state");
  const created = await executeCliResult(
    "task",
    "create",
    "--from",
    "task-create.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(created.exitCode, 0);
  await writeFile(
    join(repository, "packages", "core", "foundation.ts"),
    "export const foundation = 'dirty';\n",
    "utf8",
  );
  await writeFile(
    join(repository, "unrelated-user.txt"),
    "private notes\n",
    "utf8",
  );

  const baseline = await executeCliResult(
    "task",
    "baseline",
    FOUNDATION_TASK.taskId,
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(baseline.exitCode, 0);
  const baselineEnvelope = JSON.parse(baseline.stdout) as CliJsonEnvelope;
  const dirtyPaths = (
    baselineEnvelope.result?.baseline as {
      dirtyPaths: readonly { path: string }[];
    }
  ).dirtyPaths;
  assert.deepEqual(
    dirtyPaths.map((path) => path.path),
    ["packages/core/foundation.ts", "unrelated-user.txt"],
  );

  const incompleteAdoption = await executeCliResult(
    "task",
    "adopt",
    FOUNDATION_TASK.taskId,
    "packages/core/foundation.ts",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(incompleteAdoption.exitCode, 3);
  const adopted = await executeCliResult(
    "task",
    "adopt",
    FOUNDATION_TASK.taskId,
    "packages/core/foundation.ts",
    "unrelated-user.txt",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(adopted.exitCode, 0);
  const adoptedEnvelope = JSON.parse(adopted.stdout) as CliJsonEnvelope;
  assert.equal(adoptedEnvelope.operation, "task.adopt");
  assert.equal(adoptedEnvelope.result?.appended, true);
  const repeatedAdoption = await executeCliResult(
    "task",
    "adopt",
    FOUNDATION_TASK.taskId,
    "packages/core/foundation.ts",
    "unrelated-user.txt",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(repeatedAdoption.exitCode, 0);
  assert.equal(
    (JSON.parse(repeatedAdoption.stdout) as CliJsonEnvelope).result?.appended,
    false,
  );

  const events = await executeCliResult(
    "task",
    "events",
    FOUNDATION_TASK.taskId,
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(events.exitCode, 0);
  const eventsEnvelope = JSON.parse(events.stdout) as CliJsonEnvelope;
  assert.equal(
    (eventsEnvelope.result?.events as readonly { type: string }[]).at(-1)?.type,
    "baseline_adopted",
  );
  assert.equal(
    (eventsEnvelope.result?.events as readonly { type: string }[]).filter(
      (event) => event.type === "baseline_adopted",
    ).length,
    1,
  );
});

test("packaged CLI doctor fails closed on corrupt durable Event history", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-doctor-cli-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  await executeCli("init", "--cwd", repository, "--json");
  await writeTaskRequest(
    repository,
    "task-create.json",
    taskLifecycleStartRequest(FOUNDATION_TASK, "2026-07-16T13:00:00Z"),
  );
  const created = await executeCliResult(
    "task",
    "create",
    "--from",
    "task-create.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(created.exitCode, 0);
  const eventsPath = join(
    repository,
    ".sayhi",
    "tasks",
    FOUNDATION_TASK.taskId,
    "events.jsonl",
  );
  const projectionPath = join(
    repository,
    ".sayhi",
    "tasks",
    FOUNDATION_TASK.taskId,
    "task.json",
  );
  const event = JSON.parse(
    (await readFile(eventsPath, "utf8")).trimEnd(),
  ) as object;
  const corruptHistory = `${JSON.stringify({ ...event, reason: "tampered" })}\n`;
  await writeFile(eventsPath, corruptHistory, "utf8");
  const projection = await readFile(projectionPath, "utf8");

  const diagnosis = await executeCliResult(
    "doctor",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(diagnosis.exitCode, 3);
  const envelope = JSON.parse(diagnosis.stdout) as CliJsonEnvelope;
  assert.equal(envelope.error?.code, "workflow.event.chain_invalid");
  const listed = await executeCliResult(
    "task",
    "list",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(listed.exitCode, 3);
  assert.equal(
    (JSON.parse(listed.stdout) as CliJsonEnvelope).error?.code,
    "workflow.event.chain_invalid",
  );
  assert.equal(await readFile(eventsPath, "utf8"), corruptHistory);
  assert.equal(await readFile(projectionPath, "utf8"), projection);
});

test("packaged CLI completes an auditable no-change Quick without repository writes", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-quick-no-change-"));
  const auditRoot = await mkdtemp(join(tmpdir(), "sayhi-quick-audit-"));
  const nestedAuditRoot = await mkdtemp(join(tmpdir(), "sayhi-quick-nested-audit-"));
  t.after(async () =>
    Promise.all([
      rm(repository, { recursive: true, force: true }),
      rm(auditRoot, { recursive: true, force: true }),
      rm(nestedAuditRoot, { recursive: true, force: true }),
    ]),
  );
  await runGit(repository, "init", "--quiet");
  await runGit(repository, "config", "user.email", "sayhi-tests@example.test");
  await runGit(repository, "config", "user.name", "SayHi Tests");
  await writeFile(join(repository, "README.md"), "no-change Quick fixture\n", "utf8");
  await runGit(repository, "add", "README.md");
  await runGit(repository, "commit", "--quiet", "-m", "initial state");

  const fixture = Object.freeze({
    taskId: "TASK-16-NO-CHANGE-QUICK",
    title: "Complete a packaged no-change Quick",
    goal: "Determine that no project change is needed",
    acceptanceCriterion: "The Quick records a no-change result without repository writes",
    files: Object.freeze([]),
    eventNamespace: "16-NO-CHANGE-QUICK",
    sessionRef: "session-16-no-change-quick",
  }) satisfies TaskLifecycleFixture;
  const buildStart = taskLifecycleStartRequest(fixture, "2026-07-16T13:00:00Z");
  const start = {
    ...buildStart,
    task: { ...buildStart.task, route: "quick" as const },
  };
  const created = coreContract.startWorkflowTask(start);
  if (!created.ok) {
    throw new Error(created.diagnostics[0]?.message ?? "Quick creation failed");
  }
  let expectedState = created.state;
  const transitions = [];
  for (const [lifecycle, phase, suffix] of [
    ["active", "implement", "IMPLEMENT"],
    ["active", "review", "REVIEW"],
    ["active", "finish", "FINISH"],
    ["completed", "finish", "COMPLETE"],
  ] as const) {
    const transition = taskLifecycleTransition(
      fixture,
      expectedState,
      lifecycle,
      phase,
      suffix,
      "2026-07-16T13:00:01Z",
    );
    transitions.push(transition);
    const advanced = coreContract.transitionWorkflow(expectedState, transition);
    if (!advanced.ok) {
      throw new Error(advanced.diagnostics[0]?.message ?? "Quick transition failed");
    }
    expectedState = advanced.state;
  }
  const archive = taskLifecycleTransition(
    fixture,
    expectedState,
    "archived",
    "finish",
    "ARCHIVE",
    "2026-07-16T13:00:02Z",
  );
  await writeTaskRequest(repository, "quick-complete.json", { start, transitions, writes: [] });
  await writeTaskRequest(repository, "quick-archive.json", archive);

  const repositoryBefore = await snapshotRepositoryFiles(repository);
  const headBefore = await readGitHead(repository);
  const environment = { ...process.env, SAYHI_QUICK_AUDIT_DIR: auditRoot };
  const completed = await executeCliWithEnvironment(
    environment,
    "quick",
    "complete",
    "--from",
    "quick-complete.json",
    "--cwd",
    repository,
    "--json",
  );
  const completedEnvelope = JSON.parse(completed.stdout) as CliJsonEnvelope;
  assert.equal(completedEnvelope.operation, "quick.complete");
  assert.equal(completedEnvelope.result?.taskId, fixture.taskId);
  assert.equal(completedEnvelope.result?.outcome, "no-change");
  assertQuickProjection(completedEnvelope.result?.projection, "completed");
  assert.deepEqual(
    quickEventPhases(completedEnvelope.result?.events),
    ["triage", "implement", "review", "finish", "finish"],
  );
  assert.deepEqual(await snapshotRepositoryFiles(repository), repositoryBefore);
  assert.equal(await readGitHead(repository), headBefore);

  const shown = await executeCliWithEnvironment(
    environment,
    "quick",
    "show",
    fixture.taskId,
    "--cwd",
    repository,
    "--json",
  );
  const shownEnvelope = JSON.parse(shown.stdout) as CliJsonEnvelope;
  assert.equal(shownEnvelope.operation, "quick.show");
  assertQuickProjection(shownEnvelope.result?.projection, "completed");
  assert.equal(shownEnvelope.result?.outcome, "no-change");
  const activeAuditPath = await locateQuickAuditFile(auditRoot, "active");


  const archived = await executeCliWithEnvironment(
    environment,
    "quick",
    "archive",
    fixture.taskId,
    "--from",
    "quick-archive.json",
    "--cwd",
    repository,
    "--json",
  );
  const archivedEnvelope = JSON.parse(archived.stdout) as CliJsonEnvelope;
  assert.equal(archivedEnvelope.operation, "quick.archive");
  assertQuickProjection(archivedEnvelope.result?.projection, "archived");
  assert.equal(archivedEnvelope.result?.outcome, "no-change");
  const archiveAuditPath = await locateQuickAuditFile(auditRoot, "archive");
  const interruptedArchiveAudit = await readFile(archiveAuditPath, "utf8");
  await rm(archiveAuditPath);
  await writeFile(activeAuditPath, interruptedArchiveAudit, "utf8");
  const staleLockDirectory = join(dirname(dirname(activeAuditPath)), "locks");
  await mkdir(staleLockDirectory, { recursive: true });
  await writeFile(
    join(staleLockDirectory, `${basename(activeAuditPath)}.lock`),
    "interrupted\n",
    "utf8",
  );
  const recoveredArchive = await executeCliWithEnvironment(
    environment,
    "quick",
    "show",
    fixture.taskId,
    "--cwd",
    repository,
    "--json",
  );
  assertQuickProjection(readCliProjection(JSON.parse(recoveredArchive.stdout)), "archived");
  const retriedArchive = await executeCliWithEnvironment(
    environment,
    "quick",
    "archive",
    fixture.taskId,
    "--from",
    "quick-archive.json",
    "--cwd",
    repository,
    "--json",
  );
  assertQuickProjection(readCliProjection(JSON.parse(retriedArchive.stdout)), "archived");
  const duplicateCompletion = await executeCliResultWithEnvironment(
    environment,
    "quick",
    "complete",
    "--from",
    "quick-complete.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(duplicateCompletion.exitCode, 4);
  const archivedAuditPath = await locateQuickAuditFile(auditRoot, "archive");
  await writeFile(
    archivedAuditPath,
    withoutQuickOutcome(await readFile(archivedAuditPath, "utf8")),
    "utf8",
  );
  const missingOutcome = await executeCliResultWithEnvironment(
    environment,
    "quick",
    "show",
    fixture.taskId,
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(missingOutcome.exitCode, 3);


  const unsafeAuditRoot = join(auditRoot, "repository-link");
  await symlink(repository, unsafeAuditRoot, "junction");
  const unsafeCompletion = await executeCliResultWithEnvironment(
    { ...process.env, SAYHI_QUICK_AUDIT_DIR: unsafeAuditRoot },
    "quick",
    "complete",
    "--from",
    "quick-complete.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(unsafeCompletion.exitCode, 4);

  await symlink(repository, join(nestedAuditRoot, "quick"), "junction");
  const nestedUnsafeCompletion = await executeCliResultWithEnvironment(
    { ...process.env, SAYHI_QUICK_AUDIT_DIR: nestedAuditRoot },
    "quick",
    "complete",
    "--from",
    "quick-complete.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(nestedUnsafeCompletion.exitCode, 4);
  assert.deepEqual(await snapshotRepositoryFiles(repository), repositoryBefore);

  assert.equal(await readGitHead(repository), headBefore);
});

test("packaged CLI completes and archives a changed Quick without committing", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-quick-changed-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await runGit(repository, "init", "--quiet");
  await runGit(repository, "config", "user.email", "sayhi-tests@example.test");
  await runGit(repository, "config", "user.name", "SayHi Tests");
  await writeFile(join(repository, "README.md"), "changed Quick fixture\n", "utf8");
  const initialized = await executeCliResult("init", "--cwd", repository, "--json");
  assert.equal(initialized.exitCode, 0);
  await runGit(repository, "add", ".");
  await runGit(repository, "commit", "--quiet", "-m", "initial state");

  const fixture = Object.freeze({
    taskId: "TASK-17-CHANGED-QUICK",
    title: "Archive a changed Quick without committing",
    goal: "Change the Quick fixture through the approved Writer scope",
    acceptanceCriterion: "The Quick records and archives its changed result without a commit",
    files: Object.freeze(["README.md"]),
    eventNamespace: "17-CHANGED-QUICK",
    sessionRef: "session-17-changed-quick",
  }) satisfies TaskLifecycleFixture;
  const { start, transitions, completedState } = createChangedQuickCompletion(
    fixture,
    "2026-07-16T14:00:00Z",
    "2026-07-16T14:00:01Z",
  );
  const archive = taskLifecycleTransition(
    fixture,
    completedState,
    "archived",
    "finish",
    "ARCHIVE",
    "2026-07-16T14:00:02Z",
  );
  await writeTaskRequest(repository, "changed-quick-complete.json", {
    start,
    transitions,
    writes: [{ path: "README.md", content: "changed by Quick\n" }],
  });
  await writeTaskRequest(repository, "changed-quick-archive.json", archive);
  await runGit(repository, "add", "changed-quick-complete.json", "changed-quick-archive.json");
  await runGit(repository, "commit", "--quiet", "-m", "Quick requests");

  const headBefore = await readGitHead(repository);
  const completed = await executeCliResult(
    "quick",
    "complete",
    "--from",
    "changed-quick-complete.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(completed.exitCode, 0);
  const completedEnvelope = JSON.parse(completed.stdout) as CliJsonEnvelope;
  assert.equal(completedEnvelope.operation, "quick.complete");
  assert.equal(completedEnvelope.result?.outcome, "changed");
  assert.deepEqual(completedEnvelope.result?.changedPaths, ["README.md"]);
  assertQuickProjection(completedEnvelope.result?.projection, "completed");
  assert.equal(await readFile(join(repository, "README.md"), "utf8"), "changed by Quick\n");
  assert.equal(await readGitHead(repository), headBefore);
  const quickRecordPath = join(repository, ".sayhi", "tasks", fixture.taskId, "quick.json");
  const quickRecordContent = await readFile(quickRecordPath, "utf8");
  const quickRecord = JSON.parse(quickRecordContent) as {
    changedPaths: readonly string[];
    commit: null;
    workflow: {
      projection: {
        lifecycle: string;
        phase: string;
        route: string;
        intent: { acceptanceCriteria: readonly string[] };
        scope: { files: readonly string[] };
      };
      events: readonly { type: string; to?: { phase?: string } }[];
    };
  };
  assert.deepEqual(quickRecord.changedPaths, ["README.md"]);
  assert.equal(quickRecord.commit, null);
  assert.equal(quickRecord.workflow.projection.route, "quick");
  assert.equal(quickRecord.workflow.projection.lifecycle, "completed");
  assert.equal(quickRecord.workflow.projection.phase, "finish");
  assert.deepEqual(quickRecord.workflow.projection.intent.acceptanceCriteria, [
    fixture.acceptanceCriterion,
  ]);
  assert.deepEqual(quickRecord.workflow.projection.scope.files, ["README.md"]);
  assert.equal(
    quickRecord.workflow.events.some(
      (event) => event.type === "workflow_transitioned" && event.to?.phase === "review",
    ),
    true,
  );

  const shown = await executeCliResult(
    "quick",
    "show",
    fixture.taskId,
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(shown.exitCode, 0);
  const shownEnvelope = JSON.parse(shown.stdout) as CliJsonEnvelope;
  assert.equal(shownEnvelope.result?.outcome, "changed");
  assertQuickProjection(shownEnvelope.result?.projection, "completed");
  await writeFile(quickRecordPath, "{}\n", "utf8");
  const corruptedShow = await executeCliResult(
    "quick",
    "show",
    fixture.taskId,
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(corruptedShow.exitCode, 3);
  assert.equal(
    readCliErrorCode(JSON.parse(corruptedShow.stdout)),
    "task_lifecycle.quick_result.invalid",
  );
  const corruptedArchive = await executeCliResult(
    "quick",
    "archive",
    fixture.taskId,
    "--from",
    "changed-quick-archive.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(corruptedArchive.exitCode, 3);
  assert.equal(
    readCliErrorCode(JSON.parse(corruptedArchive.stdout)),
    "task_lifecycle.quick_result.invalid",
  );
  await writeFile(quickRecordPath, quickRecordContent, "utf8");

  const archived = await executeCliResult(
    "quick",
    "archive",
    fixture.taskId,
    "--from",
    "changed-quick-archive.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(archived.exitCode, 0);
  const archivedEnvelope = JSON.parse(archived.stdout) as CliJsonEnvelope;
  assert.equal(archivedEnvelope.result?.outcome, "changed");
  assertQuickProjection(archivedEnvelope.result?.projection, "archived");
  const archivedQuickRecord = JSON.parse(
    await readFile(
      join(repository, ".sayhi", "tasks", "archive", fixture.taskId, "quick.json"),
      "utf8",
    ),
  ) as { changedPaths: readonly string[]; commit: null };
  assert.deepEqual(archivedQuickRecord.changedPaths, ["README.md"]);
  assert.equal(archivedQuickRecord.commit, null);
  assert.equal(await readGitHead(repository), headBefore);
});

test("packaged CLI stops a changed Quick write outside its approved scope", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-quick-outside-scope-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await runGit(repository, "init", "--quiet");
  await runGit(repository, "config", "user.email", "sayhi-tests@example.test");
  await runGit(repository, "config", "user.name", "SayHi Tests");
  await writeFile(join(repository, "README.md"), "scoped Quick fixture\n", "utf8");
  const initialized = await executeCliResult("init", "--cwd", repository, "--json");
  assert.equal(initialized.exitCode, 0);
  await runGit(repository, "add", ".");
  await runGit(repository, "commit", "--quiet", "-m", "initial state");

  const fixture = Object.freeze({
    taskId: "TASK-17-OUTSIDE-SCOPE",
    title: "Reject a changed Quick outside its approved scope",
    goal: "Prove changed Quick writes remain within the declared scope",
    acceptanceCriterion: "The Quick stops before an out-of-scope write",
    files: Object.freeze(["README.md"]),
    eventNamespace: "17-OUTSIDE-SCOPE",
    sessionRef: "session-17-outside-scope",
  }) satisfies TaskLifecycleFixture;
  const { start, transitions } = createChangedQuickCompletion(
    fixture,
    "2026-07-16T15:00:00Z",
    "2026-07-16T15:00:01Z",
  );
  await writeTaskRequest(repository, "outside-scope-quick.json", {
    start,
    transitions,
    writes: [
      { path: "README.md", content: "must not be written\n" },
      { path: "outside-scope.txt", content: "must not be written\n" },
    ],
  });
  await writeTaskRequest(repository, "outside-scope-retry-quick.json", {
    start,
    transitions,
    writes: [{ path: "README.md", content: "recovered by Quick\n" }],
  });
  await runGit(
    repository,
    "add",
    "outside-scope-quick.json",
    "outside-scope-retry-quick.json",
  );
  await runGit(repository, "commit", "--quiet", "-m", "Quick request");

  const headBefore = await readGitHead(repository);
  const completed = await executeCliResult(
    "quick",
    "complete",
    "--from",
    "outside-scope-quick.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(completed.exitCode, 3);
  const failure = JSON.parse(completed.stdout) as {
    error?: { code?: string };
  };
  assert.equal(failure.error?.code, "task_lifecycle.writer.scope");
  assert.equal(await readFile(join(repository, "README.md"), "utf8"), "scoped Quick fixture\n");
  await assert.rejects(readFile(join(repository, "outside-scope.txt"), "utf8"));
  assert.equal(await readGitHead(repository), headBefore);
  await assert.rejects(
    readFile(join(repository, ".sayhi", "tasks", fixture.taskId, "task.json"), "utf8"),
  );
  const recovered = await executeCliResult(
    "quick",
    "complete",
    "--from",
    "outside-scope-retry-quick.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(recovered.exitCode, 0);
  const recoveredEnvelope = JSON.parse(recovered.stdout) as CliJsonEnvelope;
  assert.equal(recoveredEnvelope.result?.outcome, "changed");
  assertQuickProjection(recoveredEnvelope.result?.projection, "completed");
  assert.equal(await readFile(join(repository, "README.md"), "utf8"), "recovered by Quick\n");
});
test("packaged CLI commits only accepted Build scope and archives the Task", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-commit-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await prepareScopedFinishTask(repository);

  await writeFile(join(repository, "user-staged.txt"), "keep staged\n", "utf8");
  await runGit(repository, "add", "user-staged.txt");
  await writeFile(join(repository, "user-untracked.txt"), "keep untracked\n", "utf8");
  const headBefore = await readGitHead(repository);

  const planned = await executeCliResult(
    "task",
    "commit-plan",
    FOUNDATION_TASK.taskId,
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(planned.exitCode, 0);
  const plan = (JSON.parse(planned.stdout) as CliJsonEnvelope).result as {
    ready: boolean;
    paths: readonly string[];
    stagedPaths: readonly string[];
    excludedPaths: readonly string[];
  };
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.paths, ["packages/core/foundation.ts"]);
  assert.deepEqual(plan.stagedPaths, ["user-staged.txt"]);
  assert.deepEqual(plan.excludedPaths, ["user-staged.txt", "user-untracked.txt"]);

  const committed = await executeCliResult(
    "task",
    "commit",
    FOUNDATION_TASK.taskId,
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(committed.exitCode, 0);
  const result = (JSON.parse(committed.stdout) as CliJsonEnvelope).result as {
    commit: string;
    projection: { lifecycle: string; phase: string };
    archived: boolean;
  };
  assert.equal(result.projection.lifecycle, "archived");
  assert.equal(result.projection.phase, "finish");
  assert.equal(result.archived, true);
  assert.equal(await readGitHead(repository), result.commit);
  const commitParents = await executeFile("git", ["show", "-s", "--format=%P", result.commit], {
    cwd: repository,
    windowsHide: true,
  });
  assert.equal(commitParents.stdout.trim(), headBefore);
  const committedPaths = await executeFile("git", ["show", "--format=", "--name-only", result.commit], {
    cwd: repository,
    windowsHide: true,
  });
  assert.deepEqual(
    committedPaths.stdout.split(/\r?\n/u).filter(Boolean),
    ["packages/core/foundation.ts"],
  );
  assert.equal(await readFile(join(repository, "user-staged.txt"), "utf8"), "keep staged\n");
  assert.equal(await readFile(join(repository, "user-untracked.txt"), "utf8"), "keep untracked\n");
  const status = await executeFile("git", ["status", "--porcelain"], {
    cwd: repository,
    windowsHide: true,
  });
  assert.match(status.stdout, /A  user-staged\.txt/u);
  assert.match(status.stdout, /\?\? user-untracked\.txt/u);
  const evidence = JSON.parse(
    await readFile(
      join(repository, ".sayhi", "tasks", "archive", FOUNDATION_TASK.taskId, "evidence", "commit.json"),
      "utf8",
    ),
  ) as { commit: string; paths: readonly string[] };
  assert.equal(evidence.commit, result.commit);
  assert.deepEqual(evidence.paths, ["packages/core/foundation.ts"]);
  const finish = JSON.parse(
    await readFile(
      join(repository, ".sayhi", "tasks", "archive", FOUNDATION_TASK.taskId, "finish.json"),
      "utf8",
    ),
  ) as {
    taskId: string;
    commit: string;
    knowledge: { disposition: string; candidates: readonly unknown[] };
    journal: { taskId: string; commit: string };
    tracker: { disposition: string };
  };
  assert.equal(finish.taskId, FOUNDATION_TASK.taskId);
  assert.equal(finish.commit, result.commit);
  assert.equal(finish.knowledge.disposition, "deferred");
  assert.deepEqual(finish.knowledge.candidates, []);
  assert.equal(finish.journal.taskId, FOUNDATION_TASK.taskId);
  assert.equal(finish.journal.commit, result.commit);
  assert.equal(finish.tracker.disposition, "not-requested");
});

test("Core recovers a committed Task after commit Evidence persistence fails", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-commit-recovery-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await prepareScopedFinishTask(repository);
  const fileSystem = new FailingNodeManagedProjectFileSystem(repository);
  const evidencePath = `.sayhi/tasks/${FOUNDATION_TASK.taskId}/evidence/commit.json`;
  fileSystem.failNextWrite(evidencePath);
  const headBefore = await readGitHead(repository);
  const first = await coreContract.finishDurableTaskCommit({
    fileSystem,
    git: fileSystem,
    taskId: FOUNDATION_TASK.taskId,
    event: taskLifecycleEventMetadata(
      FOUNDATION_TASK,
      "FINISH-RECOVERY",
      "2026-07-17T12:03:00Z",
    ),
  });
  assert.equal(first.ok, false);
  assert.notEqual(await readGitHead(repository), headBefore);
  const finishPath = join(repository, ".sayhi", "tasks", FOUNDATION_TASK.taskId, "finish.json");
  const finish = JSON.parse(await readFile(finishPath, "utf8")) as {
    baseline: { head: string | null };
  };
  finish.baseline.head = "a".repeat(40);
  await writeFile(finishPath, `${JSON.stringify(finish, null, 2)}\n`, "utf8");

  const recovered = await coreContract.finishDurableTaskCommit({
    fileSystem,
    git: fileSystem,
    taskId: FOUNDATION_TASK.taskId,
    event: taskLifecycleEventMetadata(
      FOUNDATION_TASK,
      "FINISH-RECOVERY",
      "2026-07-17T12:03:00Z",
    ),
  });
  if (!recovered.ok) {
    assert.fail(
      `${recovered.diagnostics[0]?.code ?? "unknown"}: ${recovered.diagnostics[0]?.message ?? "Task commit recovery failed"}`,
    );
  }
  assert.equal(recovered.state.projection.lifecycle, "archived");
  const evidence = JSON.parse(
    await readFile(
      join(repository, ".sayhi", "tasks", "archive", FOUNDATION_TASK.taskId, "evidence", "commit.json"),
      "utf8",
    ),
  ) as { commit: string; parent: string };
  assert.equal(evidence.commit, await readGitHead(repository));
  assert.equal(evidence.parent, headBefore);
});

test("Core rejects a tampered prepared Finish record before Git commit", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-commit-tampered-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await prepareScopedFinishTask(repository);
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const event = taskLifecycleEventMetadata(
    FOUNDATION_TASK,
    "FINISH-TAMPERED",
    "2026-07-17T12:03:00Z",
  );
  const prepared = await coreContract.finishDurableTaskCommit({
    fileSystem,
    git: {
      inspectRepository: () => fileSystem.inspectRepository(),
      async commit() {
        throw new Error("Injected Git failure after Finish record persistence");
      },
    },
    taskId: FOUNDATION_TASK.taskId,
    event,
  });
  assert.equal(prepared.ok, false);
  const finishPath = join(repository, ".sayhi", "tasks", FOUNDATION_TASK.taskId, "finish.json");
  const finish = JSON.parse(await readFile(finishPath, "utf8")) as {
    paths: string[];
    baseline: { trackedWorktreeDigest: string };
  };
  const originalPaths = [...finish.paths];
  finish.paths = ["unrelated-user-work.txt"];
  await writeFile(finishPath, `${JSON.stringify(finish, null, 2)}\n`, "utf8");

  const rejectedPaths = await coreContract.finishDurableTaskCommit({
    fileSystem,
    git: fileSystem,
    taskId: FOUNDATION_TASK.taskId,
    event,
  });
  assert.equal(rejectedPaths.ok, false);
  if (rejectedPaths.ok) {
    return;
  }
  assert.equal(rejectedPaths.diagnostics[0]?.code, "task_commit.evidence.invalid");
  assert.equal(await readGitHead(repository), (await fileSystem.inspectRepository()).head);

  finish.paths = originalPaths;
  finish.baseline.trackedWorktreeDigest = `sha256:${"a".repeat(64)}`;
  await writeFile(finishPath, `${JSON.stringify(finish, null, 2)}\n`, "utf8");
  const rejectedBaseline = await coreContract.finishDurableTaskCommit({
    fileSystem,
    git: fileSystem,
    taskId: FOUNDATION_TASK.taskId,
    event,
  });
  assert.equal(rejectedBaseline.ok, false);
  if (rejectedBaseline.ok) {
    return;
  }
  assert.equal(rejectedBaseline.diagnostics[0]?.code, "task_commit.evidence.invalid");
  assert.equal(await readGitHead(repository), (await fileSystem.inspectRepository()).head);
});

test("Core rejects an invalid Finish event before creating a Git commit", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-commit-invalid-event-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await prepareScopedFinishTask(repository);
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const headBefore = await readGitHead(repository);
  const rejected = await coreContract.finishDurableTaskCommit({
    fileSystem,
    git: fileSystem,
    taskId: FOUNDATION_TASK.taskId,
    event: {
      ...taskLifecycleEventMetadata(
        FOUNDATION_TASK,
        "FINISH-INVALID-EVENT",
        "2026-07-17T12:03:00Z",
      ),
      actor: { kind: "orchestrator", id: "", sessionRef: "sayhi-test-session" },
    },
  });
  assert.equal(rejected.ok, false);
  assert.equal(await readGitHead(repository), headBefore);
  assert.equal(
    (await fileSystem.inspect(`.sayhi/tasks/${FOUNDATION_TASK.taskId}/finish.json`)).kind,
    "missing",
  );
});

test("Core rejects a malformed persisted Finish event after completion", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-commit-completed-event-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await prepareScopedFinishTask(repository);
  const fileSystem = new FailingArchiveEventFileSystem(repository);
  fileSystem.failNextArchiveEvent();
  const event = taskLifecycleEventMetadata(
    FOUNDATION_TASK,
    "FINISH-COMPLETED-EVENT",
    "2026-07-17T12:03:00Z",
  );
  const first = await coreContract.finishDurableTaskCommit({
    fileSystem,
    git: fileSystem,
    taskId: FOUNDATION_TASK.taskId,
    event,
  });
  assert.equal(first.ok, false);
  assert.equal(
    (await showTaskState(repository)).projection.lifecycle,
    "completed",
    first.ok
      ? "Finish unexpectedly archived despite injected archive Event failure"
      : `${first.diagnostics[0]?.code ?? "unknown"}: ${first.diagnostics[0]?.message ?? "Finish failed"}`,
  );
  const finishPath = join(repository, ".sayhi", "tasks", FOUNDATION_TASK.taskId, "finish.json");
  const finish = JSON.parse(await readFile(finishPath, "utf8")) as {
    completionEvent: { actor: { id: string } };
  };
  finish.completionEvent.actor.id = "";
  await writeFile(finishPath, `${JSON.stringify(finish, null, 2)}\n`, "utf8");

  const rejected = await coreContract.finishDurableTaskCommit({
    fileSystem,
    git: fileSystem,
    taskId: FOUNDATION_TASK.taskId,
    event,
  });
  assert.equal(rejected.ok, false);
  if (rejected.ok) {
    return;
  }
  assert.equal(rejected.diagnostics[0]?.code, "task_commit.evidence.invalid");
  assert.equal((await showTaskState(repository)).projection.lifecycle, "completed");
});

test("packed artifacts execute the installed Quick and Build contract matrix", async (t) => {
  if (process.env.SAYHI_INSTALLED_CONTRACTS === "1") {
    t.skip("Executed by the outer installed contract matrix.");
    return;
  }
  const workspace = await mkdtemp(join(tmpdir(), "sayhi-packed-artifacts-"));
  t.after(async () => rm(workspace, { recursive: true, force: true }));

  const tarballs = await packArtifactPackages(workspace);
  const installation = join(workspace, "installation");
  await installArtifactPackages(installation, tarballs);
  await runInstalledContractMatrix(installation);
});

test("packaged CLI refuses destructive Git requests without changing repository state", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-prohibited-git-cli-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await runGit(repository, "init", "--quiet");
  await runGit(repository, "config", "user.email", "sayhi-tests@example.test");
  await runGit(repository, "config", "user.name", "SayHi Tests");
  await writeFile(join(repository, "README.md"), "protected Git fixture\n", "utf8");
  await runGit(repository, "add", "README.md");
  await runGit(repository, "commit", "--quiet", "-m", "initial state");

  const headBefore = await readGitHead(repository);
  for (const operation of [
    "push",
    "reset",
    "stash",
    "rebase",
    "revert",
    "force-checkout",
  ]) {
    const rejected = await executeCliResult(
      "task",
      operation,
      "--cwd",
      repository,
      "--json",
    );
    assert.equal(rejected.exitCode, 2, operation);
    assert.equal(readCliErrorCode(JSON.parse(rejected.stdout)), "cli.arguments.invalid", operation);
    assert.equal(await readGitHead(repository), headBefore, operation);
  }
  const status = await executeFile("git", ["status", "--porcelain"], {
    cwd: repository,
    windowsHide: true,
  });
  assert.equal(status.stdout, "");
});
class FailingNodeManagedProjectFileSystem extends NodeManagedProjectFileSystem {
  #writeFailure: string | null = null;
  #removalFailure: string | null = null;

  failNextWrite(path: string): void {
    this.#writeFailure = path;
  }

  failNextRemoval(path: string): void {
    this.#removalFailure = path;
  }

  override async writeFile(path: string, content: string): Promise<void> {
    if (path === this.#writeFailure) {
      this.#writeFailure = null;
      throw new Error(`Injected write failure: ${path}`);
    }
    await super.writeFile(path, content);
  }

  override async removeFile(path: string): Promise<void> {
    if (path === this.#removalFailure) {
      this.#removalFailure = null;
      throw new Error(`Injected removal failure: ${path}`);
    }
    await super.removeFile(path);
  }
}

class FailingArchiveEventFileSystem extends NodeManagedProjectFileSystem {
  #failArchiveEvent = false;

  failNextArchiveEvent(): void {
    this.#failArchiveEvent = true;
  }

  override async appendFile(path: string, content: string): Promise<void> {
    if (this.#failArchiveEvent && content.includes('"lifecycle":"archived"')) {
      this.#failArchiveEvent = false;
      throw new Error("Injected archive Event failure");
    }
    await super.appendFile(path, content);
  }
}


async function prepareScopedFinishTask(repository: string): Promise<WorkflowState> {
  await runGit(repository, "init", "--quiet");
  await runGit(repository, "config", "user.email", "sayhi-tests@example.test");
  await runGit(repository, "config", "user.name", "SayHi Tests");
  await mkdir(join(repository, "packages", "core"), { recursive: true });
  await writeFile(
    join(repository, "packages", "core", "foundation.ts"),
    "export const foundation = 'clean';\n",
    "utf8",
  );
  const initialized = await executeCliResult("init", "--cwd", repository, "--json");
  const start = taskLifecycleStartRequest(FOUNDATION_TASK, "2026-07-17T12:00:00Z");
  await writeTaskRequest(repository, "task-create.json", {
    ...start,
    task: {
      ...start.task,
      policies: { ...start.task.policies, commit: "auto-after-review" },
    },
  });
  assert.equal(initialized.exitCode, 0);
  await runGit(repository, "add", ".");
  await runGit(repository, "commit", "--quiet", "-m", "initial state");
  await writeFile(
    join(repository, "packages", "core", "foundation.ts"),
    "export const foundation = 'adopted';\n",
    "utf8",
  );
  const created = await executeCliResult(
    "task",
    "create",
    "--from",
    "task-create.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(created.exitCode, 0);
  const adopted = await executeCliResult(
    "task",
    "adopt",
    FOUNDATION_TASK.taskId,
    "packages/core/foundation.ts",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(adopted.exitCode, 0);
  let state = await showTaskState(repository);
  state = await advanceFoundationTask(
    repository,
    state,
    [
      ["active", "explore"],
      ["active", "plan"],
      ["active", "implement"],
    ],
    "2026-07-17T12:01:00Z",
  );
  const changed = await withDurableTaskWriter({
    fileSystem: new NodeManagedProjectFileSystem(repository),
    taskId: FOUNDATION_TASK.taskId,
    expectedVersion: state.projection.version,
    operation: (writer) =>
      writer.writeFile(
        "packages/core/foundation.ts",
        "export const foundation = 'committed';\n",
      ),
  });
  if (!changed.ok) {
    assert.fail(changed.diagnostics[0]?.message ?? "Scoped Writer unexpectedly failed");
  }
  state = await advanceFoundationTask(
    repository,
    state,
    [
      ["active", "review"],
      ["active", "finish"],
    ],
    "2026-07-17T12:02:00Z",
  );
  assert.equal(state.projection.phase, "finish");
  return state;
}

async function showTaskState(repository: string): Promise<WorkflowState> {
  const shown = await executeCliResult(
    "task",
    "show",
    FOUNDATION_TASK.taskId,
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(shown.exitCode, 0);
  const envelope = JSON.parse(shown.stdout) as CliJsonEnvelope;
  return {
    projection: envelope.result?.projection as WorkflowState["projection"],
    events: envelope.result?.events as WorkflowState["events"],
  };
}

function createChangedQuickCompletion(
  fixture: TaskLifecycleFixture,
  startTimestamp: string,
  transitionTimestamp: string,
) {
  const buildStart = taskLifecycleStartRequest(fixture, startTimestamp);
  const start = {
    ...buildStart,
    task: { ...buildStart.task, route: "quick" as const },
  };
  const created = coreContract.startWorkflowTask(start);
  if (!created.ok) {
    throw new Error(created.diagnostics[0]?.message ?? "Quick creation failed");
  }
  let completedState = created.state;
  const transitions = [];
  for (const [lifecycle, phase, suffix] of [
    ["active", "implement", "IMPLEMENT"],
    ["active", "review", "REVIEW"],
    ["active", "finish", "FINISH"],
    ["completed", "finish", "COMPLETE"],
  ] as const) {
    const transition = taskLifecycleTransition(
      fixture,
      completedState,
      lifecycle,
      phase,
      suffix,
      transitionTimestamp,
    );
    transitions.push(transition);
    const advanced = coreContract.transitionWorkflow(completedState, transition);
    if (!advanced.ok) {
      throw new Error(advanced.diagnostics[0]?.message ?? "Quick transition failed");
    }
    completedState = advanced.state;
  }
  return Object.freeze({
    start,
    transitions: Object.freeze(transitions),
    completedState,
  });
}

async function writeTaskRequest(
  repository: string,
  path: string,
  request: object,
): Promise<void> {
  await writeFile(
    join(repository, path),
    `${JSON.stringify(request, null, 2)}\n`,
    "utf8",
  );
}

async function advanceFoundationTask(
  repository: string,
  initialState: WorkflowState,
  transitions: readonly (readonly [WorkflowLifecycle, WorkflowPhase])[],
  occurredAt: string,
): Promise<WorkflowState> {
  let state = initialState;
  for (const [lifecycle, phase] of transitions) {
    if (
      state.projection.route === "build" &&
      state.projection.lifecycle === "active" &&
      state.projection.phase === "plan" &&
      lifecycle === "active" &&
      phase === "implement"
    ) {
      state = await approveFoundationPlan(repository, state, occurredAt);
      continue;
    }
    if (
      state.projection.route === "build" &&
      state.projection.lifecycle === "active" &&
      state.projection.phase === "implement" &&
      lifecycle === "active" &&
      phase === "review"
    ) {
      state = await recordFoundationPhaseResult(
        repository,
        state,
        "implement",
        IMPLEMENTATION_AGENT,
        occurredAt,
      );
    }
    if (
      state.projection.route === "build" &&
      state.projection.lifecycle === "active" &&
      state.projection.phase === "review" &&
      lifecycle === "active" &&
      phase === "finish"
    ) {
      for (const reviewAgent of REVIEW_AGENTS) {
        state = await recordFoundationPhaseResult(
          repository,
          state,
          "review",
          reviewAgent,
          occurredAt,
        );
      }
    }

    await writeTaskRequest(
      repository,
      ".sayhi/.runtime/task-transition.json",
      taskLifecycleTransition(
        FOUNDATION_TASK,
        state,
        lifecycle,
        phase,
        `${lifecycle}-${phase}`,
        occurredAt,
      ),
    );
    const advanced = await executeCliResult(
      "task",
      "advance",
      FOUNDATION_TASK.taskId,
      "--from",
      ".sayhi/.runtime/task-transition.json",
      "--cwd",
      repository,
      "--json",
    );
    assert.equal(advanced.exitCode, 0);
    state = await showTaskState(repository);
    assert.equal(state.projection.eventHead.sequence, state.events.length);
  }
  return state;
}

async function approveFoundationPlan(
  repository: string,
  state: WorkflowState,
  occurredAt: string,
): Promise<WorkflowState> {
  const frozen = await executeCliResult(
    "context",
    "freeze",
    FOUNDATION_TASK.taskId,
    "implement",
    "--apply",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(frozen.exitCode, 0);
  const frozenState = await showTaskState(repository);
  assert.equal(frozenState.projection.version > state.projection.version, true);

  const planEventSuffix = `${state.projection.version}`;
  await writeTaskRequest(repository, ".sayhi/.runtime/plan-record.json", {
    taskId: FOUNDATION_TASK.taskId,
    expectedVersion: frozenState.projection.version,
    content: "# Foundation Implementation Plan\n\nAdvance only after human approval.\n",
    event: {
      eventId: `EVENT-${FOUNDATION_TASK.eventNamespace}-PLAN-RECORDED-${planEventSuffix}`,
      actor: { kind: "agent", id: "planning-agent", sessionRef: FOUNDATION_TASK.sessionRef },
      reason: "Record the Foundation implementation Plan.",
      idempotencyKey: `IDEMPOTENCY-${FOUNDATION_TASK.eventNamespace}-PLAN-RECORDED-${planEventSuffix}`,
      occurredAt,
    },
  });
  const recorded = await executeCliResult(
    "plan",
    "record",
    FOUNDATION_TASK.taskId,
    "--from",
    ".sayhi/.runtime/plan-record.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(recorded.exitCode, 0);
  const recordedEnvelope = requireRecord(JSON.parse(recorded.stdout), "Plan record envelope");
  const recordedResult = requireRecord(recordedEnvelope.result, "Plan record result");
  const recordedProjection = requireRecord(
    recordedResult.projection,
    "Plan record Projection",
  );
  const recordedVersion = requireVersion(recordedProjection, "version");
  const plan = requireRecord(recordedResult.plan, "Recorded Plan");

  await writeTaskRequest(repository, ".sayhi/.runtime/plan-decision.json", {
    taskId: FOUNDATION_TASK.taskId,
    expectedVersion: recordedVersion,
    planIdentity: requireString(plan, "identity"),
    contextManifestIdentity: requireString(plan, "contextManifestIdentity"),
    event: {
      eventId: `EVENT-${FOUNDATION_TASK.eventNamespace}-PLAN-APPROVED-${planEventSuffix}`,
      actor: { kind: "user", id: "foundation-reviewer", sessionRef: FOUNDATION_TASK.sessionRef },
      reason: "Approve the Foundation implementation Plan.",
      idempotencyKey: `IDEMPOTENCY-${FOUNDATION_TASK.eventNamespace}-PLAN-APPROVED-${planEventSuffix}`,
      occurredAt,
    },
  });
  const approved = await executeCliResult(
    "plan",
    "approve",
    FOUNDATION_TASK.taskId,
    "--from",
    ".sayhi/.runtime/plan-decision.json",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(approved.exitCode, 0);
  const approvedEnvelope = requireRecord(JSON.parse(approved.stdout), "Plan approval envelope");
  const approvedResult = requireRecord(approvedEnvelope.result, "Plan approval result");
  const approvedProjection = requireRecord(approvedResult.projection, "Plan approval Projection");
  assert.equal(requireString(approvedProjection, "phase"), "implement");
  return showTaskState(repository);
}

async function recordFoundationPhaseResult(
  repository: string,
  state: WorkflowState,
  phase: "implement" | "review",
  agent: TestPhaseAgent,
  occurredAt: string,
): Promise<WorkflowState> {
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const material = foundationBuildPlanMaterial(state);
  const manifest = await coreContract.inspectDurableContextManifest({
    fileSystem,
    taskId: FOUNDATION_TASK.taskId,
    phase: "implement",
  });
  if (!manifest.ok || manifest.state !== "valid") {
    assert.fail("Foundation Implement Context Manifest was not valid");
  }
  const currentContext = await Promise.all(
    manifest.entries.map(async (entry) => ({
      source: entry.source,
      content: await fileSystem.readRepositoryFile(entry.source.value),
    })),
  );
  const suffix = `${state.projection.version}-${agent.role}`;
  return recordTestPhaseResult({
    fileSystem,
    fixture: FOUNDATION_TASK,
    planIdentity: material.planIdentity,
    contextManifestIdentity: material.contextManifestIdentity,
    state,
    phase,
    agent,
    materials: {
      manifest: manifest.entries,
      currentContext,
    },
    outcome: "succeeded",
    suffix,
    occurredAt,
  });
}

function foundationBuildPlanMaterial(
  state: WorkflowState,
): Readonly<{
  planIdentity: ContractIdentity;
  contextManifestIdentity: ContractIdentity;
}> {
  const approval = [...state.events]
    .reverse()
    .find(
      (event) =>
        event.type === "workflow_transitioned" &&
        event.from.phase === "plan" &&
        event.to.phase === "implement",
    );
  assert.ok(approval, "Foundation Build Plan approval Event is missing");
  const planReference = approval.gates
    .find((gate) => gate.gate === "plan")
    ?.evidence.find((evidence) => evidence.reference.startsWith("plans/"));
  const contextReference = approval.gates
    .find((gate) => gate.gate === "plan")
    ?.evidence.find((evidence) =>
      evidence.reference.startsWith("context/implement.jsonl#"),
    );
  assert.ok(planReference, "Foundation Build Plan reference is missing");
  assert.ok(contextReference, "Foundation Context reference is missing");
  return {
    planIdentity: `sha256:${planReference.reference.slice("plans/".length, -".json".length)}` as ContractIdentity,
    contextManifestIdentity: contextReference.reference.slice(
      "context/implement.jsonl#".length,
    ) as ContractIdentity,
  };
}

async function executeCli(...args: readonly string[]) {
  return executeCliWithEnvironment(process.env, ...args);
}

async function runGit(repository: string, ...args: readonly string[]) {
  await executeFile("git", args, { cwd: repository, windowsHide: true });
}

interface CliProcessOutput {
  readonly stdout: string;
  readonly stderr: string;
}

async function executeCliResult(...args: readonly string[]) {
  return executeCliResultFor(() => executeCli(...args));
}

async function executeCliWithEnvironment(
  environment: NodeJS.ProcessEnv,
  ...args: readonly string[]
) {
  return executeFile(process.execPath, [CLI_BINARY, ...args], { env: environment });
}

async function executeCliResultWithEnvironment(
  environment: NodeJS.ProcessEnv,
  ...args: readonly string[]
) {
  return executeCliResultFor(() => executeCliWithEnvironment(environment, ...args));
}

async function executeCliResultFor(
  execute: () => Promise<CliProcessOutput>,
) {
  try {
    const result = await execute();
    return Object.freeze({ exitCode: 0, stdout: result.stdout, stderr: result.stderr });
  } catch (error: unknown) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      "stdout" in error &&
      "stderr" in error &&
      typeof error.code === "number" &&
      typeof error.stdout === "string" &&
      typeof error.stderr === "string"
    ) {
      return Object.freeze({
        exitCode: error.code,
        stdout: error.stdout,
        stderr: error.stderr,
      });
    }
    throw error;
  }
}

function assertManagedProjectOperationFailsRecoverably(
  result: ApplyManagedProjectPlanResult,
): void {
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.diagnostics[0]?.code, "managed_project.io_failed");
  assert.match(result.diagnostics[0]?.remediation ?? "", /recover/u);
}

async function recoverManagedProjectOperationWithCli(
  repository: string,
  operation: "update" | "uninstall",
): Promise<void> {
  await readFile(join(repository, MANAGED_PROJECT_OPERATION_JOURNAL_PATH), "utf8");
  const recovered = await executeCliResult(
    operation,
    "--apply",
    "--cwd",
    repository,
    "--json",
  );
  assert.equal(recovered.exitCode, 0);
  await assert.rejects(
    readFile(join(repository, MANAGED_PROJECT_OPERATION_JOURNAL_PATH), "utf8"),
  );
}


async function readGitHead(repository: string): Promise<string> {
  const result = await executeFile("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function createInitializedManagedProject(
  directoryPrefix: string,
  beforeInitialization?: (repository: string) => Promise<void>,
): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), directoryPrefix));
  await mkdir(join(repository, ".git"));
  if (beforeInitialization !== undefined) {
    await beforeInitialization(repository);
  }
  const initialized = await executeCliResult("init", "--cwd", repository, "--json");
  assert.equal(initialized.exitCode, 0);
  return repository;
}

async function downgradeManagedProjectToLegacyRuntimeTemplate(repository: string): Promise<void> {
  const runtimeIgnorePath = join(repository, ".sayhi", ".gitignore");
  const ownershipPath = join(repository, ".sayhi", "managed-files.json");
  const manifestPath = join(repository, ".sayhi", "manifest.json");
  await writeFile(runtimeIgnorePath, LEGACY_RUNTIME_IGNORE_CONTENT, "utf8");

  const ownership = requireRecord(
    JSON.parse(await readFile(ownershipPath, "utf8")),
    "Ownership Manifest",
  );
  assert.ok(Array.isArray(ownership.files));
  const runtimeRecord = ownership.files
    .map((record) => requireRecord(record, "Ownership record"))
    .find((record) => record.path === ".sayhi/.gitignore");
  assert.ok(runtimeRecord);
  const installedBaseIdentity = requireRecord(
    runtimeRecord.installedBaseIdentity,
    "Runtime ignore installed base identity",
  );
  installedBaseIdentity.digest = createHash("sha256")
    .update(LEGACY_RUNTIME_IGNORE_CONTENT)
    .digest("hex");
  runtimeRecord.generatedSourceVersion = "0.0.0";
  await writeFile(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`, "utf8");

  const manifest = requireRecord(
    JSON.parse(await readFile(manifestPath, "utf8")),
    "Project Manifest",
  );
  const installed = requireRecord(manifest.installed, "Installed versions");
  installed.templates = "0.0.0";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function readManagedProjectOwnership(
  repository: string,
): Promise<ReadonlyMap<string, Record<string, unknown>>> {
  const ownership = requireRecord(
    JSON.parse(await readFile(join(repository, ".sayhi", "managed-files.json"), "utf8")),
    "Ownership Manifest",
  );
  assert.ok(Array.isArray(ownership.files));
  const records = new Map<string, Record<string, unknown>>();
  for (const value of ownership.files) {
    const record = requireRecord(value, "Ownership record");
    const path = requireString(record, "path");
    assert.equal(records.has(path), false, `Duplicate ownership record: ${path}`);
    records.set(path, record);
  }
  return records;
}

async function snapshotRepositoryFiles(repository: string): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  await collectRepositoryFiles(repository, repository, files);
  return files;
}

async function collectRepositoryFiles(
  repository: string,
  directory: string,
  files: Map<string, string>,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectRepositoryFiles(repository, path, files);
      continue;
    }
    if (entry.isFile()) {
      files.set(path.slice(repository.length + 1), await readFile(path, "utf8"));
    }
  }
}

function assertQuickProjection(value: unknown, lifecycle: "completed" | "archived"): void {
  assert.ok(value !== null && typeof value === "object");
  assert.ok("route" in value && "lifecycle" in value && "phase" in value);
  assert.equal(value.route, "quick");
  assert.equal(value.lifecycle, lifecycle);
  assert.equal(value.phase, "finish");
}

function quickEventPhases(value: unknown): readonly string[] {
  assert.ok(Array.isArray(value));
  return value.map((event) => {
    assert.ok(event !== null && typeof event === "object");
    assert.ok("to" in event);
    const to = event.to;
    assert.ok(to !== null && typeof to === "object" && "phase" in to);
    assert.equal(typeof to.phase, "string");
    return to.phase;
  });
}


function readCliErrorCode(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || !("error" in value)) {
    return undefined;
  }
  const error = value.error;
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
function readCliResult(value: unknown): unknown {
  assert.ok(value !== null && typeof value === "object" && "result" in value);
  return value.result;
}

function readCliProjection(value: unknown): unknown {
  const result = readCliResult(value);
  assert.ok(result !== null && typeof result === "object" && "projection" in result);
  return result.projection;
}

function withoutQuickOutcome(source: string): string {
  const value: unknown = JSON.parse(source);
  assert.ok(value !== null && typeof value === "object" && "outcome" in value);
  delete value.outcome;
  return `${JSON.stringify(value)}\n`;
}

async function locateQuickAuditFile(
  auditRoot: string,
  location: "active" | "archive",
): Promise<string> {
  const repositoryDirectories = await readdir(join(auditRoot, "quick"), {
    withFileTypes: true,
  });
  const repositoryDirectory = repositoryDirectories.find((entry) => entry.isDirectory());
  assert.ok(repositoryDirectory);
  const auditDirectory = join(auditRoot, "quick", repositoryDirectory.name, location);
  const auditFiles = await readdir(auditDirectory, { withFileTypes: true });
  const auditFile = auditFiles.find((entry) => entry.isFile());
  assert.ok(auditFile);
  return join(auditDirectory, auditFile.name);
}

const PACKAGED_ARTIFACT_DIRECTORIES = Object.freeze({
  cli: fileURLToPath(new URL("../../cli/", import.meta.url)),
  core: fileURLToPath(new URL("../../core/", import.meta.url)),
  omp: fileURLToPath(new URL("../../omp-plugin/", import.meta.url)),
  testing: fileURLToPath(new URL("../../testing/", import.meta.url)),
});

async function packArtifactPackages(workspace: string): Promise<readonly string[]> {
  return Promise.all(
    Object.entries(PACKAGED_ARTIFACT_DIRECTORIES).map(async ([name, source]) => {
      const staging = join(workspace, "packages", name);
      await mkdir(staging, { recursive: true });
      await Promise.all(
        [
          "package.json",
          ...(name === "testing" ? [] : ["LICENSE", "THIRD_PARTY_NOTICES.md"]),
          ...(name === "omp" ? ["README.md"] : []),
        ].map(
          async (file) => cp(join(source, file), join(staging, file)),
        ),
      );
      await cp(join(source, "dist"), join(staging, "dist"), { recursive: true });
      const packed = await executeFile(
        NPM_EXECUTABLE,
        npmArguments(["pack", "--json"]),
        {
          cwd: staging,
          windowsHide: true,
        },
      );
      const packageManifest = JSON.parse(packed.stdout) as readonly {
        readonly files: readonly Readonly<{ readonly path: string }>[];
      }[];
      const packagedPaths = packageManifest[0]?.files.map((file) => file.path);
      assert.ok(packagedPaths, `Packed ${name} artifact is missing its file manifest.`);
      if (name !== "testing") {
        assert.equal(packagedPaths.includes("LICENSE"), true);
        assert.equal(packagedPaths.includes("THIRD_PARTY_NOTICES.md"), true);
      }
      if (name === "omp") {
        assert.equal(packagedPaths.includes("README.md"), true);
        assert.equal(
          packagedPaths.some((path) => path.endsWith(".tsbuildinfo")),
          false,
        );
      }
      const tarball = (await readdir(staging)).find((entry) => entry.endsWith(".tgz"));
      assert.ok(tarball, `Packed ${name} artifact is missing.`);
      return join(staging, tarball);
    }),
  );
}

async function installArtifactPackages(
  installation: string,
  tarballs: readonly string[],
): Promise<void> {
  await mkdir(installation, { recursive: true });
  await writeFile(
    join(installation, "package.json"),
    '{"name":"sayhi-packed-fixture","private":true,"type":"module"}\n',
    "utf8",
  );
  await executeFile(
    NPM_EXECUTABLE,
    npmArguments([
      "install",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      "--no-save",
      ...tarballs,
    ]),
    { cwd: installation, windowsHide: true },
  );
}


async function runInstalledContractMatrix(installation: string): Promise<void> {
  const testDirectory = join(installation, "node_modules", "@sayhi", "testing", "dist");
  const runner = join(installation, "installed-contract-matrix.mjs");
  await writeFile(
    runner,
    INSTALLED_CONTRACT_FILES.map(
      (file) => `import "./node_modules/@sayhi/testing/dist/${file}";`,
    ).join("\n"),
    "utf8",
  );
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const result = await executeFile(process.execPath, ["--test", runner], {
    cwd: installation,
    env: { ...environment, SAYHI_INSTALLED_CONTRACTS: "1" },
    windowsHide: true,
  });
  assert.match(`${result.stdout}${result.stderr}`, /tests [1-9]\d*/u, result.stderr);
}
