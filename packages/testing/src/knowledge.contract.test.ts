import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createKnowledgeCandidate,
  createDurableTask,
  listKnowledgeCandidates,
  reviewKnowledgeCandidate,
} from "@dnslin/sayhi-core";
import {
  NodeManagedProjectFileSystem,
  runCli,
  type CliJsonEnvelope,
} from "@dnslin/sayhi-cli";

import {
  createCompletedDurableTask,
  completeDurableTask,
  type TaskLifecycleFixture,
  taskLifecycleStartRequest,
} from "./task-lifecycle-test-support.js";

const KNOWLEDGE_TASK = Object.freeze({
  taskId: "TASK-29-KNOWLEDGE",
  title: "Generate Knowledge Candidates",
  goal: "Persist reviewable knowledge without changing current knowledge.",
  acceptanceCriterion: "Knowledge candidates retain Task and Evidence provenance.",
  files: Object.freeze(["packages/core/**", "packages/cli/**"]),
  eventNamespace: "29-KNOWLEDGE",
  sessionRef: "session-29-knowledge",
}) satisfies TaskLifecycleFixture;

const TARGET_PATH = ".sayhi/spec/conventions.md";
const TARGET_CONTENT = "# Conventions\n\nUse structured diagnostics.\n";
const SOURCE_EVIDENCE = "evidence/completed-finish-finish.json";

test("a completed Task creates provenance-bound Knowledge Candidates and detects duplicates and stale targets", async (t) => {
  const repository = await createKnowledgeRepository(t);
  const fileSystem = new NodeManagedProjectFileSystem(repository);

  const created = await createKnowledgeCandidate({
    fileSystem,
    taskId: KNOWLEDGE_TASK.taskId,
    createdAt: "2026-07-18T10:00:00Z",
    candidate: candidateDraft("KNOWLEDGE-29-ORIGINAL"),
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  assert.equal(created.disposition.kind, "created");
  assert.equal(created.candidate.taskId, KNOWLEDGE_TASK.taskId);
  assert.deepEqual(created.candidate.evidence, [SOURCE_EVIDENCE]);
  assert.match(created.candidate.contentHash, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(created.candidate.targetIdentity, null);

  const duplicate = await createKnowledgeCandidate({
    fileSystem,
    taskId: KNOWLEDGE_TASK.taskId,
    createdAt: "2026-07-18T10:01:00Z",
    candidate: candidateDraft("KNOWLEDGE-29-DUPLICATE"),
  });
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) {
    return;
  }
  assert.deepEqual(duplicate.disposition, {
    kind: "duplicate",
    candidateId: "KNOWLEDGE-29-ORIGINAL",
  });

  await writeFile(
    join(repository, ".sayhi", "spec", "conventions.md"),
    "# Conventions\n\nChanged after candidate generation.\n",
    "utf8",
  );
  const listed = await listKnowledgeCandidates({ fileSystem });
  assert.equal(listed.ok, true);
  if (!listed.ok) {
    return;
  }
  assert.deepEqual(listed.candidates, [
    {
      candidate: created.candidate,
      disposition: {
        kind: "stale",
        action: "request-revision",
        reason: "The candidate target changed after candidate generation.",
      },
    },
  ]);
});

test("concurrent Candidate generation serializes duplicate detection", async (t) => {
  const repository = await createKnowledgeRepository(t);
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const results = await Promise.all([
    createKnowledgeCandidate({
      fileSystem,
      taskId: KNOWLEDGE_TASK.taskId,
      createdAt: "2026-07-18T10:02:00Z",
      candidate: candidateDraft("KNOWLEDGE-29-CONCURRENT-A"),
    }),
    createKnowledgeCandidate({
      fileSystem,
      taskId: KNOWLEDGE_TASK.taskId,
      createdAt: "2026-07-18T10:02:01Z",
      candidate: candidateDraft("KNOWLEDGE-29-CONCURRENT-B"),
    }),
  ]);
  for (const result of results) {
    assert.equal(result.ok, true);
  }
  const created = results.find(
    (result) => result.ok && result.disposition.kind === "created",
  );
  const duplicate = results.find(
    (result) => result.ok && result.disposition.kind === "duplicate",
  );
  assert.notEqual(created, undefined);
  assert.notEqual(duplicate, undefined);
  if (
    created === undefined ||
    duplicate === undefined ||
    !created.ok ||
    !duplicate.ok ||
    duplicate.disposition.kind !== "duplicate"
  ) {
    return;
  }
  assert.equal(duplicate.disposition.candidateId, created.candidate.id);
});

test("candidate generation requires source Task Evidence and treats a newly created target as stale", async (t) => {
  const repository = await createKnowledgeRepository(t);
  const fileSystem = new NodeManagedProjectFileSystem(repository);

  const unlinked = await createKnowledgeCandidate({
    fileSystem,
    taskId: KNOWLEDGE_TASK.taskId,
    createdAt: "2026-07-18T10:05:00Z",
    candidate: Object.freeze({
      ...candidateDraft("KNOWLEDGE-29-UNLINKED", "unlinked Evidence"),
      evidence: Object.freeze(["evidence/not-recorded-by-task.json"]),
    }),
  });
  assert.equal(unlinked.ok, false);
  if (!unlinked.ok) {
    assert.equal(unlinked.diagnostics[0]?.code, "knowledge.candidate.evidence.unlinked");
  }

  const target = ".sayhi/spec/new-convention.md";
  const created = await createKnowledgeCandidate({
    fileSystem,
    taskId: KNOWLEDGE_TASK.taskId,
    createdAt: "2026-07-18T10:06:00Z",
    candidate: candidateDraft("KNOWLEDGE-29-NEW-TARGET", "new target", target),
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  assert.equal(created.candidate.targetIdentity, null);

  await writeFile(join(repository, ".sayhi", "spec", "new-convention.md"), "# New Convention\n", "utf8");
  const listed = await listKnowledgeCandidates({ fileSystem, status: "pending" });
  assert.equal(listed.ok, true);
  if (!listed.ok) {
    return;
  }
  assert.deepEqual(listed.candidates, [
    {
      candidate: created.candidate,
      disposition: {
        kind: "stale",
        action: "request-revision",
        reason: "The candidate target changed after candidate generation.",
      },
    },
  ]);
});

test("candidate generation requires a completed source Task", async (t) => {
  const repository = await createKnowledgeRepository(t, false);
  const result = await createKnowledgeCandidate({
    fileSystem: new NodeManagedProjectFileSystem(repository),
    taskId: KNOWLEDGE_TASK.taskId,
    createdAt: "2026-07-18T10:07:00Z",
    candidate: candidateDraft("KNOWLEDGE-29-ACTIVE-FINISH", "active Finish"),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.diagnostics[0]?.code, "knowledge.candidate.source.incomplete");
  }
});

test("human review records approval, rejection, and revision requests without modifying target knowledge", async (t) => {
  const repository = await createKnowledgeRepository(t);
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const targetBefore = await readFile(join(repository, ".sayhi", "spec", "conventions.md"), "utf8");

  const expectedStatuses = [
    ["approved", "accepted"],
    ["rejected", "rejected"],
    ["revision-requested", "revision-requested"],
  ] as const;

  for (const [disposition, status] of expectedStatuses) {
    const candidateId = `KNOWLEDGE-29-${disposition}`;
    const created = await createKnowledgeCandidate({
      fileSystem,
      taskId: KNOWLEDGE_TASK.taskId,
      createdAt: "2026-07-18T10:10:00Z",
      candidate: candidateDraft(candidateId, disposition),
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }

    const reviewed = await reviewKnowledgeCandidate({
      fileSystem,
      candidateId,
      disposition,
      reviewer: "maintainer-29",
      reason: `Review disposition: ${disposition}.`,
      reviewedAt: "2026-07-18T10:11:00Z",
    });
    assert.equal(reviewed.ok, true);
    if (!reviewed.ok) {
      return;
    }
    assert.equal(reviewed.candidate.status, status);
    assert.deepEqual(reviewed.candidate.review, {
      disposition,
      reviewer: "maintainer-29",
      reason: `Review disposition: ${disposition}.`,
      reviewedAt: "2026-07-18T10:11:00Z",
    });
  }

  assert.equal(
    await readFile(join(repository, ".sayhi", "spec", "conventions.md"), "utf8"),
    targetBefore,
  );
});

test("the CLI lists, shows, and records a human Knowledge review without promotion", async (t) => {
  const repository = await createKnowledgeRepository(t);
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const candidateId = "KNOWLEDGE-29-CLI";
  const generated = await createKnowledgeCandidate({
    fileSystem,
    taskId: KNOWLEDGE_TASK.taskId,
    createdAt: "2026-07-18T10:20:00Z",
    candidate: candidateDraft(candidateId, "CLI candidate"),
  });
  assert.equal(generated.ok, true);

  const listed = await runCli([
    "knowledge",
    "list",
    "--status",
    "pending",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(listed.exitCode, 0);
  const listedEnvelope = JSON.parse(listed.stdout) as CliJsonEnvelope;
  assert.equal(listedEnvelope.operation, "knowledge.list");
  const listedResult = requireRecord(listedEnvelope.result);
  const listedCandidates = listedResult.candidates;
  assert.ok(Array.isArray(listedCandidates));
  assert.equal(listedCandidates.length, 1);

  const shown = await runCli([
    "knowledge",
    "show",
    candidateId,
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(shown.exitCode, 0);
  const shownEnvelope = JSON.parse(shown.stdout) as CliJsonEnvelope;
  assert.equal(shownEnvelope.operation, "knowledge.show");
  const shownCandidate = requireRecord(requireRecord(shownEnvelope.result).candidate);
  assert.equal(shownCandidate.id, candidateId);

  const targetBefore = await readFile(join(repository, ".sayhi", "spec", "conventions.md"), "utf8");
  const reviewed = await runCli([
    "knowledge",
    "review",
    candidateId,
    "--approve",
    "--reviewer",
    "maintainer-29",
    "--reason",
    "Ready for a separate promotion decision.",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(reviewed.exitCode, 0);
  const reviewedEnvelope = JSON.parse(reviewed.stdout) as CliJsonEnvelope;
  assert.equal(reviewedEnvelope.operation, "knowledge.review");
  const reviewedCandidate = requireRecord(requireRecord(reviewedEnvelope.result).candidate);
  assert.equal(reviewedCandidate.status, "accepted");
  assert.equal(requireRecord(reviewedCandidate.review).reviewer, "maintainer-29");
  assert.equal(
    await readFile(join(repository, ".sayhi", "spec", "conventions.md"), "utf8"),
    targetBefore,
  );
});

function candidateDraft(id: string, suffix = "", target = TARGET_PATH): {
  readonly id: string;
  readonly type: string;
  readonly statement: string;
  readonly scope: readonly string[];
  readonly evidence: readonly string[];
  readonly confidence: "high";
  readonly proposedAction: string;
  readonly target: string;
  readonly createdBy: string;
} {
  return Object.freeze({
    id,
    type: "convention",
    statement: `Public APIs return structured diagnostics.${suffix.length === 0 ? "" : ` ${suffix}`}`,
    scope: Object.freeze(["packages/core/**"]),
    evidence: Object.freeze([SOURCE_EVIDENCE]),
    confidence: "high",
    proposedAction: "update-spec",
    target,
    createdBy: "RESULT-KNOWLEDGE-29",
  });
}

async function createKnowledgeRepository(
  t: test.TestContext,
  completed = true,
): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-knowledge-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  assert.equal((await runCli(["init", "--cwd", repository, "--json"])).exitCode, 0);
  await writeFile(join(repository, ".sayhi", "spec", "conventions.md"), TARGET_CONTENT, "utf8");
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  if (completed) {
    await createCompletedDurableTask(
      fileSystem,
      KNOWLEDGE_TASK,
      "2026-07-18T09:00:00Z",
      "2026-07-18T09:30:00Z",
    );
  } else {
    const started = await createDurableTask({
      fileSystem,
      start: taskLifecycleStartRequest(KNOWLEDGE_TASK, "2026-07-18T09:00:00Z"),
    });
    if (!started.ok) {
      throw new Error(started.diagnostics[0]?.message ?? "Task creation failed");
    }
    await completeDurableTask(
      fileSystem,
      KNOWLEDGE_TASK,
      started.state,
      "2026-07-18T09:30:00Z",
      false,
    );
  }
  return repository;
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Readonly<Record<string, unknown>>;
}
