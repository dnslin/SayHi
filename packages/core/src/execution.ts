import { createHash } from "node:crypto";
import {
  hashCanonicalJson,
  isContractIdentity,
  type ContractIdentity,
} from "./identity.js";

import {
  DOMAIN_VALIDATION_CONTRACT_VERSION,
  isNonEmptyString,
  isTimestamp,
  validateDomainValue,
  type ContentHash,
  type ContentHashAlgorithm,
} from "./validation.js";
import {
  isIdentifier,
  isUnknownRecord,
  isRepositoryRelativePath,
  isWorkflowPhase,
  type WorkflowPhase,
} from "./workflow.js";

export const PHASE_EXECUTION_CONTRACT_VERSION = 1 as const;

export type ContextTrustTier =
  | "engine-instruction"
  | "approved-spec"
  | "task-context"
  | "untrusted-reference";
export type ContextInjectionMode = "full" | "summary" | "pointer";
export type ContextInstructionPolicy = "scoped-instruction" | "data-only";
export type PhaseAgentRole =
  | "research"
  | "planning"
  | "architecture"
  | "implementation"
  | "standards-review"
  | "spec-review"
  | "integration"
  | "knowledge";
export type AgentNetworkAccess = "none" | "configured";
export type AgentRepositoryAccess =
  | "read-only"
  | "exclusive-write"
  | "read-only-plus-exclusive-validation";

const phaseByAgentRole: Readonly<Record<PhaseAgentRole, WorkflowPhase>> =
  Object.freeze({
    research: "explore",
    planning: "plan",
    architecture: "plan",
    implementation: "implement",
    "standards-review": "review",
    "spec-review": "review",
    integration: "integrate",
    knowledge: "finish",
  });

export interface ContextSource {
  readonly type: string;
  readonly value: string;
}

export interface ContextManifestEntry {
  readonly schemaVersion: typeof PHASE_EXECUTION_CONTRACT_VERSION;
  readonly id: string;
  readonly source: ContextSource;
  readonly kind: string;
  readonly reason: string;
  readonly required: boolean;
  readonly mode: ContextInjectionMode;
  readonly trust: ContextTrustTier;
  readonly instructionPolicy: ContextInstructionPolicy;
  readonly scope: readonly string[];
  readonly identity: ContentHash;
  readonly addedBy: string;
  readonly acceptedByEvent?: string;
}

export interface CurrentContextContent {
  readonly source: ContextSource;
  readonly content: string | Uint8Array;
}

export interface PhaseAgentContract {
  readonly schemaVersion: typeof PHASE_EXECUTION_CONTRACT_VERSION;
  readonly role: PhaseAgentRole;
  readonly runtimeName: string;
  readonly contractVersion: number;
  readonly tools: readonly string[];
  readonly network: AgentNetworkAccess;
  readonly skills: readonly string[];
  readonly spawns: readonly string[];
  readonly repositoryAccess: AgentRepositoryAccess;
  readonly outputSchema: string;
  readonly promptBaseIdentity: ContractIdentity;
  readonly overridePolicy: "prompt-body-only";
}

export interface PhaseExecutionDispatch {
  readonly schemaVersion: typeof PHASE_EXECUTION_CONTRACT_VERSION;
  readonly dispatchId: string;
  readonly taskId: string;
  readonly expectedTaskVersion: number;
  readonly phase: WorkflowPhase;
  readonly agentRole: PhaseAgentRole;
  readonly baseFingerprint: ContractIdentity;
  readonly requestedAt: string;
  readonly contextManifestIdentity: ContractIdentity;
  readonly agentContractIdentity: ContractIdentity;
}

export interface SkillMaterial {
  readonly name: string;
  readonly identity: ContentHash;
  readonly content: string | Uint8Array;
}

export interface PhaseExecutionMaterials {
  readonly manifest: readonly ContextManifestEntry[];
  readonly currentContext: readonly CurrentContextContent[];
  readonly agentContract: PhaseAgentContract;
  readonly skills: readonly SkillMaterial[];
}

export interface BindPhaseExecutionRequest extends PhaseExecutionMaterials {
  readonly contractVersion: typeof PHASE_EXECUTION_CONTRACT_VERSION;
  readonly dispatch: PhaseExecutionDispatch;
}

export interface BoundSkillIdentity {
  readonly name: string;
  readonly identity: ContentHash;
}

export interface PhaseExecutionBinding {
  readonly schemaVersion: typeof PHASE_EXECUTION_CONTRACT_VERSION;
  readonly dispatchId: string;
  readonly taskId: string;
  readonly expectedTaskVersion: number;
  readonly phase: WorkflowPhase;
  readonly agentRole: PhaseAgentRole;
  readonly baseFingerprint: ContractIdentity;
  readonly requestedAt: string;
  readonly contextManifestIdentity: ContractIdentity;
  readonly agentContractIdentity: ContractIdentity;
  readonly skillIdentities: readonly BoundSkillIdentity[];
}

export type RepositoryOperation = "read" | "write" | "validate";
export type PhaseCapability =
  | Readonly<{ kind: "tool"; name: string }>
  | Readonly<{ kind: "network" }>
  | Readonly<{ kind: "spawn"; name: string }>
  | Readonly<{ kind: "repository"; access: RepositoryOperation }>
  | Readonly<{ kind: "skill"; name: string }>;

export interface AuthorizePhaseExecutionRequest extends PhaseExecutionMaterials {
  readonly contractVersion: typeof PHASE_EXECUTION_CONTRACT_VERSION;
  readonly binding: PhaseExecutionBinding;
  readonly capability: PhaseCapability;
}

export interface PhaseExecutionAuthorization {
  readonly schemaVersion: typeof PHASE_EXECUTION_CONTRACT_VERSION;
  readonly dispatchId: string;
  readonly taskId: string;
  readonly phase: WorkflowPhase;
  readonly agentRole: PhaseAgentRole;
  readonly capability: PhaseCapability;
}

export type PhaseExecutionDiagnosticCode =
  | "execution.request_invalid"
  | "execution.context_invalid"
  | "execution.context_stale"
  | "execution.agent_invalid"
  | "execution.skill_invalid"
  | "execution.capability_denied";

export interface PhaseExecutionDiagnostic {
  readonly code: PhaseExecutionDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

export interface PhaseExecutionFailure {
  readonly ok: false;
  readonly contractVersion: typeof PHASE_EXECUTION_CONTRACT_VERSION;
  readonly diagnostics: readonly PhaseExecutionDiagnostic[];
}

export type BindPhaseExecutionResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof PHASE_EXECUTION_CONTRACT_VERSION;
      binding: PhaseExecutionBinding;
    }>
  | PhaseExecutionFailure;

export type AuthorizePhaseExecutionResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof PHASE_EXECUTION_CONTRACT_VERSION;
      authorization: PhaseExecutionAuthorization;
    }>
  | PhaseExecutionFailure;

export function bindPhaseExecution(
  request: BindPhaseExecutionRequest,
): BindPhaseExecutionResult {
  try {
    if (!isUnknownRecord(request)) {
      return failure(
        "execution.request_invalid",
        "$",
        "Phase execution binding request must be a readable object.",
        "Provide contractVersion, dispatch, Manifest, current Context, Agent contract, and Skill materials.",
      );
    }
    return bindReadablePhaseExecution(request);
  } catch {
    return failure(
      "execution.request_invalid",
      "$",
      "Phase execution binding request could not be read safely.",
      "Provide plain contract data without accessors, cycles, or unreadable values.",
    );
  }
}

function bindReadablePhaseExecution(
  request: BindPhaseExecutionRequest,
): BindPhaseExecutionResult {
  if (request.contractVersion !== PHASE_EXECUTION_CONTRACT_VERSION) {
    return failure(
      "execution.request_invalid",
      "$.contractVersion",
      "Phase execution contract version is unsupported.",
      "Set contractVersion to 1 and retry.",
    );
  }

  const dispatchFailure = validateDispatch(request.dispatch);
  if (dispatchFailure !== null) {
    return dispatchFailure;
  }
  const contextFailure = validateContextBinding(request);
  if (contextFailure !== null) {
    return contextFailure;
  }
  const agentFailure = validateAgentBinding(request);
  if (agentFailure !== null) {
    return agentFailure;
  }
  const skillsResult = bindSkillIdentities(request);
  if (!skillsResult.ok) {
    return skillsResult;
  }

  const binding: PhaseExecutionBinding = Object.freeze({
    schemaVersion: PHASE_EXECUTION_CONTRACT_VERSION,
    dispatchId: request.dispatch.dispatchId,
    taskId: request.dispatch.taskId,
    expectedTaskVersion: request.dispatch.expectedTaskVersion,
    phase: request.dispatch.phase,
    agentRole: request.dispatch.agentRole,
    baseFingerprint: request.dispatch.baseFingerprint,
    requestedAt: request.dispatch.requestedAt,
    contextManifestIdentity: request.dispatch.contextManifestIdentity,
    agentContractIdentity: request.dispatch.agentContractIdentity,
    skillIdentities: skillsResult.skillIdentities,
  });
  return Object.freeze({
    ok: true,
    contractVersion: PHASE_EXECUTION_CONTRACT_VERSION,
    binding,
  });
}

export function authorizePhaseExecution(
  request: AuthorizePhaseExecutionRequest,
): AuthorizePhaseExecutionResult {
  try {
    if (!isUnknownRecord(request)) {
      return failure(
        "execution.request_invalid",
        "$",
        "Phase execution authorization request must be a readable object.",
        "Provide contractVersion, binding, current execution materials, and one capability.",
      );
    }
    if (!isUnknownRecord(request.binding)) {
      return failure(
        "execution.request_invalid",
        "$.binding",
        "Phase execution authorization binding must be a readable object.",
        "Use a binding returned by bindPhaseExecution.",
      );
    }
    if (!isUnknownRecord(request.capability)) {
      return failure(
        "execution.request_invalid",
        "$.capability",
        "Phase execution capability must be a readable object.",
        "Request a tool, network, spawn, repository, or Skill capability.",
      );
    }
    return authorizeReadablePhaseExecution(request);
  } catch {
    return failure(
      "execution.request_invalid",
      "$",
      "Phase execution authorization request could not be read safely.",
      "Provide plain contract data without accessors, cycles, or unreadable values.",
    );
  }
}

function authorizeReadablePhaseExecution(
  request: AuthorizePhaseExecutionRequest,
): AuthorizePhaseExecutionResult {
  const binding = request.binding;
  const rebound = bindPhaseExecution({
    contractVersion: request.contractVersion,
    dispatch: {
      schemaVersion: binding.schemaVersion,
      dispatchId: binding.dispatchId,
      taskId: binding.taskId,
      expectedTaskVersion: binding.expectedTaskVersion,
      phase: binding.phase,
      agentRole: binding.agentRole,
      baseFingerprint: binding.baseFingerprint,
      requestedAt: binding.requestedAt,
      contextManifestIdentity: binding.contextManifestIdentity,
      agentContractIdentity: binding.agentContractIdentity,
    },
    manifest: request.manifest,
    currentContext: request.currentContext,
    agentContract: request.agentContract,
    skills: request.skills,
  });
  if (!rebound.ok) {
    return rebound;
  }

  const skillIdentitiesMatch =
    rebound.binding.skillIdentities.length === binding.skillIdentities.length &&
    rebound.binding.skillIdentities.every((identity, index) => {
      const expectedIdentity = binding.skillIdentities[index];
      return (
        expectedIdentity !== undefined &&
        identity.name === expectedIdentity.name &&
        identity.identity.algorithm === expectedIdentity.identity.algorithm &&
        identity.identity.digest.toLowerCase() ===
          expectedIdentity.identity.digest.toLowerCase()
      );
    });
  if (!skillIdentitiesMatch) {
    return failure(
      "execution.skill_invalid",
      "$.binding.skillIdentities",
      "Effective Skill identities no longer match the Phase execution binding.",
      "Restore the bound Skill revisions before requesting a capability.",
    );
  }

  const capabilityDenial = validateCapability(
    request.capability,
    request.agentContract,
  );
  if (capabilityDenial !== null) {
    return capabilityDenial;
  }

  const authorization: PhaseExecutionAuthorization = Object.freeze({
    schemaVersion: PHASE_EXECUTION_CONTRACT_VERSION,
    dispatchId: binding.dispatchId,
    taskId: binding.taskId,
    phase: binding.phase,
    agentRole: binding.agentRole,
    capability: Object.freeze({ ...request.capability }),
  });
  return Object.freeze({
    ok: true,
    contractVersion: PHASE_EXECUTION_CONTRACT_VERSION,
    authorization,
  });
}

function validateDispatch(
  dispatch: PhaseExecutionDispatch,
): PhaseExecutionFailure | null {
  if (dispatch.schemaVersion !== PHASE_EXECUTION_CONTRACT_VERSION) {
    return failure(
      "execution.request_invalid",
      "$.dispatch.schemaVersion",
      "Phase execution dispatch schema version is unsupported.",
      "Regenerate the dispatch with schemaVersion 1.",
    );
  }
  if (!isIdentifier(dispatch.dispatchId) || !isIdentifier(dispatch.taskId)) {
    return failure(
      "execution.request_invalid",
      "$.dispatch",
      "Phase execution dispatch identifiers are invalid.",
      "Provide non-empty dispatchId and taskId identifiers.",
    );
  }
  if (
    !Number.isSafeInteger(dispatch.expectedTaskVersion) ||
    dispatch.expectedTaskVersion < 0
  ) {
    return failure(
      "execution.request_invalid",
      "$.dispatch.expectedTaskVersion",
      "Expected Task version must be a non-negative safe integer.",
      "Read the current Task Projection version and retry.",
    );
  }
  if (!isContractIdentity(dispatch.baseFingerprint)) {
    return failure(
      "execution.request_invalid",
      "$.dispatch.baseFingerprint",
      "Phase execution dispatch base fingerprint is invalid.",
      "Bind dispatch to the current repository fingerprint.",
    );
  }
  if (!isTimestamp(dispatch.requestedAt)) {
    return failure(
      "execution.request_invalid",
      "$.dispatch.requestedAt",
      "Phase execution dispatch request time is invalid.",
      "Record requestedAt as a valid UTC timestamp.",
    );
  }
  if (!isWorkflowPhase(dispatch.phase)) {
    return failure(
      "execution.request_invalid",
      "$.dispatch.phase",
      "Phase execution dispatch has an unsupported Phase.",
      "Use one of the seven workflow Phases.",
    );
  }
  if (!isPhaseAgentRole(dispatch.agentRole)) {
    return failure(
      "execution.agent_invalid",
      "$.dispatch.agentRole",
      "Phase execution dispatch has an unsupported Agent role.",
      "Use one of the eight versioned Phase Agent roles.",
    );
  }
  if (
    !isContractIdentity(dispatch.contextManifestIdentity) ||
    !isContractIdentity(dispatch.agentContractIdentity)
  ) {
    return failure(
      "execution.request_invalid",
      "$.dispatch",
      "Phase execution dispatch identities are invalid.",
      "Provide sha256 identities for the Manifest and Agent contract.",
    );
  }
  return null;
}

function validateContextBinding(
  request: BindPhaseExecutionRequest,
): PhaseExecutionFailure | null {
  if (hashCanonicalJson(request.manifest) !== request.dispatch.contextManifestIdentity) {
    return failure(
      "execution.context_invalid",
      "$.dispatch.contextManifestIdentity",
      "Context Manifest identity does not match its entries.",
      "Rebuild the phase Manifest and dispatch binding from the accepted entries.",
    );
  }

  const entryIds = new Set<string>();
  for (let index = 0; index < request.manifest.length; index += 1) {
    const entry = request.manifest[index];
    if (entry === undefined) {
      return failure(
        "execution.context_invalid",
        `$.manifest[${index}]`,
        "Context Manifest cannot contain an empty entry.",
        "Remove array gaps and provide a complete Context Entry.",
      );
    }
    const entryFailure = validateContextManifestEntry(entry, index, entryIds);
    if (entryFailure !== null) {
      return entryFailure;
    }
    const freshnessFailure = validateRequiredContextEntry(
      entry,
      index,
      request.currentContext,
    );
    if (freshnessFailure !== null) {
      return freshnessFailure;
    }
  }
  return null;
}

function validateContextManifestEntry(
  entry: ContextManifestEntry,
  index: number,
  entryIds: Set<string>,
): PhaseExecutionFailure | null {
  const path = `$.manifest[${index}]`;
  if (entry.schemaVersion !== PHASE_EXECUTION_CONTRACT_VERSION) {
    return failure(
      "execution.context_invalid",
      `${path}.schemaVersion`,
      "Context Manifest entry schema version is unsupported.",
      "Regenerate the Manifest with entry schemaVersion 1.",
    );
  }
  if (!isIdentifier(entry.id) || entryIds.has(entry.id)) {
    return failure(
      "execution.context_invalid",
      `${path}.id`,
      "Context Manifest entry ID is invalid or duplicated.",
      "Provide one unique non-empty ID per Context Entry.",
    );
  }
  entryIds.add(entry.id);
  if (
    !isUnknownRecord(entry.source) ||
    !isNonEmptyString(entry.source.type) ||
    !isNonEmptyString(entry.source.value)
  ) {
    return failure(
      "execution.context_invalid",
      `${path}.source`,
      "Context Manifest entry source is invalid.",
      "Provide a typed source with a non-empty value.",
    );
  }
  if (
    entry.source.type === "project-path" &&
    !isRepositoryRelativePath(entry.source.value)
  ) {
    return failure(
      "execution.context_invalid",
      `${path}.source.value`,
      "Project-path Context source must stay inside the repository.",
      "Use a normalized repository-relative path without dot segments.",
    );
  }
  if (!isNonEmptyString(entry.kind) || !isNonEmptyString(entry.reason)) {
    return failure(
      "execution.context_invalid",
      path,
      "Context Manifest entry kind and reason are required.",
      "Describe the Context Entry kind and why the Phase needs it.",
    );
  }
  if (typeof entry.required !== "boolean") {
    return failure(
      "execution.context_invalid",
      `${path}.required`,
      "Context Manifest entry required flag must be boolean.",
      "Set required to true or false.",
    );
  }
  if (entry.mode !== "full" && entry.mode !== "summary" && entry.mode !== "pointer") {
    return failure(
      "execution.context_invalid",
      `${path}.mode`,
      "Context Manifest entry has an unsupported injection mode.",
      "Use full, summary, or pointer.",
    );
  }
  if (!isContextTrustTier(entry.trust)) {
    return failure(
      "execution.context_invalid",
      `${path}.trust`,
      "Context Manifest entry has an unsupported Trust Tier.",
      "Use engine-instruction, approved-spec, task-context, or untrusted-reference.",
    );
  }
  if (
    entry.instructionPolicy !== "scoped-instruction" &&
    entry.instructionPolicy !== "data-only"
  ) {
    return failure(
      "execution.context_invalid",
      `${path}.instructionPolicy`,
      "Context Manifest entry has an unsupported instruction policy.",
      "Use scoped-instruction or data-only.",
    );
  }
  if (
    (entry.trust === "task-context" || entry.trust === "untrusted-reference") &&
    entry.instructionPolicy !== "data-only"
  ) {
    return failure(
      "execution.context_invalid",
      `${path}.instructionPolicy`,
      "Only Engine Instruction and Approved Spec entries may carry instruction authority.",
      "Set instructionPolicy to data-only for Task Context and Untrusted Reference entries.",
    );
  }
  if (
    !Array.isArray(entry.scope) ||
    !entry.scope.every((scope) => isRepositoryRelativePath(scope))
  ) {
    return failure(
      "execution.context_invalid",
      `${path}.scope`,
      "Context Manifest entry scope must contain repository-relative patterns.",
      "Use '/' paths without absolute roots, backslashes, or '..' traversal.",
    );
  }
  if (
    !validateDomainValue({
      contractVersion: DOMAIN_VALIDATION_CONTRACT_VERSION,
      kind: "contentHash",
      value: entry.identity,
    }).ok
  ) {
    return failure(
      "execution.context_invalid",
      `${path}.identity`,
      "Context Manifest entry content identity is invalid.",
      "Use a supported SHA-256 content identity with a 64-character hexadecimal digest.",
    );
  }
  if (
    !isIdentifier(entry.addedBy) ||
    (entry.acceptedByEvent !== undefined &&
      !isIdentifier(entry.acceptedByEvent))
  ) {
    return failure(
      "execution.context_invalid",
      path,
      "Context Manifest entry provenance is invalid.",
      "Provide valid addedBy and optional acceptedByEvent identifiers.",
    );
  }
  return null;
}

function validateRequiredContextEntry(
  entry: ContextManifestEntry,
  index: number,
  currentContext: readonly CurrentContextContent[],
): PhaseExecutionFailure | null {
  if (!entry.required) {
    return null;
  }
  const current = currentContext.find(
    (candidate) =>
      isUnknownRecord(candidate.source) &&
      candidate.source.type === entry.source.type &&
      candidate.source.value === entry.source.value,
  );
  if (current === undefined) {
    return failure(
      "execution.context_stale",
      `$.manifest[${index}].source`,
      "Required Context Manifest content is missing.",
      "Restore the required source or refresh and approve the phase Manifest.",
    );
  }
  if (
    typeof current.content !== "string" &&
    !(current.content instanceof Uint8Array)
  ) {
    return failure(
      "execution.context_invalid",
      `$.currentContext[${index}].content`,
      "Current Context content must be text or bytes.",
      "Read the source as UTF-8 text or an exact byte sequence.",
    );
  }
  if (!contentMatchesIdentity(current.content, entry.identity)) {
    return failure(
      "execution.context_stale",
      `$.manifest[${index}].identity`,
      "Required Context Manifest content no longer matches its identity.",
      "Refresh and approve the phase Manifest before dispatch.",
    );
  }
  return null;
}

function validateAgentBinding(
  request: BindPhaseExecutionRequest,
): PhaseExecutionFailure | null {
  const contract = request.agentContract;
  if (contract.schemaVersion !== PHASE_EXECUTION_CONTRACT_VERSION) {
    return failure(
      "execution.agent_invalid",
      "$.agentContract.schemaVersion",
      "Phase Agent Capability Contract schema version is unsupported.",
      "Regenerate the Agent contract with schemaVersion 1.",
    );
  }
  if (!isPhaseAgentRole(contract.role)) {
    return failure(
      "execution.agent_invalid",
      "$.agentContract.role",
      "Phase Agent Capability Contract has an unsupported role.",
      "Use one of the eight versioned Phase Agent roles.",
    );
  }
  if (
    contract.contractVersion !== PHASE_EXECUTION_CONTRACT_VERSION ||
    contract.runtimeName !== `sayhi-v${contract.contractVersion}-${contract.role}`
  ) {
    return failure(
      "execution.agent_invalid",
      "$.agentContract.runtimeName",
      "Phase Agent runtime identity is invalid.",
      "Use the namespaced runtime name generated from contractVersion and role.",
    );
  }
  if (
    !isUniqueNonEmptyStringArray(contract.tools) ||
    !isUniqueNonEmptyStringArray(contract.skills) ||
    !isUniqueNonEmptyStringArray(contract.spawns)
  ) {
    return failure(
      "execution.agent_invalid",
      "$.agentContract",
      "Phase Agent capability lists must contain unique non-empty names.",
      "Remove empty or duplicate tools, Skills, and spawn targets.",
    );
  }
  if (contract.network !== "none" && contract.network !== "configured") {
    return failure(
      "execution.agent_invalid",
      "$.agentContract.network",
      "Phase Agent Capability Contract has unsupported network access.",
      "Use none or configured network access.",
    );
  }
  if (
    contract.repositoryAccess !== "read-only" &&
    contract.repositoryAccess !== "exclusive-write" &&
    contract.repositoryAccess !== "read-only-plus-exclusive-validation"
  ) {
    return failure(
      "execution.agent_invalid",
      "$.agentContract.repositoryAccess",
      "Phase Agent Capability Contract has unsupported repository access.",
      "Use read-only, exclusive-write, or read-only-plus-exclusive-validation.",
    );
  }
  if (!isRepositoryRelativePath(contract.outputSchema)) {
    return failure(
      "execution.agent_invalid",
      "$.agentContract.outputSchema",
      "Phase Agent output schema path is invalid.",
      "Use a repository-relative output schema path.",
    );
  }
  if (!isContractIdentity(contract.promptBaseIdentity)) {
    return failure(
      "execution.agent_invalid",
      "$.agentContract.promptBaseIdentity",
      "Phase Agent prompt-base identity is invalid.",
      "Provide the generated prompt-base sha256 identity.",
    );
  }
  if (contract.overridePolicy !== "prompt-body-only") {
    return failure(
      "execution.agent_invalid",
      "$.agentContract.overridePolicy",
      "Phase Agent Capability Contract has an unsafe override policy.",
      "Use prompt-body-only overrides.",
    );
  }
  if (hashCanonicalJson(contract) !== request.dispatch.agentContractIdentity) {
    return failure(
      "execution.agent_invalid",
      "$.dispatch.agentContractIdentity",
      "Effective Phase Agent contract does not match the dispatched identity.",
      "Regenerate the Agent definition or dispatch its accepted Capability Contract.",
    );
  }
  if (request.dispatch.agentRole !== contract.role) {
    return failure(
      "execution.agent_invalid",
      "$.dispatch.agentRole",
      "Dispatched Agent role does not match the effective Capability Contract.",
      "Dispatch the Agent role named by the accepted Capability Contract.",
    );
  }
  const authorizedPhase = phaseByAgentRole[contract.role];
  if (request.dispatch.phase !== authorizedPhase) {
    return failure(
      "execution.agent_invalid",
      "$.dispatch.phase",
      "Phase Agent role is not authorized for the dispatched Phase.",
      `Dispatch ${contract.role} only during the ${authorizedPhase} Phase.`,
    );
  }
  return null;
}

type BindSkillIdentitiesResult =
  | Readonly<{
      ok: true;
      skillIdentities: readonly BoundSkillIdentity[];
    }>
  | PhaseExecutionFailure;

function bindSkillIdentities(
  request: BindPhaseExecutionRequest,
): BindSkillIdentitiesResult {
  const materialNames = new Set<string>();
  for (let index = 0; index < request.skills.length; index += 1) {
    const material = request.skills[index];
    if (
      material === undefined ||
      !isNonEmptyString(material.name) ||
      materialNames.has(material.name)
    ) {
      return failure(
        "execution.skill_invalid",
        `$.skills[${index}].name`,
        "Skill material name is invalid or duplicated.",
        "Provide one locked material record per Skill name.",
      );
    }
    materialNames.add(material.name);
  }

  const skillIdentities: BoundSkillIdentity[] = [];
  for (let index = 0; index < request.agentContract.skills.length; index += 1) {
    const name = request.agentContract.skills[index];
    const skillIndex = request.skills.findIndex(
      (candidate) => candidate.name === name,
    );
    const skill = request.skills[skillIndex];
    if (name === undefined || skill === undefined) {
      return failure(
        "execution.skill_invalid",
        `$.agentContract.skills[${index}]`,
        "A Skill declared by the Phase Agent is missing.",
        "Restore the locked Skill or regenerate the Agent Capability Contract.",
      );
    }
    if (
      !validateDomainValue({
        contractVersion: DOMAIN_VALIDATION_CONTRACT_VERSION,
        kind: "contentHash",
        value: skill.identity,
      }).ok
    ) {
      return failure(
        "execution.skill_invalid",
        `$.skills[${skillIndex}].identity`,
        "Locked Skill content identity is invalid.",
        "Use a supported SHA-256 content identity with a 64-character hexadecimal digest.",
      );
    }
    if (
      (typeof skill.content !== "string" &&
        !(skill.content instanceof Uint8Array)) ||
      !contentMatchesIdentity(skill.content, skill.identity)
    ) {
      return failure(
        "execution.skill_invalid",
        `$.skills[${skillIndex}].identity`,
        "Effective Skill content does not match its locked identity.",
        "Restore the locked Skill revision before dispatch.",
      );
    }
    skillIdentities.push(
      Object.freeze({
        name,
        identity: Object.freeze({
          ...skill.identity,
          algorithm: skill.identity.algorithm,
          digest: skill.identity.digest,
        }),
      }),
    );
  }
  return Object.freeze({
    ok: true,
    skillIdentities: Object.freeze(skillIdentities),
  });
}

function validateCapability(
  capability: PhaseCapability,
  contract: PhaseAgentContract,
): PhaseExecutionFailure | null {
  switch (capability.kind) {
    case "tool":
      return contract.tools.includes(capability.name)
        ? null
        : failure(
            "execution.capability_denied",
            "$.capability.name",
            `Phase Agent Capability Contract does not allow tool ${capability.name}.`,
            "Request only a tool declared by the effective Phase Agent contract.",
          );
    case "network":
      return contract.network === "configured"
        ? null
        : failure(
            "execution.capability_denied",
            "$.capability.kind",
            "Phase Agent Capability Contract does not allow network access.",
            "Use an Agent contract with configured network access or avoid network access.",
          );
    case "spawn":
      return contract.spawns.includes(capability.name)
        ? null
        : failure(
            "execution.capability_denied",
            "$.capability.name",
            `Phase Agent Capability Contract does not allow spawn ${capability.name}.`,
            "Request only a spawn target declared by the effective Phase Agent contract.",
          );
    case "repository": {
      const allowed =
        capability.access === "read" ||
        (capability.access === "write" &&
          contract.repositoryAccess === "exclusive-write") ||
        (capability.access === "validate" &&
          contract.repositoryAccess ===
            "read-only-plus-exclusive-validation");
      return allowed
        ? null
        : failure(
            "execution.capability_denied",
            "$.capability.access",
            `Phase Agent Capability Contract does not allow repository ${capability.access} access.`,
            "Request repository access within the effective Phase Agent contract.",
          );
    }
    case "skill":
      return contract.skills.includes(capability.name)
        ? null
        : failure(
            "execution.capability_denied",
            "$.capability.name",
            `Phase Agent Capability Contract does not allow Skill ${capability.name}.`,
            "Invoke only a Skill declared by the effective Phase Agent contract.",
          );
    default:
      return failure(
        "execution.request_invalid",
        "$.capability.kind",
        "Phase capability kind is unsupported.",
        "Request a tool, network, spawn, repository, or Skill capability.",
      );
  }
}






function isUniqueNonEmptyStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) {
    return false;
  }
  const names = new Set<string>();
  for (const item of value) {
    if (!isNonEmptyString(item) || names.has(item)) {
      return false;
    }
    names.add(item);
  }
  return true;
}

function isPhaseAgentRole(value: unknown): value is PhaseAgentRole {
  return typeof value === "string" && Object.hasOwn(phaseByAgentRole, value);
}



function contentMatchesIdentity(
  content: string | Uint8Array,
  identity: ContentHash,
): boolean {
  const digest = createHash("sha256")
    .update(contentBytes(content, identity.algorithm))
    .digest("hex");
  return digest.toLowerCase() === identity.digest.toLowerCase();
}

function contentBytes(
  content: string | Uint8Array,
  algorithm: ContentHashAlgorithm,
): string | Uint8Array {
  if (algorithm === "sha256-bytes-v1") {
    return content;
  }
  const text = typeof content === "string" ? content : new TextDecoder().decode(content);
  return text.replace(/\r\n?/gu, "\n");
}


function isContextTrustTier(value: unknown): value is ContextTrustTier {
  return (
    value === "engine-instruction" ||
    value === "approved-spec" ||
    value === "task-context" ||
    value === "untrusted-reference"
  );
}




function failure(
  code: PhaseExecutionDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): PhaseExecutionFailure {
  return Object.freeze({
    ok: false,
    contractVersion: PHASE_EXECUTION_CONTRACT_VERSION,
    diagnostics: Object.freeze([
      Object.freeze({ code, path, message, remediation }),
    ]),
  });
}
