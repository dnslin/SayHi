import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NodeManagedProjectFileSystem, runCli, type CliJsonEnvelope } from "@dnslin/sayhi-cli";
import { createDurableTask } from "@dnslin/sayhi-core";

import {
  taskLifecycleStartRequest,
  type TaskLifecycleFixture,
} from "./task-lifecycle-test-support.js";

const TASK_ID = "TASK-12-CLI";
const FIXTURE = Object.freeze({
  taskId: TASK_ID,
  title: "Manage Context through the CLI",
  goal: "Bind an Approved Spec to Implement",
  acceptanceCriterion: "CLI persists a hash-bound Context Manifest",
  files: Object.freeze(["packages/core/**", "packages/cli/**"]),
  eventNamespace: "12-CLI",
  sessionRef: "session-12-cli",
}) satisfies TaskLifecycleFixture;
async function createApprovedSpec(
  repository: string,
  content: string,
): Promise<void> {
  await mkdir(join(repository, "docs"), { recursive: true });
  await writeFile(join(repository, "docs", "api-source.md"), content, "utf8");
  const created = await runCli([
    "spec",
    "create",
    "api.md",
    "--from",
    "docs/api-source.md",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(created.exitCode, 0);
}


test("CLI adds, lists, and validates a hash-bound Context Manifest", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-context-cli-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const created = await createDurableTask({
    fileSystem,
    start: taskLifecycleStartRequest(FIXTURE, "2026-07-15T09:00:00Z"),
  });
  assert.equal(created.ok, true);
  await createApprovedSpec(repository, "# API\n\nStable behavior.\n");

  const added = await runCli([
    "context",
    "add",
    TASK_ID,
    "implement",
    ".sayhi/spec/api.md",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(added.exitCode, 0);
  const addedEnvelope = JSON.parse(added.stdout) as CliJsonEnvelope;
  assert.equal(addedEnvelope.operation, "context.add");
  const entry = addedEnvelope.result?.entry as { id: string; trust: string };
  assert.equal(entry.trust, "approved-spec");

  const listed = await runCli([
    "context",
    "list",
    TASK_ID,
    "implement",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(listed.exitCode, 0);
  const listedEnvelope = JSON.parse(listed.stdout) as CliJsonEnvelope;
  assert.equal(listedEnvelope.operation, "context.list");
  const entries = listedEnvelope.result?.entries as readonly { id: string }[];
  assert.deepEqual(entries.map((item) => item.id), [entry.id]);

  const validated = await runCli([
    "context",
    "validate",
    TASK_ID,
    "implement",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(validated.exitCode, 0);
  const validatedEnvelope = JSON.parse(validated.stdout) as CliJsonEnvelope;
  assert.equal(validatedEnvelope.operation, "context.validate");
  assert.equal(validatedEnvelope.result?.state, "valid");
});

test("CLI visibly blocks stale Approved Spec Context until explicit refresh approval", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-context-refresh-cli-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const created = await createDurableTask({
    fileSystem,
    start: taskLifecycleStartRequest(FIXTURE, "2026-07-15T09:10:00Z"),
  });
  assert.equal(created.ok, true);
  await createApprovedSpec(repository, "# API\n\nStable behavior.\n");
  assert.equal(
    (
      await runCli([
        "context",
        "add",
        TASK_ID,
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
  await writeFile(
    join(repository, ".sayhi", "spec", "api.md"),
    "# API\n\nChanged behavior.\n",
    "utf8",
  );

  const stale = await runCli([
    "context",
    "validate",
    TASK_ID,
    "implement",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(stale.exitCode, 3);
  const staleEnvelope = JSON.parse(stale.stdout) as CliJsonEnvelope;
  assert.equal(staleEnvelope.error?.code, "context_manifest.stale");

  const denied = await runCli([
    "context",
    "refresh",
    TASK_ID,
    "implement",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(denied.exitCode, 3);
  const deniedEnvelope = JSON.parse(denied.stdout) as CliJsonEnvelope;
  assert.equal(deniedEnvelope.error?.code, "context_manifest.approval_required");

  const refreshed = await runCli([
    "context",
    "refresh",
    TASK_ID,
    "implement",
    "--apply",
    "--accept-approved-spec-change",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(refreshed.exitCode, 0);
  const refreshedEnvelope = JSON.parse(refreshed.stdout) as CliJsonEnvelope;
  assert.equal(refreshedEnvelope.operation, "context.refresh");
  assert.equal(refreshedEnvelope.result?.state, "refreshed");
});

test("CLI freezes valid Context and removes a Context Entry by ID", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-context-freeze-cli-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const created = await createDurableTask({
    fileSystem,
    start: taskLifecycleStartRequest(FIXTURE, "2026-07-15T09:20:00Z"),
  });
  assert.equal(created.ok, true);
  await createApprovedSpec(repository, "# API\n\nStable behavior.\n");
  const added = await runCli([
    "context",
    "add",
    TASK_ID,
    "implement",
    ".sayhi/spec/api.md",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(added.exitCode, 0);
  const addedEnvelope = JSON.parse(added.stdout) as CliJsonEnvelope;
  const entry = addedEnvelope.result?.entry as { id: string };

  const frozen = await runCli([
    "context",
    "freeze",
    TASK_ID,
    "implement",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(frozen.exitCode, 0);
  const frozenEnvelope = JSON.parse(frozen.stdout) as CliJsonEnvelope;
  assert.equal(frozenEnvelope.result?.state, "frozen");

  const removed = await runCli([
    "context",
    "remove",
    TASK_ID,
    "implement",
    entry.id,
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(removed.exitCode, 0);
  const removedEnvelope = JSON.parse(removed.stdout) as CliJsonEnvelope;
  assert.equal(removedEnvelope.result?.state, "removed");

  const listed = await runCli([
    "context",
    "list",
    TASK_ID,
    "implement",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(listed.exitCode, 0);
  const listedEnvelope = JSON.parse(listed.stdout) as CliJsonEnvelope;
  assert.deepEqual(listedEnvelope.result?.entries, []);
});

test("CLI reports untrusted, missing, and malformed Context without downgrade", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-context-safety-cli-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  await mkdir(join(repository, "notes"));
  await writeFile(join(repository, "notes", "raw.txt"), "Untrusted text.\n", "utf8");
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const created = await createDurableTask({
    fileSystem,
    start: taskLifecycleStartRequest(FIXTURE, "2026-07-15T09:40:00Z"),
  });
  assert.equal(created.ok, true);

  const untrusted = await runCli([
    "context",
    "add",
    TASK_ID,
    "explore",
    "notes/raw.txt",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(untrusted.exitCode, 0);
  const untrustedEnvelope = JSON.parse(untrusted.stdout) as CliJsonEnvelope;
  const entry = untrustedEnvelope.result?.entry as {
    trust: string;
    instructionPolicy: string;
  };
  assert.equal(entry.trust, "untrusted-reference");
  assert.equal(entry.instructionPolicy, "data-only");
  await writeFile(
    join(repository, ".sayhi", "spec", "unapproved.md"),
    "# Unapproved\n",
    "utf8",
  );
  const pathOnly = await runCli([
    "context",
    "add",
    TASK_ID,
    "plan",
    ".sayhi/spec/unapproved.md",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(pathOnly.exitCode, 0);
  const pathOnlyEnvelope = JSON.parse(pathOnly.stdout) as CliJsonEnvelope;
  const pathOnlyEntry = pathOnlyEnvelope.result?.entry as { trust: string };
  assert.equal(pathOnlyEntry.trust, "untrusted-reference");

  const missing = await runCli([
    "context",
    "add",
    TASK_ID,
    "plan",
    ".sayhi/spec/missing.md",
    "--dry-run",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(missing.exitCode, 3);
  const missingEnvelope = JSON.parse(missing.stdout) as CliJsonEnvelope;
  assert.equal(missingEnvelope.error?.code, "context_manifest.source.unreadable");
  assert.match(missingEnvelope.error?.remediation ?? "", /Restore/u);

  await writeFile(
    join(repository, ".sayhi", "tasks", TASK_ID, "context", "explore.jsonl"),
    "{malformed\n",
    "utf8",
  );
  const malformed = await runCli([
    "context",
    "validate",
    TASK_ID,
    "explore",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(malformed.exitCode, 3);
  const malformedEnvelope = JSON.parse(malformed.stdout) as CliJsonEnvelope;
  assert.equal(malformedEnvelope.error?.code, "context_manifest.invalid");
  assert.match(malformedEnvelope.error?.remediation ?? "", /Repair/u);
});
