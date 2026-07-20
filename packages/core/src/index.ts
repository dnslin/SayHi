import { validateDependencyGraph } from "./dependency-graph.js";
import { deriveInitiativeReadiness } from "./initiative-readiness.js";
import {
  authorizePhaseExecution,
  bindPhaseExecution,
} from "./execution.js";
import { validateDomainValue } from "./validation.js";
import {
  isKnowledgeCandidateStatus,
  validateContractRecord,
} from "./record-contracts.js";
import {
  verifySkillBundle,
  verifySkillBundleInstallation,
} from "./skill-bundle.js";
import { proposeSkillUpgrades } from "./skill-upgrade.js";
import {
  verifyCoordinatedReleaseArtifacts,
  verifyTrustedCoordinatedReleaseArtifacts,
} from "./release-artifacts.js";
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
  createKnowledgeCandidate,
  listKnowledgeCandidates,
  readKnowledgeCandidate,
  reviewKnowledgeCandidate,
} from "./knowledge.js";
import { promoteKnowledgeCandidate } from "./knowledge-promotion.js";
import {
  projectDeletedMarkdownTrackerTask,
  projectMarkdownTracker,
  resolveMarkdownTrackerConflict,
} from "./markdown-tracker.js";
import { projectTrackerProjection, resolveTrackerProjectionConflict } from "./tracker-projection.js";
import {
  getGitHubIssueProjectionStatus,
  pullGitHubIssueProjection,
  pushGitHubIssueProjection,
  resolveGitHubIssueProjectionConflict,
} from "./github-tracker.js";
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
  recordTrackerSynchronization,
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
  isKnowledgeCandidateStatus,
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
  KnowledgeCandidateReview,
  KnowledgeReviewDisposition,
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
  SKILL_BUNDLE_CONTRACT_VERSION,
  verifySkillBundle,
  verifySkillBundleInstallation,
} from "./skill-bundle.js";
export type {
  SkillBundle,
  SkillBundleDiagnostic,
  SkillBundleDiagnosticCode,
  SkillBundleFile,
  VerifiedSkillBundleSkill,
  VerifySkillBundleInstallationRequest,
  VerifySkillBundleInstallationResult,
  VerifySkillBundleResult,
} from "./skill-bundle.js";
export {
  SKILL_UPGRADE_PROPOSAL_CONTRACT_VERSION,
  proposeSkillUpgrades,
} from "./skill-upgrade.js";
export type {
  ProposeSkillUpgradesRequest,
  ProposeSkillUpgradesResult,
  SkillUpgradeBundleIdentity,
  SkillUpgradeCapability,
  SkillUpgradeChange,
  SkillUpgradeChangeKind,
  SkillUpgradeFileChangeKind,
  SkillUpgradeFileText,
  SkillUpgradeLicenseNotice,
  SkillUpgradeReleaseImpact,
  SkillUpgradeSemanticComparison,
  SkillUpgradeTest,
  SkillUpgradeCompatibility,
  SkillUpgradeCompatibilityFailure,
  SkillUpgradeCompatibilityFailureCode,
  SkillUpgradeFileChange,
  SkillUpgradeFileIdentity,
  SkillUpgradeProposal,
  SkillUpgradeProposalDiagnostic,
  SkillUpgradeProposalDiagnosticCode,
  SkillUpgradeSidecarConstraint,
  SkillUpgradeSkill,
} from "./skill-upgrade.js";
export { hashKnowledgeCandidateContent } from "./knowledge-candidate.js";
export type { KnowledgeCandidateContent } from "./knowledge-candidate.js";
export {
  KNOWLEDGE_CONTRACT_VERSION,
  createKnowledgeCandidate,
  listKnowledgeCandidates,
  readKnowledgeCandidate,
  reviewKnowledgeCandidate,
} from "./knowledge.js";
export type {
  CreateKnowledgeCandidateRequest,
  CreateKnowledgeCandidateResult,
  KnowledgeCandidateCreationDisposition,
  KnowledgeCandidateDiagnostic,
  KnowledgeCandidateDiagnosticCode,
  KnowledgeCandidateDisposition,
  KnowledgeCandidateDraft,
  KnowledgeCandidateFileSystem,
  ListedKnowledgeCandidate,
  ListKnowledgeCandidatesRequest,
  ListKnowledgeCandidatesResult,
  ReadKnowledgeCandidateRequest,
  ReadKnowledgeCandidateResult,
  ReviewKnowledgeCandidateRequest,
  ReviewKnowledgeCandidateResult,
} from "./knowledge.js";
export {
  KNOWLEDGE_PROMOTION_CONTRACT_VERSION,
  promoteKnowledgeCandidate,
} from "./knowledge-promotion.js";
export type {
  InvalidatedKnowledgeContext,
  KnowledgePromotionDiagnostic,
  KnowledgePromotionDiagnosticCode,
  KnowledgePromotionFileSystem,
  KnowledgePromotionRecord,
  KnowledgePromotionTarget,
  KnowledgePromotionTargetKind,
  PromoteKnowledgeCandidateRequest,
  PromoteKnowledgeCandidateResult,
} from "./knowledge-promotion.js";
export {
  MARKDOWN_TRACKER_CONTRACT_VERSION,
  projectDeletedMarkdownTrackerTask,
  projectMarkdownTracker,
  resolveMarkdownTrackerConflict,
} from "./markdown-tracker.js";
export type {
  MarkdownTrackerConflict,
  MarkdownTrackerConflictResolution,
  MarkdownTrackerEntry,
  MarkdownTrackerSnapshot,
  MarkdownTrackerStore,
  ProjectDeletedMarkdownTrackerTaskRequest,
  ProjectMarkdownTrackerRequest,
  ProjectMarkdownTrackerResult,
  ResolveMarkdownTrackerConflictRequest,
  ResolveMarkdownTrackerConflictResult,
} from "./markdown-tracker.js";
export {
  TRACKER_PROJECTION_CONTRACT_VERSION,
  projectTrackerProjection,
  resolveTrackerProjectionConflict,
} from "./tracker-projection.js";
export type {
  ProjectTrackerProjectionRequest,
  ProjectTrackerProjectionResult,
  ResolveTrackerProjectionConflictRequest,
  ResolveTrackerProjectionConflictResult,
  TrackerProjectionAdapter,
  TrackerProjectionAdapterOutcome,
  TrackerProjectionConflict,
  TrackerProjectionConflictResolution,
  TrackerProjectionDiagnostic,
  TrackerProjectionDiagnosticCode,
  TrackerProjectionMapping,
  TrackerProjectionPendingMutation,
  TrackerProjectionMutation,
  TrackerProjectionOperation,
  TrackerProjectionPayload,
  TrackerProjectionRemoteResource,
  TrackerProjectionStore,
} from "./tracker-projection.js";
export {
  GITHUB_TRACKER_CONTRACT_VERSION,
  getGitHubIssueProjectionStatus,
  pullGitHubIssueProjection,
  pushGitHubIssueProjection,
  resolveGitHubIssueProjectionConflict,
} from "./github-tracker.js";
export type {
  GitHubIssue,
  GetGitHubIssueProjectionStatusRequest,
  GitHubIssueConflictResolution,
  GitHubIssueMutationResult,
  GitHubIssueProjection,
  GitHubIssueProjectionResult,
  GitHubIssueProjectionStatusResult,
  GitHubIssueReadResult,
  GitHubIssueReference,
  GitHubIssueState,
  GitHubIssueSyncConflict,
  GitHubTrackerDiagnostic,
  GitHubTrackerDiagnosticCode,
  GitHubTrackerFailureCode,
  GitHubTrackerPort,
  ResolveGitHubIssueProjectionConflictRequest,
  PullGitHubIssueProjectionRequest,
  PushGitHubIssueProjectionRequest,
} from "./github-tracker.js";
export {
  COORDINATED_RELEASE_ARTIFACTS,
  createCoordinatedReleaseArtifacts,
  installedProjectVersionsForReleaseArtifacts,
  RELEASE_ARTIFACT_CONTRACT_VERSION,
  verifyCoordinatedReleaseArtifacts,
  verifyTrustedCoordinatedReleaseArtifacts,
} from "./release-artifacts.js";
export type {
  CoordinatedReleaseArtifacts,
  CoordinatedReleaseArtifactsDiagnostic,
  CoordinatedReleaseArtifactsDiagnosticCode,
  CreateCoordinatedReleaseArtifactsRequest,
  CreateCoordinatedReleaseArtifactsResult,
  ReleaseArtifactCompatibility,
  ReleaseArtifactCompatibilityInput,
  ReleaseArtifactMetadata,
  ReleaseArtifactName,
  ReleaseArtifactProvenance,
  ReleaseArtifactVersions,
  VerifyCoordinatedReleaseArtifactsResult,
} from "./release-artifacts.js";
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

export type { InitiativeRepairNode } from "./initiative-integration.js";

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
  InitiativeIntegrationExecution,
  InitiativeIntegrationOutcome,
  InitiativeIntegrationResult,
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
  isPhaseAgentRole,
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
  recordTrackerSynchronization,
  reviseInitiativeGraph,
} from "./workflow.js";
export type {
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphEdgeType,
  DependencyGraphNode,
  InitiativeRepairContext,
  InitiativeRepairFailureKind,

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
  RecordTrackerSynchronizationRequest,
  RecordTrackerSynchronizationResult,
  TrackerReference,
  TrackerSynchronizationChange,
  TrackerSynchronizedEvent,
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
  createDurableInitiativeRepairs,
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
  PhaseExecutionFileSystem,
  SharedCheckoutReaderFileSystem,
  SharedCheckoutReaderLease,
  CreateDurableInitiativeRepairsRequest,
  CreateDurableInitiativeRepairsResult,
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
  readonly verifySkillBundle: typeof verifySkillBundle;
  readonly verifySkillBundleInstallation: typeof verifySkillBundleInstallation;
  readonly proposeSkillUpgrades: typeof proposeSkillUpgrades;
  readonly verifyCoordinatedReleaseArtifacts: typeof verifyCoordinatedReleaseArtifacts;
  readonly verifyTrustedCoordinatedReleaseArtifacts: typeof verifyTrustedCoordinatedReleaseArtifacts;
  readonly diagnoseManagedProject: typeof diagnoseManagedProject;
  readonly initializeManagedProject: typeof initializeManagedProject;
  readonly createSpec: typeof createSpec;
  readonly findImpactedSpecContexts: typeof findImpactedSpecContexts;
  readonly listSpecs: typeof listSpecs;
  readonly readSpec: typeof readSpec;
  readonly validateSpecs: typeof validateSpecs;
  readonly createKnowledgeCandidate: typeof createKnowledgeCandidate;
  readonly listKnowledgeCandidates: typeof listKnowledgeCandidates;
  readonly readKnowledgeCandidate: typeof readKnowledgeCandidate;
  readonly reviewKnowledgeCandidate: typeof reviewKnowledgeCandidate;
  readonly promoteKnowledgeCandidate: typeof promoteKnowledgeCandidate;
  readonly projectMarkdownTracker: typeof projectMarkdownTracker;
  readonly projectDeletedMarkdownTrackerTask: typeof projectDeletedMarkdownTrackerTask;
  readonly resolveMarkdownTrackerConflict: typeof resolveMarkdownTrackerConflict;
  readonly projectTrackerProjection: typeof projectTrackerProjection;
  readonly resolveTrackerProjectionConflict: typeof resolveTrackerProjectionConflict;
  readonly pushGitHubIssueProjection: typeof pushGitHubIssueProjection;
  readonly pullGitHubIssueProjection: typeof pullGitHubIssueProjection;
  readonly getGitHubIssueProjectionStatus: typeof getGitHubIssueProjectionStatus;
  readonly resolveGitHubIssueProjectionConflict: typeof resolveGitHubIssueProjectionConflict;
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
  readonly recordTrackerSynchronization: typeof recordTrackerSynchronization;
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
  verifySkillBundle,
  verifySkillBundleInstallation,
  proposeSkillUpgrades,
  verifyCoordinatedReleaseArtifacts,
  verifyTrustedCoordinatedReleaseArtifacts,
  diagnoseManagedProject,
  initializeManagedProject,
  createSpec,
  findImpactedSpecContexts,
  listSpecs,
  readSpec,
  validateSpecs,
  createKnowledgeCandidate,
  listKnowledgeCandidates,
  readKnowledgeCandidate,
  reviewKnowledgeCandidate,
  promoteKnowledgeCandidate,
  projectMarkdownTracker,
  projectDeletedMarkdownTrackerTask,
  resolveMarkdownTrackerConflict,
  projectTrackerProjection,
  resolveTrackerProjectionConflict,
  pushGitHubIssueProjection,
  pullGitHubIssueProjection,
  getGitHubIssueProjectionStatus,
  resolveGitHubIssueProjectionConflict,
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
  recordTrackerSynchronization,
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
