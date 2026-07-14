import {
  hashCanonicalJson,
  isContractIdentity,
  type ContractIdentity,
} from "./identity.js";

import { isRepositoryRelativePath } from "./repository-path.js";
import { isWorkflowPhase, type TaskScope, type WorkflowPhase } from "./workflow.js";
import type { PhaseAgentRole } from "./execution.js";
import {
  DURABLE_RECORD_SCHEMA_VERSION,
  isIdentifier,
  validateDomainValue,
  type ContentHash,
} from "./validation.js";

export const RECORD_CONTRACT_VERSION = 1 as const;

export type ContractRecordKind =
  | "baseline"
  | "lease"
  | "agentResult"
  | "evidence"
  | "projectManifest"
  | "knowledgeCandidate"
  | "externalReference"
  | "skillLock"
  | "managedFile";

export type KnowledgeCandidateStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "superseded";
export type KnowledgeConfidence = "low" | "medium" | "high";
export type ManagedFileOwnershipClass =
  | "engine-owned"
  | "user-owned"
  | "managed-customizable";

export type KnowledgeCandidateRecord = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
  readonly id: string;
  readonly taskId: string;
  readonly type: string;
  readonly statement: string;
  readonly scope: readonly string[];
  readonly evidence: readonly string[];
  readonly confidence: KnowledgeConfidence;
  readonly proposedAction: string;
  readonly target: string;
  readonly status: KnowledgeCandidateStatus;
  readonly createdBy: string;
};

export type ExternalReferenceRecord = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
  readonly id: string;
  readonly kind: string;
  readonly adapter: string;
  readonly uri: string;
  readonly externalId: string;
  readonly observedVersion: string;
  readonly role: string;
  readonly identity: ContractIdentity | ContentHash | null;
  readonly lastObservedAt: string;
};

export interface SkillLockFile {
  readonly path: string;
  readonly sha256: ContentHash;
}

export interface SkillUpstreamIdentity {
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
  readonly license: string;
}

export interface LockedSkill {
  readonly name: string;
  readonly path: string;
  readonly files: readonly SkillLockFile[];
  readonly upstream: SkillUpstreamIdentity;
  readonly sidecarIdentity: ContractIdentity;
}

export type SkillLockRecord = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
  readonly registry: Readonly<{
    readonly repository: string;
    readonly commit: string;
  }>;
  readonly skills: readonly LockedSkill[];
};

export type ManagedFileRecord = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
  readonly path: string;
  readonly ownershipClass: ManagedFileOwnershipClass;
  readonly installedBaseIdentity?: ContentHash;
  readonly generatedSourceVersion: string;
  readonly markerIds: readonly string[];
  readonly incomingUpdateIdentity?: ContentHash;
  readonly localOverrideSource?: string;
};

export interface BaselineUntrackedFile {
  readonly path: string;
  readonly identity: ContentHash;
}

export type BaselineRecord = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
  readonly capturedAt: string;
  readonly repositoryRootIdentity: string;
  readonly head: string | null;
  readonly indexDigest: ContractIdentity;
  readonly trackedWorktreeDigest: ContractIdentity;
  readonly untracked: readonly BaselineUntrackedFile[];
  readonly submodulesDigest: ContractIdentity;
  readonly adoptedPaths: readonly string[];
  readonly declaredScope: TaskScope;
};

export type LeaseKind = "reader" | "writer" | "validation";

export interface LeaseOwner {
  readonly sessionId: string;
  readonly processId: number;
  readonly hostId: string;
  readonly installId: string;
}

export type LeaseRecord = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
  readonly leaseId: string;
  readonly kind: LeaseKind;
  readonly projectId: string;
  readonly taskId: string;
  readonly owner: LeaseOwner;
  readonly baseFingerprint: ContractIdentity;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
};

export type AgentResultOutcome = "succeeded" | "failed" | "blocked";

export type AgentResultRecord = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
  readonly dispatchId: string;
  readonly taskId: string;
  readonly expectedTaskVersion: number;
  readonly phase: WorkflowPhase;
  readonly agentRole: PhaseAgentRole;
  readonly contextManifestIdentity: ContractIdentity;
  readonly agentContractIdentity: ContractIdentity;
  readonly outcome: AgentResultOutcome;
  readonly artifacts: readonly string[];
  readonly evidence: readonly string[];
  readonly findings: readonly string[];
  readonly observedFinalFingerprint: ContractIdentity;
};

export type EvidenceResult = "not-run" | "passed" | "failed" | "inconclusive";

export interface EvidenceCommand {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly exitCode: number;
}

export type EvidenceRecord = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
  readonly id: string;
  readonly taskId: string;
  readonly kind: string;
  readonly producer: string;
  readonly baseFingerprint: ContractIdentity;
  readonly command: EvidenceCommand;
  readonly artifacts: readonly string[];
  readonly result: EvidenceResult;
  readonly startedAt: string;
  readonly completedAt: string;
};

export interface InstalledProjectVersions {
  readonly core: string;
  readonly cli: string;
  readonly ompPlugin: string;
  readonly projectSchema: number;
  readonly templates: string;
  readonly skillLockDigest: ContractIdentity;
}

export type ProjectManifestRecord = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
  readonly projectId: string;
  readonly installed: InstalledProjectVersions;
  readonly initializedAt: string;
  readonly updatedAt: string;
  readonly ownershipManifest: string;
};

export type ContractRecord =
  | BaselineRecord
  | LeaseRecord
  | AgentResultRecord
  | EvidenceRecord
  | ProjectManifestRecord
  | KnowledgeCandidateRecord
  | ExternalReferenceRecord
  | SkillLockRecord
  | ManagedFileRecord;

export interface ContractRecordValidationRequest {
  readonly contractVersion: typeof RECORD_CONTRACT_VERSION;
  readonly kind: ContractRecordKind;
  readonly record: unknown;
  readonly expectedIdentity?: ContractIdentity;
}

export type ContractRecordDiagnosticCode =
  | "record_contract.request.invalid"
  | "record_contract.contract_version.unsupported"
  | "record_contract.kind.unsupported"
  | "record_contract.schema_version.unsupported"
  | "record_contract.baseline.invalid"
  | "record_contract.lease.invalid"
  | "record_contract.agent_result.invalid"
  | "record_contract.evidence.invalid"
  | "record_contract.project_manifest.invalid"
  | "record_contract.knowledge.invalid"
  | "record_contract.external_reference.invalid"
  | "record_contract.skill_lock.invalid"
  | "record_contract.skill.duplicate"
  | "record_contract.managed_file.invalid"
  | "record_contract.ownership.invalid"
  | "record_contract.identity.invalid"
  | "record_contract.identity.mismatch";

export interface ContractRecordDiagnostic {
  readonly code: ContractRecordDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

export interface ContractRecordValidationSuccess {
  readonly ok: true;
  readonly contractVersion: typeof RECORD_CONTRACT_VERSION;
  readonly kind: ContractRecordKind;
  readonly record: ContractRecord;
  readonly identity: ContractIdentity;
}

export interface ContractRecordValidationFailure {
  readonly ok: false;
  readonly contractVersion: typeof RECORD_CONTRACT_VERSION;
  readonly diagnostics: readonly ContractRecordDiagnostic[];
}

export type ContractRecordValidationResult =
  | ContractRecordValidationSuccess
  | ContractRecordValidationFailure;

type UnknownRecord = Record<string, unknown>;
type JsonData =
  | null
  | string
  | boolean
  | number
  | readonly JsonData[]
  | { readonly [key: string]: JsonData };

const INVALID_JSON = Symbol("invalid-json");
const FULL_GIT_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;

export function validateContractRecord(
  request: unknown,
): ContractRecordValidationResult {
  try {
    const copiedRequest = copyJsonData(request, new WeakSet<object>());
    if (copiedRequest === INVALID_JSON || !isRecord(copiedRequest)) {
      return failure(
        "record_contract.request.invalid",
        "$",
        "Contract record validation request must be a lossless JSON object.",
        "Provide contractVersion, kind, and record as plain JSON data.",
      );
    }
    return validateReadableRequest(copiedRequest);
  } catch {
    return failure(
      "record_contract.request.invalid",
      "$",
      "Contract record validation request could not be read safely.",
      "Provide a plain data object without accessors and retry.",
    );
  }
}

function validateReadableRequest(
  request: UnknownRecord,
): ContractRecordValidationResult {
  if (request.contractVersion !== RECORD_CONTRACT_VERSION) {
    return failure(
      "record_contract.contract_version.unsupported",
      "$.contractVersion",
      `Contract record version ${String(request.contractVersion)} is unsupported.`,
      `Use contract record version ${RECORD_CONTRACT_VERSION}.`,
    );
  }
  if (!isContractRecordKind(request.kind)) {
    return failure(
      "record_contract.kind.unsupported",
      "$.kind",
      "Contract record kind is unsupported.",
      "Use baseline, lease, agentResult, evidence, projectManifest, knowledgeCandidate, externalReference, skillLock, or managedFile.",
    );
  }
  if (!isRecord(request.record)) {
    return failure(
      "record_contract.request.invalid",
      "$.record",
      "Contract record must be an object.",
      "Provide a versioned durable record object.",
    );
  }
  if (request.record.schemaVersion !== DURABLE_RECORD_SCHEMA_VERSION) {
    return failure(
      "record_contract.schema_version.unsupported",
      "$.record.schemaVersion",
      `Contract record schema version ${String(request.record.schemaVersion)} is unsupported.`,
      `Use schema version ${DURABLE_RECORD_SCHEMA_VERSION}.`,
    );
  }

  const recordFailure = validateRecord(request.kind, request.record);
  if (recordFailure !== null) {
    return recordFailure;
  }

  const identity = hashCanonicalJson(request.record);
  if (Object.hasOwn(request, "expectedIdentity")) {
    if (!isContractIdentity(request.expectedIdentity)) {
      return failure(
        "record_contract.identity.invalid",
        "$.expectedIdentity",
        "Expected contract record identity must be a SHA-256 identity.",
        "Provide an identity in sha256:<64 hexadecimal characters> form.",
      );
    }
    if (request.expectedIdentity.toLowerCase() !== identity) {
      return failure(
        "record_contract.identity.mismatch",
        "$.expectedIdentity",
        "Contract record does not match the expected identity.",
        "Reject persistence and load the record matching the referenced identity.",
      );
    }
  }

  return Object.freeze({
    ok: true,
    contractVersion: RECORD_CONTRACT_VERSION,
    kind: request.kind,
    record: request.record as ContractRecord,
    identity,
  });
}

function validateRecord(
  kind: ContractRecordKind,
  record: UnknownRecord,
): ContractRecordValidationFailure | null {
  switch (kind) {
    case "baseline":
      return validateBaseline(record);
    case "lease":
      return validateLease(record);
    case "agentResult":
      return validateAgentResult(record);
    case "evidence":
      return validateEvidence(record);
    case "projectManifest":
      return validateProjectManifest(record);
    case "knowledgeCandidate":
      return validateKnowledgeCandidate(record);
    case "externalReference":
      return validateExternalReference(record);
    case "skillLock":
      return validateSkillLock(record);
    case "managedFile":
      return validateManagedFile(record);
  }
}

function validateKnowledgeCandidate(
  record: UnknownRecord,
): ContractRecordValidationFailure | null {
  const identifierFields = ["id", "taskId", "createdBy"] as const;
  for (const field of identifierFields) {
    if (!isIdentifier(record[field])) {
      return invalidKnowledge(`$.record.${field}`, `${field} must be a non-empty identifier.`);
    }
  }
  const textFields = ["type", "statement", "proposedAction"] as const;
  for (const field of textFields) {
    if (!isNonEmptyString(record[field])) {
      return invalidKnowledge(`$.record.${field}`, `${field} must be a non-empty string.`);
    }
  }
  if (!isUniqueStringArray(record.scope, true)) {
    return invalidKnowledge("$.record.scope", "scope must contain unique non-empty entries.");
  }
  if (!isUniqueStringArray(record.evidence, true)) {
    return invalidKnowledge(
      "$.record.evidence",
      "evidence must contain at least one unique provenance reference.",
    );
  }
  if (!isKnowledgeConfidence(record.confidence)) {
    return invalidKnowledge(
      "$.record.confidence",
      "confidence must be low, medium, or high.",
    );
  }
  if (!isRepositoryRelativePath(record.target)) {
    return invalidKnowledge(
      "$.record.target",
      "target must be a repository-relative promotion path.",
    );
  }
  if (!isKnowledgeStatus(record.status)) {
    return invalidKnowledge(
      "$.record.status",
      "status must be pending, accepted, rejected, or superseded.",
    );
  }
  return null;
}

function validateExternalReference(
  record: UnknownRecord,
): ContractRecordValidationFailure | null {
  if (!isIdentifier(record.id)) {
    return invalidExternalReference("$.record.id", "id must be a non-empty identifier.");
  }
  const textFields = [
    "kind",
    "adapter",
    "externalId",
    "observedVersion",
    "role",
  ] as const;
  for (const field of textFields) {
    if (!isNonEmptyString(record[field])) {
      return invalidExternalReference(
        `$.record.${field}`,
        `${field} must be a non-empty string.`,
      );
    }
  }
  if (!isCredentialFreeUri(record.uri)) {
    return invalidExternalReference(
      "$.record.uri",
      "uri must be an absolute URI without embedded credentials.",
    );
  }
  if (!isTimestamp(record.lastObservedAt)) {
    return invalidExternalReference(
      "$.record.lastObservedAt",
      "lastObservedAt must be a valid UTC timestamp.",
    );
  }
  if (
    record.identity !== null &&
    !isContractIdentity(record.identity) &&
    !isContentHash(record.identity)
  ) {
    return invalidExternalReference(
      "$.record.identity",
      "identity must be null or a valid content identity.",
    );
  }
  return null;
}

function validateSkillLock(
  record: UnknownRecord,
): ContractRecordValidationFailure | null {
  if (!isRecord(record.registry)) {
    return invalidSkillLock("$.record.registry", "registry must be an object.");
  }
  if (!isNonEmptyString(record.registry.repository)) {
    return invalidSkillLock(
      "$.record.registry.repository",
      "registry repository must be a non-empty string.",
    );
  }
  if (!isFullGitCommit(record.registry.commit)) {
    return invalidSkillLock(
      "$.record.registry.commit",
      "registry commit must be an immutable full commit identity.",
    );
  }
  if (!Array.isArray(record.skills) || record.skills.length === 0) {
    return invalidSkillLock(
      "$.record.skills",
      "skills must contain at least one locked Skill.",
    );
  }

  const names = new Set<string>();
  const paths = new Set<string>();
  for (let index = 0; index < record.skills.length; index += 1) {
    const skill = record.skills[index];
    const skillFailure = validateLockedSkill(skill, index);
    if (skillFailure !== null) {
      return skillFailure;
    }
    const lockedSkill = skill as unknown as LockedSkill;
    if (names.has(lockedSkill.name) || paths.has(lockedSkill.path)) {
      return failure(
        "record_contract.skill.duplicate",
        `$.record.skills[${index}]`,
        "Skill Lock contains a duplicate Skill name or path.",
        "Keep exactly one immutable identity for each selected Skill.",
      );
    }
    names.add(lockedSkill.name);
    paths.add(lockedSkill.path);
  }
  return null;
}

function validateLockedSkill(
  value: unknown,
  index: number,
): ContractRecordValidationFailure | null {
  const path = `$.record.skills[${index}]`;
  if (!isRecord(value)) {
    return invalidSkillLock(path, "Each locked Skill must be an object.");
  }
  if (!isNonEmptyString(value.name)) {
    return invalidSkillLock(`${path}.name`, "Skill name must be a non-empty string.");
  }
  if (!isRepositoryRelativePath(value.path)) {
    return invalidSkillLock(`${path}.path`, "Skill path must be repository-relative.");
  }
  if (!Array.isArray(value.files) || value.files.length === 0) {
    return invalidSkillLock(`${path}.files`, "Skill files must contain at least one file hash.");
  }

  const filePaths = new Set<string>();
  for (let fileIndex = 0; fileIndex < value.files.length; fileIndex += 1) {
    const file = value.files[fileIndex];
    const filePath = `${path}.files[${fileIndex}]`;
    if (!isRecord(file) || !isRepositoryRelativePath(file.path)) {
      return invalidSkillLock(`${filePath}.path`, "Locked file path must be repository-relative.");
    }
    if (!isContentHash(file.sha256)) {
      return invalidSkillLock(
        `${filePath}.sha256`,
        "Locked file sha256 must be an algorithm-specific content identity.",
      );
    }
    if (filePaths.has(file.path)) {
      return invalidSkillLock(`${filePath}.path`, "Locked file path must be unique within a Skill.");
    }
    filePaths.add(file.path);
  }

  if (!isRecord(value.upstream)) {
    return invalidSkillLock(`${path}.upstream`, "Skill upstream identity must be an object.");
  }
  const upstreamTextFields = ["repository", "license"] as const;
  for (const field of upstreamTextFields) {
    if (!isNonEmptyString(value.upstream[field])) {
      return invalidSkillLock(
        `${path}.upstream.${field}`,
        `Skill upstream ${field} must be a non-empty string.`,
      );
    }
  }
  if (!isFullGitCommit(value.upstream.commit)) {
    return invalidSkillLock(
      `${path}.upstream.commit`,
      "Skill upstream commit must be an immutable full commit identity.",
    );
  }
  if (!isRepositoryRelativePath(value.upstream.path)) {
    return invalidSkillLock(
      `${path}.upstream.path`,
      "Skill upstream path must be repository-relative.",
    );
  }
  if (!isContractIdentity(value.sidecarIdentity)) {
    return invalidSkillLock(
      `${path}.sidecarIdentity`,
      "Skill sidecar identity must be a SHA-256 identity.",
    );
  }
  return null;
}

function validateManagedFile(
  record: UnknownRecord,
): ContractRecordValidationFailure | null {
  if (!isRepositoryRelativePath(record.path)) {
    return invalidManagedFile("$.record.path", "path must be repository-relative.");
  }
  if (!isOwnershipClass(record.ownershipClass)) {
    return failure(
      "record_contract.ownership.invalid",
      "$.record.ownershipClass",
      "Managed file ownershipClass is invalid.",
      "Use engine-owned, user-owned, or managed-customizable.",
    );
  }
  if (!isNonEmptyString(record.generatedSourceVersion)) {
    return invalidManagedFile(
      "$.record.generatedSourceVersion",
      "generatedSourceVersion must identify the generating source or template.",
    );
  }
  if (!isUniqueStringArray(record.markerIds, false)) {
    return invalidManagedFile(
      "$.record.markerIds",
      "markerIds must contain unique non-empty marker identifiers.",
    );
  }
  if (
    Object.hasOwn(record, "incomingUpdateIdentity") &&
    !isContentHash(record.incomingUpdateIdentity)
  ) {
    return invalidManagedFile(
      "$.record.incomingUpdateIdentity",
      "incomingUpdateIdentity must be an algorithm-specific content identity.",
    );
  }
  if (
    Object.hasOwn(record, "localOverrideSource") &&
    !isRepositoryRelativePath(record.localOverrideSource)
  ) {
    return invalidManagedFile(
      "$.record.localOverrideSource",
      "localOverrideSource must be repository-relative.",
    );
  }

  if (record.ownershipClass === "user-owned") {
    if (Object.hasOwn(record, "installedBaseIdentity")) {
      return failure(
        "record_contract.ownership.invalid",
        "$.record.installedBaseIdentity",
        "User-owned files cannot declare a replacement base identity.",
        "Remove installedBaseIdentity so updates preserve the user-owned file.",
      );
    }
    return null;
  }
  if (!isContentHash(record.installedBaseIdentity)) {
    return failure(
      "record_contract.identity.invalid",
      "$.record.installedBaseIdentity",
      "This ownership class requires an exact installed base content identity.",
      "Record the installed content with its SHA-256 algorithm and digest.",
    );
  }
  if (
    record.ownershipClass === "managed-customizable" &&
    record.markerIds.length === 0 &&
    !Object.hasOwn(record, "localOverrideSource")
  ) {
    return failure(
      "record_contract.ownership.invalid",
      "$.record",
      "Managed-customizable files require marker IDs or a local override source.",
      "Declare constrained managed markers or the repository-relative override source.",
    );
  }
  return null;
}

function validateBaseline(
  record: UnknownRecord,
): ContractRecordValidationFailure | null {
  if (!isTimestamp(record.capturedAt)) {
    return invalidMilestoneRecord(
      "record_contract.baseline.invalid",
      "Baseline",
      "$.record.capturedAt",
      "capturedAt must be a valid UTC timestamp.",
    );
  }
  if (!isIdentifier(record.repositoryRootIdentity)) {
    return invalidMilestoneRecord(
      "record_contract.baseline.invalid",
      "Baseline",
      "$.record.repositoryRootIdentity",
      "repositoryRootIdentity must be a non-empty identifier.",
    );
  }
  if (record.head !== null && !isFullGitCommit(record.head)) {
    return invalidMilestoneRecord(
      "record_contract.baseline.invalid",
      "Baseline",
      "$.record.head",
      "head must be null or an immutable full Git object identity.",
    );
  }
  for (const field of [
    "indexDigest",
    "trackedWorktreeDigest",
    "submodulesDigest",
  ] as const) {
    if (!isContractIdentity(record[field])) {
      return invalidMilestoneRecord(
        "record_contract.baseline.invalid",
        "Baseline",
        `$.record.${field}`,
        `${field} must be a SHA-256 contract identity.`,
      );
    }
  }
  if (!Array.isArray(record.untracked)) {
    return invalidMilestoneRecord(
      "record_contract.baseline.invalid",
      "Baseline",
      "$.record.untracked",
      "untracked must be an array.",
    );
  }
  const untrackedPaths = new Set<string>();
  for (let index = 0; index < record.untracked.length; index += 1) {
    const entry = record.untracked[index];
    if (!isRecord(entry) || !isRepositoryRelativePath(entry.path)) {
      return invalidMilestoneRecord(
        "record_contract.baseline.invalid",
        "Baseline",
        `$.record.untracked[${index}].path`,
        "untracked paths must be repository-relative.",
      );
    }
    if (untrackedPaths.has(entry.path)) {
      return invalidMilestoneRecord(
        "record_contract.baseline.invalid",
        "Baseline",
        `$.record.untracked[${index}].path`,
        "untracked paths must be unique.",
      );
    }
    if (!isContentHash(entry.identity)) {
      return invalidMilestoneRecord(
        "record_contract.baseline.invalid",
        "Baseline",
        `$.record.untracked[${index}].identity`,
        "untracked content must have an algorithm-specific identity.",
      );
    }
    untrackedPaths.add(entry.path);
  }
  if (!isUniqueRepositoryPathArray(record.adoptedPaths)) {
    return invalidMilestoneRecord(
      "record_contract.baseline.invalid",
      "Baseline",
      "$.record.adoptedPaths",
      "adoptedPaths must contain unique repository-relative paths.",
    );
  }
  if (!isTaskScope(record.declaredScope)) {
    return invalidMilestoneRecord(
      "record_contract.baseline.invalid",
      "Baseline",
      "$.record.declaredScope",
      "declaredScope must contain valid file, API, schema, and lock resources.",
    );
  }
  return null;
}

function validateLease(record: UnknownRecord): ContractRecordValidationFailure | null {
  for (const field of ["leaseId", "projectId", "taskId"] as const) {
    if (!isIdentifier(record[field])) {
      return invalidMilestoneRecord(
        "record_contract.lease.invalid",
        "Lease",
        `$.record.${field}`,
        `${field} must be a non-empty identifier.`,
      );
    }
  }
  if (!isLeaseKind(record.kind)) {
    return invalidMilestoneRecord(
      "record_contract.lease.invalid",
      "Lease",
      "$.record.kind",
      "kind must be reader, writer, or validation.",
    );
  }
  if (!isRecord(record.owner)) {
    return invalidMilestoneRecord(
      "record_contract.lease.invalid",
      "Lease",
      "$.record.owner",
      "owner must be an object.",
    );
  }
  for (const field of ["sessionId", "hostId", "installId"] as const) {
    if (!isIdentifier(record.owner[field])) {
      return invalidMilestoneRecord(
        "record_contract.lease.invalid",
        "Lease",
        `$.record.owner.${field}`,
        `${field} must be a non-empty identifier.`,
      );
    }
  }
  if (
    typeof record.owner.processId !== "number" ||
    !Number.isSafeInteger(record.owner.processId) ||
    record.owner.processId <= 0
  ) {
    return invalidMilestoneRecord(
      "record_contract.lease.invalid",
      "Lease",
      "$.record.owner.processId",
      "processId must be a positive safe integer.",
    );
  }
  if (!isContractIdentity(record.baseFingerprint)) {
    return invalidMilestoneRecord(
      "record_contract.lease.invalid",
      "Lease",
      "$.record.baseFingerprint",
      "baseFingerprint must be a SHA-256 contract identity.",
    );
  }
  if (
    !areOrderedTimestamps(record.acquiredAt, record.heartbeatAt, record.expiresAt)
  ) {
    return invalidMilestoneRecord(
      "record_contract.lease.invalid",
      "Lease",
      "$.record.expiresAt",
      "lease timestamps must be valid UTC values ordered acquired, heartbeat, expiry.",
    );
  }
  return null;
}

function validateAgentResult(
  record: UnknownRecord,
): ContractRecordValidationFailure | null {
  for (const field of ["dispatchId", "taskId"] as const) {
    if (!isIdentifier(record[field])) {
      return invalidMilestoneRecord(
        "record_contract.agent_result.invalid",
        "Agent result",
        `$.record.${field}`,
        `${field} must be a non-empty identifier.`,
      );
    }
  }
  if (
    typeof record.expectedTaskVersion !== "number" ||
    !Number.isSafeInteger(record.expectedTaskVersion) ||
    record.expectedTaskVersion < 1
  ) {
    return invalidMilestoneRecord(
      "record_contract.agent_result.invalid",
      "Agent result",
      "$.record.expectedTaskVersion",
      "expectedTaskVersion must be a positive safe integer.",
    );
  }
  if (!isWorkflowPhase(record.phase)) {
    return invalidMilestoneRecord(
      "record_contract.agent_result.invalid",
      "Agent result",
      "$.record.phase",
      "phase must be a supported workflow Phase.",
    );
  }
  if (!isPhaseAgentRole(record.agentRole)) {
    return invalidMilestoneRecord(
      "record_contract.agent_result.invalid",
      "Agent result",
      "$.record.agentRole",
      "agentRole must be a supported Phase Agent role.",
    );
  }
  for (const field of [
    "contextManifestIdentity",
    "agentContractIdentity",
    "observedFinalFingerprint",
  ] as const) {
    if (!isContractIdentity(record[field])) {
      return invalidMilestoneRecord(
        "record_contract.agent_result.invalid",
        "Agent result",
        `$.record.${field}`,
        `${field} must be a SHA-256 contract identity.`,
      );
    }
  }
  if (!isAgentResultOutcome(record.outcome)) {
    return invalidMilestoneRecord(
      "record_contract.agent_result.invalid",
      "Agent result",
      "$.record.outcome",
      "outcome must be succeeded, failed, or blocked.",
    );
  }
  for (const field of ["artifacts", "evidence", "findings"] as const) {
    if (!isUniqueStringArray(record[field], false)) {
      return invalidMilestoneRecord(
        "record_contract.agent_result.invalid",
        "Agent result",
        `$.record.${field}`,
        `${field} must contain unique non-empty references.`,
      );
    }
  }
  return null;
}

function validateEvidence(
  record: UnknownRecord,
): ContractRecordValidationFailure | null {
  for (const field of ["id", "taskId"] as const) {
    if (!isIdentifier(record[field])) {
      return invalidMilestoneRecord(
        "record_contract.evidence.invalid",
        "Evidence",
        `$.record.${field}`,
        `${field} must be a non-empty identifier.`,
      );
    }
  }
  for (const field of ["kind", "producer"] as const) {
    if (!isNonEmptyString(record[field])) {
      return invalidMilestoneRecord(
        "record_contract.evidence.invalid",
        "Evidence",
        `$.record.${field}`,
        `${field} must be a non-empty string.`,
      );
    }
  }
  if (!isContractIdentity(record.baseFingerprint)) {
    return invalidMilestoneRecord(
      "record_contract.evidence.invalid",
      "Evidence",
      "$.record.baseFingerprint",
      "baseFingerprint must be a SHA-256 contract identity.",
    );
  }
  if (!isRecord(record.command)) {
    return invalidMilestoneRecord(
      "record_contract.evidence.invalid",
      "Evidence",
      "$.record.command",
      "command must be an object.",
    );
  }
  if (!isStringArray(record.command.argv, true)) {
    return invalidMilestoneRecord(
      "record_contract.evidence.invalid",
      "Evidence",
      "$.record.command.argv",
      "command argv must contain at least one non-empty argument.",
    );
  }
  if (!isRepositoryRelativePath(record.command.cwd)) {
    return invalidMilestoneRecord(
      "record_contract.evidence.invalid",
      "Evidence",
      "$.record.command.cwd",
      "command cwd must be repository-relative.",
    );
  }
  if (
    typeof record.command.exitCode !== "number" ||
    !Number.isSafeInteger(record.command.exitCode) ||
    record.command.exitCode < 0
  ) {
    return invalidMilestoneRecord(
      "record_contract.evidence.invalid",
      "Evidence",
      "$.record.command.exitCode",
      "command exitCode must be a non-negative safe integer.",
    );
  }
  if (!isUniqueStringArray(record.artifacts, false)) {
    return invalidMilestoneRecord(
      "record_contract.evidence.invalid",
      "Evidence",
      "$.record.artifacts",
      "artifacts must contain unique non-empty references.",
    );
  }
  if (!isEvidenceResult(record.result)) {
    return invalidMilestoneRecord(
      "record_contract.evidence.invalid",
      "Evidence",
      "$.record.result",
      "result must be not-run, passed, failed, or inconclusive.",
    );
  }
  if (!areOrderedTimestamps(record.startedAt, record.completedAt)) {
    return invalidMilestoneRecord(
      "record_contract.evidence.invalid",
      "Evidence",
      "$.record.completedAt",
      "Evidence timestamps must be valid UTC values ordered start then completion.",
    );
  }
  return null;
}

function validateProjectManifest(
  record: UnknownRecord,
): ContractRecordValidationFailure | null {
  if (!isIdentifier(record.projectId)) {
    return invalidMilestoneRecord(
      "record_contract.project_manifest.invalid",
      "Project manifest",
      "$.record.projectId",
      "projectId must be a non-empty identifier.",
    );
  }
  if (!isRecord(record.installed)) {
    return invalidMilestoneRecord(
      "record_contract.project_manifest.invalid",
      "Project manifest",
      "$.record.installed",
      "installed must be an object.",
    );
  }
  for (const field of ["core", "cli", "ompPlugin", "templates"] as const) {
    if (!isNonEmptyString(record.installed[field])) {
      return invalidMilestoneRecord(
        "record_contract.project_manifest.invalid",
        "Project manifest",
        `$.record.installed.${field}`,
        `${field} must be a non-empty installed version.`,
      );
    }
  }
  if (
    typeof record.installed.projectSchema !== "number" ||
    !Number.isSafeInteger(record.installed.projectSchema) ||
    record.installed.projectSchema < 1
  ) {
    return invalidMilestoneRecord(
      "record_contract.project_manifest.invalid",
      "Project manifest",
      "$.record.installed.projectSchema",
      "projectSchema must be a positive safe integer.",
    );
  }
  if (!isContractIdentity(record.installed.skillLockDigest)) {
    return invalidMilestoneRecord(
      "record_contract.project_manifest.invalid",
      "Project manifest",
      "$.record.installed.skillLockDigest",
      "skillLockDigest must be a SHA-256 contract identity.",
    );
  }
  if (!areOrderedTimestamps(record.initializedAt, record.updatedAt)) {
    return invalidMilestoneRecord(
      "record_contract.project_manifest.invalid",
      "Project manifest",
      "$.record.updatedAt",
      "manifest timestamps must be valid UTC values ordered initialization then update.",
    );
  }
  if (!isRepositoryRelativePath(record.ownershipManifest)) {
    return invalidMilestoneRecord(
      "record_contract.project_manifest.invalid",
      "Project manifest",
      "$.record.ownershipManifest",
      "ownershipManifest must be a repository-relative path.",
    );
  }
  return null;
}

function invalidMilestoneRecord(
  code:
    | "record_contract.baseline.invalid"
    | "record_contract.lease.invalid"
    | "record_contract.agent_result.invalid"
    | "record_contract.evidence.invalid"
    | "record_contract.project_manifest.invalid",
  label: string,
  path: string,
  message: string,
): ContractRecordValidationFailure {
  return failure(
    code,
    path,
    `${label} ${message}`,
    `Provide a schema-valid ${label} record.`,
  );
}

function invalidKnowledge(
  path: string,
  message: string,
): ContractRecordValidationFailure {
  return failure(
    "record_contract.knowledge.invalid",
    path,
    `Knowledge Candidate ${message}`,
    "Provide a schema-valid, provenance-bearing Knowledge Candidate.",
  );
}

function invalidExternalReference(
  path: string,
  message: string,
): ContractRecordValidationFailure {
  return failure(
    "record_contract.external_reference.invalid",
    path,
    `External Reference ${message}`,
    "Provide a typed, version-aware reference without credentials.",
  );
}

function invalidSkillLock(
  path: string,
  message: string,
): ContractRecordValidationFailure {
  return failure(
    "record_contract.skill_lock.invalid",
    path,
    `Skill Lock ${message}`,
    "Provide immutable registry, upstream, file, and sidecar identities.",
  );
}

function invalidManagedFile(
  path: string,
  message: string,
): ContractRecordValidationFailure {
  return failure(
    "record_contract.managed_file.invalid",
    path,
    `Managed file ${message}`,
    "Provide a schema-valid ownership manifest record.",
  );
}

function failure(
  code: ContractRecordDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): ContractRecordValidationFailure {
  return Object.freeze({
    ok: false,
    contractVersion: RECORD_CONTRACT_VERSION,
    diagnostics: Object.freeze([
      Object.freeze({ code, path, message, remediation }),
    ]),
  });
}

function isContractRecordKind(value: unknown): value is ContractRecordKind {
  return (
    value === "baseline" ||
    value === "lease" ||
    value === "agentResult" ||
    value === "evidence" ||
    value === "projectManifest" ||
    value === "knowledgeCandidate" ||
    value === "externalReference" ||
    value === "skillLock" ||
    value === "managedFile"
  );
}

function isKnowledgeStatus(value: unknown): value is KnowledgeCandidateStatus {
  return (
    value === "pending" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "superseded"
  );
}

function isKnowledgeConfidence(value: unknown): value is KnowledgeConfidence {
  return value === "low" || value === "medium" || value === "high";
}

function isOwnershipClass(value: unknown): value is ManagedFileOwnershipClass {
  return (
    value === "engine-owned" ||
    value === "user-owned" ||
    value === "managed-customizable"
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFullGitCommit(value: unknown): value is string {
  return typeof value === "string" && FULL_GIT_COMMIT_PATTERN.test(value);
}

function isUniqueStringArray(
  value: unknown,
  requireItem: boolean,
): value is readonly string[] {
  if (!Array.isArray(value) || (requireItem && value.length === 0)) {
    return false;
  }
  const values = new Set<string>();
  for (const item of value) {
    if (!isNonEmptyString(item) || values.has(item)) {
      return false;
    }
    values.add(item);
  }
  return true;
}

function isTimestamp(value: unknown): value is string {
  return validateDomainValue({
    contractVersion: 1,
    kind: "timestamp",
    value,
  }).ok;
}

function isContentHash(value: unknown): value is ContentHash {
  return validateDomainValue({
    contractVersion: 1,
    kind: "contentHash",
    value,
  }).ok;
}

function isLeaseKind(value: unknown): value is LeaseKind {
  return value === "reader" || value === "writer" || value === "validation";
}

function isAgentResultOutcome(value: unknown): value is AgentResultOutcome {
  return value === "succeeded" || value === "failed" || value === "blocked";
}

function isEvidenceResult(value: unknown): value is EvidenceResult {
  return (
    value === "not-run" ||
    value === "passed" ||
    value === "failed" ||
    value === "inconclusive"
  );
}

function isPhaseAgentRole(value: unknown): value is PhaseAgentRole {
  return (
    value === "research" ||
    value === "planning" ||
    value === "architecture" ||
    value === "implementation" ||
    value === "standards-review" ||
    value === "spec-review" ||
    value === "integration" ||
    value === "knowledge"
  );
}

function isTaskScope(value: unknown): value is TaskScope {
  return (
    isRecord(value) &&
    isUniqueRepositoryPathArray(value.files) &&
    isUniqueStringArray(value.apis, false) &&
    isUniqueStringArray(value.schemas, false) &&
    isUniqueRepositoryPathArray(value.locks)
  );
}

function isUniqueRepositoryPathArray(value: unknown): value is readonly string[] {
  return (
    isUniqueStringArray(value, false) &&
    value.every((path) => isRepositoryRelativePath(path))
  );
}

function isStringArray(value: unknown, requireItem: boolean): value is readonly string[] {
  return (
    Array.isArray(value) &&
    (!requireItem || value.length > 0) &&
    value.every((item) => isNonEmptyString(item))
  );
}

interface ComparableUtcTimestamp {
  readonly wholeSeconds: string;
  readonly fractionalSeconds: string;
}

function areOrderedTimestamps(...values: readonly unknown[]): boolean {
  let previous: ComparableUtcTimestamp | undefined;
  for (const value of values) {
    if (!isTimestamp(value)) {
      return false;
    }
    const current = comparableUtcTimestamp(value);
    if (previous !== undefined && compareUtcTimestamps(current, previous) < 0) {
      return false;
    }
    previous = current;
  }
  return true;
}

function comparableUtcTimestamp(value: string): ComparableUtcTimestamp {
  const utc = value.toUpperCase().replace(/\+00:00$/u, "Z").slice(0, -1);
  const separator = utc.indexOf(".");
  return separator === -1
    ? { wholeSeconds: utc, fractionalSeconds: "" }
    : {
        wholeSeconds: utc.slice(0, separator),
        fractionalSeconds: utc.slice(separator + 1),
      };
}

function compareUtcTimestamps(
  left: ComparableUtcTimestamp,
  right: ComparableUtcTimestamp,
): number {
  if (left.wholeSeconds !== right.wholeSeconds) {
    return left.wholeSeconds < right.wholeSeconds ? -1 : 1;
  }
  const precision = Math.max(
    left.fractionalSeconds.length,
    right.fractionalSeconds.length,
  );
  const leftFraction = left.fractionalSeconds.padEnd(precision, "0");
  const rightFraction = right.fractionalSeconds.padEnd(precision, "0");
  return leftFraction === rightFraction ? 0 : leftFraction < rightFraction ? -1 : 1;
}


function isCredentialFreeUri(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }
  try {
    const uri = new URL(value);
    return uri.username.length === 0 && uri.password.length === 0;
  } catch {
    return false;
  }
}


function copyJsonData(
  value: unknown,
  seen: WeakSet<object>,
): JsonData | typeof INVALID_JSON {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0) ? value : INVALID_JSON;
  }
  if (typeof value !== "object" || seen.has(value)) {
    return INVALID_JSON;
  }
  seen.add(value);
  return Array.isArray(value)
    ? copyJsonArray(value, seen)
    : copyJsonObject(value, seen);
}

function copyJsonArray(
  value: readonly unknown[],
  seen: WeakSet<object>,
): readonly JsonData[] | typeof INVALID_JSON {
  if (
    Object.getOwnPropertySymbols(value).length > 0 ||
    Object.keys(value).length !== value.length
  ) {
    return INVALID_JSON;
  }
  const copy: JsonData[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      return INVALID_JSON;
    }
    const item = copyJsonData(descriptor.value, seen);
    if (item === INVALID_JSON) {
      return INVALID_JSON;
    }
    copy.push(item);
  }
  return Object.freeze(copy);
}

function copyJsonObject(
  value: object,
  seen: WeakSet<object>,
): Readonly<Record<string, JsonData>> | typeof INVALID_JSON {
  const prototype = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return INVALID_JSON;
  }
  const copy = Object.create(prototype) as Record<string, JsonData>;
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      return INVALID_JSON;
    }
    const item = copyJsonData(descriptor.value, seen);
    if (item === INVALID_JSON) {
      return INVALID_JSON;
    }
    Object.defineProperty(copy, key, {
      value: item,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(copy);
}
