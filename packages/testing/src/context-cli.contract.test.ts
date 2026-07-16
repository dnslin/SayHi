import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NodeManagedProjectFileSystem, runCli, type CliJsonEnvelope } from "@dnslin/sayhi-cli";
import {
  advanceDurableTask,
  createDurableTask,
  readDurableTask,
} from "@dnslin/sayhi-core";

import {
  taskLifecycleExploreTransition,
  taskLifecycleStartRequest,
  taskLifecycleTransition,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    assert.fail(`${label} must be an object.`);
  }
  return value;
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    assert.fail(`${field} must be a string.`);
  }
  return value;
}

function requireVersion(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    assert.fail(`${field} must be a positive safe integer.`);
  }
  return value;
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

test("CLI records and human-approves a hash-bound Build Plan", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-plan-cli-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  await mkdir(join(repository, "docs"));
  await writeFile(
    join(repository, "docs", "implementation.md"),
    "Stable implementation context.\n",
    "utf8",
  );
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const created = await createDurableTask({
    fileSystem,
    start: taskLifecycleStartRequest(FIXTURE, "2026-07-15T10:00:00Z"),
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const explored = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleExploreTransition(
      FIXTURE,
      created.state.projection.version,
      "EXPLORE",
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
      FIXTURE,
      explored.state,
      "active",
      "plan",
      "PLAN",
      "2026-07-15T10:02:00Z",
    ),
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) {
    return;
  }
  assert.equal(
    (
      await runCli([
        "context",
        "add",
        TASK_ID,
        "implement",
        "docs/implementation.md",
        "--apply",
        "--cwd",
        repository,
        "--json",
      ])
    ).exitCode,
    0,
  );
  assert.equal(
    (
      await runCli([
        "context",
        "freeze",
        TASK_ID,
        "implement",
        "--apply",
        "--cwd",
        repository,
        "--json",
      ])
    ).exitCode,
    0,
  );
  const beforePlan = await readDurableTask({ fileSystem, taskId: TASK_ID });
  assert.equal(beforePlan.ok, true);
  if (!beforePlan.ok) {
    return;
  }
  await writeFile(
    join(repository, "plan-record.json"),
    JSON.stringify({
      taskId: TASK_ID,
      expectedVersion: beforePlan.state.projection.version,
      content: "# Implementation Plan\n\nApprove the exact frozen Context.\n",
      event: {
        eventId: "EVENT-12-CLI-PLAN-RECORDED",
        actor: { kind: "agent", id: "planning-agent", sessionRef: "plan-session" },
        reason: "Record reviewable implementation Plan.",
        idempotencyKey: "IDEMPOTENCY-12-CLI-PLAN-RECORDED",
        occurredAt: "2026-07-15T10:03:00Z",
      },
    }),
    "utf8",
  );
  const recorded = await runCli([
    "plan",
    "record",
    TASK_ID,
    "--from",
    "plan-record.json",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(recorded.exitCode, 0);
  const recordedEnvelope = requireRecord(JSON.parse(recorded.stdout), "Plan record envelope");
  assert.equal(requireString(recordedEnvelope, "operation"), "plan.record");
  const recordedResult = requireRecord(recordedEnvelope.result, "Plan record result");
  const recordedPlanEvent = requireRecord(recordedResult.event, "Plan record Event");
  assert.equal(requireString(recordedPlanEvent, "type"), "build_plan_changed");
  const recordedProjection = requireRecord(recordedResult.projection, "Plan record Projection");
  const recordedVersion = requireVersion(recordedProjection, "version");
  const plan = requireRecord(recordedResult.plan, "Recorded Build Plan");
  const planIdentity = requireString(plan, "identity");
  const contextManifestIdentity = requireString(plan, "contextManifestIdentity");
  assert.deepEqual(plan.requirements, beforePlan.state.projection.intent);
  assert.match(requireString(plan, "content"), /Approve the exact frozen Context/u);

  const approval = {
    taskId: TASK_ID,
    expectedVersion: recordedVersion,
    planIdentity,
    contextManifestIdentity,
    event: {
      eventId: "EVENT-12-CLI-PLAN-DECISION",
      actor: { kind: "user", id: "reviewer-12", sessionRef: "approval-session" },
      reason: "Human decided the implementation Plan.",
      idempotencyKey: "IDEMPOTENCY-12-CLI-PLAN-DECISION",
      occurredAt: "2026-07-15T10:04:00Z",
    },
  };
  await writeFile(
    join(repository, "plan-decision.json"),
    JSON.stringify(approval),
    "utf8",
  );
  const rejected = await runCli([
    "plan",
    "reject",
    TASK_ID,
    "--from",
    "plan-decision.json",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(rejected.exitCode, 0);
  const rejectedEnvelope = requireRecord(JSON.parse(rejected.stdout), "Plan rejection envelope");
  const rejectedResult = requireRecord(rejectedEnvelope.result, "Plan rejection result");
  assert.equal(requireString(rejectedResult, "decision"), "rejected");
  const rejectedEvent = requireRecord(rejectedResult.event, "Plan rejection Event");
  assert.equal(requireString(rejectedEvent, "type"), "build_plan_changed");
  const rejectedProjection = requireRecord(rejectedResult.projection, "Rejected Projection");
  assert.equal(requireString(rejectedProjection, "phase"), "plan");
  const rejectedVersion = requireVersion(rejectedProjection, "version");
  const approvalAfterRejection = {
    ...approval,
    expectedVersion: rejectedVersion,
    event: {
      ...approval.event,
      eventId: "EVENT-12-CLI-PLAN-APPROVED",
      idempotencyKey: "IDEMPOTENCY-12-CLI-PLAN-APPROVED",
      occurredAt: "2026-07-15T10:05:00Z",
    },
  };
  await writeFile(
    join(repository, "plan-decision.json"),
    JSON.stringify(approvalAfterRejection),
    "utf8",
  );

  const rejectedPlanApproval = await runCli([
    "plan",
    "approve",
    TASK_ID,
    "--from",
    "plan-decision.json",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(rejectedPlanApproval.exitCode, 3);
  const rejectedPlanEnvelope = requireRecord(
    JSON.parse(rejectedPlanApproval.stdout),
    "Rejected Plan approval envelope",
  );
  const rejectedPlanError = requireRecord(
    rejectedPlanEnvelope.error,
    "Rejected Plan approval error",
  );
  assert.equal(requireString(rejectedPlanError, "code"), "build_plan.rejected");

  await writeFile(
    join(repository, "plan-record.json"),
    JSON.stringify({
      taskId: TASK_ID,
      expectedVersion: rejectedVersion,
      content: "# Revised CLI Plan\n\nAddress the review feedback before approval.\n",
      event: {
        eventId: "EVENT-12-CLI-PLAN-RECORDED-REVISED",
        actor: { kind: "agent", id: "planner-12", sessionRef: "plan-session" },
        reason: "Record a revised implementation Plan.",
        idempotencyKey: "IDEMPOTENCY-12-CLI-PLAN-RECORDED-REVISED",
        occurredAt: "2026-07-15T10:05:30Z",
      },
    }),
    "utf8",
  );
  const revisedRecorded = await runCli([
    "plan",
    "record",
    TASK_ID,
    "--from",
    "plan-record.json",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(revisedRecorded.exitCode, 0);
  const revisedEnvelope = requireRecord(
    JSON.parse(revisedRecorded.stdout),
    "Revised Plan record envelope",
  );
  const revisedResult = requireRecord(revisedEnvelope.result, "Revised Plan record result");
  const revisedProjection = requireRecord(
    revisedResult.projection,
    "Revised Plan Projection",
  );
  const revisedPlan = requireRecord(revisedResult.plan, "Revised Build Plan");
  const approvalAfterRevision = {
    ...approval,
    expectedVersion: requireVersion(revisedProjection, "version"),
    planIdentity: requireString(revisedPlan, "identity"),
    contextManifestIdentity: requireString(revisedPlan, "contextManifestIdentity"),
    event: {
      ...approval.event,
      eventId: "EVENT-12-CLI-PLAN-REVISED-APPROVED",
      idempotencyKey: "IDEMPOTENCY-12-CLI-PLAN-REVISED-APPROVED",
      occurredAt: "2026-07-15T10:06:00Z",
    },
  };
  await writeFile(
    join(repository, "plan-decision.json"),
    JSON.stringify(approvalAfterRevision),
    "utf8",
  );
  await writeFile(
    join(repository, "docs", "implementation.md"),
    "Drifted implementation context.\n",
    "utf8",
  );
  const stale = await runCli([
    "plan",
    "approve",
    TASK_ID,
    "--from",
    "plan-decision.json",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(stale.exitCode, 3);
  const staleEnvelope = requireRecord(JSON.parse(stale.stdout), "Stale Plan approval envelope");
  const staleError = requireRecord(staleEnvelope.error, "Stale Plan approval error");
  assert.equal(requireString(staleError, "code"), "build_plan.context_stale");

  await writeFile(
    join(repository, "docs", "implementation.md"),
    "Stable implementation context.\n",
    "utf8",
  );
  const approved = await runCli([
    "plan",
    "approve",
    TASK_ID,
    "--from",
    "plan-decision.json",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(approved.exitCode, 0);
  const approvedEnvelope = requireRecord(JSON.parse(approved.stdout), "Plan approval envelope");
  assert.equal(requireString(approvedEnvelope, "operation"), "plan.approve");
  const approvedResult = requireRecord(approvedEnvelope.result, "Plan approval result");
  assert.equal(
    requireString(requireRecord(approvedResult.projection, "Approved Projection"), "phase"),
    "implement",
  );
  const approvedEvent = requireRecord(approvedResult.event, "Plan approval Event");
  const approvedActor = requireRecord(approvedEvent.actor, "Plan approver");
  assert.equal(requireString(approvedActor, "id"), "reviewer-12");
});
