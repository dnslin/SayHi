import {
  hashCanonicalJson,
  isContractIdentity,
  type ContractIdentity,
} from "./identity.js";

import { isRepositoryRelativePath } from "./repository-path.js";
import {
  DURABLE_RECORD_SCHEMA_VERSION,
  isIdentifier,
  validateDomainValue,
  type ContentHash,
} from "./validation.js";

export const RECORD_CONTRACT_VERSION = 1 as const;

export type ContractRecordKind =
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

export type ContractRecord =
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
      "Use knowledgeCandidate, externalReference, skillLock, or managedFile.",
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
