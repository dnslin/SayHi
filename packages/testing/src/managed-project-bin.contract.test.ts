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
  withDurableTaskWriter,
  type WorkflowLifecycle,
  type WorkflowPhase,
  type WorkflowState,
} from "@dnslin/sayhi-core";

import {
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
  const existingOmpAgents = "user-owned OMP agents\n";
  const existingOmpRules = "user-owned OMP rules\n";
  const existingRootAgents = "user-owned root agents\n";
  await mkdir(join(repository, ".omp"));
  await writeFile(join(repository, ".omp", "AGENTS.md"), existingOmpAgents, "utf8");
  await writeFile(join(repository, ".omp", "RULES.md"), existingOmpRules, "utf8");
  await writeFile(join(repository, "AGENTS.md"), existingRootAgents, "utf8");
  await writeTaskRequest(
    repository,
    "task-create.json",
    taskLifecycleStartRequest(FOUNDATION_TASK, "2026-07-15T12:00:00Z"),
  );

  const initialization = await executeCli("init", "--cwd", repository, "--json");
  assert.equal(initialization.stderr, "");
  const initialized = JSON.parse(initialization.stdout) as CliJsonEnvelope;
  assert.equal(initialized.ok, true);
  assert.equal(initialized.operation, "project.init");
  assert.equal(await readFile(join(repository, ".omp", "AGENTS.md"), "utf8"), existingOmpAgents);
  assert.equal(await readFile(join(repository, ".omp", "RULES.md"), "utf8"), existingOmpRules);
  assert.equal(await readFile(join(repository, "AGENTS.md"), "utf8"), existingRootAgents);
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
  const observedBaseline = (JSON.parse(baseline.stdout) as CliJsonEnvelope).result
    ?.baseline as { dirtyPaths: readonly { path: string }[] };
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
    "task_lifecycle.baseline.missing",
  );
  assert.equal(
    await readFile(join(repository, "packages", "core", "foundation.ts"), "utf8"),
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
  const archivedProjection = archivedEnvelope.result?.projection as { lifecycle: string };
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
  assert.equal(await readFile(join(repository, ".omp", "AGENTS.md"), "utf8"), existingOmpAgents);
  assert.equal(await readFile(join(repository, ".omp", "RULES.md"), "utf8"), existingOmpRules);
  assert.equal(await readFile(join(repository, "AGENTS.md"), "utf8"), existingRootAgents);
  assert.equal(
    await readFile(join(repository, "packages", "core", "foundation.ts"), "utf8"),
    "export const foundation = 'dirty';\n",
  );
  await assert.rejects(readFile(runtimeIgnorePath, "utf8"));
  await assert.rejects(readFile(manifestPath, "utf8"));
  await assert.rejects(readFile(ownershipPath, "utf8"));
});

test("packaged CLI creates and inspects a durable Task", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-task-cli-binary-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  assert.equal((await executeCli("init", "--cwd", repository, "--json")).stderr, "");
  await writeFile(
    join(repository, "task-create.json"),
    `${JSON.stringify(taskLifecycleStartRequest(FOUNDATION_TASK, "2026-07-16T10:00:00Z"), null, 2)}\n`,
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
  assert.equal((await showTaskState(repository)).events.length, state.events.length);

  const staleExplore = {
    ...explore,
    event: {
      ...explore.event,
      eventId: "EVENT-15-FOUNDATION-STALE",
      idempotencyKey: "IDEMPOTENCY-15-FOUNDATION-STALE",
    },
  };
  await writeTaskRequest(repository, "task-stale-transition.json", staleExplore);
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
  assert.equal((await showTaskState(repository)).events.length, state.events.length);

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

  for (const [lifecycle, phase] of [
    ["active", "plan"],
    ["active", "implement"],
    ["active", "review"],
    ["active", "finish"],
    ["completed", "finish"],
  ] as const) {
    const transition = taskLifecycleTransition(
      FOUNDATION_TASK,
      state,
      lifecycle,
      phase,
      `${lifecycle}-${phase}`,
      "2026-07-16T11:02:00Z",
    );
    await writeTaskRequest(repository, "task-transition.json", transition);
    const transitioned = await executeCliResult(
      "task",
      "advance",
      FOUNDATION_TASK.taskId,
      "--from",
      "task-transition.json",
      "--cwd",
      repository,
      "--json",
    );
    assert.equal(transitioned.exitCode, 0);
    state = await showTaskState(repository);
  }
  const archive = taskLifecycleTransition(
    FOUNDATION_TASK,
    state,
    "archived",
    "finish",
    "ARCHIVE",
    "2026-07-16T11:03:00Z",
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
  const dirtyPaths = (baselineEnvelope.result?.baseline as {
    dirtyPaths: readonly { path: string }[];
  }).dirtyPaths;
  assert.deepEqual(dirtyPaths.map((path) => path.path), ["packages/core/foundation.ts"]);

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
  assert.equal(adoptedEnvelope.operation, "task.adopt");
  assert.equal(adoptedEnvelope.result?.appended, true);

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
  const event = JSON.parse((await readFile(eventsPath, "utf8")).trimEnd()) as object;
  const corruptHistory = `${JSON.stringify({ ...event, reason: "tampered" })}\n`;
  await writeFile(eventsPath, corruptHistory, "utf8");
  const projection = await readFile(projectionPath, "utf8");

  const diagnosis = await executeCliResult("doctor", "--cwd", repository, "--json");
  assert.equal(diagnosis.exitCode, 3);
  const envelope = JSON.parse(diagnosis.stdout) as CliJsonEnvelope;
  assert.equal(envelope.error?.code, "workflow.event.chain_invalid");
  assert.equal(await readFile(eventsPath, "utf8"), corruptHistory);
  assert.equal(await readFile(projectionPath, "utf8"), projection);
});

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
    await writeTaskRequest(
      repository,
      "task-transition.json",
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
      "task-transition.json",
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

async function executeCli(...args: readonly string[]) {
  return executeFile(process.execPath, [CLI_BINARY, ...args]);
}

async function runGit(repository: string, ...args: readonly string[]) {
  await executeFile("git", args, { cwd: repository, windowsHide: true });
}

async function executeCliResult(...args: readonly string[]) {
  try {
    const result = await executeCli(...args);
    return Object.freeze({ exitCode: 0, stdout: result.stdout, stderr: result.stderr });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
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
