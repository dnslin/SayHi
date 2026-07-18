import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  addDurableContextManifestEntry,
  createKnowledgeCandidate,
  createDurableTask,
  createSpec,
  inspectDurableContextManifest,
  listKnowledgeCandidates,
  hashKnowledgeCandidateContent,
  promoteKnowledgeCandidate,
  readKnowledgeCandidate,
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
  taskLifecycleEventMetadata,
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

const PROMOTION_CONTEXT_TASK = Object.freeze({
  taskId: "TASK-30-PROMOTION-CONTEXT",
  title: "Consume promoted Knowledge",
  goal: "Use an Approved Spec as active Task Context.",
  acceptanceCriterion: "Promotion makes the bound Context Manifest stale.",
  files: Object.freeze(["packages/core/**", "packages/cli/**"]),
  eventNamespace: "30-PROMOTION-CONTEXT",
  sessionRef: "session-30-promotion-context",
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

test("human promotion binds exact Candidate provenance and visibly stales every affected Context Manifest", async (t) => {
  const repository = await createKnowledgeRepository(t);
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  await mkdir(join(repository, "docs"));
  await writeFile(join(repository, "docs", "conventions-source.md"), TARGET_CONTENT, "utf8");
  const approvedSpec = await createSpec({
    fileSystem,
    path: "conventions.md",
    source: "docs/conventions-source.md",
  });
  assert.equal(approvedSpec.ok, true);

  const contextTask = await createDurableTask({
    fileSystem,
    start: taskLifecycleStartRequest(
      PROMOTION_CONTEXT_TASK,
      "2026-07-18T10:25:00Z",
    ),
  });
  assert.equal(contextTask.ok, true);
  if (!contextTask.ok) {
    return;
  }
  const boundContext = await addDurableContextManifestEntry({
    fileSystem,
    taskId: PROMOTION_CONTEXT_TASK.taskId,
    expectedVersion: contextTask.state.projection.version,
    phase: "triage",
    source: `./${TARGET_PATH}`, 
    event: taskLifecycleEventMetadata(
      PROMOTION_CONTEXT_TASK,
      "CONTEXT-ADD",
      "2026-07-18T10:26:00Z",
    ),
  });
  assert.equal(boundContext.ok, true);
  if (!boundContext.ok) {
    return;
  }
  const normalizedContext = await inspectDurableContextManifest({
    fileSystem,
    taskId: PROMOTION_CONTEXT_TASK.taskId,
    phase: "triage",
  });
  assert.equal(normalizedContext.ok, true);
  if (!normalizedContext.ok) {
    return;
  }
  assert.equal(normalizedContext.entries[0]?.source.value, TARGET_PATH);
  assert.equal(normalizedContext.entries[0]?.trust, "approved-spec");

  const candidateId = "KNOWLEDGE-30-PROMOTION";
  const created = await createKnowledgeCandidate({
    fileSystem,
    taskId: KNOWLEDGE_TASK.taskId,
    createdAt: "2026-07-18T10:27:00Z",
    candidate: candidateDraft(candidateId, "promotion", `./${TARGET_PATH}`),
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const legacyTarget = ".sayhi/spec//conventions.md";
  await writeFile(
    join(
      repository,
      ".sayhi",
      "knowledge",
      "candidates",
      `${createHash("sha256").update(candidateId).digest("hex")}.json`,
    ),
    `${JSON.stringify({
      ...created.candidate,
      target: legacyTarget,
      contentHash: hashKnowledgeCandidateContent({
        ...created.candidate,
        target: legacyTarget,
      }),
    })}\n`,
    "utf8",
  );
  const reviewed = await reviewKnowledgeCandidate({
    fileSystem,
    candidateId,
    disposition: "approved",
    reviewer: "maintainer-30",
    reason: "The candidate is ready for deliberate promotion.",
    reviewedAt: "2026-07-18T10:28:00Z",
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }

  const newContent = "# Conventions\n\nUse structured diagnostics and immutable promotion records.\n";
  const deniedHash = await promoteKnowledgeCandidate({
    fileSystem,
    candidateId,
    candidateHash: `sha256:${"a".repeat(64)}`,
    content: newContent,
    event: {
      eventId: "EVENT-30-PROMOTION-HASH-MISMATCH",
      actor: { kind: "user", id: "maintainer-30", sessionRef: "session-30" },
      reason: "Approve the reviewed candidate.",
      idempotencyKey: "promotion-30-hash-mismatch",
      occurredAt: "2026-07-18T10:29:00Z",
    },
  });
  assert.equal(deniedHash.ok, false);
  if (!deniedHash.ok) {
    assert.equal(
      deniedHash.diagnostics[0]?.code,
      "knowledge.promotion.candidate_hash_mismatch",
    );
  }

  const deniedActor = await promoteKnowledgeCandidate({
    fileSystem,
    candidateId,
    candidateHash: reviewed.candidate.contentHash,
    content: newContent,
    event: {
      eventId: "EVENT-30-PROMOTION-AGENT",
      actor: { kind: "agent", id: "knowledge-agent", sessionRef: "session-30" },
      reason: "An Agent cannot approve promotion.",
      idempotencyKey: "promotion-30-agent",
      occurredAt: "2026-07-18T10:29:30Z",
    },
  });
  assert.equal(deniedActor.ok, false);
  if (!deniedActor.ok) {
    assert.equal(
      deniedActor.diagnostics[0]?.code,
      "knowledge.promotion.approval.invalid",
    );
  }

  const promoted = await promoteKnowledgeCandidate({
    fileSystem,
    candidateId,
    candidateHash: reviewed.candidate.contentHash,
    content: newContent,
    event: {
      eventId: "EVENT-30-PROMOTION-APPROVED",
      actor: { kind: "user", id: "maintainer-30", sessionRef: "session-30" },
      reason: "Approve the exact reviewed candidate for shared use.",
      idempotencyKey: "promotion-30-approved",
      occurredAt: "2026-07-18T10:30:00Z",
    },
  });
  assert.equal(promoted.ok, true);
  if (!promoted.ok) {
    return;
  }
  assert.equal(promoted.promotion.candidateHash, reviewed.candidate.contentHash);
  assert.deepEqual(promoted.promotion.candidate.evidence, [SOURCE_EVIDENCE]);
  assert.deepEqual(promoted.promotion.candidate.review, reviewed.candidate.review);
  assert.equal(promoted.promotion.candidate.target, ".sayhi/spec//conventions.md");
  assert.equal(promoted.promotion.target.path, TARGET_PATH);
  assert.deepEqual(
    promoted.promotion.invalidatedContexts.map(({ taskId, phase }) => ({ taskId, phase })),
    [{ taskId: PROMOTION_CONTEXT_TASK.taskId, phase: "triage" }],
  );
  assert.match(
    promoted.promotion.invalidatedContexts[0]?.manifestIdentity ?? "",
    /^sha256:[0-9a-f]{64}$/u,
  );
  assert.equal(
    await readFile(join(repository, ".sayhi", "spec", "conventions.md"), "utf8"),
    newContent,
  );

  const candidateAfterPromotion = await readKnowledgeCandidate({
    fileSystem,
    candidateId,
  });
  assert.equal(candidateAfterPromotion.ok, true);
  if (candidateAfterPromotion.ok) {
    assert.deepEqual(candidateAfterPromotion.candidate, reviewed.candidate);
  }
  const stale = await inspectDurableContextManifest({
    fileSystem,
    taskId: PROMOTION_CONTEXT_TASK.taskId,
    phase: "triage",
  });
  assert.equal(stale.ok, true);
  if (stale.ok) {
    assert.equal(stale.state, "stale");
  }
});
test("the CLI promotes a reviewed Candidate with an exact user approval Event", async (t) => {
  const repository = await createKnowledgeRepository(t);
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const candidateId = "KNOWLEDGE-30-CLI";
  const generated = await createKnowledgeCandidate({
    fileSystem,
    taskId: KNOWLEDGE_TASK.taskId,
    createdAt: "2026-07-18T10:35:00Z",
    candidate: candidateDraft(candidateId, "CLI promotion"),
  });
  assert.equal(generated.ok, true);
  if (!generated.ok) {
    return;
  }
  const reviewed = await reviewKnowledgeCandidate({
    fileSystem,
    candidateId,
    disposition: "approved",
    reviewer: "maintainer-30",
    reason: "The candidate is ready for CLI promotion.",
    reviewedAt: "2026-07-18T10:36:00Z",
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }
  const content = "# Conventions\n\nUse Core-mediated human knowledge promotion.\n";
  await writeFile(
    join(repository, "promotion-request.json"),
    `${JSON.stringify({
      candidateHash: reviewed.candidate.contentHash,
      content,
      event: {
        eventId: "EVENT-30-CLI-PROMOTION",
        actor: { kind: "user", id: "maintainer-30", sessionRef: "session-30-cli" },
        reason: "Approve the exact reviewed Candidate through the CLI.",
        idempotencyKey: "promotion-30-cli",
        occurredAt: "2026-07-18T10:37:00Z",
      },
    })}\n`,
    "utf8",
  );
  const planned = await runCli([
    "knowledge",
    "promote",
    candidateId,
    "--from",
    "promotion-request.json",
    "--plan",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(planned.exitCode, 0);
  const plannedEnvelope = JSON.parse(planned.stdout) as CliJsonEnvelope;
  assert.equal(requireRecord(plannedEnvelope.result).planned, true);
  assert.equal(
    await readFile(join(repository, ".sayhi", "spec", "conventions.md"), "utf8"),
    TARGET_CONTENT,
  );
  await assert.rejects(
    lstat(join(repository, ".sayhi", "knowledge", "promotions")),
    { code: "ENOENT" },
  );


  const promoted = await runCli([
    "knowledge",
    "promote",
    candidateId,
    "--from",
    "promotion-request.json",
    "--cwd",
    repository,
    "--apply",
    "--json",
  ]);
  assert.equal(promoted.exitCode, 0);
  const envelope = JSON.parse(promoted.stdout) as CliJsonEnvelope;
  assert.equal(envelope.operation, "knowledge.promote");
  const promotion = requireRecord(requireRecord(envelope.result).promotion);
  assert.equal(promotion.candidateHash, reviewed.candidate.contentHash);
  assert.equal(
    await readFile(join(repository, ".sayhi", "spec", "conventions.md"), "utf8"),
    content,
  );
});

test("promotion recovery completes the exact staged operation after final Event persistence fails", async (t) => {
  const repository = await createKnowledgeRepository(t);
  const fileSystem = new FailOncePromotionFileSystem(repository);
  const candidateId = "KNOWLEDGE-30-RECOVERY";
  const created = await createKnowledgeCandidate({
    fileSystem,
    taskId: KNOWLEDGE_TASK.taskId,
    createdAt: "2026-07-18T10:40:00Z",
    candidate: candidateDraft(candidateId, "recovery"),
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const reviewed = await reviewKnowledgeCandidate({
    fileSystem,
    candidateId,
    disposition: "approved",
    reviewer: "maintainer-30",
    reason: "The candidate is ready for recoverable promotion.",
    reviewedAt: "2026-07-18T10:41:00Z",
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }
  const request = {
    fileSystem,
    candidateId,
    candidateHash: reviewed.candidate.contentHash,
    content: "# Conventions\n\nRecover interrupted knowledge promotion.\n",
    event: {
      eventId: "EVENT-30-PROMOTION-RECOVERY",
      actor: { kind: "user" as const, id: "maintainer-30", sessionRef: "session-30" },
      reason: "Approve the exact candidate through a recoverable operation.",
      idempotencyKey: "promotion-30-recovery",
      occurredAt: "2026-07-18T10:42:00Z",
    },
  };
  const interrupted = await promoteKnowledgeCandidate(request);
  assert.equal(interrupted.ok, false);
  assert.equal(
    await readFile(join(repository, ".sayhi", "spec", "conventions.md"), "utf8"),
    request.content,
  );

  const recovered = await promoteKnowledgeCandidate(request);
  assert.equal(recovered.ok, true);
  if (recovered.ok) {
    assert.equal(recovered.appended, true);
  }
});

test("promotion adapters update reviewed ADR, domain, and runbook Candidates", async (t) => {
  const repository = await createKnowledgeRepository(t);
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  await mkdir(join(repository, "docs", "adr"), { recursive: true });
  await mkdir(join(repository, "docs", "runbooks"), { recursive: true });
  const cases = [
    {
      action: "update-adr",
      target: "docs/adr/0001-knowledge.md",
      original: "# Knowledge ADR\n",
      content: "# Knowledge ADR\n\nPromotions are human-authorized.\n",
    },
    {
      action: "update-domain",
      target: "CONTEXT.md",
      original: "# Domain Context\n",
      content: "# Domain Context\n\nKnowledge Promotion is deliberate.\n",
    },
    {
      action: "update-runbook",
      target: "docs/runbooks/promotion.md",
      original: "# Promotion Runbook\n",
      content: "# Promotion Runbook\n\nRecover the staged operation first.\n",
    },
  ] as const;

  for (const [index, adapter] of cases.entries()) {
    await writeFile(join(repository, ...adapter.target.split("/")), adapter.original, "utf8");
    const candidateId = `KNOWLEDGE-30-${adapter.action}`;
    const created = await createKnowledgeCandidate({
      fileSystem,
      taskId: KNOWLEDGE_TASK.taskId,
      createdAt: `2026-07-18T10:4${index}:00Z`,
      candidate: Object.freeze({
        ...candidateDraft(candidateId, adapter.action, adapter.target),
        proposedAction: adapter.action,
      }),
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    const reviewed = await reviewKnowledgeCandidate({
      fileSystem,
      candidateId,
      disposition: "approved",
      reviewer: "maintainer-30",
      reason: `Approve ${adapter.action}.`,
      reviewedAt: `2026-07-18T10:5${index}:00Z`,
    });
    assert.equal(reviewed.ok, true);
    if (!reviewed.ok) {
      return;
    }
    const promoted = await promoteKnowledgeCandidate({
      fileSystem,
      candidateId,
      candidateHash: reviewed.candidate.contentHash,
      content: adapter.content,
      event: {
        eventId: `EVENT-30-${adapter.action}`,
        actor: { kind: "user", id: "maintainer-30", sessionRef: "session-30" },
        reason: `Approve the exact ${adapter.action} Candidate.`,
        idempotencyKey: `promotion-30-${adapter.action}`,
        occurredAt: `2026-07-18T10:5${index}:30Z`,
      },
    });
    if (!promoted.ok) {
      assert.fail(promoted.diagnostics[0]?.message ?? "Promotion was rejected.");
    }
    assert.equal(promoted.ok, true);
    assert.equal(
      await readFile(join(repository, ...adapter.target.split("/")), "utf8"),
      adapter.content,
    );
  }
});

test("promotion rejects corrupt staged journals and durable Event records without changing targets", async (t) => {
  const repository = await createKnowledgeRepository(t);
  const fileSystem = new NodeManagedProjectFileSystem(repository);
  const candidateId = "KNOWLEDGE-30-CORRUPTION";
  const created = await createKnowledgeCandidate({
    fileSystem,
    taskId: KNOWLEDGE_TASK.taskId,
    createdAt: "2026-07-18T10:55:00Z",
    candidate: candidateDraft(candidateId, "corruption"),
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const reviewed = await reviewKnowledgeCandidate({
    fileSystem,
    candidateId,
    disposition: "approved",
    reviewer: "maintainer-30",
    reason: "The candidate is ready for corruption checks.",
    reviewedAt: "2026-07-18T10:56:00Z",
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) {
    return;
  }
  const request = {
    fileSystem,
    candidateId,
    candidateHash: reviewed.candidate.contentHash,
    content: "# Conventions\n\nCorrupt promotion state must fail closed.\n",
    event: {
      eventId: "EVENT-30-PROMOTION-CORRUPTION",
      actor: { kind: "user" as const, id: "maintainer-30", sessionRef: "session-30" },
      reason: "Approve the exact candidate after integrity checks.",
      idempotencyKey: "promotion-30-corruption",
      occurredAt: "2026-07-18T10:57:00Z",
    },
  };
  await writeFile(
    join(repository, ".sayhi", ".runtime", "knowledge-promotion.json"),
    "{malformed\n",
    "utf8",
  );
  const malformedJournal = await promoteKnowledgeCandidate(request);
  assert.equal(malformedJournal.ok, false);
  if (!malformedJournal.ok) {
    assert.equal(malformedJournal.diagnostics[0]?.code, "knowledge.promotion.store.invalid");
  }
  assert.equal(
    await readFile(join(repository, ".sayhi", "spec", "conventions.md"), "utf8"),
    TARGET_CONTENT,
  );

  await rm(join(repository, ".sayhi", ".runtime", "knowledge-promotion.json"));
  await mkdir(join(repository, ".sayhi", "knowledge", "promotions"));
  await writeFile(
    join(repository, ".sayhi", "knowledge", "promotions", "corrupt.json"),
    "{malformed\n",
    "utf8",
  );
  const malformedRecord = await promoteKnowledgeCandidate(request);
  assert.equal(malformedRecord.ok, false);
  if (!malformedRecord.ok) {
    assert.equal(malformedRecord.diagnostics[0]?.code, "knowledge.promotion.store.invalid");
  }
  assert.equal(
    await readFile(join(repository, ".sayhi", "spec", "conventions.md"), "utf8"),
    TARGET_CONTENT,
  );
});

class FailOncePromotionFileSystem extends NodeManagedProjectFileSystem {
  #failPromotionRecordWrite = true;

  override async writeFile(path: string, content: string): Promise<void> {
    if (
      this.#failPromotionRecordWrite &&
      path.startsWith(".sayhi/knowledge/promotions/")
    ) {
      this.#failPromotionRecordWrite = false;
      throw new Error("Injected Promotion Event persistence failure.");
    }
    await super.writeFile(path, content);
  }
}


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
