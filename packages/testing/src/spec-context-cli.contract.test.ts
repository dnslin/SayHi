import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  NodeManagedProjectFileSystem,
  runCli,
  type CliJsonEnvelope,
} from "@dnslin/sayhi-cli";
import { createDurableTask } from "@dnslin/sayhi-core";

import {
  taskLifecycleStartRequest,
  type TaskLifecycleFixture,
} from "./task-lifecycle-test-support.js";

const IMPACT_TASK = Object.freeze({
  taskId: "TASK-12-IMPACT",
  title: "Inspect impacted Specs",
  goal: "Report Tasks bound to changed Specs",
  acceptanceCriterion: "Stale binding is visible through the CLI",
  files: Object.freeze(["packages/core/**", "packages/cli/**"]),
  eventNamespace: "12-IMPACT",
  sessionRef: "session-12-impact",
}) satisfies TaskLifecycleFixture;


test("CLI creates and inspects a valid Spec from repository context", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-spec-cli-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  await mkdir(join(repository, "docs"));
  await writeFile(
    join(repository, "docs", "accepted-api.md"),
    "# Accepted API\n\nUse stable identifiers.\n",
    "utf8",
  );
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  const missingDryRun = await runCli([
    "spec",
    "create",
    "missing.md",
    "--from",
    "docs/missing.md",
    "--dry-run",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(missingDryRun.exitCode, 3);
  const missingDryRunEnvelope = JSON.parse(
    missingDryRun.stdout,
  ) as CliJsonEnvelope;
  assert.equal(missingDryRunEnvelope.error?.code, "spec.source.unreadable");

  const created = await runCli([
    "spec",
    "create",
    "api.md",
    "--from",
    "docs/accepted-api.md",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(created.exitCode, 0);
  const createdEnvelope = JSON.parse(created.stdout) as CliJsonEnvelope;
  assert.equal(createdEnvelope.ok, true);
  assert.equal(createdEnvelope.operation, "spec.create");
  assert.equal(createdEnvelope.result?.path, ".sayhi/spec/api.md");
  assert.equal(
    await readFile(join(repository, ".sayhi", "spec", "api.md"), "utf8"),
    "# Accepted API\n\nUse stable identifiers.\n",
  );

  const listed = await runCli([
    "spec",
    "list",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(listed.exitCode, 0);
  const listedEnvelope = JSON.parse(listed.stdout) as CliJsonEnvelope;
  assert.deepEqual(listedEnvelope.result?.paths, [".sayhi/spec/api.md"]);

  const shown = await runCli([
    "spec",
    "show",
    "api.md",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(shown.exitCode, 0);
  const shownEnvelope = JSON.parse(shown.stdout) as CliJsonEnvelope;
  assert.equal(shownEnvelope.result?.content, "# Accepted API\n\nUse stable identifiers.\n");
  const humanShown = await runCli([
    "spec",
    "show",
    "api.md",
    "--cwd",
    repository,
  ]);
  assert.equal(humanShown.exitCode, 0);
  assert.match(humanShown.stdout, /Use stable identifiers/u);

  const validated = await runCli([
    "spec",
    "validate",
    "api.md",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(validated.exitCode, 0);
  const validatedEnvelope = JSON.parse(validated.stdout) as CliJsonEnvelope;
  assert.equal(validatedEnvelope.operation, "spec.validate");
  assert.equal(validatedEnvelope.result?.state, "valid");
});

test("CLI shows valid and stale Context bindings impacted by a Spec", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-spec-impact-cli-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  await mkdir(join(repository, "docs"));
  await writeFile(
    join(repository, "docs", "accepted-api.md"),
    "# Accepted API\n\nUse stable identifiers.\n",
    "utf8",
  );
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  assert.equal(
    (
      await runCli([
        "spec",
        "create",
        "api.md",
        "--from",
        "docs/accepted-api.md",
        "--apply",
        "--cwd",
        repository,
        "--json",
      ])
    ).exitCode,
    0,
  );
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const task = await createDurableTask({
    fileSystem,
    start: taskLifecycleStartRequest(IMPACT_TASK, "2026-07-15T09:30:00Z"),
  });
  assert.equal(task.ok, true);
  assert.equal(
    (
      await runCli([
        "context",
        "add",
        IMPACT_TASK.taskId,
        "implement",
        ".sayhi/spec/api.md",
        "--apply",
        "--cwd",
        repository,
        "--json",
      ])
    ).exitCode,
    0,
  );

  const valid = await runCli([
    "spec",
    "impacted",
    "api.md",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(valid.exitCode, 0);
  const validEnvelope = JSON.parse(valid.stdout) as CliJsonEnvelope;
  assert.deepEqual(validEnvelope.result?.impacts, [
    { taskId: IMPACT_TASK.taskId, phase: "implement", state: "valid" },
  ]);

  await writeFile(
    join(repository, ".sayhi", "spec", "api.md"),
    "# Accepted API\n\nChanged behavior.\n",
    "utf8",
  );
  const stale = await runCli([
    "spec",
    "impacted",
    "api.md",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(stale.exitCode, 0);
  const staleEnvelope = JSON.parse(stale.stdout) as CliJsonEnvelope;
  assert.deepEqual(staleEnvelope.result?.impacts, [
    { taskId: IMPACT_TASK.taskId, phase: "implement", state: "stale" },
  ]);
});
