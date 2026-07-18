import { validateDependencyGraph } from "./dependency-graph.js";
import { deriveInitiativeReadiness } from "./initiative-readiness.js";
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
  escalateQuickToBuild,
  recordContextManifestChange,
  recordBuildPlanChange,
  transitionWorkflow,
  recordPhaseExecutionDispatch,
  recordPhaseExecutionResult,
  reviseInitiativeGraph,
} from "./workflow.js";
import {
  advanceDurableTask,
  archiveDurableTask,
  adoptDurableTaskBaseline,
  createDurableTask,
  createDurableTaskHandoff,
  completeDurableQuickResult,
  readDurableQuickResult,
  recordDurableQuickResult,
  diagnoseDurableTasks,
  escalateDurableQuickToBuild,
  listDurableTasks,
  recoverDurableTask,
  readDurableTask,
  refreshDurableContextManifest,
  freezeDurableContextManifest,
  addDurableContextManifestEntry,
  removeDurableContextManifestEntry,
  withDurableTaskWriter,
  withBoundDurableTaskWriter,
  inspectDurableContextManifest,
  decideDurableBuildPlan,
  recordDurableBuildPlan,
  inspectDurableInitiativeGraph,
  inspectDurableInitiativeReadiness,
  reviseDurableInitiativeGraph,
  dispatchDurablePhaseExecution,
  resumeDurablePhaseExecution,
  recordDurablePhaseExecutionResult,
  finishDurableTaskCommit,
  planDurableTaskCommit,
} from "./task-lifecycle.js";

export {
  RECORD_CONTRACT_VERSION,
  validateContractRecord,
} from "./record-contracts.js";
export type {
  AgentResultOutcome,
  AgentResultRecord,
  ReviewFinding,
  ReviewFindingSeverity,
  ReviewFindingSubject,
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

export { deriveInitiativeReadiness } from "./initiative-readiness.js";
export type {
  DependencyGraphDiagnostic,
  DependencyGraphDiagnosticCode,
  DependencyGraphValidationFailure,
  DependencyGraphValidationRequest,
  DependencyGraphValidationResult,
  DependencyGraphValidationSuccess,
} from "./dependency-graph.js";

export type {
  InitiativeReadiness,
  InitiativeReadinessBlocker,
  InitiativeReadinessBlockerCode,
  InitiativeReadinessNode,
  InitiativeReadinessResult,
  InitiativeReadinessTask,
  InitiativeReadinessContextState,
} from "./initiative-readiness.js";

export {
  InitiativeExecutionScheduler,
  InitiativeReadWriteBarrier,
} from "./initiative-scheduler.js";
export type {
  InitiativeNodeExecution,
  InitiativeNodeExecutionOutcome,
  InitiativeNodeExecutionResult,
  InitiativeScheduleFailure,
  InitiativeScheduleRequest,
  InitiativeScheduleResult,
  InitiativeWriterOwner,
} from "./initiative-scheduler.js";

export type { ContractIdentity } from "./identity.js";

export { DURABLE_BUILD_PLAN_SCHEMA_VERSION } from "./build-plan.js";
export type {
  DurableBuildPlan,
  ParseDurableBuildPlanResult,
} from "./build-plan.js";

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
  escalateQuickToBuild,
  transitionWorkflow,
  recordContextManifestChange,
  recordBuildPlanChange,
  recordPhaseExecutionResult,
  reviseInitiativeGraph,
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
  BuildPlanChange,
  BuildPlanChangedEvent,
  InitiativeGraphRevisedEvent,
  InitiativeGraphRevision,
  ContextManifestChange,
  ContextManifestChangedEvent,
  EscalateQuickToBuildRequest,
  EscalateQuickToBuildResult,
  RecordContextManifestChangeRequest,
  RecordContextManifestChangeResult,
  RecordBuildPlanChangeRequest,
  RecordBuildPlanChangeResult,
  ReviseInitiativeGraphRequest,
  ReviseInitiativeGraphResult,
  BaselineAdoptedPath,
  RouteDefinition,
  RouteEscalatedEvent,
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
  escalateDurableQuickToBuild,
  adoptDurableTaskBaseline,
  createDurableTask,
  createDurableTaskHandoff,
  completeDurableQuickResult,
  diagnoseDurableTasks,
  listDurableTasks,
  recoverDurableTask,
  readDurableQuickResult,
  recordDurableQuickResult,
  readDurableTask,
  refreshDurableContextManifest,
  freezeDurableContextManifest,
  inspectDurableContextManifest,
  inspectDurableInitiativeGraph,
  inspectDurableInitiativeReadiness,
  reviseDurableInitiativeGraph,
  removeDurableContextManifestEntry,
  withDurableTaskWriter,
  withBoundDurableTaskWriter,
  decideDurableBuildPlan,
  recordDurableBuildPlan,
  dispatchDurablePhaseExecution,
  resumeDurablePhaseExecution,
  recordDurablePhaseExecutionResult,
  finishDurableTaskCommit,
  planDurableTaskCommit,
} from "./task-lifecycle.js";
export type {
  ArchiveDurableTaskRequest,
  ArchiveDurableTaskResult,
  AdvanceDurableTaskRequest,
  AddDurableContextManifestEntryRequest,
  AddDurableContextManifestEntryResult,
  InitiativeGraphFileSystem,
  InitiativeReadinessFileSystem,
  ContextManifestFileSystem,
  InspectDurableContextManifestRequest,
  InspectDurableContextManifestResult,
  InitiativeGraphNodeInspection,
  InitiativeGraphNodeStatus,
  InspectDurableInitiativeGraphRequest,
  InspectDurableInitiativeGraphResult,
  InspectDurableInitiativeReadinessRequest,
  InspectDurableInitiativeReadinessResult,
  RefreshDurableContextManifestRequest,
  RefreshDurableContextManifestResult,
  FreezeDurableContextManifestRequest,
  FreezeDurableContextManifestResult,
  RemoveDurableContextManifestEntryRequest,
  RemoveDurableContextManifestEntryResult,
  AdoptDurableTaskBaselineRequest,
  AdoptDurableTaskBaselineResult,
  AdvanceDurableTaskResult,
  ReviseDurableInitiativeGraphRequest,
  ReviseDurableInitiativeGraphResult,
  EscalateDurableQuickToBuildRequest,
  EscalateDurableQuickToBuildResult,
  CreateDurableTaskRequest,
  CreateDurableTaskHandoffRequest,
  CreateDurableTaskHandoffResult,
  DurableTaskHandoff,
  CreateDurableTaskResult,
  DiagnoseDurableTasksRequest,
  DiagnoseDurableTasksResult,
  ListDurableTasksRequest,
  ListDurableTasksResult,
  RecoverDurableTaskRequest,
  RecoverDurableTaskResult,
  DurableQuickRecordLocation,
  DurableQuickResult,
  ReadDurableQuickResultRequest,
  ReadDurableQuickResultResult,
  RecordDurableQuickResultRequest,
  RecordDurableQuickResultResult,
  CompleteDurableQuickResultRequest,
  CompleteDurableQuickResultResult,
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
  ScopedTaskWriter,
  WithDurableTaskWriterRequest,
  WithDurableTaskWriterResult,
  WithBoundDurableTaskWriterRequest,
  DecideDurableBuildPlanRequest,
  DecideDurableBuildPlanResult,
  RecordDurableBuildPlanRequest,
  RecordDurableBuildPlanResult,
  DispatchDurablePhaseExecutionRequest,
  DispatchDurablePhaseExecutionResult,
  ResumeDurablePhaseExecutionRequest,
  ResumeDurablePhaseExecutionResult,
  RecordDurablePhaseExecutionResultRequest,
  RecordDurablePhaseExecutionResultResult,
  DurableTaskCommitEvidence,
  DurableTaskCommitPlan,
  FinishDurableTaskCommitRequest,
  FinishDurableTaskCommitResult,
  PlanDurableTaskCommitRequest,
  PlanDurableTaskCommitResult,
  TaskCommitPort,
  TaskCommitRepositoryState,
  TaskCommitRequest,
  TaskCommitResult,
} from "./task-lifecycle.js";

export interface BootstrapContract {
  readonly product: "SayHi";
  readonly contractVersion: 1;
}

export interface CoreContract {
  readBootstrapContract(): BootstrapContract;
  readonly validateDomainValue: typeof validateDomainValue;
  readonly validateDependencyGraph: typeof validateDependencyGraph;
  readonly deriveInitiativeReadiness: typeof deriveInitiativeReadiness;
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
  readonly escalateQuickToBuild: typeof escalateQuickToBuild;
  readonly transitionWorkflow: typeof transitionWorkflow;
  readonly replayWorkflowEvents: typeof replayWorkflowEvents;
  readonly adoptWorkflowBaseline: typeof adoptWorkflowBaseline;
  readonly recordContextManifestChange: typeof recordContextManifestChange;
  readonly recordBuildPlanChange: typeof recordBuildPlanChange;
  readonly reviseInitiativeGraph: typeof reviseInitiativeGraph;
  readonly recordPhaseExecutionDispatch: typeof recordPhaseExecutionDispatch;
  readonly recordPhaseExecutionResult: typeof recordPhaseExecutionResult;
  readonly createDurableTask: typeof createDurableTask;
  readonly createDurableTaskHandoff: typeof createDurableTaskHandoff;
  readonly readDurableQuickResult: typeof readDurableQuickResult;
  readonly recordDurableQuickResult: typeof recordDurableQuickResult;
  readonly completeDurableQuickResult: typeof completeDurableQuickResult;
  readonly advanceDurableTask: typeof advanceDurableTask;
  readonly escalateDurableQuickToBuild: typeof escalateDurableQuickToBuild;
  readonly archiveDurableTask: typeof archiveDurableTask;
  readonly addDurableContextManifestEntry: typeof addDurableContextManifestEntry;
  readonly refreshDurableContextManifest: typeof refreshDurableContextManifest;
  readonly freezeDurableContextManifest: typeof freezeDurableContextManifest;
  readonly removeDurableContextManifestEntry: typeof removeDurableContextManifestEntry;
  readonly recoverDurableTask: typeof recoverDurableTask;
  readonly readDurableTask: typeof readDurableTask;
  readonly adoptDurableTaskBaseline: typeof adoptDurableTaskBaseline;
  readonly diagnoseDurableTasks: typeof diagnoseDurableTasks;
  readonly listDurableTasks: typeof listDurableTasks;
  readonly withDurableTaskWriter: typeof withDurableTaskWriter;
  readonly withBoundDurableTaskWriter: typeof withBoundDurableTaskWriter;
  readonly inspectDurableContextManifest: typeof inspectDurableContextManifest;
  readonly inspectDurableInitiativeGraph: typeof inspectDurableInitiativeGraph;
  readonly inspectDurableInitiativeReadiness: typeof inspectDurableInitiativeReadiness;
  readonly reviseDurableInitiativeGraph: typeof reviseDurableInitiativeGraph;
  readonly decideDurableBuildPlan: typeof decideDurableBuildPlan;
  readonly recordDurableBuildPlan: typeof recordDurableBuildPlan;
  readonly dispatchDurablePhaseExecution: typeof dispatchDurablePhaseExecution;
  readonly resumeDurablePhaseExecution: typeof resumeDurablePhaseExecution;
  readonly recordDurablePhaseExecutionResult: typeof recordDurablePhaseExecutionResult;
  readonly finishDurableTaskCommit: typeof finishDurableTaskCommit;
  readonly planDurableTaskCommit: typeof planDurableTaskCommit;
}

const bootstrapContract: BootstrapContract = Object.freeze({
  product: "SayHi",
  contractVersion: 1,
});

export const coreContract: CoreContract = Object.freeze({
  readBootstrapContract: () => bootstrapContract,
  validateDomainValue,
  validateDependencyGraph,
  deriveInitiativeReadiness,
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
  escalateQuickToBuild,
  transitionWorkflow,
  replayWorkflowEvents,
  adoptWorkflowBaseline,
  recordContextManifestChange,
  recordBuildPlanChange,
  reviseInitiativeGraph,
  recordPhaseExecutionDispatch,
  recordPhaseExecutionResult,
  createDurableTask,
  createDurableTaskHandoff,
  readDurableQuickResult,
  recordDurableQuickResult,
  completeDurableQuickResult,
  advanceDurableTask,
  escalateDurableQuickToBuild,
  archiveDurableTask,
  addDurableContextManifestEntry,
  refreshDurableContextManifest,
  freezeDurableContextManifest,
  recoverDurableTask,
  removeDurableContextManifestEntry,
  readDurableTask,
  adoptDurableTaskBaseline,
  diagnoseDurableTasks,
  listDurableTasks,
  withDurableTaskWriter,
  withBoundDurableTaskWriter,
  inspectDurableContextManifest,
  inspectDurableInitiativeGraph,
  inspectDurableInitiativeReadiness,
  reviseDurableInitiativeGraph,
  decideDurableBuildPlan,
  recordDurableBuildPlan,
  dispatchDurablePhaseExecution,
  resumeDurablePhaseExecution,
  recordDurablePhaseExecutionResult,
  finishDurableTaskCommit,
  planDurableTaskCommit,
});
