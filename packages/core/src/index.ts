import {
  authorizePhaseExecution,
  bindPhaseExecution,
} from "./execution.js";
import { validateDomainValue } from "./validation.js";
import {
  readRouteDefinition,
  replayWorkflowEvents,
  startWorkflowTask,
  transitionWorkflow,
} from "./workflow.js";

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
  ContractIdentity,
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
  readRouteDefinition,
  replayWorkflowEvents,
  startWorkflowTask,
  transitionWorkflow,
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

export interface BootstrapContract {
  readonly product: "SayHi";
  readonly contractVersion: 1;
}

export interface CoreContract {
  readBootstrapContract(): BootstrapContract;
  readonly validateDomainValue: typeof validateDomainValue;
  readonly bindPhaseExecution: typeof bindPhaseExecution;
  readonly authorizePhaseExecution: typeof authorizePhaseExecution;
  readonly readRouteDefinition: typeof readRouteDefinition;
  readonly startWorkflowTask: typeof startWorkflowTask;
  readonly transitionWorkflow: typeof transitionWorkflow;
  readonly replayWorkflowEvents: typeof replayWorkflowEvents;
}

const bootstrapContract: BootstrapContract = Object.freeze({
  product: "SayHi",
  contractVersion: 1,
});

export const coreContract: CoreContract = Object.freeze({
  readBootstrapContract: () => bootstrapContract,
  validateDomainValue,
  bindPhaseExecution,
  authorizePhaseExecution,
  readRouteDefinition,
  startWorkflowTask,
  transitionWorkflow,
  replayWorkflowEvents,
});
