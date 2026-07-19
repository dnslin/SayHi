import { createHash } from "node:crypto";

import { hashTextContent } from "./context-manifest.js";
import {
  hashCanonicalJson,
  isContractIdentity,
  type ContractIdentity,
} from "./identity.js";
import {
  readKnowledgeCandidate,
  readRepositoryTargetIdentity,
  type KnowledgeCandidateFileSystem,
} from "./knowledge.js";
import {
  RECORD_CONTRACT_VERSION,
  validateContractRecord,
  type KnowledgeCandidateRecord,
} from "./record-contracts.js";
import {
  canonicalRepositoryRelativePath,
  isRepositoryRelativePath,
} from "./repository-path.js";
import { approveSpec } from "./spec-approval.js";
import {
  inspectDurableContextManifest,
  readDurableTask,
  type ContextManifestFileSystem,
  type InitiativeGraphFileSystem,
  type TaskWriter,
} from "./task-lifecycle.js";
import {
  DOMAIN_VALIDATION_CONTRACT_VERSION,
  isIdentifier,
  validateDomainValue,
  type ContentHash,
} from "./validation.js";
import {
  isWorkflowPhase,
  validateWorkflowEventMetadata,
  type WorkflowEventMetadata,
  type WorkflowPhase,
} from "./workflow.js";

export const KNOWLEDGE_PROMOTION_CONTRACT_VERSION = 1 as const;

const KNOWLEDGE_DIRECTORY = ".sayhi/knowledge";
const PROMOTIONS_DIRECTORY = `${KNOWLEDGE_DIRECTORY}/promotions`;
const KNOWLEDGE_LOCK_PATH = ".sayhi/.runtime/knowledge-candidates.lock";
const PROMOTION_JOURNAL_PATH = ".sayhi/.runtime/knowledge-promotion.json";
const TASKS_DIRECTORY = ".sayhi/tasks";

export interface KnowledgePromotionFileSystem
  extends KnowledgeCandidateFileSystem,
    ContextManifestFileSystem,
    InitiativeGraphFileSystem {
  removeFile(path: string): Promise<void>;
}

export type KnowledgePromotionTargetKind = "spec" | "adr" | "domain" | "runbook";

export interface KnowledgePromotionTarget {
  readonly kind: KnowledgePromotionTargetKind;
  readonly path: string;
  readonly previousIdentity: ContentHash | null;
  readonly newIdentity: ContentHash;
}

export interface InvalidatedKnowledgeContext {
  readonly taskId: string;
  readonly phase: WorkflowPhase;
  readonly manifestIdentity: ContractIdentity;
}

/** Immutable durable proof that a human promoted one exact Knowledge Candidate. */
export interface KnowledgePromotionRecord {
  readonly schemaVersion: 1;
  readonly event: WorkflowEventMetadata;
  readonly candidateHash: ContractIdentity;
  readonly candidate: KnowledgeCandidateRecord;
  readonly target: KnowledgePromotionTarget;
  readonly invalidatedContexts: readonly InvalidatedKnowledgeContext[];
  readonly supersedes: readonly string[];
}

export interface PromoteKnowledgeCandidateRequest {
  readonly fileSystem: KnowledgePromotionFileSystem;
  readonly candidateId: string;
  readonly candidateHash: ContractIdentity;
  readonly content: string;
  readonly event: WorkflowEventMetadata;
  readonly persist?: boolean;
}

export type KnowledgePromotionDiagnosticCode =
  | "knowledge.promotion.candidate.invalid"
  | "knowledge.promotion.candidate_hash.invalid"
  | "knowledge.promotion.candidate_hash_mismatch"
  | "knowledge.promotion.candidate.unapproved"
  | "knowledge.promotion.candidate.stale"
  | "knowledge.promotion.target.unsupported"
  | "knowledge.promotion.content.invalid"
  | "knowledge.promotion.approval.invalid"
  | "knowledge.promotion.event.conflict"
  | "knowledge.promotion.context.invalid"
  | "knowledge.promotion.store.invalid"
  | "knowledge.promotion.io_failed";

export interface KnowledgePromotionDiagnostic {
  readonly code: KnowledgePromotionDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

type KnowledgePromotionFailure = Readonly<{
  ok: false;
  contractVersion: typeof KNOWLEDGE_PROMOTION_CONTRACT_VERSION;
  diagnostics: readonly KnowledgePromotionDiagnostic[];
}>;

export type PromoteKnowledgeCandidateResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof KNOWLEDGE_PROMOTION_CONTRACT_VERSION;
      promotion: KnowledgePromotionRecord;
      appended: boolean;
      planned: boolean;
    }>
  | KnowledgePromotionFailure;

type PromotionTargetAdapter = Readonly<{
  kind: KnowledgePromotionTargetKind;
  requiresSpecApproval: boolean;
}>;

type PromotionJournal = Readonly<{
  schemaVersion: 1;
  promotion: KnowledgePromotionRecord;
  content: string;
}>;

export async function promoteKnowledgeCandidate(
  request: PromoteKnowledgeCandidateRequest,
): Promise<PromoteKnowledgeCandidateResult> {
  const inputFailure = validatePromotionRequest(request);
  if (inputFailure !== null) {
    return inputFailure;
  }
  const content = normalizeText(request.content);
  const newIdentity = hashTextContent(content);
  try {
    return await request.fileSystem.withWriterMutationLock((writer) =>
      request.fileSystem.withTaskMutationLock(KNOWLEDGE_LOCK_PATH, async () => {
        const existing = await loadPromotionRecords(request.fileSystem);
        if (!existing.ok) {
          return existing;
        }
        const pending = await readPromotionJournal(request.fileSystem);
        if (!pending.ok) {
          return pending;
        }
        const accepted = existing.promotions.find(
          (promotion) =>
            promotion.event.eventId === request.event.eventId ||
            promotion.event.idempotencyKey === request.event.idempotencyKey,
        );
        if (accepted !== undefined) {
          if (!promotionMatchesRequest(accepted, request, newIdentity)) {
            return eventConflict();
          }
          if (
            pending.journal !== null &&
            sameEvent(pending.journal.promotion.event, accepted.event)
          ) {
            await request.fileSystem.removeFile(PROMOTION_JOURNAL_PATH);
          }
          return promotionSuccess(accepted, false, false);
        }
        if (
          pending.journal !== null &&
          !existing.promotions.some((promotion) =>
            sameEvent(promotion.event, pending.journal!.promotion.event),
          )
        ) {
          if (!promotionMatchesRequest(pending.journal.promotion, request, newIdentity)) {
            return eventConflict();
          }
          const candidate = await readApprovedCandidate(request);
          if (!candidate.ok) {
            return candidate;
          }
          if (
            hashCanonicalJson(candidate.candidate) !==
            hashCanonicalJson(pending.journal.promotion.candidate)
          ) {
            return failure(
              "knowledge.promotion.candidate.invalid",
              "$.candidateId",
              "The staged Promotion Event no longer matches its reviewed Knowledge Candidate.",
              "Restore the reviewed Candidate or create a new human-approved promotion request.",
            );
          }
          if (request.persist === false) {
            return promotionSuccess(pending.journal.promotion, false, true);
          }
          return finishPromotion(
            request.fileSystem,
            writer,
            pending.journal,
            true,
          );
        }

        const candidate = await readApprovedCandidate(request);
        if (!candidate.ok) {
          return candidate;
        }
        const target = canonicalRepositoryRelativePath(candidate.candidate.target);
        const adapter = targetAdapter({ ...candidate.candidate, target });
        if (adapter === null) {
          return unsupportedTarget();
        }
        const currentTarget = await readTargetIdentity(
          request.fileSystem,
          target,
        );
        if (!currentTarget.ok) {
          return currentTarget;
        }
        if (
          !sameContentHash(
            currentTarget.identity,
            candidate.candidate.targetIdentity,
          )
        ) {
          return failure(
            "knowledge.promotion.candidate.stale",
            target,
            "Knowledge Candidate target changed after Candidate generation.",
            "Generate and review a revised Candidate against the current target.",
          );
        }
        if (sameContentHash(newIdentity, candidate.candidate.targetIdentity)) {
          return failure(
            "knowledge.promotion.content.invalid",
            "$.content",
            "Knowledge promotion content must change the Candidate target.",
            "Provide revised content that implements the approved Candidate.",
          );
        }
        const contexts = await findAffectedContexts(
          request.fileSystem,
          target,
        );
        if (!contexts.ok) {
          return contexts;
        }
        const promotion = freezePromotion({
          event: request.event,
          candidateHash: request.candidateHash,
          candidate: candidate.candidate,
          target: {
            kind: adapter.kind,
            path: target,
            previousIdentity: candidate.candidate.targetIdentity,
            newIdentity,
          },
          invalidatedContexts: contexts.contexts,
          supersedes: existing.promotions
            .filter(
              (item) =>
                canonicalRepositoryRelativePath(item.target.path) === target,
            )
            .map((item) => item.event.eventId)
            .sort((left, right) => left.localeCompare(right)),
        });
        if (request.persist === false) {
          return promotionSuccess(promotion, false, true);
        }
        const prepared = await preparePromotionDirectories(request.fileSystem);
        if (prepared !== null) {
          return prepared;
        }
        const journal = Object.freeze({
          schemaVersion: 1 as const,
          promotion,
          content,
        });
        await request.fileSystem.writeFile(
          PROMOTION_JOURNAL_PATH,
          serializePromotionJournal(journal),
        );
        return finishPromotion(request.fileSystem, writer, journal, true);
      }),
    );
  } catch {
    return failure(
      "knowledge.promotion.io_failed",
      request.candidateId,
      "Knowledge promotion could not safely persist shared knowledge.",
      "Inspect the staged promotion operation and retry the same human-approved request.",
    );
  }
}

async function readApprovedCandidate(
  request: PromoteKnowledgeCandidateRequest,
): Promise<Readonly<{ ok: true; candidate: KnowledgeCandidateRecord }> | KnowledgePromotionFailure> {
  const loaded = await readKnowledgeCandidate({
    fileSystem: request.fileSystem,
    candidateId: request.candidateId,
  });
  if (!loaded.ok) {
    return failure(
      "knowledge.promotion.candidate.invalid",
      loaded.diagnostics[0]?.path ?? "$.candidateId",
      loaded.diagnostics[0]?.message ?? "Knowledge Candidate could not be read.",
      loaded.diagnostics[0]?.remediation ?? "Restore the reviewed Candidate before promotion.",
    );
  }
  if (loaded.candidate.contentHash !== request.candidateHash) {
    return failure(
      "knowledge.promotion.candidate_hash_mismatch",
      "$.candidateHash",
      "Promotion approval must name the exact immutable Knowledge Candidate hash.",
      "Reload the reviewed Candidate and approve its current contentHash.",
    );
  }
  if (
    loaded.candidate.status !== "accepted" ||
    loaded.candidate.review === null ||
    loaded.candidate.review.disposition !== "approved"
  ) {
    return failure(
      "knowledge.promotion.candidate.unapproved",
      "$.candidateId",
      "Knowledge promotion requires a human-approved Knowledge Candidate.",
      "Review and approve the Candidate before requesting promotion.",
    );
  }
  return Object.freeze({ ok: true, candidate: loaded.candidate });
}

async function finishPromotion(
  fileSystem: KnowledgePromotionFileSystem,
  writer: TaskWriter,
  journal: PromotionJournal,
  appended: boolean,
): Promise<PromoteKnowledgeCandidateResult> {
  const candidateTarget = canonicalRepositoryRelativePath(
    journal.promotion.candidate.target,
  );
  const adapter = targetAdapter({
    ...journal.promotion.candidate,
    target: candidateTarget,
  });
  if (adapter === null || adapter.kind !== journal.promotion.target.kind) {
    return unsupportedTarget();
  }
  const target = await readTargetIdentity(fileSystem, journal.promotion.target.path);
  if (!target.ok) {
    return target;
  }
  if (sameContentHash(target.identity, journal.promotion.target.previousIdentity)) {
    await writer.writeFile(journal.promotion.target.path, journal.content);
  } else if (!sameContentHash(target.identity, journal.promotion.target.newIdentity)) {
    return failure(
      "knowledge.promotion.candidate.stale",
      journal.promotion.target.path,
      "The staged Promotion Event target no longer matches its expected before or after identity.",
      "Restore the target or create a new reviewed Candidate before starting another promotion.",
    );
  }
  const persistedTarget = await readTargetIdentity(
    fileSystem,
    journal.promotion.target.path,
  );
  if (
    !persistedTarget.ok ||
    !sameContentHash(
      persistedTarget.identity,
      journal.promotion.target.newIdentity,
    )
  ) {
    return failure(
      "knowledge.promotion.io_failed",
      journal.promotion.target.path,
      "Knowledge promotion target could not be verified after its atomic replacement.",
      "Inspect the staged promotion operation and retry only after restoring the target.",
    );
  }
  if (adapter.requiresSpecApproval) {
    const approved = await approveSpec(fileSystem, {
      path: journal.promotion.target.path,
      identity: journal.promotion.target.newIdentity,
      approvedBy: journal.promotion.event.eventId,
    });
    if (!approved.ok) {
      const diagnostic = approved.diagnostics[0];
      return failure(
        "knowledge.promotion.io_failed",
        diagnostic?.path ?? journal.promotion.target.path,
        diagnostic?.message ?? "Approved Spec promotion could not persist its approval.",
        diagnostic?.remediation ?? "Repair the Spec approval registry and retry the staged promotion.",
      );
    }
  }
  await fileSystem.writeFile(
    promotionFilePath(journal.promotion.event.eventId),
    serializePromotion(journal.promotion),
  );
  await fileSystem.removeFile(PROMOTION_JOURNAL_PATH);
  return promotionSuccess(journal.promotion, appended, false);
}

function validatePromotionRequest(
  request: PromoteKnowledgeCandidateRequest,
): KnowledgePromotionFailure | null {
  if (!isIdentifier(request.candidateId)) {
    return failure(
      "knowledge.promotion.candidate.invalid",
      "$.candidateId",
      "Knowledge promotion requires a stable Candidate id.",
      "Provide the id of the reviewed Knowledge Candidate.",
    );
  }
  if (!isContractIdentity(request.candidateHash)) {
    return failure(
      "knowledge.promotion.candidate_hash.invalid",
      "$.candidateHash",
      "Knowledge promotion requires a SHA-256 Candidate hash.",
      "Provide the exact contentHash shown by knowledge show.",
    );
  }
  if (request.content.trim().length === 0) {
    return failure(
      "knowledge.promotion.content.invalid",
      "$.content",
      "Knowledge promotion content must not be blank.",
      "Provide non-empty shared knowledge content.",
    );
  }
  const metadata = validateWorkflowEventMetadata(request.event, "$.event");
  if (metadata !== null || request.event.actor.kind !== "user") {
    return failure(
      "knowledge.promotion.approval.invalid",
      metadata?.path ?? "$.event.actor.kind",
      metadata?.message ?? "Knowledge promotion requires an attributable user approval Event.",
      metadata?.remediation ?? "Submit the promotion with the approving user as the Event actor.",
    );
  }
  return null;
}

function targetAdapter(
  candidate: KnowledgeCandidateRecord,
): PromotionTargetAdapter | null {
  if (
    candidate.proposedAction === "update-spec" &&
    isMarkdownPathUnder(candidate.target, ".sayhi/spec/")
  ) {
    return Object.freeze({ kind: "spec", requiresSpecApproval: true });
  }
  if (
    candidate.proposedAction === "update-adr" &&
    isMarkdownPathUnder(candidate.target, "docs/adr/")
  ) {
    return Object.freeze({ kind: "adr", requiresSpecApproval: false });
  }
  if (candidate.proposedAction === "update-domain" && candidate.target === "CONTEXT.md") {
    return Object.freeze({ kind: "domain", requiresSpecApproval: false });
  }
  if (
    candidate.proposedAction === "update-runbook" &&
    isMarkdownPathUnder(candidate.target, "docs/runbooks/")
  ) {
    return Object.freeze({ kind: "runbook", requiresSpecApproval: false });
  }
  return null;
}

function isMarkdownPathUnder(path: string, prefix: string): boolean {
  const name = path.slice(prefix.length);
  return path.startsWith(prefix) && name.length > 3 && name.endsWith(".md");
}


function unsupportedTarget(): KnowledgePromotionFailure {
  return failure(
    "knowledge.promotion.target.unsupported",
    "$.candidate",
    "Knowledge promotion supports update-spec, update-adr, update-domain, and update-runbook Candidate targets.",
    "Use the action and repository path reserved for the intended shared knowledge type.",
  );
}

async function readTargetIdentity(
  fileSystem: KnowledgePromotionFileSystem,
  target: string,
): Promise<Readonly<{ ok: true; identity: ContentHash | null }> | KnowledgePromotionFailure> {
  const entry = await readRepositoryTargetIdentity(fileSystem, target);
  if (entry.kind === "missing") {
    return Object.freeze({ ok: true, identity: null });
  }
  if (entry.kind !== "file") {
    return failure(
      "knowledge.promotion.target.unsupported",
      target,
      "Knowledge promotion target is not a regular repository file location.",
      "Restore a regular target file or choose a supported shared knowledge path.",
    );
  }
  return Object.freeze({ ok: true, identity: entry.identity });
}

async function findAffectedContexts(
  fileSystem: KnowledgePromotionFileSystem,
  target: string,
): Promise<
  | Readonly<{ ok: true; contexts: readonly InvalidatedKnowledgeContext[] }>
  | KnowledgePromotionFailure
> {
  const tasks = await fileSystem.inspect(TASKS_DIRECTORY);
  if (tasks.kind === "missing") {
    return Object.freeze({ ok: true, contexts: Object.freeze([]) });
  }
  if (tasks.kind !== "directory") {
    return failure(
      "knowledge.promotion.context.invalid",
      TASKS_DIRECTORY,
      "Managed Project Tasks are unavailable for Context Manifest invalidation.",
      "Repair the Tasks directory before promoting knowledge.",
    );
  }
  const contexts: InvalidatedKnowledgeContext[] = [];
  for (const entry of await fileSystem.listDirectory(TASKS_DIRECTORY)) {
    if (entry.name === "archive") {
      continue;
    }
    if (entry.kind !== "directory") {
      return failure(
        "knowledge.promotion.context.invalid",
        `${TASKS_DIRECTORY}/${entry.name}`,
        "Managed Project Tasks contains an unsafe entry.",
        "Repair the Tasks directory before promoting knowledge.",
      );
    }
    const task = await readDurableTask({ fileSystem, taskId: entry.name });
    if (!task.ok) {
      const diagnostic = task.diagnostics[0];
      return failure(
        "knowledge.promotion.context.invalid",
        diagnostic?.path ?? `${TASKS_DIRECTORY}/${entry.name}`,
        diagnostic?.message ?? "Task Context could not be inspected safely.",
        diagnostic?.remediation ?? "Repair the Task before promoting knowledge.",
      );
    }
    if (
      task.state.projection.lifecycle !== "active" &&
      task.state.projection.lifecycle !== "blocked"
    ) {
      continue;
    }
    for (const phaseName of Object.keys(task.state.projection.contexts)) {
      if (!isWorkflowPhase(phaseName)) {
        return failure(
          "knowledge.promotion.context.invalid",
          `${TASKS_DIRECTORY}/${entry.name}/task.json`,
          "Task Context contains an unsupported workflow Phase.",
          "Recover the Task Projection before promoting knowledge.",
        );
      }
      const manifest = await inspectDurableContextManifest({
        fileSystem,
        taskId: task.state.projection.id,
        phase: phaseName,
      });
      if (!manifest.ok) {
        const diagnostic = manifest.diagnostics[0];
        return failure(
          "knowledge.promotion.context.invalid",
          diagnostic?.path ?? `${TASKS_DIRECTORY}/${entry.name}`,
          diagnostic?.message ?? "Context Manifest could not be inspected safely.",
          diagnostic?.remediation ?? "Repair the Context Manifest before promoting knowledge.",
        );
      }
      if (
        manifest.entries.some(
          (context) =>
            context.source.type === "project-path" &&
            canonicalRepositoryRelativePath(context.source.value) ===
              canonicalRepositoryRelativePath(target),
        )
      ) {
        contexts.push(
          Object.freeze({
            taskId: task.state.projection.id,
            phase: phaseName,
            manifestIdentity: hashCanonicalJson(manifest.entries),
          }),
        );
      }
    }
  }
  return Object.freeze({
    ok: true,
    contexts: Object.freeze(
      contexts.sort(
        (left, right) =>
          left.taskId.localeCompare(right.taskId) ||
          left.phase.localeCompare(right.phase),
      ),
    ),
  });
}

async function preparePromotionDirectories(
  fileSystem: KnowledgePromotionFileSystem,
): Promise<KnowledgePromotionFailure | null> {
  for (const path of [KNOWLEDGE_DIRECTORY, PROMOTIONS_DIRECTORY]) {
    const entry = await fileSystem.inspect(path);
    if (entry.kind === "missing") {
      await fileSystem.createDirectory(path);
    } else if (entry.kind !== "directory") {
      return failure(
        "knowledge.promotion.store.invalid",
        path,
        "Knowledge promotion requires regular Project Store directories.",
        "Repair the Project Store path before promoting knowledge.",
      );
    }
  }
  return null;
}

async function readPromotionJournal(
  fileSystem: KnowledgePromotionFileSystem,
): Promise<Readonly<{ ok: true; journal: PromotionJournal | null }> | KnowledgePromotionFailure> {
  const entry = await fileSystem.inspect(PROMOTION_JOURNAL_PATH);
  if (entry.kind === "missing") {
    return Object.freeze({ ok: true, journal: null });
  }
  if (entry.kind !== "file") {
    return failure(
      "knowledge.promotion.store.invalid",
      PROMOTION_JOURNAL_PATH,
      "Knowledge promotion operation journal is unsafe.",
      "Restore the staged operation journal before retrying promotion.",
    );
  }
  try {
    const value: unknown = JSON.parse(await fileSystem.readFile(PROMOTION_JOURNAL_PATH));
    if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.content !== "string") {
      return invalidPromotionJournal();
    }
    const promotion = validatePromotionRecord(value.promotion, PROMOTION_JOURNAL_PATH);
    if (!promotion.ok || !sameContentHash(hashTextContent(value.content), promotion.promotion.target.newIdentity)) {
      return invalidPromotionJournal();
    }
    return Object.freeze({
      ok: true,
      journal: Object.freeze({
        schemaVersion: 1,
        promotion: promotion.promotion,
        content: value.content,
      }),
    });
  } catch {
    return invalidPromotionJournal();
  }
}

function invalidPromotionJournal(): KnowledgePromotionFailure {
  return failure(
    "knowledge.promotion.store.invalid",
    PROMOTION_JOURNAL_PATH,
    "Knowledge promotion operation journal is malformed.",
    "Restore the staged operation journal before retrying promotion.",
  );
}

async function loadPromotionRecords(
  fileSystem: KnowledgePromotionFileSystem,
): Promise<Readonly<{ ok: true; promotions: readonly KnowledgePromotionRecord[] }> | KnowledgePromotionFailure> {
  const directory = await fileSystem.inspect(PROMOTIONS_DIRECTORY);
  if (directory.kind === "missing") {
    return Object.freeze({ ok: true, promotions: Object.freeze([]) });
  }
  if (directory.kind !== "directory") {
    return failure(
      "knowledge.promotion.store.invalid",
      PROMOTIONS_DIRECTORY,
      "Knowledge promotion storage is not a directory.",
      "Repair the promotion store before retrying.",
    );
  }
  const promotions: KnowledgePromotionRecord[] = [];
  for (const entry of await fileSystem.listDirectory(PROMOTIONS_DIRECTORY)) {
    const path = `${PROMOTIONS_DIRECTORY}/${entry.name}`;
    if (entry.kind !== "file" || !entry.name.endsWith(".json")) {
      return failure(
        "knowledge.promotion.store.invalid",
        path,
        "Knowledge promotion storage contains an unsafe entry.",
        "Keep only Core-generated Promotion Event records in the promotion store.",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(await fileSystem.readFile(path));
    } catch {
      return invalidPromotionRecord(path);
    }
    const promotion = validatePromotionRecord(value, path);
    if (!promotion.ok) {
      return promotion;
    }
    if (promotionFilePath(promotion.promotion.event.eventId) !== path) {
      return failure(
        "knowledge.promotion.store.invalid",
        path,
        "Knowledge promotion record is stored at a non-canonical path.",
        "Restore the Promotion Event record to its canonical storage path.",
      );
    }
    promotions.push(promotion.promotion);
  }
  return Object.freeze({
    ok: true,
    promotions: Object.freeze(
      promotions.sort((left, right) => left.event.eventId.localeCompare(right.event.eventId)),
    ),
  });
}

function validatePromotionRecord(
  value: unknown,
  path: string,
):
  | Readonly<{ ok: true; promotion: KnowledgePromotionRecord }>
  | KnowledgePromotionFailure {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return invalidPromotionRecord(path);
  }
  const eventDiagnostic = validateWorkflowEventMetadata(value.event, "$.event");
  if (
    eventDiagnostic !== null ||
    !isRecord(value.event) ||
    !isRecord(value.event.actor) ||
    value.event.actor.kind !== "user" ||
    !isContractIdentity(value.candidateHash)
  ) {
    return invalidPromotionRecord(path);
  }
  const candidateValidation = validateContractRecord({
    contractVersion: RECORD_CONTRACT_VERSION,
    kind: "knowledgeCandidate",
    record: value.candidate,
  });
  if (!candidateValidation.ok) {
    return invalidPromotionRecord(path);
  }
  const candidate = candidateValidation.record as KnowledgeCandidateRecord;
  const target = canonicalRepositoryRelativePath(candidate.target);
  const adapter = targetAdapter({ ...candidate, target });
  if (
    candidate.status !== "accepted" ||
    candidate.review === null ||
    candidate.review.disposition !== "approved" ||
    candidate.contentHash !== value.candidateHash ||
    adapter === null ||
    !isRecord(value.target) ||
    value.target.kind !== adapter.kind ||
    value.target.path !== target ||
    !isNullableContentHash(value.target.previousIdentity) ||
    !isContentHash(value.target.newIdentity) ||
    !sameContentHash(value.target.previousIdentity, candidate.targetIdentity)
  ) {
    return invalidPromotionRecord(path);
  }
  if (!Array.isArray(value.invalidatedContexts) || !Array.isArray(value.supersedes)) {
    return invalidPromotionRecord(path);
  }
  const contexts: InvalidatedKnowledgeContext[] = [];
  for (const context of value.invalidatedContexts) {
    if (
      !isRecord(context) ||
      !isIdentifier(context.taskId) ||
      !isWorkflowPhase(context.phase) ||
      !isContractIdentity(context.manifestIdentity)
    ) {
      return invalidPromotionRecord(path);
    }
    contexts.push(
      Object.freeze({
        taskId: context.taskId,
        phase: context.phase,
        manifestIdentity: context.manifestIdentity,
      }),
    );
  }
  if (!value.supersedes.every(isIdentifier)) {
    return invalidPromotionRecord(path);
  }
  return Object.freeze({
    ok: true,
    promotion: freezePromotion({
      event: value.event as unknown as WorkflowEventMetadata,
      candidateHash: value.candidateHash,
      candidate,
      target: {
        kind: adapter.kind,
        path: target,
        previousIdentity: candidate.targetIdentity,
        newIdentity: value.target.newIdentity,
      },
      invalidatedContexts: contexts,
      supersedes: value.supersedes,
    }),
  });
}

function invalidPromotionRecord(path: string): KnowledgePromotionFailure {
  return failure(
    "knowledge.promotion.store.invalid",
    path,
    "Knowledge promotion record is malformed or violates immutable provenance rules.",
    "Restore the Core-generated Promotion Event record before retrying.",
  );
}

function promotionMatchesRequest(
  promotion: KnowledgePromotionRecord,
  request: PromoteKnowledgeCandidateRequest,
  newIdentity: ContentHash,
): boolean {
  return (
    sameEvent(promotion.event, request.event) &&
    promotion.candidate.id === request.candidateId &&
    promotion.candidateHash === request.candidateHash &&
    sameContentHash(promotion.target.newIdentity, newIdentity)
  );
}

function sameEvent(
  left: WorkflowEventMetadata,
  right: WorkflowEventMetadata,
): boolean {
  return (
    left.eventId === right.eventId &&
    left.actor.kind === right.actor.kind &&
    left.actor.id === right.actor.id &&
    left.actor.sessionRef === right.actor.sessionRef &&
    left.reason === right.reason &&
    left.idempotencyKey === right.idempotencyKey &&
    left.occurredAt === right.occurredAt
  );
}

function freezePromotion(value: {
  readonly event: WorkflowEventMetadata;
  readonly candidateHash: ContractIdentity;
  readonly candidate: KnowledgeCandidateRecord;
  readonly target: KnowledgePromotionTarget;
  readonly invalidatedContexts: readonly InvalidatedKnowledgeContext[];
  readonly supersedes: readonly string[];
}): KnowledgePromotionRecord {
  return Object.freeze({
    schemaVersion: 1,
    event: Object.freeze({
      ...value.event,
      actor: Object.freeze({ ...value.event.actor }),
    }),
    candidateHash: value.candidateHash,
    candidate: Object.freeze({
      ...value.candidate,
      scope: Object.freeze([...value.candidate.scope]),
      evidence: Object.freeze([...value.candidate.evidence]),
      targetIdentity:
        value.candidate.targetIdentity === null
          ? null
          : Object.freeze({ ...value.candidate.targetIdentity }),
      review:
        value.candidate.review === null
          ? null
          : Object.freeze({ ...value.candidate.review }),
    }),
    target: Object.freeze({
      kind: value.target.kind,
      path: value.target.path,
      previousIdentity:
        value.target.previousIdentity === null
          ? null
          : Object.freeze({ ...value.target.previousIdentity }),
      newIdentity: Object.freeze({ ...value.target.newIdentity }),
    }),
    invalidatedContexts: Object.freeze(
      value.invalidatedContexts.map((context) => Object.freeze({ ...context })),
    ),
    supersedes: Object.freeze([...value.supersedes]),
  });
}

function isNullableContentHash(value: unknown): value is ContentHash | null {
  return value === null || isContentHash(value);
}

function isContentHash(value: unknown): value is ContentHash {
  return validateDomainValue({
    contractVersion: DOMAIN_VALIDATION_CONTRACT_VERSION,
    kind: "contentHash",
    value,
  }).ok;
}

function sameContentHash(
  left: ContentHash | null,
  right: ContentHash | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.algorithm === right.algorithm &&
    left.digest.toLowerCase() === right.digest.toLowerCase()
  );
}

function normalizeText(content: string): string {
  return content.replace(/\r\n?/gu, "\n");
}

function promotionFilePath(eventId: string): string {
  return `${PROMOTIONS_DIRECTORY}/${createHash("sha256").update(eventId).digest("hex")}.json`;
}

function serializePromotion(promotion: KnowledgePromotionRecord): string {
  return `${JSON.stringify(promotion, null, 2)}\n`;
}

function serializePromotionJournal(journal: PromotionJournal): string {
  return `${JSON.stringify(journal, null, 2)}\n`;
}

function promotionSuccess(
  promotion: KnowledgePromotionRecord,
  appended: boolean,
  planned: boolean,
): PromoteKnowledgeCandidateResult {
  return Object.freeze({
    ok: true,
    contractVersion: KNOWLEDGE_PROMOTION_CONTRACT_VERSION,
    promotion,
    appended,
    planned,
  });
}

function eventConflict(): KnowledgePromotionFailure {
  return failure(
    "knowledge.promotion.event.conflict",
    "$.event",
    "Promotion Event identity was already used for different promotion material.",
    "Reuse Event identities only when retrying the exact same promotion.",
  );
}

function failure(
  code: KnowledgePromotionDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): KnowledgePromotionFailure {
  return Object.freeze({
    ok: false,
    contractVersion: KNOWLEDGE_PROMOTION_CONTRACT_VERSION,
    diagnostics: Object.freeze([
      Object.freeze({ code, path, message, remediation }),
    ]),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
