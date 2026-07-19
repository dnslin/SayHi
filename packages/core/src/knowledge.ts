import { createHash } from "node:crypto";

import { hashTextContent } from "./context-manifest.js";
import { hashKnowledgeCandidateContent } from "./knowledge-candidate.js";
import type { ManagedProjectPathKind } from "./managed-project.js";
import {
  RECORD_CONTRACT_VERSION,
  isKnowledgeCandidateStatus,
  isKnowledgeReviewDisposition,
  validateContractRecord,
  type KnowledgeCandidateRecord,
  type KnowledgeCandidateStatus,
  type KnowledgeConfidence,
  type KnowledgeReviewDisposition,
} from "./record-contracts.js";
import {
  canonicalRepositoryRelativePath,
  isRepositoryRelativePath,
} from "./repository-path.js";
import {
  readDurableTask,
  readAcceptedTaskEvidenceReferences,
  type TaskLifecycleFileSystem,
} from "./task-lifecycle.js";
import {
  isIdentifier,
  isTimestamp,
  type ContentHash,
} from "./validation.js";

export const KNOWLEDGE_CONTRACT_VERSION = 1 as const;

const KNOWLEDGE_DIRECTORY = ".sayhi/knowledge";
const CANDIDATES_DIRECTORY = `${KNOWLEDGE_DIRECTORY}/candidates`;
const KNOWLEDGE_LOCK_DIRECTORY = ".sayhi/.runtime";

export interface KnowledgeCandidateFileSystem extends TaskLifecycleFileSystem {
  inspectRepositoryPath(path: string): Promise<Readonly<{ kind: ManagedProjectPathKind }>>;
  readRepositoryFile(path: string): Promise<string>;
}

export interface KnowledgeCandidateDraft {
  readonly id: string;
  readonly type: string;
  readonly statement: string;
  readonly scope: readonly string[];
  readonly evidence: readonly string[];
  readonly confidence: KnowledgeConfidence;
  readonly proposedAction: string;
  readonly target: string;
  readonly createdBy: string;
}

export interface CreateKnowledgeCandidateRequest {
  readonly fileSystem: KnowledgeCandidateFileSystem;
  readonly taskId: string;
  readonly createdAt: string;
  readonly candidate: KnowledgeCandidateDraft;
}

export interface ReadKnowledgeCandidateRequest {
  readonly fileSystem: KnowledgeCandidateFileSystem;
  readonly candidateId: string;
}

export interface ListKnowledgeCandidatesRequest {
  readonly fileSystem: KnowledgeCandidateFileSystem;
  readonly status?: KnowledgeCandidateStatus;
}

export interface ReviewKnowledgeCandidateRequest {
  readonly fileSystem: KnowledgeCandidateFileSystem;
  readonly candidateId: string;
  readonly disposition: KnowledgeReviewDisposition;
  readonly reviewer: string;
  readonly reason: string;
  readonly reviewedAt: string;
}

export type KnowledgeCandidateDiagnosticCode =
  | "knowledge.candidate.id.invalid"
  | "knowledge.candidate.input.invalid"
  | "knowledge.candidate.source.invalid"
  | "knowledge.candidate.source.incomplete"
  | "knowledge.candidate.evidence.unlinked"
  | "knowledge.candidate.missing"
  | "knowledge.candidate.invalid"
  | "knowledge.candidate.review.invalid"
  | "knowledge.candidate.reviewed"
  | "knowledge.candidate.stale"
  | "knowledge.candidate.store.invalid"
  | "knowledge.candidate.io_failed";

export interface KnowledgeCandidateDiagnostic {
  readonly code: KnowledgeCandidateDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

type KnowledgeCandidateFailure = Readonly<{
  ok: false;
  contractVersion: typeof KNOWLEDGE_CONTRACT_VERSION;
  diagnostics: readonly KnowledgeCandidateDiagnostic[];
}>;

export type KnowledgeCandidateCreationDisposition =
  | Readonly<{ kind: "created" }>
  | Readonly<{ kind: "duplicate"; candidateId: string }>;

export type CreateKnowledgeCandidateResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof KNOWLEDGE_CONTRACT_VERSION;
      candidate: KnowledgeCandidateRecord;
      disposition: KnowledgeCandidateCreationDisposition;
    }>
  | KnowledgeCandidateFailure;

export type ReadKnowledgeCandidateResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof KNOWLEDGE_CONTRACT_VERSION;
      candidate: KnowledgeCandidateRecord;
    }>
  | KnowledgeCandidateFailure;

export type KnowledgeCandidateDisposition =
  | Readonly<{ kind: "ready"; action: "review" }>
  | Readonly<{
      kind: "duplicate";
      action: "review-existing";
      candidateId: string;
    }>
  | Readonly<{
      kind: "stale";
      action: "request-revision";
      reason: string;
    }>
  | Readonly<{ kind: "reviewed"; action: "none" }>;

export interface ListedKnowledgeCandidate {
  readonly candidate: KnowledgeCandidateRecord;
  readonly disposition: KnowledgeCandidateDisposition;
}

export type ListKnowledgeCandidatesResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof KNOWLEDGE_CONTRACT_VERSION;
      candidates: readonly ListedKnowledgeCandidate[];
    }>
  | KnowledgeCandidateFailure;

export type ReviewKnowledgeCandidateResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof KNOWLEDGE_CONTRACT_VERSION;
      candidate: KnowledgeCandidateRecord;
    }>
  | KnowledgeCandidateFailure;

export async function createKnowledgeCandidate(
  request: CreateKnowledgeCandidateRequest,
): Promise<CreateKnowledgeCandidateResult> {
  const inputFailure = validateCreationInput(request);
  if (inputFailure !== null) {
    return inputFailure;
  }
  const target = canonicalRepositoryRelativePath(request.candidate.target);
  if (target.length === 0) {
    return failure(
      "knowledge.candidate.input.invalid",
      "$.candidate.target",
      "Knowledge Candidate target must identify a repository file.",
      "Provide a normalized non-directory target path.",
    );
  }
  const normalizedRequest = Object.freeze({
    ...request,
    candidate: Object.freeze({ ...request.candidate, target }),
  });
  const candidatePath = candidateFilePath(request.candidate.id);
  try {
    return await request.fileSystem.withTaskMutationLock(
      knowledgeStoreLockPath(),
      async () => {
        const source = await readDurableTask({
          fileSystem: request.fileSystem,
          taskId: request.taskId,
        });
        if (!source.ok) {
          const diagnostic = source.diagnostics[0];
          return failure(
            "knowledge.candidate.source.invalid",
            diagnostic?.path ?? request.taskId,
            diagnostic?.message ?? "The source Task could not be read.",
            diagnostic?.remediation ?? "Restore the source Task before generating Knowledge Candidates.",
          );
        }
        if (
          source.state.projection.phase !== "finish" ||
          source.state.projection.lifecycle !== "completed"
        ) {
          return failure(
            "knowledge.candidate.source.incomplete",
            `$.taskId`,
            "Knowledge Candidates require a completed Task.",
            "Complete the source Task before generating Knowledge Candidates.",
          );
        }

        const sourceEvidence = readAcceptedTaskEvidenceReferences(source.state);
        const unlinkedEvidence = request.candidate.evidence.find(
          (reference) => !sourceEvidence.has(reference),
        );
        if (unlinkedEvidence !== undefined) {
          return failure(
            "knowledge.candidate.evidence.unlinked",
            "$.candidate.evidence",
            `Knowledge Candidate Evidence ${unlinkedEvidence} is not accepted by the source Task.`,
            "Reference Evidence recorded by the completed source Task.",
          );
        }

        const targetIdentity = await readTargetIdentity(request.fileSystem, target);
        if (!targetIdentity.ok) {
          return targetIdentity;
        }
        const candidate = candidateRecord(normalizedRequest, targetIdentity.identity);
        const validation = validateCandidate(candidate, candidatePath);
        if (!validation.ok) {
          return validation;
        }

        const existing = await loadCandidateRecords(request.fileSystem);
        if (!existing.ok) {
          return existing;
        }
        const duplicate = existing.candidates.find(
          (existingCandidate) =>
            existingCandidate.contentHash === candidate.contentHash &&
            existingCandidate.status !== "rejected" &&
            existingCandidate.status !== "revision-requested" &&
            existingCandidate.status !== "superseded",
        );
        if (duplicate !== undefined) {
          return Object.freeze({
            ok: true,
            contractVersion: KNOWLEDGE_CONTRACT_VERSION,
            candidate: duplicate,
            disposition: Object.freeze({ kind: "duplicate", candidateId: duplicate.id }),
          });
        }

        const directories = await prepareKnowledgeDirectories(request.fileSystem);
        if (directories !== null) {
          return directories;
        }
        const entry = await request.fileSystem.inspect(candidatePath);
        if (entry.kind === "file") {
          const loaded = await loadCandidate(request.fileSystem, request.candidate.id);
          if (!loaded.ok) {
            return loaded;
          }
          if (loaded.candidate.contentHash === candidate.contentHash) {
            return Object.freeze({
              ok: true,
              contractVersion: KNOWLEDGE_CONTRACT_VERSION,
              candidate: loaded.candidate,
              disposition: Object.freeze({
                kind: "duplicate",
                candidateId: loaded.candidate.id,
              }),
            });
          }
          return failure(
            "knowledge.candidate.id.invalid",
            `$.candidate.id`,
            "A different Knowledge Candidate already owns this candidate id.",
            "Choose a new candidate id; candidate ids are stable provenance identifiers.",
          );
        }
        if (entry.kind !== "missing") {
          return failure(
            "knowledge.candidate.store.invalid",
            candidatePath,
            "The Knowledge Candidate storage path is not a regular file location.",
            "Restore a safe Candidate store before generating Knowledge Candidates.",
          );
        }
        await request.fileSystem.writeFile(candidatePath, serializeCandidate(candidate));
        return Object.freeze({
          ok: true,
          contractVersion: KNOWLEDGE_CONTRACT_VERSION,
          candidate,
          disposition: Object.freeze({ kind: "created" }),
        });
      },
    );
  } catch {
    return failure(
      "knowledge.candidate.io_failed",
      candidatePath,
      "Knowledge Candidate generation could not complete filesystem access.",
      "Inspect the Project Store and retry without changing current knowledge.",
    );
  }
}

export async function readKnowledgeCandidate(
  request: ReadKnowledgeCandidateRequest,
): Promise<ReadKnowledgeCandidateResult> {
  if (!isIdentifier(request.candidateId)) {
    return invalidCandidateId(request.candidateId);
  }
  try {
    return await loadCandidate(request.fileSystem, request.candidateId);
  } catch {
    return failure(
      "knowledge.candidate.io_failed",
      candidateFilePath(request.candidateId),
      "The Knowledge Candidate could not be read safely.",
      "Inspect the Candidate store and retry.",
    );
  }
}

export async function listKnowledgeCandidates(
  request: ListKnowledgeCandidatesRequest,
): Promise<ListKnowledgeCandidatesResult> {
  if (request.status !== undefined && !isKnowledgeCandidateStatus(request.status)) {
    return failure(
      "knowledge.candidate.input.invalid",
      "$.status",
      "Knowledge Candidate status is unsupported.",
      "Use pending, accepted, rejected, revision-requested, or superseded.",
    );
  }
  try {
    const loaded = await loadCandidateRecords(request.fileSystem);
    if (!loaded.ok) {
      return loaded;
    }
    const filtered = request.status === undefined
      ? loaded.candidates
      : loaded.candidates.filter((candidate) => candidate.status === request.status);
    const candidates = await Promise.all(
      filtered.map(async (candidate) =>
        Object.freeze({
          candidate,
          disposition: await candidateDisposition(request.fileSystem, candidate, loaded.candidates),
        }),
      ),
    );
    return Object.freeze({
      ok: true,
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      candidates: Object.freeze(candidates),
    });
  } catch {
    return failure(
      "knowledge.candidate.io_failed",
      CANDIDATES_DIRECTORY,
      "Knowledge Candidates could not be listed safely.",
      "Inspect the Candidate store and retry.",
    );
  }
}

export async function reviewKnowledgeCandidate(
  request: ReviewKnowledgeCandidateRequest,
): Promise<ReviewKnowledgeCandidateResult> {
  const inputFailure = validateReviewInput(request);
  if (inputFailure !== null) {
    return inputFailure;
  }
  const path = candidateFilePath(request.candidateId);
  try {
    return await request.fileSystem.withTaskMutationLock(
      knowledgeStoreLockPath(),
      async () => {
        const loaded = await loadCandidate(request.fileSystem, request.candidateId);
        if (!loaded.ok) {
          return loaded;
        }
        if (loaded.candidate.status !== "pending") {
          return failure(
            "knowledge.candidate.reviewed",
            path,
            "Only pending Knowledge Candidates may receive a human review decision.",
            "Generate a revised Candidate or inspect the recorded review decision.",
          );
        }
        if (request.disposition === "approved") {
          const stale = await staleReason(request.fileSystem, loaded.candidate);
          if (stale !== null) {
            return failure(
              "knowledge.candidate.stale",
              path,
              stale,
              "Request a revision before approving a Candidate whose target changed.",
            );
          }
        }
        const candidate = reviewedCandidate(loaded.candidate, request);
        const validation = validateCandidate(candidate, path);
        if (!validation.ok) {
          return validation;
        }
        await request.fileSystem.writeFile(path, serializeCandidate(candidate));
        return Object.freeze({
          ok: true,
          contractVersion: KNOWLEDGE_CONTRACT_VERSION,
          candidate,
        });
      },
    );
  } catch {
    return failure(
      "knowledge.candidate.io_failed",
      path,
      "Knowledge Candidate review could not complete filesystem access.",
      "Inspect the Candidate store and retry the human review decision.",
    );
  }
}

function validateCreationInput(
  request: CreateKnowledgeCandidateRequest,
): KnowledgeCandidateFailure | null {
  if (!isIdentifier(request.taskId)) {
    return failure(
      "knowledge.candidate.input.invalid",
      "$.taskId",
      "Knowledge Candidate generation requires a source Task id.",
      "Provide the completed source Task id.",
    );
  }
  if (!isTimestamp(request.createdAt)) {
    return failure(
      "knowledge.candidate.input.invalid",
      "$.createdAt",
      "Knowledge Candidate creation time must be an RFC 3339 UTC timestamp.",
      "Provide a valid UTC timestamp.",
    );
  }
  if (!isIdentifier(request.candidate.id)) {
    return invalidCandidateId(request.candidate.id);
  }
  if (!isRepositoryRelativePath(request.candidate.target)) {
    return failure(
      "knowledge.candidate.input.invalid",
      "$.candidate.target",
      "Knowledge Candidate target must be a repository-relative path.",
      "Provide a normalized target path without traversal or an absolute root.",
    );
  }
  if (!isStringArray(request.candidate.scope) || !isStringArray(request.candidate.evidence)) {
    return failure(
      "knowledge.candidate.input.invalid",
      "$.candidate",
      "Knowledge Candidate scope and Evidence must be string arrays.",
      "Provide schema-valid Candidate content before generating it.",
    );
  }
  return null;
}

function validateReviewInput(
  request: ReviewKnowledgeCandidateRequest,
): KnowledgeCandidateFailure | null {
  if (!isIdentifier(request.candidateId)) {
    return invalidCandidateId(request.candidateId);
  }
  if (!isKnowledgeReviewDisposition(request.disposition)) {
    return failure(
      "knowledge.candidate.review.invalid",
      "$.disposition",
      "Knowledge Candidate review disposition is unsupported.",
      "Approve, reject, or request revision.",
    );
  }
  if (!isIdentifier(request.reviewer) || request.reason.length === 0) {
    return failure(
      "knowledge.candidate.review.invalid",
      "$.review",
      "Knowledge Candidate review requires a reviewer id and a non-empty reason.",
      "Record the human reviewer and their decision rationale.",
    );
  }
  if (!isTimestamp(request.reviewedAt)) {
    return failure(
      "knowledge.candidate.review.invalid",
      "$.reviewedAt",
      "Knowledge Candidate review time must be an RFC 3339 UTC timestamp.",
      "Provide a valid UTC timestamp.",
    );
  }
  return null;
}

function candidateRecord(
  request: CreateKnowledgeCandidateRequest,
  targetIdentity: ContentHash | null,
): KnowledgeCandidateRecord {
  const candidate: KnowledgeCandidateRecord = {
    schemaVersion: 1,
    id: request.candidate.id,
    taskId: request.taskId,
    type: request.candidate.type,
    statement: request.candidate.statement,
    scope: Object.freeze([...request.candidate.scope]),
    evidence: Object.freeze([...request.candidate.evidence]),
    confidence: request.candidate.confidence,
    proposedAction: request.candidate.proposedAction,
    target: request.candidate.target,
    contentHash: hashKnowledgeCandidateContent(request.candidate),
    targetIdentity,
    status: "pending",
    createdBy: request.candidate.createdBy,
    createdAt: request.createdAt,
    review: null,
  };
  return Object.freeze(candidate);
}

function reviewedCandidate(
  candidate: KnowledgeCandidateRecord,
  request: ReviewKnowledgeCandidateRequest,
): KnowledgeCandidateRecord {
  return Object.freeze({
    ...candidate,
    status: reviewStatus(request.disposition),
    review: Object.freeze({
      disposition: request.disposition,
      reviewer: request.reviewer,
      reason: request.reason,
      reviewedAt: request.reviewedAt,
    }),
  });
}

async function loadCandidate(
  fileSystem: KnowledgeCandidateFileSystem,
  candidateId: string,
): Promise<ReadKnowledgeCandidateResult> {
  const path = candidateFilePath(candidateId);
  const entry = await fileSystem.inspect(path);
  if (entry.kind !== "file") {
    return failure(
      "knowledge.candidate.missing",
      path,
      "The requested Knowledge Candidate is missing or unsafe.",
      "Generate the Candidate again or repair the Candidate store.",
    );
  }
  let record: unknown;
  try {
    record = JSON.parse(await fileSystem.readFile(path));
  } catch {
    return failure(
      "knowledge.candidate.invalid",
      path,
      "The Knowledge Candidate record is not valid JSON.",
      "Restore the Candidate record generated by Core.",
    );
  }
  const validation = validateCandidate(record, path);
  if (!validation.ok) {
    return validation;
  }
  if (validation.candidate.id !== candidateId) {
    return failure(
      "knowledge.candidate.invalid",
      path,
      "The Candidate storage identity does not match its durable candidate id.",
      "Restore the Candidate to its canonical storage path.",
    );
  }
  return Object.freeze({
    ok: true,
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    candidate: validation.candidate,
  });
}

async function loadCandidateRecords(
  fileSystem: KnowledgeCandidateFileSystem,
): Promise<Readonly<{ ok: true; candidates: readonly KnowledgeCandidateRecord[] }> | KnowledgeCandidateFailure> {
  const directory = await fileSystem.inspect(CANDIDATES_DIRECTORY);
  if (directory.kind === "missing") {
    return Object.freeze({ ok: true, candidates: Object.freeze([]) });
  }
  if (directory.kind !== "directory") {
    return failure(
      "knowledge.candidate.store.invalid",
      CANDIDATES_DIRECTORY,
      "The Knowledge Candidate store is not a directory.",
      "Repair the Candidate store before listing or reviewing Candidates.",
    );
  }
  const candidates: KnowledgeCandidateRecord[] = [];
  for (const entry of await fileSystem.listDirectory(CANDIDATES_DIRECTORY)) {
    const path = `${CANDIDATES_DIRECTORY}/${entry.name}`;
    if (entry.kind !== "file" || !entry.name.endsWith(".json")) {
      return failure(
        "knowledge.candidate.store.invalid",
        path,
        "The Knowledge Candidate store contains an unsafe entry.",
        "Keep only Core-generated Candidate JSON records in the Candidate store.",
      );
    }
    let record: unknown;
    try {
      record = JSON.parse(await fileSystem.readFile(path));
    } catch {
      return failure(
        "knowledge.candidate.invalid",
        path,
        "A Knowledge Candidate record is not valid JSON.",
        "Restore the Candidate record generated by Core.",
      );
    }
    const validation = validateCandidate(record, path);
    if (!validation.ok) {
      return validation;
    }
    if (candidateFilePath(validation.candidate.id) !== path) {
      return failure(
        "knowledge.candidate.invalid",
        path,
        "The Candidate record is stored at a non-canonical path.",
        "Restore the Candidate to its canonical storage path.",
      );
    }
    candidates.push(validation.candidate);
  }
  return Object.freeze({
    ok: true,
    candidates: Object.freeze(candidates.sort((left, right) => left.id.localeCompare(right.id))),
  });
}

async function prepareKnowledgeDirectories(
  fileSystem: KnowledgeCandidateFileSystem,
): Promise<KnowledgeCandidateFailure | null> {
  for (const path of [KNOWLEDGE_DIRECTORY, CANDIDATES_DIRECTORY]) {
    const entry = await fileSystem.inspect(path);
    if (entry.kind === "missing") {
      await fileSystem.createDirectory(path);
    } else if (entry.kind !== "directory") {
      return failure(
        "knowledge.candidate.store.invalid",
        path,
        "Knowledge Candidate storage has a non-directory parent.",
        "Restore the Project Store directory before generating Candidates.",
      );
    }
  }
  return null;
}

export type RepositoryTargetIdentity =
  | Readonly<{ kind: "file"; identity: ContentHash }>
  | Readonly<{ kind: Exclude<ManagedProjectPathKind, "file">; identity: null }>;

export async function readRepositoryTargetIdentity(
  fileSystem: KnowledgeCandidateFileSystem,
  target: string,
): Promise<RepositoryTargetIdentity> {
  const entry = await fileSystem.inspectRepositoryPath(target);
  if (entry.kind !== "file") {
    return Object.freeze({ kind: entry.kind, identity: null });
  }
  return Object.freeze({
    kind: "file",
    identity: hashTextContent(await fileSystem.readRepositoryFile(target)),
  });
}

async function readTargetIdentity(
  fileSystem: KnowledgeCandidateFileSystem,
  target: string,
): Promise<Readonly<{ ok: true; identity: ContentHash | null }> | KnowledgeCandidateFailure> {
  const entry = await readRepositoryTargetIdentity(fileSystem, target);
  if (entry.kind === "missing") {
    return Object.freeze({ ok: true, identity: null });
  }
  if (entry.kind !== "file") {
    return failure(
      "knowledge.candidate.input.invalid",
      target,
      "Knowledge Candidate target exists but is not a regular file.",
      "Choose a new target or repair the existing target path.",
    );
  }
  return Object.freeze({ ok: true, identity: entry.identity });
}

async function candidateDisposition(
  fileSystem: KnowledgeCandidateFileSystem,
  candidate: KnowledgeCandidateRecord,
  candidates: readonly KnowledgeCandidateRecord[],
): Promise<KnowledgeCandidateDisposition> {
  const stale = await staleReason(fileSystem, candidate);
  if (stale !== null) {
    return Object.freeze({
      kind: "stale",
      action: "request-revision",
      reason: stale,
    });
  }
  const duplicate = candidates.find(
    (other) =>
      other.id !== candidate.id &&
      other.contentHash === candidate.contentHash &&
      other.status !== "rejected" &&
      other.status !== "revision-requested" &&
      other.status !== "superseded",
  );
  if (duplicate !== undefined) {
    return Object.freeze({
      kind: "duplicate",
      action: "review-existing",
      candidateId: duplicate.id,
    });
  }
  return candidate.status === "pending"
    ? Object.freeze({ kind: "ready", action: "review" })
    : Object.freeze({ kind: "reviewed", action: "none" });
}

async function staleReason(
  fileSystem: KnowledgeCandidateFileSystem,
  candidate: KnowledgeCandidateRecord,
): Promise<string | null> {
  const entry = await fileSystem.inspectRepositoryPath(candidate.target);
  if (candidate.targetIdentity === null) {
    return entry.kind === "missing"
      ? null
      : "The candidate target changed after candidate generation.";
  }
  if (entry.kind !== "file") {
    return "The candidate target changed after candidate generation.";
  }
  const current = hashTextContent(await fileSystem.readRepositoryFile(candidate.target));
  return sameContentHash(current, candidate.targetIdentity)
    ? null
    : "The candidate target changed after candidate generation.";
}

function validateCandidate(
  value: unknown,
  path: string,
): Readonly<{ ok: true; candidate: KnowledgeCandidateRecord }> | KnowledgeCandidateFailure {
  const validation = validateContractRecord({
    contractVersion: RECORD_CONTRACT_VERSION,
    kind: "knowledgeCandidate",
    record: value,
  });
  if (!validation.ok) {
    const diagnostic = validation.diagnostics[0];
    return failure(
      "knowledge.candidate.invalid",
      path,
      diagnostic?.message ?? "Knowledge Candidate record is invalid.",
      diagnostic?.remediation ?? "Restore a schema-valid Candidate record.",
    );
  }
  return Object.freeze({
    ok: true,
    candidate: validation.record as KnowledgeCandidateRecord,
  });
}

function candidateFilePath(candidateId: string): string {
  return `${CANDIDATES_DIRECTORY}/${candidateStorageKey(candidateId)}.json`;
}

function knowledgeStoreLockPath(): string {
  return `${KNOWLEDGE_LOCK_DIRECTORY}/knowledge-candidates.lock`;
}

function candidateStorageKey(candidateId: string): string {
  return createHash("sha256").update(candidateId).digest("hex");
}


function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}


function reviewStatus(disposition: KnowledgeReviewDisposition): KnowledgeCandidateStatus {
  switch (disposition) {
    case "approved":
      return "accepted";
    case "rejected":
      return "rejected";
    case "revision-requested":
      return "revision-requested";
  }
}



function sameContentHash(left: ContentHash, right: ContentHash): boolean {
  return (
    left.algorithm === right.algorithm &&
    left.digest.toLowerCase() === right.digest.toLowerCase()
  );
}

function serializeCandidate(candidate: KnowledgeCandidateRecord): string {
  return `${JSON.stringify(candidate, null, 2)}\n`;
}

function invalidCandidateId(candidateId: unknown): KnowledgeCandidateFailure {
  return failure(
    "knowledge.candidate.id.invalid",
    "$.candidateId",
    `Knowledge Candidate id ${String(candidateId)} is invalid.`,
    "Provide a stable, non-empty Candidate id.",
  );
}

function failure(
  code: KnowledgeCandidateDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): KnowledgeCandidateFailure {
  return Object.freeze({
    ok: false,
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    diagnostics: Object.freeze([
      Object.freeze({ code, path, message, remediation }),
    ]),
  });
}
