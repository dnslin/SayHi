import {
  hashCanonicalJson,
  isContractIdentity,
  type ContractIdentity,
} from "./identity.js";
import {
  RECORD_CONTRACT_VERSION,
  validateContractRecord,
  type AgentResultRecord,
} from "./record-contracts.js";
import { verifySkillBundle, type SkillBundle } from "./skill-bundle.js";
import {
  contentMatchesIdentity,
  validateContextManifestEntries,
} from "./context-manifest.js";
import type {
  ContextInjectionMode,
  ContextInstructionPolicy,
  ContextManifestEntry,
  ContextSource,
  ContextTrustTier,
  CurrentContextContent,
} from "./context-manifest.js";

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
export type {
  ContextInjectionMode,
  ContextInstructionPolicy,
  ContextManifestEntry,
  ContextSource,
  ContextTrustTier,
  CurrentContextContent,
} from "./context-manifest.js";


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
  readonly skillBundle: SkillBundle;
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
  readonly skillLockIdentity: ContractIdentity;
  readonly skillIdentities: readonly BoundSkillIdentity[];
}

export function parsePhaseExecutionBinding(
  value: unknown,
): PhaseExecutionBinding | null {
  try {
    if (
      !isUnknownRecord(value) ||
      !Array.isArray(value.skillIdentities) ||
      !isContractIdentity(value.skillLockIdentity)
    ) {
      return null;
    }
    const dispatch = {
      schemaVersion: value.schemaVersion,
      dispatchId: value.dispatchId,
      taskId: value.taskId,
      expectedTaskVersion: value.expectedTaskVersion,
      phase: value.phase,
      agentRole: value.agentRole,
      baseFingerprint: value.baseFingerprint,
      requestedAt: value.requestedAt,
      contextManifestIdentity: value.contextManifestIdentity,
      agentContractIdentity: value.agentContractIdentity,
    } as PhaseExecutionDispatch;
    if (validateDispatch(dispatch) !== null) {
      return null;
    }
    const names = new Set<string>();
    const skillIdentities: BoundSkillIdentity[] = [];
    for (const skill of value.skillIdentities) {
      if (
        !isUnknownRecord(skill) ||
        !isNonEmptyString(skill.name) ||
        names.has(skill.name) ||
        !validateDomainValue({
          contractVersion: DOMAIN_VALIDATION_CONTRACT_VERSION,
          kind: "contentHash",
          value: skill.identity,
        }).ok
      ) {
        return null;
      }
      names.add(skill.name);
      skillIdentities.push(
        Object.freeze({
          name: skill.name,
          identity: Object.freeze({ ...(skill.identity as ContentHash) }),
        }),
      );
    }
    return Object.freeze({
      schemaVersion: dispatch.schemaVersion,
      dispatchId: dispatch.dispatchId,
      taskId: dispatch.taskId,
      expectedTaskVersion: dispatch.expectedTaskVersion,
      phase: dispatch.phase,
      agentRole: dispatch.agentRole,
      baseFingerprint: dispatch.baseFingerprint,
      requestedAt: dispatch.requestedAt,
      contextManifestIdentity: dispatch.contextManifestIdentity,
      agentContractIdentity: dispatch.agentContractIdentity,
      skillLockIdentity: value.skillLockIdentity,
      skillIdentities: Object.freeze(skillIdentities),
    });
  } catch {
    return null;
  }
}

export function parsePhaseExecutionResult(
  value: unknown,
): AgentResultRecord | null {
  const validation = validateContractRecord({
    contractVersion: RECORD_CONTRACT_VERSION,
    kind: "agentResult",
    record: value,
  });
  return validation.ok ? (validation.record as AgentResultRecord) : null;
}

export function phaseExecutionResultMatchesBinding(
  result: AgentResultRecord,
  binding: PhaseExecutionBinding,
): boolean {
  return (
    result.dispatchId === binding.dispatchId &&
    result.taskId === binding.taskId &&
    result.expectedTaskVersion === binding.expectedTaskVersion &&
    result.phase === binding.phase &&
    result.agentRole === binding.agentRole &&
    result.contextManifestIdentity === binding.contextManifestIdentity &&
    result.agentContractIdentity === binding.agentContractIdentity &&
    result.baseFingerprint === binding.baseFingerprint
  );
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
    skillLockIdentity: skillsResult.skillLockIdentity,
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
    skillBundle: request.skillBundle,
  });
  if (!rebound.ok) {
    return rebound;
  }

  if (rebound.binding.skillLockIdentity !== binding.skillLockIdentity) {
    return failure(
      "execution.skill_invalid",
      "$.binding.skillLockIdentity",
      "Effective Skill Bundle Lock does not match the Phase execution binding.",
      "Restore the exact locked Skill Bundle before requesting a capability.",
    );
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

  const manifest = validateContextManifestEntries(request.manifest);
  if (!manifest.ok) {
    const diagnostic = manifest.diagnostics[0]!;
    return failure(
      "execution.context_invalid",
      `$.manifest${diagnostic.path.slice(1)}`,
      diagnostic.message,
      diagnostic.remediation,
    );
  }
  for (let index = 0; index < manifest.entries.length; index += 1) {
    const freshnessFailure = validateRequiredContextEntry(
      manifest.entries[index]!,
      index,
      request.currentContext,
    );
    if (freshnessFailure !== null) {
      return freshnessFailure;
    }
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
  if (
    (contract.role === "standards-review" || contract.role === "spec-review") &&
    contract.repositoryAccess !== "read-only"
  ) {
    return failure(
      "execution.agent_invalid",
      "$.agentContract.repositoryAccess",
      "Review Agent Capability Contracts must have read-only repository access.",
      "Use read-only access for Standards Review and Spec Review Agents.",
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
      skillLockIdentity: ContractIdentity;
    }>
  | PhaseExecutionFailure;

function bindSkillIdentities(
  request: BindPhaseExecutionRequest,
): BindSkillIdentitiesResult {
  const bundle = verifySkillBundle(request.skillBundle);
  if (!bundle.ok) {
    const diagnostic = bundle.diagnostics[0]!;
    return failure(
      "execution.skill_invalid",
      diagnostic.path === "$"
        ? "$.skillBundle"
        : `$.skillBundle${diagnostic.path.slice(1)}`,
      diagnostic.message,
      diagnostic.remediation,
    );
  }

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
    const bundledSkill = bundle.skills.find((candidate) => candidate.name === name);
    if (bundledSkill === undefined) {
      return failure(
        "execution.skill_invalid",
        `$.agentContract.skills[${index}]`,
        "A Skill declared by the Phase Agent is absent from the release Skill Bundle.",
        "Restore the locked Skill Bundle or regenerate the Agent Capability Contract.",
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
      skill.identity.algorithm !== bundledSkill.skillFile.identity.algorithm ||
      skill.identity.digest.toLowerCase() !==
        bundledSkill.skillFile.identity.digest.toLowerCase()
    ) {
      return failure(
        "execution.skill_invalid",
        `$.skills[${skillIndex}].identity`,
        "Effective Skill identity does not match the release Skill Bundle.",
        "Restore the locked Skill revision before dispatch.",
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
  if (
    materialNames.size !== request.agentContract.skills.length ||
    request.skills.some(
      (material) => !request.agentContract.skills.includes(material.name),
    )
  ) {
    return failure(
      "execution.skill_invalid",
      "$.skills",
      "Skill materials must exactly match the Phase Agent's declared Skills.",
      "Provide one locked material record for each declared Skill and no undeclared Skills.",
    );
  }
  return Object.freeze({
    ok: true,
    skillIdentities: Object.freeze(skillIdentities),
    skillLockIdentity: bundle.lockIdentity,
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
