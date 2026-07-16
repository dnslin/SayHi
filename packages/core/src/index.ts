import { validateDependencyGraph } from "./dependency-graph.js";
import {
  authorizePhaseExecution,
  bindPhaseExecution,
} from "./execution.js";
import { validateDomainValue } from "./validation.js";
import { validateContractRecord } from "./record-contracts.js";
import {
  diagnoseManagedProject,
  initializeManagedProject,
} from "./managed-project.js";
import {
  createSpec,
  findImpactedSpecContexts,
  listSpecs,
  readSpec,
  validateSpecs,
} from "./spec.js";
import {
  readRouteDefinition,
  readGateEvidenceKinds,
  adoptWorkflowBaseline,
  replayWorkflowEvents,
  startWorkflowTask,
  recordContextManifestChange,
  transitionWorkflow,
} from "./workflow.js";
import {
  advanceDurableTask,
  archiveDurableTask,
  adoptDurableTaskBaseline,
  createDurableTask,
  createDurableTaskHandoff,
  diagnoseDurableTasks,
  recoverDurableTask,
  readDurableTask,
  refreshDurableContextManifest,
  freezeDurableContextManifest,
  addDurableContextManifestEntry,
  removeDurableContextManifestEntry,
  withDurableTaskWriter,
  inspectDurableContextManifest,
  inspectDurableInitiativeGraph,
} from "./task-lifecycle.js";

export {
  RECORD_CONTRACT_VERSION,
  validateContractRecord,
} from "./record-contracts.js";
export type {
  AgentResultOutcome,
  AgentResultRecord,
  BaselineRecord,
  BaselineUntrackedFile,
  BaselineDirtyPath,
  ContractRecord,
  ContractRecordDiagnostic,
  ContractRecordDiagnosticCode,
  ContractRecordKind,
  ContractRecordValidationFailure,
  ContractRecordValidationRequest,
  ContractRecordValidationResult,
  ContractRecordValidationSuccess,
  EvidenceCommand,
  EvidenceRecord,
  EvidenceResult,
  ExternalReferenceRecord,
  KnowledgeCandidateRecord,
  KnowledgeCandidateStatus,
  KnowledgeConfidence,
  InstalledProjectVersions,
  LeaseKind,
  LeaseOwner,
  LeaseRecord,
  LockedSkill,
  ManagedFileOwnershipClass,
  ManagedFileRecord,
  ProjectManifestRecord,
  SkillLockFile,
  SkillLockRecord,
  SkillUpstreamIdentity,
} from "./record-contracts.js";
export {
  MANAGED_PROJECT_CONTRACT_VERSION,
  MANAGED_PROJECT_CONFIG_CONTENT,
  MANAGED_PROJECT_CONFIG_PATH,
  MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
  MANAGED_PROJECT_RUNTIME_IGNORE_PATH,
  MANAGED_PROJECT_REQUIRED_DIRECTORIES,
  diagnoseManagedProject,
  initializeManagedProject,
} from "./managed-project.js";
export type {
  DiagnoseManagedProjectRequest,
  DiagnoseManagedProjectResult,
  InitializeManagedProjectRequest,
  InitializeManagedProjectResult,
  ManagedProjectDiagnostic,
  ManagedProjectDiagnosticCode,
  ManagedProjectFileSystem,
  ManagedProjectPathKind,
  ManagedProjectState,
} from "./managed-project.js";
export {
  applyManagedProjectPlan,
  MANAGED_PROJECT_OPERATION_JOURNAL_PATH,
  recoverManagedProjectOperation,
  planManagedProjectUninstall,
  planManagedProjectUpdate,
} from "./managed-project-mutation.js";
export type {
  ApplyManagedProjectPlanRequest,
  ApplyManagedProjectPlanResult,
  ManagedProjectConflictVariants,
  ManagedProjectInstalledFile,
  ManagedProjectMutationPlan,
  ManagedProjectMutationFileSystem,
  ManagedProjectUninstallAction,
  ManagedProjectUninstallConflictVariants,
  ManagedProjectUninstallPlan,
  ManagedProjectUpdateAction,
  ManagedProjectUpdateFile,
  ManagedProjectUpdatePlan,
  PlanManagedProjectUninstallRequest,
  PlanManagedProjectUninstallResult,
  PlanManagedProjectUpdateRequest,
  RecoverManagedProjectOperationRequest,
  PlanManagedProjectUpdateResult,
} from "./managed-project-mutation.js";


export {
  DOMAIN_VALIDATION_CONTRACT_VERSION,
  DURABLE_RECORD_SCHEMA_VERSION,
} from "./validation.js";
export type {
  ContentHash,
  ContentHashAlgorithm,
  DomainValidationFailure,
  DomainValidationKind,
  DomainValidationRequest,
  DomainValidationResult,
  DomainValidationSuccess,
  DurableRecordEnvelope,
  Identifier,
  Timestamp,
  ValidationDiagnostic,
  ValidationDiagnosticCode,
  Version,
} from "./validation.js";

export {
  DEPENDENCY_GRAPH_CONTRACT_VERSION,
  validateDependencyGraph,
} from "./dependency-graph.js";
export type {
  DependencyGraphDiagnostic,
  DependencyGraphDiagnosticCode,
  DependencyGraphValidationFailure,
  DependencyGraphValidationRequest,
  DependencyGraphValidationResult,
  DependencyGraphValidationSuccess,
} from "./dependency-graph.js";

export type { ContractIdentity } from "./identity.js";

export { CONTEXT_MANIFEST_CONTRACT_VERSION } from "./context-manifest.js";
export type { ContextManifestDiagnostic } from "./context-manifest.js";
export {
  SPEC_CONTRACT_VERSION,
  createSpec,
  findImpactedSpecContexts,
  listSpecs,
  readSpec,
  validateSpecs,
} from "./spec.js";
export type {
  CreateSpecRequest,
  CreateSpecResult,
  ListSpecsResult,
  FindImpactedSpecContextsRequest,
  FindImpactedSpecContextsResult,
  ReadSpecRequest,
  ReadSpecResult,
  SpecDiagnostic,
  SpecContextImpact,
  SpecImpactFileSystem,
  SpecDirectoryEntry,
  SpecFileSystem,
  ValidateSpecsRequest,
  ValidateSpecsResult,
} from "./spec.js";


export {
  PHASE_EXECUTION_CONTRACT_VERSION,
  bindPhaseExecution,
  authorizePhaseExecution,
} from "./execution.js";
export type {
  AgentNetworkAccess,
  AgentRepositoryAccess,
  AuthorizePhaseExecutionRequest,
  AuthorizePhaseExecutionResult,
  BindPhaseExecutionRequest,
  BindPhaseExecutionResult,
  BoundSkillIdentity,
  ContextInjectionMode,
  ContextInstructionPolicy,
  ContextManifestEntry,
  ContextSource,
  ContextTrustTier,
  CurrentContextContent,
  PhaseAgentContract,
  PhaseAgentRole,
  PhaseCapability,
  PhaseExecutionBinding,
  PhaseExecutionMaterials,
  PhaseExecutionDiagnostic,
  PhaseExecutionAuthorization,
  PhaseExecutionFailure,
  PhaseExecutionDiagnosticCode,
  PhaseExecutionDispatch,
  RepositoryOperation,
  SkillMaterial,
} from "./execution.js";

export {
  WORKFLOW_CONTRACT_VERSION,
  adoptWorkflowBaseline,
  readRouteDefinition,
  readGateEvidenceKinds,
  replayWorkflowEvents,
  startWorkflowTask,
  transitionWorkflow,
  recordContextManifestChange,
} from "./workflow.js";
export type {
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphEdgeType,
  DependencyGraphNode,
  GateAcceptance,
  GateEvidence,
  GateEvidenceKind,
  ReplayWorkflowEventsResult,
  AdoptWorkflowBaselineRequest,
  AdoptWorkflowBaselineResult,
  BaselineAdoptedEvent,
  ContextManifestChange,
  ContextManifestChangedEvent,
  RecordContextManifestChangeRequest,
  RecordContextManifestChangeResult,
  BaselineAdoptedPath,
  RouteDefinition,
  StartWorkflowTaskRequest,
  StartWorkflowTaskResult,
  TaskCreatedEvent,
  TaskIntent,
  TaskPolicies,
  TaskProjection,
  TaskScope,
  TransitionWorkflowRequest,
  TransitionWorkflowResult,
  WorkflowActor,
  WorkflowDiagnostic,
  WorkflowDiagnosticCode,
  WorkflowEvent,
  WorkflowEventHead,
  WorkflowEventMetadata,
  WorkflowGate,
  WorkflowLifecycle,
  WorkflowPhase,
  WorkflowPosition,
  WorkflowRoute,
  WorkflowState,
  WorkflowTaskDefinition,
  WorkflowTransition,
  WorkflowTransitionEndpoint,
  WorkflowTransitionedEvent,
} from "./workflow.js";

export {
  TASK_LIFECYCLE_CONTRACT_VERSION,
  addDurableContextManifestEntry,
  archiveDurableTask,
  advanceDurableTask,
  adoptDurableTaskBaseline,
  createDurableTask,
  createDurableTaskHandoff,
  diagnoseDurableTasks,
  recoverDurableTask,
  readDurableTask,
  refreshDurableContextManifest,
  freezeDurableContextManifest,
  inspectDurableContextManifest,
  inspectDurableInitiativeGraph,
  removeDurableContextManifestEntry,
  withDurableTaskWriter,
} from "./task-lifecycle.js";
export type {
  ArchiveDurableTaskRequest,
  ArchiveDurableTaskResult,
  AdvanceDurableTaskRequest,
  AddDurableContextManifestEntryRequest,
  AddDurableContextManifestEntryResult,
  ContextManifestFileSystem,
  InspectDurableContextManifestRequest,
  InspectDurableContextManifestResult,
  InitiativeGraphNodeInspection,
  InitiativeGraphNodeStatus,
  InspectDurableInitiativeGraphRequest,
  InspectDurableInitiativeGraphResult,
  RefreshDurableContextManifestRequest,
  RefreshDurableContextManifestResult,
  FreezeDurableContextManifestRequest,
  FreezeDurableContextManifestResult,
  RemoveDurableContextManifestEntryRequest,
  RemoveDurableContextManifestEntryResult,
  AdoptDurableTaskBaselineRequest,
  AdoptDurableTaskBaselineResult,
  AdvanceDurableTaskResult,
  CreateDurableTaskRequest,
  CreateDurableTaskHandoffRequest,
  CreateDurableTaskHandoffResult,
  DurableTaskHandoff,
  CreateDurableTaskResult,
  DiagnoseDurableTasksRequest,
  DiagnoseDurableTasksResult,
  RecoverDurableTaskRequest,
  RecoverDurableTaskResult,
  ReadDurableTaskRequest,
  ReadDurableTaskResult,
  TaskLifecycleDiagnostic,
  TaskLifecycleDiagnosticCode,
  TaskLifecycleDirectoryEntry,
  TaskLifecycleFileSystem,
  TaskArchiveFileSystem,
  TaskBaselineCaptureRequest,
  TaskBaselineFileSystem,
  TaskWriter,
  WithDurableTaskWriterRequest,
  WithDurableTaskWriterResult,
} from "./task-lifecycle.js";

export interface BootstrapContract {
  readonly product: "SayHi";
  readonly contractVersion: 1;
}

export interface CoreContract {
  readBootstrapContract(): BootstrapContract;
  readonly validateDomainValue: typeof validateDomainValue;
  readonly validateDependencyGraph: typeof validateDependencyGraph;
  readonly validateContractRecord: typeof validateContractRecord;
  readonly diagnoseManagedProject: typeof diagnoseManagedProject;
  readonly initializeManagedProject: typeof initializeManagedProject;
  readonly createSpec: typeof createSpec;
  readonly findImpactedSpecContexts: typeof findImpactedSpecContexts;
  readonly listSpecs: typeof listSpecs;
  readonly readSpec: typeof readSpec;
  readonly validateSpecs: typeof validateSpecs;
  readonly bindPhaseExecution: typeof bindPhaseExecution;
  readonly authorizePhaseExecution: typeof authorizePhaseExecution;
  readonly readRouteDefinition: typeof readRouteDefinition;
  readonly startWorkflowTask: typeof startWorkflowTask;
  readonly transitionWorkflow: typeof transitionWorkflow;
  readonly replayWorkflowEvents: typeof replayWorkflowEvents;
  readonly adoptWorkflowBaseline: typeof adoptWorkflowBaseline;
  readonly recordContextManifestChange: typeof recordContextManifestChange;
  readonly createDurableTask: typeof createDurableTask;
  readonly createDurableTaskHandoff: typeof createDurableTaskHandoff;
  readonly advanceDurableTask: typeof advanceDurableTask;
  readonly archiveDurableTask: typeof archiveDurableTask;
  readonly addDurableContextManifestEntry: typeof addDurableContextManifestEntry;
  readonly refreshDurableContextManifest: typeof refreshDurableContextManifest;
  readonly freezeDurableContextManifest: typeof freezeDurableContextManifest;
  readonly removeDurableContextManifestEntry: typeof removeDurableContextManifestEntry;
  readonly recoverDurableTask: typeof recoverDurableTask;
  readonly readDurableTask: typeof readDurableTask;
  readonly adoptDurableTaskBaseline: typeof adoptDurableTaskBaseline;
  readonly diagnoseDurableTasks: typeof diagnoseDurableTasks;
  readonly withDurableTaskWriter: typeof withDurableTaskWriter;
  readonly inspectDurableContextManifest: typeof inspectDurableContextManifest;
  readonly inspectDurableInitiativeGraph: typeof inspectDurableInitiativeGraph;
}

const bootstrapContract: BootstrapContract = Object.freeze({
  product: "SayHi",
  contractVersion: 1,
});

export const coreContract: CoreContract = Object.freeze({
  readBootstrapContract: () => bootstrapContract,
  validateDomainValue,
  validateDependencyGraph,
  validateContractRecord,
  diagnoseManagedProject,
  initializeManagedProject,
  createSpec,
  findImpactedSpecContexts,
  listSpecs,
  readSpec,
  validateSpecs,
  bindPhaseExecution,
  authorizePhaseExecution,
  readRouteDefinition,
  startWorkflowTask,
  transitionWorkflow,
  replayWorkflowEvents,
  adoptWorkflowBaseline,
  recordContextManifestChange,
  createDurableTask,
  createDurableTaskHandoff,
  advanceDurableTask,
  archiveDurableTask,
  addDurableContextManifestEntry,
  refreshDurableContextManifest,
  freezeDurableContextManifest,
  recoverDurableTask,
  removeDurableContextManifestEntry,
  readDurableTask,
  adoptDurableTaskBaseline,
  diagnoseDurableTasks,
  withDurableTaskWriter,
  inspectDurableContextManifest,
  inspectDurableInitiativeGraph,
});
